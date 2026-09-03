# MXGenius feature catalog

Last updated: 2026-09-02

This is the canonical product inventory. It records what the current repository actually supports, what is mounted but still needs field validation or completion, and what remains planned. It is a product map, not a claim that every mounted integration is configured in every deployment.

## Status legend

- `[x]` implemented and covered by repository verification
- `[~]` mounted or materially implemented, but incomplete or awaiting a real-world/deployment gate
- `[ ]` planned or documented but not mounted as a usable feature
- `[!]` blocked on an external credential, entitlement, policy, domain decision, or hardware validation
- `[-]` deliberately retired or explicitly out of scope

## Product surface summary

| Product surface | State | Current boundary |
| --- | --- | --- |
| Identity, tenancy, and access | `[~]` | Entra and server-owned beta access are mounted; guest onboarding still needs a real-world pass. |
| Fleet intelligence | `[~]` | JetNet-backed browser and spatial exploration are mounted; adapter availability must become more visible. |
| Maintenance cases | `[~]` | Case creation, selection, status, context, and markers are mounted; the full evidence-to-closure workspace remains active work. |
| AI copilot and maintenance advisory | `[~]` | Grounded text, multimodal, threads, Realtime voice, tools, and confirmation are mounted; streaming/fallback refinement remains. |
| Parts and inventory | `[x]` | Receiving, review, inventory lifecycle, requests, shortages, rotables, robs, locations, and bulk import are reachable. |
| 3D inspection and digital-twin bridge | `[~]` | Model navigation, mesh selection, HUD, XR, animation, and media are mounted; validated aircraft mappings remain limited. |
| Fleet globe XR | `[~]` | Standalone globe, spatial HUD, point selection, audio, and voice are mounted; live headset acceptance remains. |
| Sensor bridge and diagnostics | `[~]` | Quest companion, FLIR transport, optional Pi diagnostics, trace, and spatial panel are mounted; hardware acceptance remains. |
| Native iOS AR | `[~]` | Fleet-globe parity bridge is mounted and strictly iOS-gated; native device acceptance remains. |
| Onboarding and contextual guidance | `[~]` | First-run onboarding, question-mark help, and autoplay voice guidance are mounted; eleven guides pair video with voiceover and static guidance, while the remaining guides continue to work as audio-first help. |
| Feedback and internal collaboration | `[x]` | Reporter, personal history, admin triage, build board, patent workspace, and release reports are mounted. |
| Compliance, weather, and scheduling | `[~]` | Typed capabilities exist; configuration posture and user-facing availability need refinement. |
| Analytics and KPIs | `[ ]` | Server handlers exist, but no current product surface consumes them. |
| Public, trust, and access pages | `[x]` | Landing, waitlist, trust center, login, progress, and report display are present. |

## 1. Identity, tenancy, and platform access

- `[x]` Microsoft Entra ID sign-in and redirect handling.
- `[x]` Cached-account recognition without unnecessary login redirects.
- `[x]` Interaction-required recovery through Microsoft authentication.
- `[x]` Server-owned organization membership and beta-access rules.
- `[x]` Clear distinction between access denial, authentication failure, and service outage.
- `[x]` Organization-scoped application client for browser requests.
- `[x]` Role-aware manager/administrator surfaces.
- `[x]` Tenant isolation for cases, parts, assets, feedback, projects, and persisted conversations.
- `[x]` Runtime configuration without browser-embedded service credentials.
- `[x]` API connection status in the application shell.
- `[~]` Entra B2B guest access for external Gmail users; the end-user invitation journey needs field validation.
- `[-]` Native Google OAuth is not part of the current access model.

## 2. Fleet intelligence and JetNet

