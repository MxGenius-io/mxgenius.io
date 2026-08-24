# Weekly Progress Report — Week 23
**Date Range:** Aug 17, 2026 — Aug 23, 2026
**Closing Build Note:** Aug 24, 2026
**Project:** MxGenius

---

## Executive Summary

- **Kudos first to Josh—the boss man gave the product its public face.** A fully formed landing-page direction arrived from the investor deck and was turned into a polished, flowing MxGenius experience in an afternoon. The page now tells one coherent aviation-maintenance story, keeps the media carousel for new content and videos, and replaces the oversized AI callout with a compact entry point.
- **Rocky turned a feedback idea into a real operating workflow.** In only a few focused passes, he delivered bug and feature reporting, annotated screenshots, private evidence storage, stable tickets, My Feedback, an administrator queue, status triage, internal notes, and a direct route back to the submitter. He also expanded Parts from a receiving demonstration into a broad procurement and inventory lifecycle.
- **Dwayne connected the product across browser, cloud, Quest, iPhone, and the shop-floor apparatus.** The week added shared patent and build-planning workspaces, upgraded the globe and VR scene, delivered a native ARKit TestFlight build, and carried the Quest thermal bridge through visible diagnostics, native spatial rendering, Realtime snapshots, deterministic commissioning, and the uploaded poc.12 USB-lifecycle candidate.

This was not a cosmetic sprint. It was the week the public story, internal operating workflows, and multi-device field experience began to look like one product.

## Josh gave MxGenius a landing page worthy of the product

The investor deck became the source of truth for a complete landing-page rebuild. The new page uses the deck's aviation imagery and pitch structure instead of trying to explain the platform through disconnected feature blocks. It flows from the operational problem into the product, the people it serves, and the larger roadmap.

The implementation retained the carousel because the site still needs a durable home for fresh media, demonstrations, and videos. The large GPT button was reduced to a compact AI entry point so it supports the pitch instead of competing with it. The canonical MxGenius logo and current live smoke checks were also aligned with the new page.

The important part is the speed: a fully considered direction was supplied, translated, tested, and live in the same afternoon. That is the kind of handoff that lets a small team move like a much larger one.

## Rocky turned “report a bug” into an accountable debug flow

Rocky's feedback system goes well beyond a form. Separate bug and feature buttons open a dashboard-wide reporter, while the bug shortcut works without interfering with normal typing. The reporter captures the current viewport, supports freehand, rectangle, arrow, and text annotation, accepts a replacement image from the clipboard, and keeps bug severity distinct from feature requests.

Submissions are authenticated and organization-scoped. Screenshots remain private, each item receives a stable human-readable ticket number, and the submitter can follow progress from My Feedback in Settings. Managers and administrators have a separate queue where they can move work through New, In progress, Needs info, Resolved, or Declined; leave internal notes that are never returned to the submitter; hide closed work by default; and contact the reporter directly.

The flow was deployed to the existing Azure application plane with additive migration 0018 and fail-closed unauthenticated routes. What started as two header icons now has enough traceability to support an actual product-feedback loop.

## Rocky also carried Parts from receiving into operations

Parts received the largest single functional expansion of the week. The stock lifecycle now supports receiving inspection, metadata correction, issue, transfer, reserve, return, scrap, ship, cycle counting, lot splitting, locations, and open-case shortages. Confirmation and version boundaries protect ledger-changing actions instead of allowing silent mutations.

The procurement lane now includes request queues and orders, traceability records and broader paperwork vocabulary, hands-free OCR review, headset inventory search, rotable and core obligations, warranty claims, gated cannibalization, and bulk CSV/XLSX import with preview, add-only mode, and rollback. A local developer path was also added so this stack can be exercised without rebuilding the production environment.

Those workflows shipped to Azure with migrations 0019 through 0023. The promoted revision became healthy and received production traffic only after database, readiness, authentication, and rollback gates passed. This is no longer a receiving mockup; it is the beginning of a governed shop-floor parts system.

## Dwayne connected the team's planning, evidence, and legal work

Settings gained two shared workspaces designed for work that should survive a conversation. The provisional-patent workspace holds proposed inventors, disclosure details, drawings, review state, filing readiness, private references, optimistic versioned saves, and immutable revision archives. The Build Board replaced the redundant tracker with open questions, current sprint work, completed items, updates, and private picture attachments so a physical decision can be recognized at a glance.

Reports were brought into the same Settings area, and the build board itself was refined so the lanes lead the composer, refresh is a small control instead of a warning bar, and pictures can travel with a card. Together these changes give the team one place to discuss the apparatus, one place to preserve the legal record, and one source-controlled place to review progress.

