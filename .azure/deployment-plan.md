# MXGenius Azure Deployment Plan

Status: In progress — corpus mounted; core cutover pending Azure control-plane recovery

## Objective

Mount the prebuilt 384-dimensional MiniLM maintenance-manual corpus behind the
existing typed MCP manual adapter without re-chunking or re-embedding its
1,060,418 records. Preserve the current GPT structured response and collapsed
33-reference frontend contract.

## Requirements

- Workspace mode: MODIFY an existing Azure production-pilot application.
- Classification: small, cost-conscious production pilot.
- Keep the current `mxg-core`, Search v1 index, GPT schema, and frontend live
  throughout the mount.
- Reuse the existing Search service, Storage account, Container Apps
  environment, registry, and Log Analytics workspace.
- Do not expose the manual corpus or embedding endpoint to browser code.
- Every promoted record must retain aircraft, manual, ATA, chapter, page,
  content hash, source locator, retrieval score, and page-linked image lineage.
- The reference appendix remains collapsed and returns up to 33 real matches.
  Match percentages represent retrieval similarity, never diagnostic
  probability.

## Azure Context

- Subscription: `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`).
- Tenant: `Hermetic Labs` (`bb1b06c5-1b43-4295-8c01-d7ffd3a5b366`).
- Region: `centralus`.
- Resource group: `mxg-rg-50106`.
- Existing Container Apps environment: `mxg-cae-50106`.
- Existing registry: `mxgacr50106.azurecr.io`.

## Components

| Component | Type | Technology | Path |
|---|---|---|---|
| Public application | Static frontend | HTML/CSS/JavaScript | repository root |
| Application/MCP core | API service | Rust/Axum | `services/mcp/server` |
| MiniLM embeddings | Internal API service | Python/FastAPI/ONNX | `services/manual-retrieval` |
| Corpus ingestion | Operator utility | Python/Azure REST | `services/mcp/scripts/ingest_minilm_manual_corpus.py` |

No Copilot SDK or other specialized hosting marker is present.

## Existing Data and Capacity

- Source corpus: 1,060,418 chunks, 106,967 shards, 91 aircraft families.
- Source vectors: `all-MiniLM-L6-v2`, 384 dimensions.
- Search service: Basic, one partition, created 2026-06-29.
- Search storage quota: 15 GiB; current use approximately 0.70 GiB.
- Search vector quota: 5 GiB; current use approximately 0.18 GiB.
- New vector raw size: approximately 1.52 GiB before HNSW overhead.
- Target index: `manuals-authoritative-v2`.
- Existing `manuals-authoritative-v1` remains unchanged as rollback.

## Architecture

```text
mxg-core
  -> internal authenticated MiniLM /v1/embeddings
  -> manuals-authoritative-v2 vector query
  -> typed Evidence records
  -> existing GPT structured response
  -> existing collapsed 33-reference appendix
```

The embedding service contains no manuals and performs no retrieval. It only
maps bounded query text into the same vector space already stored in v2.

## Deployment Recipe

Use the existing Azure CLI and Container Apps path.

Rationale:

- The resource group, environment, registry, Search service, and deployment
  conventions already exist.
- Only one small internal API is added.
- No new platform, framework migration, database, or public frontend deployment
  is required.

## Resources and Changes

- Create one Container App: `mxg-manual-embeddings`.
- Create one versioned Search index: `manuals-authoritative-v2`.
- Upload hashed manual figures under
  `documents/manual-assets/legacy-rag/v2/`.
- Upload the immutable compressed corpus artifact under
  `documents/manual-corpus-v2/`.
- Add Container App secrets for the embedding-service shared credential.
- After validation, update only these `mxg-core` settings:
  - `AZURE_SEARCH_INDEX`
  - `MXGENIUS_EMBEDDINGS_ENDPOINT`
  - `MXGENIUS_EMBEDDINGS_MODEL`
  - `MXGENIUS_EMBEDDINGS_AUTH`
  - `MXGENIUS_EMBEDDINGS_API_KEY`

No existing resource is deleted, replaced, or scaled up.

## Security

- The embedding endpoint requires server-side authentication.
- No provider credential or manual content enters Git or GitHub Pages.
- Manual images remain private and flow through the existing controlled proxy.
- The new Container App is restricted to the application service boundary where
  supported by the existing environment.
- Production continues to fail closed when retrieval or embedding is
  unavailable.
- Microsoft Entra user sign-in remains a separate following workstream.

