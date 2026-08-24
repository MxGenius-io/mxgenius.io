# MxGenius Sensor Bridge 0.1.0-poc.12

- Declares the Android USB attachment route for FLIR Systems vendor ID `09cb`.
- Logs the enumerated USB VID, PID, device class, product, and current device-scoped authorization state in the native VR trace.
- Preserves a healthy streaming camera when **RUN FULL DIAGNOSTIC** starts.
- Uses a 900 ms interface-settle gate before rediscovery when reconnecting is actually required.
- Retries FLIR Atlas `DEVICE_UNAVAILABLE_WHEN_ASKED_PERMISSION` at most three times with bounded backoff, matching the vendor sample's recovery behavior.
- Records USB state and detail in the retained commissioning JSON report.
- Keeps the poc.11 browser acknowledgment protocol unchanged.

## Quest acceptance run

Install the update, attach FLIR, and accept the Horizon USB ownership dialog. Launch the sensor scene from Meta Browser and run one full diagnostic. The native trace must show `U01` enumeration followed by `U02` authorization check and `U04` grant. A transient `U03 permission-retry` is acceptable only when followed by `U04`. Accept the run only at `W14 PASS`.
