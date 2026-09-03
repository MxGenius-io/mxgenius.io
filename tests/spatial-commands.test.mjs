import assert from 'node:assert/strict';
import test from 'node:test';
import registryApi from '../xr-target-registry.js';
import commandsApi from '../spatial-commands.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function candidate(targetId, confidence = 0.92, aliases = {}) {
  return {
    targetId,
    kind: aliases.modelId ? 'mesh' : 'observed-object',
    label: targetId.split(':').at(-1),
    state: 'candidate',
    confidence,
    confidenceBasis: aliases.modelId ? 'mapped-geometry' : 'detector',
    source: 'command-test',
    targetRevision: 1,
    observedAtMs: 1_000,
    expiresAtMs: 30_000,
    aliases,
    anchor: aliases.modelId
      ? { coordinateFrame: 'model-local', objectName: aliases.meshId || 'mesh' }
      : { coordinateFrame: 'screen-normalized', bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }
  };
}

function setup(adapter = {}) {
  let now = 2_000;
  const registry = registryApi.create({
    sessionId: 'wave-four-session',
    storage: new MemoryStorage(),
    restore: false,
    now: () => now
  });
  const dispatcher = commandsApi.createDispatcher({ registry, adapter, now: () => now });
  return { registry, dispatcher, setNow: (value) => { now = value; } };
}

function command(registry, action, options = {}) {
  const snapshot = registry.snapshot();
  const target = options.targetId ? registry.get(options.targetId) : null;
  return {
    type: 'spatial.command',
    version: 1,
    commandId: options.commandId || `command_${action.replaceAll('-', '_')}_001`,
    sessionId: snapshot.sessionId,
    action,
    ...(target ? { targetId: target.targetId, expectedTargetRevision: target.targetRevision } : {}),
    arguments: options.arguments || {},
    expectedRegistryRevision: options.expectedRegistryRevision || snapshot.registryRevision,
    issuedAtMs: 2_000,
    expiresAtMs: options.expiresAtMs || 5_000
  };
}

test('client tools expose only the five reversible spatial presentation actions', () => {
  const tools = commandsApi.clientTools();
  assert.deepEqual(tools.map((item) => item.name), [
    'mxg.spatial.scan',
    'mxg.spatial.lock',
    'mxg.spatial.highlight',
    'mxg.spatial.clear',
    'mxg.spatial.set_thermal'
  ]);
  tools.forEach((item) => {
    assert.equal(item.inputSchema.additionalProperties, false);
    assert.equal(item.meta.client_handler, 'spatial_command');
    assert.equal(item.meta.requires_human_approval, false);
    assert.ok(item.inputSchema.required.includes('expectedRegistryRevision'));
  });
});

test('tool arguments fail closed instead of dropping unknown fields', async () => {
  const { registry, dispatcher } = setup({ scan: () => ({ status: 'applied' }) });
  const result = await dispatcher.dispatchTool('mxg.spatial.scan', {
    expectedRegistryRevision: registry.snapshot().registryRevision,
    surprise: true
  });
  assert.equal(result.status, 'rejected');
  assert.match(result.reason, /unsupported fields/i);
});

test('command acknowledgements are idempotent and replay the original result', async () => {
  let highlights = 0;
  const { registry, dispatcher } = setup({
    highlight: ({ isCurrent }) => {
      highlights += 1;
      return isCurrent().current ? { status: 'applied' } : { status: 'stale', reason: 'changed' };
    }
  });
  registry.upsert(candidate('observation:scan-1:tool'));
  const request = command(registry, 'highlight', { targetId: 'observation:scan-1:tool' });
  const first = await dispatcher.dispatch(request);
  registry.upsert(candidate('observation:scan-1:other', 0.88));
  const replay = await dispatcher.dispatch(request);
  assert.equal(first.status, 'applied');
  assert.deepEqual(replay, first);
  assert.equal(highlights, 1);
});

test('stale registry and target revisions are rejected before renderer work', async () => {
  let rendererCalls = 0;
  const { registry, dispatcher } = setup({ highlight: () => { rendererCalls += 1; } });
  registry.upsert(candidate('observation:scan-2:tool'));
  const staleRegistry = command(registry, 'highlight', {
    targetId: 'observation:scan-2:tool',
    expectedRegistryRevision: registry.snapshot().registryRevision - 1
  });
  assert.equal((await dispatcher.dispatch(staleRegistry)).status, 'stale');

  registry.upsert(candidate('observation:scan-2:tool'));
  const staleTarget = command(registry, 'highlight', { targetId: 'observation:scan-2:tool', commandId: 'command_stale_target_002' });
  staleTarget.expectedTargetRevision -= 1;
  assert.equal((await dispatcher.dispatch(staleTarget)).status, 'stale');
  assert.equal(rendererCalls, 0);
});

