#!/usr/bin/env python3
"""Idempotently promote the prebuilt MiniLM manual corpus into Azure AI Search.

Dry-run is the default. Azure is mutated only when --apply is supplied.
The existing source corpus and existing Search indexes are never modified.
"""

from __future__ import annotations

import argparse
import concurrent.futures
from collections import Counter
import hashlib
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable


API_VERSION = "2023-11-01"
VECTOR_DIMENSIONS = 384


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--resource-group", default="mxg-rg-50106")
    parser.add_argument("--search-service", default="mxg-search-50106")
    parser.add_argument("--storage-account", default="mxgstorage50106")
    parser.add_argument("--container", default="documents")
    parser.add_argument("--target-index", default="manuals-catalog-v3")
    parser.add_argument("--aircraft", help="Exact aircraft name for a bounded pilot")
    parser.add_argument("--shard", help="Exact shard ID for a surgical validation or retry")
    parser.add_argument("--max-shards", type=int)
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--upload-assets", action="store_true")
    parser.add_argument("--asset-workers", type=int, default=12)
    parser.add_argument(
        "--verified-image-register",
        type=Path,
        default=Path(__file__).resolve().parents[1]
        / "config"
        / "authoritative-manual-pack-v1.json",
        help="Verified figure overrides applied by record ID after generic page linking",
    )
    parser.add_argument(
        "--repair-collisions",
        action="store_true",
        help="Replace only source chunk IDs that collide across canonical shards",
    )
    return parser.parse_args()


def run_az(*args: str, capture: bool = True) -> str:
    executable = shutil.which("az") or shutil.which("az.cmd")
    if not executable:
        raise FileNotFoundError("Azure CLI executable was not found on PATH")
    command = [executable, *args, "--only-show-errors"]
    completed = subprocess.run(
        command,
        check=True,
        capture_output=capture,
        text=True,
        encoding="utf-8",
    )
    return completed.stdout.strip() if capture else ""


