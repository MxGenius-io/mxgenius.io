# MxGenius Sensor Bridge 0.1.0-poc.15

This build replaces bounded USB retries with one deterministic FLIR handshake lifecycle.

- Waits indefinitely for Android to enumerate the exact FLIR ONE `09cb:1996` device.
- Combines one-second inventory polling with USB attach/detach events.
- Opens exactly one permission request per physical attachment.
- Re-enumerates when Android omits device metadata from the permission callback.
- Returns device churn to synchronization instead of reporting a false denial or panic.
- Starts FLIR discovery only after the same device retains its grant through verification.
- Starts commissioning's first-frame clock only after native stream registration.
- Adds a locally reproducible lifecycle test matrix and release-verification invariants.

Acceptance remains frame-based: authorization and `Camera.connect` are progress events; only the first decoded thermal frame advances the native commissioning run.
