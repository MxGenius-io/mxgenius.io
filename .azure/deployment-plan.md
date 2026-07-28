# MXGenius Azure Deployment Plan

Status: Validated

## Closed-Beta Invitation Baseline Delta — 2026-07-28

This release preserves the existing real-time Settings invitation flow and adds
`@mxgenius.io` plus `rocky@mxgenius.io` as protected organization-scoped access
rules. Exact email entries continue to request an Entra B2B invitation through
Microsoft Graph before the access rule is committed. Domain rules authorize
matching, successfully authenticated identities and do not attempt to invite an
entire domain.

### Deployment scope

- Build the existing `services/mcp` Container App image from the exact committed
  source archive.
- Promote only `mxg-core`; no database migration, frontend behavior change,
  secret, or new Azure resource is required.
- Preserve the current environment settings and system-assigned managed
  identity.
- Keep the current ready revision available for rollback.

### Validation proof

- 2026-07-28: frontend application suite passed, 80/80 tests.
- 2026-07-28: Rust workspace suite passed, 70/70 tests.
- 2026-07-28: `cargo fmt --all -- --check` and strict workspace clippy passed.
- 2026-07-28: locked optimized workspace release build passed.
- 2026-07-28: `git diff --check` passed.
- 2026-07-28: ACR provisioning state is `Succeeded`.
- 2026-07-28: `mxg-core` provisioning state is `Succeeded`, running status is
  `Running`, and revision `mxg-core--0000015` remains ready.
- 2026-07-28: production health and readiness endpoints returned HTTP 200.
- 2026-07-28: the `mxg-core` system identity
  `f690814f-1f55-4394-adaa-8120d5d433c7` was confirmed to hold Microsoft Graph
  application permission `User.Invite.All`.

### Rollback

Shift traffic to `mxg-core--0000015`. The new baseline rule is inserted
idempotently when Settings reads the organization access list; rollback does
not delete existing rules or guest identities.

## Rocky Parts Release Delta — 2026-07-28

This release closes the Rocky parts vertical slice on the existing application
plane. The user authorized top-to-bottom execution on 2026-07-28 and asked that
work stop only for a genuine credential blocker. Azure CLI authentication,
subscription selection, Container Apps access, ACR access, and GitHub access
have been verified. No credential blocker is present.

### Scope

- Deploy the current static frontend with passive landing-page session
  detection and the production Parts workspace.
- Deploy a new `mxg-core` image containing migration
  `0015_parts_inventory.sql` and the authenticated Parts API.
- Enable the backend with `MXGENIUS_PARTS_ENABLED=true` only in the promoted
  revision.
- Reuse the existing private `documents` Blob container and store Parts assets
  below `documents/parts/{organization}/{draft}/{asset}`.
- Create one Azure AI Document Intelligence account in `centralus`, using the
  available free `F0` SKU, for proposed OCR metadata.
- Grant the existing `mxg-core` system-managed identity:
  - `Storage Blob Data Contributor`, scoped only to the existing private
    `documents` container; and
  - `Cognitive Services User`, scoped only to the new Document Intelligence
    account.
- Configure only the non-secret Document Intelligence endpoint and Blob origin
  on `mxg-core`. Blob and OCR calls use managed identity; no new long-lived SAS
  or service key is introduced.

### Safety and data boundaries

- The migration is additive and tenant-scoped. The server applies SQLx
  migrations before accepting traffic.
- Catalog definitions remain separate from serialized stock units.
- Uploaded assets remain private and flow only through the authenticated
  application API.
- OCR output is a proposal. A human must accept, edit, or reject candidates
  before the signed receiving confirmation.
- FAA results preserve explicit source and identifier states and never imply
  airworthiness.
- QR labels contain only the stable public unit route, never Blob references,
  tokens, or sensitive metadata.
- Parts endpoints return `404 PARTS_NOT_ENABLED` unless the release flag is on.

### Validation gates

- Complete JavaScript and Rust suites pass.
- The non-interactive Rocky gate probe passes gates 0–7 locally.
- `cargo build --locked --release -p mxgenius-mcp`, formatting, clippy, and
  `git diff --check` pass against the exact release tree.
- The free Document Intelligence SKU remains available in `centralus`.
- ACR builds the exact backend source state and the new Container App revision
  becomes ready before traffic is accepted.
- Migration `0015` is present in the promoted image and the ready endpoint
  remains healthy after startup.
- Live unauthenticated probes prove the frontend, health, readiness, and
  fail-closed Parts boundary.
- Final whitelisted-user acceptance proves upload, OCR review, signed receive,
  unit detail, private asset retrieval, QR label, history, and the FAA
  no-result/error distinctions.

### Rollback

- Keep the current ready `mxg-core` revision available.
- Disable `MXGENIUS_PARTS_ENABLED` or shift traffic to the prior revision if a
  smoke gate fails.
- The additive tables may remain dormant; rollback does not delete inventory,
  Blob data, role assignments, or the OCR account.
- Revert the static frontend to the preceding GitHub Pages commit if its paired
  deployment gate fails.