def search_request(
    service: str,
    key: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    attempts: int = 10,
) -> dict[str, Any]:
    uri = f"https://{service}.search.windows.net{path}"
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
    request = urllib.request.Request(
        uri,
        data=body,
        method=method,
        headers={
            "api-key": key,
            "Accept": "application/json",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                content = response.read()
                return json.loads(content) if content else {}
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts:
                raise
            time.sleep(attempt)
    raise RuntimeError("unreachable")


def index_definition(name: str) -> dict[str, Any]:
    def field(field_name: str, field_type: str, **options: Any) -> dict[str, Any]:
        definition = {
            "name": field_name,
            "type": field_type,
            "searchable": False,
            "filterable": False,
            "retrievable": True,
            "sortable": False,
            "facetable": False,
        }
        definition.update(options)
        return definition

    return {
        "name": name,
        "fields": [
            field("id", "Edm.String", key=True, filterable=True),
            field("document_id", "Edm.String", filterable=True),
            field("content", "Edm.String", searchable=True),
            field(
                "content_vector",
                "Collection(Edm.Single)",
                searchable=True,
                retrievable=False,
                dimensions=VECTOR_DIMENSIONS,
                vectorSearchProfile="manualHnswProfile",
            ),
            field("source_class", "Edm.String", filterable=True, facetable=True),
            field("source_name", "Edm.String", searchable=True, filterable=True),
            field("source_blob", "Edm.String"),
            field("source_content_md5", "Edm.String"),
            field("title", "Edm.String", searchable=True),
            field("aircraft_model", "Edm.String", searchable=True, filterable=True, facetable=True),
            field("manual_type", "Edm.String", searchable=True, filterable=True, facetable=True),
            field("ata", "Edm.String", searchable=True, filterable=True, facetable=True),
            field("section", "Edm.String", searchable=True, filterable=True),
            field("revision", "Edm.String", filterable=True),
            field("effective_date", "Edm.DateTimeOffset", filterable=True, sortable=True),
            field("content_hash", "Edm.String", filterable=True),
            field("assets_json", "Edm.String"),
            field("lineage_state", "Edm.String", filterable=True, facetable=True),
            field("ingested_at", "Edm.DateTimeOffset", filterable=True, sortable=True),
        ],
        "vectorSearch": {
            "algorithms": [{"name": "manualHnsw", "kind": "hnsw"}],
            "profiles": [{"name": "manualHnswProfile", "algorithm": "manualHnsw"}],
        },
    }


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def manual_type(value: str) -> str | None:
    upper = value.upper()
    for candidate in ("AMM", "IPC", "AIPC", "WDM", "SRM", "SPM", "NDT", "SSM", "MPD"):
        if candidate in upper:
            return candidate
    return None


def selected_shards(
    manifest: dict[str, Any],
    aircraft: str | None,
    shard_id: str | None,
    limit: int | None,
) -> list[dict[str, Any]]:
    shards = manifest["shards"]
    if aircraft:
        shards = [item for item in shards if item.get("aircraft") == aircraft]
    if shard_id:
        shards = [item for item in shards if item.get("id") == shard_id]
    if limit is not None:
        shards = shards[: max(0, limit)]
    return shards


def shard_chunk_id_counts(
    corpus_root: Path,
    shard_entries: Iterable[dict[str, Any]],
) -> Counter[str]:
    counts: Counter[str] = Counter()
    for entry in shard_entries:
        shard_path = corpus_root / "rag_index" / Path(entry["file"])
        with shard_path.open(encoding="utf-8") as handle:
            shard = json.load(handle)
        counts.update(chunk["id"] for chunk in shard["chunks"])
    return counts


def build_chunk_id_counts(
    corpus_root: Path,
    shard_entries: list[dict[str, Any]],
    workers: int,
) -> Counter[str]:
    batches = [
        shard_entries[offset : offset + 250]
        for offset in range(0, len(shard_entries), 250)
    ]
    counts: Counter[str] = Counter()
    scanned_shards = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(shard_chunk_id_counts, corpus_root, batch): len(batch)
            for batch in batches
        }
        for future in concurrent.futures.as_completed(futures):
            counts.update(future.result())
            scanned_shards += futures[future]
            if scanned_shards % 10_000 < 250 or scanned_shards == len(shard_entries):
                print(
                    f"audited chunk identities {scanned_shards}/{len(shard_entries)}",
                    flush=True,
                )
    return counts


def search_record_id(
    shard_id: str,
    source_record_id: str,
    chunk_index: int,
    collision_ids: set[str],
) -> str:
    if source_record_id not in collision_ids:
        return source_record_id
    shard_namespace = sha256_bytes(shard_id.encode())
    return f"{shard_namespace}_r{chunk_index}_{source_record_id}"


def shard_image_paths(
    corpus_root: Path,
    shard_entries: Iterable[dict[str, Any]],
) -> set[str]:
    paths: set[str] = set()
    for entry in shard_entries:
        shard_path = corpus_root / "rag_index" / Path(entry["file"])
        with shard_path.open(encoding="utf-8") as handle:
            shard = json.load(handle)
        for chunk in shard["chunks"]:
            paths.update(chunk.get("images", []))
    return paths


def asset_catalog_records(
    corpus_root: Path,
    image_paths: Iterable[str],
    container: str,
) -> list[tuple[str, dict[str, Any]]]:
    records = []
    for relative in image_paths:
        source = corpus_root / "ingest_dumps" / Path(relative)
        if not source.is_file():
            continue
        media_type = mimetypes.guess_type(source.name)[0]
        if media_type not in {"image/jpeg", "image/png", "image/webp"}:
            continue
        digest = sha256_file(source)
        extension = source.suffix.lower()
        blob_name = f"manual-assets/legacy-rag/v3/{digest}{extension}"
        records.append(
            (
                relative,
                {
                    "source_path": source,
                    "blob_name": blob_name,
                    "asset_id": digest[:32],
                    "kind": "diagram",
                    "source_reference": f"azure-blob://{container}/{blob_name}",
                    "media_type": media_type,
                    "page": None,
                    "caption": f"Manual figure from {source.name}",
                    "content_hash": f"sha256:{digest}",
                    "size_bytes": source.stat().st_size,
                },
            )
        )
    return records


def build_asset_catalog(
    corpus_root: Path,
    shard_entries: list[dict[str, Any]],
    container: str,
    workers: int,
) -> dict[str, dict[str, Any]]:
    shard_batches = [
        shard_entries[offset : offset + 250]
        for offset in range(0, len(shard_entries), 250)
    ]
    image_paths: set[str] = set()
    scanned_shards = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(shard_image_paths, corpus_root, batch): len(batch)
            for batch in shard_batches
        }
        for future in concurrent.futures.as_completed(futures):
            image_paths.update(future.result())
            scanned_shards += futures[future]
            if scanned_shards % 10_000 < 250 or scanned_shards == len(shard_entries):
                print(
                    f"scanned shards {scanned_shards}/{len(shard_entries)}",
                    flush=True,
                )

    sorted_paths = sorted(image_paths)
    image_batches = [
        sorted_paths[offset : offset + 250]
        for offset in range(0, len(sorted_paths), 250)
    ]
    catalog: dict[str, dict[str, Any]] = {}
    hashed_images = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(asset_catalog_records, corpus_root, batch, container): len(batch)
            for batch in image_batches
        }
        for future in concurrent.futures.as_completed(futures):
            for relative, record in future.result():
                catalog[relative] = record
            hashed_images += futures[future]
            if hashed_images % 10_000 < 250 or hashed_images == len(sorted_paths):
                print(
                    f"hashed linked images {hashed_images}/{len(sorted_paths)}",
                    flush=True,
                )
    return catalog


