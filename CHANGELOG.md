# Changelog

- 2026-09-01: Corrected the iOS spatial globe at its material layer: baked map imagery now has an explicit exposure multiplier, PBR lights follow that exposure, the emissive atmosphere halo was removed, and compact pegs are seated against true globe surface normals. Replaced the always-visible horizontal brightness strip with a sun toggle and vertical slider. Repaired the native AI handshake by cache-busting both corrected Realtime scripts, forwarding connection failures to AR, tracking ICE phases, and treating the open WebRTC data channel as the authoritative socket-ready signal. Added coverage for Safari's delayed peer state; the matching wrapper is MXGenius 3.2.0 build 38.
- 2026-09-01: Made both globe side-arrow controls readable against transparent map and scene content with opaque dark capsules, cyan borders, and stronger focus/hover shadows. Moved native AR event registration out of the fleet-button setup so the 3D spatial-scene AI microphone always reaches the same authenticated Realtime bridge as the main chat, even when the fleet control was never initialized. Added native spatial-scene brightness control, and uploaded the matching wrapper as MXGenius 3.2.0 build 35; App Store Connect accepted it with no upload errors or warnings and began TestFlight processing.
- 2026-09-01: Repaired the native iOS AR entry path after field reports that the globe control disappeared or fell through to browser behavior: the registered `JetNetNative` bridge and its capability response are now authoritative even when the remote Capacitor page identifies as web, while ordinary browsers still fail closed with the AR controls hidden. The embedded 3D viewer now trusts that verified parent capability and sends model ID, file, provider, and asset URL context into the spatial scene. The native fleet panel was updated to mirror the browser globe sheet with aircraft/mapped/country metrics, urgency filter chips, and fleet-location cards. The matching wrapper was uploaded as MXGenius 3.2.0 build 34 and accepted for TestFlight processing.
- 2026-09-01: Closed three shortcomings a QA pass left open in the parts component. Quantity is now bounded in one published place matching the `numeric(12,3)` columns, so a count the column cannot hold is refused as a `400` naming the limit instead of reaching Postgres and returning `503 persistence is temporarily unavailable` — a validation error that had been asking operators to retry something that could never succeed. The bound covers both ends and all five ingress points, including two the finding missed: a split whose remainder rounds to `0.000`, and bulk import, where a single out-of-range cell used to roll the whole batch back with no per-row diagnostic. Added `MXGENIUS_INSECURE_LOCAL_ROLE` so the quarantine-release buy-off — restricting who may put stock on the serviceable shelf — can finally be walked as each role on a developer machine rather than only unit-tested on its predicate; it is gated on `--insecure-local` without `--pilot`, refuses to boot on an unknown role rather than defaulting to administrator, and the provider now derives qualified approval from the role instead of granting it unconditionally, which had made any local role test quietly meaningless. Collapsed a fourth copy of the role list that sat on the production membership path. An exported stock file now re-imports: the legacy `coc` trace value it may carry is preserved with a row note rather than rejected, so the export still doubles as the template while a new record still cannot claim an anonymous certificate.
- 2026-08-24: Completed the browser half of the MXGenius iOS spatial-AR sprint: the fleet globe now supplies native urgency metadata for browser-matched map filters, globe raycasts populate the JetNet location panel, aircraft selections load detail and gallery data, and the native AI microphone opens and closes the same authenticated Realtime voice session used by the browser and VR scene. Added a scoped `MXRealtimeVoiceBridge` so the AR controls can safely reach the chat-owned WebRTC session, including clean disconnect and distance-aware HRTF audio access. The matching native wrapper shipped as MXGenius 3.2.0 build 33 and was accepted for TestFlight processing.
- 2026-08-19: Unblocked the parts stock lifecycle, which could previously receive a part and never release it: every confirmed unit was inserted with its status hardcoded to `quarantine` and no code moved it anywhere else, so only one of the eleven inventory event types the schema defines was reachable. Added the stock unit transition graph to the shared domain crate, then the movements that use it — receiving-inspection disposition (`POST /api/parts/units/:id/transitions`), issue, transfer, reserve, return, scrap, ship, per-unit cycle counting (`POST .../quantity`), and lot splitting (`POST .../splits`) — plus versioned metadata correction (`PATCH /api/parts/units/:id`, emitting `metadata_corrected`) and inventory location CRUD. Every ledger mutation carries a signed single-use confirmation bound to the unit and its version; releasing stock from quarantine is additionally restricted to Quality, Manager, and Administrator as an inspection buy-off, while rejecting stays open to any role that can receive. Added a Shortages view setting open-case `part_requirements` against genuinely free stock (quarantined, reserved, and issued stock excluded, unacceptable condition codes excluded, AOG first), a Locations view, status and location filters on the inventory grid, and a manual-entry path in the receiving wizard, which previously could not create a part at all without an image upload. All eleven event types are now reachable and a test asserts it.
- 2026-08-18: Added a full triage workflow to the org-wide Feedback Queue: every report now gets a stable ticket number (`FB-1042`, shown to the submitter too, including in the post-submit confirmation), a Manager/Administrator-gated `PATCH /api/feedback/:id` route moves a report through status (New / In progress / Needs info / Resolved / Declined) and records admin-only internal notes (never returned to the submitter), and the Feedback Queue (Admin) page exposes both from the detail view alongside a one-click "Contact submitter" mailto link and a "hide resolved & declined" filter on by default. The `GET /api/feedback/admin` route (added earlier today) backs the queue itself. Assignee and in-app notifications remain out of scope.
- 2026-08-17: Added lean v1 "Report a Bug" and "Request a Feature" feedback entry points: two independent header icons (and a `b` shortcut for bugs) open a dashboard-wide reporter modal with automatic viewport screenshot capture, freehand/rectangle/arrow/text annotation, clipboard-paste image replacement, and a title/description form (severity, Low/Medium/High, applies to bug reports only); submissions persist to a new `feedback_reports` table with an optional private blob-backed screenshot, a dismissable post-submit confirmation message, and a My Feedback page in Settings listing a reporter's own submissions. AI enrichment, dedup, notifications, an admin queue, and mockups are explicitly deferred to a later phase.
- 2026-08-17: Replaced the redundant Getting Started tracker link with one shared Build Board for open questions, current-sprint posts, updates, and completed work; preserved the former roadmap only at its legacy URL.
- 2026-08-17: Added an authenticated, organization-shared provisional-patent workspace in Settings with structured inventor, disclosure, drawing, review, and filing-readiness fields; proposed inventors Dwayne Tillman, Joshua Millard, and Thomas Hagy; optimistic versioned saves; immutable revision archives; and private reference uploads.
- 2026-08-16: Converted the Raspberry Pi path into an appliance-style boot flow with an MxGenius early splash, explicit desktop auto-login, prompt-free Chromium kiosk startup, local Wi-Fi and Bluetooth discovery/switching, and a guarded safe-shutdown control.
- 2026-08-16: Isolated Pi radio and power mutations behind a root-owned allow-listed Unix-socket agent while keeping the diagnostics bridge unprivileged and its control endpoints loopback-only.
- 2026-08-16: Added the Quest companion's paired-device RFCOMM client so normalized Raspberry Pi diagnostics can share the active XR relay with FLIR thermal frames, while preserving separate Pi and camera readiness states.
- 2026-08-16: Validated the Pi 5/16 GB cold path on hardware, made SD staging compatible with Windows PowerShell 5, enabled BlueZ's compatibility interface for the explicit RFCOMM diagnostics profile, bound its Python 3.13 listener through `BDADDR_ANY`, and corrected the Raspberry Pi desktop kiosk autostart entry.

