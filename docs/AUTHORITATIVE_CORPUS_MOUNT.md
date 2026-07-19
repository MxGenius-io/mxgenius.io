# Authoritative corpus mount

## Purpose

Mount the existing manual and regulatory data behind the typed MCP adapters without treating flattened text, training material, or browser bundles as authoritative records by themselves.

## Located source paths

### Existing operational pipeline

- `D:\AAog\mxgenius-cloud-poc\backend\src\upload.rs` uploads source documents to Azure Blob Storage and records document metadata.
- `D:\AAog\mxgenius-cloud-poc\backend\src\ingest.rs` downloads a source blob, flattens text, creates approximately 3,000-character chunks, embeds them, and writes them to Azure AI Search index `manuals-index`.
- `D:\AAog\mxgenius-cloud-poc\backend\src\chat.rs` embeds a query and retrieves matching chunks from `manuals-index`.

This is the production-source starting point. Its current chunks are retrieval artifacts, not the canonical document/revision records.

### Existing offline/manual bundle design

- `D:\AAog\MxGenius-Main\jetnet-simulator\scripts\build_rag_bundle.py` describes the earlier flattened manual export.
- It extracts aircraft, ATA chapter, section, manual type, source filename, chunk text, page-linked images, and a keyword index.
- Its original `ingest_dumps` source and generated `rag_knowledge.json` are not present in the checked-in application tree. Production mounting must inventory the Azure index and source Blob container rather than assume those local artifacts are complete.

### Training/reference corpus

- `D:\AAog\mxgenius-training\data\processed` contains FAA question/answer and NTSB/AviationQA-derived training material.
- `D:\AAog\mxgenius\mxgenius-landing-full\Training Data` contains AviationQA and maintenance-data research material.

These sources may support evaluation, search testing, or clearly labeled general-reference responses. They must not be presented as a current OEM maintenance manual, approved technical instruction, AD applicability determination, or return-to-service basis.

## Live Azure inventory — 2026-07-19

- Search service: `mxg-search-50106` in `centralus`.
- `manuals-index`: 14,691 chunks, 999 unique document IDs, 364,730,836 bytes, 1,536-dimension vectors, profile `myHnswProfile`.
- Current fields: `id`, `document_id`, `content`, `content_vector` only.
- Blob container `documents`: 1,666 source blobs, 74,781,685 bytes.
- Blob classification by filename: 976 flattened manual extracts, 642 NTSB records, 36 FAA training files, and 12 other files.
- Every indexed document ID resolves to a Blob source. 667 Blob sources are not indexed.
- Indexed coverage: 814 flattened manual extracts, 176 NTSB records, 6 FAA training files, and 3 other files.
- `vaultmx-records`: separate 373-record vector index with prompt/resolution/source fields.

### Versioned manual target

- `manuals-authoritative-v1`: 14,506 unique chunks from 814 indexed manual source documents.
- The original `manuals-index` remains unchanged.
- Every promoted record retains the original vector, chunk ID, source document ID, source Blob reference, source MD5, chunk SHA-256, ingestion timestamp, and explicit `source_class=manual`.
- Pagination is stable on `id asc`; merge-or-upload makes reruns idempotent.
- A live smoke query completed through OpenAI embeddings, Azure vector search, and the typed `ManualCorpusAdapter`.
- The adapter over-fetches and deduplicates byte-identical excerpts by content hash before returning evidence.

### Text and diagram lineage

The legacy diagram filenames are not arbitrary UI assets. `build_rag_bundle.py` creates stable ten-character MD5 filenames from each image path relative to the original `ingest_dumps` tree, then correlates images to manual chapter/page records. The checked-in `rag_image_map.json` contains 354 image references across 266 title keys.

The old map omits the source document ID. Joining only on title is unsafe because mapped titles occur in multiple source documents. The source-relative hash convention was reproduced against the recovered sanitized ingest tree and all 354 referenced binaries matched with zero missing files and zero collisions.

- All 354 verified binaries are stored under `documents/manual-assets/legacy-rag/` in the controlled Azure storage account.
- 1,365 Search chunks with a unique source-document/title relationship now reference 270 exact assets using stable `azure-blob://` references, SHA-256 hashes, and `availability=available`.
- 46 repeated lineage keys remain quarantined because title alone cannot identify the correct aircraft/manual source.
- The 162 classified manual blobs not present in the source index remain a separate, deferred backfill.

Never resolve an ambiguous title by attaching the same diagram to every matching manual. Resolve the remaining joins from durable document/manual identity, then promote them through the same hashed-asset process. The restore and promotion scripts default to audit-only behavior; Search mutation requires an explicit `-Apply`.

The existing `manuals-index` is operationally searchable but not an authoritative manual index because it mixes manuals, NTSB material, training content, and other sources without a classification field. The production adapter therefore fails closed unless `MXGENIUS_MANUAL_SEARCH_FILTER` is configured. Do not configure a permissive filter against the current schema.

The database metadata join could not be run from the development workstation because the PostgreSQL firewall correctly rejected the direct connection. Do not widen that perimeter for convenience; perform the join from the application network or a controlled migration job.

## Canonical mapping

Each indexed excerpt must resolve to a durable source record with:

- tenant and access scope;
- document identifier and source blob/version identifier;
- title, manufacturer, aircraft applicability, manual type, ATA chapter, section, and task reference when known;
- revision number/date, effective date, ingestion timestamp, and currency state;
- page or source locator and linked figure identifiers;
- exact excerpt text and content hash;
- retrieval score and normalized confidence;
- authoritative-source URL or storage reference;
- supersession, conflict, and unavailable/partial warnings.

Missing revision or applicability fields stay unknown. They are never inferred from a filename or retrieval score.

## Mount sequence

1. Inventory the configured Blob container and `manuals-index`: counts, schema, source-document coverage, duplicate chunks, orphan chunks, metadata completeness, and revision fields.
2. Preserve the existing source blobs. Do not re-chunk or overwrite the current index during discovery.
3. Implement a read-only Azure AI Search `ManualCorpusAdapter` and normalize results into typed document/evidence contracts. Completed for the versioned manual target.
4. Create a versioned authoritative index rather than overwriting `manuals-index`. Completed for `manuals-authoritative-v1`; missing applicability, revision, and currency metadata remains explicitly unknown.
5. Filter the production manual adapter to authoritative manual records. Preserve NTSB, training, and `vaultmx-records` material for separately typed adapters or evaluation use.
6. Resolve each chunk to its source document and revision metadata. Emit explicit currency warnings where the source cannot prove currency.
7. Add a versioned ingestion path that hashes sources and chunks, supports idempotent re-indexing, and retains superseded revisions.
8. Keep bundled fixtures available only in explicit insecure-local mode.
9. Use the training/reference corpus only in evaluation fixtures or as separately labeled non-authoritative context.
10. Restore the original image corpus and source-relative lineage, upload it to controlled storage, and resolve visual evidence by source document ID plus page—not title alone. Exact asset restoration and the uniquely joined subset are complete; 46 repeated lineage keys remain quarantined.
11. Backfill the 162 classified manual blobs that are not present in the mixed source index through the versioned ingestion path.

## Acceptance rail

- A case brief can cite the exact source document, revision/currency state, locator, excerpt hash, retrieval trace, and ingestion timestamp.
- A missing or stale source produces a partial/unavailable result instead of a fabricated procedure.
- No browser asset or local training bundle is required for production retrieval.
- Re-indexing is idempotent and never silently replaces the evidence behind an existing case event.
