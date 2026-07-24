import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const application = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../application-client.js', import.meta.url), 'utf8');
const cache = await readFile(new URL('../cache.js', import.meta.url), 'utf8');
const caseWorkspace = await readFile(new URL('../case-workspace.js', import.meta.url), 'utf8');
const realtimeClient = await readFile(new URL('../realtime-client.js', import.meta.url), 'utf8');
const capabilityWorkbench = await readFile(new URL('../capability-workbench.js', import.meta.url), 'utf8');
const runtimeConfig = await readFile(new URL('../runtime-config.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('../auth.js', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../3d-viewer/index.html', import.meta.url), 'utf8');
const viewerVrButton = await readFile(new URL('../3d-viewer/lib/webxr/VRButton.js', import.meta.url), 'utf8');
const xrMediaPanel = await readFile(new URL('../3d-viewer/xr-media-panel.js', import.meta.url), 'utf8');
const xrAnimationScrubber = await readFile(new URL('../3d-viewer/xr-animation-scrubber.js', import.meta.url), 'utf8');
const globeVr = await readFile(new URL('../globe-vr.html', import.meta.url), 'utf8');
const onboarding = await readFile(new URL('../onboarding.js', import.meta.url), 'utf8');
const onboardingStyles = await readFile(new URL('../onboarding.css', import.meta.url), 'utf8');
const modelCatalog = JSON.parse(await readFile(new URL('../3d-viewer/models.json', import.meta.url), 'utf8'));
const fleetProxy = await readFile(new URL('../services/fleet-proxy/server.js', import.meta.url), 'utf8');

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
  assert.deepEqual(tabs.sort(), ['3d-viewer', 'case', 'dashboard', 'operations', 'settings']);

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

