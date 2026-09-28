import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const [checklist, metadataSource, viewerSource, controllerSource, witnessSource, mediaHealthSource, sensorSource] = await Promise.all([
  readFile(new URL('docs/acceptance/xr-unified-workspace-quest-checklist.md', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/meta/meta-release.json', root), 'utf8'),
  readFile(new URL('3d-viewer/index.html', root), 'utf8'),
  readFile(new URL('spatial-workspace-controller.js', root), 'utf8'),
  readFile(new URL('xr-remote-witness.js', root), 'utf8'),
  readFile(new URL('witness-media-health.js', root), 'utf8'),
  readFile(new URL('xr-sensor-orb.js', root), 'utf8')
]);

test('Quest acceptance record is bound to the exact alpha.25 candidate', () => {
  const metadata = JSON.parse(metadataSource);
  assert.equal(metadata.build.versionCode, 25);
  assert.equal(metadata.build.versionName, '0.1.0-alpha.25');
  assert.equal(metadata.build.artifact.sha256, '970df1c93741579005c3095649bf3f4fbbf8ce326e1517d08400fc5d3a88977a');
  assert.match(checklist, /0\.1\.0-alpha\.25/);
  assert.match(checklist, /970df1c93741579005c3095649bf3f4fbbf8ce326e1517d08400fc5d3a88977a/);
  assert.match(checklist, /Overall physical verdict: \*\*PENDING PHYSICAL RUN\*\*/);
  assert.match(checklist, /Still publishes alpha\.23/);
});

test('physical matrix has 22 explicit pending observations and cannot imply a pass', () => {
  const rows = checklist.match(/^\| XRQ-\d{3} \|.*$/gm) || [];
  assert.equal(rows.length, 22);
  assert.deepEqual(
    rows.map((row) => row.match(/^\| (XRQ-\d{3}) /)?.[1]),
    Array.from({ length: 22 }, (_, index) => `XRQ-${String(index + 1).padStart(3, '0')}`)
  );
  assert.ok(rows.every((row) => /\| PENDING \|/.test(row)));
  for (const required of [
    'World → Focus → World',
    'JetNet imagery',
    'Controller interaction',
    'Hand interaction',
    'Ask AI',
    'Thermal',
    'Remote Witness',
    'VR → AR → VR',
    'Network and stale-data faults',
    'Exit and soak'
  ]) assert.ok(checklist.includes(required), `missing physical coverage: ${required}`);
});

test('canonical workspace enforces one owner and one managed window lifecycle', () => {
  assert.match(controllerSource, /Spatial session is already owned by/);
  assert.match(controllerSource, /session:\s*\{\s*active: false,\s*ownerId: null\s*\}/);
  assert.match(viewerSource, /const xrWorkspaceController = new SpatialWorkspaceController/);
  assert.match(viewerSource, /xrWorkspaceController\.activateSession\(SPATIAL_SESSION_OWNER/);
  assert.match(viewerSource, /xrWorkspaceController\.releaseSession\(SPATIAL_SESSION_OWNER/);
  assert.match(viewerSource, /xrWindowManager = new SpatialWindowManager/);
  assert.match(viewerSource, /launcherVisible: false/g);
  assert.match(viewerSource, /xrWindowManager\?\.minimizeAll/);
});

test('witness recovery and sensor teardown are bounded and deterministic', () => {
  assert.match(mediaHealthSource, /maxRecoveryAttempts = 3/);
  assert.match(mediaHealthSource, /this\.recoveryAttempt >= this\.maxRecoveryAttempts/);
  assert.match(mediaHealthSource, /this\.setState\('unavailable'\)/);
  assert.match(witnessSource, /clearTimeout\(this\.reconnectTimer\)/);
  assert.match(witnessSource, /this\.socket\?\.close\(\)/);
  assert.match(witnessSource, /this\.closeMedia\(\)/);
  assert.match(sensorSource, /this\.frameAcquirer\.dispose\(\)/);
  assert.match(sensorSource, /scene disposed/);
  assert.match(sensorSource, /geometries\.forEach\(\(geometry\) => geometry\.dispose\(\)\)/);
  assert.match(sensorSource, /textures\.forEach\(\(texture\) => texture\.dispose\(\)\)/);
});
