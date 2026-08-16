# XR hardware expansion boundary

Reference pivot: [`MXG-PIVOT-2026-08-14-XR-EDGE-V1`](PIVOT_2026-08-14_XR_EDGE.md).

## Independent live lanes

```text
FLIR ONE Pro USB-C -> Quest Android companion -> MXGS/1 thermal frames -> WebXR orb
Diagnostic tools -> Raspberry Pi collectors -> normalized state/deltas -> WebXR panels + Azure persistence
Quest viewpoint/service camera -> Remote Witness media room -> HQ/customer viewer
```

All lanes share an opaque MXG session identifier, but none is a runtime dependency of another. Thermal and video are transient media. Reduced diagnostic state, alerts, consent events, and selected evidence captures are the durable records.

## Exact thermal target

- FLIR ONE Pro for Android with male USB-C and its own approximately one-hour battery.
- Native thermal resolution: 160 × 120.
- Nominal frame rate: 8.7 Hz.
- The licensed FLIR Mobile SDK is the camera boundary; generic UVC is not treated as equivalent radiometric access.
- First hardware test uses a short data-capable USB-C extension with strain relief and records the actual USB identifiers exposed by Horizon OS.

## Remote Witness, not oversight

Remote Witness is wearer-controlled. A remote participant cannot activate capture. Every session requires:

1. an in-app wearer action;
2. the Horizon OS/Android capture consent surface;
3. a persistent in-headset live indicator and viewer count;
4. immediate pause/end controls;
5. separate recording consent and retention policy.

### HQ mode

Use Android Media Projection for the wearer viewpoint including application UI. The wearer selects thermal, diagnostics, and microphone layers independently. The HQ participant receives a scoped presenter/viewer room identity and can annotate or speak, but cannot silently add viewers or start recording.

### Customer mode

Use one passthrough RGB camera as a clean, monocular service-camera feed. Do not expose the full headset UI, internal cases, unrestricted thermal data, or unrelated surroundings. Add only curated annotations, a work-order title, timestamps, and wearer-approved before/after evidence.

### Transport candidate

Azure Communication Services Rooms is the first POC candidate because it supports Android and browser participants, role-based rooms, audio/video, and Android screen sharing through raw media. The Quest build must validate Media Projection capture, hardware encoding, microphone routing, and ACS behavior while WebXR remains at its required frame rate. A transport interface should isolate ACS so a WebRTC SFU can replace it if Quest-specific screen sharing is unreliable.

## Performance and storage

- Keep FLIR at its native cadence; do not upsample acquisition to the headset refresh rate.
- Target Remote Witness at 720p/30 for the POC and reduce dynamically under thermal/WebXR pressure.
- Persist room lifecycle, consent, participants, selected diagnostic events, and explicit evidence captures.
- Do not store continuous video or thermal media by default.
- Never place database, ACS, FLIR, or Web PubSub service credentials in the browser or APK.

## POC scanner lane

The first three profiles target common, readily sourced scanners while keeping one canonical Pi event contract:

| POC device | Preferred link | Pi profile | Why it is useful |
| --- | --- | --- | --- |
| Honeywell Xenon XP 1950g | USB CDC | `honeywell-xenon-1950g` | General-duty 1D/2D reader designed for difficult or damaged codes |
| Zebra DS3608 | USB CDC | `zebra-ds3608` | Rugged corded 1D/2D reader with explicit USB CDC support |
| Socket Mobile S740 | Bluetooth SPP | `socket-s740` | Wireless 1D/2D option; SPP avoids browser focus dependence |

The executable boundary is `scanner line -> scan_serial.py -> scan.raw -> Pi normalization -> scan.observed -> XR/MCP ingest`. Every observation carries a sequence, device and transport identity, original string, SHA-256 digest, and only conservative identifier candidates. A candidate remains unverified until the internal catalog or a licensed provider resolves it. Keyboard-wedge HID is acceptable for a visual demo but not the deterministic evidence path because focus and application keystroke handling can change the bytes received.

## Low-friction cloud adapters

- AviationWeather.gov is the first live adapter: public METAR/TAF reads, custom user agent, bounded requests, and no browser credential.
- PartsBase is prepared behind server-side bearer or its documented password-grant token flow. The adapter stays out of canonical supplier results until issued credentials and live payload mapping are validated.
- Azure Document Intelligence remains the document/OCR lane and supports either a server-side key or managed identity in the existing application service.
- Honeywell Forge remains a contract/fixture boundary until Hermetic Labs receives an authorized API product and credential flow.

Before live authentication, the Pi exposes normalized development envelopes for AviationWeather, PartsBase, and Honeywell Forge through `/api/v1/integrations/simulated`, governed by `integration-fixtures.schema.json`. These fixtures exercise the kiosk, headset, logging, and orchestration consumers without claiming to reproduce undocumented provider payloads. They are always marked `status: fixture`, use `fixture://` sources, carry no secrets, and cannot emit an operational conclusion.

Credentials never enter the headset page, scanner event, or MCP tool arguments. A future browser OAuth connection terminates at an MXG server-side broker and supplies a short-lived bearer token to the provider adapter; each provider must explicitly support that mode.

## Evidence neutrality

The system verifies observed conditions; it does not classify a reporter's honesty or intent. A result can be `supports-reported-condition`, `does-not-reproduce`, `inconclusive`, or `not-evaluated`. “Does not reproduce” means only that the condition was not reproduced during the documented observation window.

Every promoted observation carries the source model and pseudonymous device identity, software version, calibration state, environmental context, limitations, payload hash, and an event-chain hash. The original discrepancy remains immutable and separate from later measurements. Remote participants and technicians may annotate the evidence, but neither annotations nor AI summaries overwrite source observations.

The deterministic pipe is `instrument bytes -> source adapter -> canonical event bytes -> payload/event hashes -> append-only ingest`. Relays forward the canonical bytes without parsing and reserializing them. UI projections, unit conversions, technician annotations, and AI summaries are separately identified derived events that reference the source event hash. Sequence gaps, duplicates, rejected signatures, and clock drift are recorded explicitly; the receiver never silently repairs them.

No automated workflow may label a pilot, technician, or customer deceptive. Any operational or personnel conclusion remains a qualified human decision outside the sensor pipeline.

## MCP projection

The model never subscribes to thermal video, Remote Witness media, a live CAN bus, or an unrestricted diagnostic stream. After an observation is accepted into the append-only store, bounded read-only MCP tools project the figures:

- `mxg.sensors.diagnostics_snapshot` — one normalized Pi state at a sequence or observation time;
- `mxg.sensors.diagnostics_series` — an explicitly bounded metric/time window with units and quality flags;
- `mxg.sensors.thermal_observation` — one selected radiometric observation with spot/region statistics, palette-independent values, calibration state, limitations, and evidence hash;
- `mxg.sensors.compare_observations` — deterministic differences between named source hashes without inferring motive;
- `mxg.remote_witness.session_summary` — participants, consent transitions, selected layers, annotations, and evidence references, never the continuous media itself.

Every result carries source hashes and uses the existing MXG evidence envelope. The read tools do not start devices, change measurement ranges, send bus commands, invite viewers, or begin recording. Those mutations remain separate, explicit, human-approved capabilities if they are added at all.
