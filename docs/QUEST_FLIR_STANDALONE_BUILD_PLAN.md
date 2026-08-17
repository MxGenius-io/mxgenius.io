# Quest FLIR standalone build plan

Status date: 2026-08-17
Target release: `0.1.0-poc.5` (`versionCode 5`)

## Definition of done

The FLIR companion works with the Pi powered off and Azure unavailable. The Pi diagnostics appliance works without the FLIR companion. The WebXR scene can show either source independently. Meta renders the intended landscape cover instead of its placeholder.

## 1. Freeze independent system boundaries

- [x] Audit the current Quest, Pi, WebXR, and optional relay paths.
- [x] Identify the accidental shared-relay and automatic Pi dependencies.
- [x] Document FLIR, Pi, WebXR, and remote-witness contracts as separate lanes.
- [x] Remove Pi messages and capabilities from the FLIR companion contract.
- [x] Keep Azure negotiation optional and outside local camera readiness.

Acceptance: no FLIR readiness state depends on Pi or Azure, and no Pi readiness state depends on FLIR.

## 2. Standalone Quest FLIR companion

- [x] Permit launch from the Meta library without a browser deep link.
- [x] Start the foreground camera service without a session or relay.
- [x] Enable FLIR discovery and USB permission in standalone mode.
- [x] Keep an optional relay activation additive instead of mandatory.
- [ ] Handle USB denial, unplug, replug, sleep, and resume.

Acceptance: launch, plug in FLIR, approve USB, and reach `streaming` with Pi and Azure unavailable.

## 3. Native floating-panel preview

- [x] Add an aspect-preserving thermal preview surface.
- [x] Deliver throttled camera frames from the service to the Activity.
- [x] Show explicit standby, permission, streaming, offline, and error states.
- [x] Release camera and preview resources safely.

Acceptance: the Meta floating panel visibly renders live FLIR pixels without the browser.

## 4. Remove Pi coupling from the APK

- [x] Remove Pi status and controls from the FLIR panel.
- [x] Remove Bluetooth permissions and required Bluetooth hardware.
- [x] Remove automatic Pi connection and Pi relay forwarding.
- [x] Remove the Quest-side Pi diagnostics client and tests.

Acceptance: the FLIR APK has no Pi or Bluetooth runtime dependency.

## 5. Independent WebXR thermal transport

- [ ] Test an app-hosted Quest loopback WebSocket from Meta Browser.
- [ ] Verify secure-context, background-service, and headset lifecycle behavior.
- [ ] Implement the Quest-local route if supported.
- [ ] If blocked by Horizon security, implement a separate authenticated thermal WSS relay.
- [ ] Keep the Pi out of the thermal transport in either design.

Acceptance: the WebXR thermal orb renders frames while the Pi is powered off.

## 6. Frontend separation

- [ ] Split `thermalSource`, `thermalTransport`, `piDiagnostics`, and `remoteWitness` state.
- [ ] Launch the FLIR companion independently from Pi diagnostics.
- [ ] Allow VR entry with either, both, or neither source present.
- [x] Provide an immersive controller- and hand-selectable Back to dashboard control.

Acceptance: one unavailable source never blocks or mislabels another source.

## 7. Meta landscape cover

- [x] Create and validate the canonical 2560 x 1440, 24-bit PNG locally.
- [x] Map the local file to `Cover art > Landscape` in the store-assets manifest.
- [ ] Confirm the correct Meta submission and metadata record.
- [ ] Upload and save the canonical asset in that record.
- [ ] Confirm Meta finishes processing the image without an asset error.
- [ ] Capture evidence that Developer Hub renders the intended cover instead of the placeholder.

Acceptance: Meta's application header visibly renders the intended landscape cover.

## 8. Physical and release verification

- [ ] Test FLIR on / Pi off.
- [ ] Test FLIR off / Pi on.
- [ ] Test both on and both off.
- [ ] Run USB reconnect, panel reopen, browser return, sleep/wake, and 30-minute soak tests.
- [x] Record `poc.4` code 4 as published to Alpha.
- [ ] Bump, build, sign, and verify `poc.5` code 5.
- [ ] Upload code 5 to Alpha and repeat the independence matrix.

Acceptance: all automated gates pass and the four-state physical matrix has recorded results.
