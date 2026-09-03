# Spatial target lock execution task list

Source plan: [spatial-target-lock-build-plan.md](spatial-target-lock-build-plan.md)

Legend: `[ ]` queued, `[~]` active or partially complete, `[x]` verified.

## Baseline

- [x] `STL-000` Audit browser, 3D viewer, WebXR, Quest companion, iOS bridge,
  MCP, evidence, and remote-witness touch points.
- [x] `STL-001` Freeze the lean architecture and cost boundary in the build
  plan.
- [x] `STL-002` Promote customer QR remote witness into its own delivery wave.

## Build Point 1 — Contract build

### Wave 0: schemas and fixtures

- [x] `STL-010` Add the versioned spatial target registry state/delta schema.
- [x] `STL-011` Add the versioned scene command/result schema.
- [x] `STL-012` Reconcile the Quest sensor-companion contract with existing
  snapshot, node-status, and commissioning messages.
- [x] `STL-013` Add deterministic empty, candidate, locked, expired, reconnect,
  delta, scan-command, and stale-result fixtures.
- [x] `STL-014` Validate schemas and fixtures in the edge Python suite.
- [x] `STL-015` Add contract-presence and cross-contract checks to the normal
  Node gate.
- [x] `STL-016` Run Node, edge Python, Rust formatting, Rust tests, and strict
  Clippy.
- [x] `STL-017` Record the Build Point 1 gate as green.

Build Point 1 gate: **GREEN — 2026-09-03**

- Node application suite: 318 passed.
- Edge Python suite: 38 passed.
- Rust workspace: formatting passed; 238 tests passed; strict Clippy passed.

### Wave 1: compatibility registry

- [x] `STL-020` Add `MXTargetRegistry` snapshot, delta, upsert, lock, remove,
  clear, subscribe, and bounded model-projection operations.
- [x] `STL-021` Add namespaced target ID construction and explicit alias
  resolution.
- [x] `STL-022` Convert `MXTargetContext` into a compatibility facade without
  changing existing callers.
- [x] `STL-023` Add expiry cleanup, one-active-target enforcement, and full
  resync events.
- [x] `STL-024` Add lifecycle, stale-delta, alias ambiguity, expiry, and
  projection tests.
- [x] `STL-025` Verify current case, aircraft, fleet, parts, and mesh selections
  remain unchanged.

Wave 1 verification: **GREEN — 2026-09-03**

- Registry/facade tests: 8 passed; in-session restore included.
- Full Node application suite: 326 passed.
- Edge Python schema suite: 10 passed.
- Rust workspace: formatting passed; 238 tests passed; strict Clippy passed.
- Generated runtime registry snapshot validates against the frozen schema.

## Build Point 2 — Simulation build

### Wave 2: shared frame acquisition

- [x] `STL-030` Factor snapshot acquisition into
  `acquireHeadsetFrame({ purpose })`.
- [x] `STL-031` Add scan ID, purpose, dimensions, capture time, and available
  camera metadata without breaking the existing snapshot response.
- [x] `STL-032` Add the Scan HUD control with one-request-at-a-time behavior.
- [x] `STL-033` Keep scan frames ephemeral and preserve explicit case-evidence
  attachment.
- [x] `STL-034` Test scan/evidence separation, timeout, malformed JPEG, and
  repeated input.

Wave 2 verification:

- Full Node application suite: 331 passed.
- Edge Python schema suite: 10 passed.
- Quest companion debug unit build: passed with the workspace JDK 21 toolchain.
- Local sensor-scene preview: loaded without page errors; the in-headset Scan
  layout remains a device acceptance check.
- Timeout policy: one request at a time, 10-second default, bounded to 2–20
  seconds, with typed failure and immediate release for retry.

### Wave 3A: simulated analyzer

- [x] `STL-040` Add the provider-neutral `SpatialScanAnalyzer` interface.
- [x] `STL-041` Add deterministic simulated empty, single-target, and
  multi-target analyzer responses.
