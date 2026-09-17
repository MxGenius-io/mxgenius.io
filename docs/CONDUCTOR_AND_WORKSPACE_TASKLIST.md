# Conductor, Environment Awareness, and Workspace Task List

Status: Gate 8 local implementation in verification
Owner: MXGenius
Started: 2026-09-16
Release policy: complete and accept each gate before building the next one.

This is the durable implementation checklist for the model conductor, manual
retrieval, environment awareness, guided UI, Settings cleanup, and patent
workspace work. A task is checked only after its acceptance evidence exists.

## Gate 1 — Repair manual retrieval

- [x] Add `mxg.manual.search` as a read-only model-callable tool.
  - Inputs: question, optional aircraft model, manual type, ATA chapter, and
    image preference.
  - Output: normalized scope, excerpts, source metadata, and verified image
    references in one evidence structure.
- [x] Remove pre-model manual gating and the forced active-case aircraft filter.
  - The active case becomes fallback context, not an override of the user's
    explicit aircraft scope.
- [x] Normalize natural aircraft names and catalog aliases such as
  `Global 7500` and `GL7500`.
- [x] Preserve selected manual scope across conversational follow-ups.
- [x] Accumulate citations and image evidence from actual tool results.
- [x] Replace the mandatory maintenance-advisory response shape with a natural
  answer shape whose evidence, imagery, warnings, actions, and advisory detail
  are optional when they are not relevant.
- [x] Add retrieval regression coverage.
  - Explicit GL7500 request while MATRIX is active uses GL7500.
  - Unscoped request falls back to the active MATRIX case.
  - Natural alias and catalog code resolve to the same family.
  - Follow-up image request retains the selected manual scope.
  - Product/navigation questions do not trigger manual retrieval.
- [x] Pass production acceptance.
  - GL7500, Falcon 8X, and one additional family return useful excerpts.
  - At least one appropriate hashed image renders for each sampled family.
  - Pills, expandable excerpts, diagrams, and ordinary answers render cleanly.

Gate 1 evidence:

- Commits: conductor baseline `cafef275f33cc2e7f5da995b3ab94252ecc8d93d`,
  response/display hardening through
  `f6774161d0235b058e4edfd47dcdb130aa15a718`, and verified figure selection
  `1c08ffbc06509ea9ac3992ece0d04c814b87258b`.
- Automated tests: the frozen source passes 442 JavaScript checks and 306 Rust
  checks with one credential-gated exporter test ignored. Formatting,
  warnings-denied Clippy, Python compilation, focused ingestion validation, and
  `git diff --check` are green.
- Corpus checks: direct production Search probes return useful CL350, GL7500,
  and Falcon 8X records. The exact CL350 FDR removal record is a
  `verified_image_override` linked to Figure 401, manual page 403, and verified
  image hash
  `74c13c22b4c9c56a6fd0ccac3204a4cf49c9ed6ae57a0d9280112a5409501152`.
- Production: revision `mxg-core--rag1c08ffb` serves 100% traffic from image
  digest `sha256:91c959e931d4db84f0a7bc1f2504afb456fdbd52b4d0b872d27fb18a9ccaca0c`.
  `/healthz`, `/readyz`, and `/adapterz` return HTTP 200 and identify
  `manuals-catalog-v3` as ready and healthy.
- Acceptance disposition: earlier signed-in browser passes established pills,
  expandable excerpts, ordinary-answer rendering, and multi-family retrieval.
  The owner waived another browser replay for this backend-only correction;
  Search, Blob, ingestion, automated, and production health evidence close the
  gate.

## Gate 2 — Establish one environment manifest

- [x] Replace the duplicated backend site map and tooltip map with one shared,
  versioned environment manifest.
- [x] Define every surface, tab, purpose, capability, and semantic target once.
- [x] Normalize visible terminology, including `Equipment Drives`.
- [x] Give each model session a compact top-level environment map.
- [x] Add `mxg.environment.describe` for detailed, on-demand environment context.
- [x] Keep live world state separate from the stable manifest.
  - Current surface and open panel.
  - Selected maintenance case and aircraft.
  - Relevant user role and available capabilities.
- [x] Add manifest/tooltip parity tests so UI and model awareness cannot drift.

