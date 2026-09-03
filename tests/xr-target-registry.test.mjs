import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import registryApi from '../xr-target-registry.js';

const root = new URL('../', import.meta.url);
const fixture = async (name) => JSON.parse(await readFile(new URL(`services/xr-diagnostics-kiosk/fixtures/${name}`, root), 'utf8'));

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function candidate(id, confidence = 0.8, aliases = {}) {
  return {
    targetId: id,
    kind: 'observed-object',
    label: id.split(':').at(-1),
    state: 'candidate',
    confidence,
    confidenceBasis: 'detector',
    source: 'test-analyzer',
    targetRevision: 1,
    observedAtMs: 1_000,
    expiresAtMs: 20_000,
    aliases,
    anchor: { coordinateFrame: 'screen-normalized', bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }
  };
}

test('registry lifecycle enforces one active lock and emits bounded snapshots', () => {
  let now = 1_000;
  const storage = new MemoryStorage();
  const registry = registryApi.create({ sessionId: 'session-wave-one', storage, now: () => now, restore: false });
  const changes = [];
  registry.subscribe((detail) => changes.push(detail.reason));

  registry.upsert(candidate('observation:scan-1:left', 0.91));
  registry.upsert(candidate('observation:scan-1:right', 0.88));
  assert.equal(registry.snapshot().targets.length, 2);

  assert.equal(registry.lock('observation:scan-1:left').state, 'locked');
  assert.equal(registry.lock('observation:scan-1:right').targetId, 'observation:scan-1:right');
  const state = registry.snapshot();
  assert.equal(state.activeTargetId, 'observation:scan-1:right');
  assert.equal(state.targets.filter((target) => target.state === 'locked').length, 1);
  assert.equal(state.targets.find((target) => target.targetId.endsWith(':left')).state, 'candidate');

  const restored = registryApi.create({ storage, now: () => now });
  assert.equal(restored.snapshot().targets.length, 2);
  assert.equal(restored.getActive().targetId, 'observation:scan-1:right');

  assert.equal(registry.clear(), true);
  assert.equal(registry.getActive(), null);
  assert.equal(registry.remove('observation:scan-1:left'), true);
  assert.ok(changes.includes('target-locked'));
  assert.ok(changes.includes('target-cleared'));
});

test('full snapshots resync and stale deltas cannot mutate current state', async () => {
  let now = 1_780_000_002_000;
  const events = [];
  const eventRoot = {
    dispatchEvent: (event) => events.push(event.type),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } }
  };
  const registry = registryApi.create({ root: eventRoot, sessionId: 'local-session', storage: new MemoryStorage(), now: () => now, restore: false });
  const candidates = await fixture('spatial-targets-candidates.json');
  assert.equal(registry.replaceSnapshot(candidates, { replaceSession: true }).status, 'applied');
  assert.equal(registry.snapshot().targets.length, 2);
  assert.ok(events.includes('mxgenius:targets-resynced'));

  const delta = await fixture('spatial-targets-delta.json');
  assert.equal(registry.applyDelta(delta).status, 'applied');
  assert.equal(registry.getActive().targetId, 'observation:scan-contract-1:candidate-1');
  const revision = registry.snapshot().registryRevision;
  assert.equal(registry.applyDelta(delta).status, 'stale');
  assert.equal(registry.snapshot().registryRevision, revision);
  assert.equal(registry.snapshot().targets.length, 2);

  const malformed = JSON.parse(JSON.stringify(delta));
  malformed.baseRevision = revision;
  malformed.registryRevision = revision + 1;
  malformed.operations[0].target.untrustedText = 'must not cross the contract';
  assert.equal(registry.applyDelta(malformed).status, 'rejected');
  assert.equal(registry.snapshot().registryRevision, revision);
});

