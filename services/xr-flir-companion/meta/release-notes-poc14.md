# MxGenius Sensor Bridge 0.1.0-poc.14

- Replaces the FLIR SDK permission helper with the documented Android USB host transaction: enumerate, request once, wait for `EXTRA_PERMISSION_GRANTED`, and verify `UsbManager.hasPermission()`.
- Starts FLIR discovery only after the granted device survives a fresh Android enumeration, preventing an SDK identity from racing the Quest permission prompt.
- Owns and unregisters exactly one permission receiver on grant, denial, mismatch, timeout, cancellation, and exception paths.
- Treats an explicit denial or two-minute callback timeout as terminal instead of opening another permission prompt.
- Records the FLIR USB device ID plus every interface class/subclass/protocol tuple in the in-headset trace.
- Requires blocking `Camera.connect()` to return connected before the thermal stream is configured.
- Removes false-positive success levels from USB authorization, camera connection, and callback registration. The first decoded thermal frame is the first FLIR startup success boundary.

## Quest acceptance run

Cold-start the bridge with FLIR attached and accept the single Horizon OS USB prompt. The trace must proceed through `permission-requested`, `permission-grant-received`, `permission-stable`, `discovery-start`, `identity-found`, `connect-start`, `N11 stream-ready`, and `N13 first-frame` in that order. Denying the prompt must stop at `permission-denied`; leaving it unanswered must stop at `permission-timeout` after two minutes. Run **RUN FULL DIAGNOSTIC** only after `N13`, then require the complete native soak and browser render acknowledgement before `W14 PASS`.
