import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const presence = await readFile(new URL('../xr-realtime-presence.js', import.meta.url), 'utf8');
const globe = await readFile(new URL('../globe-vr.html', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../3d-viewer/index.html', import.meta.url), 'utf8');
const sensors = await readFile(new URL('../xr-sensor-orb.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');

test('XR voice presence is a dense point cloud with a dedicated mic and pin controls', () => {
  assert.match(presence, /new THREE\.Points\(/);
  assert.match(presence, /new THREE\.CanvasTexture\(/);
  assert.match(presence, /toggle-pin/);
  assert.match(presence, /FLOATING/);
  assert.match(globe, /pointCount: sensorOnlyScene \? 1800 : 720/);
  assert.match(globe, /pointSize: sensorOnlyScene \? 0\.0007 : 0\.0012/);
  assert.match(presence, /MXGeniusRealtimeMic/);
  assert.match(presence, /Tap mic: voice/);
  assert.match(presence, /setDockTarget/);
  assert.match(presence, /this\.connectPromise/);
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

test('sensor scene uses a head-locked thermal screen while fleet retains its wrist presentation', () => {
  assert.match(globe, /XRSensorOrb/);
  assert.match(globe, /presentation: sensorOnlyScene \? 'head-screen' : 'wrist-orb'/);
  assert.match(globe, /xrVoice\.setDockTarget\(xrSensors\.voiceDock\)/);
  assert.match(globe, /sensorPreviewMode/);
  assert.match(globe, /if \(!sensorOnlyScene\) xrSensors\.setAnchors\(\{ rightHand \}\)/);
  assert.match(globe, /xrSensors\.handleObject/);
  assert.match(globe, /xrSensors\.setPresenting\(true\)/);
  assert.match(globe, /xrSensors\.startPreflight\(\)/);
  assert.match(globe, /mxgenius:\/\/sensor-bridge/);
  assert.match(globe, /FLIR THERMAL · QUEST LOCAL/);
  assert.match(sensors, /MXGeniusSensorOrb/);
  assert.match(sensors, /MXGeniusThermalScreenRig/);
  assert.match(sensors, /MXGeniusThermalPixels/);
  assert.match(sensors, /toggle-thermal-screen/);
  assert.match(sensors, /thermal-scale-down/);
  assert.match(sensors, /thermal-scale-up/);
  assert.match(sensors, /MXGeniusDiagnosticsPanel/);
  assert.match(sensors, /diagnostics\.snapshot/);
  assert.match(sensors, /scan\.observed/);
  assert.match(sensors, /mxgenius:scan-observed/);
  assert.match(sensors, /mxgenius:sensor-diagnostics/);
  assert.match(sensors, /FRAME_MAGIC = 0x4d584753/);
  assert.match(sensors, /MAX_THERMAL_PIXELS = 1920 \* 1080/);
  assert.match(sensors, /FLIR HANDSHAKE TRACE/);
  assert.match(sensors, /message\.type === 'bridge\.status'/);
  assert.match(sensors, /bridgeRuntimeStatus/);
  assert.match(sensors, /this\.handshakeTrace/);
  assert.match(sensors, /credentials redacted/);
  assert.match(sensors, /bridge\.hello/);
  assert.match(sensors, /connection error · verify bridge is installed and running/);
  assert.match(globe, /VERBOSE HANDSHAKE TRACE · ALSO RENDERED IN VR/);
  assert.match(globe, /Quest Library → Not installed/);
  assert.match(sensors, /this\.thermalTexture\.magFilter = THREE\.NearestFilter/);
  assert.match(sensors, /timestamp !== this\.latestFrameTimestamp/);
  assert.match(sensors, /dispose\(\) \{/);
  assert.match(globe, /if \(!event\.persisted\) disposeScene\(\)/);
  assert.match(sensors, /bridge\.session/);
  assert.match(sensors, /flir-one-pro-usb-c/);
});

test('dashboard opens an isolated FLIR and Pi scene without cached JetNet fleet data', () => {
  assert.match(dashboard, /id="sensorSceneTab"/);
  assert.match(dashboard, /href="globe-vr\.html\?scene=sensor&amp;v=10"/);
  assert.match(dashboard, /assets\/thermal-sensor-scene-square\.png/);
  assert.match(globe, /const sensorOnlyScene = pageQuery\.get\('scene'\) === 'sensor'/);
  assert.match(globe, /if \(sensorOnlyScene\) return emptyFleet/);
  assert.match(globe, /globeGroup\.visible = !sensorOnlyScene/);
  assert.match(globe, /surface: sceneSurface/);
  assert.match(globe, /Isolated FLIR \+ Pi workspace · no JetNet fleet data loaded/);
  assert.match(globe, /SensorDiagnosticsBackdrop/);
});