- [x] `STL-042` Normalize provider boxes, labels, confidence, and source into
  registry candidates.
- [x] `STL-043` Render the existing smooth box/outline/leader/card sequence from
  simulated candidates.
- [x] `STL-044` Verify Scan, candidate navigation, lock, expiry, and clear in the
  browser/WebXR preview with zero cloud dependency.

Wave 3A verification: **GREEN — 2026-09-03**

- Provider-neutral analyzer tests cover honest unavailable, deterministic empty,
  single, and multi-target responses, bounded normalization, and atomic registry
  replacement.
- Full Node application suite: 337 passed.
- Local sensor-scene preview completed Scan, candidate navigation, Lock, Clear,
  and 15-second expiry without page errors.
- Simulation requires an explicit local/private-host `spatialSim` query and is
  unavailable on the public production host; no Azure or model call is involved.
- Physical headset presentation remains intentionally assigned to `STL-070` and
  `STL-071`.

## Build Point 3 — Connected scan build

### Wave 3B: bounded backend analysis

- [x] `STL-050` Mount an authenticated read-only spatial scan endpoint in the
  existing MCP container.
- [x] `STL-051` Reuse the existing server-side still-image model path behind the
  analyzer interface.
- [x] `STL-052` Enforce image, response, candidate, timeout, concurrency,
  cooldown, rate, and daily-budget limits.
- [x] `STL-053` Add bounded SHA-256 response caching and disable automatic
  inference retries.
- [x] `STL-054` Return typed empty, unavailable, rate-limited, budget-exhausted,
  and invalid-image states.
- [x] `STL-055` Verify one billable provider call per uncached deliberate scan
  and no image/free-text logging.

Wave 3B verification: **GREEN — 2026-09-03**

- The sensor scene uses the connected analyzer through the authenticated,
  tenant-scoped `/api/spatial/scan` application endpoint. The simulator remains
  limited to an explicit local/private-host query.
- Browser preparation and server validation enforce JPEG-only input, a
  1280-pixel long edge, and a 1 MiB decoded-image ceiling before provider work.
- The provider contract returns at most five location candidates; the shared
  registry displays at most three candidates at or above 0.85 confidence.
- Tenant hash caching, one in-flight scan per session, a two-second cooldown,
  per-organization minute and daily ceilings, and an eight-second timeout are
  enforced before or around exactly one provider attempt. No inference retry is
  present.
- Provider tests cover cache reuse, concurrency refusal, timeout, cooldown,
  rate, daily budget, strict output parsing, typed states, and one-attempt
  behavior without logging images or user/provider free text.
- Full Node application suite: 341 passed. Edge Python suite: 38 passed. Rust
  workspace: formatting passed; 244 tests passed; strict Clippy passed.
- Cloud analysis remains deliberately off until
  `MXGENIUS_SPATIAL_SCAN_ENABLED=true` and the existing server-side model
  credential are configured in Azure. No provider request was made during this
  build.

## Build Point 4 — Headset/model-awareness build

### Wave 4: commands, renderer, and model context

- [x] `STL-060` Add the renderer-independent spatial command dispatcher.
- [x] `STL-061` Add dashboard/embedded-viewer and WebXR sensor adapters.
- [x] `STL-062` Add typed reversible scan, lock, highlight, clear, and thermal
  client tools.
- [x] `STL-063` Feed the locked target plus at most three candidates into
  structured chat and Realtime.
- [x] `STL-064` Add command acknowledgement, idempotency, revision, and expiry
  enforcement.
- [x] `STL-065` Verify voice commands resolve against the same visible target
  and stale responses cannot move the box.

Wave 4 implementation note: `spatial-commands.js` is the shared command boundary.
Dashboard/embedded-viewer and WebXR adapters consume the same registry revisions;
Realtime and structured chat receive only `modelProjection`. The five local
presentation tools return typed acknowledgements, replay cached command results,
reject expired or stale revisions, and recheck the registry after the HUD dwell
before moving a highlight. Physical voice phrasing remains part of the Wave 5
headset smoke gate.

