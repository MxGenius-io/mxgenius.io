## MxGenius Sensor Bridge 0.1.0-alpha.21

- Adds a native Remote Witness invitation card with the customer QR, manual code, audience, viewers, expiry, shared layers, recording state, network state, and clear errors.
- Adds explicit START, PAUSE, RESUME, END, and optional thermal/case-media sharing controls for the wearer.
- Requires fresh Horizon sharing consent for every start or resume and reports LIVE only after the WebRTC peer connects.
- Removes diagnostic logs from the immersive customer-view controls while keeping FLIR diagnostics available through the existing commissioning path.
- Keeps the customer browser read-only, live media ephemeral, recording off by default, and producer credentials memory-only.
