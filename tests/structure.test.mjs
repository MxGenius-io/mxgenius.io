import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const rootReadme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const featureCatalog = await readFile(new URL('../FEATURES.md', import.meta.url), 'utf8');
const landing = await readFile(new URL('../index.html', import.meta.url), 'utf8');
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
const xrMaintenanceHud = await readFile(new URL('../3d-viewer/xr-maintenance-hud.js', import.meta.url), 'utf8');
const xrUiAudio = await readFile(new URL('../xr-ui-audio.js', import.meta.url), 'utf8');
const xrGlobeHud = await readFile(new URL('../xr-globe-hud.js', import.meta.url), 'utf8');
const globeVr = await readFile(new URL('../globe-vr.html', import.meta.url), 'utf8');
const onboarding = await readFile(new URL('../onboarding.js', import.meta.url), 'utf8');
const onboardingStyles = await readFile(new URL('../onboarding.css', import.meta.url), 'utf8');
const guidedTooltip = await readFile(new URL('../guided-tooltip.js', import.meta.url), 'utf8');
const guidedTooltipStyles = await readFile(new URL('../guided-tooltip.css', import.meta.url), 'utf8');
const partsWorkspace = await readFile(new URL('../parts-workspace.js', import.meta.url), 'utf8');
const tooltipManifest = JSON.parse(
  await readFile(new URL('../assets/xr-ui-fx/audio/tooltips/scripts/manifest.json', import.meta.url), 'utf8')
);
const applicationStyles = await readFile(new URL('../app-styles.css', import.meta.url), 'utf8');
const modelCatalog = JSON.parse(await readFile(new URL('../3d-viewer/models.json', import.meta.url), 'utf8'));
const fleetProxy = await readFile(new URL('../services/fleet-proxy/server.js', import.meta.url), 'utf8');
const gitAttributes = await readFile(new URL('../.gitattributes', import.meta.url), 'utf8');
const mcpGitAttributes = await readFile(new URL('../services/mcp/.gitattributes', import.meta.url), 'utf8');
const liveProbe = await readFile(new URL('../scripts/live-field-probe.mjs', import.meta.url), 'utf8');
const pagesWorkflow = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const packageManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const rustToolchain = await readFile(new URL('../services/mcp/rust-toolchain.toml', import.meta.url), 'utf8');
const reportDisplay = await readFile(new URL('../report-display.html', import.meta.url), 'utf8');
const progress = await readFile(new URL('../progress.html', import.meta.url), 'utf8');
const week19Report = await readFile(new URL('../Generated Reports/week-19/week-19-report.md', import.meta.url), 'utf8');
const week22Report = await readFile(new URL('../Generated Reports/week-22/week-22-report.md', import.meta.url), 'utf8');
const week23Report = await readFile(new URL('../Generated Reports/week-23/week-23-report.md', import.meta.url), 'utf8');
const week23ReportScript = await readFile(new URL('../Generated Reports/week-23/week-23-report.js', import.meta.url), 'utf8');

function matches(pattern, text = dashboard) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

test('dashboard element IDs are unique', () => {
  const ids = matches(/\bid="([^"]+)"/g);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();
  assert.deepEqual(duplicates, []);
});

test('landing ChatGPT link uses the locally bundled official OpenAI Blossom', async () => {
  assert.match(landing, /class="gpt-icon"[\s\S]*src="assets\/openai-blossom-white\.svg"/);
  await access(new URL('../assets/openai-blossom-white.svg', import.meta.url));
});

