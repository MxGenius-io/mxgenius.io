# MxGenius FLIR companion

This Android companion is a standalone native FLIR ONE viewer for Meta Quest. It starts from the Meta library, requests Android USB-host permission, and renders a live thermal preview in its floating panel without requiring the Pi, browser, Azure, or a relay.

An optional WebXR handoff may open

```text
mxgenius://sensor-bridge?sessionId=<opaque-id>&bridge=<short-lived-wss-url>
```

on the Quest. That handoff adds an independent thermal transport after local preview is available; it is not a camera activation requirement. When assigned, the companion forwards throttled JPEG thermal frames in the `MXGS/1` envelope. The Raspberry Pi diagnostics appliance is a separate system and is not packaged into this APK.

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

## Standalone cold test

1. Power the Raspberry Pi off and leave Azure/network access unavailable.
2. Install the APK on the Quest and launch **MxGenius Sensor Bridge** from the Meta library.
3. Connect the FLIR ONE and select **Connect FLIR ONE**.
4. Approve the Android USB prompt.
5. Confirm the floating panel reaches `streaming` and renders live thermal pixels.
6. Unplug and reconnect the camera, then close and reopen the panel and repeat the check.

The WebXR path is tested separately and must not change local camera readiness. Do not treat a deep-link launch as proof of either camera or WebXR transport readiness.

The debug manifest allows cleartext `ws://` only for this local pilot. Release builds disable cleartext transport and the activation parser rejects it.

## Meta Alpha distribution

The browser's install fallback points to the private Meta Alpha channel for app `1280760725126205`:

```text
https://www.oculus.com/experiences/1280760725126205/release-channels/1516125643598287/
```

Meta has published `0.1.0-poc.4` (`versionCode 4`) to Alpha. The next signed private candidate is `0.1.0-poc.5` (`versionCode 5`), which makes the FLIR viewer standalone and removes its Pi dependency. The channel URL is intentionally free of invitation or email tracking parameters and still requires an invited Meta account. An APK update must increment `versionCode`; changing site configuration or Meta artwork does not require a new APK.

Meta cover art is submission metadata, not an Android resource and not part of the APK. In the Developer Dashboard use **App submissions → v1 → App metadata → Assets → Cover art → Landscape**. Upload `meta/store-assets/cover-landscape-2560x1440.png`, a 24-bit 2560×1440 PNG. `meta/store-assets/manifest.json` maps every local asset to its dashboard field and records its checksum and dimensions. Keeping this draft metadata does not submit the app for public Store review.

Every local build runs `verify-release.ps1` after Gradle. The verification gate inspects the produced APK for the expected build identity, Horizon 2D panel declaration, ARM64-only native libraries, a valid signature (and the permanent release certificate for Release), and packaged adaptive/density-aware launcher resources. It also validates the canonical Meta store assets against their manifest. A missing or mismatched requirement fails the build.

The FLIR Atlas 2.22.0 native library currently triggers Meta's bundled `libssh2` advisory. It did not block the private Alpha build, but the vendor dependency must be updated or formally dispositioned before any public submission; do not patch the licensed `.so` in place.