test('session replacement requires an explicit resync and retired sessions cannot return', async () => {
  let now = 1_780_000_002_000;
  const registry = registryApi.create({ sessionId: 'session-before-reconnect', storage: new MemoryStorage(), now: () => now, restore: false });
  const firstSession = await fixture('spatial-targets-candidates.json');
  assert.equal(registry.replaceSnapshot(firstSession).status, 'stale');
  assert.equal(registry.replaceSnapshot(firstSession, { replaceSession: true }).status, 'applied');

  const nextSession = {
    ...firstSession,
    sessionId: 'session-after-reconnect',
    registryRevision: 1,
    observedAtMs: firstSession.observedAtMs + 1,
    activeTargetId: null,
    targets: []
  };
  assert.equal(registry.replaceSnapshot(nextSession, { replaceSession: true }).status, 'applied');
  assert.equal(registry.snapshot().sessionId, 'session-after-reconnect');
  assert.equal(registry.snapshot().targets.length, 0);

  const delayedOldSnapshot = { ...firstSession, registryRevision: 10, observedAtMs: firstSession.observedAtMs + 2 };
  assert.equal(registry.replaceSnapshot(delayedOldSnapshot, { replaceSession: true }).status, 'stale');
  assert.equal(registry.snapshot().sessionId, 'session-after-reconnect');
  assert.equal(registry.snapshot().targets.length, 0);
});

test('expiry removes active and candidate targets without leaving a phantom lock', () => {
  let now = 1_000;
  const registry = registryApi.create({ sessionId: 'expiry-session', storage: new MemoryStorage(), now: () => now, restore: false });
  registry.upsert(candidate('observation:scan-2:tool'), { activate: true });
  registry.upsert(candidate('observation:scan-2:battery'));
  now = 20_001;
  assert.deepEqual(registry.expire().sort(), ['observation:scan-2:battery', 'observation:scan-2:tool']);
  assert.equal(registry.getActive(), null);
  assert.equal(registry.snapshot().targets.length, 0);
});

test('alias resolution is explicit about ambiguity', () => {
  const registry = registryApi.create({ sessionId: 'alias-session', storage: new MemoryStorage(), now: () => 1_000, restore: false });
  registry.upsert(candidate('observation:scan-3:left', 0.9, { partNumber: 'AN-4' }));
  registry.upsert(candidate('observation:scan-3:right', 0.8, { partNumber: 'AN-4' }));
  registry.upsert(candidate('observation:scan-3:center', 0.7, { partNumber: 'MS-2' }));

  const ambiguous = registry.resolveAlias({ partNumber: 'AN-4' });
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.target, null);
  assert.equal(ambiguous.targetIds.length, 2);
  assert.equal(registry.resolveAlias({ partNumber: 'MS-2' }).target.targetId, 'observation:scan-3:center');
  assert.equal(registry.resolveAlias({ partNumber: 'MISSING' }).status, 'not-found');
});

test('model projection contains one lock and no more than three ranked candidates', () => {
  const registry = registryApi.create({ sessionId: 'projection-session', storage: new MemoryStorage(), now: () => 1_000, restore: false });
  for (let index = 0; index < 6; index += 1) registry.upsert(candidate(`observation:scan-4:item-${index}`, 0.5 + index / 20));
  registry.lock('observation:scan-4:item-0');
  const projection = registry.modelProjection();
  assert.equal(projection.activeTarget.targetId, 'observation:scan-4:item-0');
  assert.equal(projection.candidates.length, 3);
  assert.deepEqual(projection.candidates.map((target) => target.targetId), [
    'observation:scan-4:item-5', 'observation:scan-4:item-4', 'observation:scan-4:item-3'
  ]);
  assert.equal('observedAtMs' in projection.activeTarget, false);
  assert.equal('expiresAtMs' in projection.activeTarget, false);
});

