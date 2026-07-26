# Weekly Progress Report — Week 17

**Date Range:** Jul 6, 2026 — Jul 12, 2026
**Project:** Advanced AOG · Hermetic Labs

---

Hey Josh,

Heavy week — I rebuilt the dashboard from the ground up and did a complete UX overhaul on the front end. This was the "make it look like a real product" push.

---

## Dashboard Rebuild

Completely rebuilt the dashboard with:
- **Bulk export** — pulls all 295 fields per aircraft record for full data portability
- **IndexedDB caching** — the dashboard now caches fleet data locally so it loads instantly on return visits and works offline
- **New chart visualizations** — refreshed the analytics with cleaner, more informative chart layouts
- **Live data filters** — added Make, Type, and Status filter controls that populate from live API data and re-render all charts in real time
- **CHANGELOG.md** — started maintaining a proper changelog for the repo

## 3D Viewer & HDRI Environments

Replaced the placeholder HDRI backgrounds in the 3D model viewer with **real hangar, workshop, and neon grid environments**. The viewer now defaults to proper exposure (0.5) and opens with controls visible. Also fixed the HDRI shader mapping that was producing washed-out lighting.

## AI Chat Hardening

Spent time getting the AI chat panel production-ready:
- Fixed chat inference to use the correct `MXGENIUS_API_KEY` for Rust backend auth
- Fixed response parsing and added the **cloud loader thinking animation** while inference is running
- Cleaned up error handling in the inference pipeline
- Fixed the chat toggle close logic (it was getting stuck open)
- Fixed the A.S.S.I.R.T tab routing and prevented header overflow on narrow screens

## Landing Page Refresh

Redesigned the landing page with:
- Prominent GPT button integration
- Dual CTA layout with proper descriptions
- Refreshed hero section layout

## Globe & Fleet UX

Several fixes to the interactive globe and fleet panels:
- Globe now loads eagerly with the Fleet section open so the canvas has proper dimensions (was rendering 0x0 before)
- Added close button (X) and click-outside-to-dismiss on the globe info sheet
- Loading spinners on dashboard data fetches
- Fixed company/contact stat APIs — they were sharing a single fetch call when they needed separate ones

## UX Overhaul Sprint (Jul 7)

Big push on July 7 — compact stat-bar redesign, fixed company/contact API endpoints, added outreach text tabs, theme settings panel, for-sale aircraft list, and a cache version guard to bust stale Gulfstream-only data that was persisting from a prior API bug.

Then on the 8th, cleaned up by removing the stat bar entirely after it was replaced by cleaner inline displays, and cleared out all the dead stat code.

## Platform Walkthrough

🎬 **Video:** walkthrough.mp4

---

## Bottom Line

The walkthrough says most of it. Two things to flag:

1. With the text and logo finalized, we can close up the landing page.
2. With the layout and structured model output in place, we'll be ready for field testing.

---

*Prepared by Hermetic Labs for Advanced AOG*
