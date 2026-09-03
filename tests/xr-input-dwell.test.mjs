import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { XRInputDwellGate } from '../xr-input-dwell.js';

test('a one-sample fingertip collision cannot activate a spatial control', () => {
  const gate = new XRInputDwellGate({ dwellMs: 180 });
  const target = { name: 'lock' };
  assert.equal(gate.update('right', target, 1_000), false);
  assert.equal(gate.update('right', null, 1_100), false);
  assert.equal(gate.update('right', target, 1_200), false);
});

test('stable fingertip contact fires once and requires release or a new target', () => {
  const gate = new XRInputDwellGate({ dwellMs: 180 });
  const lock = { name: 'lock' };
  const clear = { name: 'clear' };
  assert.equal(gate.update('right', lock, 1_000), false);
  assert.equal(gate.update('right', lock, 1_100), false);
  assert.equal(gate.update('right', lock, 1_200), true);
  assert.equal(gate.update('right', lock, 1_500), false);
  assert.equal(gate.update('right', clear, 1_600), false);
  assert.equal(gate.update('right', clear, 1_800), true);
  gate.clear('right');
  assert.equal(gate.update('right', lock, 1_900), false);
});

test('WebXR routes controller and hand input through the bounded spatial controls', async () => {
  const scene = await readFile(new URL('../globe-vr.html', import.meta.url), 'utf8');
  const hud = await readFile(new URL('../xr-spatial-target-hud.js', import.meta.url), 'utf8');
  const controllerTargets = scene.slice(
    scene.indexOf('const uiTargets = ['),
    scene.indexOf('const uiHit =', scene.indexOf('const uiTargets = ['))
  );

  assert.ok(controllerTargets.indexOf('spatialHud?.interactiveObjects()') < controllerTargets.indexOf('xrBrowser.interactiveObjects()'));
  assert.match(scene, /new XRInputDwellGate\(\{ dwellMs: 180 \}\)/);
  assert.match(scene, /spatialFingerDwell\.update\(handIndex, spatialTarget, time\)/);
  assert.match(scene, /spatialFingerDwell\.clear\(\)/);
  assert.match(hud, /const x = bounds\.x \* CANVAS_WIDTH/);
  assert.match(hud, /const y = bounds\.y \* CANVAS_HEIGHT/);
  assert.match(hud, /const width = bounds\.width \* CANVAS_WIDTH/);
  assert.match(hud, /const height = bounds\.height \* CANVAS_HEIGHT/);
});
