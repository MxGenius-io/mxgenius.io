import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
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
const applicationStyles = await readFile(new URL('../app-styles.css', import.meta.url), 'utf8');
const modelCatalog = JSON.parse(await readFile(new URL('../3d-viewer/models.json', import.meta.url), 'utf8'));
const fleetProxy = await readFile(new URL('../services/fleet-proxy/server.js', import.meta.url), 'utf8');
const gitAttributes = await readFile(new URL('../.gitattributes', import.meta.url), 'utf8');
const mcpGitAttributes = await readFile(new URL('../services/mcp/.gitattributes', import.meta.url), 'utf8');
const liveProbe = await readFile(new URL('../scripts/live-field-probe.mjs', import.meta.url), 'utf8');
const pagesWorkflow = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const reportDisplay = await readFile(new URL('../report-display.html', import.meta.url), 'utf8');
const progress = await readFile(new URL('../progress.html', import.meta.url), 'utf8');
const week19Report = await readFile(new URL('../Generated Reports/week-19/week-19-report.md', import.meta.url), 'utf8');

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
  assert.deepEqual(tabs.sort(), ['3d-viewer', 'case', 'dashboard', 'parts', 'settings']);

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

test('Pages release retains generated report content', () => {
  assert.match(
    pagesWorkflow,
    /cp -R --[^\n]*"Generated Reports"[^\n]*_site\//,
    'the Pages artifact must include the report scripts, images, and media referenced by report-display.html'
  );
});

test('report display preserves external image schemes and constrains report media', () => {
  assert.match(
    reportDisplay,
    /externalSource = \/\^\(\?:https\?:\|data:\|blob:\)/,
    'data and remote image sources must not have their URI schemes encoded'
  );
  assert.match(reportDisplay, /\.report-image\s*\{[\s\S]*max-height:\s*72vh/);
});

test('progress banner identifies the latest published report', () => {
  assert.match(progress, />Week 19 Ready</);
  assert.doesNotMatch(progress, />Week 20 Ready</);
});

test('week 19 screenshots stay paired with the sections they depict', async () => {
  const expectedPairs = [
    ['Back end clean-up and service', 'image-4.png'],
    ['map expansion', 'image-6.png'],
    ['side panels', 'image-7.png'],
    ['Rocky update', 'image-5.png'],
    ['settings update', 'image-8.png'],
    ['3d Viewer update', 'image-9.png'],
    ['maintenance case deep-dive', 'image-10.png'],
    ['landing page refresh', 'image-11.png'],
    ['dashboard active cases', 'image-12.png'],
    ['AI triage advisory', 'image-13.png'],
    ['aircraft detail panel', 'image-14.png'],
    ['the full picture', 'image-15.png']
  ];

  for (const [heading, image] of expectedPairs) {
    const section = week19Report.split(`## ${heading}`)[1]?.split('\n## ')[0] ?? '';
    assert.match(section, new RegExp(`\\(${image.replace('.', '\\.')}\\)`), `${heading} should use ${image}`);
  }

  assert.doesNotMatch(week19Report, /\(image-[23]\.png\)/, 'supporting expense screenshots should not leak into later sections');

  const referencedImages = [...week19Report.matchAll(/!\[[^\]]*\]\((image-\d+\.png)\)/g)]
    .map((match) => match[1])
    .sort();
  const publishedImages = (await readdir(new URL('../Generated Reports/week-19/', import.meta.url)))
    .filter((name) => /^image-\d+\.png$/.test(name))
    .sort();
  assert.deepEqual(publishedImages, referencedImages, 'Week 19 should not publish unreferenced image files');
});

