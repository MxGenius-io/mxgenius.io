# MXG XR diagnostics kiosk

Architecture reference: [`MXG-PIVOT-2026-08-14-XR-EDGE-V1`](../../docs/PIVOT_2026-08-14_XR_EDGE.md).

This service turns a Raspberry Pi into a standalone fullscreen diagnostics appliance. It keeps raw port/device readings local and emits a reduced summary for the Quest companion and MXG server session.

## Iteration pipes

The POC has three deliberately separate paths. UI work should not require an SD-card write, and routine Pi updates should not require reprovisioning the device.

### Double-click release preview

Double-click `start.bat` in this folder. It will:

1. Build `.preview/release` from the canonical `release-files.txt` payload.
2. Create or reuse an isolated Python environment.
3. Start the backend from that staged payload rather than the working source tree.
4. Run the HTTP, schema, state, and WebSocket smoke tests.
5. Push synthetic `MXGS/1` thermal frames through the live relay.
6. Open the validated kiosk in the default browser.

The console stays open with the preview. Press Ctrl+C or close the console to stop the test processes. The generated `.preview/preview-manifest.json` records the SHA-256 hash of every file that was exercised.

For a non-interactive preflight without opening a browser:

```powershell
.\scripts\preview-release.ps1 -TestOnly
```

`release-files.txt` is also consumed by both SD staging and SSH deployment, preventing those paths from silently packaging a different set of files.

### 1. Local surface and simulated sensor

From PowerShell on the development machine:

```powershell
cd services\xr-diagnostics-kiosk
.\scripts\run-local.ps1
```

The command creates `.venv` when needed, starts the FastAPI bridge, starts a synthetic `MXGS/1` thermal producer, opens the kiosk, and keeps both child processes attached to the command. Press Ctrl+C to stop them. Runtime logs are written under `.local/`; neither `.local/` nor `.venv/` is included in deployment bundles.

Run the black-box contract checks against an already-running bridge with:

```powershell
.\.venv\Scripts\python.exe .\scripts\smoke_test.py
```

The startup splash is event-driven: it clears only after the WebSocket bridge connects and the first diagnostics snapshot arrives.
Open `http://127.0.0.1:8844/?splash=hold` to hold its final ready state while styling or reviewing it.

On Raspberry Pi OS, installation also selects desktop auto-login, suppresses Chromium's first-run prompts, and configures the packaged MxGenius logo as the early fullscreen boot splash through Raspberry Pi's `rpi-splash-screen-support` tool. Linux still boots underneath, but the intended operator path is splash → local web splash → live kiosk without a login or browser prompt. The splash is regenerated only when the source logo changes; reboot once after installation or an updated logo to validate the early-boot handoff.

### 2. Incremental Pi deployment

After the Pi has a valid `mxgenius` user and SSH access:

```powershell
.\scripts\deploy-pi.ps1 -HostName mxgenius.local -UserName mxgenius
```

This packages only the service, uploads it to `/tmp`, runs the initial installer or lightweight updater, restarts the systemd services, and performs a loopback health check on the Pi. Use `-IdentityFile` after key-based SSH is configured. This is the normal day-to-day hardware iteration path.

### 3. Cold SD-card provisioning

Use this path to prove a new device can install itself. Generate a password hash without placing the clear-text password in a script:

```text
openssl passwd -6
```

With the newly flashed `bootfs` partition mounted as `E:`:

```powershell
.\deploy-to-sd.ps1 -Drive E: -UserName mxgenius -PasswordHash '$6$...' -EnableSsh
```

The command validates the target as a Raspberry Pi boot partition, writes the initial user configuration, stages a whitelisted kiosk payload and release manifest, and activates the one-time systemd boot hook. `mxg-firstboot.status` on `bootfs` records `starting`, `installing`, `installed`, or `failed` for cold-start diagnosis.

The cold installer needs network access for Debian and Python packages. After a successful cold install, use the SSH deployment path instead of rewriting the card.

## Interfaces

- `GET /` — fullscreen local kiosk
- `GET /api/v1/health` — bridge health
- `GET /api/v1/diagnostics?token=...` — current Pi diagnostics
- `GET /api/v1/state?token=...` — normalized XR-ready state
- `GET /api/v1/schema` — versioned JSON Schema contract
- `GET /api/v1/schemas/scan-observation` — canonical scanner observation contract
- `GET /api/v1/schemas/sensor-companion` — browser activation, Quest announce, and FLIR source-status contract
- `GET /api/v1/integrations/simulated` — synthetic normalized AviationWeather, PartsBase, and Honeywell Forge envelopes
- `GET /api/v1/schemas/integration-fixtures` — fixture-registry JSON Schema
- `GET /api/v1/control/session` — loopback-only, ephemeral local appliance control nonce
- `POST /api/v1/control/wifi/scan` and `/connect` — local NetworkManager discovery and connection actions
- `POST /api/v1/control/bluetooth/scan` and `/action` — local BlueZ discovery, pair, connect, disconnect, and forget actions
- `POST /api/v1/control/poweroff` — guarded local safe-shutdown action
- `WS /ws/xr?token=...` — Quest/browser consumer stream
- `WS /ws/ingest?token=...` — local simulator and alternate high-bandwidth producer test path
- Bluetooth Classic RFCOMM channel `8` — reduced diagnostics for the Quest native companion

The installer enables BlueZ's deprecated compatibility interface only to register the explicit RFCOMM Serial Port Profile used by channel `8`; the diagnostic payload itself remains owned by the unprivileged `mxgdiag` service.

Loopback clients do not need the token. LAN clients use the token generated in `/etc/mxg-diagnostics-kiosk.env` during installation.

