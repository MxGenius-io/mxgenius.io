# XR frontend pre-push audit

Date: 2026-08-31

## Build state

- WebXR HUD is implemented as Three.js scene content with a desktop preview.
- The target reveal is continuous: brackets, silhouette, leader, evidence card, then a restrained finish effect.
- Controller, fingertip, and desktop pointer actions use the same HUD objects.
- All 26 candidate WAV cues are registered and resolve from the runtime manifest.
- UI cues are listener-relative; target cues use `THREE.PositionalAudio` on the selected mesh.
- Audio unlock, mute, preload, loop exclusivity, visibility cleanup, and 70 ms release fades are implemented.
- Voice reaches the existing realtime control, Capture reaches the rendered-frame snapshot bridge, and Clear retracts then resets the real selection and evidence state.
- Capability dots no longer claim unmeasured cloud health.

## Verification complete

- `npm test`: 226 passing, 0 failing.
- Focused structural suite verifies all 26 cue paths exist.
- Desktop preview loads and decodes all 26 WAV files with HTTP 200 responses.
- Sound On/Off recovers from mute without reloading.
- Clear removes the selected material highlight and stale evidence; Acquire can establish a new preview referent afterward.
- Browser console contains no HUD or audio errors.

## Remaining validation gates

These do not block a source push, but they do block calling the experience headset-validated:

1. Run on the target Quest/WebXR build to judge panel distance, controller reach, fingertip false activations, stereo direction, and cue loudness against live voice.
2. Listen through every candidate cue. The current files are intentionally replaceable and may need creative revision.
3. Confirm the off-screen evidence capture in an authenticated live realtime session and verify the captured left-eye view is correctly oriented.
4. Test reduced-motion behavior and browser audio interruption/resume on the headset.

## Known future integrations

- Compare advances the verification state and emits the canonical XR action; the cross-source comparison result still needs its application consumer.
- Guide emits the canonical XR action and spatial cue; authored procedure-path generation and target-arrival events are not mounted yet.
- Relocalization, degraded capability, reconnection, permission, and safety cues are available through `mxgenius:xr-audio-cue`, but require authoritative tracking/capability events before automatic playback.
- Haptic patterns have not been authored or mapped.
- Candidate masters are 44.1 kHz/16-bit WAV. The browser resamples them successfully, but 48 kHz/24-bit masters or compressed runtime derivatives remain a production optimization.

## Push scope

Include the HUD/audio modules, viewer/dashboard integration, tests, the FX intake tree, and design documentation. Exclude unrelated `output/` and `tmp/` working directories.
