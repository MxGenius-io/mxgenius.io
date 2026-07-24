# Changelog

All notable changes to the MXGenius project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [3.2.0] — 2026-07-24

### Added — Aircraft Detail Modal
- **Features Section** — Badge grid rendering all aircraft features with item count and status indicators (e.g. Standard, Optional)
- **Additional Equipment Section** — Responsive card grid with glassmorphic cards showing equipment name and description
- **Lease Information Section** — Table view with lease type, lessor, start/end dates, and status
- **Operational Status Badge** — Green (Active) or amber badge rendered in the detail header alongside aircraft type

### Added — Market Intelligence
- **Market Intelligence Collapsible** on Dashboard — new `<details>` section with make/model search
- **Operating Costs Card** — Fuel/hr, crew/yr, maintenance/hr, hangar, insurance, total hourly, fuel burn rate, annual budget
- **Performance Specs Card** — Range, max/cruise speed, ceiling, takeoff/landing distance, passengers, cabin length, wingspan, MTOW
- **Market Trends Card** — Average ask/sold price, fleet size, for-sale count, absorption rate, days on market

### Changed — API Layer (`application-client.js`)
- `aircraftBundle()` now fetches **7 endpoints in parallel** (was 3): added `getFeatures`, `getAdditionalEquipment`, `getLeases`, `getStatus`
- Added `modelOperationCosts()`, `modelPerformanceSpecs()`, `modelMarketTrends()` — all via `Model/` API group
- All new calls wrapped in `safeJson()` — failed sub-calls never break the parent view

### Changed — Data Flow
- Detail modal destructures 4 new bundle fields (`features`, `equipment`, `leases`, `status`)
- `setupMarketIntel()` wired into `setupEventListeners()` for keyboard (Enter) and button handlers
- Zero hardcoded/mock data — all endpoints production-piped through `mxg-fleet` proxy

---

## [3.1.0] — 2026-07-07

### Added — Data Layer
- **IndexedDB Cache (`cache.js`)** — Transparent caching wrapper with configurable TTLs
  - `cachedFetch()` drop-in replacement for `fetch().then(r=>r.json())`
  - TTL presets: Utility (24h), Bulk (15min), Detail (30min), Short (5min)
  - Cache stats display in Settings, manual "Clear Cache" button
- **Bulk Aircraft Export Integration** — Switched from `getAircraftList` (23 fields) to `getBulkAircraftExportPaged` (295 fields per aircraft)
  - Single API call replaces 3+ separate calls (~95% reduction in API traffic)
  - Unlocks: ADS-B status, engine TBO/TSN, maintenance programs, asking prices, lease data, hex codes, estimated cycles/hours

### Added — Dashboard Charts
- **ADS-B Compliance Donut** — CSS conic-gradient donut showing equipped vs. not-equipped fleet percentage
- **Fleet Age Distribution Histogram** — Bar chart by manufacturing decade (1950s–2020s)
- **Engine Health Overview** — Traffic-light gauge bars (Good <60% TBO / Caution 60-85% / Due Soon >85%)
- **Maintenance Program Breakdown** — Bar chart of airframe maintenance programs across fleet
- **Recently Listed For Sale** — Replaces dead "Recent Transactions" table (tier blocks history data) with clickable listing table showing date listed, asking price, base city

### Added — Dashboard Stat Cards
- Secondary stat row with 4 new metrics:
  - **ADS-B Ready** (cyan) — count of `hasadsb === 'Y'`
  - **Avg Fleet Age** (purple) — computed from `yearmfr`
  - **Est. Cycles** (green) — aggregated `estcycles`
  - **Maintained %** (pink) — percentage of fleet with `maintained === 'Y'`

### Added — Settings
- **Data & Cache** settings card with:
  - Live cache entry count
  - Clear Cache button
  - API Tier display (Aerodex Live · Max 120,000 records)

### Changed
- Dashboard grid upgraded from fixed 2-column to responsive `auto-fit minmax(320px, 1fr)`
- `loadDashboard()` now renders with flat zeros when backend is offline (no early return)
- FAA AD fleet scan now uses `modelicao` from bulk export for better ICAO cross-referencing

### Added — API Probes (dev tools, not committed)
- `probe_jetnet.js` — Tier discovery script, tests all 19 JetNet endpoints
- `probe_deep.js` — Deep probe with POST method retry, dumps all 295 bulk export field names

### Discovered — JetNet API Tier (Aerodex)
- **16/19 endpoints available** on current subscription
- **295 fields per aircraft** via Bulk Export
- Tier constraints: `historyavailable: false`, `flightsavailable: false`, `evaluesavailable: false`
- 405 endpoints (Make List, Model List, Airport List, etc.) resolved by using POST instead of GET

---

## [3.0.4] — 2026-07-07

### Changed — UI Restructure
- Consolidated Fleet Globe, Aircraft, and Outreach into collapsible `<details>` sections in Dashboard
- Removed dedicated tabs for Globe, Aircraft, and Outreach
- Moved Chat and Work Order buttons to header navigation (right-aligned)
- Implemented click-outside-to-close for Work Order panel
- Added Settings tab with Auto-Speak toggle, Accent Color picker, Compact Mode toggle
- Added GPT link button on landing page with descriptive text
- Restored MxGenius logo link back to landing page from dashboard
- Replaced 3D Viewer tab text with icon

---