Gate 2 evidence:

- Commit: `cafef275f33cc2e7f5da995b3ab94252ecc8d93d`
- Automated tests: local Rust workspace green (303 passed, 1 live-only test
  ignored), JavaScript suite green (429 passed), and Rust formatting/clippy
  gates green on 2026-09-16. The 48-tool name, schema, and RBAC snapshots are
  locked. Manifest tests cover unique surfaces and targets, exact target
  ownership, navigation order, terminology, stable/live state separation, the
  browser loader, and the compiled model map. The now 49-tool name, schema, and
  RBAC snapshots are locked after Gate 3. The one canonical manifest lives
  inside the small MCP container context and the Pages release copies that same
  file to its public path; the Docker daemon was not available locally for an
  image build.
- Live awareness prompts: a neutral environment question remained on the
  current surface, while an explicit target request exposed the bounded
  **Show me** action and navigated to the registered semantic target.

## Gate 3 — Add safe guided UI control

- [x] Add `mxg.ui.guide(surface_id, target_id, guidance, behavior)`.
- [x] Restrict model calls to semantic IDs; do not accept selectors or scripts.
- [x] Map semantic targets to navigation, reveal, scroll, and spotlight behavior.
- [x] Fade the spotlight after approximately three seconds.
- [x] Respect reduced motion and allow the guidance state to be dismissed.
- [x] Prevent the guide tool from submitting, approving, deleting, or mutating
  business records.
- [x] Auto-guide explicit requests such as “show me”; otherwise return a
  user-invoked **Show me** action.
- [x] Test missing targets, reduced motion, forbidden operations, and navigation
  across all primary surfaces.

Gate 3 evidence:

- Commit: `cafef275f33cc2e7f5da995b3ab94252ecc8d93d`
- Automated tests: local Rust workspace green (303 passed, 1 live-only test
  ignored), JavaScript suite green (433 passed), and the 49-tool name, schema,
  and RBAC snapshots locked on 2026-09-16. Focused guide tests cover manifest
  ownership and missing targets, semantic-only bounded inputs, read-only tool
  authorization, cross-surface navigation, reveal/scroll/spotlight behavior,
  the three-second fade, reduced motion, Escape/Dismiss, forbidden mutation
  paths, explicit auto-guidance, user-invoked **Show me**, and replay safety.
- Visible-browser walkthrough: passed for neutral answers, explicit guidance,
  bounded navigation, target spotlight, and non-mutating behavior before the
  backend-only manual-image correction.

## Gate 4 — Simplify Settings and Operations Center

- [x] Remove the Shared Workspaces card, single-option dropdown, and redundant
  open button from Settings.
- [x] Add a direct **Operations Center** button above Account.
- [x] Add a **Patents** tab to Operations Center.
- [x] Preserve obvious navigation into and out of Operations Center.
- [x] Verify every Operations Center tab after the layout change.

Gate 4 evidence:

- Commit: `cafef275f33cc2e7f5da995b3ab94252ecc8d93d`
- Automated tests: the consolidated entry, removed dropdown/card, Reports-first
  behavior, all seven Operations Center tabs, patent embedding, feedback
  subtabs, access boundary, responsive layout, and authenticated return paths
  are covered in the 435-test JavaScript suite.
- Visible-browser walkthrough: passed for the direct Settings entry,
  Operations Center navigation, all tabs, and authenticated return paths.

## Gate 5 — Restore and expand the patent workspace

- [x] Preserve the legacy `provisional-patent` workspace and all existing data.
- [x] Add a patent portfolio view for creating, opening, switching, and
  archiving projects.
- [x] Support multiple concurrent patent workspaces with independent stable IDs.
- [x] Add a tenant-scoped workspace list endpoint for the patent family.
- [x] Add a neutral technology-area field: software, hardware, process, other.
- [x] Isolate inventors, disclosure, drawings, uploads, readiness, versions, and
  revision history per project.
- [x] Preserve visible save state and Save controls inside Operations Center.
- [x] Keep legal framing descriptive; do not imply legal advice or filing
  readiness beyond the recorded checklist.
- [x] Test legacy preservation, tenant isolation, independent assets, versions,
  revisions, and archive behavior.

Gate 5 evidence:

- Commit: `cafef275f33cc2e7f5da995b3ab94252ecc8d93d`
- Migration/API evidence: the existing tenant-owned `0017_project_workspaces`
  schema remains the persistence boundary. The new authenticated
  `GET /api/project-workspaces?family=patent` endpoint filters by organization
  and returns only the legacy key or independent `patent-<uuid>` projects.
  Existing workspace, revision, and asset tables continue to isolate all data
  by organization and workspace ID.
- Automated tests: Rust validates legacy/new patent keys, the four bounded
  technology areas, and invalid-area rejection. JavaScript validates the
  portfolio controls, stable IDs, unsaved-change guard, archive path, per-key
  asset/version calls, tenant filter, legacy preservation, and descriptive
  legal framing as part of the 435-test full suite.
- Visible-browser walkthrough: passed with two independent demo patent
  projects, project switching, visible save state, and isolated workspace data.

## Gate 6 — Release and freeze

- [x] Run the complete JavaScript and Rust test suites.
- [x] Verify the active branch, upstream, and canonical Git remote.
- [x] Commit and push the exact tested source to `main`.
- [x] Deploy the exact tested container image to Azure.
- [x] Confirm health, readiness, adapter status, revision, image digest, replica
  count, and traffic allocation.
- [x] Confirm the matching GitHub Pages deployment.
- [x] Perform the final visible production walkthrough.
  - Natural manual retrieval and follow-up imagery.
  - Site awareness and guided UI.
  - Operations Center navigation.
  - Two independent patent projects.
- [x] Record the frozen commit, Azure revision, container digest, test results,
  acceptance prompts, and known limitations below.

Final freeze record:

- Source commit: `1c08ffbc06509ea9ac3992ece0d04c814b87258b` on `main`, tracking
  `origin/main` at `https://github.com/MxGenius-io/mxgenius.io.git`.
- GitHub Pages run: `35173241950`, **Deploy to Pages**, completed successfully
  for the exact source commit.
- Azure build: ACR run `cj35` completed successfully.
- Azure revision: `mxg-core--rag1c08ffb`, Healthy, Provisioned, one replica,
  latest-ready, and serving 100% traffic. The former
  `mxg-core--uicafef27` revision remains healthy at 0% as rollback.
- Container image:
  `mxgacr50106.azurecr.io/mxg-core:rag-verified-1c08ffb-20260916`, digest
  `sha256:91c959e931d4db84f0a7bc1f2504afb456fdbd52b4d0b872d27fb18a9ccaca0c`.
- Health: `/healthz`, `/readyz`, and `/adapterz` return HTTP 200. Readiness
  reports the production database and `manuals-catalog-v3` manual library ready.
- Verified asset: the private `documents` container holds the derived 145,619
  byte PNG for Figure 401/page 403. Its Blob metadata, Search record, frozen
  register, and downloaded SHA-256 agree. No source PDF was uploaded.
- Test summary: 442 JavaScript passed; 306 Rust passed and one live
  credential-gated exporter ignored; formatting, warnings-denied Clippy,
  Python compile, focused corpus dry-run, and whitespace checks passed.
- Acceptance prompts: broad product awareness stayed natural; explicit
  navigation offered bounded guidance; manual searches covered CL350, GL7500,
  and Falcon 8X; two independent patent projects remained isolated.
- Known limitations: verified-image overrides are data-driven and only records
  with a verification recipe are guaranteed to select an exact figure.
  Unverified legacy figures are conservatively withheld when their own
  title/caption cannot establish relevance, rather than substituting a nearby
  page image. Source-manual currency and distribution rights remain outside
  this demo freeze. The owner waived a redundant post-correction browser replay
  because the final change was backend-only; the preceding signed-in UI
  walkthrough remains the visual acceptance evidence.

## Gate 7 — Full-catalog and conversational hardening

- [x] Use one exact 91-family catalog vocabulary for model retrieval and
  aircraft-scoped Equipment Drive publication.
- [x] Resolve natural manufacturer/model names to the prepared catalog key,
  including `Beechcraft 1900C` to `MODEL 1900-C AIRLINER`.
- [x] Keep retrieval mechanics out of user-facing model responses; broaden one
  search quietly, then answer usefully or ask one short clarifying question.
