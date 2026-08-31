# 0.1.0-poc.6

- Enters foreground mode before loading the FLIR SDK so Quest does not terminate startup while native initialization is running.
- Holds the panel in explicit `starting`, `broker-ready`, `sdk-starting`, `ready`, `failed`, and `stopped` phases.
- Opens and verifies the Quest-local WebSocket broker before initializing the camera runtime.
- Replays native bridge startup history to WebXR as redacted `bridge.status` messages.
- Keeps FLIR camera controls disabled until the native runtime reports ready.

Meta Alpha build ID: `1296553506880260`.

Known advisory: FLIR Atlas Android SDK 2.22.0 supplies `libatlas_native.so`, which Meta flags for a bundled libssh2 version. This remains permitted for private Alpha testing and must be resolved with an updated vendor SDK before a public submission.
