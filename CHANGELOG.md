# Changelog

All notable changes to the MXGenius project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [Unreleased]

### Added — XR edge hardware pivot

- Established [`MXG-PIVOT-2026-08-14-XR-EDGE-V1`](docs/PIVOT_2026-08-14_XR_EDGE.md) as the audited reference boundary for browser VR/AR, the Quest FLIR companion seam, Raspberry Pi diagnostics, scanners, Remote Witness, external providers, and future MCP sensor projections.
- Added the standalone Raspberry Pi kiosk and exact release payload with local preview, cold SD-card staging, SSH updates, diagnostics state/deltas, Bluetooth summary, scanner observations, and synthetic `MXGS/1` thermal testing.
- Added the fleet-globe thermal/diagnostics orb with controller and hand interaction, session binding, Pi metrics, scanner observations, and fail-closed companion setup states.
- Added canonical XR session, diagnostics, scanner, evidence, and Remote Witness schemas under the deployable kiosk contracts directory.
- Added the public AviationWeather.gov METAR/TAF adapter and a staged PartsBase client behind the shared server-only provider authentication boundary.
- Added the branded Pi commissioning surface with FLIR and scanner readiness cards, a bounded device-local Live log with JSONL export, and normalized AviationWeather, PartsBase, and Honeywell Forge fixture previews.
- Added a schema-backed local integration fixture endpoint so the kiosk, headset, and orchestration layers can exercise stable provider-neutral shapes before live authentication is enabled.
- Added the FLIR Android 2.22.0 Quest companion source, external-SDK build lane, browser deep-link/Android-intent activation, foreground thermal relay, and a locally built ARM64 debug APK without committing licensed vendor AARs.
- Added a canonical sensor-companion schema plus relay → Quest app → FLIR ONE readiness indicators; browser launch attempts are no longer treated as proof that the native bridge or camera is present.
- Promoted the signed Quest companion to private Meta Alpha build `0.1.0-poc.2` (`versionCode 2`), recorded its clean release-channel fallback URL, and kept authenticated WSS relay presence as the activation gate.
- Added the verified 24-bit 2560×1440 Meta landscape cover and a metadata manifest that records its portal location, dimensions, and checksum separately from the APK.
- Recorded Meta's non-blocking `libssh2` advisory in the vendor-supplied FLIR Atlas 2.22.0 native library for resolution before any public Store submission.

### Changed — Authoritative source consolidation

- Made the frozen CL350 manual-pack manifest the source of truth for approved manuals, Azure AI Search index identity, MiniLM model and vector dimensions, asset hashes, excluded sources, and unverified currency state.
- Added read-only corpus reconciliation, embedding readiness validation, aircraft-model applicability resolution, explicit manual-retrieval states, and fail-closed production readiness.
- Standardized XR session identifiers across browser, Pi, and gateway contracts; stale sensor nodes now disconnect explicitly and scanner candidates remain unverified until catalog resolution.
- Removed a tracked JetNet identity and password from legacy live-probe scripts; probes now require `JETNET_IDENTITY` and `JETNET_CREDENTIAL` at runtime and no longer print token fragments. The exposed credential must be rotated outside the repository.
- Recorded the operator's confirmation that the previously exposed JetNet credential was already rotated when the live integration moved to environment variables.
- Recorded that the authenticated XR relay negotiation route, FLIR-on-Quest hardware validation, PartsBase credentials, Remote Witness media room, persistence, and MCP sensor tools remain activation gates rather than completed runtime capabilities.

### Improved — Market Intelligence selection

- Replaced free-form make and model fields with cascading dropdowns populated from the models available to the JetNet Customer API subscription.
- Corrected the card to use JetNet's Model Intelligence contract and display the selected model's cost, market, performance, cabin, and profile data.

### Fixed — Structured response panel release

- Corrected the chat panel so it closes normally after a structured response.
- Updated the release check for the current frontend assets.
- Confirmed the deployed release against the public frontend, core health and readiness, authentication boundary, and browser CORS checks.

### Added — Rocky parts handoff

- Refreshed the guided onboarding wizard with a dedicated seven-step Parts & Procurement path.
- Added a nontechnical Rocky build report, send-ready email, and production walkthrough for sign-in, receiving, OCR review, FAA candidates, and QR labels.

### Added — End-to-end chat diagnostics

- Added browser-console request, response, rejection, and completion records keyed by one correlation ID.
- Returned OpenAI rejection status, code, type, message, request ID, selected model, tool count, and request iteration to the authenticated frontend.

### Fixed — Structured text chat model availability

- Made the text-model picker reflect the models available to the configured OpenAI project instead of presenting inaccessible choices.
- Added GPT-5.4 mini as the cost-conscious default while retaining GPT-5.5 and available GPT-5.6 tiers.
- Added server-side accessible-model selection so a stale profile choice cannot strand structured chat on an unavailable model.
- Prevented model-authored prose from claiming application or connection readiness.
- Kept strict structured output, MCP tool orchestration, threads, images, and Realtime behavior intact.
- Applied the expanded structured-advisory layout on the first rendered or restored advisory instead of waiting for a later response.

### Fixed — FAA aircraft identity resolution

- Restored the aircraft-card FAA flow by resolving the JetNet source record to its tenant-scoped canonical aircraft UUID before requesting candidate Airworthiness Directives.

### Fixed — Realtime and application shell