Radio and power actions are more restrictive than the read-only diagnostics API. They require a per-process nonce available only to a loopback browser and are forwarded over a group-restricted Unix socket to a separate root-owned allow-list service. The FastAPI diagnostics bridge remains unprivileged and cannot execute arbitrary commands. Wi-Fi passwords are never added to the commissioning log and the form clears them after each connection attempt.

The kiosk Overview includes explicit readiness cards for the FLIR ONE Pro headset lane and the Honeywell Xenon XP 1950g, Zebra DS3608, and Socket Mobile S740 Pi scanner lanes. Its Live log view retains a bounded device-local commissioning trace, filters warnings and errors, and exports JSONL for first-run diagnosis. Scanner log entries record only profile, transport, and sequence; raw scanned values are not persisted in the log.

The simulated integration endpoint is deliberately provider-neutral. It models the stable MxGenius envelopes consumed by the kiosk, headset, and future MCP projection, not undocumented proprietary provider responses. Every sample declares `status: fixture`, uses a `fixture://` reference, carries no credential, and leaves `operationalConclusion` null.

## Thermal frame envelope

Binary messages use the 24-byte `MXGS/1` header followed by optional UTF-8 JSON metadata and the pixel payload.

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | 4 bytes | ASCII `MXGS` |
| 4 | `u8` | version (`1`) |
| 5 | `u8` | frame type (`1` thermal, `2` diagnostic raster) |
| 6 | `u8` | format (`1` JPEG, `2` RGBA8, `3` Y16 little-endian) |
| 7 | `u8` | flags |
| 8 | `u16le` | width |
| 10 | `u16le` | height |
| 12 | `u64le` | monotonic timestamp in nanoseconds |
| 20 | `u32le` | metadata byte length |
| 24 | bytes | metadata, then pixel payload |

The relay validates the header and forwards binary frames without transcoding for local integration tests. In the headset deployment, the hard-wired FLIR camera is owned directly by the Quest Android companion and does not pass through the Pi.

The WebSocket control plane also accepts `node.announce` messages. Nodes identify themselves as roles such as `edge-kiosk`, `sensor-source`, or `xr-client` and advertise capabilities. A Quest client may send `bridge.session` with the active MXG server session ID; the bridge passes that binding down to sensor producers so the daisy chain shares one session boundary.

The fleet-globe page activates the native Quest companion with `mxgenius://sensor-bridge` (or an Android intent targeting `io.mxgenius.sensorbridge`). The handoff carries only the opaque session ID and producer-scoped relay URL. In the local Pi bridge, the browser consumes `/ws/xr` while the companion produces to `/ws/ingest`; production negotiation issues separate short-lived WSS URLs for those roles. Presence is not inferred from the launch attempt: the page advances its relay → Quest app → FLIR ONE indicators only after relay state, the companion `node.announce`, and source status/frames are observed.

Scanner producers send `scan.raw` over `/ws/ingest`. The Pi converts each read into a sequenced `scan.observed` event with device and transport identity, the original value, a SHA-256 digest, and conservative part/serial/lot candidates. Parsed values remain `verified: false` until a catalog or authorized supplier adapter resolves them. USB CDC or Bluetooth SPP is preferred for deterministic line framing; keyboard-wedge HID can be bridged later but is intentionally not treated as an authoritative input path.

For a scanner configured as USB CDC/serial:

```bash
python3 scripts/scan_serial.py --port /dev/ttyACM0 --device-id zebra-ds3608-1 --profile zebra-ds3608
```

The same reader accepts a paired Bluetooth SPP device at `/dev/rfcomm0`. Device-specific baud, prefix, suffix, and symbology reporting must be set from the manufacturer's configuration guide during hardware testing.

Bluetooth carries the normalized `diagnostics.state`, never raw port/device reads. Each message is a four-byte big-endian payload length followed by UTF-8 JSON. The full internal `diagnostics.snapshot` is restricted to the loopback kiosk; remote XR consumers receive stable metrics, transports, findings, and component-ready identifiers.

The live path is richer than the persistence summary. A client receives one keyed `diagnostics.state` and then sequenced `diagnostics.delta` messages containing RFC 6901 pointer operations for changed fields only. Stable transport and metric IDs let the VR UI update specific widgets without receiving a rendered screen or repeatedly downloading the full snapshot. If a sequence gap is detected, the client sends `diagnostics.resync` and receives a fresh state.

The same canonical schema owns the sensor-scene panel map through its `x-mxg-xr-layout` extension. `xr-diagnostics-layout.js` resolves those JSON Pointer paths after each state or delta, so the globe's existing canvas-panel treatment can render Pi data without embedding a second display stream. To add a POC tool, normalize its output under a stable metric, transport, or finding ID; add a layout row only when that value belongs in the default XR summary. The browser fetches the deployed contract at `/schemas/edge-diagnostics-1.0.0.json`.

## Quest transport boundary

A remotely hosted HTTPS WebXR page must use a trusted `wss://` bridge. Plain LAN `ws://` is suitable for kiosk/local development but is normally blocked as mixed content by an HTTPS page. Put this service behind a trusted TLS reverse proxy or VPN hostname before headset field testing.

## Local checks

```bash
cd backend
python3 -m pip install -r ../requirements-test.txt
python3 -m unittest discover -v

# With the service running, exercise the same binary path used by FLIR:
python3 ../scripts/simulate_sensor.py --seconds 15

# Exercise the scanner normalization and relay path:
python3 ../scripts/simulate_scanner.py

# Or exercise the HTTP, schema, normalized state, and WebSocket contracts:
python3 ../scripts/smoke_test.py
```
