# MXGenius Azure Deployment Plan

Status: Deployed — 2026-08-22 Feedback and Parts Expansion

## Feedback and Parts Expansion Delta — 2026-08-22

### Project overview and approval

- **Goal:** publish Rocky's in-app feedback/reporting flow and the expanded
  procurement, traceability, rotable, core, warranty, cannibalization, and bulk
  import Parts workflows through the existing production application plane.
- **Path:** application-only update of the existing `mxg-core` Container App.
  The static frontend is already published from Git `main` at product commit
  `9cc2b10ed842cfea3104334b336e71ad218478c9`.
- **Approval:** after reviewing the audit findings, the user authorized the
  as-is Azure release on August 22, 2026, then explicitly confirmed the target
  subscription and region.
- **Azure context:** reuse `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`), `centralus`, resource group
  `mxg-rg-50106`, registry `mxgacr50106`, Container Apps environment
  `mxg-cae-50106`, and Container App `mxg-core`. No resource, region, SKU,
  identity, RBAC, secret, ingress, or scale change is approved.

### Release contents

- Add authenticated feedback submission and administration, including private
  screenshot storage, through migration `0018_feedback.sql`.
- Expand Parts with procurement/orders, traceability, serialized rotable and
  core obligations, warranty claims, gated cannibalization records, and bulk
  CSV/XLSX import with preview and rollback through migrations `0019`-`0023`.
- Build the exact `services/mcp` context from the clean shared `main` branch and
  publish one immutable ACR tag. SQLx applies the additive migrations before
  the server accepts traffic.

### Validation and security disposition

- Frontend suite passed: 212 tests, 0 failures.
- Rust workspace passed: formatting, strict Clippy, 192 tests, and the locked
  optimized release build.
- `git diff --check` passed and the working tree was clean and synchronized
  with `origin/main` before this deployment record.
- Live preflight passed: the existing revision returned HTTP 200 from
  `/healthz`, `/readyz`, and `/adapterz`; readiness reported the production
  database and authoritative manual source healthy.
- Static RBAC changes are not applicable because this release contains no
  infrastructure or role-assignment change. Live state confirms the
  `mxg-core` system identity retains `Storage Blob Data Contributor` on the
  private `documents` container and `Cognitive Services User` on the existing
  Document Intelligence account.
- The user accepted release with the audit findings left open: cross-tenant
  global part-catalog mutation/rollback behavior, active `quick-xml` RustSec
  advisories through `calamine`, unvalidated authentication `returnUrl`, broad
  Parts authorization, forgeable preview digests, CSV formula injection,
  coarse request/body limits, cannibalization cancellation ownership, and an
  archived uniqueness edge case. This authorization does not close or waive
  those findings for remediation tracking.

### Promotion and rollback gates

- Preserve the ready image
  `mxgacr50106.azurecr.io/mxg-core:patent-b99241d-20260817-0125` and revision
  `mxg-core--patentb99241dv3` throughout deployment.
- Azure's existing `Single` revision mode must keep the current revision live
  until the candidate starts, applies migrations `0018`-`0023`, and becomes
  latest-ready. Migration `0023` intentionally fails if duplicate live parts
  with a null manufacturer already exist; such a failure blocks promotion.
- After promotion, `/healthz`, `/readyz`, and `/adapterz` must return HTTP 200;
  unauthenticated Parts and Feedback API access must fail closed.
- If readiness, migration, authentication, or smoke gates fail, restore the
  previous image. Additive database objects may remain dormant; rollback must
  not drop tables, delete records/assets, change RBAC, or expose secrets.

### Execution checklist

- [x] Confirm subscription, Central US location, resource group, Container Apps
  environment, registry, live revision/image, and pre-deployment health.
- [x] Confirm the exact Git release state, local test/build proof, Docker build
  context, managed identity, required live data-plane roles, and rollback image.
- [x] Mark this application-only delta Validated with accepted audit exceptions.
- [x] Build and identify the immutable ACR image digest.
- [x] Promote one new `mxg-core` revision and verify migration/startup logs.
- [x] Verify live health, readiness, adapter status, fail-closed routes, traffic,
  image, and rollback availability.

### Deployment proof

