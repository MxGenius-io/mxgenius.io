# MxGenius Sensor Bridge 0.1.0-poc.8

- Adds a native Meta Spatial SDK thermal workspace so the companion owns both the FLIR stream and its immersive display.
- Opens the immersive panel only after the first decoded FLIR frame.
- Adds **PIN HERE / FOLLOW HEAD**, **RECONNECT FLIR**, and return-to-2D-panel controls.
- Renders the retained native FLIR and lifecycle trace directly in the headset.
- Serializes FLIR frame conversion and disconnect work, and drops overlapping conversions to protect the camera runtime.
- Keeps the Quest loopback WebSocket as optional browser compatibility; failure no longer blocks native camera startup or rendering.

Test on Quest with a physical FLIR ONE. Confirm trace steps `N13` and `N16`, then verify world pinning and one manual reconnect cycle.
