# MXGenius Production Mount Tasklist

This is the execution ledger for turning the POC into the v1 operational system. Status changes require evidence from code, tests, or a deployed smoke check.

## Status legend

- `[x]` complete and verified
- `[~]` implementation in progress or awaiting its verification gate
- `[ ]` not started
- `[!]` blocked by an external decision, credential, entitlement, or deployment dependency

## Critical path

```text
accepted MCP core
  -> production identity + confirmation
  -> Postgres repositories/transactions
  -> deploy MCP/application backend
  -> first case vertical slice
  -> Realtime WebRTC
  -> complete dashboard reconciliation
  -> pilot hardening and release
```

## Active execution board

WIP limit: **one implementation item**. A new item does not start until the active item's code, tests, and ledger status are updated.

### NOW

- [~] **REL-106 / UI-103** Deploy the authenticated Rust application/MCP backend, configure its sources, and complete the missing case-scoped acceptance surfaces.

### NEXT

1. **REL-106 / UI-103** Mount the authenticated backend and expose every pilot capability through a case-scoped frontend flow or an honest unavailable state.
2. **UI-108 through UI-109** Perform final accessibility, visual, device, and interaction testing on the deployed full stack.
3. **REL-101 through REL-108** Complete observability, evaluations, rollback, and pilot freeze.

### EXTERNAL VERIFICATION QUEUE

- **SEC-108 / CASE-106 / CASE-109 / CASE-110:** isolated Postgres verification.
- **TRN-109:** build and scan the production image using Docker or ACR.
- **REL-106:** Azure non-production deployment and rollback smoke test.

### NOT YET

- No frontend redesign or framework migration.
- No new capability names beyond the locked 50.
- No simulation-grade twin, autonomous return-to-service, ERP expansion, or predictive-maintenance claims.
- No final visual polish until functional application, Realtime, and adapter wiring is complete.

## A. Capability-plane foundation

- [x] **MCP-001** Move the extracted workspace to `services/mcp`.
- [x] **MCP-002** Rename the nested runtime crate from `mcp` to `server`.
- [x] **MCP-003** Preserve exactly 50 locked capability names.
- [x] **MCP-004** Keep canonical domain/contracts in `services/mcp/shared`.
- [x] **MCP-005** Run formatting, tests, clippy-as-error, and build from the mounted location.

Exit gate: the MCP workspace builds independently inside the application repository.

## B. Security and mutation invariants

- [x] **SEC-101** Remove confirmation, tenant, actor, user, and role controls from model-facing inputs.
- [x] **SEC-102** Carry confirmation and qualified approval only in trusted execution context.
- [x] **SEC-103** Enforce the role/action matrix at the common typed-tool seam.
- [x] **SEC-104** Reject attempts to inject trusted-context fields in tool arguments.
- [x] **SEC-105** Require qualified approval before case closure.
- [x] **SEC-106** Replace the placeholder OIDC provider with JWT/JWKS validation for the selected application identity provider.
- [x] **SEC-107** Derive organization, user, memberships, and roles from authenticated application state.
- [~] **SEC-108** Implement a signed, single-use confirmation grant bound to actor, tenant, action, object, version, and expiry. Code and binding tests pass; Postgres consumption test remains.
- [x] **SEC-109** Add authorization coverage across every capability family and complete role/action matrix snapshots.

Exit gate: no unauthenticated request or model-controlled value can select identity, tenant, role, approval, or confirmation.

## C. Case transaction spine

- [x] **CASE-101** Persist case creation with a real event, audit ID, and trace ID.
- [x] **CASE-102** Persist original observations, media references, evidence link, case version, event, audit, and trace.
- [x] **CASE-103** Stage in-memory mutations before commit.
- [x] **CASE-104** Prove rollback under injected event, audit, and trace failures.
- [x] **CASE-105** Make approval state a typed enum.
- [~] **CASE-106** Add explicit approval records and approval reconstruction rather than relying only on request context. Transactional adapter implemented; database test remains.
- [x] **CASE-107** Add version-conflict semantics and a dedicated stable response mapping.
- [ ] **CASE-108** Add observation/evidence supersession and conflict reconstruction.
- [~] **CASE-109** Implement Postgres case/evidence/event/audit/approval/trace repositories using one transaction. Adapter compiles behind the `CaseService`/`EvidenceStore` seams; database verification remains.
- [!] **CASE-110** Run migrations against an isolated Postgres instance and prove tenant-safe foreign keys. No local Postgres or Docker runtime is currently available.

