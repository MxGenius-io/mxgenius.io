import assert from 'node:assert/strict';
import test from 'node:test';
import { XRCapabilityRegistry, xrEvidenceTarget } from '../xr-capability-registry.js';

test('capture requires both an active case and an evidence target', () => {
  const registry = new XRCapabilityRegistry();
  assert.equal(registry.get('capture').enabled, false);
  assert.match(registry.get('capture').reason, /case/i);

  registry.setContext({ case: { id: 'case-1' } });
  assert.equal(registry.get('capture').enabled, false);
  assert.match(registry.get('capture').reason, /asset or part/i);

  registry.setContext({ case: { id: 'case-1' }, component: { id: 'strobe-lens' } });
  assert.equal(registry.get('capture').enabled, true);
  assert.equal(xrEvidenceTarget({ caseId: 'case-1', part: { partNumber: 'PN-1' } }).ready, true);
});

test('thermal is gated by a connected transport and valid live source', () => {
  const registry = new XRCapabilityRegistry({
    runtime: { thermal: { transport: 'connected', source: 'standby', frames: 0 } }
  });
  assert.equal(registry.get('thermal').enabled, false);
  assert.match(registry.get('thermal').reason, /source/i);

  registry.setRuntime('thermal', { source: 'streaming', frames: 1 });
  assert.equal(registry.get('thermal').enabled, true);
  assert.equal(registry.get('thermal').status, 'LIVE');

  registry.setRuntime('thermal', { transport: 'disconnected' });
  assert.equal(registry.get('thermal').enabled, false);
  assert.match(registry.get('thermal').reason, /bridge/i);
});

test('witness status follows invitation consent and connection state', () => {
  const registry = new XRCapabilityRegistry({
    runtime: { witness: { configured: true, roomStatus: 'awaiting-approval', approved: false } }
  });
  assert.equal(registry.get('witness').enabled, true);
  assert.equal(registry.get('witness').status, 'AWAITING CONSENT');

  registry.setRuntime('witness', { roomStatus: 'live', approved: true });
  assert.equal(registry.get('witness').status, 'LIVE');

  registry.setRuntime('witness', { configured: false });
  assert.equal(registry.get('witness').enabled, false);
  assert.match(registry.get('witness').reason, /service/i);
});

test('permissions disable capabilities with a reason and execution fails closed', async () => {
  let calls = 0;
  const registry = new XRCapabilityRegistry({
    context: { case: { id: 'case-1' }, model: { id: 'model-1' } },
    permissions: { capture: false },
    actions: { capture: () => { calls += 1; } }
  });
  const blocked = await registry.execute('capture');
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /permission/i);
  assert.equal(calls, 0);

  registry.setPermissions({ capture: true });
  const allowed = await registry.execute('capture');
  assert.equal(allowed.ok, true);
  assert.equal(calls, 1);
});

test('capability snapshots preserve the stable contextual action order', () => {
  const registry = new XRCapabilityRegistry();
  assert.deepEqual(registry.snapshot().map(({ id }) => id), ['voice', 'capture', 'thermal', 'witness']);
  for (const capability of registry.snapshot()) {
    assert.equal(capability.visible, true);
    if (!capability.enabled) assert.ok(capability.reason);
  }
});