### Local proof

- 2026-07-28: complete frontend/application suite passed (80 tests).
- 2026-07-28: complete Rust workspace suite passed (69 tests).
- 2026-07-28: Rocky local gate probe passed all 9 checks through gate 7.
- 2026-07-28: `FormRecognizer` F0 and S0 SKUs were confirmed available in
  `centralus`.
- 2026-07-28: the existing `documents` container was confirmed private and the
  current core identity was confirmed to have no pre-existing storage role.
- 2026-07-28: locked formatting, strict clippy, complete tests, and the optimized
  `mxgenius-mcp` release build passed against the exact release tree.
- 2026-07-28: `git diff --check` passed and the signed-in Azure principal was
  confirmed as subscription Owner with role-assignment authority.
- 2026-07-28: ACR run `cj1e` built commit `66114b2` as
  `mxg-core:rocky-parts-66114b2` with digest
  `sha256:2a7b59e32094ece0b9015eb11ccb7bc3e58a7f47b08c8a21b1f4946dce503da8`.
- 2026-07-28: Container App revision `mxg-core--0000015` became the latest
  ready revision with the Parts feature flag, private Blob origin, and
  Document Intelligence endpoint configured.
- 2026-07-28: production `/healthz` and `/readyz` returned `200`; readiness
  reported the database ready in production mode after the startup migration
  step.
- 2026-07-28: unauthenticated Parts access failed closed with `401`, the
  deployed dashboard exposed the Parts bundle, and GitHub Pages completed
  successfully at commit `66114b2`.
- 2026-07-28: Rocky's Entra B2B invitation was sent to `hagy2392@gmail.com` and
  is pending acceptance. The final authenticated receiving/OCR/QR/FAA pass
  remains the only acceptance gate.

## Field-Test Release Delta — 2026-07-27

Release baseline: `9cbd9d4`; Realtime companion release is the next local commit.

This validation pass is limited to updating the existing `mxg-core` Container
App and the existing static frontend. It adds:

- a server-enforced GPT-5.6 Luna/Terra/Sol and GPT-5.5 selector for text and
  structured responses, defaulting to Luna;
- the existing strict structured-output and read-only MCP function
  orchestration across all selectable text models;
- persistence of completed Realtime exchanges into tenant/user-scoped chat
  threads; and
- a single authoritative Realtime companion turn that renders structured chat,
  citations, manual images, tables, and UI actions while returning only a
  concise summary to the voice model;
- bounded awareness of the active case, visible Market Intelligence, digital
  twin selection/highlight, and prior displayed response for conversational
  references; and
- frontend cache-version updates for the new selector, persistence client, and
  Realtime companion.

No database migration, Azure resource, identity, secret, ingress, search index,
or Realtime model change is included in this release.

### Field-Test Validation Proof — 2026-07-27

- JavaScript syntax checks passed for `app.js`, `application-client.js`, and
  `case-workspace.js`.
- The complete frontend suite passed: 55/55 tests.
- Rust formatting and strict clippy checks passed.
- The complete Rust workspace suite passed: 66/66 tests.
- `cargo build --locked --release -p mxgenius-mcp` completed successfully.
- `git diff --check` passed.
- No migration differs from the deployed `0608040` baseline.
- Live public health and readiness checks passed against the current core.
- Live Gulfstream G650 Market Intelligence probes returned operation-cost and
  performance data; the unavailable trends subscription is now represented as
  a visible partial result instead of being silently swallowed.
- Live fleet lookup returned 4,437 aircraft through the existing compatibility
  source.
- Static frontend and Container App promotion remain a paired deployment gate.

The existing `mxg-core` revision must retain or receive these non-secret fleet
proxy adapter settings so Active Case aircraft resolution uses the already-live
server-side compatibility source:

- `MXGENIUS_JETNET_BASE_URL=https://mxg-fleet.kindbush-8fee3a17.centralus.azurecontainerapps.io/api/`
- `MXGENIUS_JETNET_API_TOKEN=LIVE_TOKEN`
- `MXGENIUS_JETNET_BEARER_TOKEN=proxy`

### Field-Test Validation Gates

- The exact `services/mcp` archive expands with `Dockerfile`, locked Rust
  dependencies, migrations, fixtures, shared crate, and server crate at its
  root.
- `cargo build --locked --release`, formatting, clippy, and all Rust tests pass.
- JavaScript syntax checks and the complete frontend test suite pass.
- No deployed migration file changed relative to commit `0608040`.
- The text-model allowlist contains only models supporting Responses, function
  calling, structured output, image input, and the configured reasoning level.
- Text and Realtime exchanges both create or continue the same authenticated
  thread and become available to later conversational memory.
- Market Intelligence retains live compatibility-source routing, bounded cache
  behavior, and explicit loading, empty, and provider-error states.
- Active Case selection binds text chat, Realtime persistence, capability
  context, and optimistic case versioning to the same canonical case.
- The static frontend commit and Container App image are promoted together.
- Existing revision `mxg-core--0000009` remains available for rollback until
  field-test smoke checks pass.

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
