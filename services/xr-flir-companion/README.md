# MxGenius FLIR companion

This Android companion is the native FLIR ONE workspace for Meta Quest. It starts from the Meta library or a browser deep link, owns Android USB permission and the FLIR stream, and renders the thermal pixels directly in a Meta Spatial SDK panel. The panel follows the headset until **PIN HERE** freezes it in world space; **FOLLOW HEAD** restores head-relative placement. The native frame path does not require the Pi, Meta Browser, Azure, or a relay.

The WebXR page opens a token-bound Quest-local handoff:

```text
mxgenius://sensor-bridge?sessionId=<opaque-id>&localToken=<ephemeral-token>
```

The deep link hands the session identity to the native app, which starts FLIR discovery and opens its immersive panel after the first decoded frame. The same foreground service remains alive across the 2D and immersive activities, so switching presentation modes does not relinquish the camera. The companion also hosts `ws://127.0.0.1:4109/thermal` as an optional compatibility path for Meta Browser. A loopback failure is logged but no longer blocks camera startup or native rendering. A separately issued `wss://` relay may still be included for remote witnessing. The Raspberry Pi diagnostics appliance is a separate system and is not packaged into this APK.

When compatibility transport is used, it follows the browser secure-context model: `127.0.0.1` is a potentially trustworthy origin, while arbitrary LAN `ws://` endpoints are not. The ephemeral token stays in browser session storage and the Android activation intent; it is not persisted by the companion.

## Vendor boundary

The Teledyne FLIR AARs are licensed dependencies and are intentionally not copied into this repository or the Pi image. The Gradle build consumes these files from `FLIR_MOBILE_SDK_HOME`:

- `androidsdk-release.aar`
- `thermalsdk-release.aar`

The local default is `D:\AAog\Flir-SDK\atlas-java-sdk-android-2.22.0`. FLIR 2.22.0 is compiled against API 36; the app still targets the Quest Android 14/API 34 runtime and ARM64 ABI.

## Local build

The build script uses Android Studio or JDK 21 when installed. On this workstation it also detects the checksum-verified portable Microsoft OpenJDK under `D:\AAog\.tooling\jdk21`; that toolchain is outside Git and was not installed system-wide. Android SDK 36 and build-tools 36.0.0 are expected under `%LOCALAPPDATA%\Android\Sdk`.

```powershell
cd D:\AAog\mxgenius.io\services\xr-flir-companion
.\build-local.ps1
```

The script validates the external AARs and uses the repository's pinned Gradle 8.13 wrapper. It does not copy or modify the SDK. Release builds load the permanent MxGenius signing key and the current-user-protected credential from `D:\AAog\.secrets`; neither file belongs in Git.

```powershell
.\build-local.ps1 -Configuration Release
```

The one-time `mxgenius-sensor-bridge-recovery.txt` file in that protected directory must be transferred to the company password manager and then removed. The same signing key is required for every future update to `io.mxgenius.sensorbridge`.

Treat the APK uploaded to Meta as an immutable release artifact. A later local rebuild can have the same package, version, byte size, and signing certificate while producing a different SHA-256 digest. Retain the exact uploaded APK and its provenance; never rebuild an existing `versionCode` and represent it as the published binary.

## Standalone cold test

1. Power the Raspberry Pi off and leave Azure/network access unavailable.
2. Install the APK on the Quest and launch **MxGenius Sensor Bridge** from the Meta library.
3. Connect the FLIR ONE and select **Connect FLIR ONE**.
4. Approve the Android USB prompt.
5. Confirm the panel reaches `streaming` and renders live thermal pixels.
6. Open the native immersive workspace, press **PIN HERE**, move your head, and confirm the panel remains fixed in world space.
7. Unplug and reconnect the camera, then use **RECONNECT FLIR** and repeat the check.

For the integrated launch test, open the sensor scene in Meta Browser and select **Open native thermal workspace**. The native app requests FLIR access, waits for its first decoded frame, and enters the immersive workspace itself. Use **PIN HERE** to stop the thermal panel at its current world pose; **FOLLOW HEAD** resumes head-relative placement. Use **2D PANEL** to return the same live service to Horizon panel mode.

The numbered native, broker, and browser checkpoints are documented in [`docs/QUEST_THERMAL_TRACE.md`](../../docs/QUEST_THERMAL_TRACE.md). A failure entry or the last successful step identifies which connection vector stopped progressing.

