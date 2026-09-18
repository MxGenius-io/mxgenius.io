import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { SpatialWindowManager } from '../spatial-window-manager.js';

const source = await readFile(new URL('../spatial-context.js', import.meta.url), 'utf8');
const [dashboard, application, viewer, globe, shell, witness, operations, sensors] = await Promise.all([
  readFile(new URL('../dashboard.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../3d-viewer/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../globe-vr.html', import.meta.url), 'utf8'),
  readFile(new URL('../xr-spatial-shell.js', import.meta.url), 'utf8'),
  readFile(new URL('../xr-remote-witness.js', import.meta.url), 'utf8'),
  readFile(new URL('../xr-operations-surface.js', import.meta.url), 'utf8'),
  readFile(new URL('../xr-sensor-orb.js', import.meta.url), 'utf8')
]);

function contextApi(seed = {}) {
  const values = new Map(Object.entries(seed));
  const sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  const sandbox = { globalThis: null, sessionStorage, Date, JSON, String, Number, Object, Set, Error };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return { api: sandbox.MXSpatialContext, sessionStorage, values };
}

test('spatial context v2 normalizes the shared workflow identities without secrets or blobs', () => {
  const { api } = contextApi();
  const value = api.normalize({
    mode: 'maintenance', tenantId: 'tenant-a', organizationId: 'org-a',
    aircraftId: 'aircraft-1', caseId: 'case-9', componentId: 'strobe',
    model: { id: 'cl350', name: 'Bombardier Challenger 350', provider: 'workspace', operationalStatus: 'demo_asset' },
    part: { partNumber: 'WHELEN-01', requestId: 'request-2' },
    location: { icao: 'kpbi', lat: 26.68, lng: -80.09 },
    token: 'must-not-survive', media: new Blob(['no'])
  });
  assert.equal(value.version, 2);
  assert.equal(value.aircraft.id, 'aircraft-1');
  assert.equal(value.case.id, 'case-9');
  assert.equal(value.model.id, 'cl350');
  assert.equal(value.model.name, 'Bombardier Challenger 350');
  assert.equal(value.model.provider, 'workspace');
  assert.equal(value.component.id, 'strobe');
  assert.equal(value.part.partNumber, 'WHELEN-01');
  assert.equal(value.location.icao, 'KPBI');
  assert.equal('token' in value, false);
  assert.equal('media' in value, false);
});

test('spatial context migrates v1 and rejects cross-tenant merges', () => {
  const legacy = JSON.stringify({ version: 1, source: 'fleet-globe', caseId: 'case-1', aircraftId: 'aircraft-1' });
  const { api } = contextApi({ mxg_spatial_context_v1: legacy });
  const migrated = api.read();
  assert.equal(migrated.version, 2);
  assert.equal(migrated.case.id, 'case-1');
  assert.throws(() => api.merge({ tenantId: 'tenant-a' }, { tenantId: 'tenant-b' }), /tenant boundaries/);
  const merged = api.merge({ aircraft: { id: 'aircraft-1', registration: 'N100MX' } }, { aircraft: { registration: 'N200MX' } });
  assert.equal(merged.aircraft.id, 'aircraft-1');
  assert.equal(merged.aircraft.registration, 'N200MX');
});

test('spatial window manager keeps one active window and preserves minimized lifecycle', () => {
  const calls = [];
  const manager = new SpatialWindowManager();
  manager.register('witness', {
    show: () => calls.push('witness:show'),
    hide: ({ preserve }) => calls.push(`witness:hide:${preserve}`)
  });
  manager.register('thermal', {
    show: () => calls.push('thermal:show'),
    hide: ({ preserve }) => calls.push(`thermal:hide:${preserve}`)
  });
  manager.open('witness');
  manager.open('thermal');
  assert.equal(manager.state('witness').state, 'minimized');
  assert.equal(manager.state('thermal').state, 'open');
  manager.close('thermal');
  assert.equal(manager.state('thermal').state, 'closed');
  assert.deepEqual(calls, ['witness:show', 'witness:hide:true', 'thermal:show', 'thermal:hide:false']);
});

