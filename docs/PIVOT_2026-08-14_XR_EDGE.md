# MXG Pivot: XR Edge Hardware and Authoritative Retrieval

Pivot ID: `MXG-PIVOT-2026-08-14-XR-EDGE-V1`

Baseline commit: `08f2804` (`main`)

Status: validated local integration boundary; not deployed or hardware-authorized

Date: 2026-08-14

This record is the reference boundary between the existing browser VR/AR application and the first hardware-expansion architecture. It consolidates the audited worktree into named authoritative sources without claiming that licensed hardware, supplier authentication, Azure relay infrastructure, or production deployment has completed.

## Authoritative sources

| Concern | Canonical source | Consumers |
| --- | --- | --- |
| Frozen CL350 manual corpus identity, index, model, dimensions, hashes, assets, and exclusions | `services/mcp/config/authoritative-manual-pack-v1.json` | MCP manual adapter, reconciliation utility, build/test gates |
| External-provider credential behavior | `services/mcp/server/src/adapters/provider_auth.rs` | PartsBase and future provider adapters; never browser tool arguments |
| XR session negotiation wire format | `services/xr-diagnostics-kiosk/contracts/xr-session-gateway.schema.json` | Browser session client, future authenticated gateway, Quest companion |
| Quest sensor activation and presence | `services/xr-diagnostics-kiosk/contracts/sensor-companion.schema.json` | Browser deep link, Android companion announce, FLIR source status |
| Pi diagnostic state/delta format and XR panel map | `services/xr-diagnostics-kiosk/contracts/diagnostics-state.schema.json` | Pi bridge, kiosk, `xr-diagnostics-layout.js`, XR sensor orb |
| Scanner observation format | `services/xr-diagnostics-kiosk/contracts/scan-observation.schema.json` | Serial/SPP producer, Pi normalizer, kiosk, XR sensor orb |
| Offline provider-shape registry | `services/xr-diagnostics-kiosk/contracts/integration-fixtures.schema.json` | Pi kiosk, headset UI, orchestration tests; never presented as live provider evidence |
| Promoted diagnostic evidence format | `services/xr-diagnostics-kiosk/contracts/diagnostic-evidence.schema.json` | Future append-only ingest and bounded MCP projections |
| Thermal frame transport | `MXGS/1` documented in `services/xr-diagnostics-kiosk/README.md` | Quest companion/simulator, Pi relay, browser thermal orb |
| Exact Raspberry Pi payload | `services/xr-diagnostics-kiosk/release-files.txt` | Double-click preview, SSH update, cold SD-card staging |
| Hardware roles, consent, and MCP projection boundary | `docs/XR_HARDWARE_EXPANSION.md` | Product, XR, edge, backend, and field-test planning |

Generated weekly reports are presentation artifacts, not runtime contracts or configuration sources.

## Audited implementation state

| Lane | State at this pivot | Explicit boundary |
| --- | --- | --- |
| Browser VR/AR | Existing flow retained; fleet-globe VR mounts voice presence plus a hand-adjacent thermal/diagnostics orb | Browser does not own FLIR or supplier credentials |
| FLIR ONE Pro | FLIR Mobile SDK 2.22.0 is approved and externally mounted; the ARM64 Quest companion builds, owns USB permission in a foreground service, announces through the relay, and emits `MXGS/1` JPEG frames; the fleet-globe setup panel activates it and observes relay/app/camera separately | Installation, Horizon OS deep-link behavior, USB-C enumeration, radiometric Y16 capture, and sustained headset performance require the physical Quest test |
| Raspberry Pi | Standalone kiosk, health/state APIs, WebSocket relay, Bluetooth summary, exact preview/flash payload, diagnostics, USB/serial discovery, and scanner normalization exist | No production WSS/VPN exposure or Azure persistence is active |
| Scanner POC | Honeywell Xenon 1950g, Zebra DS3608, and Socket Mobile S740 profiles share `scan.observed`; USB CDC and Bluetooth SPP have an executable reader | Device-specific configuration and physical scans are pending; candidates remain unverified |
| Manual retrieval | Frozen CL350 pack, read-only reconciliation, MiniLM readiness contract, applicability states, and fail-closed production mount exist | Manual currency remains unverified because revision/effective-date metadata is absent |
| Aviation weather | Public AviationWeather.gov METAR/TAF powers `mxg.weather.airport_now` | Derived ramp, maintenance-window, ferry, and hazard judgments remain unavailable |
| PartsBase | Documented market-pricing client and server-only authentication boundary exist | No credential is installed; live response mapping is not canonical or mounted |
| Remote Witness | Consent, evidence, and transport contracts are documented | Media room, screen capture, viewer roles, and recording controls are not implemented |
| MCP sensor access | Proposed bounded read-only tools are documented | No raw video, unrestricted stream, or device-control tool is mounted |

## Negotiation and authorization boundary

`xr-session-client.js` and the gateway JSON Schema define an authenticated production negotiation request that returns separate short-lived `wss://` consumer and companion-producer relay URLs. At this pivot the server route `/api/xr/sessions/negotiate` and its Azure Web PubSub token issuer are intentionally **contract-only and unmounted**. Local development may inject `sensorBridge` and `sensorIngest` explicitly; the Pi test route deterministically maps `/ws/xr` to `/ws/ingest`. Production must not derive roles from an Azure client URL or publish a long-lived bridge credential in `runtime-config.js`, a query string, the APK, or MCP arguments.

