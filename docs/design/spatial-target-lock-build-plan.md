# Spatial target lock and model-awareness build plan

Status: implementation-ready draft

## Outcome

Add an explicit **Scan** action to the Quest sensor workspace. One user action
captures one passthrough frame through the existing snapshot bridge, analyzes
that frame once, and presents only high-confidence candidates. The user can
lock a candidate, ask the copilot about it, highlight it, or clear it.

The model is not polled on video frames. A scan result is short-lived spatial
context, not maintenance evidence. Saving an image or changing a maintenance
record remains a separate, deliberate action.

## Final boundary

```text
Quest/iOS/browser capture
          |
          v
one bounded scan request -----> simulated analyzer (development)
          |                  \-> provider adapter in existing Azure MCP container
          v
ephemeral target registry
          |
          +----> renderer adapter: box / outline / leader / card
          +----> bounded model context: locked target + at most 3 candidates
          +----> typed client commands: scan / lock / highlight / clear
          |
          `----> explicit Attach/Record action ----> existing case evidence store
```

The first release uses honest screen-space boxes derived from the captured
frame. World-stable anchoring is a later adapter and must not be claimed until
camera pose, intrinsics, depth, and anchor behavior pass on-device tests.

## Non-negotiable decisions

- No continuous cloud inference and no automatic scan loop.
- At most one analysis request per user-triggered scan.
- Reuse the existing `headset.snapshot.request` transport and JPEG validation.
- Separate `scan` from `capture evidence`; scanning never writes a case record.
- Keep candidates in bounded session state only. Persist only an operator-
  confirmed marker or evidence attachment.
- Keep operational mutations behind the existing authentication, tenant, RBAC,
  and human-confirmation boundaries.
- Do not send the raw scene graph, continuous pose history, thermal stream, or
  diagnostic log to the model.
- Unknown, expired, stale, or ambiguous targets fail closed and visibly clear.
- Preserve the current `MXTargetContext.get/set/clear` interface while the
  registry is introduced so existing case, aircraft, parts, and viewer flows do
  not break.

## Canonical contracts

Add two versioned JSON Schemas beside the existing XR contracts.

### Target registry snapshot/delta

Required snapshot fields:

- `type`: `spatial.targets.state`
- `schemaVersion`
- `sessionId`
- `registryRevision`: monotonic integer
- `observedAtMs`
- `activeTargetId`: nullable
- `targets`: maximum 8; model projection is further limited to 3 candidates

Required target fields:

- `targetId`: stable and namespaced, for example `mesh:<uuid>:<node-id>` or
  `observation:<scan-id>:<candidate-id>`
- `kind`: aircraft, case, component, mesh, part-unit, sensor, fleet-location,
  or observed-object
- `label`
- `state`: candidate, locked, lost, or cleared
- `confidence`: zero to one
- `confidenceBasis`: detector, mapped-geometry, deterministic-lookup, or user
- `source`
- `targetRevision`
- `observedAtMs` and `expiresAtMs`
- `aliases`: bounded identifiers such as model ID, mesh ID/path, component ID,
  aircraft ID, case ID, ICAO, part number, and serial number
- `anchor`: coordinate frame plus normalized image bounds and optional pose

Use the existing diagnostics `baseSequence`/`sequence`/`operations` pattern for
target deltas and full resynchronization.

### Scene command/result

Every command contains:

- `commandId`
- `sessionId`
- `action`: scan, lock, highlight, frame, clear, set-thermal, open-case, or
  attach-evidence
- `targetId`, when applicable
- bounded `arguments`
- `expectedRegistryRevision` and optional `expectedTargetRevision`
- `issuedAtMs` and `expiresAtMs`

Every renderer returns the same command ID with `applied`, `rejected`, `stale`,
or `unavailable`, its resulting revision, and a bounded reason. Replayed command
IDs return the prior result instead of applying twice.

## Implementation waves

### Wave 0 — Freeze contracts and fixtures

1. Add `spatial-target-registry.schema.json` and
   `spatial-scene-command.schema.json` under
   `services/xr-diagnostics-kiosk/contracts/`.
2. Add deterministic fixtures for empty, candidate, locked, expired, stale
   result, and reconnect/resync states.
3. Extend `sensor-companion.schema.json` to describe the already-implemented
   snapshot and commissioning messages before adding scan fields.
4. Add schema tests to the normal Node gate and the edge-contract test suite.

Acceptance gate: invalid IDs, oversized candidate lists, missing coordinate
frames, stale revisions, and unsupported commands are rejected by fixtures.

### Wave 1 — Introduce the registry without breaking current surfaces

1. Add a small `MXTargetRegistry` module with `replaceSnapshot`, `applyDelta`,
   `upsert`, `lock`, `remove`, `clear`, `subscribe`, and `modelProjection`.
2. Make `MXTargetContext` a compatibility facade over the active registry
   target. Existing callers continue to use `get/set/clear` unchanged.
3. Add canonical ID construction and an explicit alias resolver. Raw mesh names
   and paths remain aliases, never operational identity.
4. Add expiry cleanup and a full-state event for reconnects. Do not add a
   database table.

Acceptance gate: all existing target producers still select the same visible
objects, while multiple candidates and one locked target survive an in-session
renderer reload.

### Wave 2 — Reuse snapshot acquisition for a distinct scan path

1. Factor the current Quest snapshot request into
   `acquireHeadsetFrame({ purpose })` with `purpose` equal to `scan` or
   `evidence`.
2. Include `scanId`, frame dimensions, capture time, and available camera
   pose/intrinsic metadata in the result. Preserve the existing JPEG size and
   timeout limits.
3. Add a Scan control to the sensor HUD. Disable it while one request is in
   flight and expose clear scanning, unavailable, empty, and failed states.
4. Route `purpose: evidence` through the existing case media path. Route
   `purpose: scan` to the analyzer and discard the image after analysis unless
   the user explicitly attaches it.

Acceptance gate: repeated Scan presses cannot create concurrent requests or
case media. Existing screenshot capture continues to populate the case gallery.

### Wave 3 — Add the cheapest bounded analyzer

1. Define one `SpatialScanAnalyzer` interface and ship a deterministic simulated
   implementation for local development and automated tests.
2. Mount one authenticated, tenant-scoped, read-only scan endpoint in the
   existing Azure-hosted MCP container. Do not create another continuously
   running service, Function App, queue, database, or storage account.
3. Put the analyzer behind a provider interface. For the first connected build,
   reuse the server's existing still-image model request path with a strict
   target-list JSON response. Do not request OCR, people analysis, prose
   captions, dense captions, or image generation in this path.
4. Downscale before upload, preserve aspect ratio, and keep the encoded image
   within the companion's current one-megabyte ceiling.
5. Return at most five normalized candidates; apply the product threshold and
   expose at most three. An empty high-confidence result is successful, not an
   error.
6. Cache identical frame hashes briefly in bounded memory and enforce one
   in-flight scan, a short cooldown, per-organization rate limits, and a daily
   configurable ceiling.
7. Record only request count, provider status, latency, dimensions, result
   count, and correlation ID. Never log image bytes or recognized free text.

The analyzer identifies and locates candidates. It does not make maintenance
claims. Rich description is deferred until the user locks a target and asks a
question; only that crop and bounded target context are then sent through the
existing model path.

Acceptance gate: simulated mode is deterministic; connected mode makes one
billable analysis call per uncached scan with no automatic inference retry;
unavailable analysis returns a typed unavailable state and never fabricates
candidates.

### Wave 4 — Render target lock and feed the model

1. Add a renderer-independent `MXSpatialCommands` dispatcher.
2. Implement adapters for the dashboard/embedded 3D viewer and the WebXR sensor
   scene. Keep iOS behind the same interface but outside this first release.
3. Draw normalized screen-space candidates using the existing smooth reveal
   language: box, outline, leader, then a short card. No blinking.
4. Show only candidates above the configured threshold. Use stable ordering and
   a short dwell/hysteresis rule when moving the active box.
5. Add pinch/controller selection, next candidate, lock, and clear. Expired
   results retract cleanly.
6. Supply Realtime and structured chat with the locked target and at most three
   candidates through `modelProjection`; never inject the full registry.
7. Add typed, reversible client tools for scan, lock, highlight, clear, and
   thermal visibility. Continue routing case creation and evidence attachment
   through existing server capabilities and confirmation rules.

Acceptance gate: “scan the scene,” “highlight that,” “what am I looking at?”,
and “activate thermal” resolve against the same target and return an observable
command acknowledgement. A stale model response cannot move the current box.

### Wave 5 — Physical headset and resilience gate

1. Test scan, empty result, multiple candidates, lock, clear, thermal overlay,
   evidence capture, socket loss, reconnect, and session replacement on the
   physical Quest.
2. Verify full registry resync after reconnect and reject delayed scan results
   from the previous session or registry revision.
3. Confirm frame orientation, normalized bounds, screen resize, left/right eye
   presentation, controller reach, and hand false-positive behavior.
4. Add unit tests for registry lifecycle, alias resolution, command idempotency,
   expiry, and model projection; add integration tests for scan-to-render and
   scan-versus-evidence separation.
5. Add telemetry budgets and a kill switch that disables cloud scans without
   disabling local UI, thermal, voice, or case evidence.

Acceptance gate: the headset completes the full flow after a forced socket
disconnect without duplicate scans, phantom boxes, unintended evidence, or a
second cloud charge for a replayed frame.

### Wave 6 — Customer QR remote-witness connection

This is a separate release gate after target lock is stable, but it uses the
same session, target, case, and command contracts.

#### Audit result — 2026-09-03

The clean line is to extend the existing native Sensor Bridge. Do not add a
second core, a parallel media archive, ACS Calling, or another room service.
The authenticated browser remains the room creator; the native service becomes
the sole headset media producer; the existing customer page remains the sole
viewer.

| Seam | Present state | Gap to close |
| --- | --- | --- |
| Room and customer admission | Single-use QR/manual code, hashed credentials, one-viewer default, expiry and revocation are implemented in `mxg-core`. | None for the first field test. Preserve the one-viewer cap. |
| Browser viewer | Read-only viewer, case projection, proposed observations, and WebRTC answer handling are implemented. | Prove interoperability with the Alpha 20 native offer and real Quest compositor track. |
| Signaling | Authenticated WSS carries bounded JSON SDP/ICE, rejects binary media, admits one producer, and now has a native client with capped reconnects. | Prove disconnect/pause/reconnect behavior on the headset. |
| Native session handoff | The authenticated Quest-loopback channel transfers a one-time witness bootstrap; credentials stay in memory and out of URLs, storage, and logs. | Prove the browser-to-native handoff against the deployed core. |
| Native capture | Alpha 20 has an explicit immersive MediaProjection action and consent-scoped compositor capture with teardown on every terminal boundary. | Confirm Horizon supplies real compositor frames and requires fresh consent after stop. |
| Native media | A pinned ARM64 libwebrtc build owns one hardware-encoder, video-only 1280x720@15fps peer and bounded stats. | Confirm the negotiated Quest encoder is hardware H.264 and the customer browser renders it. |
| Native controls | Alpha 21 exposes QR/manual invitation details plus START, PAUSE, RESUME, layers, and END in the native immersive panel over the owner-scoped producer WSS credential. | Prove hand/controller reach and deterministic control behavior on the physical Quest. |
| Contract spine | The checked-in `remote-witness-session.schema.json` now describes the live bounded `witness.*` bootstrap, room/control, signaling, projection, observation, and error messages. Android-shaped offer/ICE plus bootstrap fixtures exercise the browser/native seam. | Keep the schema and canonical fixtures as the single compatibility boundary when either peer changes. |
| Network traversal | Both peers already accept an ICE server list; direct WebRTC can run with STUN. | Test direct paths first. Add short-lived TURN credentials only if the external-network matrix proves they are needed. |
| Service topology | Witness rooms are TTL-bounded and in-process; the current core deployment is one replica. | Keep one replica for this release and verify that invariant before promotion. A shared room store is not required for this build. |
| Evidence | Explicit stills/clips already use maintenance-case media storage. | Keep live witness video ephemeral. Attach only an operator-selected still or clip through the existing case-media path. |

#### Lean closeout sequence

1. **Align the contract.** Make `witness.*` the only message family, add native
   bootstrap/control messages, validate ICE fields, and enforce one active
   producer socket per room.
2. **Extend the existing handoff.** After the authenticated browser creates a
   room, send its room ID, join URL/manual code, producer credential, socket
   path, expiry, and ICE configuration once over the already-authenticated
   `127.0.0.1` thermal channel. The Sensor Bridge keeps the bootstrap in memory
   and clears it on revoke, expiry, service stop, or session replacement.
3. **Mount native capture.** `ThermalImmersiveActivity` owns the system consent
   prompt. A small `RemoteWitnessCaptureController` owns MediaProjection and
   returns its surface to the service. Add the Android 14 media-projection
   foreground-service declaration and release checks. Start only from a wearer
   gesture; stop on pause, revoke, projection callback, or service teardown.
4. **Mount native WebRTC.** A bounded `RemoteWitnessPeerController` owns one
   peer, one compositor video track, SDP/ICE exchange, and connection stats.
   Reuse `SensorBridgeService` for lifecycle and status; do not put encoding or
   socket logic in the activity. Begin video-only at a conservative profile;
   microphone remains an independently consented layer.
5. **Finish the native panel.** Show QR/manual code, invited audience, viewer
   count, connection state, active layers, expiry, and explicit START, PAUSE,
   RESUME, and END actions. Approval becomes live only after projection consent
   succeeds. Resume after a stopped projection requests consent again.
6. **Prove the browser seam.** Confirm the existing customer page receives the
   native offer, renders the track, reconnects with its exchanged credential,
   loses media immediately on pause/revoke, and never gains case mutation or
   browsing controls.
7. **Close the gates.** Add native unit tests, Rust role/lifecycle tests,
   browser interop fixtures, APK manifest/ABI/license/size checks, and physical
   Quest tests with FLIR attached. Test same-LAN, separate home/cellular, guest
   Wi-Fi, and a restrictive network. A failed direct route is the evidence for
   enabling TURN; it is not a prerequisite by assumption.

The first execution should stop after steps 1–4 produce a local APK and a
browser interop test. Only then update the existing Azure core revision for the
new WSS contract and publish the matching static frontend. No Azure resource or
storage change is implied by this plan.

1. Mount the authenticated XR session negotiation route and issue
   short-lived, role-scoped connection credentials. Keep producer, wearer,
   customer-viewer, and support roles distinct.
2. Add **Invite customer** to the headset session panel. It requests an opaque,
   high-entropy invitation from the backend and renders an HTTPS join URL as a
   QR code plus a short manual code.
3. Put only the opaque invitation in the QR URL. Never encode a bearer token,
   tenant ID, case ID, bridge credential, storage URL, or customer data in the
   QR payload.
4. Exchange the invitation server-side for a short-lived viewer session. An
   unused invitation expires quickly and is single-use; the resulting viewer
   session can reconnect until the wearer ends it or its session expiry is
   reached.
5. Require an explicit wearer approval before media becomes live. Show the
   invited audience, enabled layers, viewer count, recording state, and expiry
   in the headset. The wearer can pause, resume, or revoke the session at any
   time.
6. Use the authenticated WSS channel for signaling, consent, presence, target
   state, case projection, and command acknowledgements. Use WebRTC for media;
   do not relay continuous headset video through MCP requests or the target
   registry.
7. Give the customer a browser-only, read-only witness surface requiring no app
   install or technical setup. It may display only the wearer-approved POV,
   thermal layer, current target, active-case summary, and case media.
8. Customer comments or acknowledgements enter as proposed observations with
   source and session identity. They cannot mutate a case, operate the thermal
   source, move the wearer’s target, approve maintenance work, or browse another
   aircraft or tenant.
9. Keep recording off by default. Recording requires separate explicit consent
   and uses the existing evidence/retention path rather than a parallel archive.
10. Add expiry, revocation, replay, cross-tenant, reconnect, lost-headset,
    viewer-count, layer-removal, and recording-consent tests.

Acceptance gate: a nontechnical customer scans the QR, opens the browser, waits
for wearer approval, and joins the permitted live view. Revocation or expiry
closes media and state access immediately; reusing or forwarding the original
QR cannot create another viewer session.

## Deferred adapters, not blockers for the first target-lock build

- World-stable placement using Quest depth/raycast or scene anchors.
- Native on-device detection or optical tracking between deliberate scans.
- iOS contour/occlusion and a native target-registry adapter.
- Aircraft-component-specific detector training and calibrated confidence.
- Persistence of reusable component mappings created from a confirmed target.

These use the same target and command contracts when added; they should not
create parallel identity or socket formats.

## Cost controls

- No new always-on Azure workload for the first build; extend the existing MCP
  container. The first build does not require a separate Azure Vision resource.
- Do not hard-wire the contract to Azure Image Analysis 4.0. Microsoft has
  [deprecated that service and scheduled retirement for September 25,
  2028](https://learn.microsoft.com/azure/ai-services/computer-vision/overview-image-analysis).
  The provider-neutral adapter keeps the target system replaceable.
- Simulated analyzer is the default for local UI work and CI.
- Connected analysis is opt-in configuration and receives only one downscaled
  still image per uncached user scan. The request executes through the existing
  Azure-hosted backend rather than directly from the headset.
- Request only object locations. Ask the existing model for explanation only
  after a target is selected and the user requests it.
- Bound image bytes, candidates, response fields, context projection, timeout,
  retries, cache size, per-session concurrency, organization rate, and daily
  spend ceiling.
- Do not store scan images in Blob Storage or PostgreSQL unless the user chooses
  Attach/Record.
- Surface `budget-exhausted`, `rate-limited`, `provider-unavailable`, and
  `no-confident-targets` as ordinary typed states.
- Keep remote-witness video on WebRTC. Azure-hosted WSS carries only bounded
  signaling and state; it must not become a video proxy. Prefer direct media
  when reachable. Enable a metered TURN fallback only after the physical
  network matrix proves a direct route is insufficient, issue only short-lived
  relay credentials, and terminate idle/expired rooms promptly.

### Initial tunable budgets

These are safe starting defaults, not claims of calibrated detector accuracy:

| Budget | Initial value |
| --- | --- |
| Maximum long image edge | 1,280 pixels |
| Maximum encoded scan | 1 MiB |
| Concurrent scans per session | 1 |
| Scan cooldown | 2 seconds |
| Provider attempts per uncached scan | 1 |
| Provider timeout | 8 seconds |
| Returned candidates | 5 maximum |
| Displayed/model-projected candidates | 3 maximum |
| Initial display threshold | 0.85 provider confidence |
| Candidate lifetime | 15 seconds |
| In-memory hash cache | 32 frames or 60 seconds, whichever comes first |

Before the customer demo, run a small labeled set of representative hangar,
aircraft, tool, battery, FLIR, and mount images. Adjust the display threshold
from observed false positives; do not relabel the provider score as calibrated
maintenance confidence.

## Build points

1. **Contract build:** schemas, fixtures, and compatibility registry green.
2. **Simulation build:** Scan button to animated candidates with zero cloud
   dependency.
3. **Connected scan build:** authenticated single-frame analysis through the
   existing Azure-hosted backend with hard cost controls.
4. **Headset build:** locked target enters Realtime context and typed scene
   commands render in Quest.
5. **Resilience build:** reconnect/resync, idempotency, expiry, telemetry, and
   physical acceptance green.
6. **Customer witness build:** short-lived QR invitation, wearer consent,
   browser viewer, scoped live layers, and immediate revocation green.

Build Point 4 is the first in-headset demonstration milestone. Build Point 6 is
the end-to-end customer milestone and does not require changing the target-lock
spine.