## Build Point 5 — Resilience build

### Wave 5: physical acceptance

- [~] `STL-070` Run scan/empty/multiple/lock/clear/thermal/evidence flows on the
  physical Quest.
- [~] `STL-071` Verify frame orientation, normalized bounds, eye presentation,
  controller reach, and hand false-positive behavior.
- [x] `STL-072` Force socket loss, reconnect, session replacement, and full
  target-registry resync.
- [x] `STL-073` Verify no duplicate scan, phantom target, unintended evidence,
  or duplicate provider charge after reconnect.
- [x] `STL-074` Add operational telemetry budgets and a cloud-scan kill switch.

Wave 5 automated verification: **GREEN — 2026-09-03**

- The desktop WebXR simulation completed empty and multi-target scans, candidate
  navigation, lock, and clear with the staged target overlay, no runtime errors,
  and no cloud call.
- Forced socket loss rejects the pending scan, ignores its delayed frame, and
  allows a new evidence request without carrying a scan ID into case evidence.
- Session replacement requires an explicit full snapshot, clears old targets,
  and prevents a delayed snapshot from a retired session from returning phantom
  boxes.
- Identical-frame replay after session replacement produces two logical requests,
  one cache hit, and one provider attempt. Aggregate counters expose this behavior
  without logging tenants, images, prompts, or response text.
- Controller routing prioritizes the spatial HUD. Hand contact requires a stable
  180 ms dwell, and normalized bounds remain independent of frame dimensions.
- Node 24 application suite: 356 passed. Edge Python suite: 38 passed. Rust
  workspace: formatting passed; 244 tests passed; strict Clippy passed. Quest
  companion debug unit build passed with the workspace JDK 21 and Android SDK.
- Physical Quest checks remain for optics, left/right-eye presentation, reach,
  hand feel, thermal activation, and evidence placement. They are the only open
  Wave 5 gate and require the headset/FLIR path.

## Build Point 6 — Customer witness build

### Wave 6: QR invitation and remote witness

- [x] `STL-080` Mount authenticated XR session negotiation with short-lived,
  role-scoped producer and viewer credentials.
- [x] `STL-081` Add wearer-generated opaque QR invitation and manual join code.
- [x] `STL-082` Exchange the single-use invitation for a reconnectable,
  short-lived customer-viewer session.
- [x] `STL-083` Require wearer approval and expose audience, layers, viewer
  count, recording state, expiry, pause, and revoke controls.
- [x] `STL-084` Carry consent, presence, target state, case projection, and
  signaling over authenticated WSS.
- [~] `STL-085` Carry live media over WebRTC with TURN fallback instead of MCP
  or target-registry video relay.
- [x] `STL-086` Add the browser-only read-only customer witness surface.
- [x] `STL-087` Route customer comments to proposed sourced observations rather
  than direct case mutation.
- [x] `STL-088` Keep recording off by default and require separate consent.
- [x] `STL-089` Verify expiry, revocation, replay rejection, tenant isolation,
  reconnect, layer removal, and recording consent.

### Wave 6A: contract and secure native handoff

- [x] `STL-090` Audit the browser, core, native service, capture, signaling,
  admission, evidence, and deployment seams; select the Sensor Bridge extension
  with no parallel core or media store.
- [x] `STL-091` Replace the legacy `remote-witness.*` schema with the live
  `witness.*` room, bootstrap, control, projection, and SDP/ICE contract.
  - [x] Specify message direction, required fields, maximum sizes, expiry, and
    terminal states.
  - [x] Add valid offer, answer, ICE, state, control, error, and reconnect
    fixtures shared by JavaScript, Rust, and Android tests.
  - [x] Reject unknown fields, binary media, oversized signals, invalid roles,
    stale room IDs, and control after revoke/expiry.