- Restored the shared authenticated application request helpers used by profile, case, and digital-twin APIs.
- Corrected Realtime WebRTC multipart MIME types for the SDP offer and JSON session payload.
- Prevented profile loading from disabling Appearance controls and stopped duplicate settings bindings.
- Replaced invalid globe HTML-element updates and silenced retired static RAG asset requests by default.
- Removed redundant iframe fullscreen attributes and refreshed frontend asset versions.
- Removed the redundant Maintenance Operations dashboard heading and subtext.

### Added — Digital twin meshes

- Added authenticated, tenant-scoped GLB upload and retrieval with parsed mesh/node manifests.
- Added user/model highlight synchronization so MCP can set or read the exact raycast selection.
- Wired model-issued highlights into text chat, Realtime tool calls, and the embedded 3D viewer.
- Removed the Sketchfab catalog dependency in favor of owned and user-uploaded model assets.

### Added — Conversation, images, and corpus expansion

- Added bounded JPEG, PNG, and WebP attachments to text chat and Realtime messages.
- Added a Settings content-upload control and authenticated Azure Blob staging endpoint for later RAG ingestion.
- Kept the strict structured maintenance advisory schema active for multimodal requests.

### Fixed — Conversation continuity and manual evidence

- Injected tenant-scoped persisted thread history into model requests so conversational memory survives page reloads.
- Persisted completed Realtime user/assistant exchanges into the same tenant-scoped threads used by text chat.
- Added one Realtime companion-output lane that renders the authoritative structured response, citations, manual images, tables, and UI actions in chat before returning its concise summary for speech.
- Routed typed text and images through the same companion lane while Realtime is active, preventing independent spoken and visual answers.
- Prevented companion speech transcripts from creating duplicate chat bubbles or duplicate persisted thread exchanges while retaining the fallback persistence path for direct operational tool responses.
- Supplied bounded active-case, Market Intelligence, digital-twin highlight, manual-image, and prior-response context so follow-up turns can discuss what the user is viewing without treating UI text as authoritative evidence.
- Persisted the structured advisory envelope with its manual records and image lineage so reopening a thread restores the same visual answer and conversational context.
- Added persisted-case reopening and automatic restoration so Active Case survives page reloads.
- Filtered conversations by their bound case and resets the selected thread when Active Case changes.
- Made finalized Realtime user transcription transient after five seconds while retaining the completed chat turn.
- Kept retrieved manual diagrams visible through the controlled asset proxy and now shows an explicit unavailable state when an image cannot load.

### Added — Text model selection

- Added a server-persisted Settings selector for GPT-5.6 Luna, Terra, Sol, and GPT-5.5.
- Defaulted text and structured output to cost-efficient GPT-5.6 Luna while preserving strict schema, image input, and MCP-backed function orchestration across every selectable tier.
- Rejected arbitrary and incompatible model identifiers at the authenticated server boundary.

### Fixed — Market Intelligence and API routing

- Scoped the legacy PUT-to-POST translation to the fleet compatibility client instead of rewriting every application API request.
- Restored canonical PUT behavior for profile images and digital-twin highlight state.
- Added explicit partial/error states for market intelligence and escaped provider-returned values before rendering.

### Fixed — Closed-beta access

- Replaced the browser-local whitelist with organization-scoped server persistence.
- Corrected the incomplete `@advancedaog` rule to `@advancedaog.com`.
- Added `@mxgenius.io` and `rocky@mxgenius.io` as protected organization access rules.
- Assigned Rocky's protected identities the procurement role required to exercise the Parts receiving workflow.
- Added managed-identity Microsoft Graph invitations for exact email additions.
- Made the application API verify membership after Entra sign-in and enroll matching invited guests as viewers.

---

## [3.3.0] — 2026-07-26

### Changed — Chat and model output

- Added bounded 12-turn text conversation context while retaining `store: false`.
- Added a bounded server-side Responses tool loop that exposes only available, read-only MCP capabilities.
- Added post-generation validation that rejects citations outside the exact retrieved `M-##` record set.
- Wired the initialized DeepSeek model into a constrained on-device fallback when cloud chat is unavailable.
- Updated the default text model configuration to `gpt-5.6-sol`; deployments can continue to override it with `MXGENIUS_OPENAI_TEXT_MODEL`.

### Changed — MCP

- Added the complete browser lifecycle: `initialize`, protocol/capability validation, `notifications/initialized`, then list/call.
- Added registry availability metadata and removed `not_configured` tools from the Realtime model catalog.
- Classified every mutation action as confirmation-required at the catalog boundary.
- Added bounded browser MCP timeouts and stable transport error codes.

### Changed — Voice and Realtime

- Migrated WebRTC session creation to the current nested Realtime audio contract with `gpt-realtime-2.1`, `marin`, `gpt-4o-mini-transcribe`, and server VAD defaults.
- Added explicit voice states, visible status, finalized transcript turns, active-response tracking, bounded reconnect with jitter, and event correlation IDs.
- Removed unconditional response cancellation on normal server-VAD speech detection.
- Stopped returning upstream Realtime error bodies to browsers.

### Changed — Reliability

- GitHub Pages deployment now depends on frontend tests, Rust formatting, workspace tests, and clippy with warnings denied.
- Added contract tests for Realtime session shape, MCP lifecycle ordering, catalog filtering, VAD interruption, cleanup, citation validation, and fallback wiring.
- Added safe correlated completion telemetry for chat and Realtime call exchange.

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
