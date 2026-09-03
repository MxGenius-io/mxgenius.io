# MxGenius Sensor Bridge 0.1.0-alpha.20

- Adds explicit in-headset consent for customer-view compositor sharing.
- Adds one video-only Remote Witness WebRTC producer at 1280x720 and 15 fps.
- Uses a pinned hardware-encoder libwebrtc build and prefers H.264 when the
  Quest reports hardware support.
- Keeps microphone capture disabled and leaves FLIR plus one-shot evidence
  capture independent.
- Stops and releases media on pause, projection revocation, signaling loss,
  room replacement, expiry, or service shutdown; a restart requires new consent.

Physical Quest compositor output, negotiated hardware codec, and customer
playback remain the Alpha headset acceptance gate.