test('all mounted typed capabilities are surfaced through the operations workbench', () => {
  assert.match(dashboard, /data-tab="operations"/);
  assert.match(dashboard, /id="capabilityCatalog"/);
  assert.match(dashboard, /id="capabilityFields"/);
  assert.match(dashboard, /Advanced request/);
  assert.match(dashboard, /id="capabilityResultSummary"/);
  assert.match(dashboard, /src="capability-workbench\.js(?:\?v=\d+)?"/);
  assert.match(capabilityWorkbench, /MXApplicationClient\.capabilities\.list/);
  assert.match(capabilityWorkbench, /MXApplicationClient\.capabilities\.call/);
  assert.match(capabilityWorkbench, /mxg:case-selected/);
  assert.match(capabilityWorkbench, /operations ready/);
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
  const clientIndex = dashboard.search(/<script src="application-client\.js\?v=\d+"><\/script>/);
  const realtimeIndex = dashboard.indexOf('<script src="realtime-client.js"></script>');
  const appIndex = dashboard.search(/<script src="app\.js\?v=\d+"><\/script>/);
  const productionUiIndex = dashboard.search(/<link rel="stylesheet" href="production-ui\.css\?v=\d+">/);

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

test('3D viewer uses an immersive HDRI workspace during XR presentation', () => {
  assert.match(dashboard, /allow="xr-spatial-tracking; fullscreen"/);
  assert.match(viewer, /id="enter-vr-button"/);
  assert.match(viewer, /import \{ VRButton \} from 'three\/addons\/webxr\/VRButton\.js'/);
  assert.match(viewer, /VRButton\.createButton\(renderer\)/);
  assert.match(viewerVrButton, /isSessionSupported\( 'immersive-vr' \)/);
  assert.match(viewerVrButton, /requestSession\( 'immersive-vr', sessionInit \)/);
  assert.match(viewer, /renderer\.xr\.enabled = true/);
  assert.match(viewer, /renderer\.setAnimationLoop\(animate\)/);
  assert.match(viewer, /renderer\.xr\.addEventListener\('sessionstart'/);
  assert.match(viewer, /renderer\.xr\.addEventListener\('sessionend'/);
  assert.match(viewer, /stageSceneForXR\('local-floor'\)/);
  assert.match(viewer, /alpha: true/);
  assert.match(viewer, /if \(hdriTexture\) \{[\s\S]*scene\.background = hdriTexture;[\s\S]*scene\.environment = hdriTexture;/);
  assert.match(viewer, /sceneBackground: scene\.background/);
  assert.match(viewer, /sceneEnvironment: scene\.environment/);
  assert.doesNotMatch(viewer, /navigator\.xr\.requestSession|setReferenceSpaceType/);
  assert.match(viewer, /restoreSceneFromXR\(\)/);
  assert.match(viewer, /renderer\.xr\.getController/);
  assert.match(viewer, /renderer\.xr\.getHand/);
  assert.match(viewer, /index-finger-tip/);
  assert.match(viewer, /mxgenius:xr-action/);
  assert.match(viewer, /mxgenius\.viewer\.xr-action/);
  assert.match(application, /message\.type === 'mxgenius\.viewer\.xr-action'/);
  assert.doesNotMatch(`${viewer}\n${viewerVrButton}`, /Apple Vision/);
});

test('XR procedure media uses direct video assets with optional timed mesh pairing', () => {
  assert.match(dashboard, /3d-viewer\/index\.html\?v=10/);
  assert.match(viewer, /id="procedure-media-video"/);
  assert.match(viewer, /id="procedure-media-button"/);
  assert.match(viewer, /import \{ XRMediaPanel \}/);
  assert.match(viewer, /mxgenius\.viewer\.set-tutorial/);
  assert.match(application, /setTutorial\(tutorial, context\)/);
  assert.match(xrMediaPanel, /new THREE\.VideoTexture\(video\)/);
  assert.match(xrMediaPanel, /mediaUrl/);
  assert.match(xrMediaPanel, /definition\.cues/);
  assert.match(xrMediaPanel, /onMeshSelector/);
  assert.match(xrMediaPanel, /toggle-playback/);
  assert.doesNotMatch(xrMediaPanel, /youtube\.com|youtu\.be/);
});

test('XR animation scrubber drives authored clips from controller or fingertip position', () => {
  assert.match(viewer, /import \{ XRAnimationScrubber \}/);
  assert.match(viewer, /xrAnimationScrubber\.scrubAtWorldPoint/);
  assert.match(viewer, /xrAnimationScrubber\?\.fingerScrub/);
  assert.match(xrAnimationScrubber, /action\.time = normalized \* this\.clip\.duration/);
  assert.match(xrAnimationScrubber, /scrub-animation/);
  assert.match(xrAnimationScrubber, /EXPLODED VIEW/);
  assert.match(xrAnimationScrubber, /presentationTarget/);
  assert.match(xrAnimationScrubber, /Math\.exp\(-12/);
  assert.match(xrMediaPanel, /presentationTarget/);
  assert.match(xrMediaPanel, /Math\.exp\(-12/);
});

test('XR workspace uses one-grab translation and two-grab scale rotation', () => {
  assert.match(viewer, /squeezestart/);
  assert.match(viewer, /squeezeend/);
  assert.match(viewer, /mode: 'move-world'/);
  assert.match(viewer, /mode: 'scale-rotate-world'/);
  assert.match(viewer, /setFromUnitVectors/);
  assert.match(viewer, /distance \/ xrWorldGesture\.distance/);
});

test('public Sketchfab models are additive and share desktop animation controls', () => {
  const external = modelCatalog.find((model) => model.provider === 'sketchfab');
  assert.ok(external, 'a public Sketchfab catalog entry should be present');
  assert.ok(modelCatalog.some((model) => model.file?.endsWith('.glb')), 'local GLB models must remain available');
  assert.equal(external.uid, '967cfd4aac234b2583e9e50060ff10af');
  assert.equal(external.attribution.license, 'CC BY 4.0');
  assert.match(viewer, /sketchfab-viewer-1\.12\.1\.js/);
  assert.match(viewer, /id="sketchfab-frame"/);
  assert.match(viewer, /getAnimations/);
  assert.match(viewer, /seekTo/);
  assert.match(viewer, /animation_autoplay: 0/);
});

test('fleet globe opens a direct current-Three passthrough route with cached coordinates', () => {
  assert.match(dashboard, /id="globeVrButton"/);
  assert.match(application, /function clusterAltitude\(\) \{ return 0\.0015; \}/);
  assert.match(application, /function attentionClusters/);
  assert.match(application, /\.ringsData\(attentionClusters\(allClusters\)\)/);
  assert.match(application, /\.ringColor\(clusterRingColor\)/);
  assert.match(application, /function openGlobeInVR\(\)/);
  assert.match(application, /mxg_globe_vr_data/);
  assert.match(application, /aircraft: cluster\.aircraft\.map/);
  assert.match(application, /globe-vr\.html\?v=6/);
  assert.match(globeVr, /three@0\.184\.0/);
  assert.match(globeVr, /XRButton\.createButton\(renderer,/);
  assert.match(globeVr, /alpha: true/);
  assert.match(globeVr, /scene\.background = null/);
  assert.match(globeVr, /renderer\.setAnimationLoop/);
  assert.match(globeVr, /mxg_globe_vr_data/);
  assert.match(globeVr, /setFromXRController/);
  assert.match(globeVr, /renderer\.xr\.getHand/);
  assert.match(globeVr, /index-finger-tip/);
  assert.match(globeVr, /mxgenius:xr-action/);
  assert.match(globeVr, /open-fleet-location/);
  assert.match(globeVr, /function openLocationDetails/);
  assert.match(globeVr, /FLEET LOCATION/);
  assert.match(globeVr, /MXApplicationClient\.aircraftBundle/);
  assert.match(client, /function aircraftImageUrl/);
  assert.match(globeVr, /JetNetImageGrid/);
  assert.match(globeVr, /MXApplicationClient\.aircraftImageUrl/);
  assert.match(globeVr, /Math\.ceil\(urls\.length \/ 6\)/);
  assert.match(globeVr, /slice\(imagePage \* 6, \(imagePage \+ 1\) \* 6\)/);
  assert.match(globeVr, /IMAGES \$\{imagePage \+ 1\} \/ \$\{imagePageCount\}/);
  assert.match(globeVr, /type: 'image-page'/);
  assert.match(fleetProxy, /evo-assets-3wl\.s3\.us-west-2\.amazonaws\.com/);
  assert.match(fleetProxy, /Cross-Origin-Resource-Policy/);
  assert.match(globeVr, /JETNET AIRCRAFT/);
  assert.match(globeVr, /panelMode = 'wrist'/);
  assert.match(globeVr, /FOLLOW WRIST/);
  assert.match(globeVr, /leftHand\?\.joints\?\.wrist/);
  assert.match(globeVr, /renderer\.xr\.getControllerGrip/);
  assert.match(globeVr, /function captureGlobeGesture/);
  assert.match(globeVr, /mode: 'scale'/);
  assert.match(globeVr, /globeGroup\.scale\.setScalar/);
  assert.match(globeVr, /FleetRotationToggle/);
  assert.match(globeVr, /toggleGlobeRotation/);
  assert.doesNotMatch(globeVr, /globeGroup\.quaternion\.copy/);
  assert.match(globeVr, /updateDetailsPresentation/);
  assert.match(globeVr, /detailsPanel\.scale\.setScalar\(0\.001\)/);
  assert.match(globeVr, /new THREE\.CircleGeometry/);
  assert.match(globeVr, /setFromUnitVectors/);
  assert.doesNotMatch(globeVr, /markerGeometry = new THREE\.SphereGeometry/);
  assert.doesNotMatch(globeVr, /HDRI|RGBELoader|EXRLoader/);
});

test('onboarding is mounted before application boot with restart and empty-state support', () => {
  const onboardingIndex = dashboard.indexOf('<script src="onboarding.js?v=2"></script>');
  const applicationIndex = dashboard.search(/<script src="app\.js\?v=\d+"><\/script>/);
  assert.ok(onboardingIndex >= 0 && onboardingIndex < applicationIndex);
  assert.match(dashboard, /onboarding\.css\?v=1/);
  assert.match(dashboard, /id="onboardingRoot"/);
  assert.match(onboarding, /checkFirstRun/);
  assert.match(onboarding, /restart/);
  assert.match(onboarding, /injectEmptyCta/);
  assert.match(onboarding, /mxg_onboarding_complete/);
  assert.match(onboarding, /target: '#globeVrButton'/);
  assert.match(onboarding, /native Quest Browser/);
  assert.match(onboarding, /controller selection and fingertip contact/);
  assert.match(onboardingStyles, /\.onboarding-welcome/);
  assert.match(application, /MXOnboarding\.checkFirstRun\(\)/);
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
    if (model.provider === 'sketchfab') {
      assert.equal(model.operationalStatus, 'external_reference', `${model.uid} must remain an external reference`);
      assert.ok(model.sourceUrl && model.attribution?.required, `${model.uid} must retain source attribution`);
    } else {
      assert.equal(model.operationalStatus, 'demo_asset', `${model.file} must be explicitly classified`);
    }
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
  assert.match(dashboard, /src="cache\.js"[\s\S]*src="application-client\.js(?:\?v=\d+)?"[\s\S]*src="case-workspace\.js(?:\?v=\d+)?"[\s\S]*src="app\.js(?:\?v=\d+)?"/);
});

test('fleet access uses the server-side proxy marker without browser credentials', () => {
  assert.match(application, /TOKEN = 'LIVE_TOKEN'/);
  assert.match(application, /BEARER = ''/);
  assert.doesNotMatch(application, /MXGENIUS_CONFIG\.getCompatibilitySession/);
  assert.doesNotMatch(application, /EmailAddress\s*:/);
});

test('public runtime configuration mounts the live core without embedding credentials', () => {
  assert.match(dashboard, /src="runtime-config\.js\?v=3"/);
  assert.match(runtimeConfig, /https:\/\/mxg-core\.[a-z0-9-]+\.centralus\.azurecontainerapps\.io/);
  assert.match(runtimeConfig, /https:\/\/mxg-fleet\.[a-z0-9-]+\.centralus\.azurecontainerapps\.io/);
  assert.match(runtimeConfig, /allowInsecurePilot: false/);
  assert.doesNotMatch(runtimeConfig, /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/);
});
