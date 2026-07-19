import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const presence = await readFile(new URL('../xr-realtime-presence.js', import.meta.url), 'utf8');
const globe = await readFile(new URL('../globe-vr.html', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../3d-viewer/index.html', import.meta.url), 'utf8');

test('XR voice presence is a shared point cloud with transcript and pin controls', () => {
  assert.match(presence, /new THREE\.Points\(/);
  assert.match(presence, /new THREE\.CanvasTexture\(/);
  assert.match(presence, /toggle-pin/);
  assert.match(presence, /RIGHT WRIST/);
  assert.match(presence, /requires_human_approval/);
});

test('fleet globe mounts the shared voice presence on the right XR input', () => {
  assert.match(globe, /XRRealtimePresence/);
  assert.match(globe, /rightHand\?\.joints\?\.wrist/);
  assert.match(globe, /xrVoice\.handleObject/);
  assert.match(globe, /xrVoice\.setPresenting\(true\)/);
});

test('3D viewer mounts the same voice presence and forwards active case context', () => {
  assert.match(viewer, /XRRealtimePresence/);
  assert.match(viewer, /viewerContext\?\.caseId/);
  assert.match(viewer, /hand\.userData\.handedness === 'right'/);
  assert.match(viewer, /xrVoice\?\.setPresenting\(true\)/);
});