Exit gate: a successful mutation commits the entire operational write set once; every failed member leaves no partial state.

## D. Contract and protocol quality

- [x] **CON-101** Remove invented `active` aircraft status from fixture output.
- [x] **CON-102** Return nullable no-result records from unconfigured mutations instead of fabricated IDs/timestamps.
- [x] **CON-103** Scope evidence hash deduplication and retrieval by organization.
- [x] **CON-104** Add unknown and ambiguous aircraft lookup fixtures/tests.
- [x] **CON-105** Add snapshots for all 50 input and output schemas.
- [x] **CON-106** Derive or parity-test the universal output envelope schema.
- [x] **CON-107** Add formats, ranges, lengths, and cross-field validation to all first-wave contracts.
- [x] **CON-108** Audit every fixture and `NOT_CONFIGURED` factory for invented operational facts.

Exit gate: contracts are reproducible, versioned, and contain neither trusted controls nor unsupported facts.

## E. MCP transports and packaging

- [x] **TRN-101** Advertise MCP protocol `2025-11-25`.
- [x] **TRN-102** Implement JSON Streamable HTTP requests at `POST /mcp`.
- [x] **TRN-103** Return `202 Accepted` with no body for HTTP notifications.
- [x] **TRN-104** Write no stdio output for notifications.
- [x] **TRN-105** Validate Origin, Accept, and protocol-version headers.
- [x] **TRN-106** Return `405` for unsupported GET/SSE mode.
- [x] **TRN-107** Exercise HTTP and stdio through their real transport functions.
- [x] **TRN-108** Add malformed JSON, content-type, auth-failure, resources, and prompts black-box cases.
- [~] **TRN-109** Add a production multi-stage container image and non-root runtime. Dockerfile is complete; image build awaits a Docker/ACR builder.
- [x] **TRN-110** Add health/readiness checks that distinguish process health, database readiness, and adapter readiness.

Exit gate: an MCP client can initialize, discover, invoke, and receive correct transport behavior in the deployed environment.

## F. Application-plane mount

- [x] **APP-101** Keep one browser-side application client boundary.
- [x] **APP-102** Add MCP initialize/list/call primitives behind that boundary.
- [x] **APP-103** Add the authenticated backend orchestration endpoint; the static browser must not own operational credentials. One authenticated backend request resolves trusted context and performs the typed capability sequence; browser-owned operational API keys are absent.
- [x] **APP-104** Implement the first vertical slice: aircraft lookup -> create case -> get/build context -> collect/search evidence -> render brief. The backend-owned four-capability sequence, combined context response, ambiguity stop, and renderer are tested.
- [x] **APP-105** Replace free-form chat-only routing with case-aware orchestration and typed capability traces. Case selection now drives authenticated chat context with case version and capability trace; browser-owned API-key routing is removed.
- [x] **APP-106** Convert the work-order invoice draft into a Maintenance Case intake/detail workspace.
- [x] **APP-107** Render case status, version, timeline, observations, evidence, warnings, confidence, and approvals.
- [x] **APP-108** Wire the globe, aircraft detail, chat, and dashboard cards to canonical case IDs/state. Canonical aircraft resolution now drives case cards, result badges, aircraft detail, chat, globe focus/filter/highlight, and 3D context.
- [x] **APP-109** Wire digital-twin selection and raycasting to component/zone/case marker contracts. Canonical inspection gates marker controls; confirmed markers persist with tenant-safe case validation, audit, and trace. Demo geometry remains non-operational.
- [x] **APP-110** Preserve current JetNet, cache, globe, 3D, chat, and document behavior throughout the mount.
- [~] **APP-111** Replace the dormant Apple Vision-branded AR artifact with a capability-gated browser WebXR immersive-VR control. The viewer now requests `immersive-vr` only from a user gesture, the iframe grants `xr-spatial-tracking`, and unsupported/denied states fail closed; headset validation and deployment `Permissions-Policy` verification remain.
- [x] **APP-112** Retire the legacy left-side service/work-order drawer and promote Maintenance Case to a central top-level workspace. Intake records only aircraft, priority, and observed discrepancy; later operational artifacts derive from the canonical case lifecycle.

