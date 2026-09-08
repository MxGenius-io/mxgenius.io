# Spatial workspace consolidation task list

Source architecture:
[spatial-surface-boundaries.md](spatial-surface-boundaries.md)

Legend: `[ ]` queued, `[~]` active or partially complete, `[x]` verified.

## Outcome

Replace the current collection of VR/AR destinations and floating utilities with
one quiet spatial shell containing two task modes:

- **Operations** (without wrench): find, compare, locate, source, and monitor.
- **Maintenance** (with wrench): inspect, diagnose, verify, document, and
  collaborate.

Service and tuning controls remain available behind an explicit Advanced entry.
Dense transactions, approvals, and recordkeeping remain in the authenticated 2D
application.

## Build order

### Wave 0 — freeze the contract and baseline

- [x] `SWC-000` Audit the current globe, viewer, sensor, Remote Witness, Realtime,
  target HUD, navigation, input, audio, and case-context surfaces.
- [x] `SWC-001` Assign every retained capability to Operations, Maintenance,
  Shared shell, Service mode, or 2D.
- [x] `SWC-002` Confirm the full 3D viewer belongs only to Maintenance; allow
  Operations a read-only identity preview.
- [x] `SWC-003` Make the frontend MCP catalog wait for authentication, recover
  from token expiry and bounded connection failures, and validate the canonical
  45-tool registry.
- [ ] `SWC-004` Capture current desktop and physical-headset behavior for the two
  retained entry paths before removing legacy launchers.
- [ ] `SWC-005` Define one typed spatial-context envelope for tenant, aircraft,
  case, component, part, and location identity.

Wave 0 gate: current entry paths are recorded, the shared context contract is
versioned, and no scene consolidation begins with an unknown data dependency.

### Wave 1 — build the shared shell

- [ ] `SWC-010` Create one world-anchored tray with Operations and Maintenance
  mode controls.
- [ ] `SWC-011` Add shared recenter, close, and return behavior without attaching
  controls to the headset.
- [ ] `SWC-012` Enforce one active panel or tool at a time with deliberate open,
  close, and mode-transition animation.
- [ ] `SWC-013` Mount shared aircraft, case, component, and location context in a
  compact form that does not become another dashboard.
- [ ] `SWC-014` Route hand, controller, pointer, audio, reduced-motion, and voice
  behavior through the shell rather than duplicating it per mode.
- [ ] `SWC-015` Preserve authentication, tenant boundaries, and confirmation
  gates during every mode transition.
- [ ] `SWC-016` Reduce connection state to quiet ready/recovering/action-required
  signals; place traces and raw identifiers in Service mode.

Wave 1 gate: either mode can open, close, recenter, and exchange shared context
without duplicate controls, headset-following panels, or lost authentication.

### Wave 2 — Operations mode

- [ ] `SWC-020` Move the fleet globe, clusters, locations, and geographic
  exploration into Operations.
- [ ] `SWC-021` Consolidate aircraft search and aircraft/operator/supplier/contact
  drill-down around the selected globe context.
- [ ] `SWC-022` Add focused fleet triage for AOG, high-time, for-sale, attention,
  and availability states.
- [ ] `SWC-023` Add parts catalog, inventory, stock-location availability,
  shortage, demand, and request-status views.
- [ ] `SWC-024` Stage order, shipment, repair-order, and supplier status only when
  their authoritative capabilities are mounted.
- [ ] `SWC-025` Add operational rotable/robbed-part summaries, weather, scheduling
  readiness, and bounded executive summaries.
- [ ] `SWC-026` Add spatial graphs only for decisions materially improved by
  geography, movement, shortage, or concentration.
- [ ] `SWC-027` Add spoken lookup using the canonical MCP capabilities.
- [ ] `SWC-028` Limit the model surface to read-only identity preview with an
  explicit **Open in Maintenance** action.
- [ ] `SWC-029` Verify receiving, quarantine, corrections, inventory movement,
  bulk import, PO construction, and approvals remain in 2D.

Wave 2 gate: a user can answer what is available, where it is, and what requires
attention without entering Maintenance or seeing transaction-heavy controls.

### Wave 3 — Maintenance mode

- [ ] `SWC-030` Move active aircraft and maintenance-case context into
  Maintenance.
- [ ] `SWC-031` Mount the full 3D viewer with move, rotate, scale, focus, component
  selection, and mesh selection.
- [ ] `SWC-032` Retain component mapping, validation, highlights, target boxes,
  annotations, and case markers.
- [ ] `SWC-033` Retain authored animations, exploded views, and component-linked
  procedure video.
- [ ] `SWC-034` Merge the current sensor destination into Maintenance as FLIR,
  optional Pi status, and attached-sensor capabilities.
- [ ] `SWC-035` Preserve thermal capture, photographs, video, and other explicit
  case-evidence paths.
- [ ] `SWC-036` Reframe the maintenance HUD as **Observe → Identify → Verify →
  Record**, revealing only the next one or two useful actions.
