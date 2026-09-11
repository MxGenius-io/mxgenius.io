import asyncio
import hashlib
import io
import os
import stat
import tempfile
import threading
import unittest
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from equipment_pack_agent import (
    AgentConfig,
    DesiredPack,
    EdgeIdentity,
    EquipmentPackAgent,
    EquipmentPackError,
    HttpCoreClient,
    RuntimeState,
    StateStore,
    verify_and_stage,
)


DEVICE_ID = "a1379f31-f033-4dc5-9b60-b5aecb5fc456"
VERSION_ID = "79c23ab9-2c6b-46c4-b05b-b63831129e33"
IDENTITY = EdgeIdentity(
    device_id=DEVICE_ID,
    display_name="Hangar node 1",
    credential=f"mxgd.{DEVICE_ID}." + "a" * 64,
)


def digest(payload: bytes) -> str:
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def package(files: dict[str, bytes], generation: int = 1) -> tuple[bytes, DesiredPack]:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, payload in files.items():
            archive.writestr(name, payload)
    payload = output.getvalue()
    desired = DesiredPack(
        generation=generation,
        version_id=VERSION_ID,
        version_number=generation,
        content_hash=digest(payload),
        byte_size=len(payload),
        file_count=len(files),
        manifest={
            "schemaVersion": 1,
            "files": [
                {"path": name, "sizeBytes": len(content), "sha256": digest(content)}
                for name, content in files.items()
            ],
        },
    )
    return payload, desired


class FakeCore:
    def __init__(self, payload: bytes, desired: DesiredPack, *, etag: str = '"generation-1"') -> None:
        self.payload = payload
        self.desired = desired
        self.etag = etag
        self.reports: list[tuple[str, dict]] = []
        self.downloads = 0
        self.etags: list[str | None] = []
        self.enrollments: list[tuple[str, str | None]] = []

    def enroll(self, code: str, hardware_id: str | None) -> EdgeIdentity:
        self.enrollments.append((code, hardware_id))
        return IDENTITY

    def desired_state(self, _identity, etag):
        self.etags.append(etag)
        if etag == self.etag:
            return True, etag, None
        return False, self.etag, self.desired

    def download(self, _identity, _desired, destination: Path) -> None:
        self.downloads += 1
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(self.payload)

    def report(self, _identity, _desired, state: str, **fields) -> None:
        self.reports.append((state, fields))


