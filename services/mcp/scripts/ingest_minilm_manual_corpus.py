#!/usr/bin/env python3
"""Idempotently promote the prebuilt MiniLM manual corpus into Azure AI Search.

Dry-run is the default. Azure is mutated only when --apply is supplied.
The existing source corpus and existing Search indexes are never modified.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import time
import urllib.error
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
    parser.add_argument("--target-index", default="manuals-authoritative-v2")
    parser.add_argument("--aircraft", help="Exact aircraft name for a bounded pilot")
    parser.add_argument("--shard", help="Exact shard ID for a surgical validation or retry")
    parser.add_argument("--max-shards", type=int)
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--upload-assets", action="store_true")
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
    attempts: int = 5,
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
        return {"name": field_name, "type": field_type, **options}

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
                dimensions=VECTOR_DIMENSIONS,
                vectorSearchProfile="manualHnswProfile",
            ),
            field("source_class", "Edm.String", filterable=True, facetable=True),
            field("source_name", "Edm.String", searchable=True, filterable=True),
            field("source_blob", "Edm.String", filterable=True),
            field("source_content_md5", "Edm.String", filterable=True),
            field("title", "Edm.String", searchable=True, filterable=True),
            field("aircraft_model", "Edm.String", searchable=True, filterable=True, facetable=True),
            field("manual_type", "Edm.String", filterable=True, facetable=True),
            field("ata", "Edm.String", filterable=True, facetable=True),
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


def asset_records(
    corpus_root: Path,
    image_paths: Iterable[str],
    container: str,
    upload_assets: bool,
    apply: bool,
    storage_account: str,
) -> list[dict[str, Any]]:
    records = []
    for relative in image_paths:
        source = corpus_root / "ingest_dumps" / Path(relative)
        if not source.is_file():
            continue
        digest = sha256_bytes(source.read_bytes())
        extension = source.suffix.lower()
        blob_name = f"manual-assets/legacy-rag/v2/{digest}{extension}"
        if apply and upload_assets:
            run_az(
                "storage",
                "blob",
                "upload",
                "--account-name",
                storage_account,
                "--container-name",
                container,
                "--name",
                blob_name,
                "--file",
                str(source),
                "--auth-mode",
                "login",
                "--overwrite",
                "true",
                "-o",
                "none",
                capture=False,
            )
        records.append(
            {
                "asset_id": digest[:32],
                "kind": "diagram",
                "source_reference": f"azure-blob://{container}/{blob_name}",
                "media_type": mimetypes.guess_type(source.name)[0],
                "page": None,
                "caption": f"Manual figure from {source.name}",
                "content_hash": f"sha256:{digest}",
                "availability": "available" if apply and upload_assets else "missing",
            }
        )
    return records


def document_actions(
    corpus_root: Path,
    shard_entries: Iterable[dict[str, Any]],
    args: argparse.Namespace,
) -> Iterable[dict[str, Any]]:
    ingested_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for entry in shard_entries:
        shard_path = corpus_root / "rag_index" / Path(entry["file"])
        with shard_path.open(encoding="utf-8") as handle:
            shard = json.load(handle)
        document_key = sha256_bytes(
            f"{shard['manufacturer']}|{shard['aircraft']}|{shard['manual']}".encode()
        )
        for chunk in shard["chunks"]:
            vector = chunk.get("embedding") or []
            if len(vector) != VECTOR_DIMENSIONS:
                raise ValueError(f"{chunk.get('id')} has {len(vector)} vector dimensions")
            text = chunk.get("text", "").strip()
            if not text:
                continue
            content_hash = sha256_bytes(text.encode())
            assets = asset_records(
                corpus_root,
                chunk.get("images", []),
                args.container,
                args.upload_assets,
                args.apply,
                args.storage_account,
            )
            for asset in assets:
                asset["page"] = chunk.get("page")
            source = chunk.get("source", "")
            yield {
                "@search.action": "mergeOrUpload",
                "id": chunk["id"],
                "document_id": document_key,
                "content": text,
                "content_vector": vector,
                "source_class": "manual",
                "source_name": source,
                "source_blob": f"{args.container}/manual-corpus-v2/{source}",
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
                "lineage_state": "page_linked" if assets else "text_only",
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
    if args.batch_size < 1 or args.batch_size > 250:
        raise ValueError("--batch-size must be between 1 and 250")

    with manifest_path.open(encoding="utf-8") as handle:
        manifest = json.load(handle)
    if manifest.get("model") != "all-MiniLM-L6-v2" or manifest.get("embedding_dim") != VECTOR_DIMENSIONS:
        raise ValueError("corpus embedding contract does not match all-MiniLM-L6-v2/384")

    shards = selected_shards(manifest, args.aircraft, args.shard, args.max_shards)
    if not shards:
        raise ValueError("selection contains no shards")
    planned_chunks = sum(int(item.get("chunk_count", 0)) for item in shards)
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

    if not args.apply:
        validated = 0
        images = 0
        for action in document_actions(args.corpus_root, shards, args):
            validated += 1
            images += len(json.loads(action["assets_json"]))
        print(json.dumps({"validated_chunks": validated, "linked_images": images}, indent=2))
        return 0

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

    uploaded = 0
    upload_path = f"/indexes/{args.target_index}/docs/index?api-version={API_VERSION}"
    for batch in batches(document_actions(args.corpus_root, shards, args), args.batch_size):
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
