# MxGenius Sensor Bridge 0.1.0-poc.18

This build completes the operator transition from the stable powered FLIR connection into native VR.

- Restores a prominent **ENTER VR** button above the thermal preview.
- Keeps the button visible but disabled until the first decoded thermal frame (`N13`).
- Opens native immersive mode only after an operator tap (`N14`); there is no automatic launch timer.
- Retains the 2D activity behind the immersive scene so the foreground service, live stream, and active session survive entry and return.
- Adds clear guidance to keep FLIR on a powered USB-C path during live thermal use.
- Leaves the poc.17 FLIR discovery, permission callback, thermal decoding, palette, and transport paths unchanged.
