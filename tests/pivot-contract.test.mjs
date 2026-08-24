import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const pivot = await read('docs/PIVOT_2026-08-14_XR_EDGE.md');
const gateway = JSON.parse(await read('services/xr-diagnostics-kiosk/contracts/xr-session-gateway.schema.json'));
const scan = JSON.parse(await read('services/xr-diagnostics-kiosk/contracts/scan-observation.schema.json'));
const companion = JSON.parse(await read('services/xr-diagnostics-kiosk/contracts/sensor-companion.schema.json'));
const evidence = JSON.parse(await read('services/xr-diagnostics-kiosk/contracts/diagnostic-evidence.schema.json'));
const coreHttp = await read('services/mcp/server/src/transport/http.rs');
const runtimeConfig = await read('runtime-config.js');
const sensorOrb = await read('xr-sensor-orb.js');
const manualManifest = JSON.parse(await read('services/mcp/config/authoritative-manual-pack-v1.json'));
const manualService = await read('services/manual-retrieval/app.py');
const jetnetProbe = await read('probe_jetnet.js');
const jetnetDeepProbe = await read('probe_deep.js');
const metaRelease = JSON.parse(await read('services/xr-flir-companion/meta/meta-release.json'));
const storeAssetManifest = JSON.parse(await read('services/xr-flir-companion/meta/store-assets/manifest.json'));
const companionManifest = await read('services/xr-flir-companion/app/src/main/AndroidManifest.xml');
const companionGradle = await read('services/xr-flir-companion/app/build.gradle.kts');
const companionBuild = await read('services/xr-flir-companion/build-local.ps1');
const companionVerifier = await read('services/xr-flir-companion/verify-release.ps1');
const companionActivity = await read('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/MainActivity.java');
const companionImmersiveActivity = await read('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/ThermalImmersiveActivity.kt');
const companionFollowSystem = await read('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/ThermalPanelFollowSystem.kt');
const companionService = await read('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/SensorBridgeService.java');
const companionCamera = await read('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/FlirCameraController.java');
const headsetSnapshotCamera = await read('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/HeadsetSnapshotController.java');
const companionLayout = await read('services/xr-flir-companion/app/src/main/res/layout/activity_main.xml');
const localThermalBroker = await read('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/LocalThermalBroker.java');
const localThermalTransport = await read('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/LocalThermalTransport.java');
const relayClient = await read('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/RelayClient.java');

test('dated pivot names every canonical source and the baseline commit', () => {
  assert.match(pivot, /MXG-PIVOT-2026-08-14-XR-EDGE-V1/);
  assert.match(pivot, /Baseline commit: `08f2804`/);
  for (const source of [
    'authoritative-manual-pack-v1.json',
    'provider_auth.rs',
    'xr-session-gateway.schema.json',
    'diagnostics-state.schema.json',
    'scan-observation.schema.json',
    'sensor-companion.schema.json',
    'integration-fixtures.schema.json',
    'diagnostic-evidence.schema.json',
    'release-files.txt'
  ]) assert.match(pivot, new RegExp(source.replaceAll('.', '\\.')));
});

test('browser Pi and evidence contracts agree on session and scanner identity', () => {
  const sessionPattern = gateway.$defs.sessionId.pattern;
  assert.equal(scan.properties.sessionId.pattern, sessionPattern);
  assert.match(sessionPattern, /128/);
  assert.ok(evidence.properties.source.properties.kind.enum.includes('barcode-scanner'));
  assert.equal(companion.$defs.activation.properties.sessionId.$ref, '#/$defs/sessionId');
  assert.equal(companion.$defs.activation.properties.localToken.pattern, '^[A-Za-z0-9_-]{32,128}$');
  assert.ok(companion.$defs.activation.anyOf.some((option) => option.required?.includes('localToken')));
  assert.equal(companion.$defs.announce.properties.nodeType.const, 'quest-companion');
  assert.equal(companion.$defs.announce.properties.capabilities.contains.const, 'flir-one-pro-usb-c');
  assert.match(sensorOrb, /message\.type === 'scan\.observed'/);
  assert.match(sensorOrb, /mxgenius:scan-observed/);
});