- 2026-08-22: ACR build `cj1w` completed successfully from the exact
  `services/mcp` context and published
  `mxg-core:feedback-parts-9cc2b10-20260822` with digest
  `sha256:49c9d45e8d4d30ab015ab3af81d18d94bab82a0e5e4f977bf9e6b045f2a64696`.
- 2026-08-22: revision `mxg-core--feedbackparts9cc2b10` became `Healthy`,
  `Running`, latest-ready, and received 100% traffic in the existing `Single`
  revision mode. The Container App provisioning state remained `Succeeded`.
- 2026-08-22: startup logs showed the SQLx migration table and then the server
  listening on port 3030 with no warning/error entries. `/healthz`, `/readyz`,
  and `/adapterz` returned HTTP 200; readiness reported the production database
  and authoritative v2 manual pack healthy.
- 2026-08-22: valid unauthenticated Feedback submission, Feedback admin, and
  Parts requests returned HTTP 401. No test record was created.
- 2026-08-22: post-deployment live RBAC still showed `Storage Blob Data
  Contributor` on the private `documents` container and `Cognitive Services
  User` on the Document Intelligence account for the unchanged `mxg-core`
  managed identity.
- 2026-08-22: rollback remains available through prior image
  `mxg-core:patent-b99241d-20260817-0125`, digest
  `sha256:e4ed8aa53594da0a9e90044a657eb908c0dc40e96c209a44d312457f7217437f`.

## Shared Patent Workspace Delta — 2026-08-17

### Project overview and approval

- **Goal:** publish the organization-shared provisional-patent completion
  workspace requested in Settings, backed by the existing authenticated
  application plane, Azure PostgreSQL database, and private `documents` Blob
  container.
- **Path:** MODIFY the existing small, cost-conscious production pilot.
- **Approval:** the user approved implementation and publication in the current
  task on August 17, 2026 and explicitly named Dwayne Tillman, Joshua Millard,
  and Thomas Hagy as proposed inventors.
- **Azure context:** reuse the previously approved `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`), `centralus`, and resource group
  `mxg-rg-50106`. No subscription, region, SKU, scale, or topology change is in
  scope.

### Components and recipe

| Component | Type | Technology | Deployment target |
| --- | --- | --- | --- |
| Patent workspace | Static frontend | HTML, CSS, JavaScript | Existing GitHub Pages site |
| Shared workspace API | Containerized API | Rust / Axum / SQLx | Existing `mxg-core` Container App |
| Current document and revisions | Relational state | PostgreSQL JSONB | Existing production PostgreSQL database |
| References and immutable save archives | Private files | Azure Blob Storage | Existing private `documents` container |

- **Recipe:** existing Azure CLI + ACR + Container Apps release path.
- **Rationale:** this is an application-only update to already-provisioned
  resources. Creating or changing infrastructure would add risk without adding
  capability.
- **Specialized technology check:** no Copilot SDK, Azure Functions, APIM, new
  AI gateway, or cross-cloud migration marker applies.

### Architecture and security boundaries

- The latest shared document is organization-scoped in PostgreSQL and every
  save creates an immutable revision row with the authenticated user and
  optimistic version number.
- Each save also writes an immutable JSON archive under
  `documents/project-workspaces/{organization}/{workspace}/revisions/`.
- Uploaded references are stored under
  `documents/project-workspaces/{organization}/{workspace}/assets/` and are
  downloadable only through the authenticated tenant-scoped API.
- Blob URLs, SAS values, credentials, and storage keys are never returned to
  browser code. The existing `mxg-core` managed identity remains the preferred
  read boundary; existing server-side storage configuration remains the write
  fallback.
- The frontend labels inventor names as proposed until residence,
  contribution, ownership, and substantive review are confirmed. It does not
  submit to USPTO or represent legal review as complete.

### Resource inventory and capacity

| Resource type | Number to deploy | Total after deployment | Limit / quota | Notes |
| --- | ---: | ---: | --- | --- |
| New Azure resources | 0 | unchanged | Not applicable | Existing resources only; no provisioning quota is consumed |
| `Microsoft.App/containerApps` | 0 new / 1 revision | 1 existing app | Existing service envelope | New `mxg-core` image revision only |
| PostgreSQL tables | 3 additive tables | Existing database | Existing database capacity | JSON document capped at 512 KiB; files remain in Blob |
| Storage containers | 0 | 1 existing private `documents` container | Existing account | New tenant-scoped prefixes only |

