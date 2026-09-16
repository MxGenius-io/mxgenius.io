# Conductor, Environment Awareness, and Workspace Task List

Status: active
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
- [ ] Pass live production acceptance.
  - GL7500, Falcon 8X, and one additional family return useful excerpts.
  - At least one appropriate hashed image renders for each sampled family.
  - Pills, expandable excerpts, diagrams, and ordinary answers render cleanly.

Gate 1 evidence:

- Commit: pending
- Automated tests: local Rust suite green (194 passed, 1 live-only test
  ignored) and JavaScript suite green (429 passed) on 2026-09-16. Model-tool
  registration, explicit/recent/active aircraft precedence, alias normalization,
  evidence accumulation, natural-answer normalization, and display-context
  carryover are covered.
- Azure revision/image: pending
- Live prompts and results: pending deployment; this remains the Gate 1 exit
  condition.

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

- Commit: pending
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
- Live awareness prompts: pending deployment; use one broad product question
  and one target-specific navigation question before accepting the live gate.

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

- Commit: pending
- Automated tests: local Rust workspace green (303 passed, 1 live-only test
  ignored), JavaScript suite green (433 passed), and the 49-tool name, schema,
  and RBAC snapshots locked on 2026-09-16. Focused guide tests cover manifest
  ownership and missing targets, semantic-only bounded inputs, read-only tool
  authorization, cross-surface navigation, reveal/scroll/spotlight behavior,
  the three-second fade, reduced motion, Escape/Dismiss, forbidden mutation
  paths, explicit auto-guidance, user-invoked **Show me**, and replay safety.
- Visible-browser walkthrough: pending

## Gate 4 — Simplify Settings and Operations Center

- [x] Remove the Shared Workspaces card, single-option dropdown, and redundant
  open button from Settings.
- [x] Add a direct **Operations Center** button above Account.
- [x] Add a **Patents** tab to Operations Center.
- [x] Preserve obvious navigation into and out of Operations Center.
- [x] Verify every Operations Center tab after the layout change.

Gate 4 evidence:

- Commit: pending
- Automated tests: the consolidated entry, removed dropdown/card, Reports-first
  behavior, all seven Operations Center tabs, patent embedding, feedback
  subtabs, access boundary, responsive layout, and authenticated return paths
  are covered in the 435-test JavaScript suite.
- Visible-browser walkthrough: pending

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

- Commit: pending
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
- Visible-browser walkthrough: pending

## Gate 6 — Release and freeze

- [x] Run the complete JavaScript and Rust test suites.
- [ ] Verify the active branch, upstream, and canonical Git remote.
- [ ] Commit and push the exact tested source to `main`.
- [ ] Deploy the exact tested container image to Azure.
- [ ] Confirm health, readiness, adapter status, revision, image digest, replica
  count, and traffic allocation.
- [ ] Confirm the matching GitHub Pages deployment.
- [ ] Perform the final visible production walkthrough.
  - Natural manual retrieval and follow-up imagery.
  - Site awareness and guided UI.
  - Operations Center navigation.
  - Two independent patent projects.
- [ ] Record the frozen commit, Azure revision, container digest, test results,
  acceptance prompts, and known limitations below.

Final freeze record:

- Commit: pending
- GitHub Pages run: pending
- Azure revision: pending
- Container image/digest: pending
- Test summary: pending
- Known limitations: pending
