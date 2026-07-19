import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const application = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../application-client.js', import.meta.url), 'utf8');
const cache = await readFile(new URL('../cache.js', import.meta.url), 'utf8');
const caseWorkspace = await readFile(new URL('../case-workspace.js', import.meta.url), 'utf8');
const realtimeClient = await readFile(new URL('../realtime-client.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('../auth.js', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../3d-viewer/index.html', import.meta.url), 'utf8');
const modelCatalog = JSON.parse(await readFile(new URL('../3d-viewer/models.json', import.meta.url), 'utf8'));

function matches(pattern, text = dashboard) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

test('dashboard element IDs are unique', () => {
  const ids = matches(/\bid="([^"]+)"/g);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();
  assert.deepEqual(duplicates, []);
});

test('every navigation tab resolves to exactly one panel', () => {
  const tabs = matches(/\bdata-tab="([^"]+)"/g);
  assert.deepEqual(tabs.sort(), ['3d-viewer', 'case', 'dashboard', 'settings']);

  for (const tab of tabs) {
    const escaped = tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const panelCount = (dashboard.match(new RegExp(`id="tab-${escaped}"`, 'g')) || []).length;
    assert.equal(panelCount, 1, `tab-${tab} should exist exactly once`);
  }
});

test('critical retained surfaces remain present', () => {
  const requiredIds = [
    'tab-dashboard',
    'tab-3d-viewer',
    'tab-settings',
    'globeViz',
    'aircraftGrid',
    'acDetailModal',
    'ai-chat-panel',
    'tab-case'
  ];

  for (const id of requiredIds) {
    assert.match(dashboard, new RegExp(`id="${id}"`), `${id} should remain present`);
  }
  assert.match(application, /function buildMROSignals\(/, 'fleet triage attributes should remain available');
});

test('technical evidence stays behind case and chat boundaries instead of a dead library tab', () => {
  assert.doesNotMatch(dashboard, /data-tab="docs"/);
  assert.doesNotMatch(dashboard, /id="tab-docs"/);
  assert.match(application, /MXApplicationClient\.compliance\.applicableAds/);
  assert.match(client, /mxg\.compliance\.applicable_ads/);
});

test('known POC-only data and loaders are absent', () => {
  for (const loader of ['loadProspecting', 'loadBases', 'loadCompliance', 'loadMarketplace']) {
    assert.doesNotMatch(application, new RegExp(loader), `${loader} must be removed`);
  }

  for (const fakeRecord of ['Acme Aviation', 'Advanced AOG Primary', 'N100GS', 'AeroParts Global']) {
    assert.doesNotMatch(application, new RegExp(fakeRecord), `${fakeRecord} must not ship as product data`);
  }

  assert.doesNotMatch(application, /Token Marketplace/i);
  assert.doesNotMatch(dashboard, /API Console|consolePanel|settingsAutoSpeak|chat-attach-btn/i);
  assert.doesNotMatch(dashboard, />\s*(?:Overdue|Current)\s*</i);
  assert.doesNotMatch(dashboard, /MRO Scan/i);
  assert.doesNotMatch(application, /D-check overdue|Higher hours = more overdue maintenance/i);
  assert.doesNotMatch(application, /faa_data\/faa_ads_slim\.json/);
  assert.doesNotMatch(application, /__MXG_CHAT_API_KEY__|apiKey\s*:/);
  assert.doesNotMatch(application, /__MXG_API_EMAIL__|__MXG_API_PASSWORD__|adminLogin/);
  assert.doesNotMatch(client, /Admin\/APILogin|adminLogin/);
  assert.match(auth, /getCompatibilitySession/);
  assert.doesNotMatch(dashboard, /Work Order Invoice|Email Invoice|Pending AI/i);
});

test('maintenance case workspace is mounted through the canonical client boundary', () => {
  assert.match(dashboard, /id="caseIntakeForm"/);
  assert.doesNotMatch(dashboard, /id="work-order-panel"/);
  assert.doesNotMatch(application, /setupWorkOrderPanel|<workorder>/i);
  assert.match(dashboard, /id="caseWorkspaceResult"/);
  assert.match(caseWorkspace, /MXApplicationClient\.caseWorkspace\.runFirstSlice/);
  assert.match(caseWorkspace, /mxg:case-selected/);
  assert.match(caseWorkspace, /mxgenius:part-selected/);
  assert.match(application, /activeCaseId/);
  assert.match(application, /MX3DViewer\.setContext/);
  assert.match(dashboard, /id="activeCaseCard"/);
  assert.match(application, /const MXCaseState/);
  assert.match(application, /data-aircraft-reg/);
  assert.match(application, /case-card-badge/);
  assert.match(application, /activeUrgencyFilter === 'active-case'/);
  assert.match(application, /cluster\.hasActiveCase/);
  assert.match(application, /case-context-banner/);
  assert.match(dashboard, /id="pillActiveCase"/);
  assert.match(dashboard, /id="caseMarkerButton"/);
  assert.match(caseWorkspace, /digitalTwin\.inspectSelection/);
  assert.match(caseWorkspace, /digitalTwin\.attachMarker/);
  assert.match(caseWorkspace, /component\?\.canonical/);
});

test('application script order preserves cache and client prerequisites', () => {
  const cacheIndex = dashboard.indexOf('<script src="cache.js"></script>');
  const clientIndex = dashboard.indexOf('<script src="application-client.js"></script>');
  const realtimeIndex = dashboard.indexOf('<script src="realtime-client.js"></script>');
  const appIndex = dashboard.indexOf('<script src="app.js"></script>');
  const productionUiIndex = dashboard.indexOf('<link rel="stylesheet" href="production-ui.css">');

  assert.ok(cacheIndex >= 0, 'cache.js should be loaded');
  assert.ok(clientIndex > cacheIndex, 'application-client.js should load after cache.js');
  assert.ok(realtimeIndex > clientIndex, 'realtime-client.js should load after application-client.js');
  assert.ok(appIndex > clientIndex, 'app.js should load after application-client.js');
  assert.ok(productionUiIndex >= 0, 'production UI layer should be loaded');
});

test('Realtime WebRTC is mounted without exposing server credentials', () => {
  for (const id of ['realtimeState', 'realtimeTranscript', 'realtimeInterruptBtn', 'realtimeConfirmation']) {
    assert.match(dashboard, new RegExp(`id="${id}"`));
  }
  assert.match(realtimeClient, /new RTCPeerConnection\(\)/);
  assert.match(realtimeClient, /getUserMedia/);
  assert.match(realtimeClient, /createDataChannel\('oai-events'\)/);
  assert.match(realtimeClient, /response\.function_call_arguments\.done/);
  assert.match(client, /\/realtime\/calls/);
  assert.match(client, /\/confirmations/);
  assert.match(application, /requires_human_approval/);
  assert.match(application, /confirmations\.issue/);
  assert.match(application, /HUMAN_DECLINED/);
  assert.match(realtimeClient, /configureTools/);
  assert.match(realtimeClient, /function_call_output/);
  assert.doesNotMatch(`${dashboard}\n${application}\n${client}\n${realtimeClient}`, /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/);
});

test('3D viewer exposes raycast selection through the application boundary', () => {
  assert.match(viewer, /new THREE\.Raycaster\(\)/);
  assert.match(viewer, /intersectObject\(currentModel, true\)/);
  assert.match(viewer, /mxgenius\.viewer\.part-selected/);
  assert.match(viewer, /mxgenius\.viewer\.highlight-part/);
  assert.match(application, /window\.MX3DViewer = MX3DViewer/);
  assert.match(application, /mxgenius:part-selected/);
});

test('3D viewer uses capability-gated browser WebXR without Apple-specific product coupling', () => {
  assert.match(dashboard, /allow="xr-spatial-tracking; fullscreen"/);
  assert.match(viewer, /id="enter-vr-button"/);
  assert.match(viewer, /isSessionSupported\('immersive-vr'\)/);
  assert.match(viewer, /requestSession\('immersive-vr'/);
  assert.match(viewer, /optionalFeatures: \['local-floor', 'bounded-floor'\]/);
  assert.doesNotMatch(viewer, /Apple Vision|ARButton/);
});

test('compatibility-source cards escape text and avoid external identifiers in inline handlers', () => {
  assert.match(application, /function escapeMarkup\(/);
  assert.match(application, /data-aircraft-id/);
  assert.match(application, /data-company-id/);
  assert.doesNotMatch(application, /onclick="showCompanyDetail\(\$\{/);
  assert.doesNotMatch(application, /onclick="showAircraftDetail\(\$\{/);
});

test('bundled 3D catalog does not claim demo assets are validated operational twins', () => {
  assert.ok(modelCatalog.length > 0);
  for (const model of modelCatalog) {
    assert.equal(model.operationalStatus, 'demo_asset', `${model.file} must be explicitly classified`);
  }
});

test('retained JetNet, cache, globe, chat, 3D, and document boundaries remain mounted', () => {
  for (const method of ['bulkAircraft', 'aircraftList', 'aircraftBundle', 'staticJson']) {
    assert.match(client, new RegExp(`\\b${method}\\b`), `${method} client boundary must remain`);
  }
  assert.match(cache, /cachedFetch/);
  assert.match(application, /function loadGlobe\(/);
  assert.match(application, /function showAircraftDetail\(/);
  assert.match(application, /function setupChatPanel\(/);
  assert.match(application, /display_index\/catalog\.json/);
  assert.match(application, /let cachedFleetSignals = \[\]/);
  assert.match(application, /llamaContext\.completion/);
  assert.match(application, /Cloud and on-device assistance are unavailable/);
  assert.match(application, /MX3DViewer/);
  assert.match(dashboard, /src="cache\.js"[\s\S]*src="application-client\.js"[\s\S]*src="case-workspace\.js"[\s\S]*src="app\.js"/);
});