- [x] Present the four source libraries and their aircraft choices with readable
  labels while preserving exact catalog values behind the selector.
- [x] Audit all local linked figures without copying source PDFs: 91 aircraft,
  10,078 manuals, 111,930 chapters, zero missing image files, and zero empty
  image files.
- [x] Make Realtime readiness acknowledgement-based and serialize context/tool
  refreshes so a live conversation cannot outrun its current capability map.
- [x] Refresh application identity for each Realtime SDP exchange and discard
  stale pending mutations on disconnect or reconnect.
- [x] Remove the redundant static header Tour button while retaining Settings →
  Getting Started → Restart Tour.
- [x] Commit, push, deploy, and record the exact production revision.
- [x] Replay a natural Beechcraft 1900C standard-practices request in production
  and confirm excerpt, source pill, and linked image behavior.

Gate 7 evidence:

- Source: `66033559d82f8f223feeca3e3b4f5e2cd15485af` on canonical `main`;
  GitHub Pages run `35223325225` completed successfully for that commit.
- Azure: ACR run `cj3q`; revision `mxg-core--chat6603355`; image digest
  `sha256:546003b8341ca3160b4724bc7888652c513ede0f6a24bf69d321d3e326332282`.
  The revision is Healthy, Provisioned, latest-ready, one replica,
  RunningAtMaxScale, and serving 100% traffic. Health, readiness, and adapter
  probes returned HTTP 200.
- Tests: 450 JavaScript checks and 316 executable Rust checks passed; one live
  credential-gated exporter remained intentionally ignored. Formatting,
  warnings-denied Clippy, and whitespace checks passed.
- Live acceptance used the untuned prompt: "What standard-practices guidance
  applies to a structural inspection finding on a Beechcraft 1900C? Show me
  the most relevant figure if there is one." Production returned one focused
  Chapter 20 record, a readable excerpt, a green Registered source pill, and
  the actual page-32 Figure 14. The browser confirmed that the image completed
  at 2025×2550 pixels.
- Root cause closed: natural section wording had been misclassified as a
  standalone `SPM` publication filter even though the prepared 1900C records
  are Chapter 20 sections with no `manual_type`. The registered-image path also
  judged generic legacy captions without the source page text. Both paths now
  use the shared aircraft catalog and page-owned context while preserving
  wrong-aircraft, wrong-component, and ambiguity rejection.

## Gate 8 — Customer Operations and edge-device ownership

- [x] Move Device Registry and Equipment Drives out of Settings and into a
  dedicated **Customers** tab in Operations Center.
- [x] Add tenant-owned customer accounts with contact, operational, billing,
  status, and internal-note fields.
- [x] Support multiple devices per customer plus an explicit unassigned-device
  queue for existing or newly claimed hardware.
- [x] Preserve the existing seven-digit claim, device registration, revoke,
  Equipment Drive publication, and assignment contracts instead of creating a
  parallel device path.
- [x] Add a non-sensitive payment ledger for amount, currency, status, invoice,
  external reference, due/paid dates, and notes; never store card credentials.
- [x] Surface device heartbeat, desired-state, assigned drive/version, latest
  deployment state, and reported error details in one customer view.
- [x] Restrict customer administration APIs to Manager and Administrator roles
  and enforce organization ownership on every customer/device mutation.
- [x] Add the new workspace and controls to the server-owned environment
  manifest so model guidance reflects the UI relocation.
- [x] Add frontend contracts, Rust repository tests, and responsive structure
  checks for the new surface.
- [x] Run the complete JavaScript and Rust quality gates with formatting,
  warnings, and whitespace checks.
- [ ] Apply the additive migration and deploy the matching backend/frontend
  release.
- [ ] Complete a signed-in live acceptance: create a company, attach two
  devices, publish and assign a drive, inspect telemetry, and record a payment.

Gate 8 evidence:

- Local implementation spans migration `0031_customer_operations.sql`, the
  manager/administrator API and repository, the Operations Center Customers
  tab, and the reused Equipment Drive workspace.
- Tests: 454 JavaScript checks and 323 executable Rust checks passed; one live
  credential-gated exporter remained intentionally ignored. Formatting and
  warnings-denied Clippy passed. Release evidence is pending.