class IdentityAndStateTests(unittest.IsolatedAsyncioTestCase):
    async def test_enrollment_persists_without_disclosing_the_credential(self):
        payload, desired = package({"manuals/overview.txt": b"ready"})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            core = FakeCore(payload, desired)
            agent = EquipmentPackAgent(AgentConfig(True, "https://core.example", root), core)
            status = await agent.enroll("ABCD-EF12-3456-7890-ABCD-EF12", "pi-serial-1")
            await agent.stop()

            saved = StateStore(root).load_identity()
            self.assertEqual(saved, IDENTITY)
            self.assertNotIn("credential", status)
            self.assertNotIn(IDENTITY.credential, str(status))
            self.assertEqual(core.enrollments, [("ABCDEF1234567890ABCDEF12", "pi-serial-1")])
            if os.name != "nt":
                self.assertEqual(stat.S_IMODE((root / "identity.json").stat().st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)

    async def test_identity_and_staged_state_survive_restart(self):
        payload, desired = package({"manual.pdf": b"test data"})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            store = StateStore(root)
            store.save_identity(IDENTITY)
            store.save_runtime(RuntimeState(pending_generation=1, pending_slot="A", desired_etag='"generation-1"'))
            core = FakeCore(payload, desired)
            agent = EquipmentPackAgent(AgentConfig(True, "https://core.example", root, 900), core)

            await agent.start()
            await asyncio.sleep(0.05)
            self.assertTrue(agent.public_status()["enrolled"])
            self.assertEqual(agent.public_status()["phase"], "staged")
            self.assertEqual(agent.public_status()["pendingSlot"], "A")
            self.assertEqual(core.downloads, 0)
            await agent.stop()


class PackageValidationTests(unittest.TestCase):
    def test_valid_package_is_verified_and_staged(self):
        payload, desired = package({"manuals/engine.txt": b"engine", "images/check.png": b"png"})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "pack.zip"
            archive.write_bytes(payload)
            target = verify_and_stage(archive, desired, root / "slots", "A")
            self.assertEqual((target / "manuals/engine.txt").read_bytes(), b"engine")
            self.assertEqual((target / "images/check.png").read_bytes(), b"png")
            self.assertTrue((target / "pack-state.json").is_file())

    def test_traversal_and_case_collisions_are_rejected(self):
        for files, expected_code in [
            ({"../escape.txt": b"bad"}, "UNSAFE_PACKAGE_PATH"),
            ({"Manual.txt": b"one", "manual.txt": b"two"}, "PATH_COLLISION"),
        ]:
            with self.subTest(expected_code=expected_code), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                payload, desired = package(files)
                archive = root / "pack.zip"
                archive.write_bytes(payload)
                with self.assertRaises(EquipmentPackError) as raised:
                    verify_and_stage(archive, desired, root / "slots", "A")
                self.assertEqual(raised.exception.code, expected_code)
                self.assertFalse((root / "escape.txt").exists())

    def test_extra_and_hash_mismatched_files_are_rejected(self):
        payload, desired = package({"manual.txt": b"expected", "extra.txt": b"extra"})
        desired = DesiredPack(
            generation=desired.generation,
            version_id=desired.version_id,
            version_number=desired.version_number,
            content_hash=desired.content_hash,
            byte_size=desired.byte_size,
            file_count=1,
            manifest={"schemaVersion": 1, "files": [desired.manifest["files"][0]]},
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "pack.zip"
            archive.write_bytes(payload)
            with self.assertRaises(EquipmentPackError) as raised:
                verify_and_stage(archive, desired, root / "slots", "B")
            self.assertEqual(raised.exception.code, "ARCHIVE_MANIFEST_MISMATCH")

        payload, desired = package({"manual.txt": b"actual"})
        desired.manifest["files"][0]["sha256"] = digest(b"different")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "pack.zip"
            archive.write_bytes(payload)
            with self.assertRaises(EquipmentPackError) as raised:
                verify_and_stage(archive, desired, root / "slots", "A")
            self.assertEqual(raised.exception.code, "FILE_HASH_MISMATCH")


class ReconciliationTests(unittest.IsolatedAsyncioTestCase):
    async def test_new_generation_uses_inactive_slot_and_acknowledges_each_phase(self):
        payload, desired = package({"manual.txt": b"generation two"}, generation=2)
        activated: list[tuple[str, Path, int]] = []

        async def activate(slot: str, staged: Path, assigned: DesiredPack) -> None:
            activated.append((slot, staged, assigned.generation))

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            core = FakeCore(payload, desired, etag='"generation-2"')
            agent = EquipmentPackAgent(AgentConfig(True, "https://core.example", root), core, activate)
            agent.identity = IDENTITY
            agent.runtime = RuntimeState(active_generation=1, active_slot="A")

            status = await agent.reconcile_once()
            self.assertEqual(status["phase"], "active")
            self.assertEqual(status["activeGeneration"], 2)
            self.assertEqual(status["activeSlot"], "B")
            self.assertEqual([state for state, _ in core.reports], [
                "downloading", "verified", "staged", "activating", "active"
            ])
            self.assertEqual(activated[0][0], "B")
            self.assertEqual(activated[0][2], 2)
            self.assertEqual(StateStore(root).load_runtime().desired_etag, '"generation-2"')

    async def test_staging_without_usb_activation_is_stable_across_etag_poll(self):
        payload, desired = package({"manual.txt": b"generation one"})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            core = FakeCore(payload, desired)
            agent = EquipmentPackAgent(AgentConfig(True, "https://core.example", root), core)
            agent.identity = IDENTITY

            first = await agent.reconcile_once()
            second = await agent.reconcile_once()
            self.assertEqual(first["phase"], "staged")
            self.assertEqual(second["phase"], "staged")
            self.assertEqual(second["pendingSlot"], "A")
            self.assertEqual(core.downloads, 1)
            self.assertEqual(core.etags, [None, '"generation-1"'])

    async def test_old_generation_is_ignored(self):
        payload, desired = package({"manual.txt": b"old"}, generation=2)
        with tempfile.TemporaryDirectory() as temporary:
            core = FakeCore(payload, desired, etag='"generation-2"')
            agent = EquipmentPackAgent(AgentConfig(True, "https://core.example", Path(temporary)), core)
            agent.identity = IDENTITY
            agent.runtime = RuntimeState(active_generation=3, active_slot="A")
            status = await agent.reconcile_once()
            self.assertEqual(status["phase"], "active")
            self.assertEqual(core.downloads, 0)
            self.assertEqual(core.reports, [])

    async def test_corrupt_download_preserves_the_active_slot_and_reports_failure(self):
        _, desired = package({"manual.txt": b"valid"}, generation=2)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            active = root / "slots" / "A"
            active.mkdir(parents=True)
            (active / "manual.txt").write_bytes(b"generation one")
            core = FakeCore(b"corrupt", desired, etag='"generation-2"')
            agent = EquipmentPackAgent(AgentConfig(True, "https://core.example", root), core)
            agent.identity = IDENTITY
            agent.runtime = RuntimeState(active_generation=1, active_slot="A")

            status = await agent.reconcile_once()
            self.assertEqual(status["phase"], "failed")
            self.assertEqual((active / "manual.txt").read_bytes(), b"generation one")
            self.assertFalse((root / "downloads" / "2.zip.part").exists())
            self.assertEqual(core.reports[-1][0], "failed")
            self.assertEqual(core.reports[-1][1]["errorCode"], "PACKAGE_HASH_MISMATCH")


class RangeDownloadTests(unittest.TestCase):
    def test_partial_download_resumes_with_http_range(self):
        payload = b"0123456789" * 4096
        observed_ranges: list[str | None] = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                value = self.headers.get("Range")
                observed_ranges.append(value)
                offset = int(value.removeprefix("bytes=").removesuffix("-")) if value else 0
                body = payload[offset:]
                self.send_response(206 if offset else 200)
                self.send_header("Content-Length", str(len(body)))
                if offset:
                    self.send_header("Content-Range", f"bytes {offset}-{len(payload) - 1}/{len(payload)}")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, _format, *_args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temporary:
                destination = Path(temporary) / "pack.zip.part"
                destination.write_bytes(payload[:137])
                desired = DesiredPack(1, VERSION_ID, 1, digest(payload), len(payload), 1, {"schemaVersion": 1, "files": []})
                HttpCoreClient(f"http://127.0.0.1:{server.server_port}").download(
                    IDENTITY, desired, destination
                )
                self.assertEqual(destination.read_bytes(), payload)
                self.assertEqual(observed_ranges, ["bytes=137-"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