test('namespaced IDs are deterministic and preserve aliases separately', () => {
  const first = registryApi.makeTargetId('mesh', 'CL 350 cabin', 'Left/Wing panel');
  const second = registryApi.makeTargetId('mesh', 'CL 350 cabin', 'Left/Wing panel');
  assert.equal(first, second);
  assert.match(first, registryApi.TARGET_ID_PATTERN);
  const normalized = registryApi.normalizeTarget({
    kind: 'mesh', label: 'Left wing panel', aliases: { modelId: 'CL 350 cabin', meshPath: 'Left/Wing panel' },
    state: 'candidate', confidence: 0.5, confidenceBasis: 'mapped-geometry', source: 'viewer',
    observedAtMs: 1, expiresAtMs: 2, anchor: { coordinateFrame: 'model-local', objectName: 'Left Wing' }
  }, { now: 1 });
  assert.equal(normalized.aliases.meshPath, 'Left/Wing panel');
  assert.match(normalized.targetId, registryApi.TARGET_ID_PATTERN);
});

test('legacy target facade preserves aircraft, case, fleet, parts, and mesh caller shapes', async () => {
  const registrySource = await readFile(new URL('xr-target-registry.js', root), 'utf8');
  const contextSource = await readFile(new URL('xr-target-context.js', root), 'utf8');
  const storage = new MemoryStorage();
  const events = [];
  const browser = {
    console, Math, Date, JSON, Map, Set,
    sessionStorage: storage,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    dispatchEvent: (event) => events.push(event)
  };
  browser.window = browser;
  vm.createContext(browser);
  vm.runInContext(registrySource, browser);
  vm.runInContext(contextSource, browser);
  const context = browser.MXTargetContext;

  assert.equal(context.set({ kind: 'aircraft', id: 'N789CA', label: 'N789CA' }).id, 'N789CA');
  assert.equal(context.registry.getActive().targetId, 'aircraft:N789CA');
  const reloadedBrowser = {
    console, Math, Date, JSON, Map, Set,
    sessionStorage: storage,
    crypto: browser.crypto,
    CustomEvent: browser.CustomEvent,
    dispatchEvent: () => {}
  };
  reloadedBrowser.window = reloadedBrowser;
  vm.createContext(reloadedBrowser);
  vm.runInContext(registrySource, reloadedBrowser);
  vm.runInContext(contextSource, reloadedBrowser);
  assert.equal(reloadedBrowser.MXTargetContext.get().id, 'N789CA');
  assert.equal(context.set({ kind: 'case', id: 'case-7', context: { aircraftId: 'N789CA' } }).kind, 'case');

  const fleet = context.fromXRAction({ action: 'open-fleet-location', target: { icao: 'KTEB', city: 'Teterboro' } });
  assert.equal(context.set(fleet).id, 'KTEB');
  const part = context.fromPartUnit({ id: 'unit-9', partNumber: 'AN-4', serialNumber: 'SN-2', status: 'available' });
  assert.equal(context.set(part).state, 'ready');
  const mesh = context.fromPartSelection({ model: { id: 'model-1' }, selection: { componentId: 'wing-left', meshName: 'Wing' } });
  assert.equal(context.set(mesh).context.componentId, 'wing-left');
  assert.equal(context.guideId(), 'mesh-inspection');
  assert.equal(context.clear({ match: { kind: 'mesh', id: 'wing-left' } }), true);
  assert.equal(context.get(), null);
  context.set({ kind: 'aircraft', id: 'N12345' }, { persist: false });
  assert.equal(storage.getItem(context.STORAGE_KEY), null);
  assert.ok(events.some((event) => event.type === 'mxgenius:target-changed'));
  assert.ok(events.some((event) => event.type === 'mxgenius:target-cleared'));
});

test('dashboard loads the registry before the compatibility facade and application callers', async () => {
  const dashboard = await readFile(new URL('dashboard.html', root), 'utf8');
  const registryIndex = dashboard.indexOf('<script src="xr-target-registry.js?v=1"></script>');
  const contextIndex = dashboard.indexOf('<script src="xr-target-context.js?v=2"></script>');
  const commandsIndex = dashboard.indexOf('<script src="spatial-commands.js?v=1"></script>');
  const appIndex = dashboard.indexOf('<script src="app.js?v=52"></script>');
  assert.ok(registryIndex >= 0 && registryIndex < contextIndex && contextIndex < commandsIndex && commandsIndex < appIndex);
});