The optional WebXR loopback path is tested separately and must not change local camera readiness. Do not treat a deep-link launch as proof of camera readiness; require `N13` (first frame) and `N16` (native panel ready).

The debug manifest allows cleartext `ws://` only for this local pilot. Release builds disable cleartext transport and the activation parser rejects it.

## Meta Alpha distribution

The browser's install fallback points to the private Meta Alpha channel for app `1280760725126205`:

```text
https://www.oculus.com/experiences/1280760725126205/release-channels/1516125643598287/
```

Meta has published `0.1.0-poc.6` (`versionCode 6`, Meta build `1296553506880260`) to Alpha. This build makes foreground startup immediate, holds the panel in a stable readiness lifecycle, and replays native broker/FLIR startup phases into the WebXR trace. The FLIR viewer remains standalone and independent of the Pi. The channel URL is intentionally free of invitation or email tracking parameters and still requires an invited Meta account. Accepting the channel invitation grants entitlement but does not download the APK directly; on the joined headset account, install **MxGenius Sensor Bridge** from **Quest Library → Not installed**. An APK update must increment `versionCode`; changing site configuration or Meta artwork does not require a new APK.

`0.1.0-poc.7` (`versionCode 7`) has been uploaded and assigned to Alpha. It tested the bridge-to-browser handoff.

`0.1.0-poc.8` (`versionCode 8`) replaces that critical browser handoff with a Meta Spatial SDK immersive panel owned by the companion. It also serializes FLIR frame conversion and disconnect, drops overlapping conversion work, keeps the loopback broker optional, renders the retained native trace in VR, and supports world pin/follow plus manual reconnect.

`0.1.0-poc.9` (`versionCode 9`) hardens sustained streaming after the first successful frame. It skips the transient streamer exceptions documented by FLIR, detaches rendered bitmaps from the SDK-owned image buffer, preserves vendor disconnect codes in the VR trace, uses the Iron palette, and updates only the image portion of the Spatial panel at a bounded preview cadence.

`0.1.0-poc.10` (`versionCode 10`) adds an ephemeral Quest RGB snapshot seam for an active WebXR Realtime session. The companion requests the two Meta camera permissions while foregrounded, arms a camera foreground service, opens one right-eye passthrough camera frame on authenticated demand, returns a bounded JPEG only to the requesting local client, and immediately releases the camera. The browser sends that image directly into its existing Realtime model context; it is not saved by the companion or Azure.

`0.1.0-poc.11` (`versionCode 11`) adds a deterministic thermal commissioning run. **RUN FULL DIAGNOSTIC** cold-reconnects FLIR, requires a first decoded frame within 20 seconds, soaks the native stream for 15 seconds with minimum-rate and maximum-gap gates, then waits for Meta Browser to render and acknowledge ten ordered frames from the same authenticated session. One versioned JSON report is retained locally and mirrored into the in-headset panel; the first failed boundary owns the verdict.

`0.1.0-poc.12` (`versionCode 12`) corrects the Quest USB ownership lifecycle. It declares the FLIR Systems USB attachment route, reports the enumerated VID/PID and device-scoped authorization state in VR, preserves an already healthy stream during commissioning, waits for the interface to settle before a necessary reconnect, and applies FLIR's bounded retry for `DEVICE_UNAVAILABLE_WHEN_ASKED_PERMISSION` instead of treating that transient re-enumeration as a fatal camera failure.

`0.1.0-poc.13` (`versionCode 13`) makes FLIR authorization deterministic. An existing device-scoped grant connects immediately without opening a second permission transaction. `INVALID_IDENTITY` and device-unavailable callbacks discard the stale SDK identity and run a bounded fresh discovery with generation-tagged diagnostics. Optional Quest RGB permissions are no longer requested during FLIR startup; **ARM RGB SNAPSHOT** owns that separate prompt explicitly.

`0.1.0-poc.14` (`versionCode 14`) moves USB authorization ahead of the FLIR SDK. One app-owned Android `UsbManager.requestPermission` transaction waits for `EXTRA_PERMISSION_GRANTED`, unregisters its receiver on every terminal path, and verifies the grant after re-enumeration before FLIR discovery can begin. Diagnostics now distinguish permission receipt, stable authorization, blocking camera connection, stream registration, and the first decoded thermal frame; no pre-frame FLIR startup stage claims success.