- `[x]` Authenticated, server-side JetNet proxy boundary.
- `[x]` Bounded shared aircraft snapshot rather than unrestricted browser data access.
- `[x]` Aircraft records preserving the application aircraft-list contract.
- `[x]` Fleet globe with mapped geographic points and zoom-aware aviation clusters.
- `[x]` Fleet totals, mapped-aircraft counts, and country counts.
- `[x]` Search by tail, operator, and model.
- `[x]` Aircraft-type filters for business jets, turboprops, airliners, and piston aircraft.
- `[x]` Multiple globe visual treatments, including OpenStreetMap and imagery textures.
- `[x]` Auto-rotation, pause, recenter, responsive side controls, and mobile detail sheet.
- `[x]` Location selection and aircraft drill-down.
- `[x]` Selected location passed into AI/model context.
- `[x]` Aircraft Explorer with Fleet Triage and Direct Search modes.
- `[x]` Triage filters for high-time, very-high-time, for-sale, type, and region.
- `[x]` Direct lookup by make, registration, serial number, and country.
- `[x]` Subscribed make/model selectors for market-intelligence results.
- `[x]` Operator/company and contact search surface.
- `[x]` Explicit tenant-authenticated demo-data load with confirmation.
- `[x]` Cache layer and detailed JetNet success-state rendering.
- `[~]` Market cost and performance intelligence depends on subscribed source coverage.
- `[!]` Decide whether the current "Operator & Facility Directory" label should be narrowed to company/contact coverage or backed by a canonical facility source.
- `[!]` Production behavior for a missing JetNet adapter must be decided: fail closed or degrade loudly with visible health.

## 3. Maintenance cases

- `[x]` Create a case from an aircraft registration, priority, and observed discrepancy.
- `[x]` Resolve a canonical aircraft before case mutation.
- `[x]` Stop and request clarification when aircraft resolution is ambiguous.
- `[x]` Open and refresh existing cases.
- `[x]` Persist case status and case-scoped context through the application API.
- `[x]` Active-case focus card from the dashboard.
- `[x]` Pass active case context into chat, Realtime voice, and the 3D viewer.
- `[x]` Select a 3D mesh/component and propose a case marker.
- `[x]` Marker severity and confirmation-bound marker mutation.
- `[x]` Digital-twin reads remain read-only while marker writes require confirmation.
- `[~]` Case-scoped observations, linked evidence, approvals, and closure presentation.
- `[~]` Durable case rail joining model revision, selected component, manuals, evidence, and warnings.
- `[ ]` Complete end-to-end acceptance pass from discrepancy through approval and closure.

## 4. AI copilot, maintenance advisory, and Realtime voice

- `[x]` Text copilot inside the primary application shell.
- `[x]` Persisted conversation threads and new-thread flow.
- `[x]` Server-persisted conversation memory behind application identity.
- `[x]` Bounded aircraft and case context instead of sending the full fleet dataset.
- `[x]` Image attachments through authenticated content upload.
- `[x]` Multimodal questions with structured maintenance output.
- `[x]` Grounded maintenance advisory with retrieval relevance and citations.
- `[x]` Retrieval over the frozen starter manual corpus.
- `[x]` Manual images remain behind the authenticated application boundary.
- `[x]` Model output cannot declare transport or sensor readiness.
- `[x]` User-visible rejection details with correlation IDs.
- `[x]` OpenAI Realtime WebRTC negotiation through the application backend.
- `[x]` No OpenAI API key is exposed to the browser.
- `[x]` Server voice-activity detection and explicit interruption.
- `[x]` Microphone denial and cancelled connection cleanup.
- `[x]` Live capture with mute control that does not tear down the WebRTC session.
- `[x]` Canonical MCP tool schemas translated into Realtime tools.
- `[x]` Unconfigured capabilities omitted from the Realtime tool set.
- `[x]` Tool results correlated before requesting the next model response.
- `[x]` Operational writes require a bound, single-use human confirmation.
- `[x]` Realtime visual questions delegate to one authoritative structured answer.
- `[x]` Shared Realtime presence in the fleet globe, sensor workspace, and 3D viewer.
- `[~]` Streaming text presentation and fallback behavior still have tracked refinement work.

## 5. Controlled parts and inventory

### Receiving and evidence

- `[x]` Searchable catalog-part and physical stock-unit separation.
- `[x]` Start an idempotent receiving draft.
- `[x]` Receive from manual entry without requiring an uploaded document.
- `[x]` Attach private photos and documents when evidence is available.
- `[x]` Authorized asset upload and download through the application API.
- `[x]` MXGenius model extraction pipeline for document/image recreation and field proposals.
- `[x]` Per-field human accept, edit, or reject review.
- `[x]` Confidence, warnings, source evidence, and model provenance retained with suggestions.
- `[x]` Low-friction review that asks for attention only on flagged fields.
- `[x]` Atomic receiving confirmation creating the stock unit and ledger event.
- `[x]` Browser-printable QR label with an opaque canonical unit URL.
- `[x]` FAA candidate panel retaining source state and provenance.