test('embedding service implementation agrees with the frozen manual manifest', () => {
  const model = manualService.match(/^MODEL_NAME = "([^"]+)"$/m)?.[1];
  const dimensions = Number(manualService.match(/^VECTOR_DIMENSIONS = (\d+)$/m)?.[1]);
  assert.equal(model, manualManifest.index_contract.embedding_model);
  assert.equal(dimensions, manualManifest.index_contract.vector_dimensions);
});

test('production XR negotiation remains explicitly unmounted and runtime config has no relay credential', () => {
  assert.match(pivot, /contract-only and unmounted/);
  assert.doesNotMatch(coreHttp, /api\/xr\/sessions\/negotiate/);
  assert.doesNotMatch(runtimeConfig, /sensorBridgeUrl\s*:/);
});

test('Quest companion config uses the current Alpha candidate build identity', () => {
  assert.match(runtimeConfig, /sensorCompanionVersion: '0\.1\.0-poc\.18'/);
  assert.match(runtimeConfig, /sensorCompanionEntitlementUrl:/);
  assert.doesNotMatch(runtimeConfig, /sensorCompanionDownloadUrl:/);
  assert.match(runtimeConfig, new RegExp(metaRelease.releaseChannel.installUrl.replaceAll('/', '\\/')));
  assert.doesNotMatch(metaRelease.releaseChannel.installUrl, /[?&](?:is_email_click|utm_)/);
  assert.equal(metaRelease.publishedBuild.versionCode, 6);
  assert.equal(metaRelease.publishedBuild.versionName, '0.1.0-poc.6');
  assert.equal(metaRelease.publishedBuild.buildId, '1296553506880260');
  assert.equal(metaRelease.publishedBuild.status, 'Published');
  assert.equal(metaRelease.uploadedBuild.versionCode, 18);
  assert.equal(metaRelease.uploadedBuild.versionName, '0.1.0-poc.18');
  assert.equal(metaRelease.uploadedBuild.status, 'UploadedPendingMetaVerification');
  assert.equal(metaRelease.build.versionCode, 18);
  assert.equal(metaRelease.build.versionName, '0.1.0-poc.18');
  assert.equal(metaRelease.build.metaTestStatus, 'UploadedPendingMetaVerification');
  assert.equal(metaRelease.metadata.storeAssetsManifest, 'store-assets/manifest.json');
  assert.match(companionManifest, /com\.oculus\.intent\.category\.2D/);
  assert.match(companionManifest, /com\.oculus\.vrshell\.panel_activity/);
  assert.match(companionManifest, /@mipmap\/mxgenius_launcher/);
  assert.match(companionGradle, /versionCode = 18/);
  assert.match(companionGradle, /versionName = "0\.1\.0-poc\.18"/);
  const canonicalCover = storeAssetManifest.assets.find((asset) => asset.canonicalUpload);
  assert.equal(canonicalCover.metaDashboardField, 'Cover art > Landscape');
  assert.equal(canonicalCover.width, 2560);
  assert.equal(canonicalCover.height, 1440);
  assert.match(companionBuild, /verify-release\.ps1/);
  for (const gate of [
    'com.oculus.intent.category.2D',
    'com.oculus.intent.category.VR',
    'arm64-v8a',
    'apksigner.bat',
    'mipmap-anydpi-v26',
    'storeAssetsManifest'
  ]) assert.match(companionVerifier, new RegExp(gate.replaceAll('.', '\\.')));
});