Exit gate: the first slice works end to end without a parallel mock or compatibility data model becoming authoritative.

## F2. Authoritative data adapter mount

- [x] **ADP-100** Inventory and classify the existing flattened corpus, Blob sources, and Azure Search schema before migration. Live Search/Blob counts, coverage, schema, source mix, and authority boundaries are recorded in `docs/AUTHORITATIVE_CORPUS_MOUNT.md`.
- [x] **ADP-100A** Build a versioned authoritative manual index with source classification and provenance metadata; preserve the current mixed `manuals-index` unchanged and retain NTSB/training/VaultMX data behind separately typed boundaries. `manuals-authoritative-v1` contains 14,506 unique chunks from 814 manual documents; the source index was not modified.
- [x] **ADP-101** Implement and live-verify the Azure AI Search `ManualCorpusAdapter` with OpenAI embeddings, typed evidence output, bounded HTTP behavior, stable citations, and content-hash deduplication.
- [~] **ADP-102** Map Azure Search results to document/revision/source references, excerpts, hashes, visual assets, and currency warnings. All 354 referenced diagram binaries are restored to controlled Blob storage; 1,365 uniquely joined chunks now expose 270 exact available assets with SHA-256 lineage. Forty-six repeated lineage keys, revision/applicability/currency metadata, and 162 unindexed manual blobs remain explicitly quarantined/deferred.
- [x] **ADP-103** Implement FAA AD, DRS, and SAIB adapters with explicit source timestamps, candidate applicability state, official source links, bounded pagination, and partial/unavailable behavior. The implementation follows the FAA DRS v6 data-pull contract and mounts Final Rules (`ADFRAWD`), Emergency ADs (`ADFREAD`), and SAIB metadata.
- [x] **ADP-104** Replace fixture-backed aircraft/regulatory production paths with injected adapters; fixtures remain local-mode only. Production now composes JetNet -> tenant-scoped canonical aircraft -> DRS AD/SAIB, while missing credentials fail closed.
- [~] **ADP-105** Add adapter contract, degraded-source, provenance, and live non-production smoke tests; remove redundant browser FAA/RAG loaders afterward. Live manual and DRS smoke examples now exercise the production adapters; DRS returned 21 Global 7500 AD candidates and one `Bombardier fuel` SAIB match. Automated HTTP failure/response fixtures remain.

Exit gate: manuals and regulatory claims in production come from configured authoritative adapters, never bundled fixtures or missing browser assets.

## G. Hybrid OpenAI chat and Realtime WebRTC

- [x] **AI-101** Mount authenticated OpenAI Responses text chat in the hybrid Rust application/MCP core while preserving JetNet compatibility routing. (`gpt-5.6-sol` entitlement and an end-to-end `/chat` response were verified.)

- [x] **RTC-101** Define the media-plane/application-plane/MCP boundary.
- [x] **RTC-102** Recover and classify the native iOS `TokenStreamServer` as the on-device token fallback.
- [x] **RTC-103** Safely probe the earmarked server-side OpenAI key for Realtime/model entitlement. (`gpt-realtime-2.1` returned HTTP 200; no secret was printed or copied.)
- [x] **RTC-104** Add an authenticated SDP exchange endpoint backed by `POST /v1/realtime/calls`.
- [x] **RTC-105** Add browser `RTCPeerConnection`, microphone/audio, and Realtime data-channel handling.
- [x] **RTC-106** Stream transcript, connection, interruption, tool, error, and usage state into the chat UI.
- [x] **RTC-107** Route Realtime function requests through the authenticated application/MCP boundary.
- [x] **RTC-108** Require an explicit dashboard confirmation card for every voice-requested mutation.
- [x] **RTC-109** Add barge-in, cancellation, reconnect/idempotency, device-denied, quota, and text-fallback tests. (Live microphone/audio validation remains in final UI-109.)