test('the web application exposes one launcher and one canonical VR or AR session owner', () => {
  assert.equal((dashboard.match(/id="spatialWorkspaceBtn"/g) || []).length, 1);
  assert.doesNotMatch(dashboard, /id="globeVrButton"/);
  assert.doesNotMatch(viewer, /id="enter-vr-button"|VRButton\.createButton/);
  assert.match(application, /MX3DViewer\.requestSpatialSession/);
  assert.match(viewer, /navigator\.xr\.requestSession\(requestedSessionMode/);
  assert.match(viewer, /\['immersive-vr', 'immersive-ar'\]/);
  assert.match(viewer, /sessionMode === 'immersive-ar'[\s\S]*'hit-test'/);
  assert.match(viewer, /await renderer\.xr\.setSession\(session\)/);
  assert.doesNotMatch(viewer, /mxgenius\.viewer\.sensor-scene-request/);
  assert.doesNotMatch(application, /mxgenius\.viewer\.sensor-scene-request/);
  assert.doesNotMatch(viewer, /window\.top\.location\.assign/);
  assert.match(viewer, /type: 'mxgenius\.viewer\.operations-request'/);
  assert.match(viewer, /\.\.\/globe-vr\.html\?scene=bridge&return=vr&v=20/);
});

test('VR and AR switch through a bounded user-gesture handoff while preserving workspace state', () => {
  assert.match(shell, /MXGeniusSwitchToAR/);
  assert.match(shell, /MXGeniusSwitchToVR/);
  assert.match(shell, /xrShellAction = 'switch-session-mode'/);
  assert.match(shell, /this\.onSessionModeChange\?\.\(nextSessionMode, \{ input \}\)/);
  assert.match(viewer, /onSessionModeChange: \(sessionMode, \{ input = 'xr' \} = \{\}\) =>/);
  const handoff = viewer.slice(
    viewer.indexOf('async function beginSpatialSessionModeHandoff'),
    viewer.indexOf('async function enterSpatialWorkspace')
  );
  assert.match(handoff, /pendingSpatialSessionMode = requestedMode/);
  assert.match(handoff, /spatialHandoffWindowState = xrWindowManager\?\.snapshot\?\.\(\) \|\| null/);
  assert.match(handoff, /await spatialSession\.end\(\)/);
  assert.doesNotMatch(handoff, /requestSession\(/);
  assert.match(viewer, /handoffContinue\?\.addEventListener\('click', async \(\) =>/);
  assert.match(viewer, /context: spatialContext,[\s\S]*sessionMode: requestedSessionMode/);
  assert.match(viewer, /if \(!pendingSpatialSessionMode\) \{[\s\S]*xrWindowManager\?\.minimizeAll/);
  assert.match(viewer, /xrWindowManager\?\.open\(spatialHandoffWindowState\.activeId/);
  assert.match(viewer, /if \(pendingSpatialSessionMode\) \{[\s\S]*xrVoice\.group\.visible = false/);
  assert.match(viewer, /sessionMode === 'immersive-ar'[\s\S]*scene\.background = null/);
  assert.match(viewer, /spatial-mode-handoff-message/);
  assert.match(application, /message\.sessionMode === 'immersive-ar' \? 'AR' : 'VR'/);
  assert.match(application, /message\.state === 'handoff'/);
  assert.match(application, /Continue the switch to \$\{sessionLabel\} in the 3D viewer/);
  assert.match(dashboard, /3d-viewer\/index\.html\?v=46/);
});

test('Remote Witness consent leaves WebXR deliberately and resumes through fresh gestures', () => {
  const approval = viewer.slice(
    viewer.indexOf('async function launchQuestWitnessApproval'),
    viewer.indexOf('function openExternalWitnessConsent')
  );
  const externalLaunch = viewer.slice(
    viewer.indexOf('function openExternalWitnessConsent'),
    viewer.indexOf('async function handleMaintenanceTool')
  );
  assert.match(approval, /pendingExternalSpatialHandoff = \{/);
  assert.match(approval, /spatialHandoffWindowState = xrWindowManager\?\.snapshot\?\.\(\) \|\| null/);
  assert.match(approval, /await spatialSession\.end\(\)/);
  assert.match(externalLaunch, /window\.location\.assign\(handoff\.intentUrl\)/);
  assert.match(viewer, /externalHandoff\.phase === 'launch'[\s\S]*openExternalWitnessConsent\(\)/);
  assert.match(viewer, /document\.addEventListener\('visibilitychange', updateExternalHandoffVisibility\)/);
  assert.match(viewer, /handoff\.phase = 'resume'[\s\S]*showExternalSpatialHandoff\(\{ state: 'resume' \}\)/);
  assert.match(viewer, /sessionMode: externalHandoff\.resumeMode/);
  assert.match(viewer, /externalHandoff\?\.phase === 'resume'[\s\S]*xrWitness\?\.pause\?\.\('browser'\)/);
  assert.match(viewer, /state === 'resume' \? 'Pause live view' : 'Stay in 3D viewer'/);
  assert.doesNotMatch(approval, /localStorage|sessionStorage|producerCredential/);
});

test('operations hands off to the mature JetNet globe while maintenance keeps its live tools', () => {
  assert.match(application, /if \(mode === 'operations'\) \{[\s\S]*window\.location\.assign\('globe-vr\.html\?scene=bridge&v=20'\)/);
  assert.match(viewer, /if \(mode === 'operations'\) \{[\s\S]*openMatureOperationsGlobe\(input\)/);
  assert.match(viewer, /async function openMatureOperationsGlobe\(input = 'xr', context = null\)/);
  assert.match(viewer, /await session\.end\(\)/);
  assert.match(viewer, /type: 'mxgenius\.viewer\.operations-request'/);
  assert.match(application, /message\.type === 'mxgenius\.viewer\.operations-request'/);
  assert.match(viewer, /\.\.\/globe-vr\.html\?scene=bridge&return=vr&v=20/);
  assert.match(viewer, /if \(spatialContext\.mode === 'operations'\) \{[\s\S]*source: 'viewer-maintenance-normalize',[\s\S]*mode: 'maintenance'/);
  assert.match(viewer, /if \(mode === 'operations'\) \{[\s\S]*await openMatureOperationsGlobe\('workspace-api', context\)/);
  assert.match(viewer, /message\.type === 'mxgenius\.viewer\.operations-unavailable'[\s\S]*setSpatialMode\('maintenance'/);
  assert.match(viewer, /new XRSensorOrb\(/);
  assert.doesNotMatch(viewer, /openSensorDiagnostics/);
  assert.match(viewer, /xrVoice\.group\.visible = presenting && maintenance/);
  assert.match(viewer, /xrWitness\.group\.visible = presenting && maintenance/);
  assert.match(viewer, /xrWindowManager\?\.minimizeAll/);
  assert.match(globe, /new XRGlobeHUD/);
  assert.match(globe, /earth-blue-marble\.jpg/);
  assert.match(globe, /open-fleet-location/);
  assert.match(globe, /JetNetImageGrid/);
  assert.match(globe, /MXApplicationClient\.aircraftBundle/);
  assert.match(globe, /MXApplicationClient\.aircraftImageBlobUrl/);
  assert.match(globe, /URL\.revokeObjectURL/);
  assert.match(application, /liveFlight: selectedFlight \?/);
  assert.match(globe, /"three": "\.\/3d-viewer\/lib\/three\.module\.js"/);
});

test('maintenance stays in the canonical renderer and opens tools from one world anchor', () => {
  assert.match(globe, /xr-realtime-presence\.js\?v=15/);
  assert.match(globe, /xr-spatial-shell\.js\?v=11/);
  assert.match(viewer, /xr-realtime-presence\.js\?v=15/);
  assert.match(viewer, /xr-spatial-shell\.js\?v=11/);
  assert.match(shell, /onActiveMode = \(\) => false/);
  assert.match(shell, /this\.onActiveMode\(nextMode, \{ input \}\) === true/);
  assert.match(shell, /MXGeniusSpatialContentDock/);
  assert.match(shell, /contentAnchor\(\)/);
  assert.match(shell, /this\.contentDock\.position\.set\(0\.96, 0\.02, 0\.02\)/);
  assert.match(shell, /Number\.isFinite\(placement\?\.y\) \? placement\.y : -0\.30/);
  assert.match(shell, /button\.visible = this\.toolModes\.has\(this\.mode\)/);
  assert.match(shell, /return this\.toolModes\.has\(this\.mode\)/);
  assert.match(sensors, /this\.panel\.position\.set\(0, -0\.5 \* this\.screenScale - 0\.26, -0\.03\)/);
  assert.match(sensors, /const diagnosticsTarget = this\.active \? 0\.78 : 0\.001/);
  assert.match(viewer, /dockProvider: \(\) => xrSpatialShell\?\.contentAnchor\?\.\(\) \|\| null/);
  assert.match(viewer, /xrVoice\.setDockTarget\(xrSpatialShell\.contentAnchor\(\)\)/);
  assert.match(viewer, /xrWindowManager\.register\('thermal'/);
  assert.match(viewer, /xrWindowManager\.register\('voice'/);
  assert.match(viewer, /new XRRealtimePresence\(\{[\s\S]*pointCount: 1800,[\s\S]*pointSize: 0\.0007,[\s\S]*launcherVisible: false,[\s\S]*presenceVisible: true/);
  assert.match(viewer, /\{ id: 'voice', label: 'AI' \}/);
  assert.match(viewer, /syncMaintenanceSurfaces\(snapshot\)/);
  assert.match(viewer, /xrMaintenanceHUD\?\.setPresenting\(showContext && Boolean\(selectedMesh\), camera\)/);
  assert.match(viewer, /openMatureOperationsGlobe/);
  assert.match(viewer, /\.\.\/globe-vr\.html\?scene=bridge&return=vr&v=20/);
  assert.match(globe, /const sensorOnlyScene = pageQuery\.get\('scene'\) === 'sensor'/);
});

test('the spatial tray communicates minimized windows without ending Remote Witness', () => {
  assert.match(shell, /tool\.windowState === 'minimized'/);
  assert.match(shell, /context\.arc\(128, 174, 7/);
  assert.match(witness, /MXGeniusWitnessMinimize/);
  assert.match(witness, /MXGeniusWitnessMaximize/);
  assert.match(witness, /witness-window-close/);
  assert.match(viewer, /xrWindowManager\?\.close\('witness'/);
  const setOpen = witness.slice(witness.indexOf('setOpen(open'), witness.indexOf('async createInvitation'));
  assert.doesNotMatch(setOpen, /closeMedia|socket\.close|this\.revoke/);
});

test('the shared spatial tray always exposes a session exit control', () => {
  assert.match(shell, /MXGeniusExitVR/);
  assert.match(shell, /MXGeniusExitAR/);
  assert.match(shell, /xrShellAction = 'exit-vr'/);
  assert.match(shell, /this\.onExit\(\{ input \}\)/);
  assert.match(viewer, /onExit: \(\) => spatialSession\?\.end\?\.\(\)/);
  assert.match(globe, /onExit: \(\{ input = 'xr' \} = \{\}\) => void returnToScene\(input\)/);
});

test('Remote Witness docks to the spatial tray and unfolds from its tool pivot', () => {
  assert.match(witness, /dockProvider = \(\) => null/);
  assert.match(witness, /this\.panelContent\.position\.set\(0\.47, -0\.14, -0\.038\)/);
  assert.match(witness, /const dock = this\.dockProvider\?\.\(\)/);
  assert.match(witness, /dock\.getWorldPosition\(this\.cameraPosition\)/);
  assert.match(viewer, /dockProvider: \(\) => xrSpatialShell\?\.contentAnchor\?\.\(\) \|\| null/);
  assert.ok(viewer.indexOf('xrSpatialShell?.update(delta, { camera });') < viewer.indexOf('xrWitness?.update(delta, { camera });'));
});

test('mesh raycast selection is the authoritative identify and model-context event', () => {
  assert.match(viewer, /raycaster\.intersectObjects\(xrInteractionTargets\(\), true\)/);
  assert.match(viewer, /activateXRPart\(hit\.object, input\)/);
  assert.match(viewer, /source: '3d-mesh-raycast'[\s\S]*model: modelContext[\s\S]*component: componentContext/);
  assert.match(viewer, /MXTargetContext\.set\(localTarget, \{ reason: 'viewer-mesh-raycast' \}\)/);
  assert.match(viewer, /xrMaintenanceHUD\?\.setTarget\(mesh/);
  assert.match(viewer, /if \(action === 'verify'\) void xrVoice\?\.verifyCurrentContext\(input\)/);
  assert.match(viewer, /entry\.provider === 'uploaded' && \/\^\[0-9a-f\]/);
  assert.match(viewer, /if \(persistedModel\)[\s\S]*digitalTwin\.saveHighlight/);
  assert.match(application, /current_model: MX3DViewer\.currentModel \|\| null/);
});
