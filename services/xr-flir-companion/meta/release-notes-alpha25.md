## MxGenius Sensor Bridge 0.1.0-alpha.25

- Forces Remote Witness to share the full Quest display instead of allowing a single-app capture that disappears when the consent activity closes.
- Requires advancing captured frames and outbound RTP bytes before the native panel reports LIVE.
- Detects stalled capture and transport independently, then uses bounded recovery or requests fresh consent as appropriate.
- Leaves immersive WebXR deliberately for the Horizon consent prompt and resumes VR or AR only after a fresh wearer gesture.
- Keeps the last decoded guest frame visible during short recovery windows instead of replacing it with black.
