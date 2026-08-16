#!/usr/bin/env python3
"""Read-only reconciliation of the frozen manual pack against Azure AI Search."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


API_VERSION = "2024-07-01"
DEFAULT_MANIFEST = (
    Path(__file__).resolve().parents[1]
    / "config"
    / "authoritative-manual-pack-v1.json"
)
SOURCE_ROOT = "Bombardier Manuals/CL350/"


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare the frozen manual pack with Azure AI Search without mutating Azure."
    )
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--resource-group", default="mxg-rg-50106")
    parser.add_argument("--search-service")
    parser.add_argument("--index")
    return parser.parse_args()


def run_az(*args: str) -> str:
    executable = shutil.which("az") or shutil.which("az.cmd")
    if not executable:
        raise FileNotFoundError("Azure CLI executable was not found on PATH")
    last_error: subprocess.CalledProcessError | None = None
    for attempt in range(1, 5):
        try:
            completed = subprocess.run(
                [executable, *args, "--only-show-errors"],
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            return completed.stdout.strip()
        except subprocess.CalledProcessError as error:
            last_error = error
            if attempt < 4:
                time.sleep(attempt)
    assert last_error is not None
    raise last_error


def search_request(
    service: str,
    key: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
    request = urllib.request.Request(
        f"https://{service}.search.windows.net{path}",
        data=body,
        method=method,
        headers={
            "api-key": key,
            "Accept": "application/json",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    last_error: Exception | None = None
    for attempt in range(1, 5):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                content = response.read()
                return json.loads(content) if content else {}
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt < 4:
                time.sleep(attempt)
    assert last_error is not None
    raise last_error


def hash_lines(lines: Iterable[str]) -> str:
    joined = "\n".join(sorted(lines))
    return f"sha256:{hashlib.sha256(joined.encode()).hexdigest()}"


def fetch_all_documents(service: str, key: str, index: str) -> list[dict[str, Any]]:
    documents: list[dict[str, Any]] = []
    while True:
        payload = search_request(
            service,
            key,
            "POST",
            f"/indexes/{index}/docs/search?api-version={API_VERSION}",
            {
                "search": "*",
                "top": 1000,
                "skip": len(documents),
                "count": True,
                "select": (
                    "id,document_id,source_name,source_blob,aircraft_model,manual_type,"
                    "revision,effective_date,content_hash,assets_json,lineage_state"
                ),
            },
        )
        page = payload.get("value", [])
        documents.extend(page)
        if len(page) < 1000:
            expected = payload.get("@odata.count")
            if expected is not None and expected != len(documents):
                raise ValueError(
                    f"Azure Search returned {len(documents)} of {expected} expected records"
                )
            return documents


def parse_assets(document: dict[str, Any]) -> list[dict[str, Any]]:
    value = document.get("assets_json")
    if not value:
        return []
    parsed = json.loads(value)
    if not isinstance(parsed, list):
        raise ValueError(f"assets_json is not an array for Search record {document.get('id')}")
    return parsed


def family_name(source_name: str) -> str:
    tail = source_name.removeprefix(SOURCE_ROOT)
    return tail.split("/", 1)[0]


def selected_rows(
    documents: list[dict[str, Any]], manual: dict[str, Any]
) -> list[dict[str, Any]]:
    prefixes = tuple(manual["source_prefixes"])
    return [
        document
        for document in documents
        if str(document.get("source_name") or "").startswith(prefixes)
    ]


def compare(label: str, expected: Any, actual: Any, failures: list[dict[str, Any]]) -> None:
    if expected != actual:
        failures.append({"field": label, "expected": expected, "actual": actual})


def reconcile(
    manifest: dict[str, Any],
    schema: dict[str, Any],
    documents: list[dict[str, Any]],
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    vector_field = manifest["index_contract"]["vector_field"]
    vector_schema = next(
        (field for field in schema.get("fields", []) if field.get("name") == vector_field),
        None,
    )
    compare(
        "index.vector_dimensions",
        manifest["index_contract"]["vector_dimensions"],
        None if vector_schema is None else vector_schema.get("dimensions"),
        failures,
    )

    selected_ids: set[str] = set()
    observed_manuals: list[dict[str, Any]] = []
    observed_assets: dict[str, dict[str, Any]] = {}
    for manual in manifest["manuals"]:
        rows = selected_rows(documents, manual)
        row_ids = {str(row["id"]) for row in rows}
        overlap = selected_ids.intersection(row_ids)
        if overlap:
            failures.append(
                {
                    "field": f"manuals.{manual['manual_id']}.overlap",
                    "expected": [],
                    "actual": sorted(overlap),
                }
            )
        selected_ids.update(row_ids)
        assets: dict[str, dict[str, Any]] = {}
        for row in rows:
            for asset in parse_assets(row):
                reference = str(asset.get("source_reference") or "")
                if reference:
                    assets[reference] = asset
                    observed_assets[reference] = asset

        actual = {
            "manual_id": manual["manual_id"],
            "chunk_count": len(rows),
            "source_section_count": len({row.get("source_name") for row in rows}),
            "document_ids": sorted({str(row.get("document_id")) for row in rows}),
            "aircraft_models": sorted({str(row.get("aircraft_model")) for row in rows}),
            "manual_types": sorted({str(row.get("manual_type")) for row in rows}),
            "content_set_hash": hash_lines(
                f"{row['id']}|{row['content_hash']}" for row in rows
            ),
            "missing_revision_chunks": sum(not row.get("revision") for row in rows),
            "missing_effective_date_chunks": sum(
                not row.get("effective_date") for row in rows
            ),
            "page_linked_chunk_count": sum(
                row.get("lineage_state") == "page_linked" for row in rows
            ),
            "asset_reference_count": len(assets),
            "asset_reference_set_hash": hash_lines(assets),
        }
        observed_manuals.append(actual)
        compare(
            f"manuals.{manual['manual_id']}.chunk_count",
            manual["chunk_count"],
            actual["chunk_count"],
            failures,
        )
        compare(
            f"manuals.{manual['manual_id']}.source_section_count",
            manual["source_section_count"],
            actual["source_section_count"],
            failures,
        )
        compare(
            f"manuals.{manual['manual_id']}.document_ids",
            sorted(manual["document_ids"]),
            actual["document_ids"],
            failures,
        )
        compare(
            f"manuals.{manual['manual_id']}.aircraft_models",
            sorted(manual["aircraft_models"]),
            actual["aircraft_models"],
            failures,
        )
        compare(
            f"manuals.{manual['manual_id']}.manual_type",
            [manual["manual_type"]],
            actual["manual_types"],
            failures,
        )
        compare(
            f"manuals.{manual['manual_id']}.content_set_hash",
            manual["content_set_hash"],
            actual["content_set_hash"],
            failures,
        )
        compare(
            f"manuals.{manual['manual_id']}.page_linked_chunk_count",
            manual["page_linked_chunk_count"],
            actual["page_linked_chunk_count"],
            failures,
        )
        compare(
            f"manuals.{manual['manual_id']}.asset_reference_count",
            manual["asset_reference_count"],
            actual["asset_reference_count"],
            failures,
        )
        compare(
            f"manuals.{manual['manual_id']}.asset_reference_set_hash",
            manual["asset_reference_set_hash"],
            actual["asset_reference_set_hash"],
            failures,
        )
        if manual["currency_state"] == "unverified":
            compare(
                f"manuals.{manual['manual_id']}.missing_revision_chunks",
                len(rows),
                actual["missing_revision_chunks"],
                failures,
            )
            compare(
                f"manuals.{manual['manual_id']}.missing_effective_date_chunks",
                len(rows),
                actual["missing_effective_date_chunks"],
                failures,
            )

    selected = [document for document in documents if str(document["id"]) in selected_ids]
    excluded = [document for document in documents if str(document["id"]) not in selected_ids]
    excluded_families = Counter(
        family_name(str(document.get("source_name") or "")) for document in excluded
    )
    expected_excluded = {
        item["name"]: item["chunk_count"]
        for item in manifest["excluded_sources"]["families"]
    }
    compare(
        "integrity.chunk_count",
        manifest["integrity"]["chunk_count"],
        len(selected),
        failures,
    )
    compare(
        "integrity.logical_manual_count",
        manifest["integrity"]["logical_manual_count"],
        len(manifest["manuals"]),
        failures,
    )
    compare(
        "integrity.search_document_count",
        manifest["integrity"]["search_document_count"],
        len({document["document_id"] for document in selected}),
        failures,
    )
    compare(
        "integrity.content_set_hash",
        manifest["integrity"]["content_set_hash"],
        hash_lines(f"{row['id']}|{row['content_hash']}" for row in selected),
        failures,
    )
    compare(
        "excluded_sources.chunk_count",
        manifest["excluded_sources"]["chunk_count"],
        len(excluded),
        failures,
    )
    compare(
        "excluded_sources.families",
        expected_excluded,
        dict(sorted(excluded_families.items())),
        failures,
    )

    expected_assets = {
        asset["source_reference"]: asset for asset in manifest.get("assets", [])
    }
    compare(
        "assets.references",
        sorted(expected_assets),
        sorted(observed_assets),
        failures,
    )
    for reference, expected in expected_assets.items():
        actual = observed_assets.get(reference, {})
        compare(
            f"assets.{reference}.content_hash",
            expected["content_hash"],
            actual.get("content_hash"),
            failures,
        )
        compare(
            f"assets.{reference}.media_type",
            expected["media_type"],
            actual.get("media_type"),
            failures,
        )
        compare(
            f"assets.{reference}.availability",
            "available",
            actual.get("availability"),
            failures,
        )

    return {
        "status": "matched" if not failures else "mismatch",
        "pack_id": manifest["pack_id"],
        "index": schema.get("name"),
        "observed_index_chunks": len(documents),
        "approved_pack_chunks": len(selected),
        "approved_logical_manuals": len(manifest["manuals"]),
        "approved_search_documents": len(
            {document["document_id"] for document in selected}
        ),
        "approved_image_assets": len(observed_assets),
        "excluded_chunks": len(excluded),
        "currency_state": manifest["currency_policy"]["state"],
        "manuals": observed_manuals,
        "excluded_families": dict(sorted(excluded_families.items())),
        "failures": failures,
    }


def main() -> int:
    args = arguments()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    contract = manifest["index_contract"]
    service = args.search_service or contract["search_service"]
    index = args.index or contract["index_name"]
    if index != contract["index_name"]:
        raise ValueError(
            f"requested index {index!r} does not match frozen index {contract['index_name']!r}"
        )
    key = os.environ.get("AZURE_SEARCH_ADMIN_KEY") or run_az(
        "search",
        "admin-key",
        "show",
        "--resource-group",
        args.resource_group,
        "--service-name",
        service,
        "--query",
        "primaryKey",
        "--output",
        "tsv",
    )
    schema = search_request(
        service,
        key,
        "GET",
        f"/indexes/{index}?api-version={API_VERSION}",
    )
    documents = fetch_all_documents(service, key, index)
    result = reconcile(manifest, schema, documents)
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "matched" else 1


if __name__ == "__main__":
    sys.exit(main())
