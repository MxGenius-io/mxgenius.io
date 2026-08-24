# MxGenius Sensor Bridge 0.1.0-poc.10

- Adds a **SNAP** control beside the immersive Realtime microphone.
- Captures one bounded RGB frame from the Quest 3/3S passthrough camera through Android Camera2.
- Reuses the authenticated Quest-local session and returns the JPEG only to the requesting WebXR client.
- Sends the image directly into the already-open Realtime model context with no image persistence.
- Closes the headset camera after every success, timeout, disconnect, or error.
- Adds visible native and WebXR trace stages for permission, open, capture, delivery, and failure.

Hardware requirements: Quest 3 or Quest 3S on Horizon OS v74 or newer. The FLIR thermal path remains available if RGB camera permission is denied or the headset camera is unavailable.