## The fleet map and VR scene became field tools instead of demonstrations

The globe received higher-resolution dark-map assets, anisotropic texture filtering, finer curvature, and zoom-aware screen-space clusters. Aircraft markers now have a stable point fallback during zoom transitions, while panel isolation and layering keep them behind the information drawer instead of painting over controls.

Inside XR, the AI presence moved from the wrist to the sensor panel, its point cloud became denser with smaller particles, and dedicated microphone, snapshot, and pin controls were added. The microphone now opens and closes its Realtime connection with the interaction instead of leaving a socket hanging.

The thermal presentation changed from an experimental orb to a direct screen. It can follow the headset, scale to the Quest camera view, be hidden or revealed, and be pinned into world space. The sensor-only scene remains separate from the fleet globe and avoids loading cached JetNet data. Thermal and Raspberry Pi diagnostics also remain independent so one source cannot produce a false ready state for the other.

## Quest thermal debugging became deterministic

The Quest companion moved from poc.5 through poc.12 during this reporting close. The early builds separated FLIR from the Pi, added the local browser seam, and tightened Meta packaging. Later builds rendered the native handshake trace in VR, moved the thermal image into a Meta Spatial SDK panel, added world pin/follow and reconnect controls, bounded frame conversion, preserved FLIR failure reasons, switched to the Iron palette, and added an ephemeral headset snapshot that can be sent directly into the active Realtime model context without being retained.

poc.11 introduced a one-shot commissioning run: first-frame timeout, a sustained native soak, ordered browser acknowledgements, and one retained JSON verdict in which the first failed boundary owns the result. poc.12 then addressed the remaining USB ownership race by declaring the FLIR attachment route, reporting VID/PID and device-scoped authorization in VR, preserving an already healthy stream, waiting for the interface to settle before rediscovery, and retrying only the FLIR re-enumeration error with bounded backoff.

The headset did render real thermal pixels during field testing, proving the SDK, camera, and native panel can complete the path. Repeated runs later exposed the flicker/disconnect lifecycle problem that poc.12 is designed to correct. The signed poc.12 APK passed the local release verifier, all 221 web integration tests passed, and the exact artifact was uploaded to the Meta Alpha channel. It remains a candidate—not a declared hardware victory—until a repeat run holds stable and reaches the final commissioning pass.

## Native iOS became its own spatial experience

The iOS repository added ten focused commits and closed on signed MxGenius 3.2.0 Build 33. What began as a thin wrapper now exposes a native ARKit fleet globe from the web dashboard's capability-gated AR button. The native scene includes JetNet pegs, familiar fleet filters, aircraft panel navigation, and independent world anchors for the globe, JetNet panel, and MxGenius AI point cloud.

The spatial controls were separated from their content so resizing a panel does not resize its buttons. Globe rotation remains available while the scene is locked, auto-spin is independently controlled, CAM-follow placement is separate from world lock, and gravity-aligned transforms keep panels upright across portrait and landscape. Safe-area, clipping, launch-screen caching, app icon, and MxGenius branding issues were corrected along the way.

The native point cloud can now control the existing web Realtime microphone and emit distance-aware spatial audio. The same bridge carries active globe, aircraft, 3D viewer, and session context between the native shell and the web application rather than creating a second disconnected product.

Build 33 completed a signed generic-device Release build and arm64 archive. App Store Connect accepted the TestFlight upload; Apple processing was still pending at the evidence cutoff.

## What the repositories show

| Evidence point | Recorded result |
| --- | --- |
| Main MxGenius reporting window | 60 commits after the Week 22 cutoff; 202 files changed, 27,685 additions, and 4,187 deletions |
| Dwayne-authored main-repository work | 38 commits across Quest, XR, AR bridging, planning workspaces, deployment records, map/UI refinement, and release hardening |
| Rocky-authored main-repository work | 20 commits, plus the shared feedback and Parts merge commits, covering feedback triage and the expanded inventory/procurement lifecycle |
| Native iOS update | 10 commits; 31 files changed, 2,082 additions, and 406 deletions; signed Build 33 accepted by App Store Connect |
| Production application release | Feedback and Parts Azure revision healthy with migrations 0018–0023, production readiness checks, fail-closed unauthenticated routes, and rollback retained |
| Quest Alpha candidate | Signed 0.1.0-poc.12, versionCode 12, release-verified and uploaded with exact artifact provenance |
| Automated application evidence | Final combined browser contract suite, including the Week 23 report contract: 222 passed, 0 failed |
| Source of truth | One shared main branch; the final Quest commit and the concurrent native AR microphone work were reconciled without a side branch |

---

*Prepared by Hermetic Labs for Advanced AOG*