test('landing navigation uses the canonical MxGenius logo asset', async () => {
  assert.match(landing, /<img class="brand-logo" src="assets\/mxgenius_logo\.png" alt="MxGenius logo">/);
  assert.doesNotMatch(landing, /class="brand-mark"/);
  await access(new URL('../assets/mxgenius_logo.png', import.meta.url));
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

test('Pages validation uses supported and reproducible toolchains', () => {
  assert.equal(packageManifest.engines.node, '>=24');
  assert.match(pagesWorkflow, /uses: actions\/checkout@v7/g);
  assert.match(pagesWorkflow, /uses: actions\/setup-node@v7/);
  assert.match(pagesWorkflow, /node-version: '24'/);
  assert.match(pagesWorkflow, /uses: actions\/configure-pages@v6/);
  assert.match(pagesWorkflow, /uses: actions\/upload-pages-artifact@v5/);
  assert.match(pagesWorkflow, /uses: actions\/deploy-pages@v5/);
  assert.match(pagesWorkflow, /toolchain: 1\.98\.0/);
  assert.match(rustToolchain, /channel = "1\.98\.0"/);
  assert.doesNotMatch(pagesWorkflow, /node-version: '20'/);
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
  assert.match(progress, />Week 23 Ready</);
  assert.match(progress, /Workflow Hardening &amp; Parts/);
  assert.match(progress, /Fleet, Market &amp; Demo Integration/);
  assert.doesNotMatch(progress, /viewReport\(20\)|viewReport\(21\)/);
  assert.match(progress, /viewReport\(22\)/);
  assert.match(progress, /viewReport\(23\)/);
});

test('week 23 report credits the team and stays focused on completed weekly work', () => {
  assert.match(week23Report, /## Executive Summary/);
  assert.match(week23Report, /Kudos first to Josh/);
  assert.match(week23Report, /Rocky turned “report a bug” into an accountable debug flow/);
  assert.match(week23Report, /Native iOS became its own spatial experience/);
  assert.match(week23Report, /60 commits after the Week 22 cutoff/);
  assert.match(week23Report, /signed MxGenius 3\.2\.0 Build 33/);
  assert.match(week23Report, /0\.1\.0-poc\.12/);
  assert.doesNotMatch(week23Report, /## Recommended next steps|## Further questions|## Caveats and assumptions/);
  assert.doesNotMatch(week23Report, /These counts describe the audited change footprint/);
  const embeddedReport = week23ReportScript.match(/^reportLoaded\(`([\s\S]*)`\);\s*$/)?.[1];
  assert.equal(embeddedReport, week23Report.trimEnd());
});

test('week 22 report separates validated plumbing from pending live headset tests', async () => {
  assert.match(week22Report, /## Executive Summary/);
  assert.match(week22Report, /## Week 22 in motion/);
  assert.match(week22Report, /🎬 \*\*Video:\*\* 817-walkthrough\.mp4/);
  assert.match(week22Report, /XR edge hardware pivot/);
  assert.match(week22Report, /0\.1\.0-poc\.4/);
  assert.match(week22Report, /did \*\*not\*\* close with a claim that live FLIR pixels/);
  assert.match(week22Report, /Work committed on Aug 17 belongs to the next reporting period/);
  assert.match(gitAttributes, /^\*\.mp4 filter=lfs diff=lfs merge=lfs -text$/m);
  assert.match(reportDisplay, /https:\/\/media\.githubusercontent\.com\/media\/MxGenius-io\/mxgenius\.io\/main\//);
  await access(new URL('../Generated Reports/week-22/817-walkthrough.mp4', import.meta.url));
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

test('native AR preserves independent anchors, VR data flow, and spatial Realtime audio', () => {
  assert.match(application, /anchors: 3/);
  assert.match(application, /plugin\.addListener\('pinSelected'/);
  assert.match(application, /plugin\.addListener\('aircraftSelected'/);
  assert.match(application, /MXApplicationClient\.aircraftBundle/);
  assert.match(application, /MXApplicationClient\.aircraftImageBlobUrl/);
  assert.match(application, /state\?\.state === 'ai-mic-toggle-request'/);
  assert.match(application, /globalThis\.MXRealtimeVoiceBridge/);
  assert.match(application, /await voice\.connect\(\)/);
  assert.match(application, /await startRealtimeVoice\(\)/);
  assert.match(application, /realtimeSession\.disconnect\(\)/);
  assert.match(application, /plugin\.addListener\('aiSpatialAudio'/);
  assert.match(application, /panningModel = 'HRTF'/);
  assert.match(application, /distanceModel = 'inverse'/);
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

test('root documentation exposes one status-marked product feature catalog', () => {
  assert.match(rootReadme, /\[Complete feature catalog\]\(FEATURES\.md\)/);
  assert.match(featureCatalog, /^# MXGenius feature catalog/m);
  assert.match(featureCatalog, /## Status legend/);
  for (const surface of [
    'Identity, tenancy, and platform access',
    'Fleet intelligence and JetNet',
    'Maintenance cases',
    'AI copilot, maintenance advisory, and Realtime voice',
    'Controlled parts and inventory',
    '3D inspection and digital-twin bridge',
    'Fleet globe XR',
    'Sensor bridge, FLIR, and Pi diagnostics',
    'Native iOS AR',
    'Onboarding, help, audio, and motion',
    'Feedback, project workspaces, and reports',
    'Compliance, manuals, weather, scheduling, and operations',
    'Security, integrity, and release controls',
    'Explicit product boundaries'
  ]) assert.match(featureCatalog, new RegExp(surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(featureCatalog, /\[x\]/);
  assert.match(featureCatalog, /\[~\]/);
  assert.match(featureCatalog, /\[!\]/);
  assert.match(featureCatalog, /\[-\]/);
});

test('WebXR maintenance HUD has a desktop preview and continuous spatial reveal sequence', () => {
  assert.match(viewer, /id="hud-preview-button"/);
  assert.match(viewer, /import \{ XRMaintenanceHUD \}/);
  assert.match(viewer, /xrMaintenanceHUD\?\.setPresenting\(true, camera\)/);
  assert.match(viewer, /xrMaintenanceHUD\?\.interactiveObjects\(\)/);
  assert.match(viewer, /xrMaintenanceHUD\?\.fingerTargetAt/);
  assert.match(viewer, /raycaster\.intersectObjects\(xrMaintenanceHUD\?\.interactiveObjects\(\) \|\| \[\], true\)/);
  assert.match(viewer, /xrMaintenanceHUD\?\.update\(delta, time, \{ camera \}\)/);
  assert.match(xrMaintenanceHud, /TOOL_ACTIONS/);
  assert.match(xrMaintenanceHud, /OBSERVATION/);
  assert.match(xrMaintenanceHud, /INTERPRETATION/);
  assert.match(xrMaintenanceHud, /ACTION/);
  assert.match(xrMaintenanceHud, /const brackets = windowedProgress/);
  assert.match(xrMaintenanceHud, /const outline = windowedProgress/);
  assert.match(xrMaintenanceHud, /const leader = windowedProgress/);
  assert.match(xrMaintenanceHud, /const card = windowedProgress/);
  assert.match(xrMaintenanceHud, /const effect = windowedProgress/);
  assert.match(xrMaintenanceHud, /new THREE\.EdgesGeometry\(object\.geometry, 38\)/);
  assert.match(xrMaintenanceHud, /edgeSegmentCount <= 220/);
  assert.match(xrMaintenanceHud, /side: THREE\.BackSide/);
  assert.match(xrMaintenanceHud, /prefers-reduced-motion: reduce/);
  assert.match(xrMaintenanceHud, /clearTarget\(\)/);
  assert.doesNotMatch(xrMaintenanceHud, /setInterval|visibility\s*=\s*!/);
});

test('WebXR maintenance audio maps every delivered cue and completes the live frontend actions', async () => {
  assert.match(viewer, /id="hud-sound-button"/);
  assert.match(viewer, /new XRUIAudio\(\{ camera, onStateChange: updateXRAudioStatus \}\)/);
  assert.match(viewer, /xrVoice\?\.toggle\(input\)/);
  assert.match(viewer, /xrVoice\?\.captureSnapshot\(input\)/);
  assert.match(viewer, /onSnapshotRequest: requestViewerSnapshot/);
  assert.match(viewer, /renderer\.readRenderTargetPixels/);
  assert.match(viewer, /action === 'clear'\) clearPartSelection\(\)/);
  assert.match(viewer, /updateHUDPointerFocus/);
  assert.match(viewer, /updateXRControllerHUDFocus/);
  assert.match(xrMaintenanceHud, /HUD_ACTION_CUES/);
  assert.match(xrMaintenanceHud, /setFocusedObject/);
  assert.match(xrUiAudio, /new THREE\.PositionalAudio\(this\.listener\)/);
  assert.match(xrUiAudio, /linearRampToValueAtTime\(0/);
  assert.match(xrUiAudio, /cueForXRAction/);
  const cueFiles = [...xrUiAudio.matchAll(/file: '([^']+\.wav)'/g)].map((match) => match[1]);
  assert.equal(cueFiles.length, 26);
  await Promise.all(cueFiles.map((file) => access(new URL(`../assets/xr-ui-fx/audio/${file}`, import.meta.url))));
});

test('shared XR audio covers the viewer, sensor bridge, and globe scene', () => {
  assert.match(viewer, /from '\.\.\/xr-ui-audio\.js\?v=1'/);
  assert.match(globeVr, /from '\.\/xr-ui-audio\.js\?v=1'/);
  assert.match(globeVr, /id="sceneSoundButton"/);
  assert.match(globeVr, /new XRUIAudio\(\{ camera, onStateChange: updateSceneSoundState \}\)/);
  assert.match(globeVr, /function emitSceneAction\(/);
  assert.match(globeVr, /emitSceneAction\('sensor-status'/);
  assert.match(globeVr, /emitSceneAction\('toggle-globe-rotation'/);
  assert.match(globeVr, /emitSceneAction\(detail\.action/);
  assert.match(xrUiAudio, /playAction\(action, target = \{\}, \{ object = null, gain = 1 \} = \{\}\)/);
  assert.match(xrUiAudio, /case 'open-fleet-location'/);
  assert.match(xrUiAudio, /case 'toggle-thermal-screen'/);
  assert.match(xrUiAudio, /case 'sensor-status'/);
});

test('web wrapper exposes fleet and 3D viewer entry points for the native AR camera bridge', () => {
  assert.match(dashboard, /id="globeArButton"/);
  assert.match(dashboard, /Open fleet globe in augmented reality/);
  assert.match(application, /Capacitor\?\.Plugins\?\.JetNetNative/);
  assert.match(application, /function nativeARBridgeIsReady\(plugin = nativeARGlobePlugin\(\)\)/);
  assert.match(application, /Boolean\(plugin\?\.isARSupported && \(plugin\?\.showGlobe \|\| plugin\?\.showSpatialScene\)\)/);
  assert.doesNotMatch(application, /function isNativeIOSGlobeHost\(\)/);
  assert.match(application, /plugin\.isARSupported\(\)/);
  assert.match(application, /plugin\.showGlobe\(\{/);
  assert.match(application, /MAX_NATIVE_AR_PINS = 750/);
  assert.match(application, /plugin\.addListener\('cameraPose'/);
  assert.match(application, /async function bindNativeARListeners\(plugin = nativeARGlobePlugin\(\)\)/);
  assert.match(application, /if \(capability\?\.supported\) await bindNativeARListeners\(plugin\)/);
  assert.match(application, /if \(state\?\.state === 'ai-mic-toggle-request'\) await toggleNativeARRealtime\(\)/);
  assert.match(application, /mxgenius:ar-camera-pose/);
  assert.match(application, /plugin\.addListener\('pinSelected'/);
  assert.match(viewer, /id="enter-ar-button"/);
  assert.match(viewer, /mxgenius\.viewer\.ar-request/);
  assert.match(viewer, /mxgenius\.viewer\.ar-capability/);
  assert.doesNotMatch(viewer, /function isNativeIOSViewerHost\(\)/);
  assert.match(viewer, /const supported = Boolean\(message\.supported\)/);
  assert.match(viewer, /#ar-button-container\[hidden\] \{ display: none !important; \}/);
  assert.match(applicationStyles, /#globeArButton\[hidden\],[\s\S]*#globeArGuide\[hidden\][\s\S]*display: none !important/);
  assert.match(application, /message\.type === 'mxgenius\.viewer\.ar-request'/);
  assert.match(application, /plugin\.showSpatialScene/);
  assert.match(application, /anchors: 3/);
  assert.match(application, /pointCloud: true/);
  assert.match(viewer, /modelAssetURL: entry\.file \? new URL\(entry\.file, window\.location\.href\)\.href : null/);
  assert.match(application, /modelConnected: Boolean\(modelId \|\| modelFile \|\| modelAssetURL\)/);
});

test('mobile globe panels keep controls reachable and avoid overlapping drawers', () => {
  assert.match(dashboard, /class="globe-sidebar-wrapper collapsed"/);
  assert.doesNotMatch(dashboard, /id="globeContainer" style=/);
  assert.match(applicationStyles, /\.globe-texture-buttons \{[\s\S]*overflow-y: auto/);
  assert.match(applicationStyles, /\.globe-sheet \{[\s\S]*width: calc\(100% - 52px\)/);
  assert.match(applicationStyles, /\.globe-sheet-toggle \{[\s\S]*width: 40px/);
  assert.match(applicationStyles, /\.globe-sheet-toggle \{[\s\S]*background: rgba\(8, 15, 30, 0\.94\)/);
  assert.match(applicationStyles, /\.globe-filter-hamburger \{[\s\S]*border: 1px solid rgba\(103, 232, 249, 0\.72\)/);
  assert.match(application, /const setSheetState = \(nextState\) =>/);
  assert.match(application, /if \(currentState > 0 && sidebarWrapper\)/);
  assert.match(application, /if \(willExpand\) setSheetState\(0\)/);
});

test('XR procedure media uses direct video assets with optional timed mesh pairing', () => {
  assert.match(dashboard, /3d-viewer\/index\.html\?v=16/);
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
  assert.match(application, /\.ringsData\(attentionClusters\(initialDisplayClusters\)\)/);
  assert.match(application, /\.ringColor\(clusterRingColor\)/);
  assert.match(application, /function openGlobeInVR\(\)/);
  assert.match(application, /mxg_globe_vr_data/);
  assert.match(application, /aircraft: cluster\.aircraft\.map/);
  assert.match(application, /globe-vr\.html\?v=8/);
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
  assert.match(globeVr, /import \{ XRGlobeHUD \}/);
  assert.match(globeVr, /new XRGlobeHUD\(\{ fleet, onAction: handleFleetHudAction \}\)/);
  assert.match(globeVr, /fleetHud\.interactiveObjects\(\)/);
  assert.match(globeVr, /fleetHud\.actionAtWorldPoint/);
  assert.match(globeVr, /toggleGlobeRotation/);
  assert.doesNotMatch(globeVr, /globeGroup\.quaternion\.copy/);
  assert.match(globeVr, /updateDetailsPresentation/);
  assert.match(globeVr, /detailsPanel\.scale\.setScalar\(0\.001\)/);
  assert.match(globeVr, /new THREE\.CircleGeometry/);
  assert.match(globeVr, /setFromUnitVectors/);
  assert.doesNotMatch(globeVr, /markerGeometry = new THREE\.SphereGeometry/);
  assert.doesNotMatch(globeVr, /HDRI|RGBELoader|EXRLoader/);
  assert.match(xrGlobeHud, /FleetBrowserParityHUD/);
  assert.match(xrGlobeHud, /FLEET CONTEXT/);
  assert.match(xrGlobeHud, /SPATIAL COMMAND/);
  assert.match(xrGlobeHud, /AIRCRAFT/);
  assert.match(xrGlobeHud, /MAPPED/);
  assert.match(xrGlobeHud, /COUNTRIES/);
  assert.match(xrGlobeHud, /ACTIVE CASE/);
  assert.match(xrGlobeHud, /HIGH TIME/);
  assert.match(xrGlobeHud, /PAUSE ROTATION/);
  assert.match(xrGlobeHud, /RECENTER/);
  assert.match(xrGlobeHud, /type: 'texture'/);
  assert.match(xrGlobeHud, /type: 'select-location'/);
  assert.match(globeVr, /contextProvider: \(\) => sensorOnlyScene/);
  assert.match(globeVr, /surface: 'fleet-globe'/);
  assert.match(globeVr, /xrVoice\.refreshContext\(\)/);
  assert.match(xrGlobeHud, /Math\.exp\(-10/);
});

test('company detail hydrates contacts and aircraft relationships with user-facing identifiers', () => {
  assert.match(application, /contactList\(\{ token: TOKEN, bearer: BEARER, filters: \{ companyid: companyId \} \}\)/);
  assert.match(application, /aircraftList\(\{ token: TOKEN, bearer: BEARER, filters: \{ aclist: relationshipIds \} \}\)/);
  assert.match(application, /<th>Tail Number<\/th>/);
  assert.match(application, /tailNumberByAircraftId/);
  assert.doesNotMatch(application, /<th>Aircraft ID<\/th>/);
});

test('maintenance case creation binds the explicit submit action to a short-lived confirmation grant', () => {
  assert.match(caseWorkspace, /MXApplicationClient\.aircraft\.lookup/);
  assert.match(caseWorkspace, /toolName: 'mxg\.maintenance_case\.create'/);
  assert.match(caseWorkspace, /raw_discrepancy: discrepancy/);
  assert.match(caseWorkspace, /confirmationGrant: confirmation\.token/);
  assert.doesNotMatch(caseWorkspace, /localStorage\.setItem\([^\n]*confirmation/i);
});

test('onboarding is mounted before application boot with restart and empty-state support', () => {
  const guidedTooltipIndex = dashboard.indexOf('<script src="guided-tooltip.js?v=2"></script>');
  const onboardingIndex = dashboard.indexOf('<script src="onboarding.js?v=5"></script>');
  const applicationIndex = dashboard.search(/<script src="app\.js\?v=\d+"><\/script>/);
  assert.ok(guidedTooltipIndex >= 0 && guidedTooltipIndex < onboardingIndex);
  assert.ok(onboardingIndex < applicationIndex);
  assert.match(dashboard, /guided-tooltip\.css\?v=3/);
  assert.match(dashboard, /onboarding\.css\?v=3/);
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
  assert.match(onboarding, /target: '#sensorSceneTab'/);
  assert.match(onboarding, /guideId: 'sensor-diagnostics'/);
  assert.match(onboarding, /native Quest Browser/);
  assert.match(onboarding, /controller selection and fingertip contact/);
  assert.match(onboarding, /MXGuidedTooltip\?\.mount/);
  assert.match(onboarding, /MXGuidedTooltip\?\.stop/);
  assert.match(onboardingStyles, /\.onboarding-welcome/);
  assert.match(guidedTooltip, /document\.createElement\('video'\)/);
  assert.match(guidedTooltip, /document\.createElement\('audio'\)/);
  assert.match(guidedTooltip, /track\.kind = 'captions'/);
  assert.match(guidedTooltip, /video\.playsInline = true/);
  assert.match(guidedTooltip, /prefers-reduced-motion: reduce/);
  assert.match(guidedTooltip, /Video \+ voiceover script ready/);
  assert.match(guidedTooltipStyles, /\.guided-tooltip-guide__video/);
  assert.match(application, /MXOnboarding\.checkFirstRun\(\)/);
  assert.match(dashboard, /id="guidedTourButton"/);
  assert.match(dashboard, /onclick="MXOnboarding\.restart\(\)"/);
  assert.match(guidedTooltipStyles, /\.guided-tour-launch/);
  assert.match(guidedTooltipStyles, /\.guided-help-trigger--labeled::after/);
});

test('context help binds accessible anchored popovers across product surfaces', () => {
  assert.match(guidedTooltip, /function open\(anchor, id/);
  assert.match(guidedTooltip, /function close\(options/);
  assert.match(guidedTooltip, /function bind\(root = document\)/);
  assert.match(guidedTooltip, /\[data-guide-id\]/);
  assert.match(guidedTooltip, /setAttribute\('role', 'dialog'\)/);
  assert.match(guidedTooltip, /event\.key === 'Escape'/);
  assert.match(guidedTooltip, /document\.addEventListener\('pointerdown'/);
  assert.match(guidedTooltipStyles, /\.guided-help-trigger/);
  assert.match(guidedTooltipStyles, /\.guided-tooltip-popover/);
  assert.match(guidedTooltipStyles, /max-width: 640px/);

  const surfaceMarkup = [dashboard, globeVr, viewer, partsWorkspace].join('\n');
  const declaredIds = matches(/data-guide-id="([a-z0-9-]+)"/g, surfaceMarkup);
  const manifestIds = new Set(tooltipManifest.tooltips.map((item) => item.id));
  assert.ok(declaredIds.length >= 7, 'expected contextual help on browser, parts, globe/sensor, and viewer surfaces');
  declaredIds.forEach((id) => assert.ok(manifestIds.has(id), `${id} needs a tooltip manifest entry`));
  assert.match(globeVr, /sensorOnlyScene \? 'sensor-bridge-flow' : 'fleet-globe-controls'/);
  assert.match(application, /guide\.hidden = false/);
});

test('guided tooltip manifest keeps every onboarding guide scripted or media-complete', async () => {
  assert.equal(tooltipManifest.version, 1);
  assert.ok(Array.isArray(tooltipManifest.tooltips));
  assert.ok(tooltipManifest.tooltips.length >= 19);
  const ids = tooltipManifest.tooltips.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, 'tooltip IDs must be unique');

  for (const item of tooltipManifest.tooltips) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(item.title && item.script, `${item.id} needs a title and narration script`);
    assert.ok(['scripted', 'recording', 'ready', 'retired'].includes(item.status), `${item.id} has an unsupported status`);
    if (item.status !== 'ready') continue;
    await Promise.all([
      access(new URL(`../assets/xr-ui-fx/audio/tooltips/scripts/${item.video}`, import.meta.url)),
      access(new URL(`../assets/xr-ui-fx/audio/tooltips/scripts/${item.voiceover}`, import.meta.url)),
      access(new URL(`../assets/xr-ui-fx/audio/tooltips/scripts/${item.captions}`, import.meta.url))
    ]);
  }

  const productionGuides = tooltipManifest.tooltips.filter((item) => item.beats);
  assert.ok(productionGuides.length >= 10);
  productionGuides.forEach((item) => {
    assert.ok(item.surface, `${item.id} needs a surface`);
    assert.ok(Array.isArray(item.touchpoints) && item.touchpoints.length >= 3, `${item.id} needs mapped touchpoints`);
    assert.ok(Array.isArray(item.beats) && item.beats.length === 4, `${item.id} needs a four-beat recording outline`);
  });
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
  assert.match(application, /\.htmlElementsData\(initialDisplayClusters\)/);
  assert.match(application, /\.htmlElement\(createGlobeClusterMarker\)/);
  assert.match(application, /anchor\.className = 'fleet-map-anchor'/);
  assert.match(application, /\.htmlAltitude\(0\.0015\)/);
  assert.match(application, /\.onZoom\(handleGlobeZoom\)/);
  assert.match(application, /\.pointsData\(displayClusters\)/);
  assert.match(application, /\.pointsTransitionDuration\(0\)/);
  assert.match(application, /\.htmlTransitionDuration\(0\)/);
  assert.match(application, /\.globeCurvatureResolution\(1\)/);
  assert.match(application, /texture\.anisotropy = Math\.min\(16, maximum\)/);
  assert.match(dashboard, /data-texture="earth-dark-hd\.png"/);
  assert.match(dashboard, /data-texture="earth-water-hd\.png"/);
  assert.match(application, /cluster\.airportCount > 1/);
  assert.match(applicationStyles, /\.fleet-map-marker__beacon/);
  assert.match(applicationStyles, /\.fleet-map-anchor/);
  assert.match(applicationStyles, /\.fleet-map-marker__count/);
  assert.match(applicationStyles, /\.fleet-map-marker--stacked/);
  assert.match(applicationStyles, /#globeViz\s*\{[\s\S]*isolation: isolate/);
  assert.match(applicationStyles, /\.globe-sheet\s*\{[\s\S]*z-index: 30/);
});

test('public runtime configuration mounts the live core without embedding credentials', () => {
  assert.match(dashboard, /src="runtime-config\.js\?v=4"/);
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
