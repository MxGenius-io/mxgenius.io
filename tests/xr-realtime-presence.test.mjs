import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const presence = await readFile(new URL('../xr-realtime-presence.js', import.meta.url), 'utf8');
const globe = await readFile(new URL('../globe-vr.html', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../3d-viewer/index.html', import.meta.url), 'utf8');
const sensors = await readFile(new URL('../xr-sensor-orb.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');

test('XR voice presence is a shared point cloud with transcript and pin controls', () => {
  assert.match(presence, /new THREE\.Points\(/);
  assert.match(presence, /new THREE\.CanvasTexture\(/);
  assert.match(presence, /toggle-pin/);
  assert.match(presence, /FLOATING/);
  assert.match(presence, /size: 0\.0012/);
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

test('fleet globe mounts a hand-adjacent thermal and diagnostics sensor orb', () => {
  assert.match(globe, /XRSensorOrb/);
  assert.match(globe, /xrSensors\.setAnchors\(\{ rightHand \}\)/);
  assert.match(globe, /xrSensors\.handleObject/);
  assert.match(globe, /xrSensors\.setPresenting\(true\)/);
  assert.match(globe, /xrSensors\.startPreflight\(\)/);
  assert.match(globe, /mxgenius:\/\/sensor-bridge/);
  assert.match(globe, /REMOTE WITNESS/);
  assert.match(sensors, /MXGeniusSensorOrb/);
  assert.match(sensors, /MXGeniusDiagnosticsPanel/);
  assert.match(sensors, /diagnostics\.snapshot/);
  assert.match(sensors, /scan\.observed/);
  assert.match(sensors, /mxgenius:scan-observed/);
  assert.match(sensors, /mxgenius:sensor-diagnostics/);
  assert.match(sensors, /FRAME_MAGIC = 0x4d584753/);
  assert.match(sensors, /bridge\.session/);
  assert.match(sensors, /flir-one-pro-usb-c/);
});

test('dashboard opens an isolated FLIR and Pi scene without cached JetNet fleet data', () => {
  assert.match(dashboard, /id="sensorSceneTab"/);
  assert.match(dashboard, /href="globe-vr\.html\?scene=sensor&amp;v=7"/);
  assert.match(dashboard, /assets\/thermal-sensor-scene-square\.png/);
  assert.match(globe, /const sensorOnlyScene = pageQuery\.get\('scene'\) === 'sensor'/);
  assert.match(globe, /if \(sensorOnlyScene\) return emptyFleet/);
  assert.match(globe, /globeGroup\.visible = !sensorOnlyScene/);
  assert.match(globe, /surface: sceneSurface/);
  assert.match(globe, /Isolated FLIR \+ Pi workspace · no JetNet fleet data loaded/);
  assert.match(globe, /SensorDiagnosticsBackdrop/);
});