def existing_asset_names(storage_account: str, container: str) -> set[str]:
    output = run_az(
        "storage",
        "blob",
        "list",
        "--account-name",
        storage_account,
        "--container-name",
        container,
        "--prefix",
        "manual-assets/legacy-rag/v3/",
        "--num-results",
        "100000",
        "--auth-mode",
        "login",
        "--query",
        "[].name",
        "-o",
        "json",
    )
    return set(json.loads(output or "[]"))


def storage_token() -> str:
    return run_az(
        "account",
        "get-access-token",
        "--resource",
        "https://storage.azure.com/",
        "--query",
        "accessToken",
        "-o",
        "tsv",
    )


class StorageTokenProvider:
    """Share a renewable Storage bearer across concurrent Blob uploads."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._token = ""
        self._refresh_at = 0.0

    def get(self) -> str:
        with self._lock:
            now = time.monotonic()
            if not self._token or now >= self._refresh_at:
                self._token = storage_token()
                # Azure CLI tokens commonly live for an hour. Refresh early so
                # a large corpus upload cannot cross the expiry boundary.
                self._refresh_at = now + (40 * 60)
            return self._token

    def invalidate(self, token: str) -> None:
        with self._lock:
            if self._token == token:
                self._token = ""
                self._refresh_at = 0.0


def upload_asset(
    storage_account: str,
    container: str,
    token_provider: StorageTokenProvider,
    record: dict[str, Any],
) -> None:
    blob_name = urllib.parse.quote(record["blob_name"], safe="/")
    body = record["source_path"].read_bytes()
    for attempt in range(1, 6):
        token = token_provider.get()
        request = urllib.request.Request(
            f"https://{storage_account}.blob.core.windows.net/{container}/{blob_name}",
            data=body,
            method="PUT",
            headers={
                "Authorization": f"Bearer {token}",
                "x-ms-version": "2023-11-03",
                "x-ms-blob-type": "BlockBlob",
                "Content-Type": record["media_type"],
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=180):
                return
        except urllib.error.HTTPError as error:
            if error.code == 401:
                token_provider.invalidate(token)
            if attempt == 5:
                raise
            time.sleep(min(60, attempt * attempt))
        except (urllib.error.URLError, TimeoutError):
            if attempt == 5:
                raise
            time.sleep(min(60, attempt * attempt))


def upload_asset_catalog(
    storage_account: str,
    container: str,
    catalog: dict[str, dict[str, Any]],
    workers: int,
) -> None:
    existing = existing_asset_names(storage_account, container)
    unique_blobs = {
        record["blob_name"]: record
        for record in catalog.values()
    }
    pending = [
        record
        for blob_name, record in unique_blobs.items()
        if blob_name not in existing
    ]
    print(
        json.dumps(
            {
                "catalog_asset_references": len(catalog),
                "catalog_assets": len(unique_blobs),
                "existing_assets": len(unique_blobs) - len(pending),
                "pending_assets": len(pending),
            },
            indent=2,
        )
    )
    if not pending:
        return
    token_provider = StorageTokenProvider()
    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(
                upload_asset,
                storage_account,
                container,
                token_provider,
                record,
            )
            for record in pending
        ]
        for future in concurrent.futures.as_completed(futures):
            future.result()
            completed += 1
            if completed % 1_000 == 0 or completed == len(pending):
                print(f"uploaded assets {completed}/{len(pending)}", flush=True)


def asset_records(
    image_paths: Iterable[str],
    asset_catalog: dict[str, dict[str, Any]],
    available: bool,
) -> list[dict[str, Any]]:
    records = []
    for relative in image_paths:
        registered = asset_catalog.get(relative)
        if registered is None:
            continue
        record = {
            key: value
            for key, value in registered.items()
            if key not in {"source_path", "blob_name"}
        }
        record["availability"] = "available" if available else "missing"
        records.append(record)
    return records


def load_verified_image_overrides(
    register_path: Path,
    corpus_root: Path,
    container: str,
    staging_dir: Path | None,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, dict[str, Any]]]:
    """Load curated figure links and optionally render/upload their page derivative.

    The source PDF remains local. Only a content-addressed PNG derivative enters
    Blob Storage, and its observed hash must match the frozen register.
    """
    if not register_path.is_file():
        raise FileNotFoundError(register_path)
    with register_path.open(encoding="utf-8") as handle:
        register = json.load(handle)

    overrides: dict[str, list[dict[str, Any]]] = {}
    upload_catalog: dict[str, dict[str, Any]] = {}
    controlled_prefix = f"azure-blob://{container}/manual-assets/legacy-rag/"
    for entry in register.get("assets", []):
        verification = entry.get("verification")
        if not isinstance(verification, dict) or not verification.get("source_pdf"):
            continue
        record_id = str(entry.get("record_id") or "").strip()
        source_reference = str(entry.get("source_reference") or "").strip()
        content_hash = str(entry.get("content_hash") or "").strip()
        media_type = str(entry.get("media_type") or "").strip()
        if (
            not record_id
            or record_id in overrides
            or not source_reference.startswith(controlled_prefix)
            or media_type != "image/png"
            or not content_hash.startswith("sha256:")
        ):
            raise ValueError(f"invalid verified image override for {record_id or 'unknown'}")
        digest = content_hash.removeprefix("sha256:")
        blob_name = source_reference.removeprefix(f"azure-blob://{container}/")
        if Path(blob_name).stem != digest:
            raise ValueError(f"verified image filename/hash mismatch for {record_id}")

        asset = {
            "asset_id": entry["asset_id"],
            "kind": "diagram",
            "source_reference": source_reference,
            "media_type": media_type,
            "page": entry["page"],
            "caption": entry["caption"],
            "content_hash": content_hash,
            "availability": "available",
            "verified": True,
            "register_id": entry["register_id"],
            "task_numbers": entry.get("task_numbers", []),
            "keywords": entry.get("keywords", []),
        }
        overrides[record_id] = [asset]

        if staging_dir is None:
            continue
        renderer = shutil.which("pdftoppm") or shutil.which("pdftoppm.exe")
        if not renderer:
            raise FileNotFoundError("pdftoppm is required to render verified figures")
        source_pdf = corpus_root / "pdfs_to_ingest" / Path(verification["source_pdf"])
        if not source_pdf.is_file():
            raise FileNotFoundError(source_pdf)
        source_page = int(verification["source_pdf_page"])
        render_dpi = int(verification.get("render_dpi", 150))
        if source_page < 1 or render_dpi < 72 or render_dpi > 600:
            raise ValueError(f"invalid render recipe for {record_id}")
        output_prefix = staging_dir / entry["register_id"]
        subprocess.run(
            [
                renderer,
                "-f",
                str(source_page),
                "-l",
                str(source_page),
                "-singlefile",
                "-r",
                str(render_dpi),
                "-png",
                str(source_pdf),
                str(output_prefix),
            ],
            check=True,
            capture_output=True,
        )
        rendered = output_prefix.with_suffix(".png")
        if sha256_file(rendered) != digest:
            raise ValueError(f"verified figure render hash mismatch for {record_id}")
        asset["size_bytes"] = rendered.stat().st_size
        upload_catalog[entry["register_id"]] = {
            **asset,
            "source_path": rendered,
            "blob_name": blob_name,
        }
    return overrides, upload_catalog


def document_actions(
    corpus_root: Path,
    shard_entries: Iterable[dict[str, Any]],
    args: argparse.Namespace,
    asset_catalog: dict[str, dict[str, Any]],
    verified_overrides: dict[str, list[dict[str, Any]]],
    collision_ids: set[str],
    collision_only: bool = False,
) -> Iterable[dict[str, Any]]:
    ingested_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for entry in shard_entries:
        shard_path = corpus_root / "rag_index" / Path(entry["file"])
        with shard_path.open(encoding="utf-8") as handle:
            shard = json.load(handle)
        document_key = sha256_bytes(
            f"{shard['manufacturer']}|{shard['aircraft']}|{shard['manual']}".encode()
        )
        for chunk_index, chunk in enumerate(shard["chunks"]):
            source_record_id = chunk["id"]
            if collision_only and source_record_id not in collision_ids:
                continue
            vector = chunk.get("embedding") or []
            if len(vector) != VECTOR_DIMENSIONS:
                raise ValueError(f"{chunk.get('id')} has {len(vector)} vector dimensions")
            text = chunk.get("text", "").strip()
            if not text:
                continue
            content_hash = sha256_bytes(text.encode())
            record_id = search_record_id(
                entry["id"], source_record_id, chunk_index, collision_ids
            )
            assets = asset_records(
                chunk.get("images", []),
                asset_catalog,
                args.apply and args.upload_assets,
            )
            for asset in assets:
                asset["page"] = chunk.get("page")
            if record_id in verified_overrides:
                assets = verified_overrides[record_id]
            source = chunk.get("source", "")
            yield {
                "@search.action": "mergeOrUpload",
                "id": record_id,
                "document_id": document_key,
                "content": text,
                "content_vector": vector,
                "source_class": "manual",
                "source_name": source,
                # The flattened section is stored directly in Search. Do not
                # invent a Blob reference or copy the much larger source PDF.
                "source_blob": None,
                "source_content_md5": None,
                "title": f"{shard['manual']} — {shard['chapter']} p.{chunk.get('page', 1)}",
                "aircraft_model": shard["aircraft"],
                "manual_type": manual_type(shard["manual"]),
                "ata": str(shard["ata_chapter"]) if shard.get("ata_chapter") is not None else None,
                "section": shard["chapter"],
                "revision": None,
                "effective_date": None,
                "content_hash": f"sha256:{content_hash}",
                "assets_json": json.dumps(assets, separators=(",", ":")),
                "lineage_state": (
                    "verified_image_override"
                    if record_id in verified_overrides
                    else "page_linked"
                    if assets
                    else "text_only"
                ),
                "ingested_at": ingested_at,
            }


def batches(items: Iterable[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    batch: list[dict[str, Any]] = []
    for item in items:
        batch.append(item)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def main() -> int:
    args = arguments()
    manifest_path = args.corpus_root / "rag_index" / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(manifest_path)
    if args.batch_size < 1 or args.batch_size > 1_000:
        raise ValueError("--batch-size must be between 1 and 1000")
    if args.asset_workers < 1 or args.asset_workers > 32:
        raise ValueError("--asset-workers must be between 1 and 32")
    if args.repair_collisions and not args.apply:
        raise ValueError("--repair-collisions requires --apply")

    with manifest_path.open(encoding="utf-8") as handle:
        manifest = json.load(handle)
    if manifest.get("model") != "all-MiniLM-L6-v2" or manifest.get("embedding_dim") != VECTOR_DIMENSIONS:
        raise ValueError("corpus embedding contract does not match all-MiniLM-L6-v2/384")

    shards = selected_shards(manifest, args.aircraft, args.shard, args.max_shards)
    if not shards:
        raise ValueError("selection contains no shards")
    planned_chunks = sum(int(item.get("chunk_count", 0)) for item in shards)
    chunk_id_counts = build_chunk_id_counts(
        args.corpus_root,
        manifest["shards"],
        args.asset_workers,
    )
    collision_ids = {
        record_id for record_id, count in chunk_id_counts.items() if count > 1
    }
    collision_occurrences = sum(chunk_id_counts[record_id] for record_id in collision_ids)
    print(
        json.dumps(
            {
                "canonical_chunk_ids": sum(chunk_id_counts.values()),
                "unique_source_chunk_ids": len(chunk_id_counts),
                "colliding_source_chunk_ids": len(collision_ids),
                "collision_occurrences": collision_occurrences,
                "collision_excess": collision_occurrences - len(collision_ids),
            },
            indent=2,
        )
    )
    print(
        json.dumps(
            {
                "mode": "apply" if args.apply else "dry-run",
                "target_index": args.target_index,
                "selected_shards": len(shards),
                "planned_chunks": planned_chunks,
                "aircraft": args.aircraft,
                "shard": args.shard,
                "upload_assets": bool(args.apply and args.upload_assets),
            },
            indent=2,
        )
    )
    asset_catalog = build_asset_catalog(
        args.corpus_root,
        shards,
        args.container,
        args.asset_workers,
    )
    staging = (
        tempfile.TemporaryDirectory(prefix="mxg-verified-figures-")
        if args.apply and args.upload_assets
        else None
    )
    verified_overrides, verified_asset_catalog = load_verified_image_overrides(
        args.verified_image_register,
        args.corpus_root,
        args.container,
        Path(staging.name) if staging else None,
    )
    unique_assets = {
        record["blob_name"]: record
        for record in [*asset_catalog.values(), *verified_asset_catalog.values()]
    }
    print(
        json.dumps(
            {
                "catalog_asset_references": len(asset_catalog),
                "catalog_assets": len(unique_assets),
                "catalog_asset_bytes": sum(
                    record["size_bytes"] for record in unique_assets.values()
                ),
            },
            indent=2,
        )
    )

    if not args.apply:
        validated = 0
        images = 0
        for action in document_actions(
            args.corpus_root,
            shards,
            args,
            asset_catalog,
            verified_overrides,
            collision_ids,
        ):
            validated += 1
            images += len(json.loads(action["assets_json"]))
        print(json.dumps({"validated_chunks": validated, "linked_images": images}, indent=2))
        return 0

    if args.upload_assets:
        upload_asset_catalog(
            args.storage_account,
            args.container,
            {**asset_catalog, **verified_asset_catalog},
            args.asset_workers,
        )

    search_key = os.environ.get("AZURE_SEARCH_ADMIN_KEY") or run_az(
        "search",
        "admin-key",
        "show",
        "--resource-group",
        args.resource_group,
        "--service-name",
        args.search_service,
        "--query",
        "primaryKey",
        "-o",
        "tsv",
    )
    search_request(
        args.search_service,
        search_key,
        "PUT",
        f"/indexes/{args.target_index}?api-version={API_VERSION}",
        index_definition(args.target_index),
    )

    if args.repair_collisions:
        delete_path = f"/indexes/{args.target_index}/docs/index?api-version={API_VERSION}"
        deleted = 0
        for batch in batches(
            (
                {"@search.action": "delete", "id": record_id}
                for record_id in sorted(collision_ids)
            ),
            args.batch_size,
        ):
            response = search_request(
                args.search_service,
                search_key,
                "POST",
                delete_path,
                {"value": batch},
            )
            failures = [item for item in response.get("value", []) if not item.get("status")]
            if failures:
                raise RuntimeError(
                    f"{len(failures)} collision deletes failed: {failures[:3]}"
                )
            deleted += len(batch)
        print(f"deleted {deleted} ambiguous source keys", flush=True)

    uploaded = 0
    upload_path = f"/indexes/{args.target_index}/docs/index?api-version={API_VERSION}"
    for batch in batches(
        document_actions(
            args.corpus_root,
            shards,
            args,
            asset_catalog,
            verified_overrides,
            collision_ids,
            collision_only=args.repair_collisions,
        ),
        args.batch_size,
    ):
        response = search_request(
            args.search_service,
            search_key,
            "POST",
            upload_path,
            {"value": batch},
        )
        failures = [item for item in response.get("value", []) if not item.get("status")]
        if failures:
            raise RuntimeError(f"{len(failures)} indexing actions failed: {failures[:3]}")
        uploaded += len(batch)
        if uploaded % 10_000 < len(batch) or uploaded == planned_chunks:
            print(f"uploaded {uploaded}/{planned_chunks}", flush=True)

    stats = search_request(
        args.search_service,
        search_key,
        "GET",
        f"/indexes/{args.target_index}/stats?api-version={API_VERSION}",
    )
    print(json.dumps({"uploaded": uploaded, "index_stats": stats}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