test('Quest FLIR companion is standalone and has no Pi runtime dependency', () => {
  assert.doesNotMatch(companionManifest, /BLUETOOTH_CONNECT|hardware\.bluetooth/);
  assert.match(companionActivity, /Spatial · native panel/);
  assert.match(companionActivity, /startForegroundService\(serviceIntent\)/);
  assert.match(companionActivity, /service\.connectCamera\(this\)/);
  assert.match(companionActivity, /new Intent\(this, ThermalImmersiveActivity\.class\)/);
  assert.match(companionImmersiveActivity, /AppSystemActivity/);
  assert.match(companionImmersiveActivity, /LayoutXMLPanelRegistration/);
  assert.match(companionImmersiveActivity, /"N16"/);
  assert.match(companionService, /"N18"/);
  assert.match(companionService, /startCommissioning/);
  assert.match(companionService, /ThermalCommissioningRun/);
  assert.match(companionImmersiveActivity, /RUN FULL DIAGNOSTIC/);
  assert.match(companionFollowSystem, /followHead/);
  assert.match(companionFollowSystem, /panelPoseFor/);
  assert.match(companionCamera, /ErrorCodeException \| NullPointerException \| IllegalArgumentException/);
  assert.match(companionCamera, /sdkBitmap\.copy\(Bitmap\.Config\.ARGB_8888, false\)/);
  assert.match(companionCamera, /"iron"\.equalsIgnoreCase/);
  assert.match(companionService, /PREVIEW_INTERVAL_MS = 150L/);
  assert.match(companionService, /void connectCamera\(Activity activity\)[\s\S]*cameraRuntimeReady[\s\S]*discoverAndConnect\(activity\)/);
  assert.ok(
    companionService.indexOf('startForeground(NOTIFICATION_ID') < companionService.indexOf('lifecycleWorker.execute(this::initializeRuntime)'),
    'foreground mode must be entered before asynchronous native initialization'
  );
  assert.match(companionService, /setBridgeState\("ready", true, "camera-runtime-ready"\)/);
  assert.doesNotMatch(companionService, /PiDiagnosticsClient|activation-required/);
  assert.match(companionLayout, /android:id="@\+id\/thermal_preview"/);
  assert.match(companionLayout, /android:id="@\+id\/enter_immersive"/);
  assert.match(companionLayout, /android:id="@\+id\/power_guidance"/);
  assert.match(companionActivity, /R\.id\.enter_immersive/);
  assert.match(companionActivity, /requestImmersiveEntry/);
  assert.match(companionActivity, /operator requested native immersive mode after the first decoded frame/);
  assert.doesNotMatch(companionActivity, /postDelayed\(this::openImmersiveScene/);
  assert.doesNotMatch(companionActivity, /startActivity\(immersive\);\s*finish\(\)/);
  assert.doesNotMatch(companionLayout, /connect_pi|pi_status|Connect MxGenius Pi/);
  assert.match(companionActivity, /if \(data != null\)[\s\S]*BridgeActivation\.fromIntent/);
  assert.match(companionActivity, /Intent serviceIntent = new Intent\(this, SensorBridgeService\.class\)[\s\S]*startForegroundService\(serviceIntent\)/);
  assert.match(companionActivity, /Standalone · local thermal preview/);
  assert.doesNotMatch(relayClient, /sendDiagnostics|pi-diagnostics-rfcomm|edge-diagnostics-1/);
  assert.match(localThermalBroker, /127\.0\.0\.1|allowedOrigins/);
  assert.match(localThermalBroker, /invalid thermal session/);
  assert.match(localThermalBroker, /bridge\.trace/);
  assert.match(localThermalBroker, /headset\.snapshot\.request/);
  assert.match(localThermalBroker, /headset\.snapshot\.result/);
  assert.match(localThermalBroker, /consumers\.contains\(connection\)/);
  assert.match(localThermalBroker, /HISTORY_LIMIT = 64/);
  assert.match(localThermalBroker, /commissioning\.browser_ack/);
  assert.match(sensorOrb, /commissioning\.browser_ack/);
  assert.match(localThermalTransport, /MxgsFrameEncoder\.jpeg/);
  assert.match(companionService, /transport\.sendFrame\(bitmap\)/);
  assert.match(sensorOrb, /this\.diagnosticsSocket = socket/);
  assert.match(sensorOrb, /this\.socket = socket/);
  assert.match(sensorOrb, /piDiagnosticsBridge/);
  assert.match(headsetSnapshotCamera, /CAMERA_SOURCE_KEY/);
  assert.match(headsetSnapshotCamera, /ImageFormat\.JPEG/);
  assert.match(headsetSnapshotCamera, /CAPTURE_TIMEOUT_MS = 8_000L/);
  assert.match(headsetSnapshotCamera, /finishSuccess[\s\S]*closeCapture/);
  assert.match(companionManifest, /horizonos\.permission\.HEADSET_CAMERA/);
  assert.match(companionManifest, /android\.permission\.FOREGROUND_SERVICE_CAMERA/);
  assert.match(companionManifest, /android\.hardware\.usb\.host/);
  assert.doesNotMatch(companionManifest, /android\.hardware\.usb\.action\.USB_DEVICE_ATTACHED/);
  assert.doesNotMatch(companionManifest, /@xml\/flir_usb_devices/);
  assert.doesNotMatch(companionActivity, /isUsbAttachment|recordUsbAttachment/);
  assert.match(companionCamera, /UsbPermissionHandler/);
  assert.match(companionCamera, /hasFlirOnePermission/);
  assert.match(companionCamera, /requestFlirOnePermisson/);
  assert.match(companionCamera, /permissionGranted/);
  assert.match(companionCamera, /DEVICE_UNAVAILABLE_WHEN_ASKED_PERMISSION/);
  assert.match(companionCamera, /MAX_PERMISSION_ATTEMPTS = 2/);
  assert.match(companionCamera, /new Handler\(Looper\.getMainLooper\(\)\)/);
  assert.match(companionCamera, /mainHandler\.post/);
  assert.match(companionCamera, /attempt >= MAX_PERMISSION_ATTEMPTS/);
  assert.match(companionCamera, /usb-permission-device_unavailable_when_asked_permission/);
  assert.doesNotMatch(companionCamera, /runOnUiThread/);
  assert.doesNotMatch(companionCamera, /AndroidUsbPermissionGate|UsbHandshakePolicy/);
  assert.doesNotMatch(companionCamera, /UsbManager|PendingIntent|EXTRA_PERMISSION_GRANTED/);
  assert.doesNotMatch(companionCamera, /ENUMERATION_POLL_MS|GRANT_STABILITY_DELAY_MS|permission-gate-restart/);
  assert.match(companionCamera, /discoveryGeneration/);
  assert.match(companionCamera, /scanInFlight/);
  assert.match(companionCamera, /if \(!next\.isConnected\(\)\) \{[\s\S]*throw new IOException/);
  assert.match(companionService, /blocking Camera\.connect started", "info"/);
  assert.match(companionService, /Camera\.connect returned and thermal stream was configured", "info"/);
  assert.match(companionService, /waiting for first decoded thermal frame", "info"/);
  assert.match(companionLayout, /@\+id\/arm_snapshot/);
  assert.doesNotMatch(companionActivity, /^\s{8}requestHeadsetCameraPermissionsIfNeeded\(\);$/m);
  assert.match(companionService, /"stable-session"/);
  assert.match(companionService, /\.put\("usbState", usbState\)/);
});

test('legacy JetNet probes require runtime credentials and do not print token fragments', () => {
  for (const probe of [jetnetProbe, jetnetDeepProbe]) {
    assert.match(probe, /process\.env\.JETNET_IDENTITY/);
    assert.match(probe, /process\.env\.JETNET_CREDENTIAL/);
    assert.doesNotMatch(probe, /EmailAddress:\s*['"][^'"]+['"]/);
    assert.doesNotMatch(probe, /Password:\s*['"][^'"]+['"]/);
  }
  assert.doesNotMatch(jetnetProbe, /TOKEN\.slice/);
});

test('generated reports are not promoted to runtime architecture', () => {
  assert.doesNotMatch(pivot, /Generated Reports\/week-20/);
  assert.match(pivot, /presentation artifacts, not runtime contracts/);
});