`0.1.0-poc.15` (`versionCode 15`) replaces the short pre-permission retry gate with one deterministic USB lifecycle. The bridge listens for attach/detach, polls Android inventory once per second without an enumeration deadline, targets the exact FLIR ONE `09cb:1996` identity, and opens no more than one permission transaction per physical attachment. Missing callback identity and device re-enumeration return to synchronization instead of becoming false denial or panic states. Commissioning begins its first-frame timeout only after the FLIR stream is registered. The lifecycle policy is host-tested across cold boot, existing grant, callback omission, detach/re-attach, explicit denial, and device changes during verification.

`0.1.0-poc.16` (`versionCode 16`) removes the custom Android USB permission state machine. The foreground activity now follows the FLIR Atlas 2.22.0 sample directly: discover the FLIR USB identity, use `UsbPermissionHandler`, wait for `permissionGranted`, then call `Camera.connect`. An existing vendor-reported grant bypasses the dialog, and only FLIR's documented `DEVICE_UNAVAILABLE_WHEN_ASKED_PERMISSION` result repeats the permission request. There is no inventory polling, inferred grant, device-ID reconciliation, stability delay, permission timeout, or pre-grant connection attempt.

`0.1.0-poc.17` (`versionCode 17`) makes that vendor permission retry deterministic. The app uses only FLIR Atlas runtime authorization—there is no competing manifest USB-attachment route. If FLIR reports `DEVICE_UNAVAILABLE_WHEN_ASKED_PERMISSION`, the bridge posts one retry to the next main-loop turn so the SDK's first broadcast receiver can finish unregistering before a second is registered. A second device-unavailable result is terminal and visible; only `permissionGranted` may begin `Camera.connect`.

`0.1.0-poc.18` (`versionCode 18`) restores deliberate entry into the native spatial workspace after the powered FLIR path produces its first decoded frame. A prominent **ENTER VR** control stays visible above the 2D preview, remains disabled until live thermal is ready, and opens VR only on an operator tap. The 2D activity is retained behind the immersive scene so returning preserves the active service and session. The panel also calls out the powered USB-C requirement observed during live Quest testing.

`0.1.0-alpha.20` (`versionCode 20`) adds the native Remote Witness media producer to the Alpha line. After the browser hands off its authenticated room, an explicit wearer action opens Horizon's MediaProjection consent prompt. A pinned ARM64 libwebrtc build then sends one video-only `1280x720@15fps` compositor track over the existing WSS-signaled peer; microphone capture remains absent. Pause, projection revocation, WSS loss, expiry, service stop, and XR-session replacement release the peer and consent-scoped capture while the FLIR, one-shot snapshot, and evidence paths remain independent.

`0.1.0-alpha.21` (`versionCode 21`) closes the native wearer-control surface. The immersive panel displays the existing customer QR and manual code, intended audience, viewer count, expiry, approved layers, recording and network state, and explicit errors without rendering diagnostic logs. START performs wearer approval and fresh Horizon capture consent; PAUSE removes media, RESUME requires fresh consent, and END revokes the room. The panel reports LIVE only from the connected WebRTC peer, while credentials remain memory-only and absent from the rendered state.

Meta cover art is submission metadata, not an Android resource and not part of the APK. In the Developer Dashboard use **App submissions → v1 → App metadata → Assets → Cover art → Landscape**. Upload `meta/store-assets/cover-landscape-2560x1440.png`, a 24-bit 2560×1440 PNG. `meta/store-assets/manifest.json` maps every local asset to its dashboard field and records its checksum and dimensions. Keeping this draft metadata does not submit the app for public Store review.

Every local build runs `verify-release.ps1` after Gradle. The verification gate inspects the produced APK for the expected build identity, Horizon 2D panel declaration, ARM64-only native libraries, a valid signature (and the permanent release certificate for Release), and packaged adaptive/density-aware launcher resources. It also validates the canonical Meta store assets against their manifest. A missing or mismatched requirement fails the build.

The FLIR Atlas 2.22.0 native library currently triggers Meta's bundled `libssh2` advisory. It did not block the private Alpha build, but the vendor dependency must be updated or formally dispositioned before any public submission; do not patch the licensed `.so` in place.
