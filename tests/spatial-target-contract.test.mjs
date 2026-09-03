import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const readJson = async (path) => JSON.parse(await read(path));
const fixtureRoot = 'services/xr-diagnostics-kiosk/fixtures/';
const contractRoot = 'services/xr-diagnostics-kiosk/contracts/';

const targetSchema = await readJson(`${contractRoot}spatial-target-registry.schema.json`);
const commandSchema = await readJson(`${contractRoot}spatial-scene-command.schema.json`);
const companionSchema = await readJson(`${contractRoot}sensor-companion.schema.json`);
const gatewaySchema = await readJson(`${contractRoot}xr-session-gateway.schema.json`);
const localThermalBroker = await read('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/LocalThermalBroker.java');
const commissioningRun = await read('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/ThermalCommissioningRun.java');

test('spatial contracts share the XR session and target identity boundaries', () => {
  assert.equal(targetSchema.$defs.sessionId.pattern, gatewaySchema.$defs.sessionId.pattern);
  assert.equal(commandSchema.$defs.sessionId.pattern, gatewaySchema.$defs.sessionId.pattern);
  assert.equal(targetSchema.$defs.targetId.pattern, commandSchema.$defs.targetId.pattern);
  assert.equal(targetSchema.$defs.state.properties.targets.maxItems, 8);
  assert.equal(targetSchema.$defs.state.properties.schemaVersion.const, '1.0.0');
  assert.deepEqual(commandSchema.$defs.result.properties.status.enum, [
    'applied', 'rejected', 'stale', 'unavailable'
  ]);
});

test('spatial fixtures cover the frozen lifecycle and remain bounded', async () => {
  const names = (await readdir(new URL(fixtureRoot, root)))
    .filter((name) => name.startsWith('spatial-'))
    .sort();
  assert.deepEqual(names, [
    'spatial-command-scan.json',
    'spatial-command-stale-result.json',
    'spatial-targets-candidates.json',
    'spatial-targets-delta.json',
    'spatial-targets-empty.json',
    'spatial-targets-expired.json',
    'spatial-targets-locked.json',
    'spatial-targets-reconnect.json'
  ]);

  const candidates = await readJson(`${fixtureRoot}spatial-targets-candidates.json`);
  const locked = await readJson(`${fixtureRoot}spatial-targets-locked.json`);
  const expired = await readJson(`${fixtureRoot}spatial-targets-expired.json`);
  const reconnect = await readJson(`${fixtureRoot}spatial-targets-reconnect.json`);
  const delta = await readJson(`${fixtureRoot}spatial-targets-delta.json`);
  const scan = await readJson(`${fixtureRoot}spatial-command-scan.json`);
  const stale = await readJson(`${fixtureRoot}spatial-command-stale-result.json`);

  assert.ok(candidates.targets.length <= 3, 'model-facing fixture must stay within its projection budget');
  assert.equal(locked.targets.find((target) => target.targetId === locked.activeTargetId)?.state, 'locked');
  assert.ok(expired.targets[0].expiresAtMs < 1780000020000, 'expired fixture must be expired at the semantic test clock');
  assert.equal(delta.baseRevision, candidates.registryRevision);
  assert.equal(delta.registryRevision, locked.registryRevision);
  assert.equal(scan.action, 'scan');
  assert.equal(scan.targetId, undefined);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.registryRevision, reconnect.registryRevision);
});

test('sensor companion schema exposes protocol messages already used by Quest and WebXR', () => {
  for (const definition of [
    'nodeStatus',
    'snapshotRequest',
    'snapshotSuccess',
    'snapshotFailure',
    'commissioningBrowserAck',
    'commissioningStatus'
  ]) assert.ok(companionSchema.$defs[definition], `missing ${definition}`);

  const capabilities = companionSchema.$defs.capabilities.items.enum;
  assert.ok(capabilities.includes('headset-snapshot'));
  assert.ok(capabilities.includes('thermal-commissioning-v1'));
  assert.ok(capabilities.includes('remote-witness-bootstrap-v1'));
  assert.deepEqual(companionSchema.$defs.framePurpose.enum, ['scan', 'evidence']);
  assert.equal(companionSchema.$defs.cameraMetadata.properties.source.const, 'quest-passthrough');
  assert.ok(companionSchema.$defs.snapshotRequest.properties.scanId);
  assert.ok(companionSchema.$defs.snapshotSuccess.properties.camera);
  assert.match(localThermalBroker, /headset\.snapshot\.request/);
  assert.match(localThermalBroker, /headset\.snapshot\.result/);
  assert.match(localThermalBroker, /scanId/);
  assert.match(localThermalBroker, /poseAvailable/);
  assert.match(localThermalBroker, /commissioning\.browser_ack/);
  assert.match(commissioningRun, /commissioning\.status/);
});
