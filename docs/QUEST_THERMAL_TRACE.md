# Quest thermal handshake trace

The native immersive panel shows the latest 18 events and the Quest service retains up to 64. The Meta Browser trace remains available for the optional loopback compatibility path, but the browser is no longer required to display native FLIR pixels.

## Expected order

| Step | Vector | Meaning |
| --- | --- | --- |
| `W01` | Pairing | Browser session created or restored from the native handoff. |
| `N01` | Service | Android foreground service started. |
| `N02` | Activation | Browser session and local token accepted by the bridge. |
| `N03` | Broker | Optional loopback broker began binding port 4109. |
| `N04` | Broker | Optional loopback broker is listening; failure here does not stop FLIR startup. |
| `N05` | SDK | FLIR Atlas initialization began. |
| `N06` | SDK | FLIR camera runtime is ready. |
| `N07` | FLIR | Camera discovery was requested from a foreground activity. |
| `N08` | FLIR | FLIR Atlas USB discovery began from the foreground activity. |
| `N09` | USB | The bridge is waiting for the vendor permission callback. |
| `N10` | FLIR | USB permission succeeded and camera connection began. |
| `N11` | FLIR | A thermal stream was discovered and configured. |
| `N12` | FLIR | Native stream callbacks began. |
| `N13` | Frame | The bridge decoded its first native thermal frame. |
| `N14` | Spatial | The operator pressed the explicit VR-entry button after the first frame was confirmed. |
| `N15` | Spatial | Horizon OS was asked to open the native immersive activity. |
| `N16` | Spatial | The native thermal panel was created in the Quest scene. |
| `N17` | Spatial | The panel changed between head-follow and world-pinned placement. |
| `N18` | FLIR | A manual reconnect was requested from the immersive panel. |
| `N19` | Spatial | The thermal viewer returned to its Horizon 2D panel. |
| `N20` | Frame | A transient FLIR frame update was skipped or subsequently recovered. |

The detailed `U` events explain the entire Android USB boundary:

| Step | Meaning |
| --- | --- |
| `U01` | FLIR Atlas discovered and validated a FLIR ONE USB identity. |
| `U02` | FLIR `UsbPermissionHandler` requested access and is waiting for its callback. |
| `U03` | FLIR returned `DEVICE_UNAVAILABLE_WHEN_ASKED_PERMISSION`; one retry was queued for the next main-loop turn, after the first SDK receiver returns. |
| `U04` | FLIR reported an existing grant or invoked `permissionGranted`; only then may `Camera.connect` begin. |
| `U00` | Invalid identity, explicit denial, a second device-unavailable result, or another terminal vendor error. |

The following steps are optional browser compatibility telemetry, not part of the native frame path:

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

Any `N00`, `B00`, or `W00` entry is a failure in its named vector. A `B00` or `W00` does not invalidate native display if the trace reaches `N13` and `N16`.

Common boundaries:

- Reaches `N08` but not `U01`: FLIR Atlas discovery did not produce a FLIR ONE USB identity.
- Remains at `U02 permission-requested`: the first vendor permission callback is unresolved; the bridge does not poll or stack prompts.
- Remains at `U03 permission-retry`: the single deferred vendor retry did not resolve to `U04` or `U00`.
- Reaches `U04` but not `N10`: permission succeeded but `Camera.connect` did not start.
- Stops before `N13`: FLIR connection or native frame decoding.
- Reaches `N13` but not `N16`: native Spatial activity or panel creation.
- Reaches `N16` with no image: native panel view update/rendering.
- Repeated `N20 skipped` without `N20 recovered`: FLIR frame production is unstable; report the retained reason and count.
- Stops before `N04`: optional Android loopback broker startup; native FLIR should continue.
- Reaches `N15` but not `W03`: optional Meta Browser loopback did not reconnect.
- Reaches `W03` but not `B05`: session pairing mismatch.
- Reaches `W08` but not `W09`: no frame reached the browser.
- Reaches `W09` but not `W10`: browser frame decoding or texture rendering.