test('generated report image references resolve to published files', async () => {
  const reportsRoot = new URL('../Generated Reports/', import.meta.url);
  const weeks = await readdir(reportsRoot, { withFileTypes: true });

  for (const week of weeks.filter((entry) => entry.isDirectory())) {
    const reportUrl = new URL(`${week.name}/${week.name}-report.md`, reportsRoot);
    let markdown;
    try {
      markdown = await readFile(reportUrl, 'utf8');
    } catch {
      continue;
    }
    const references = [...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
      .map((match) => match[1])
      .filter((source) => !/^(?:data:|https?:|blob:)/i.test(source));

    for (const reference of references) {
      await assert.doesNotReject(
        access(new URL(`${week.name}/${reference}`, reportsRoot)),
        `${week.name} image should exist: ${reference}`
      );
    }
  }
});

test('technical evidence stays behind case and chat boundaries instead of a dead library tab', () => {
  assert.doesNotMatch(dashboard, /data-tab="docs"/);
  assert.doesNotMatch(dashboard, /id="tab-docs"/);
  assert.match(application, /MXApplicationClient\.aircraft\.lookup/);
  assert.match(application, /MXApplicationClient\.compliance\.applicableAds/);
  assert.match(client, /mxg\.compliance\.applicable_ads/);
});

test('all mounted typed capabilities are surfaced through the settings operations workbench', () => {
  assert.match(dashboard, /id="settingsOperationsCard"/);
  assert.match(dashboard, /id="capabilityCatalog"/);
  assert.match(dashboard, /id="capabilityFields"/);
  assert.match(dashboard, /Advanced request/);
  assert.match(dashboard, /id="capabilityResultSummary"/);
  assert.match(dashboard, /src="capability-workbench\.js(?:\?v=\d+)?"/);
  assert.match(capabilityWorkbench, /MXApplicationClient\.capabilities\.list/);
  assert.match(capabilityWorkbench, /MXApplicationClient\.capabilities\.call/);
  assert.match(capabilityWorkbench, /mxg:case-selected/);
  assert.match(capabilityWorkbench, /readinessOf/);
  assert.match(capabilityWorkbench, /capability-readiness/);
  assert.match(dashboard, /id="capabilityShowPlanned"/);
});

test('known POC-only data and loaders are absent', () => {
  for (const loader of ['loadProspecting', 'loadBases', 'loadCompliance', 'loadMarketplace']) {
    assert.doesNotMatch(application, new RegExp(loader), `${loader} must be removed`);
  }

  for (const fakeRecord of ['Acme Aviation', 'Advanced AOG Primary', 'N100GS', 'AeroParts Global']) {
    assert.doesNotMatch(application, new RegExp(fakeRecord), `${fakeRecord} must not ship as product data`);
  }

  assert.doesNotMatch(application, /Token Marketplace/i);
  assert.doesNotMatch(dashboard, /API Console|consolePanel|settingsAutoSpeak/i);
  assert.doesNotMatch(dashboard, />\s*(?:Overdue|Current)\s*</i);
  assert.doesNotMatch(dashboard, /MRO Scan/i);
  assert.doesNotMatch(application, /D-check overdue|Higher hours = more overdue maintenance/i);
  assert.doesNotMatch(application, /faa_data\/faa_ads_slim\.json/);
  assert.doesNotMatch(application, /__MXG_CHAT_API_KEY__|apiKey\s*:/);
  assert.doesNotMatch(application, /__MXG_API_EMAIL__|__MXG_API_PASSWORD__|adminLogin/);
  assert.doesNotMatch(client, /Admin\/APILogin|adminLogin/);
  assert.match(auth, /getCompatibilitySession/);
  assert.doesNotMatch(auth, /mx_beta_whitelist/);
  assert.match(auth, /\/api\/profile/);
  assert.match(application, /MXApplicationClient\.betaAccess\.add/);
  assert.match(dashboard, /@domain\.com/);
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
  assert.match(dashboard, /id="caseMarkerButton"/);
  assert.match(caseWorkspace, /digitalTwin\.inspectSelection/);
  assert.match(caseWorkspace, /digitalTwin\.attachMarker/);
  assert.match(caseWorkspace, /component\?\.canonical/);
  assert.match(dashboard, /id="caseExistingSelect"/);
  assert.match(dashboard, /id="caseOpenButton"/);
  assert.match(caseWorkspace, /MXApplicationClient\.cases\.list/);
  assert.match(caseWorkspace, /mxg\.maintenance_case\.build_context/);
  assert.match(caseWorkspace, /mxg_active_case_id/);
});

test('fleet compatibility translation is scoped and market intelligence uses subscribed dropdown options', () => {
  assert.doesNotMatch(application, /window\.fetch\s*=/);
  assert.match(client, /method: method === 'PUT' \? 'POST' : method/);
  assert.match(client, /Model\/getModelIntelligence/);
  assert.match(application, /loadMarketIntelCatalog/);
  assert.match(application, /updateMarketModelOptions/);
  assert.match(application, /Array\.isArray\(payload\?\.modelIntelligence\)/);
  assert.doesNotMatch(application, /modelOperationCosts|modelPerformanceSpecs|modelMarketTrends/);
  assert.match(dashboard, /<select id="mktMake"/);
  assert.match(dashboard, /<select id="mktModel"/);
  assert.match(application, /escapeMarkup\(formatted\)/);
});

test('detailed JetNet success statuses remain renderable and cacheable', () => {
  const detailedStatusGuard = /\^success\\b\/i\.test\(String\(data\.responsestatus\)\.trim\(\)\)/g;
  assert.equal(
    (application.match(detailedStatusGuard) || []).length,
    2,
    'both aircraft views should accept JetNet SUCCESS: detail summaries'
  );
  assert.match(
    cache,
    /\^success\\b\/i\.test\(String\(data\.responsestatus\)\.trim\(\)\)/,
    'successful detailed JetNet pages should be cached'
  );
});

test('complete demo data is explicit, tenant-authenticated, and user initiated', () => {
  assert.match(dashboard, /id="settingsLoadDemoData"/);
  assert.match(dashboard, /Complete Demo Workspace/);
  assert.match(application, /MXApplicationClient\.demoData\.load\(serverSession\)/);
  assert.match(client, /\/api\/demo-data/);
  assert.match(client, /LOAD_DEMO_DATA/);

  const settingsStart = application.indexOf('function initSettings()');
  const settingsEnd = application.indexOf('function closeModal', settingsStart);
  const demoHandler = application.indexOf("loadDemoDataButton?.addEventListener('click'", settingsStart);
  const marketIntelStart = application.indexOf('function setupMarketIntel()');
  const marketIntelEnd = application.indexOf('async function loadMarketIntelCatalog', marketIntelStart);

  assert.ok(demoHandler > settingsStart && demoHandler < settingsEnd, 'demo handler must stay inside initSettings scope');
  assert.equal(
    application.slice(marketIntelStart, marketIntelEnd).includes('loadDemoDataButton'),
    false,
    'market intelligence startup must not reference settings-local demo controls'
  );
});

test('application script order preserves cache and client prerequisites', () => {
  const cacheIndex = dashboard.indexOf('<script src="cache.js"></script>');
  const clientIndex = dashboard.search(/<script src="application-client\.js\?v=\d+"><\/script>/);
  const realtimeIndex = dashboard.search(/<script src="realtime-client\.js\?v=\d+"><\/script>/);
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
  assert.match(dashboard, /3d-viewer\/index\.html\?v=11/);
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

test('owned and uploaded GLB models remain available without a Sketchfab catalog dependency', async () => {
  assert.ok(modelCatalog.some((model) => model.file?.endsWith('.glb')), 'local GLB models must remain available');
  assert.ok(
    modelCatalog.some((model) => model.file === 'models/SingleBoardComputer_Prototype_v1.glb'),
    'the single-board computer apparatus model must remain selectable'
  );
  assert.ok(
    modelCatalog.some(
      (model) => model.file === 'models/BlackPicatinnyRail_v1.glb' && model.name === 'Black Picatinny Rail'
    ),
    'the black Picatinny rail model must remain selectable'
  );
  assert.ok(
    modelCatalog.some(
      (model) => model.file === 'models/FLIRThermalCamera_v1.glb' && model.name === 'FLIR Thermal Camera'
    ),
    'the FLIR thermal camera model must remain selectable'
  );
  await Promise.all(
    ['models/BlackPicatinnyRail_v1.glb', 'models/FLIRThermalCamera_v1.glb'].map((file) =>
      access(new URL(`../3d-viewer/${file}`, import.meta.url))
    )
  );
  assert.equal(modelCatalog.some((model) => model.provider === 'sketchfab'), false);
  assert.doesNotMatch(JSON.stringify(modelCatalog), /sketchfab/i);
});

test('fleet globe opens a direct current-Three passthrough route with cached coordinates', () => {
  assert.match(dashboard, /id="globeVrButton"/);
  assert.match(application, /function clusterAltitude\(\) \{ return 0\.0015; \}/);
  assert.match(application, /function attentionClusters/);
  assert.match(application, /\.ringsData\(attentionClusters\(aggregateGlobeClusters\(allClusters, globeZoomAltitude\)\)\)/);
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
  const onboardingIndex = dashboard.indexOf('<script src="onboarding.js?v=4"></script>');
  const applicationIndex = dashboard.search(/<script src="app\.js\?v=\d+"><\/script>/);
  assert.ok(onboardingIndex >= 0 && onboardingIndex < applicationIndex);
  assert.match(dashboard, /onboarding\.css\?v=2/);
  assert.match(dashboard, /id="onboardingRoot"/);
  assert.match(onboarding, /checkFirstRun/);
  assert.match(onboarding, /restart/);
  assert.match(onboarding, /injectEmptyCta/);
  assert.match(onboarding, /mxg_onboarding_complete_v3/);
  assert.match(onboarding, /id: 'procurement'/);
  assert.match(onboarding, /title: 'Parts & Procurement'/);
  assert.match(onboarding, /target: '#signedInAs'/);
  assert.match(onboarding, /target: '#partsNav'/);
  assert.match(onboarding, /target: '#btnReceivePart'/);
  assert.match(onboarding, /target: '#partsInventoryGrid'/);
  assert.match(onboarding, /review OCR suggestions/);
  assert.match(onboarding, /FAA references, and QR label/);
  assert.doesNotMatch(onboarding, /data-tab="operations"/);
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
  assert.match(client, /Authenticated application session required/);
  assert.match(client, /X-MXG-Organization-ID/);
  assert.match(fleetProxy, /MXGENIUS_AUTHZ_URL/);
  assert.match(fleetProxy, /MXGENIUS_INTERNAL_BEARER_TOKEN/);
  assert.match(fleetProxy, /await authorize\(request\)/);
  assert.match(fleetProxy, /FLEET_RATE_LIMIT_PER_MINUTE/);
});

test('fleet globe uses zoom-aware screen-space aviation cluster markers', () => {
  assert.match(application, /function aggregateGlobeClusters\(/);
  assert.match(application, /\.htmlElementsData\(aggregateGlobeClusters\(allClusters, globeZoomAltitude\)\)/);
  assert.match(application, /\.htmlElement\(createGlobeClusterMarker\)/);
  assert.match(application, /anchor\.className = 'fleet-map-anchor'/);
  assert.match(application, /\.htmlAltitude\(0\.0015\)/);
  assert.match(application, /\.onZoom\(handleGlobeZoom\)/);
  assert.match(application, /cluster\.airportCount > 1/);
  assert.match(applicationStyles, /\.fleet-map-marker__beacon/);
  assert.match(applicationStyles, /\.fleet-map-anchor/);
  assert.match(applicationStyles, /\.fleet-map-marker__count/);
  assert.match(applicationStyles, /\.fleet-map-marker--stacked/);
});

test('public runtime configuration mounts the live core without embedding credentials', () => {
  assert.match(dashboard, /src="runtime-config\.js\?v=3"/);
  assert.match(runtimeConfig, /https:\/\/mxg-core\.[a-z0-9-]+\.centralus\.azurecontainerapps\.io/);
  assert.match(runtimeConfig, /https:\/\/mxg-fleet\.[a-z0-9-]+\.centralus\.azurecontainerapps\.io/);
  assert.match(runtimeConfig, /allowInsecurePilot: false/);
  assert.doesNotMatch(runtimeConfig, /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/);
});

test('immutable SQLx migrations retain LF bytes in Windows deployment archives', () => {
  assert.match(gitAttributes, /^services\/mcp\/migrations\/\*\.sql text eol=lf$/m);
  assert.match(mcpGitAttributes, /^migrations\/\*\.sql text eol=lf$/m);
});

test('live field probe covers the deployed frontend, core, memory, MCP, and manual assets', () => {
  for (const marker of [
    'Dashboard release assets',
    'Core readiness',
    'MCP registry',
    'Fleet authentication boundary',
    'FAA candidate retrieval',
    'Structured chat',
    'Thread persistence',
    'Manual retrieval and images',
    'Realtime WebRTC'
  ]) {
    assert.match(liveProbe, new RegExp(marker));
  }
});