## Policy and Provisioning

- No blocking subscription policy assignments were returned.
- Planned new resources: one CPU-only Container App and one Search index.
- Existing Basic Search capacity is sufficient for the 384-dimensional corpus;
  the full ingestion must stop automatically on quota or indexing failures.
- No quota increase or expensive Search tier change is planned.

## Deployment Stages

1. Validate the OpenAI-compatible MiniLM API locally.
2. Create v2 and upload a two-record CL350 image-bearing shard.
3. Prove MiniLM query-vector compatibility against v2.
4. Validate and deploy `mxg-manual-embeddings`.
5. Ingest one complete aircraft family and run known-query comparisons.
6. Upload the immutable corpus archive and hashed image assets.
7. Ingest the full corpus with idempotent merge-or-upload batches.
8. Verify counts, quota, latency, source hashes, images, and degraded behavior.
9. Update the five `mxg-core` settings and deploy a new revision.
10. Smoke-test the complete GPT → 33 references → images path.

## Validation Gates

- Python compilation and embedding-service unit tests pass.
- Docker image builds and `/healthz` succeeds.
- The embedding endpoint returns exactly 384 values and rejects missing auth.
- The pilot shard is returned by a real vector query in expected rank order.
- An aircraft-family pilot returns 33 references with valid scores and images.
- Full ingestion document and vector metrics remain below Azure quotas.
- GPT produces the strict schema using only supplied `M-##` citations.
- `/adapterz` reports actual manual-adapter health instead of its current
  hard-coded state.
- Existing v1 retrieval remains available until the final cutover succeeds.

### Validation steps

- `python -m py_compile` for the embedding and ingestion utilities.
- Python unit tests for authentication and OpenAI-compatible response shape.
- `docker build` for the embedding service.
- Two-record Azure Search v2 pilot query using MiniLM vectors.
- Container App health, readiness, and authenticated embedding smoke tests.
- Search document/vector counts, quota, and 33-reference GPT smoke test before
  any production setting change.

## Rollback

Restore the five previous `mxg-core` environment settings and activate the
previous Container App revision. The v1 index and frontend are never modified
by corpus ingestion. The new embedding service and v2 index may remain dormant;
deletion is not part of this plan.

## Functional Verification

- Local embedding-service contract: passed.
- Two-record CL350 ingestion: passed.
- Real MiniLM vector query against v2: passed.
- Full service/container/corpus/GPT verification: corpus ingestion complete for CL350; service/core cutover pending.

## Validation Proof

- 2026-07-23: `python -m py_compile` passed for the embedding and ingestion
  utilities.
- 2026-07-23: Python embedding-service unit tests passed (2/2).
- 2026-07-23: ACR remote build succeeded for `mxgenius/manual-embeddings:pilot`.
- 2026-07-23: `manuals-authoritative-v2` CL350 pilot ingestion completed: 17,329 chunks uploaded with linked asset uploads; Search reported 16,600 documents while indexing was still converging.
- 2026-07-23: Container App `mxg-manual-embeddings` provisioned successfully with internal ingress and one active replica.
- 2026-07-23: Rust formatting and workspace tests passed (54 tests).
- 2026-07-23: Frontend structure/client/realtime tests passed (37 tests).
- 2026-07-23: The CL350 two-record v2 pilot was uploaded and queried using the
  real MiniLM model; both records ranked correctly and the second carried two
  image assets.
- 2026-07-23: ACR remote build `cjs` succeeded with digest
  `sha256:a29296f2beb3a7ed8ea93252bec0afdd40a54170cf98880b290804444d62a4f7`.
- 2026-07-23: Local Docker build was unavailable because Docker is not installed;
  Azure Container Registry supplied the authoritative image build proof.

## Execution Checklist

- [x] Audit repository, live GPT path, corpus format, and Azure capacity.
- [x] Implement and unit-test the MiniLM embedding API.
- [x] Implement the dry-run-first v2 ingestion utility.
- [x] Prove two records and two images in v2.
- [x] Prove real 384-dimensional query compatibility.
- [x] Validate the deployment artifacts.
- [x] Provision the embedding service Container App (secret/core cutover pending).
- [ ] Run the complete-aircraft pilot.
- [ ] Ingest and verify the full corpus.
- [ ] Cut over `mxg-core` and run end-to-end acceptance.

## Approval

Approved by the user on 2026-07-23 after review of the subscription, region,
resource scope, rollback, and validation plan.