Capacity status: **within existing limits**. No resource, replica, SKU, region,
or quota change is requested, so a quota increase is not applicable.

### Files and changes

- Add migration `0017_project_workspaces.sql` with tenant-scoped current,
  revision, and asset metadata tables.
- Add authenticated GET/PUT workspace routes plus private asset upload/download
  routes to `mxg-core`.
- Add `patent-workspace.html`, `patent-workspace.css`, and
  `patent-workspace.js` plus the Settings selector and protected-page return
  flow.
- Add browser-contract, client-contract, migration, route, and validation tests.
- No infrastructure file, secret, RBAC assignment, public ingress, database
  deletion, or existing migration is changed.

### Functional verification

- JavaScript syntax checks passed.
- Complete frontend suite passed: 130 tests.
- Rust formatting and compile checks passed.
- Complete Rust workspace suite passed: 121 tests across all test targets.
- Local browser navigation exposed and corrected the protected-page return
  handoff through the registered dashboard redirect URI.
- The authenticated live visual/save check remains a post-deployment gate
  because local Entra redirects intentionally return to the production origin.

### Validation steps

- `git diff --check`.
- `npm test` and JavaScript syntax checks.
- `cargo fmt --all -- --check`.
- `cargo clippy --locked --workspace --all-targets -- -D warnings`.
- `cargo test --locked --workspace`.
- `cargo build --locked --release -p mxgenius-mcp`.
- Confirm Azure CLI subscription, current `mxg-core` revision/image, managed
  identity, storage role, and current health/readiness before promotion.
- Build the exact `services/mcp` source state in the existing ACR, create one
  new `mxg-core` revision, and allow SQLx to apply only additive migration 0017.

### Release gates

- The new revision is latest-ready before traffic is accepted.
- `/healthz` and `/readyz` return HTTP 200 after migration startup.
- Unauthenticated project-workspace access fails closed.
- The promoted frontend opens the protected patent workspace, displays all
  three proposed inventor names, and can save/reload one tenant-shared version.
- One small reference file can be uploaded and retrieved through the private
  application API without exposing a Blob URL.
- GitHub Pages publishes only after the core acceptance gates pass.

### Rollback

- Keep the current ready `mxg-core` revision and image available throughout.
- If startup, migration, health, authentication, or storage gates fail, shift
  traffic back to the previous ready revision and do not publish the frontend.
- Additive migration tables may remain dormant. Rollback does not drop tables,
  delete workspaces, delete Blob data, change RBAC, or remove revisions.
- If frontend acceptance fails after publication, restore the prior Pages
  commit while retaining the compatible backend revision.

### Execution checklist

- [x] Analyze and scan the existing application and deployment context.
- [x] Confirm no new infrastructure or quota is required.
- [x] Implement and locally verify the frontend, API, migration, and tests.
- [x] Preserve tenant, identity, Blob privacy, and rollback boundaries.
- [x] Mark this delta Ready for Validation.
- [x] Run and record the complete validation proof.
- [x] Promote and verify the paired core/frontend release.

### Validation proof

- 2026-08-17: JavaScript syntax checks, `git diff --check`, and all 130 frontend
  tests passed.
- 2026-08-17: Rust formatting, strict workspace Clippy, all 121 Rust tests, and
  the locked release build passed.
- 2026-08-17: Azure CLI confirmed `Azure subscription 1`
  (`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`), the existing `centralus`
  `mxg-core` Container App, successful provisioning, and current revision
  `mxg-core--0000029`.
- 2026-08-17: Pre-deployment `/healthz` and `/readyz` returned HTTP 200 with the
  production database ready.
- 2026-08-17: Live RBAC confirms the `mxg-core` managed identity retains
  `Storage Blob Data Contributor` on the private `documents` container. No
  role, infrastructure, region, SKU, or scaling change is required.
- 2026-08-17: ACR build `cj1v` published
  `mxg-core:patent-b99241d-20260817-0125` with digest
  `sha256:e4ed8aa53594da0a9e90044a657eb908c0dc40e96c209a44d312457f7217437f`.
- 2026-08-17: Startup logs proved the additive migration ran successfully, then
  exposed pre-existing drift from the approved MiniLM cutover: the core lacked
  its embedding settings and manual-pack ID. The existing
  `mxg-manual-embeddings` credential was reused; no key was created, disclosed,
  or committed.