- [x] `STL-092` Extend the authenticated Quest-loopback channel with a one-time,
  memory-only witness bootstrap.
  - [x] Transfer room ID, join URL, manual code, producer credential, WSS path,
    session expiry, and validated ICE configuration only after local-token
    authentication.
  - [x] Acknowledge native receipt before the browser relinquishes producer
    ownership.
  - [x] Clear the bootstrap on transfer failure, revoke, expiry, service stop,
    or XR session replacement.
  - [x] Assert the producer credential never appears in the QR, deep link, URL
    fragment, logs, traces, preferences, browser storage, or crash text.
- [x] `STL-093` Enforce one active producer socket and native role-scoped room
  control.
  - [x] Reject or atomically replace a second producer so two offers cannot race.
  - [x] Allow the producer credential to send only approve, pause, resume,
    set-layers, recording-consent, revoke, state, signaling, and ping messages.
  - [x] Keep case mutation, thermal control, evidence capture, and target movement
    outside the witness credential.
  - [x] Preserve viewer reconnect without permitting original-invitation replay.

Wave 6A gate: schema and fixtures are green; the existing JavaScript producer
still works; browser-to-native transfer is acknowledged; credential-leak tests
are clean; a second producer cannot become active.

Wave 6A verification: **GREEN — 2026-09-03**

- The canonical `witness.*` schema and shared fixtures are consumed by browser,
  Rust, Python, and Android tests. SDP, ICE, projection, role, field, and payload
  limits fail closed.
- The authenticated loopback sends a one-time bootstrap containing separate
  public join and Azure-core WSS URLs. The producer credential remains outside
  URLs, storage, traces, preferences, crash text, and the customer QR.
- The browser waits for the native WSS producer to be accepted before it
  relinquishes ownership. A bounded native connection failure is acknowledged
  as a rejection and falls back to the existing JavaScript producer.
- Core admits exactly one producer, retains reconnectable viewer credentials,
  rejects invitation replay, and keeps witness controls separate from case,
  evidence, thermal, and target mutations.
- Targeted Node/Python contract tests, Rust format/tests/strict Clippy, Android
  unit tests, debug APK assembly, and APK verification all pass. Continuous
  compositor media remains deliberately absent until Wave 6B.

### Wave 6B: native compositor capture and WebRTC

- [~] `STL-094` Select and pin an ARM64 Android libwebrtc build.
  - [x] Record artifact origin, exact version/checksum, license, transitive
    dependencies, supported codecs, and update procedure.
  - [ ] Prove the Quest selects hardware H.264 without a CPU pixel-copy path.
  - [~] Verify API 34 compatibility, ARM64-only packaging, minification rules,
    APK size delta, and Meta automated checks.
- [~] `STL-095` Add `RemoteWitnessCaptureController` with Android 14
  MediaProjection lifecycle support.
  - [x] Add media-projection foreground-service permission/type and extend the
    APK release verifier to require them.
  - [x] Launch the system consent prompt from `ThermalImmersiveActivity` only
    after an explicit wearer action.
  - [~] Feed the Horizon compositor surface to WebRTC; do not capture FLIR or
    headset-camera frames as a substitute for wearer POV.
  - [x] Stop and release projection, virtual display, surface, callbacks, and
    track on pause, revoke, system stop, service teardown, or session replacement.
  - [x] Require a new consent prompt after a stopped projection is resumed.
- [~] `STL-096` Add the native witness WSS client and
  `RemoteWitnessPeerController` under `SensorBridgeService`.
  - [x] Connect with the existing WebSocket subprotocol credential and validated
    WSS endpoint; keep credentials in memory.
  - [~] Create one peer and one video track, exchange SDP/ICE, and send media only
    after room approval and successful projection consent.
  - [x] Begin video-only at one conservative profile; keep microphone disabled
    until its separate permission and consent path is implemented.
  - [x] Bound reconnect backoff and connection statistics; make every cleanup
    path idempotent.
  - [x] Ensure FLIR acquisition, snapshot scans, case evidence, and service
    notification lifecycle continue independently.

Wave 6B gate: a locally verified APK produces a real Quest compositor track,
the existing browser answers it, pause removes media immediately, and FLIR plus
one-shot evidence continue to work.

