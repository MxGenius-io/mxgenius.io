"""Durable, outbound-only Equipment Pack synchronization for the Pi appliance."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Awaitable, Callable, Protocol


MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024
MAX_JSON_BYTES = 1024 * 1024
DOWNLOAD_CHUNK_BYTES = 1024 * 1024
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
ENROLLMENT_CODE = re.compile(r"^[0-9A-F]{24}$")
FAT_RESERVED = {"CON", "PRN", "AUX", "NUL"}


class EquipmentPackError(RuntimeError):
    """A bounded operator-safe Equipment Pack failure."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


@dataclass(frozen=True)
class AgentConfig:
    enabled: bool
    core_url: str
    state_dir: Path
    poll_seconds: float = 60.0

    @classmethod
    def from_environment(cls) -> "AgentConfig":
        enabled = os.getenv("MXG_EDGE_PACKS_ENABLED", "0").strip().lower() in {"1", "true", "yes"}
        core_url = os.getenv("MXG_EDGE_CORE_URL", "").strip().rstrip("/")
        state_dir = Path(os.getenv("MXG_EDGE_STATE_DIR", "/var/lib/mxg-diagnostics-kiosk"))
        try:
            poll_seconds = max(15.0, min(float(os.getenv("MXG_EDGE_POLL_SECONDS", "60")), 900.0))
        except ValueError:
            poll_seconds = 60.0
        if core_url:
            parsed = urllib.parse.urlsplit(core_url)
            local_http = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
            if parsed.scheme != "https" and not local_http:
                raise EquipmentPackError("INVALID_CORE_URL", "the Equipment Pack core URL must use HTTPS")
        return cls(enabled=enabled, core_url=core_url, state_dir=state_dir, poll_seconds=poll_seconds)


@dataclass(frozen=True)
class EdgeIdentity:
    device_id: str
    display_name: str
    credential: str

    @classmethod
    def from_wire(cls, payload: dict[str, Any]) -> "EdgeIdentity":
        device = payload.get("device")
        if not isinstance(device, dict):
            raise EquipmentPackError("INVALID_ENROLLMENT", "the core returned an invalid device identity")
        device_id = str(device.get("id") or "")
        display_name = str(device.get("displayName") or "").strip()
        credential = str(payload.get("credential") or "")
        try:
            uuid.UUID(device_id)
        except ValueError as error:
            raise EquipmentPackError("INVALID_ENROLLMENT", "the core returned an invalid node ID") from error
        if not display_name or len(display_name) > 120:
            raise EquipmentPackError("INVALID_ENROLLMENT", "the core returned an invalid node name")
        if not credential.startswith(f"mxgd.{device_id}.") or not 50 <= len(credential) <= 180:
            raise EquipmentPackError("INVALID_ENROLLMENT", "the core returned an invalid device credential")
        return cls(device_id=device_id, display_name=display_name, credential=credential)


@dataclass(frozen=True)
class DesiredPack:
    generation: int
    version_id: str
    version_number: int
    content_hash: str
    byte_size: int
    file_count: int
    manifest: dict[str, Any]

    @classmethod
    def from_wire(cls, payload: dict[str, Any]) -> "DesiredPack | None":
        desired = payload.get("desired")
        if desired is None:
            return None
        if not isinstance(desired, dict):
            raise EquipmentPackError("INVALID_DESIRED_STATE", "the desired package is invalid")
        try:
            generation = int(desired.get("generation"))
            version_id = str(uuid.UUID(str(desired.get("versionId"))))
            version_number = int(desired.get("versionNumber"))
            byte_size = int(desired.get("byteSize"))
            file_count = int(desired.get("fileCount"))
        except (TypeError, ValueError) as error:
            raise EquipmentPackError("INVALID_DESIRED_STATE", "the desired package identifiers are invalid") from error
        content_hash = str(desired.get("contentHash") or "")
        manifest = desired.get("manifest")
        if generation < 1 or version_number < 1:
            raise EquipmentPackError("INVALID_DESIRED_STATE", "the desired generation is invalid")
        if not 1 <= byte_size <= MAX_PACKAGE_BYTES or not 1 <= file_count <= 100_000:
            raise EquipmentPackError("INVALID_DESIRED_STATE", "the desired package bounds are invalid")
        if not SHA256.fullmatch(content_hash) or not isinstance(manifest, dict):
            raise EquipmentPackError("INVALID_DESIRED_STATE", "the desired package manifest is invalid")
        files = manifest.get("files")
        if manifest.get("schemaVersion") != 1 or not isinstance(files, list) or len(files) != file_count:
            raise EquipmentPackError("INVALID_DESIRED_STATE", "the desired package manifest contract is invalid")
        return cls(
            generation=generation,
            version_id=version_id,
            version_number=version_number,
            content_hash=content_hash,
            byte_size=byte_size,
            file_count=file_count,
            manifest=manifest,
        )


