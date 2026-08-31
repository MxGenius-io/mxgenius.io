# MxGenius Sensor Bridge 0.1.0-poc.17

This build fixes the FLIR Atlas permission-callback race without changing the proven thermal frame, native spatial panel, or browser transport paths.

- Uses one authorization route: FLIR Atlas `UsbPermissionHandler` at runtime.
- Removes the competing Android USB-attachment manifest filter.
- Reuses an existing vendor-reported grant without opening a prompt.
- Waits for `permissionGranted` before calling `Camera.connect`.
- Defers the documented device-unavailable retry until the SDK's first broadcast callback has returned.
- Allows exactly one deferred retry; the second identical result is terminal and logged precisely.
- Leaves denial, invalid identity, frame decoding, palette selection, commissioning, and VR rendering behavior unchanged.

Expected permission trace: `N08` → `U01` → `U02` → optional `U03` once → `U04` → `N10` → `N11` → `N13`.