External provider authentication is similarly staged. The shared server boundary supports anonymous, API-key, bearer, refreshable bearer-file, and OAuth password-grant mechanics. A browser OAuth experience, where a provider supports it, must terminate at a server-side connection broker. PartsBase remains disabled until issued credentials and licensed payloads can be tested.

## Integrity and safety decisions

- Session identifiers use `^[A-Za-z0-9._:-]{1,128}$` across the browser, Pi bridge, and gateway contract.
- Sensor disconnects are explicit; XR clients must remove stale node capability claims.
- A scanner value is an observation, not a verified part, serial, lot, or inventory match.
- Manual retrieval states distinguish verified match, no relevant section, manual absent, applicability unknown, unavailable, and not requested.
- Weather and provider adapters return sourced facts or typed unavailable states; they do not synthesize operational conclusions.
- Remote Witness is wearer-controlled and evidence-neutral. It may document whether a condition reproduces, never infer motive or deception.
- Legacy JetNet probe credentials were removed from tracked source during this audit. The probes now read `JETNET_IDENTITY` and `JETNET_CREDENTIAL` from the environment and suppress token fragments; the formerly embedded credential must be rotated because removing it from the working tree does not remove it from Git history.

## Validation recorded at the pivot

- Repository baseline: `main` and freshly fetched `origin/main` both resolve to `08f2804` with `0/0` divergence.
- Frontend/application: 114 checks passed after FLIR browser activation, including six pivot-contract checks.
- Rust MCP workspace: 119 tests passed; formatting and strict Clippy passed.
- Manual embedding service: 4 tests passed.
- Pi kiosk/bridge: 19 tests passed after consolidation; exact 34-file release preview passed, including diagnostics state, scanner normalization/relay, and synthetic thermal frames.
- Live read-only weather smoke: KATL returned METAR and TAF through the Rust adapter.

`tests/pivot-contract.test.mjs` is part of the normal frontend gate and must remain green before this status is treated as current.

## Activation gates after this pivot

1. Install the built Quest Android companion and verify Horizon OS deep-link dispatch, USB enumeration, thermal cadence, radiometric metadata, foreground survival, and WebXR performance on physical hardware.
2. Mount an authenticated WSS relay and implement `/api/xr/sessions/negotiate` with short-lived scoped connection URLs.
3. Run cold Pi provisioning, SSH update, USB CDC, and Bluetooth SPP tests on physical hardware.
4. Exercise PartsBase only after issued credentials exist; freeze typed response fixtures before supplier data enters orchestration.
5. Implement Remote Witness consent, presence, viewer-role, capture, and retention controls before any HQ/customer session.
6. Add append-only evidence persistence and bounded MCP sensor projections before a model can consume collected figures.
No deployment, SD-card rewrite, credential activation, commit, tag, or push is represented by this pivot record.

## 2026-08-15 pre-flash kiosk addendum

- The operator confirmed the JetNet credential discovered during the audit had already been rotated when the integration moved to environment variables.
- Kiosk release `0.3.1-poc.1` uses the canonical MxGenius logo and adds visible readiness lanes for FLIR ONE Pro, Honeywell Xenon XP 1950g, Zebra DS3608, and Socket Mobile S740.
- A dedicated device-local commissioning log records bridge, diagnostics, thermal, node, scanner-profile, and peripheral transitions with warning/error filters and JSONL export. It does not persist raw scanner values.
- `integration-fixtures.schema.json` and `/api/v1/integrations/simulated` define explicitly synthetic, provider-neutral AviationWeather, PartsBase, and Honeywell Forge envelopes. They are development shapes, not claims about undocumented vendor payloads or live data.
- The updated kiosk suite passes 26 tests, and the exact `0.3.1-poc.1` flash preview passes with 40 packaged files, including the branded asset, integration registry/schemas, sensor-companion contract, scanner relay, and synthetic thermal source.

## 2026-08-15 FLIR browser-activation addendum

- The approved Teledyne FLIR Android SDK 2.22.0 remains outside Git at `D:\AAog\Flir-SDK`; no licensed AAR is copied into the Pi payload or source tree.
- `services/xr-flir-companion` is an API 33+ / ARM64 Quest companion. A debug APK builds locally as `io.mxgenius.sensorbridge` and registers the `mxgenius://sensor-bridge` browser handoff.
- The companion uses a foreground transfer service so it can keep the relay and camera alive after the wearer returns to WebXR. It advertises `flir-one-pro-usb-c`, emits explicit `source.status`, and throttles FLIR-rendered JPEG frames into the existing `MXGS/1` envelope.
- The browser no longer treats a successful launch attempt as device readiness. Its three-stage panel advances only from observed relay state, companion presence, and camera status/frames; install fallback remains configuration-gated until a signed APK distribution URL exists.
- Production remains gated on the unmounted authenticated WSS negotiation route. Debug-only cleartext activation is explicitly marked `pilot=1`; release builds reject and disable it.