### Inventory control

- `[x]` Search by part number, description, serial number, status, and location.
- `[x]` Responsive inventory grid with desktop dock and narrow-screen detail drawer.
- `[x]` Versioned confirmed metadata corrections.
- `[x]` Append-only inventory event history.
- `[x]` All schema-defined inventory event types reachable through controlled workflows.
- `[x]` Quarantine, available, reserved, issued, rejected, in-repair, shipped, and scrapped lifecycle handling.
- `[x]` Status-aware actions that do not offer invalid movements.
- `[x]` Return of an issued part without exposing invalid terminal actions.
- `[x]` Tenant-defined stock locations and destination suggestions.
- `[x]` Cycle counting for lots.
- `[x]` Lot splitting so partial quantities can move independently.
- `[x]` Shipment-leg and install/removal history.
- `[x]` Separate installation and removal events.
- `[x]` Paperwork vocabulary for common aviation release and trace documents.
- `[x]` Ledger mutations carry confirmation grants.

### Demand, requests, rotables, and robs

- `[x]` Parts request queue with priority, need-by, and server-owned overdue state.
- `[x]` Request/order actions constrained by status.
- `[x]` Open case demand compared with genuinely free stock.
- `[x]` Shortage view that excludes reserved or otherwise unavailable stock.
- `[x]` Rotable register and serialized retirement.
- `[x]` Retirement reason and retained history.
- `[x]` Cannibalization/rob request, approval, and completion workflow.
- `[x]` Separation of duties for rob approval.
- `[x]` Life crossing an aircraft-tail boundary recorded for life-limited robs.
- `[x]` Completion gated by the inventory event ledger.
- `[x]` Read-only, headset-friendly spoken inventory lookup.

### Import and recovery

- `[x]` Bulk import surface with preview-before-apply.
- `[x]` Add-only behavior as the default at every layer.
- `[x]` Explicit warning before overwrite behavior.
- `[x]` Whole-file rejection instead of partial application for invalid input.
- `[x]` Re-import protection against duplicate stock.
- `[x]` Append-only import journal.
- `[x]` Privileged rollback that refuses to contradict later work.

### Parts roadmap and blocked domain work

- `[!]` Shelf life, cure date, calibration expiry, and issue-time blocking need maintenance-domain review.
- `[!]` Rotable TSN, TSO, and cycles carried through installation/removal need domain review.
- `[!]` Exchange/core obligations and return-by dates need domain review.
- `[ ]` Ownership beyond owned stock: customer property, consignment, exchange core, and loaner.
- `[ ]` Trace documents linked to canonical certificate records.
- `[ ]` Recurring AD applicability on controlled parts.
- `[ ]` Purchase orders and repair orders with full status flows.
- `[ ]` PO-line receiving, vendor approvals, and quote comparison.
- `[ ]` Counting sessions with variance reports.
- `[ ]` Min/max levels, reorder thresholds, and stock-on-hand rollups.
- `[ ]` Reserve directly from a shortage row.
- `[ ]` Partial issue from a lot without a manual split.
- `[-]` Dedicated label-printer and laser-etch integrations are outside the current slice.

## 6. 3D inspection and digital-twin bridge