@dataclass
class RuntimeState:
    active_generation: int = 0
    active_version_id: str | None = None
    active_slot: str | None = None
    active_hash: str | None = None
    desired_etag: str | None = None
    pending_generation: int | None = None
    pending_slot: str | None = None

    @classmethod
    def from_wire(cls, payload: dict[str, Any]) -> "RuntimeState":
        active_slot = payload.get("active_slot")
        if active_slot not in {None, "A", "B"}:
            raise EquipmentPackError("INVALID_LOCAL_STATE", "the saved active slot is invalid")
        pending_slot = payload.get("pending_slot")
        if pending_slot not in {None, "A", "B"}:
            raise EquipmentPackError("INVALID_LOCAL_STATE", "the saved pending slot is invalid")
        active_generation = int(payload.get("active_generation") or 0)
        if active_generation < 0:
            raise EquipmentPackError("INVALID_LOCAL_STATE", "the saved generation is invalid")
        pending_generation = payload.get("pending_generation")
        if pending_generation is not None:
            pending_generation = int(pending_generation)
            if pending_generation < 1:
                raise EquipmentPackError("INVALID_LOCAL_STATE", "the saved pending generation is invalid")
        return cls(
            active_generation=active_generation,
            active_version_id=payload.get("active_version_id"),
            active_slot=active_slot,
            active_hash=payload.get("active_hash"),
            desired_etag=payload.get("desired_etag"),
            pending_generation=pending_generation,
            pending_slot=pending_slot,
        )


class StateStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.identity_path = root / "identity.json"
        self.runtime_path = root / "state.json"

    def _read(self, path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise EquipmentPackError("INVALID_LOCAL_STATE", f"{path.name} could not be read safely") from error
        if not isinstance(payload, dict) or payload.get("schemaVersion") != 1:
            raise EquipmentPackError("INVALID_LOCAL_STATE", f"{path.name} has an unsupported schema")
        return payload

    def _write(self, path: Path, payload: dict[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=self.root)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, separators=(",", ":"), sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, path)
            os.chmod(path, 0o600)
        finally:
            temporary.unlink(missing_ok=True)

    def load_identity(self) -> EdgeIdentity | None:
        payload = self._read(self.identity_path)
        return None if payload is None else EdgeIdentity.from_wire(payload)

    def save_identity(self, identity: EdgeIdentity) -> None:
        self._write(
            self.identity_path,
            {
                "schemaVersion": 1,
                "device": {"id": identity.device_id, "displayName": identity.display_name},
                "credential": identity.credential,
            },
        )

    def load_runtime(self) -> RuntimeState:
        payload = self._read(self.runtime_path)
        if payload is None:
            return RuntimeState()
        payload = dict(payload)
        payload.pop("schemaVersion", None)
        return RuntimeState.from_wire(payload)

    def save_runtime(self, state: RuntimeState) -> None:
        self._write(self.runtime_path, {"schemaVersion": 1, **asdict(state)})


class CoreClient(Protocol):
    def enroll(self, code: str, hardware_id: str | None) -> EdgeIdentity: ...

    def desired_state(self, identity: EdgeIdentity, etag: str | None) -> tuple[bool, str | None, DesiredPack | None]: ...

    def download(self, identity: EdgeIdentity, desired: DesiredPack, destination: Path) -> None: ...

    def report(self, identity: EdgeIdentity, desired: DesiredPack, state: str, **fields: Any) -> None: ...


class HttpCoreClient:
    def __init__(self, base_url: str, timeout_seconds: float = 20.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def _json_request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
        identity: EdgeIdentity | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], dict[str, Any] | None]:
        request_headers = {"Accept": "application/json", **(headers or {})}
        body = None
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        if identity is not None:
            request_headers["Authorization"] = f"Bearer {identity.credential}"
        request = urllib.request.Request(f"{self.base_url}{path}", data=body, headers=request_headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                raw = response.read(MAX_JSON_BYTES + 1)
                if len(raw) > MAX_JSON_BYTES:
                    raise EquipmentPackError("CORE_RESPONSE_TOO_LARGE", "the core response exceeded its limit")
                decoded = json.loads(raw) if raw else None
                return response.status, dict(response.headers.items()), decoded
        except urllib.error.HTTPError as error:
            if error.code == 304:
                return 304, dict(error.headers.items()), None
            raise EquipmentPackError("CORE_REJECTED", f"the core rejected the request with HTTP {error.code}") from error
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
            raise EquipmentPackError("CORE_UNAVAILABLE", "the Equipment Pack core is unavailable") from error

    def enroll(self, code: str, hardware_id: str | None) -> EdgeIdentity:
        status, _, payload = self._json_request(
            "POST",
            "/api/edge/enroll",
            payload={"code": code, "hardwareId": hardware_id},
        )
        if status != 201 or not isinstance(payload, dict):
            raise EquipmentPackError("INVALID_ENROLLMENT", "the core returned an invalid enrollment response")
        return EdgeIdentity.from_wire(payload)

    def desired_state(self, identity: EdgeIdentity, etag: str | None) -> tuple[bool, str | None, DesiredPack | None]:
        headers = {"If-None-Match": etag} if etag else {}
        status, response_headers, payload = self._json_request(
            "GET", "/api/edge/state", identity=identity, headers=headers
        )
        if status == 304:
            return True, etag, None
        if status != 200 or not isinstance(payload, dict):
            raise EquipmentPackError("INVALID_DESIRED_STATE", "the core returned an invalid desired state")
        return False, response_headers.get("ETag") or response_headers.get("Etag"), DesiredPack.from_wire(payload)

    def download(self, identity: EdgeIdentity, desired: DesiredPack, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        offset = destination.stat().st_size if destination.exists() else 0
        if offset > desired.byte_size:
            destination.unlink()
            offset = 0
        if offset == desired.byte_size:
            return
        headers = {"Authorization": f"Bearer {identity.credential}"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        request = urllib.request.Request(
            f"{self.base_url}/api/edge/packs/{desired.version_id}/content",
            headers=headers,
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=max(self.timeout_seconds, 60.0)) as response:
                if offset and response.status == 206:
                    content_range = response.headers.get("Content-Range", "")
                    if not content_range.startswith(f"bytes {offset}-"):
                        raise EquipmentPackError("INVALID_PACKAGE_RANGE", "the core returned the wrong package range")
                    mode = "ab"
                elif response.status == 200:
                    mode = "wb"
                    offset = 0
                else:
                    raise EquipmentPackError("PACKAGE_DOWNLOAD_FAILED", "the package download response was invalid")
                written = offset
                with destination.open(mode) as handle:
                    while True:
                        chunk = response.read(DOWNLOAD_CHUNK_BYTES)
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > desired.byte_size or written > MAX_PACKAGE_BYTES:
                            raise EquipmentPackError("PACKAGE_TOO_LARGE", "the package exceeded its declared size")
                        handle.write(chunk)
                    handle.flush()
                    os.fsync(handle.fileno())
        except EquipmentPackError:
            raise
        except urllib.error.HTTPError as error:
            raise EquipmentPackError("PACKAGE_DOWNLOAD_REJECTED", f"the core rejected the download with HTTP {error.code}") from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise EquipmentPackError("PACKAGE_DOWNLOAD_FAILED", "the package download was interrupted") from error
        if destination.stat().st_size != desired.byte_size:
            raise EquipmentPackError("PACKAGE_SIZE_MISMATCH", "the downloaded package size did not match")

    def report(self, identity: EdgeIdentity, desired: DesiredPack, state: str, **fields: Any) -> None:
        status, _, _ = self._json_request(
            "POST",
            f"/api/edge/deployments/{desired.generation}/status",
            payload={"state": state, **fields},
            identity=identity,
        )
        if status != 200:
            raise EquipmentPackError("STATUS_REPORT_FAILED", "the core rejected a deployment status")


def _validate_path(value: str) -> str:
    if (
        not value
        or len(value.encode("utf-8")) > 1024
        or value.startswith(("/", "\\"))
        or "\\" in value
        or any(character in '<>:"|?*' for character in value)
    ):
        raise EquipmentPackError("UNSAFE_PACKAGE_PATH", "the package contains an unsafe path")
    if any(ord(character) < 32 for character in value):
        raise EquipmentPackError("UNSAFE_PACKAGE_PATH", "the package contains an unsafe path")
    parts = tuple(value.split("/"))
    if not parts or any(part in {"", ".", ".."} or len(part.encode("utf-8")) > 255 for part in parts):
        raise EquipmentPackError("UNSAFE_PACKAGE_PATH", "the package contains an unsafe path")
    for part in parts:
        if part.endswith((".", " ")):
            raise EquipmentPackError("UNSAFE_PACKAGE_PATH", "the package path is not FAT compatible")
        stem = part.split(".", 1)[0].upper()
        if stem in FAT_RESERVED or (len(stem) == 4 and stem[:3] in {"COM", "LPT"} and stem[3].isdigit()):
            raise EquipmentPackError("UNSAFE_PACKAGE_PATH", "the package path uses a reserved FAT name")
    return "/".join(parts)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(DOWNLOAD_CHUNK_BYTES):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def verify_and_stage(archive: Path, desired: DesiredPack, slots_root: Path, slot: str) -> Path:
    if slot not in {"A", "B"}:
        raise EquipmentPackError("INVALID_SLOT", "the inactive slot must be A or B")
    if archive.stat().st_size != desired.byte_size or _sha256(archive) != desired.content_hash:
        raise EquipmentPackError("PACKAGE_HASH_MISMATCH", "the package failed aggregate verification")
    files = desired.manifest.get("files")
    if not isinstance(files, list) or len(files) != desired.file_count:
        raise EquipmentPackError("INVALID_MANIFEST", "the package manifest is invalid")
    expected: dict[str, tuple[int, str]] = {}
    folded_paths: set[str] = set()
    expanded_bytes = 0
    for item in files:
        if not isinstance(item, dict):
            raise EquipmentPackError("INVALID_MANIFEST", "the package manifest contains an invalid file")
        path = _validate_path(str(item.get("path") or ""))
        folded = path.casefold()
        if folded in folded_paths:
            raise EquipmentPackError("PATH_COLLISION", "package paths collide case-insensitively")
        folded_paths.add(folded)
        try:
            size = int(item.get("sizeBytes"))
        except (TypeError, ValueError) as error:
            raise EquipmentPackError("INVALID_MANIFEST", "a manifest file size is invalid") from error
        digest = str(item.get("sha256") or "")
        if size < 0 or size > MAX_PACKAGE_BYTES or not SHA256.fullmatch(digest):
            raise EquipmentPackError("INVALID_MANIFEST", "a manifest file contract is invalid")
        expanded_bytes += size
        if expanded_bytes > MAX_PACKAGE_BYTES:
            raise EquipmentPackError("PACKAGE_TOO_LARGE", "the expanded package exceeds its limit")
        expected[path] = (size, digest)

    slots_root.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{slot}-", dir=slots_root))
    target = slots_root / slot
    previous = slots_root / f".{slot}-previous"
    try:
        observed: set[str] = set()
        with zipfile.ZipFile(archive) as package:
            for entry in package.infolist():
                name = _validate_path(entry.filename.rstrip("/"))
                if entry.is_dir():
                    continue
                mode = entry.external_attr >> 16
                if stat.S_ISLNK(mode) or entry.flag_bits & 0x1:
                    raise EquipmentPackError("UNSAFE_ARCHIVE_ENTRY", "links and encrypted files are not accepted")
                if name not in expected or name in observed:
                    raise EquipmentPackError("ARCHIVE_MANIFEST_MISMATCH", "the archive does not match its manifest")
                expected_size, expected_hash = expected[name]
                if entry.file_size != expected_size:
                    raise EquipmentPackError("FILE_SIZE_MISMATCH", "an extracted file size did not match")
                destination = temporary.joinpath(*PurePosixPath(name).parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                written = 0
                with package.open(entry) as source, destination.open("xb") as output:
                    while chunk := source.read(DOWNLOAD_CHUNK_BYTES):
                        written += len(chunk)
                        if written > expected_size:
                            raise EquipmentPackError("FILE_SIZE_MISMATCH", "an extracted file exceeded its manifest size")
                        digest.update(chunk)
                        output.write(chunk)
                if written != expected_size or f"sha256:{digest.hexdigest()}" != expected_hash:
                    raise EquipmentPackError("FILE_HASH_MISMATCH", "an extracted file failed verification")
                observed.add(name)
        if observed != set(expected):
            raise EquipmentPackError("ARCHIVE_MANIFEST_MISMATCH", "the archive is missing manifest files")
        StateStore(temporary)._write(
            temporary / "pack-state.json",
            {
                "schemaVersion": 1,
                "generation": desired.generation,
                "versionId": desired.version_id,
                "versionNumber": desired.version_number,
                "contentHash": desired.content_hash,
            },
        )
        if previous.exists():
            shutil.rmtree(previous)
        if target.exists():
            os.replace(target, previous)
        os.replace(temporary, target)
        return target
    except (zipfile.BadZipFile, zipfile.LargeZipFile) as error:
        shutil.rmtree(temporary, ignore_errors=True)
        if not target.exists() and previous.exists():
            os.replace(previous, target)
        raise EquipmentPackError("INVALID_PACKAGE_ARCHIVE", "the package is not a valid ZIP archive") from error
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        if not target.exists() and previous.exists():
            os.replace(previous, target)
        raise


Activation = Callable[[str, Path, DesiredPack], Awaitable[None]]


class EquipmentPackAgent:
    def __init__(self, config: AgentConfig, client: CoreClient | None = None, activate: Activation | None = None) -> None:
        self.config = config
        self.store = StateStore(config.state_dir)
        self.client = client or (HttpCoreClient(config.core_url) if config.core_url else None)
        self.activate = activate
        self.identity: EdgeIdentity | None = None
        self.runtime = RuntimeState()
        self.phase = "disabled" if not config.enabled else "unenrolled"
        self.detail = "Equipment Pack synchronization is disabled" if not config.enabled else "Enroll this node"
        self._task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if not self.config.enabled:
            return
        try:
            self.identity = self.store.load_identity()
            self.runtime = self.store.load_runtime()
        except EquipmentPackError as error:
            self.phase, self.detail = "failed", error.detail
            return
        if self.identity is None:
            self.phase, self.detail = "unenrolled", "Enroll this node"
            return
        if self.client is None:
            self.phase, self.detail = "failed", "Configure the Equipment Pack core URL"
            return
        self.phase, self.detail = "reconciling", "Checking for an assigned package"
        self._task = asyncio.create_task(self._poll_loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _poll_loop(self) -> None:
        while True:
            await self.reconcile_once()
            await asyncio.sleep(self.config.poll_seconds)

    def public_status(self) -> dict[str, Any]:
        return {
            "enabled": self.config.enabled,
            "enrolled": self.identity is not None,
            "deviceId": self.identity.device_id if self.identity else None,
            "displayName": self.identity.display_name if self.identity else None,
            "phase": self.phase,
            "detail": self.detail,
            "activeGeneration": self.runtime.active_generation,
            "activeVersionId": self.runtime.active_version_id,
            "activeSlot": self.runtime.active_slot,
            "pendingGeneration": self.runtime.pending_generation,
            "pendingSlot": self.runtime.pending_slot,
        }

    async def enroll(self, code: str, hardware_id: str | None = None) -> dict[str, Any]:
        if not self.config.enabled or self.client is None:
            raise EquipmentPackError("AGENT_DISABLED", "Equipment Pack synchronization is not configured")
        normalized = "".join(character for character in code.upper() if character not in {"-", " "})
        if not ENROLLMENT_CODE.fullmatch(normalized):
            raise EquipmentPackError("INVALID_ENROLLMENT_CODE", "enter the complete one-time enrollment code")
        normalized_hardware_id = None if hardware_id is None else str(hardware_id).strip()
        if normalized_hardware_id is not None and (not normalized_hardware_id or len(normalized_hardware_id) > 180):
            raise EquipmentPackError("INVALID_HARDWARE_ID", "the hardware identifier is invalid")
        identity = await asyncio.to_thread(self.client.enroll, normalized, normalized_hardware_id)
        self.store.save_identity(identity)
        self.identity = identity
        self.phase, self.detail = "ready", "Node enrolled; checking for an assignment"
        if self._task is None:
            self._task = asyncio.create_task(self._poll_loop())
        return self.public_status()

    async def reconcile_once(self) -> dict[str, Any]:
        if not self.config.enabled or self.client is None:
            raise EquipmentPackError("AGENT_DISABLED", "Equipment Pack synchronization is not configured")
        if self.identity is None:
            raise EquipmentPackError("NODE_NOT_ENROLLED", "enroll this node before checking assignments")
        async with self._lock:
            desired: DesiredPack | None = None
            try:
                self.phase, self.detail = "reconciling", "Checking for an assigned package"
                unchanged, etag, desired = await asyncio.to_thread(
                    self.client.desired_state, self.identity, self.runtime.desired_etag
                )
                if unchanged:
                    if self.runtime.pending_generation and self.runtime.pending_slot:
                        self.phase = "staged"
                        self.detail = (
                            f"Generation {self.runtime.pending_generation} is ready in "
                            f"slot {self.runtime.pending_slot}"
                        )
                    elif self.runtime.active_generation:
                        self.phase, self.detail = "active", "The assigned package is already active"
                    else:
                        self.phase, self.detail = "ready", "No newer package is assigned"
                    return self.public_status()
                if desired is None:
                    self.runtime.desired_etag = etag
                    self.store.save_runtime(self.runtime)
                    self.phase, self.detail = "ready", "No package is assigned"
                    return self.public_status()
                if desired.generation <= self.runtime.active_generation:
                    self.runtime.desired_etag = etag
                    self.store.save_runtime(self.runtime)
                    self.phase, self.detail = "active", "The assigned package is already active"
                    return self.public_status()
                slot = "B" if self.runtime.active_slot == "A" else "A"
                self.runtime.pending_generation = desired.generation
                self.runtime.pending_slot = slot
                self.store.save_runtime(self.runtime)
                download = self.config.state_dir / "downloads" / f"{desired.generation}.zip.part"
                self.phase, self.detail = "downloading", f"Downloading generation {desired.generation}"
                await asyncio.to_thread(self.client.report, self.identity, desired, "downloading")
                await asyncio.to_thread(self.client.download, self.identity, desired, download)
                if _sha256(download) != desired.content_hash:
                    download.unlink(missing_ok=True)
                    raise EquipmentPackError("PACKAGE_HASH_MISMATCH", "the downloaded package failed verification")
                await asyncio.to_thread(
                    self.client.report,
                    self.identity,
                    desired,
                    "verified",
                    observedHash=desired.content_hash,
                )
                self.phase, self.detail = "staging", f"Preparing inactive slot {slot}"
                staged = await asyncio.to_thread(
                    verify_and_stage, download, desired, self.config.state_dir / "slots", slot
                )
                await asyncio.to_thread(
                    self.client.report,
                    self.identity,
                    desired,
                    "staged",
                    activeSlot=slot,
                    observedHash=desired.content_hash,
                )
                if self.activate is None:
                    self.runtime.desired_etag = etag
                    self.store.save_runtime(self.runtime)
                    self.phase, self.detail = "staged", f"Generation {desired.generation} is ready in slot {slot}"
                    return self.public_status()
                self.phase, self.detail = "activating", f"Switching the USB gadget to slot {slot}"
                await asyncio.to_thread(
                    self.client.report,
                    self.identity,
                    desired,
                    "activating",
                    activeSlot=slot,
                    observedHash=desired.content_hash,
                )
                await self.activate(slot, staged, desired)
                self.runtime.active_generation = desired.generation
                self.runtime.active_version_id = desired.version_id
                self.runtime.active_slot = slot
                self.runtime.active_hash = desired.content_hash
                self.runtime.desired_etag = etag
                self.runtime.pending_generation = None
                self.runtime.pending_slot = None
                self.store.save_runtime(self.runtime)
                await asyncio.to_thread(
                    self.client.report,
                    self.identity,
                    desired,
                    "active",
                    activeSlot=slot,
                    observedHash=desired.content_hash,
                )
                self.phase, self.detail = "active", f"Generation {desired.generation} is active in slot {slot}"
                return self.public_status()
            except EquipmentPackError as error:
                self.phase, self.detail = "failed", error.detail
                if desired is not None:
                    try:
                        await asyncio.to_thread(
                            self.client.report,
                            self.identity,
                            desired,
                            "failed",
                            errorCode=error.code,
                            detail=error.detail,
                        )
                    except EquipmentPackError:
                        pass
                return self.public_status()
            except Exception:
                self.phase, self.detail = "failed", "Equipment Pack reconciliation failed"
                return self.public_status()