test('a delayed highlight rechecks revisions before moving the visible box', async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  let visibleTargetId = null;
  const { registry, dispatcher } = setup({
    highlight: async ({ target, isCurrent }) => {
      await wait;
      const guard = isCurrent();
      if (!guard.current) return { status: 'stale', reason: guard.reason };
      visibleTargetId = target.targetId;
      return { status: 'applied' };
    }
  });
  registry.upsert(candidate('observation:scan-3:first'));
  const delayed = dispatcher.dispatch(command(registry, 'highlight', { targetId: 'observation:scan-3:first' }));
  registry.upsert(candidate('observation:scan-3:newer', 0.95));
  release();
  const result = await delayed;
  assert.equal(result.status, 'stale');
  assert.equal(visibleTargetId, null);
});

test('scan, highlight, lock, thermal, and clear share one target spine', async () => {
  const trace = [];
  let registry;
  const state = setup({
    scan: () => {
      registry.upsert(candidate('observation:scan-4:battery'));
      trace.push('scan');
      return { status: 'applied' };
    },
    highlight: ({ target, isCurrent }) => {
      if (!isCurrent().current) return { status: 'stale', reason: 'changed' };
      trace.push(`highlight:${target.targetId}`);
      return { status: 'applied' };
    },
    lock: ({ target, isCurrent }) => {
      if (!isCurrent().current) return { status: 'stale', reason: 'changed' };
      registry.lock(target.targetId);
      trace.push(`lock:${target.targetId}`);
      return { status: 'applied' };
    },
    setThermal: ({ command, isCurrent }) => {
      if (!isCurrent().current) return { status: 'stale', reason: 'changed' };
      trace.push(`thermal:${command.arguments.enabled}`);
      return { status: 'applied' };
    },
    clear: ({ isCurrent }) => {
      if (!isCurrent().current) return { status: 'stale', reason: 'changed' };
      registry.clear();
      trace.push('clear');
      return { status: 'applied' };
    }
  });
  registry = state.registry;

  assert.equal((await state.dispatcher.dispatch(command(registry, 'scan'))).status, 'applied');
  const targetId = 'observation:scan-4:battery';
  assert.equal((await state.dispatcher.dispatch(command(registry, 'highlight', { targetId }))).status, 'applied');
  assert.equal((await state.dispatcher.dispatch(command(registry, 'lock', { targetId }))).status, 'applied');
  assert.equal(registry.getActive().targetId, targetId);
  assert.equal((await state.dispatcher.dispatch(command(registry, 'set-thermal', { arguments: { enabled: true } }))).status, 'applied');
  assert.equal((await state.dispatcher.dispatch(command(registry, 'clear'))).status, 'applied');
  assert.equal(registry.getActive(), null);
  assert.deepEqual(trace, [
    'scan',
    `highlight:${targetId}`,
    `lock:${targetId}`,
    'thermal:true',
    'clear'
  ]);
});

test('expired commands return stale acknowledgements and never call adapters', async () => {
  let calls = 0;
  const { registry, dispatcher, setNow } = setup({ scan: () => { calls += 1; } });
  const request = command(registry, 'scan', { expiresAtMs: 2_100 });
  setNow(2_101);
  const result = await dispatcher.dispatch(request);
  assert.equal(result.status, 'stale');
  assert.equal(calls, 0);
});

test('embedded viewer adapter maps registry aliases without renderer coupling', async () => {
  const messages = [];
  const { registry } = setup();
  registry.upsert(candidate('mesh:model-7:left-wing', 1, {
    modelId: 'model-7', meshId: 'LeftWing', meshPath: 'Aircraft/LeftWing'
  }));
  const viewer = {
    highlightPart: (selector) => messages.push(['highlight', selector]),
    clearSelection: () => messages.push(['clear'])
  };
  const dispatcher = commandsApi.createDispatcher({
    registry,
    now: () => 2_000,
    adapter: commandsApi.createEmbeddedViewerAdapter({ viewer, registry })
  });
  const targetId = 'mesh:model-7:left-wing';
  assert.equal((await dispatcher.dispatch(command(registry, 'highlight', { targetId }))).status, 'applied');
  assert.deepEqual(messages[0], ['highlight', { modelId: 'model-7', meshName: 'LeftWing', path: 'Aircraft/LeftWing' }]);
});
