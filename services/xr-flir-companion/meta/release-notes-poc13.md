# MxGenius Sensor Bridge 0.1.0-poc.13

- Reuses an existing FLIR device-scoped USB grant without asking Horizon OS or the FLIR SDK for permission again.
- Requests USB authorization exactly once only when the freshly discovered FLIR identity has no grant.
- Discards stale identities after `INVALID_IDENTITY` or `DEVICE_UNAVAILABLE_WHEN_ASKED_PERMISSION` and performs a bounded fresh discovery instead of retrying the old object.
- Tags enumeration, permission, and connection diagnostics with a discovery generation so one physical attachment can be followed end to end.
- Defers optional Quest RGB-camera permissions to the explicit **ARM RGB SNAPSHOT** action in both the 2D and immersive native panels.
- Adds behavioral tests for grant bypass, first request, rediscovery, bounded recovery, and terminal errors.

## Quest acceptance run

Cold-start the bridge with the FLIR already attached. Accept the USB prompt if Horizon OS presents it. The trace must show one generation from `discovery-start` through `connect-start`; if authorization is already present it must show `permission-bypassed` and no `permission-request`. If the device re-enumerates, the trace must show `permission-rediscovery` followed by a higher generation. Thermal startup must never display the Quest RGB-camera prompt. Arm RGB capture separately only after thermal streaming is stable, then run **RUN FULL DIAGNOSTIC** to `W14 PASS`.