- [ ] `SWC-037` Retain grounded maintenance guidance with manuals, FAA sources,
  warnings, conflicts, and citations.
- [ ] `SWC-038` Retain Remote Witness, technician-to-HQ support, voice, and
  hands-free capture without exposing operational mutations to guests.
- [ ] `SWC-039` Add **Need part** using the shared cross-mode handoff instead of a
  second procurement surface.

Wave 3 gate: a technician can identify a component, verify it against evidence,
stage the record, request a part, and return without encountering unrelated fleet
or administrative controls.

### Wave 4 — placement and legacy cleanup

- [ ] `SWC-040` Remove camera-follow behavior from Remote Witness.
- [ ] `SWC-041` Remove the generic browser panel and its camera-follow behavior.
- [ ] `SWC-042` Replace Realtime fallback camera placement with a shell anchor or
  explicit user placement.
- [ ] `SWC-043` Remove spatial target HUD camera-follow behavior while preserving
  target alignment.
- [ ] `SWC-044` Retain FLIR as the only surface with an explicit **Follow Head /
  Pin Here** choice.
- [ ] `SWC-045` Remove wrist-following fleet detail, scattered VR/AR launchers,
  persistent action belts, redundant help icons, and default-visible logs.
- [ ] `SWC-046` Remove the separate sensor scene from user navigation after its
  capabilities pass inside Maintenance.
- [ ] `SWC-047` Keep native iOS AR capability-gated without treating it as a
  separate product mode.

Wave 4 gate: an automated source audit finds no camera/head/wrist-follow behavior
outside FLIR, and every removed entry path has a verified replacement.

### Wave 5 — Service mode

- [ ] `SWC-050` Create an explicit Service or Advanced entry outside routine task
  flow.
- [ ] `SWC-051` Move connection traces, transport stages, Pi schema rows, adapter
  diagnostics, and raw identifiers into Service mode.
- [ ] `SWC-052` Move installation/entitlement handoff, simulations, manual
  reconnect, and recovery controls into Service mode.
- [ ] `SWC-053` Move HDRI, exposure, bloom, AO, wireframe, performance tuning,
  model upload, catalog administration, provenance administration, and UI sound
  editing into Service mode.
- [ ] `SWC-054` Surface only the smallest relevant recovery action when a real
  failure occurs, with the detailed trace available on demand.

Wave 5 gate: normal Operations and Maintenance sessions contain no build-mode
controls or persistent diagnostics, while support personnel can still reach every
required commissioning and recovery tool.

### Wave 6 — cross-mode handoff

- [ ] `SWC-060` Send selected component, aircraft, case, and source revision from
  Maintenance **Need part** to Operations.
- [ ] `SWC-061` Resolve matching part, availability, stock location, and request
  status without claiming an unconfirmed order or inventory action.
- [ ] `SWC-062` Return the authoritative request/status to the original
  Maintenance case and component context.
- [ ] `SWC-063` Open Maintenance from an Operations aircraft, defect trend, or
  alert with its typed source context preserved.
- [ ] `SWC-064` Reject stale revisions, cross-tenant context, duplicate records,
  and unsupported context types.

Wave 6 gate: both handoff directions complete without re-entry, lost context,
cross-tenant leakage, duplicate records, or optimistic completion claims.

### Wave 7 — acceptance and cutover

- [ ] `SWC-070` Add contract tests for mode ownership, shared context, one-active-
  panel behavior, Service-mode isolation, and the FLIR-only follow exception.
- [ ] `SWC-071` Run desktop and narrow-viewport interaction checks with keyboard,
  pointer, reduced motion, and reconnect scenarios.
- [ ] `SWC-072` Run Quest checks for tray placement, reach, legibility, mode
  switching, FLIR follow/pin, voice, evidence, and performance.
- [ ] `SWC-073` Verify the MCP catalog and relevant calls after cold sign-in,
  token refresh, temporary disconnection, offline/online transition, and service
  recovery.
- [ ] `SWC-074` Verify Remote Witness and technician-to-HQ behavior remains
  consent-bound and guest read-only.
- [ ] `SWC-075` Remove retired entry points only after their replacements pass the
  same acceptance run.
- [ ] `SWC-076` Update the feature catalog and operator guidance to describe the
  two-mode shell, Service entry, and 2D boundaries.

Wave 7 gate: the physical headset and authenticated web application complete the
two primary journeys with no blocking regression; retired scenes and controls are
no longer reachable.

## Release-one definition of done

- One spatial shell; two visible task modes.
- One active panel or tool at a time.
- No head-following UI except explicitly enabled FLIR.
- Operations answers location, availability, and attention questions.
- Maintenance completes Observe → Identify → Verify → Record and can hand off a
  part need.
- Cross-mode context remains typed, tenant-scoped, version-aware, and reversible.
- Service controls and diagnostic prose stay out of normal work.
- Dense transactions and final authority remain in the authenticated 2D app.
- MCP startup, token renewal, bounded reconnect, and offline recovery pass.
- Desktop, narrow viewport, and physical Quest acceptance are recorded before
  legacy surfaces are removed.
