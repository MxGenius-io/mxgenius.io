# Friday Funding Demo Task List

Target: Friday, 12:45 PM America/New_York

The demo tells one connected story on the fictional `N350MX` Challenger 350.
Demo Content stays isolated from operational records and every seeded value is
visibly marked as demonstration data.

## 1. Fast win — strobe light

- [x] Seed a current strobe-light maintenance case as the first/latest case.
- [x] Attach a distinct inspection image showing the cracked, wet lens.
- [x] Add a synthetic strobe assembly, on-hand stock, trace, requirement, and
  sourcing option.
- [x] Connect the case to a short fictional work-card summary without inventing
  approved torque or maintenance limits.
- [x] Cold-test the web path: latest case opens, image is immediate, the matched
  strobe assembly is stageable, and the model returns the installation torque,
  bonding test, and operational check.
- [ ] Confirm the same strobe guidance in the physical headset workflow.

## 2. High-stakes job — main wheel

- [x] Seed an AOG right-main-wheel case with tire and brake findings.
- [x] Link the case to the wheel assembly, tire, brake lining, cotter pins, and
  thermal fuse plugs already present in demo inventory.
- [x] Preserve trace/certificate state and distinct wheel/brake imagery.
- [x] Cold-test the web path: case, Parts, model retrieval, demo SKUs, on-hand
  quantities, and current approved torque/procedure references stay on the same
  aircraft and job.
- [ ] Confirm the wheel diagram and step sequence in the physical headset.

## 3. Remote decision — windshield limits

- [x] Seed a pending left-windshield damage-limit review case.
- [x] Attach a dedicated outer-ply impact image and cockpit windshield target.
- [x] Add pending qualified-review state and a remote-witness-ready marker.
- [ ] Cold-test: headset producer, PIN join, remote view, human disposition, and
  evidence trail work without granting the remote viewer mutation authority.

## 4. Presentation quality

- [x] Keep the old hydraulic example in storage but hide it from Demo Content.
- [x] Convert flattened PDF excerpts into simple headings and step breaks in both
  the evidence preview and expanded Section text.
- [x] Use three visually distinct maintenance images and a separate strobe part
  image.
- [x] Verify Maintenance and Parts from a fresh browser session at presentation
  resolution.

## 5. Full cold calibration

- [x] Web: Demo Content on, latest case, all three cases, Parts, Copilot, images,
  pills, and expandable section text.
- [ ] Spatial/AR: case target, step guidance, and remote-witness button visible.
- [ ] VR: join-live-service control restored and remote witness joins cleanly.
- [ ] Thermal: charged camera, no frame burn, stable capture, and evidence save.
- [ ] Pi: registered device online, current Equipment Drive assigned, manuals and
  linked images available, USB mass-storage path checked if soldering is ready.
- [ ] Recovery: rehearse a browser-only fallback for every hardware-dependent
  beat so the story can continue without dead air.

## Acceptance order

Run the three cases in order: strobe, wheel, windshield. Do not begin with the
hardware stack. Establish the web case and evidence first, then hand the same
case into the headset, thermal, remote witness, Parts, and Pi surfaces as each
beat requires.

## Cold calibration evidence

- Fresh production session: exactly three Friday maintenance cases and six
  relevant Parts records appeared with distinct strobe, wheel, and windshield
  imagery.
- Strobe: natural-language guidance returned registered manual evidence, source
  pills, readable excerpts, and expandable section text. Headset handoff remains
  a physical-device check.
- Wheel: natural-language guidance stayed on the active aircraft and job and
  returned applicable part/procedure evidence. A display-only `null` estimate
  was normalized to `Not established`. Diagram rendering is covered by the
  final production replay below.
- Windshield: natural-language guidance returned the Chapter 56 zone/slope
  inspection method and preserved the qualified-review boundary. The two
  Figure 601 sheets are hash-registered derived PNGs; no source PDF was copied
  into the application. PIN join, live headset video, and human disposition
  remain physical-session checks.
- Production replay (`854a8d8`): the active `Challenger 350` case resolved the
  `CL350` catalog key, rendered Figure 601 Sheet 1 from its registered source,
  and kept the evidence pill and expandable record together. The wheel replay
  stated that labor hours were not established by the retrieved material and
  did not render a literal `null` value.
- Final model/web replay (`5b17355`, Azure revision
  `mxg-core--final5b17355`):
  - The strobe case identified the stageable `MXG-DEMO-33-5101` assembly and
    returned the 20–25 lbf-in installation torque, bonding test, and operational
    check from the registered source.
  - The wheel case staged all five case-linked requirements from current
    tenant inventory: one OH outboard wheel, one NE tire, one NE brake-lining
    set, two NE cotter pins, and four NE thermal fuse plugs. It returned the
    brake-unit torque of 55–57 lbf-ft (74.57–77.28 Nm) and the applicable wheel,
    brake, bleed, leak-check, transducer, hub-cap, and operational-test tasks.
  - The windshield case rendered Figure 601 Sheet 1 as a registered manual
    image with its source pill and expandable section text.
  - Opening Copilot collapsed the hamburger menu as expected.
  - `/healthz`, `/readyz`, and `/adapterz` returned 200; the database, frozen
    `manuals-catalog-v3` pack, Parts, remote witness, and spatial scan reported
    ready or available. The Rust workspace passed 313 executable checks with
    one intentional live-cloud test ignored, and Clippy was clean.