Wave 6B local build verification: **GREEN; PHYSICAL GATE OPEN — 2026-09-03**

- Alpha 20 compiles against API 34 behavior, passes Android unit tests and
  release lint, and produces a minified, permanently signed ARM64-only APK.
- The verifier confirms the media-projection permission/service type, explicit
  immersive consent action, video-only capture constants, bounded WSS/peer
  reconnects, and exactly one packaged `libjingle_peerconnection_so.so`.
- `io.github.webrtc-sdk:android:150.7871.01` is pinned with checksums, license,
  zero Maven transitives, update procedure, and a measured 12,681,534-byte APK
  delta in `remote-witness-webrtc-dependency.md`.
- `ScreenCapturerAndroid` supplies the WebRTC texture surface to
  MediaProjection. No FLIR bitmap, passthrough-camera frame, microphone source,
  socket binary, or new evidence store participates in the live track.
- The remaining gate requires the physical Quest: confirm real Horizon
  compositor frames reach the existing customer browser, outbound stats select
  hardware H.264, pause removes media, and FLIR plus one-shot evidence still run.

### Wave 6C: wearer UX and end-to-end behavior

- [x] `STL-097` Add the native immersive invitation and session controls.
  - [x] Display the existing join QR/manual code, intended audience, viewer count,
    expiry, active layers, capture state, network state, and clear error text.
  - [x] Provide START, PAUSE, RESUME, and END without exposing maintenance or
    target mutations to the customer.
  - [x] Report WAITING before approval, CONNECTING during consent/negotiation,
    LIVE only after the peer is connected, and ENDED after teardown.
  - [x] Keep controls usable with hands and controllers and legible without the
    diagnostic logs.
- [x] `STL-098` Close automated and desktop interoperability verification.
  - [x] Add Rust tests for producer ownership, native controls, disconnect pause,
    expiry, revoke, role rejection, and viewer reconnect.
  - [x] Add Android tests for bootstrap validation, honest phase transitions,
    QR parsing, and secret redaction; enforce capture ownership, terminal
    teardown boundaries, and reconnect limits in the release verifier.
  - [x] Add browser tests using Android-shaped SDP/ICE fixtures and prove the
    customer remains read-only.
  - [x] Extend APK verification for permissions, foreground-service type,
    libwebrtc ABI/license, required controls, and forbidden credential storage.
  - [x] Run targeted Node, Rust format/test/Clippy, Android unit, debug APK, and
    release-verification gates without changing the Parts flow.

Wave 6C implementation gate: invitation, wearer controls, and browser playback
are wired across the shared contract; pause, resume, expiry, revoke, and
reconnect have deterministic bounded state; all automated touched-component
gates are green. Physical compositor delivery and native callback behavior are
accepted in Wave 6D. Unrelated Parts/Clippy findings are reported separately and
do not get folded into this wave.

Wave 6C local build verification: **GREEN; IMPLEMENTATION COMPLETE — 2026-09-03**

- Alpha 21 renders the existing customer QR/manual code, audience, viewers,
  expiry, layers, recording/network state, and bounded errors in the native
  immersive panel. Diagnostic logs are not rendered on that wearer surface.
- One START gesture sends wearer approval and opens fresh Horizon capture
  consent. PAUSE removes capture, RESUME requires fresh consent, and END clears
  locally only after its revoke message is accepted for sending.
- The immutable UI projection reports WAITING before wearer action, CONNECTING
  during consent/negotiation, LIVE only from the connected native peer, PAUSED
  from room state, and ENDED after teardown. It contains no producer credential.
- Android unit/debug assembly and lint, signed release assembly/verification,
  Python schema fixtures, 12 Rust room lifecycle tests, strict Rust format and
  Clippy, and all 368 Node tests pass.
- The physical/native-runtime proof now lives only in `STL-099`: exercise real
  MediaProjection callbacks, peer teardown/retry, and secret-free diagnostics
  on Quest. Those paths cannot be completed by JVM unit tests.

