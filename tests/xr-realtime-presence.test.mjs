import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const presence = await readFile(new URL('../xr-realtime-presence.js', import.meta.url), 'utf8');
const globe = await readFile(new URL('../globe-vr.html', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../3d-viewer/index.html', import.meta.url), 'utf8');
const sensors = await readFile(new URL('../xr-sensor-orb.js', import.meta.url), 'utf8');
const headsetFrame = await readFile(new URL('../xr-headset-frame.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const xrAudio = await readFile(new URL('../xr-ui-audio.js', import.meta.url), 'utf8');
const xrBrowser = await readFile(new URL('../xr-browser-panel.js', import.meta.url), 'utf8');
const spatialShell = await readFile(new URL('../xr-spatial-shell.js', import.meta.url), 'utf8');
const maintenanceRuntime = await readFile(new URL('../xr-maintenance-runtime.js', import.meta.url), 'utf8');
const spatialHud = await readFile(new URL('../xr-spatial-target-hud.js', import.meta.url), 'utf8');
const spatialAnalyzer = await readFile(new URL('../spatial-scan-analyzer.js', import.meta.url), 'utf8');
const spatialCommands = await readFile(new URL('../spatial-commands.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

const traceHelpers = sensors.slice(
  sensors.indexOf('function clean'),
  sensors.indexOf('function bridgeLabel')
);
const traceSafe = Function(`${traceHelpers}; return traceSafe;`)();

test('XR voice presence is a dense point cloud with dedicated mic, snapshot, and world placement controls', () => {
  assert.match(presence, /new THREE\.Points\(/);
  assert.match(presence, /new THREE\.CanvasTexture\(/);
  assert.match(presence, /xrVoiceAction = 'recenter'/);
  assert.match(presence, /WORLD ANCHORED/);
  assert.match(globe, /pointCount: sensorOnlyScene \? 1800 : 720/);
  assert.match(globe, /pointSize: sensorOnlyScene \? 0\.0007 : 0\.0012/);
  assert.match(presence, /MXGeniusRealtimeMic/);
  assert.match(presence, /MXGeniusRealtimeSnapshot/);
  assert.match(presence, /capture-snapshot/);
  assert.match(presence, /sendUserMessage\(\{/);
  assert.match(presence, /images: \[\{ dataUrl: snapshot\.dataUrl \}\]/);
  assert.match(presence, /Saved to the active maintenance case/);
  assert.match(presence, /MXGeniusCaseEvidenceTray/);
  assert.match(presence, /animateSnapshotToEvidence/);
  assert.match(presence, /Tap mic: voice/);
  assert.match(presence, /setDockTarget/);
  assert.match(presence, /this\.connectPromise/);
  assert.match(presence, /The selected JetNet fleet location is/);
  assert.match(presence, /async refreshContext\(\)/);
  assert.match(presence, /realtimeSession\?\.disconnect\(\)/);
  assert.match(presence, /dispose\(\) \{/);
  assert.match(presence, /requires_human_approval/);
});

test('fleet globe mounts the shared voice presence as an accessible floating control', () => {
  assert.match(globe, /XRRealtimePresence/);
  assert.doesNotMatch(globe, /anchor: rightWrist/);
  assert.match(globe, /xrVoice\.handleObject/);
  assert.match(globe, /xrVoice\.setPresenting\(true\)/);
});

test('legacy floating browser implementation remains unmounted from primary VR scenes', () => {
  assert.doesNotMatch(globe, /XRBrowserPanel/);
  assert.doesNotMatch(globe, /xrBrowser/);
  assert.doesNotMatch(viewer, /XRBrowserPanel/);
  assert.match(xrBrowser, /MXGeniusXRBrowserButton/);
  assert.match(xrBrowser, /MXGeniusXRBrowserPanel/);
  assert.match(xrBrowser, /PARTS & SOURCING/);
  assert.match(xrBrowser, /AIRCRAFT RECORDS/);
  assert.match(xrBrowser, /TECHNICAL REFERENCES/);
  assert.match(xrBrowser, /URL PENDING/);
  assert.match(xrBrowser, /Math\.exp\(-Math\.max\(0, delta\) \* 12\)/);
  assert.match(xrBrowser, /placeForView\(camera = null\)/);
  assert.doesNotMatch(xrBrowser, /this\.group\.position\.lerp/);
  assert.match(xrAudio, /case 'browser-panel-toggle'/);
});

test('globe and viewer share one world-anchored two-mode spatial tray', () => {
  assert.match(globe, /import \{ XRSpatialShell \}/);
  assert.match(viewer, /import \{ XRSpatialShell \}/);
  assert.match(globe, /new XRSpatialShell\(/);
  assert.match(viewer, /new XRSpatialShell\(/);
  assert.match(spatialShell, /operations: \{ label: 'OPERATIONS'/);
  assert.match(spatialShell, /maintenance: \{ label: 'MAINTENANCE'/);
  assert.match(spatialShell, /ACTIVE · TAP TO RECENTER/);
  assert.match(spatialShell, /this\.placementPending = true/);
  assert.match(spatialShell, /placeForView\(camera = null\)/);
  assert.match(spatialShell, /if \(!this\.placementPending \|\| !camera\) return/);
  assert.doesNotMatch(spatialShell, /position\.lerp|quaternion\.slerp/);
  assert.match(globe, /sessionStorage\.setItem\('mxg_spatial_context_v1'/);
  assert.match(viewer, /sessionStorage\.getItem\('mxg_spatial_context_v1'/);
});

test('3D viewer mounts the same voice presence and forwards active case context', () => {
  assert.match(viewer, /XRRealtimePresence/);
  assert.match(viewer, /viewerContext\?\.caseId/);
  assert.doesNotMatch(viewer, /anchor: rightWrist/);
  assert.match(viewer, /xrVoice\?\.setPresenting\(true\)/);
});

test('sensor scene owns the head-following thermal bridge while the fleet globe omits that runtime', () => {
  assert.match(globe, /if \(sensorOnlyScene\) \(\{ XRSensorOrb: SensorOrbClass \} = await import/);
  assert.match(globe, /if \(sensorOnlyScene\) xrSensors = new SensorOrbClass/);
  assert.match(globe, /presentation: 'head-screen'/);
  assert.match(globe, /xrVoice\.setDockTarget\(xrSensors\.voiceDock\)/);
  assert.match(globe, /sensorPreviewMode/);
  assert.match(globe, /xrSensors\?\.setAnchors\(\{ rightHand \}\)/);
  assert.match(globe, /xrSensors\?\.handleObject/);
  assert.match(globe, /xrSensors\?\.setPresenting\(true\)/);
  assert.match(globe, /xrSensors\?\.startPreflight\(\)/);
  assert.match(globe, /mxgenius:\/\/sensor-bridge/);
  assert.match(globe, /FLIR THERMAL · NATIVE QUEST/);
  assert.match(sensors, /MXGeniusSensorOrb/);
  assert.match(sensors, /MXGeniusThermalScreenRig/);
  assert.match(sensors, /MXGeniusThermalPixels/);
  assert.match(sensors, /toggle-thermal-screen/);
  assert.match(sensors, /pin-thermal-screen/);
  assert.match(sensors, /FOLLOW HEAD/);
  assert.doesNotMatch(globe, /FOLLOW HEAD/);
  assert.doesNotMatch(viewer, /FOLLOW HEAD/);
  assert.match(sensors, /thermal screen pinned in world space/);
  assert.match(sensors, /camera && !this\.screenPinned/);
  assert.match(sensors, /thermal-scale-down/);
  assert.match(sensors, /thermal-scale-up/);
  assert.match(sensors, /MXGeniusDiagnosticsPanel/);
  assert.match(sensors, /diagnostics\.snapshot/);
  assert.match(sensors, /scan\.observed/);
  assert.match(sensors, /mxgenius:scan-observed/);
  assert.match(sensors, /mxgenius:sensor-diagnostics/);
  assert.match(sensors, /FRAME_MAGIC = 0x4d584753/);
  assert.match(sensors, /MAX_THERMAL_PIXELS = 1920 \* 1080/);
  assert.match(sensors, /MXGENIUS SENSOR BRIDGE/);
  assert.match(sensors, /message\.type === 'bridge\.status'/);
  assert.match(sensors, /message\.type === 'bridge\.trace'/);
  assert.match(sensors, /W01 PAIR/);
  assert.match(sensors, /W10 RENDER/);
  assert.match(sensors, /bridgeRuntimeStatus/);
  assert.match(sensors, /this\.handshakeTrace/);
  assert.match(sensors, /LIVE SENSOR WORKSPACE/);
  assert.match(sensors, /bridge\.hello/);
  assert.match(sensors, /connection error · verify bridge is installed and running/);
  assert.match(globe, /BROWSER COMPATIBILITY TRACE · NATIVE TRACE IS RENDERED IN VR/);
  assert.match(globe, /Open native thermal workspace/);
  assert.match(globe, /Quest Library → Not installed/);
  assert.match(sensors, /this\.thermalTexture\.magFilter = THREE\.NearestFilter/);
  assert.match(sensors, /timestamp !== this\.latestFrameTimestamp/);
  assert.match(sensors, /dispose\(\) \{/);
  assert.match(globe, /if \(!event\.persisted\) disposeScene\(\)/);
  assert.match(sensors, /bridge\.session/);
  assert.match(sensors, /flir-one-pro-usb-c/);
  assert.match(sensors, /new HeadsetFrameAcquirer/);
  assert.match(sensors, /acquireHeadsetFrame\(\{ purpose = 'evidence', timeoutMs \} = \{\}\)/);
  assert.match(headsetFrame, /headset\.snapshot\.request/);
  assert.match(headsetFrame, /headset\.snapshot\.result/);
  assert.match(headsetFrame, /frame-busy/);
  assert.match(globe, /onSnapshotRequest: sensorOnlyScene \? requestHeadsetFrame : null/);
  assert.match(globe, /onSnapshotCaptured: sensorOnlyScene \? saveSnapshotToActiveCase : null/);
  assert.match(globe, /mxg_active_case_id/);
  assert.match(globe, /MXApplicationClient\.cases\.attachMedia/);
  assert.match(globe, /emitSceneAction\('sensor-status'/);
  assert.match(globe, /emitSceneAction\(action, input, target, xrSensors\.group\)/);
  assert.match(xrAudio, /case 'toggle-thermal-screen'/);
  assert.match(xrAudio, /case 'thermal-screen-anchor'/);
  assert.match(xrAudio, /case 'sensor-status'/);
});

test('XR trace keeps native failure reasons while redacting actual credential shapes', () => {
  const reason = 'offline · camera-disconnected-error-code-connection-lost-during-stream';
  assert.equal(traceSafe(reason), reason);
  assert.equal(
    traceSafe('ws://127.0.0.1/thermal?sessionId=case-42&token=abcdefghijklmnopqrstuvwxyz0123456789'),
    'ws://127.0.0.1/thermal?sessionId=case-42&token=[redacted]'
  );
  assert.equal(traceSafe('Authorization: Bearer secret-value-123456789'), 'Authorization: Bearer [redacted]');
  assert.equal(traceSafe(`digest ${'a'.repeat(64)}`), 'digest [redacted]');
});

test('legacy isolated sensor route remains available without a separate dashboard launcher', () => {
  assert.doesNotMatch(dashboard, /id="sensorSceneTab"/);
  assert.doesNotMatch(dashboard, /assets\/thermal-sensor-scene-square\.png/);
  assert.match(globe, /const sensorOnlyScene = pageQuery\.get\('scene'\) === 'sensor'/);
  assert.match(globe, /if \(sensorOnlyScene\) return emptyFleet/);
  assert.match(globe, /globeGroup\.visible = !sensorOnlyScene/);
  assert.match(globe, /surface: sceneSurface/);
  assert.match(globe, /Isolated FLIR \+ Pi workspace · no JetNet fleet data loaded/);
  assert.match(globe, /SensorDiagnosticsBackdrop/);
});

test('sensor scene cache-busts the commissioning browser client', () => {
  assert.match(globe, /xr-sensor-orb\.js\?v=13/);
  assert.match(sensors, /commissioning\.browser_ack/);
  assert.match(sensors, /W14 PASS/);
});

test('maintenance viewer reuses the sensor, witness, voice, and evidence cores behind one familiar tray', () => {
  assert.match(viewer, /new XRSensorOrb\(/);
  assert.match(viewer, /new XRRemoteWitnessPanel\(/);
  assert.match(viewer, /tools: \[[\s\S]*id: 'thermal'[\s\S]*id: 'witness'[\s\S]*id: 'voice'[\s\S]*id: 'capture'/);
  assert.match(viewer, /launcherVisible: false/);
  assert.match(viewer, /onSnapshotCaptured: saveViewerSnapshot/);
  assert.match(viewer, /nativeBootstrapProvider: \(invitation, projection\) => xrSensors\.sendWitnessBootstrap/);
  assert.match(spatialShell, /TOOL_DEFAULTS/);
  assert.match(spatialShell, /spatial-tool-/);
  assert.match(maintenanceRuntime, /resolveXRSensorRuntime/);
  assert.match(globe, /const sensorRuntime = resolveXRSensorRuntime\(\)/);
});

test('FLIR is the only runtime with continuous headset-follow placement', () => {
  assert.match(sensors, /camera && !this\.screenPinned/);
  assert.match(sensors, /this\.group\.position\.lerp\(this\.headTargetPosition/);
  assert.match(presence, /this\.placementPending = true/);
  assert.match(presence, /placeForView\(camera = null\)/);
  assert.doesNotMatch(presence, /this\.group\.position\.lerp/);
  assert.match(spatialHud, /World-anchored/);
  assert.match(spatialHud, /placeForView\(camera = null\)/);
  assert.doesNotMatch(spatialHud, /this\.group\.position\.lerp/);
  assert.match(globe, /xrWitness\?\.requestPlacement\(\)/);
});

test('sensor scene mounts simulated and authenticated bounded target analyzers', () => {
  assert.match(globe, /SimulatedSpatialScanAnalyzer/);
  assert.match(globe, /ConnectedSpatialScanAnalyzer/);
  assert.match(globe, /MXApplicationClient\.spatial\.scan/);
  assert.match(globe, /applySpatialScanResult/);
  assert.match(globe, /new XRSpatialTargetHUD/);
  assert.match(globe, /spatialSimulationEnabled = sensorOnlyScene && localPreviewHost/);
  assert.match(globe, /spatialHud\?\.update\(delta, time, \{ camera \}\)/);
  assert.match(globe, /spatialHud\?\.setPresenting\(true\)/);
  assert.match(globe, /detail\.reason === 'spatial-targets-expired'/);
  assert.match(globe, /xrVoice\?\.setScanState\('idle'/);
  assert.match(presence, /setScanState\(state = 'idle', message = ''\)/);
  assert.match(spatialAnalyzer, /providerMaximum: 5/);
  assert.match(spatialAnalyzer, /displayMaximum: 3/);
  assert.match(spatialAnalyzer, /confidenceThreshold: 0\.85/);
  assert.match(spatialAnalyzer, /candidateLifetimeMs: 15_000/);
  assert.match(spatialHud, /MXGeniusSpatialTargetHUD/);
  assert.match(spatialHud, /Location only · verify before action/);
});

test('dashboard and WebXR share bounded revision-guarded spatial commands', () => {
  assert.match(dashboard, /spatial-commands\.js\?v=1/);
  assert.match(globe, /spatial-commands\.js\?v=1/);
  assert.match(globe, /createWebXRAdapter/);
  assert.match(globe, /xrVoice\.setSpatialCommands\(spatialCommands\)/);
  assert.match(globe, /spatialTargets: spatialRegistry\?\.modelProjection/);
  assert.match(app, /createEmbeddedViewerAdapter/);
  assert.match(app, /spatial_targets: globalThis\.MXTargetContext\?\.registry\?\.modelProjection/);
  assert.match(app, /client_handler === 'spatial_command'/);
  assert.match(presence, /clientTools: this\.spatialCommands\?\.clientTools/);
  assert.match(presence, /caseContext\?\.spatialTargets/);
  assert.match(presence, /this\.spatialCommands\.dispatchTool/);
  assert.match(spatialCommands, /expectedRegistryRevision/);
  assert.match(spatialCommands, /expectedTargetRevision/);
  assert.match(spatialCommands, /isCurrent: \(\) => this\.currentGuard/);
  assert.match(spatialHud, /async highlightTarget/);
  assert.match(spatialHud, /A newer highlight request replaced this one/);
});