All notable changes to the MXGenius project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [Unreleased]

### Changed — Parts document extraction

- Routed Parts evidence extraction through the existing MXGenius Responses model and Azure-provided `OPENAI_API_KEY`, replacing the separate Document Intelligence plus regex path. JPEG, PNG, WebP, and PDF evidence now produces strict-schema candidate metadata with source excerpts and optional page references; the existing `assetId` opens the private source beside those excerpts and any extraction warnings in Rocky's review screen. Model-derived fields remain proposals with no synthetic confidence score, so the existing human-review and receiving controls stay authoritative.

### Added — Native iOS spatial AR parity

- Added the native AR bridge payload for browser-matched Active Case, AOG, 12K+ AFTT, 8K+ AFTT, Other, and All globe filters.
- Connected native globe peg and raycast selections to the existing JetNet location workflow, with aircraft-row selections loading authenticated aircraft details and bounded gallery images.
- Connected native AI spatial-audio updates to the browser's Realtime media element using HRTF panning and inverse-distance attenuation.
- Matched the native fleet overview panel to the browser globe sheet's metrics, urgency chips, and location-card hierarchy, with spatial filter changes reflected immediately in the panel.

### Fixed — Native AR bridge discovery and model context

- Removed duplicate platform guesses that rejected the valid iOS plugin when the wrapper hosted the remote production URL; normal browsers remain hidden because they do not expose the registered native bridge.
- Made the verified parent capability response authoritative for the embedded 3D viewer AR control instead of asking the iframe to identify the native platform a second time.
- Added model ID, file, provider, asset URL, revision, and status to the viewer-to-native handoff and surfaced whether that context is linked in the spatial panel.

### Fixed — Native AR Realtime voice

- Added a scoped `MXRealtimeVoiceBridge` around the chat-owned WebRTC session so the native AR microphone can connect, disconnect, mute, and expose its audio element without referencing out-of-scope state.
- Made AR scene closure cleanly disconnect a Realtime session opened by AR and reset its spatial-audio graph.
- Added structure-test coverage for the native-to-Realtime bridge; the full suite passes with 221 tests.

### Changed — Landing page hero and carousel

- Updated the hero headline to "The Complete Toolkit for Aviation Maintenance" and replaced the flat gradient hero background with the hangar/jet-engine photo (`media/hero-banner.png`) under a tinted overlay.
- Added themed SVG backgrounds (`assets/landing/`) behind the AI Troubleshooting, Eyes on the Aircraft, Inventory, and Arsenal-roadmap carousel slides, each tinted to match the existing dark theme.

### Added — XR edge hardware pivot

- Added a square, text-free thermal aircraft tab to the fleet-globe rail that opens a dedicated FLIR and Pi diagnostics scene; the scene skips cached JetNet fleet data and reserves its XR surface for thermal, diagnostic, scanner, and evidence streams.
- Established [`MXG-PIVOT-2026-08-14-XR-EDGE-V1`](docs/PIVOT_2026-08-14_XR_EDGE.md) as the audited reference boundary for browser VR/AR, the Quest FLIR companion seam, Raspberry Pi diagnostics, scanners, Remote Witness, external providers, and future MCP sensor projections.
- Added the standalone Raspberry Pi kiosk and exact release payload with local preview, cold SD-card staging, SSH updates, diagnostics state/deltas, Bluetooth summary, scanner observations, and synthetic `MXGS/1` thermal testing.
- Added appliance boot branding, automatic kiosk login, an on-device Connections view for Wi-Fi and Bluetooth management, and a two-step safe power-off control.
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
