# MXGenius spatial workspace boundaries

MXGenius uses one spatial shell with two task modes. The modes share identity,
context, voice, input, audio, and placement infrastructure without duplicating
their task-specific tools.

Implementation order and acceptance gates are maintained in
[spatial-workspace-consolidation-tasklist.md](spatial-workspace-consolidation-tasklist.md).

## Shared spatial shell

The shell owns:

- one world-anchored tray;
- Operations and Maintenance mode selection;
- recenter, close, and return controls;
- selected aircraft, case, component, and location context;
- hand, controller, and pointer input;
- audio cues and reduced-motion behavior;
- authentication, tenant isolation, and confirmation gates;
- one active panel or tool at a time;
- quiet, actionable connection state; and
- contextual AI and voice presence.

The shell does not own fleet, procurement, model-inspection, sensor, or case
business logic. It routes shared context to the active mode.

Nothing follows the headset except the FLIR thermal display. FLIR must retain an
explicit **Follow Head / Pin Here** choice; every other spatial surface is
world-anchored or deliberately placed by the user.

## Operations mode — without wrench

Primary question: **What do we have, where is it, and what requires action?**

Operations owns fleet geography, aircraft and organization lookup, operational
triage, parts discovery, availability, request and logistics status, weather,
scheduling readiness, and concise fleet or supply-risk summaries.

The globe is a geographic operations surface. Its selected location or aircraft
becomes shared shell context. Spatial graphs are appropriate only when they make
geography, movement, shortage, or concentration easier to understand.

Operations may show a lightweight read-only model preview to confirm object
identity. Full mesh interaction, component mapping, evidence, annotations, and
procedures belong to Maintenance.

Receiving, corrections, quarantine, ledger movement, bulk import, purchase-order
construction, approvals, and other dense transactions remain in the authenticated
2D application.

## Maintenance mode — with wrench

Primary question: **What is wrong, what am I looking at, and how do I record the
work correctly?**

Maintenance owns the active aircraft and case, full 3D model interaction,
component and mesh selection, mapping and validation, annotations, authored
animations, procedure media, FLIR, Pi and sensor status, evidence capture,
grounded maintenance guidance, Remote Witness, and technician-to-HQ assistance.

The spatial workflow is **Observe → Identify → Verify → Record**. The workflow
reveals only the next one or two useful actions instead of presenting the entire
tool belt at once.

The first release captures and stages information in space. Heavy case editing,
approvals, final closure, and administrative corrections remain in 2D.

## Cross-mode handoff

The modes exchange typed context through the shared shell:

```text
Maintenance: selected component → Need part
  → Operations: matching part + availability + location + request status
  → Maintenance: request status attached to the original case
```

The reverse path opens Maintenance from an Operations aircraft, defect trend, or
alert with the aircraft and relevant source context already selected.

The handoff must preserve tenant, aircraft, case, component, and source identity.
It must not duplicate records or imply that a request, order, or maintenance
action completed before the authoritative application confirms it.

## Service mode

Service mode contains setup, diagnostics, tuning, and recovery surfaces that do
not belong in routine spatial work:

- connection traces and transport stages;
- Pi schema and adapter diagnostics;
- entitlement and installation handoff details;
- reconnect and simulation controls;
- HDRI, exposure, bloom, AO, wireframe, and performance tuning;
- model upload and catalog administration;
- provenance administration;
- UI sound editing; and
- debug logs and raw identifiers.

Service mode stays behind an explicit Advanced or Service entry. A concise
recovery action may surface automatically when a real failure occurs.

## Host-specific behavior

- Quest/WebXR uses the shared shell and the two modes.
- The Quest-local FLIR bridge and optional Pi path are Maintenance capabilities,
  not a separate user-facing destination.
- Native iOS AR may use the same typed Operations context and bounded globe data,
  but host-specific placement does not create a third product architecture.
- Unsupported AR controls remain hidden when the native capability is absent.

## Primary-experience exclusions

- Generic floating browser panel
- Duplicate VR/AR launch buttons inside individual tools
- Head- or wrist-following information panels
- Persistent logs and connection prose
- Permanent rows of seven or more actions
- Texture or environment tuning presented as operational controls
- A separate sensor scene presented as a destination
- Permanent help icons on every surface
- Full model-library browsing during an inspection
