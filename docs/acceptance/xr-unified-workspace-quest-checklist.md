# Unified XR workspace · Quest acceptance record

This is the release record for `XR 09 · Run unified workspace acceptance on Quest`.
It separates repeatable software evidence from observations that require a physical
Quest. Do not mark a physical row `PASS` from source review, browser emulation, or
an automated test.

## Candidate identity

| Item | Required candidate | Observed |
| --- | --- | --- |
| Web application | `https://mxgenius.io/3d-viewer/` at the deployed release commit | Runtime candidate `404c7a9b1441b76bdc44f897c2840a4a88ed00a5`; record the final deployed commit at run time |
| Companion | MxGenius Sensor Bridge `0.1.0-alpha.25` (`versionCode 25`) | Local release APK available |
| Release APK | `services/xr-flir-companion/app/build/outputs/apk/release/app-release.apk` | 176,508,634 bytes |
| APK SHA-256 | `970df1c93741579005c3095649bf3f4fbbf8ce326e1517d08400fc5d3a88977a` | Verify before sideload |
| Meta Alpha channel | Must match the candidate used for acceptance | Still publishes alpha.23 (`versionCode 23`); sideload alpha.25 or publish it before the run |

Overall physical verdict: **PENDING PHYSICAL RUN**

Operator: ____________________  Quest serial: ____________________

Date/time: ____________________  Deployed commit: ____________________

Companion install source: ☐ sideloaded alpha.25  ☐ Meta channel updated to alpha.25

## Automated preflight

Run from the repository root:

```powershell
npm run preflight:xr
```

| Evidence | Result | Notes |
| --- | --- | --- |
| Focused unified-XR Node suite | PASS | 57/57 on 2026-09-27 |
| Full application test suite | PASS | 515/515 on 2026-09-27 |
| Android companion unit tests | PASS | Gradle `testDebugUnitTest` on 2026-09-27 |
| Release APK identity and signature verification | PASS | alpha.25, code 25, ARM64, release signature and expected SHA-256 verified on 2026-09-27 |
| Live canonical route and legacy-route fence | PASS | Canonical viewer and explicit legacy-service fence verified on deployed runtime `404c7a9` |

## Physical Quest matrix

Use `PASS`, `FAIL`, or `BLOCKED`. Every `PASS` needs a short observation or an
artifact reference. Preserve screenshots, recordings, and logs outside this file
when they contain customer or tenant data.

| ID | Journey / fault | Expected evidence | Result | Observation / artifact |
| --- | --- | --- | --- | --- |
| XRQ-001 | Confirm build identity | Installed companion reports alpha.25/versionCode 25 and the web commit matches the candidate | PENDING | |
| XRQ-002 | Enter the canonical spatial workspace | One launcher creates one immersive session and one compact system menu; no duplicate or head-locked clutter | PENDING | |
| XRQ-003 | Open World | Mature globe, fleet, nodes, and locations render without a competing legacy scene | PENDING | |
| XRQ-004 | Use fleet filters and JetNet imagery | Filters are selectable, imagery resolves where available, and stale/public flight data is labeled honestly | PENDING | |
| XRQ-005 | Select a World marker | Asset selection creates typed context and opens Focus without restarting the XR session | PENDING | |
| XRQ-006 | Controller interaction | Ray, select, scroll, window controls, and contextual action work from both controllers | PENDING | |
| XRQ-007 | Hand interaction | Dwell/hand selection operates the same actions without accidental double activation | PENDING | |
| XRQ-008 | Move World → Focus → World | Session ownership remains stable and asset/case/device context survives both directions | PENDING | |
| XRQ-009 | Inspect a model in Focus | Model loads, part raycast resolves the intended part, and selection remains legible | PENDING | |
| XRQ-010 | Return to context | Contextual return restores the prior asset, case, or live device without reconstruction | PENDING | |
| XRQ-011 | Ask AI | Prompt carries the selected context, produces one bounded response, and exposes failure without a retry/death loop | PENDING | |
| XRQ-012 | Capture | A capture is created once, associated with the current context, and cancel/denial leaves no false success | PENDING | |
| XRQ-013 | Thermal | Thermal appears only when available; follow is opt-in, pin is stable, and it does not overlap the active panel | PENDING | |
| XRQ-014 | Window lifecycle | Only one normal window is active; minimize, maximize, close, and context replacement behave predictably | PENDING | |
| XRQ-015 | System menu | Recenter, sound, service/diagnostics, and exit are reachable and do not spawn a second menu | PENDING | |
| XRQ-016 | Start Remote Witness | Consent is explicit, a guest PIN is created once, and pause/resume/end remain available | PENDING | |
| XRQ-017 | Recover witness video | Guest frames visibly advance; black/stalled video enters bounded recovery and resumes without last-frame freeze | PENDING | |
| XRQ-018 | Witness audio | Guest microphone/audio state is honest; received audio plays or reports a specific unavailable state | PENDING | |
| XRQ-019 | Handoff VR → AR → VR | Supported handoff keeps context and window state, avoids a second renderer, and never loses the session silently | PENDING | |
| XRQ-020 | Network and stale-data faults | Network loss, restoration, and stale flight data produce bounded recovery and truthful status | PENDING | |
| XRQ-021 | Companion and permission faults | Companion/FLIR loss, denied permission, and interrupted consent recover or stop cleanly with no false completion | PENDING | |
| XRQ-022 | Exit and soak | After a 20-minute mixed-use soak, Exit releases media tracks, sockets, timers, XR session, and GPU resources | PENDING | |

## Release decision

- [ ] All automated preflight rows pass on the candidate.
- [ ] All 22 physical rows pass on the same candidate, or every exception has an
  accepted owner and release decision.
- [ ] Remote Witness shows advancing frames after a forced stall/recovery.
- [ ] No session loss, duplicate renderer, duplicate menu, or head-locked clutter
  occurs during World/Focus movement or VR/AR handoff.
- [ ] Legacy routes remain fenced until this record is signed.

Final decision: ☐ PASS  ☐ FAIL  ☐ BLOCKED

Signed by: ____________________  Date/time: ____________________