Exit gate: voice is low-latency and case-aware, but cannot bypass evidence, authorization, tenancy, versioning, or human approval.

## H. Final dashboard reconciliation

- [x] **UI-101** Inventory every visible nav item, tab, card, control, form, drawer, overlay, and empty state. See `docs/UI_RECONCILIATION.md`.
- [x] **UI-102** Map each element to a live backend capability and canonical case consumer. See `docs/UI_RECONCILIATION.md`.
- [~] **UI-103** Wire elements with supported capabilities. FAA candidate reads now use `mxg.compliance.applicable_ads`; remaining adapter consumers follow ADP-101 through ADP-105.
- [~] **UI-104** Give intentionally unavailable elements an honest disabled/partial state and reason. Compliance and compatibility source states are explicit; full degraded-state pass remains.
- [x] **UI-105** Remove dead, duplicated, misleading, mock, and unreachable artifacts. Token/API console, browser credentials, dormant library tab/code, static FAA loader, fake audio setting, attachment control, hidden footer, and unsupported due-status language are removed. The retained on-device model is now an actual cloud-failure fallback.
- [x] **UI-106** Add missing case, evidence, source, confidence, approval, trace, and Realtime elements.
- [x] **UI-107** Replace fake/pending operational values and unsafe HTML rendering. Unsupported AFTT/TBO claims are neutralized; fleet, company, contact, detail, gallery, and globe values are escaped or bound through DOM events instead of source-controlled inline handlers.
- [ ] **UI-108** Verify keyboard, responsive, loading, empty, degraded, failure, and recovery states.
- [ ] **UI-109** Run visual and interaction checks against desktop/mobile plus the deployed dashboard.

Exit gate: every visible dashboard element is live, honestly unavailable, or removed—nothing silently dead.

## I. Observability, evaluation, and pilot release

- [ ] **REL-101** Persist capability traces and correlate browser, application, MCP, adapter, and Realtime requests.
- [ ] **REL-102** Instrument service/database/adapter/Realtime health and latency.
- [ ] **REL-103** Add golden cases for groundedness, citation correctness, abstention, conflicts, tenant isolation, and authorization.
- [ ] **REL-104** Add CI gates for Node structure tests, Rust gates, schema snapshots, migrations, container, and end-to-end slice.
- [ ] **REL-105** Add rate limits, timeouts, retry budgets, circuit breakers, and idempotency controls.
- [ ] **REL-106** Deploy to a non-production Azure environment and run smoke/rollback tests.
- [ ] **REL-107** Complete Trust Center, privacy, retention, consent, and operational-authority review.
- [ ] **REL-108** Freeze pilot configuration, runbook, rollback, and release evidence.

Exit gate: the pilot is observable, reversible, evidence-backed, and operationally supportable.

## Current work order

1. Deploy the authenticated Rust application/MCP service with Postgres and secret-backed adapters; until then new operational controls must fail closed.
2. Add case-scoped acceptance surfaces for parts, typed MRO, weather, scheduling, manual diagrams/currency, supersession, approval, closure, and derived work artifacts.
3. Complete automated degraded-source/response fixtures and `UI-104`, `UI-108`, and `UI-109` against the deployed full stack.
4. Resolve the 46 quarantined diagram lineage keys and run the 162-manual backfill as a separate, reversible data migration.

## Implementation rail

- `services/mcp/shared` owns canonical domain types and wire contracts.
- `services/mcp/server` owns transport, identity, policy, orchestration seams, and production adapters.
- In-memory services exist only behind explicit `--insecure-local` development mode.
- Production startup requires OIDC, Postgres, migrations, and signed confirmation configuration.
- The application mounts the service through one client/orchestration boundary; it does not absorb MCP domain logic.
- An item remains `[~]` until its external persistence or deployment gate has actually run.
