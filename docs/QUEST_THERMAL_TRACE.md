# Quest thermal handshake trace

The WebXR diagnostics panel shows the last ten events. The browser page retains up to 64 events in its verbose trace. Native events are retained by the Quest bridge and replayed when Meta Browser connects.

## Expected order

| Step | Vector | Meaning |
| --- | --- | --- |
| `W01` | Pairing | Browser session created or restored from the native handoff. |
| `N01` | Service | Android foreground service started. |
| `N02` | Activation | Browser session and local token accepted by the bridge. |
| `N03` | Broker | Bridge began binding loopback port 4109. |
| `N04` | Broker | Loopback broker is listening. |
| `N05` | SDK | FLIR Atlas initialization began. |
| `N06` | SDK | FLIR camera runtime is ready. |
| `N07` | FLIR | Camera discovery was requested from a foreground activity. |
| `N08` | FLIR | USB discovery scan began. |
| `N09` | USB | FLIR ONE was found and USB permission was requested or denied. |
| `N10` | FLIR | USB permission succeeded and camera connection began. |
| `N11` | FLIR | A thermal stream was discovered and configured. |
| `N12` | FLIR | Native stream callbacks began. |
| `N13` | Frame | The bridge decoded its first native thermal frame. |
| `N14` | Handoff | The first frame was confirmed and browser handoff was scheduled. |
| `N15` | Handoff | The bridge asked Horizon OS to open Meta Browser. |
| `W02` | Socket | Meta Browser attempted the Quest loopback WebSocket. |
| `W03` | Socket | The WebSocket opened. |
| `B03` | Broker | Browser origin, session, and token were accepted. |
| `W04` | Client | WebXR client announcement was sent. |
| `W05` | Session | WebXR session bind was sent. |
| `W06` | Hello | Bridge protocol and companion capability were received. |
| `B04` | Broker | WebXR client announcement was received. |
| `B05` | Broker | WebXR session matched the native activation. |
| `B06` | Broker | Thermal display enable/disable control was received. |
| `W07` | Bridge | Native readiness status was replayed. |
| `W08` | FLIR | Current FLIR source state was received. |
| `W09` | Frame | The first MXGS envelope passed browser validation. |
| `W10` | Render | The first thermal frame was drawn into the VR texture. |

Any `N00`, `B00`, or `W00` entry is a failure. The last successful numbered step identifies the completed side of the failing connection vector.

Common boundaries:

- Stops before `N04`: Android loopback broker startup.
- Stops at `N09`: USB permission or FLIR discovery.
- Stops before `N13`: FLIR connection or native frame decoding.
- Reaches `N15` but not `W03`: Meta Browser could not open the loopback WebSocket.
- Reaches `W03` but not `B05`: session pairing mismatch.
- Reaches `W08` but not `W09`: no frame reached the browser.
- Reaches `W09` but not `W10`: browser frame decoding or texture rendering.
