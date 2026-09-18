import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { SpatialWindowManager } from '../spatial-window-manager.js';

const source = await readFile(new URL('../spatial-context.js', import.meta.url), 'utf8');
const [dashboard, application, viewer, globe, shell, witness, operations] = await Promise.all([
  readFile(new URL('../dashboard.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../3d-viewer/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../globe-vr.html', import.meta.url), 'utf8'),
  readFile(new URL('../xr-spatial-shell.js', import.meta.url), 'utf8'),
  readFile(new URL('../xr-remote-witness.js', import.meta.url), 'utf8'),
  readFile(new URL('../xr-operations-surface.js', import.meta.url), 'utf8')
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
    part: { partNumber: 'WHELEN-01', requestId: 'request-2' },
    location: { icao: 'kpbi', lat: 26.68, lng: -80.09 },
    token: 'must-not-survive', media: new Blob(['no'])
  });
  assert.equal(value.version, 2);
  assert.equal(value.aircraft.id, 'aircraft-1');
  assert.equal(value.case.id, 'case-9');
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

test('the web application exposes one VR launcher and one canonical session owner', () => {
  assert.equal((dashboard.match(/id="spatialWorkspaceBtn"/g) || []).length, 1);
  assert.doesNotMatch(dashboard, /id="globeVrButton"/);
  assert.doesNotMatch(viewer, /id="enter-vr-button"|VRButton\.createButton/);
  assert.match(application, /MX3DViewer\.requestSpatialSession/);
  assert.match(viewer, /navigator\.xr\.requestSession\('immersive-vr'/);
  assert.match(viewer, /await renderer\.xr\.setSession\(session\)/);
  assert.match(viewer, /mxgenius\.viewer\.sensor-scene-request/);
  assert.doesNotMatch(viewer, /window\.top\.location\.assign/);
});

test('operations and maintenance change inside the same renderer without dropping live pipes', () => {
  assert.match(viewer, /new XROperationsSurface/);
  assert.match(viewer, /mode === 'maintenance'[\s\S]*openSensorDiagnostics\(input\)/);
  assert.match(viewer, /setSpatialMode\(mode, \{ source: 'spatial-tray' \}\)/);
  assert.match(viewer, /xrVoice\.group\.visible = presenting && maintenance/);
  assert.match(viewer, /xrWitness\.group\.visible = presenting && maintenance/);
  assert.match(viewer, /xrWindowManager\?\.minimizeAll/);
  assert.match(operations, /MXGeniusOperationsGlobe/);
  assert.match(globe, /"three": "\.\/3d-viewer\/lib\/three\.module\.js"/);
});

test('maintenance hands off to the Quest diagnostics scene and returns to canonical VR', () => {
  assert.match(shell, /onActiveMode = \(\) => false/);
  assert.match(shell, /this\.onActiveMode\(nextMode, \{ input \}\) === true/);
  assert.match(viewer, /mxgenius\.viewer\.sensor-scene-request/);
  assert.match(application, /globe-vr\.html[\s\S]*searchParams\.set\('scene', 'sensor'\)[\s\S]*searchParams\.set\('return', 'vr'\)/);
  assert.match(globe, /Back to VR workspace/);
  assert.match(globe, /returnToCanonicalVr[\s\S]*spatialReturn=\$\{encodeURIComponent\(mode\)\}#3d-viewer/);
});

test('the spatial tray communicates minimized windows without ending Remote Witness', () => {
  assert.match(shell, /tool\.windowState === 'minimized'/);
  assert.match(shell, /context\.arc\(128, 174, 7/);
  assert.match(witness, /MXGeniusWitnessMinimize/);
  assert.match(witness, /MXGeniusWitnessMaximize/);
  assert.match(witness, /witness-window-close/);
  assert.match(viewer, /xrWindowManager\?\.close\('witness'/);
  const setOpen = witness.slice(witness.indexOf('setOpen(open'), witness.indexOf('async createInvitation'));
  assert.doesNotMatch(setOpen, /closeMedia|socket\.close|revoke/);
});

test('Remote Witness docks to the spatial tray and unfolds from its tool pivot', () => {
  assert.match(witness, /dockProvider = \(\) => null/);
  assert.match(witness, /this\.panelContent\.position\.set\(0\.47, -0\.14, -0\.038\)/);
  assert.match(witness, /const dock = this\.dockProvider\?\.\(\)/);
  assert.match(witness, /dock\.getWorldPosition\(this\.cameraPosition\)/);
  assert.match(viewer, /dockProvider: \(\) => xrSpatialShell\?\.group \|\| null/);
  assert.ok(viewer.indexOf('xrSpatialShell?.update(delta, { camera });') < viewer.indexOf('xrWitness?.update(delta, { camera });'));
});
