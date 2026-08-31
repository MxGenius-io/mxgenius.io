# MxGenius Sensor Bridge 0.1.0-poc.9

- Stabilizes sustained native thermal rendering after the first successful frame.
- Skips and traces transient FLIR streamer exceptions instead of declaring an immediate camera failure.
- Copies frames out of the FLIR SDK-owned image buffer before Spatial SDK uploads them.
- Preserves FLIR disconnect and stream error details in the in-headset trace.
- Uses FLIR's Iron color palette.
- Limits the XML-backed Spatial panel to image-only updates at a bounded preview cadence.

Confirm `N13` and `N16`, then watch for `N20 skipped` followed by `N20 recovered`. If the camera disconnects, capture the full `N00` reason.
