# MxGenius Sensor Bridge 0.1.0-poc.11

- Adds one-button deterministic FLIR commissioning in the native Spatial panel.
- Cold-reconnects the FLIR camera and names the first failing lifecycle boundary.
- Requires the first decoded frame within 20 seconds.
- Requires at least 60 native frames during a 15-second soak with no gap over 2.5 seconds.
- Requires an authenticated Meta Browser client to render and acknowledge ten ordered frames.
- Retains one credential-free JSON report locally with build, headset, OS, timing, frame, skip, and verdict fields.
- Leaves the proven poc.10 FLIR acquisition, palette, and snapshot paths unchanged.

## Quest acceptance run

Launch the thermal scene from Meta Browser, enter the native workspace, and select **RUN FULL DIAGNOSTIC**. After `NATIVE PASS`, return to the same browser scene. Accept only `W14 PASS`; a `C00` or `W14 FAIL` entry is the authoritative first failed boundary.
