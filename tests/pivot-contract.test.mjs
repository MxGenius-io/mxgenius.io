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
const companionService = await read('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/SensorBridgeService.java');
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

test('Quest companion config uses the published Alpha fallback and next build identity', () => {
  assert.match(runtimeConfig, /sensorCompanionVersion: '0\.1\.0-poc\.4'/);
  assert.match(runtimeConfig, new RegExp(metaRelease.releaseChannel.installUrl.replaceAll('/', '\\/')));
  assert.doesNotMatch(metaRelease.releaseChannel.installUrl, /[?&](?:is_email_click|utm_)/);
  assert.equal(metaRelease.publishedBuild.versionCode, 4);
  assert.equal(metaRelease.publishedBuild.versionName, '0.1.0-poc.4');
  assert.equal(metaRelease.publishedBuild.status, 'Published');
  assert.equal(metaRelease.build.versionCode, 5);
  assert.equal(metaRelease.build.versionName, '0.1.0-poc.5');
  assert.equal(metaRelease.metadata.storeAssetsManifest, 'store-assets/manifest.json');
  assert.match(companionManifest, /com\.oculus\.intent\.category\.2D/);
  assert.match(companionManifest, /com\.oculus\.vrshell\.panel_activity/);
  assert.match(companionManifest, /@mipmap\/mxgenius_launcher/);
  assert.match(companionGradle, /versionCode = 5/);
  assert.match(companionGradle, /versionName = "0\.1\.0-poc\.5"/);
  const canonicalCover = storeAssetManifest.assets.find((asset) => asset.canonicalUpload);
  assert.equal(canonicalCover.metaDashboardField, 'Cover art > Landscape');
  assert.equal(canonicalCover.width, 2560);
  assert.equal(canonicalCover.height, 1440);
  assert.match(companionBuild, /verify-release\.ps1/);
  for (const gate of [
    'com.oculus.intent.category.2D',
    'arm64-v8a',
    'apksigner.bat',
    'mipmap-anydpi-v26',
    'storeAssetsManifest'
  ]) assert.match(companionVerifier, new RegExp(gate.replaceAll('.', '\\.')));
});

test('Quest FLIR companion is standalone and has no Pi runtime dependency', () => {
  assert.doesNotMatch(companionManifest, /BLUETOOTH_CONNECT|hardware\.bluetooth/);
  assert.match(companionActivity, /Standalone · local thermal preview/);
  assert.match(companionActivity, /startForegroundService\(serviceIntent\)/);
  assert.match(companionService, /void connectCamera\(Activity activity\) \{\s*camera\.discoverAndConnect\(activity\)/);
  assert.doesNotMatch(companionService, /PiDiagnosticsClient|activation-required/);
  assert.match(companionLayout, /android:id="@\+id\/thermal_preview"/);
  assert.doesNotMatch(companionLayout, /connect_pi|pi_status|Connect MxGenius Pi/);
  assert.doesNotMatch(relayClient, /sendDiagnostics|pi-diagnostics-rfcomm|edge-diagnostics-1/);
  assert.match(localThermalBroker, /127\.0\.0\.1|allowedOrigins/);
  assert.match(localThermalBroker, /invalid thermal session/);
  assert.match(localThermalTransport, /MxgsFrameEncoder\.jpeg/);
  assert.match(companionService, /localTransport\.sendFrame\(bitmap\)/);
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