- `[x]` Bundled model catalog with explicit provenance and operational-status labels.
- `[x]` Unified model library with tenant GLB upload plus searchable NASA, OpenVSP Airshow community aircraft, Smithsonian Air & Space, and FlightGear simulation geometry; lazy loading, source and size filters, catalog provenance, and non-authoritative labeling.
- `[x]` Tenant-owned GLB model availability independent of third-party catalogs.
- `[x]` Authorized GLB upload.
- `[x]` Orbit, zoom, reset camera, lighting, exposure, wireframe, bloom, and ambient-occlusion controls.
- `[x]` HDRI inspection environments and immersive XR workspace.
- `[x]` Raycast selection with click-versus-orbit protection.
- `[x]` Mesh hierarchy path and mapping-state inspector.
- `[x]` Reversible emissive highlighting without mutating shared source materials.
- `[x]` Host/viewer typed message boundary for selection, context, highlight, and clear commands.
- `[x]` Active maintenance-case context forwarded into the viewer.
- `[x]` Mapping states distinguish demonstration, unmapped, mapped, and validated content.
- `[x]` Confirmed case-marker bridge for selected mapped components.
- `[x]` Authored animation selection, play/pause, speed, and scrubber.
- `[x]` Direct procedure video with timed mesh pairing.
- `[x]` Desktop maintenance-HUD preview.
- `[x]` Continuous spatial reveal sequence: target box, outline, extension line, and detail card.
- `[x]` Shared spatial sound cues and sound enable/disable control.
- `[x]` WebXR session entry when supported.
- `[x]` One-grab model translation and two-grab scale/rotation.
- `[x]` Native AR viewer entry exposed only through a supported iOS bridge.
- `[~]` Production aircraft/component mapping files and supporting evidence.
- `[~]` Controlled external-to-tenant import with durable source and usage provenance; raw tenant GLB upload works, provider imports are planned.
- `[~]` Case rail joining selected zones, manuals, observations, and evidence.
- `[ ]` Separate hover and selected visual states.
- `[ ]` Keyboard-accessible selection through a mapped component list.
- `[ ]` Camera focus from mapped presets or computed bounds.
- `[ ]` Zone/document fallback when no mesh mapping exists.
- `[ ]` Thermal mount assembly and authored exploded-view animation.
- `[-]` Demonstration models are not presented as validated aircraft digital twins.

## 7. Fleet globe XR

- `[x]` Standalone Three.js/WebXR fleet-globe route.
- `[x]` Cached, bounded fleet coordinates passed from the browser surface.
- `[x]` Spatial summary HUD for aircraft, mapped locations, countries, active case, and attention state.
- `[x]` Location and aircraft selection by controller or fingertip contact.
- `[x]` Location paging, attention filters, rotation pause, and recenter controls.
- `[x]` Selected JetNet location carried into spatial model context.
- `[x]` Realtime voice presence with microphone control.
- `[x]` Shared globe-specific spatial audio cues.
- `[x]` Contextual help entry point using the same guide as the browser globe.
- `[x]` Fleet route excludes FLIR and Pi initialization.
- `[!]` Final Quest/browser headset acceptance and comfort pass.
- `[-]` Fleet points are fleet/registry context, not live flight tracking.

## 8. Sensor bridge, FLIR, and Pi diagnostics

- `[x]` Sensor workspace isolated from the JetNet fleet runtime.
- `[x]` Standalone Quest FLIR companion with no Pi runtime dependency.
- `[x]` Opaque browser/native session handoff.
- `[x]` Custom scheme and Quest intent launch support.
- `[x]` Optional entitlement/install fallback.
- `[x]` Quest-local browser consumer and companion producer routes.
- `[x]` FLIR transport works independently of Pi diagnostics.
- `[x]` Optional Pi diagnostics source.
- `[x]` Three-stage activation display: app handoff, native panel, and FLIR source.
- `[x]` Explicit source/transport state rather than model-inferred readiness.
- `[x]` Compatibility trace with failure reason and credential-shape redaction.
- `[x]` Retry/backoff behavior for unavailable local thermal transport.
- `[x]` Canonical Pi schema driving deterministic XR diagnostic rows.
- `[x]` Full-state and sequenced-delta rebuilds of diagnostic state.
- `[x]` Head-following spatial sensor panel.
- `[x]` Thermal panel show/pin/scale controls.
- `[x]` Quest passthrough snapshot capture persists to the active maintenance case through the existing authenticated evidence store.
- `[x]` Active-case evidence tray with smooth captured-thumbnail transfer and shared Realtime voice presence.
- `[x]` Maintenance case gallery and dashboard thumbnail recall stored images through tenant-scoped authenticated media routes.
- `[~]` MP4/WebM evidence storage, authenticated gallery playback, and byte-range delivery are ready; native Quest passthrough recording and headset acceptance remain.
- `[~]` Remote Witness consent and gateway contracts exist; the customer media room, short-lived case invite/QR, viewer presence, and revoke/end controls remain to be mounted.
- `[x]` Contextual sensor-bridge guide.
- `[~]` Production XR negotiation is intentionally not mounted until the relay contract is approved.
- `[!]` Physical Quest + FLIR hardware acceptance and release-channel validation.

