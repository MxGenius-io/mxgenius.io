# MxGenius Sensor Bridge 0.1.0-poc.16

This build returns FLIR authorization to the vendor-documented Atlas 2.22.0 lifecycle.

- Removes the custom Android USB permission gate, polling loop, device-ID reconciliation, and delayed grant verification.
- Starts FLIR Atlas USB discovery from the foreground activity.
- Uses the SDK's `UsbPermissionHandler` for a discovered FLIR ONE identity.
- Waits for `permissionGranted` before calling `Camera.connect`.
- Reuses an existing grant only when `hasFlirOnePermission` reports it.
- Retries only `DEVICE_UNAVAILABLE_WHEN_ASKED_PERMISSION`, exactly as the FLIR sample prescribes for Android's first-request null-device case.
- Treats denial, invalid identity, and every other SDK permission error as terminal and visible in the VR trace.

Acceptance remains frame-based: a permission callback and successful `Camera.connect` are progress events; only the first decoded thermal frame advances commissioning.
