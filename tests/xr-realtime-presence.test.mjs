import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const presence = await readFile(new URL('../xr-realtime-presence.js', import.meta.url), 'utf8');
const globe = await readFile(new URL('../globe-vr.html', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../3d-viewer/index.html', import.meta.url), 'utf8');
const sensors = await readFile(new URL('../xr-sensor-orb.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const xrAudio = await readFile(new URL('../xr-ui-audio.js', import.meta.url), 'utf8');

const traceHelpers = sensors.slice(
  sensors.indexOf('function clean'),
  sensors.indexOf('function bridgeLabel')
);
const traceSafe = Function(`${traceHelpers}; return traceSafe;`)();

test('XR voice presence is a dense point cloud with dedicated mic, snapshot, and pin controls', () => {
  assert.match(presence, /new THREE\.Points\(/);
  assert.match(presence, /new THREE\.CanvasTexture\(/);
  assert.match(presence, /toggle-pin/);
  assert.match(presence, /FLOATING/);
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
  assert.match(sensors, /headset\.snapshot\.request/);
  assert.match(sensors, /headset\.snapshot\.result/);
  assert.match(sensors, /this\.pendingSnapshots/);
  assert.match(globe, /onSnapshotRequest: sensorOnlyScene \? \(\) => xrSensors\.requestHeadsetSnapshot\(\) : null/);
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

test('dashboard opens an isolated FLIR and Pi scene without cached JetNet fleet data', () => {
  assert.match(dashboard, /id="sensorSceneTab"/);
  assert.match(dashboard, /href="globe-vr\.html\?scene=sensor&amp;v=15"/);
  assert.match(dashboard, /assets\/thermal-sensor-scene-square\.png/);
  assert.match(globe, /const sensorOnlyScene = pageQuery\.get\('scene'\) === 'sensor'/);
  assert.match(globe, /if \(sensorOnlyScene\) return emptyFleet/);
  assert.match(globe, /globeGroup\.visible = !sensorOnlyScene/);
  assert.match(globe, /surface: sceneSurface/);
  assert.match(globe, /Isolated FLIR \+ Pi workspace · no JetNet fleet data loaded/);
  assert.match(globe, /SensorDiagnosticsBackdrop/);
});

test('sensor scene cache-busts the commissioning browser client', () => {
  assert.match(globe, /xr-sensor-orb\.js\?v=9/);
  assert.match(sensors, /commissioning\.browser_ack/);
  assert.match(sensors, /W14 PASS/);
});