## 9. Native iOS AR

- `[x]` Explicit Capacitor `ios` platform gate.
- `[x]` Native capability check before AR controls appear.
- `[x]` Unsupported web, Android, and Quest hosts keep AR hidden and disabled.
- `[x]` Fleet-globe placement with bounded JetNet pins.
- `[x]` Location selection and aircraft detail callbacks.
- `[x]` Selected location/aircraft shared with the browser and model context.
- `[x]` Native AR camera-pose event bridge.
- `[x]` Spatial AI audio positioning.
- `[x]` Realtime microphone/session-state integration.
- `[x]` Native 3D-viewer scene bridge.
- `[x]` AR-specific contextual help appears only with a supported AR control.
- `[!]` Final device acceptance on supported iPhone/iPad hardware.

## 10. Onboarding, help, audio, and motion

- `[x]` First-run welcome and guided onboarding flow.
- `[x]` Persistent Tour launcher plus restartable onboarding from Settings.
- `[x]` Role/workspace tour covering identity, navigation, status, copilot, cases, parts, fleet, XR, and sensor diagnostics.
- `[x]` Four-second dashboard arrival splash synchronized to the welcome sound, with smooth half-second fades and a clean handoff to onboarding.
- `[x]` Empty-state calls to action.
- `[x]` Question-mark contextual help controls and anchored non-modal popovers across the core browser and spatial surfaces.
- `[x]` Escape, outside-click, repeat-trigger, and close-button dismissal.
- `[x]` Mobile bottom-sheet presentation and reduced-motion behavior.
- `[x]` Script-only fallback before media is produced.
- `[x]` Paired video and voiceover playback with optional captions and persistent static guidance.
- `[x]` Eleven delivered guide videos synchronized with their external voiceover, including graceful narration tails when a video ends first.
- `[x]` Recorded voiceover autoplay on tooltip open, with a manual Play fallback when browser policy blocks playback.
- `[x]` Safe same-origin tooltip media loading from the XR asset library.
- `[x]` Twenty-five named guides in the tooltip manifest, with every live guide reachable from contextual help or onboarding.
- `[x]` Four-beat script/shot outlines for core browser and spatial workflows.
- `[x]` Shared UI, system, spatial, and tooltip audio library structure.
- `[x]` Audio coverage for viewer, sensor bridge, and globe.
- `[x]` Tooltip voiceover, caption, and video naming contract.
- `[~]` Review the fourteen audio-first guides and add video only where motion materially improves the explanation.

## 11. Feedback, project workspaces, and reports

- `[x]` Separate Report a Bug and Request a Feature entry points.
- `[x]` Keyboard shortcut for bug reporting, suppressed while typing.
- `[x]` Screenshot capture and clipboard-image replacement.
- `[x]` Freehand, rectangle, arrow, and text annotation tools.
- `[x]` Annotation color selection, undo, and clear.
- `[x]` Bug severity with low, medium, and high levels.
- `[x]` Title, description, and mode-specific confirmation.
- `[x]` Stable human-referenceable ticket numbers.
- `[x]` My Feedback list and detail view.
- `[x]` Organization-wide admin queue for managers/administrators.
- `[x]` Status workflow including needs-information state.
- `[x]` Internal triage notes hidden from the submitter.
- `[x]` Admin email handoff to the submitter.
- `[x]` Resolved and declined items hidden from the default backlog view.
- `[x]` Shared build board with questions, sprint, completion, and update lanes.
- `[x]` Living feature catalog rendered directly from `FEATURES.md` and linked from Settings beside the Build Board and Reports.
- `[x]` Private image attachments on board cards.
- `[x]` Shared provisional-patent workspace with decision sections and private references.
- `[x]` Generated weekly reports, progress page, and constrained report-media display.

## 12. Compliance, manuals, weather, scheduling, and operations

