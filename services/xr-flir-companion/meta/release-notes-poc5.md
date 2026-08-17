# 0.1.0-poc.5 — Alpha release notes

- Runs as a standalone Quest FLIR ONE viewer when opened directly from the Meta library.
- Adds the native floating-panel thermal preview and camera status states.
- Delivers MXGS/1 thermal frames to WebXR through a token- and origin-protected Quest-local loopback socket.
- Keeps the optional remote WSS relay additive; Azure is not required for local capture or local XR delivery.
- Removes the Raspberry Pi and Bluetooth runtime dependency from the Quest APK.
- Uses independent browser connections and state for FLIR thermal data and Pi diagnostics.
- Retains the in-VR Back to dashboard control for controllers and hand tracking.

Hardware/headset field validation is intentionally performed after upload and is not a packaging blocker.
