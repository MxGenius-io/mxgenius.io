## MxGenius Sensor Bridge 0.1.0-alpha.24

- Connects the unified WebXR maintenance workspace to the Quest-native Remote Witness capture-consent flow.
- Opens Horizon's screen-sharing prompt only after the wearer explicitly selects approve or resume.
- Reuses the already authenticated, memory-only witness room; no room credential is placed in the deep link.
- Returns to the browser after consent and keeps the existing FLIR, snapshot, evidence, and guest-audio paths intact.
- Sends the companion's browser handoff to the unified maintenance workspace instead of the retired sensor-only scene.