- `[x]` FAA AD candidate flow resolves a canonical aircraft first.
- `[x]` FAA result states distinguish candidates, no candidates, incomplete identifiers, unconfigured, unavailable, and rejected source states.
- `[x]` FAA candidates retain source URL, normalized identifiers, retrieval time, and provenance.
- `[x]` Candidate language avoids making an airworthiness determination.
- `[x]` Frozen starter corpus of five classified CL350 manual families.
- `[x]` Content-addressed manual images under a controlled prefix.
- `[x]` Manual-corpus reconciliation utility is read-only against Azure.
- `[x]` Currency remains explicitly unverified until authoritative source metadata is supplied.
- `[x]` Capability workbench surfaces mounted typed operations rather than hiding them in a dead library tab.
- `[~]` FAA AD and SAIB source adapters are mounted but can degrade when configuration is absent.
- `[~]` Aviation weather capability is mounted but shares the same adapter-visibility gap.
- `[~]` Scheduling handlers exist and can use real parts-shortage readiness.
- `[!]` Decide per-adapter fail-closed versus visibly degraded production behavior.
- `[!]` Resolve the remaining scheduling `facility_id` contract: remove it or restore a canonical facility source.
- `[ ]` Per-adapter readiness/health presentation in API health and affected UI surfaces.
- `[ ]` Analytics UI for executive KPIs, fleet health, parts risk, and repeat defects.
- `[-]` The former MRO facility capability and its tool family are retired.

## 13. Security, integrity, and release controls

- `[x]` Browser clients use application identity rather than service credentials.
- `[x]` Private assets remain behind authorized application routes or short-lived redirects.
- `[x]` Organization and user context are derived server-side.
- `[x]` Idempotency support for operational writes.
- `[x]` Optimistic concurrency for versioned corrections.
- `[x]` Human confirmation required for consequential ledger and marker mutations.
- `[x]` Append-only event and import journals for traceability.
- `[x]` Specific authorization denials preserved when safe instead of generic errors.
- `[x]` XSS-safe rendering for extracted/user-authored parts data and project content.
- `[x]` Credential-shaped values redacted from XR traces.
- `[x]` Cleartext production relay URLs rejected.
- `[x]` Azure health/readiness live-smoke coverage.
- `[x]` Live field probe for frontend, core, memory, MCP, and manual assets.
- `[x]` Structure and contract tests for core browser, backend-boundary, parts, feedback, Realtime, and XR behavior.
- `[x]` GitHub Pages deployment is gated by the frontend suite and pinned Rust formatting, test, and lint checks.
- `[~]` Hardware-dependent and external-adapter gates remain separate from repository verification.
- `[ ]` Separate versioned backend build/deploy workflow with non-production smoke and rollback evidence.
- `[ ]` Deployed full-stack accessibility, responsive, degraded-state, and recovery acceptance pass.
- `[ ]` Cross-boundary observability for browser, application, MCP, adapters, OpenAI, and Realtime, with operational dashboards and alerts.
- `[ ]` Golden AI evaluation suite covering groundedness, citation correctness, abstention, conflicts, tenant isolation, authorization, and prompt injection.
- `[ ]` Privacy, transcript retention/consent, operational-authority, pilot runbook, and release-freeze review.

## 14. Explicit product boundaries

- The fleet globe owns JetNet fleet context; it does not initialize thermal hardware.
- The 3D viewer owns meshes, component mappings, authored animations, and the future thermal-mount exploded view.
- The sensor workspace owns the FLIR/Pi bridge lifecycle and diagnostic evidence.
- Native AR mirrors fleet-globe behavior only on supported iOS hosts.
- OCR/vision/model extraction produces suggestions, never confirmed part identity, condition, trace, or airworthiness.
- A selected mesh is navigation context until it has an approved mapping and evidence.
- FAA results are candidates for human review, not compliance determinations.
- Registry and fleet-location points are not live aircraft tracks.
- Demonstration models are not validated digital twins.
- Generated reports are communication artifacts, not runtime architecture.

## Maintaining this catalog

Update this file whenever a user-visible capability is added, retired, or changes status. A status should advance only with evidence: a focused automated test, a driven UI verification, a deployed smoke check, or a documented hardware acceptance. Detailed implementation plans should remain in `docs/`; this file stays the single readable index of the entire product.