### Wave 6D: physical matrix and release candidate

- [ ] `STL-099` Run and record the physical Quest/FLIR acceptance matrix.
  - [ ] Same LAN: QR exchange, approval, video, target/case projection, comment,
    pause, resume, revoke, and original-QR replay rejection.
  - [ ] External path: Quest on Wi-Fi with the viewer on cellular or another home
    network.
  - [ ] Restricted path: guest/hangar or corporate network, recording the ICE
    route and failure reason rather than assuming TURN is required.
  - [ ] Lifecycle: headset sleep/wake, app background/foreground, WSS loss,
    customer refresh, process loss, and XR session replacement.
  - [ ] Soak: 20 minutes with FLIR and witness active, bounded thermals/memory,
    stable frame delivery, and no duplicate evidence or model calls.
  - [ ] If direct WebRTC fails materially, issue short-lived TURN credentials
    and repeat only the failed network cases; otherwise leave TURN disabled.
  - [ ] Build the matching core container only if the WSS contract changed,
    publish the matching static frontend, upload the verified APK to Alpha, and
    smoke the exact deployed versions before naming the candidate stable.

Wave 6D gate: the deployed core/frontend and Meta Alpha APK share one contract
version; the one-viewer customer journey passes on the physical headset; the
TURN decision is evidence-backed; rollback identifiers are recorded.

Wave 6 browser/core foundation verification: **GREEN — 2026-09-03**

- The core owns short-lived tenant/owner-scoped rooms, stores invitation and
  session credentials only as SHA-256 hashes, and distinguishes a consumed QR
  replay from an invented token without retaining the invitation secret.
- A twelve-character manual code provides a typeable 48-bit fallback. The QR
  contains only the public join URL and opaque invitation; no tenant, case,
  bridge, bearer, storage, or customer data crosses in it.
- Wearer controls live in a head-following sensor-scene panel. Media acquisition
  begins only from APPROVE/RESUME, while pause, layer removal, lost-headset
  presence, expiry, and revoke close or withhold the peer stream.
- WSS carries bounded JSON presence, consent, projection, proposed observation,
  and SDP/ICE messages. Binary payloads are rejected; continuous media uses a
  direct `RTCPeerConnection`.
- The customer surface has no application sign-in, stores its exchanged
  credential in memory only, exposes no operational case controls, and reads
  explicitly shared gallery media through the existing tenant storage path.
- Recording remains off. Two-party consent produces only a `consented` state;
  the system does not claim recording until a future evidence recorder is
  attached and confirms startup.
- Native Quest composite/passthrough capture remains the Wave 6 device gate.
  Alpha 21 contains explicit MediaProjection consent, a pinned ARM64 libwebrtc
  runtime, one video-only peer, and the complete native wearer-control panel.
  The desktop build cannot prove
  actual compositor frames or the selected Quest hardware codec. TURN remains a
  measured fallback, not a default requirement; no relay secret is committed or
  exposed.
- Room state is ephemeral and in-process. Keep this build on one MCP replica or
  preserve HTTP/WSS affinity until a shared TTL-backed room store is mounted.

## Deferred adapters

- [ ] `STL-100` Quest world-stable depth/raycast anchoring.
- [ ] `STL-101` Native on-device detection or between-scan optical tracking.
- [ ] `STL-102` iOS contour/occlusion and target-registry adapter.
- [ ] `STL-103` Aircraft-component-specific detector training and confidence
  calibration.
- [ ] `STL-104` Operator-reviewed promotion of a confirmed target into a
  reusable component mapping.

## Current stop line

Wave 6A is green; Waves 6B and 6C are locally built, and Wave 6C implementation
is complete. The current stop is the Wave 6D physical headset/browser gate:
prove compositor frames, customer
playback, hardware H.264, START/PAUSE/RESUME/END behavior, reconnect, and
parallel FLIR/evidence behavior. `STL-070` and `STL-071`
remain physical target-lock checks and can share that Quest/FLIR session with
`STL-099`.
