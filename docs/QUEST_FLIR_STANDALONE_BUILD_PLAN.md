# Quest FLIR standalone build plan

Status date: 2026-08-17
Target release: `0.1.0-poc.5` (`versionCode 5`)

This checklist covers software architecture, automated verification, packaging, and distribution plumbing. Hardware and headset field testing are intentionally not build blockers and are not tracked here.

## 1. Independent system boundaries

- [x] Define FLIR, Pi, WebXR, and remote-witness connections as separate lanes.
- [x] Make Azure negotiation optional and unrelated to local camera readiness.
- [x] Remove Pi messages and capabilities from the FLIR companion contract.
- [x] Add automated assertions preventing Pi/Bluetooth dependencies from returning to the APK.

## 2. Standalone Quest companion

- [x] Permit launch from the Meta library without a browser deep link.
- [x] Start the foreground camera service without a session or relay.
- [x] Enable FLIR discovery and USB permission without transport activation.
- [x] Keep optional WebXR activation additive instead of mandatory.
- [x] Reserve `0.1.0-poc.5` (`versionCode 5`) for the standalone implementation.

## 3. Native floating-panel preview

- [x] Add an aspect-preserving thermal preview surface.
- [x] Deliver throttled camera frames from the service to the Activity.
- [x] Render standby, permission, streaming, offline, and failure status independently of transport.
- [x] Clear the preview and camera resources during component teardown.

## 4. Remove Pi coupling from the APK

- [x] Remove Pi status and controls from the FLIR panel.
- [x] Remove Bluetooth permissions and required Bluetooth hardware.
- [x] Remove automatic Pi connection and Pi relay forwarding.
- [x] Remove the Quest-side Pi diagnostics client and tests.

## 5. Quest-owned WebXR thermal transport

- [ ] Define a `ThermalTransport` boundary so capture never depends on a connection.
- [ ] Move the existing WSS client behind that boundary as an optional remote adapter.
- [ ] Implement a Quest-owned local transport adapter for the WebXR consumer.
- [ ] Keep `MXGS/1` framing, throttling, and backpressure consistent across adapters.
- [ ] Add deterministic producer/consumer tests using synthetic frames.
- [ ] Ensure transport failure cannot stop or relabel the native camera preview.

## 6. Frontend source separation

- [ ] Replace the shared sensor-chain state with `thermalSource`, `thermalTransport`, `piDiagnostics`, and `remoteWitness` state.
- [ ] Give thermal and Pi connections separate configuration keys and URLs.
- [ ] Launch the FLIR companion without negotiating or deriving a Pi endpoint.
- [ ] Allow the scene to render with either, both, or neither source configured.
- [ ] Add synthetic browser tests for all four source combinations.
- [x] Provide an immersive controller- and hand-selectable Back to dashboard control.

## 7. Automated APK and release gates

- [ ] Add a packaged-layout assertion for the native thermal preview.
- [ ] Fail verification if Bluetooth permissions, Pi controls, or Pi capabilities return.
- [ ] Add standalone-launch and optional-activation contract tests.
- [ ] Build and verify the signed ARM64 release APK.
- [x] Record `poc.4` code 4 as published to Alpha.

## 8. Meta landscape cover

- [x] Create and validate the canonical 2560 x 1440, 24-bit PNG locally.
- [x] Map it to `Cover art > Landscape` in the store-assets manifest.
- [ ] Confirm the asset is assigned to the active Meta submission metadata record.
- [ ] Correct the upload or assignment if Meta still references the placeholder asset.
- [ ] Record the resulting Meta asset identifier in local release metadata.

## 9. Package and publish

- [ ] Update release notes and artifact metadata for `poc.5` code 5.
- [ ] Run the complete web, Android, schema, and APK verification suites.
- [ ] Produce the signed release APK and record its size and SHA-256 digest.
- [ ] Upload code 5 to the Alpha channel.
- [ ] Update the published-build record after Meta accepts it.
