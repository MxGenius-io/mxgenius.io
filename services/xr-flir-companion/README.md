# MxGenius FLIR companion

This Android companion is the native half of the browser activation flow in `globe-vr.html`. The MxGenius page opens

```text
mxgenius://sensor-bridge?sessionId=<opaque-id>&bridge=<short-lived-wss-url>
```

on the Quest. The companion validates that handoff, starts a foreground transfer service, requests Android USB-host permission for the hard-wired FLIR ONE Pro, and forwards throttled JPEG thermal frames using the existing `MXGS/1` envelope. It also requests nearby-device access, connects to a paired Bluetooth Classic device named `MxGenius` through the standard Serial Port Profile, validates the Pi's length-prefixed `mxg.edge.diagnostics` messages, binds them to the active XR session, and forwards them through the same relay. Returning to the browser leaves both bridges active.

## Vendor boundary

The Teledyne FLIR AARs are licensed dependencies and are intentionally not copied into this repository or the Pi image. The Gradle build consumes these files from `FLIR_MOBILE_SDK_HOME`:

- `androidsdk-release.aar`
- `thermalsdk-release.aar`

The local default is `D:\AAog\Flir-SDK\atlas-java-sdk-android-2.22.0`. Both AARs require Android API 33 or newer; this POC targets API 36 and Quest's ARM64 ABI.

## Local build

The build script uses Android Studio or JDK 21 when installed. On this workstation it also detects the checksum-verified portable Microsoft OpenJDK under `D:\AAog\.tooling\jdk21`; that toolchain is outside Git and was not installed system-wide. Android SDK 36 and build-tools 36.0.0 are expected under `%LOCALAPPDATA%\Android\Sdk`.

```powershell
cd D:\AAog\mxgenius_repo\services\xr-flir-companion
.\build-local.ps1
```

The script validates the external AARs and reuses the Gradle wrapper shipped with FLIR's downloaded sample. It does not copy or modify the SDK. Release builds load the permanent MxGenius signing key and the current-user-protected credential from `D:\AAog\.secrets`; neither file belongs in Git.

```powershell
.\build-local.ps1 -Configuration Release
```

The one-time `mxgenius-sensor-bridge-recovery.txt` file in that protected directory must be transferred to the company password manager and then removed. The same signing key is required for every future update to `io.mxgenius.sensorbridge`.

## Cold test

1. Start the existing kiosk bridge and thermal simulator to verify the browser's `MXGS/1` rendering independently.
2. Serve `globe-vr.html` locally with `?sensorBridge=ws://<host>/ws/xr&insecurePilot=1`. The page maps the Pi's consumer route to `/ws/ingest` for the companion; `sensorIngest` can override it explicitly. Production activation requires separately negotiated consumer- and producer-scoped `wss://` URLs.
3. Install the debug APK on the Quest and open **Open sensor bridge** from the headset browser.
4. Pair the headset once with the Bluetooth device named **MxGenius**, grant the companion nearby-device permission, and select **Connect MxGenius Pi** if it is not already reconnecting automatically.
5. In the companion, select **Connect FLIR ONE** and approve the Android USB prompt.
6. Return to MxGenius. The setup panel must progress from relay to Quest app to FLIR streaming, while the diagnostics panel receives the Pi state independently.

Do not treat a successful deep-link launch as proof of camera readiness. The browser marks the companion ready only after its `node.announce` reaches the relay and marks thermal ready only after `source.status`/`MXGS/1` frames arrive.

The debug manifest allows cleartext `ws://` only for this local pilot. Release builds disable cleartext transport and the activation parser rejects it.

## Meta Alpha distribution

The browser's install fallback points to the private Meta Alpha channel for app `1280760725126205`:

```text
https://www.oculus.com/experiences/1280760725126205/release-channels/1516125643598287/
```

Meta has published `0.1.0-poc.3` (`versionCode 3`) to Alpha. The next signed private candidate is `0.1.0-poc.4` (`versionCode 4`), which corrects the Horizon panel declaration and launcher packaging. The channel URL is intentionally free of invitation or email tracking parameters and still requires an invited Meta account. An APK update must increment `versionCode`; changing site configuration or Meta artwork does not require a new APK.

Meta cover art is submission metadata, not an Android resource and not part of the APK. In the Developer Dashboard use **App submissions → v1 → App metadata → Assets → Cover art → Landscape**. Upload `meta/store-assets/cover-landscape-2560x1440.png`, a 24-bit 2560×1440 PNG. `meta/store-assets/manifest.json` maps every local asset to its dashboard field and records its checksum and dimensions. Keeping this draft metadata does not submit the app for public Store review.

Every local build runs `verify-release.ps1` after Gradle. The verification gate inspects the produced APK for the expected build identity, Horizon 2D panel declaration, ARM64-only native libraries, a valid signature (and the permanent release certificate for Release), and packaged adaptive/density-aware launcher resources. It also validates the canonical Meta store assets against their manifest. A missing or mismatched requirement fails the build.

The FLIR Atlas 2.22.0 native library currently triggers Meta's bundled `libssh2` advisory. It did not block the private Alpha build, but the vendor dependency must be updated or formally dispositioned before any public submission; do not patch the licensed `.so` in place.