- 2026-08-17: Revision `mxg-core--patentb99241dv3` became healthy. `/healthz`
  and `/readyz` returned HTTP 200, readiness identified
  `manuals-authoritative-v2` and `mxg-cl350-starter-manuals-v1` as healthy, and
  unauthenticated project-workspace access returned HTTP 401.

## Manual Retrieval Stabilization Delta — 2026-08-11

### Approved scope

- Update the existing private `mxg-manual-embeddings` Container App from
  `services/manual-retrieval` without changing its ingress or credential.
- Build and promote the existing `mxg-core` Container App from `services/mcp`.
- Cut `mxg-core` over from `manuals-authoritative-v1` to the frozen
  `manuals-authoritative-v2` CL350 pack only after the private MiniLM service is
  ready.
- Preserve the current ready images and revisions for rollback.
- Do not modify `mxg-fleet`, `mxg-api`, database migrations, Search documents,
  storage assets, identity, RBAC, scaling, or Azure resource topology.
- Publish the paired static frontend directly to Git `main` only after Azure
  acceptance passes.

### Release gates

- The frozen manifest reconciles to 13,121 approved CL350 chunks across eight
  Search document IDs and five manuals.
- The v2 index declares a 384-dimensional `content_vector` compatible with
  `all-MiniLM-L6-v2`.
- JavaScript, Python, Rust workspace, locked release build, formatting, strict
  Clippy, schema fingerprint, and diff-integrity checks pass.
- The new embedding revision becomes ready before core settings are changed.
- The new core revision becomes latest-ready and returns HTTP 200 from
  `/healthz` and `/readyz`.
- `/adapterz` reports `manuals-authoritative-v2` and healthy manual retrieval.
- Unauthenticated application and fleet boundaries continue to fail closed.

### Rollback

- Restore the prior `mxg-core` image and its previous manual settings if the
  core readiness or adapter gate fails.
- Restore the prior `mxg-manual-embeddings` image if its readiness gate fails.
- Do not delete either failed revision, the v2 index, or the frozen corpus.

### Approval

Approved by the user on 2026-08-11 for Azure subscription
`d1a68ed7-2983-4a86-ab0e-e56df9e2e325`, region `centralus`, resource group
`mxg-rg-50106`, followed by a direct Git push to `main` after Azure acceptance.

## Market-Readiness Delta — 2026-08-04

### Release scope

- Remount the reviewed MCP implementation in `services/mcp` without changing
  the existing migration history.
- Surface backend-derived capability readiness in Operations and the aircraft
  FAA panel.
- Require a whitelisted Entra identity for browser fleet requests while
  preserving the core-to-fleet lane through a shared Container Apps secret.
- Publish the paired frontend only after core and fleet acceptance passes.

### Validated artifacts

- Core: `mxg-core:market-ready-lf-20260804-083609`, digest
  `sha256:2a9536c07e17db66b8acae40c702c6bcbad18b71bcefb368ff83091d1398caaf`.
- Fleet: `mxg-fleet:market-ready-20260804-073721`, digest
  `sha256:326ee2b3d8f2d69184978311ab9550f2d8900cf644e8181797293bc2e248a1e0`.
- JavaScript suite: 84/84. Rust formatting, strict Clippy, workspace tests, and
  locked release build passed.
- Production is healthy on `mxg-core--0000024` and `mxg-fleet--0000007`.
  FAA reports `available` and the fleet internal-auth boundary is configured.

### Remaining gate

Run the existing `scripts/live-field-probe.mjs` against the promoted pair. It
must prove whitelisted fleet access, core-to-fleet lookup, FAA completion, and
the fail-closed unauthenticated fleet boundary. If it fails, retain the current
rollback revisions and inspect the failed revision logs before making changes.

## Closed-Beta Invitation Baseline Delta — 2026-07-28

This release preserves the existing real-time Settings invitation flow and adds
`@mxgenius.io` plus `rocky@mxgenius.io` as protected organization-scoped access
rules. Exact email entries continue to request an Entra B2B invitation through
Microsoft Graph before the access rule is committed. Domain rules authorize
matching, successfully authenticated identities and do not attempt to invite an
entire domain. Rocky's two protected identities receive the `procurement` role
needed for Parts receiving; an existing viewer membership is upgraded
idempotently when an administrator opens the access list.

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
