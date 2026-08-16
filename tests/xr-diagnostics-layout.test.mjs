import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  applyDiagnosticsDelta,
  formatDiagnosticsLayout,
  loadDiagnosticsLayout,
  resolveDiagnosticsPointer,
  validateDiagnosticsLayout
} from '../xr-diagnostics-layout.js';

const schema = JSON.parse(await readFile(
  new URL('../services/xr-diagnostics-kiosk/contracts/diagnostics-state.schema.json', import.meta.url),
  'utf8'
));
const layout = schema['x-mxg-xr-layout'];
const state = {
  type: 'diagnostics.state',
  schema: 'mxg.edge.diagnostics',
  schemaVersion: '1.0.0',
  nodeId: 'pi-edge-01',
  posture: 'warning',
  metrics: {
    'cpu.utilization': { value: 72.45, unit: 'percent', quality: 'measured' },
    'cpu.temperature': { value: 53.16, unit: 'celsius', quality: 'measured' },
    'memory.utilization': { value: 41.2, unit: 'percent', quality: 'measured' },
    'storage.utilization': { value: 29.8, unit: 'percent', quality: 'measured' },
    'system.load.1m': { value: 0.48, unit: 'ratio', quality: 'measured' }
  },
  transports: {
    'network:eth0': { status: 'online' },
    'probe:can': { status: 'offline' }
  },
  findings: {
    active: { active: true },
    cleared: { active: false }
  },
  sequence: 41,
  observedAtMs: 1000,
  sessionId: 'session-a'
};

test('canonical Pi schema owns the deterministic sensor-diagnostics panel layout', () => {
  assert.equal(validateDiagnosticsLayout(layout), layout);
  assert.equal(layout.surface, 'sensor-diagnostics');
  assert.equal(layout.panel.rows.length, 8);
  assert.deepEqual(layout.panel.rows.map((row) => row.id), [
    'node', 'posture', 'cpu', 'memory', 'storage', 'load', 'transports', 'findings'
  ]);
});

test('schema paths rebuild normalized Pi state into predictable XR rows', () => {
  assert.equal(resolveDiagnosticsPointer(state, '/metrics/cpu.utilization/value'), 72.45);
  const rows = Object.fromEntries(formatDiagnosticsLayout(layout, state).map((row) => [row.id, row.value]));
  assert.equal(rows.node, 'pi-edge-01');
  assert.equal(rows.posture, 'warning');
  assert.equal(rows.cpu, '72.5% · 53.2°C');
  assert.equal(rows.memory, '41.2%');
  assert.equal(rows.storage, '29.8%');
  assert.equal(rows.load, '0.48');
  assert.equal(rows.transports, '1/2 online');
  assert.equal(rows.findings, '1 active');
});

test('a sequenced Pi delta rebuilds the same schema-defined XR rows', () => {
  const rebuilt = applyDiagnosticsDelta(state, {
    type: 'diagnostics.delta',
    baseSequence: 41,
    sequence: 42,
    observedAtMs: 1100,
    sessionId: 'session-a',
    operations: [
      { op: 'replace', path: '/metrics/cpu.utilization/value', value: 83.25 },
      { op: 'replace', path: '/posture', value: 'critical' }
    ]
  });
  const rows = Object.fromEntries(formatDiagnosticsLayout(layout, rebuilt).map((row) => [row.id, row.value]));
  assert.equal(rebuilt.sequence, 42);
  assert.equal(rows.cpu, '83.3% · 53.2°C');
  assert.equal(rows.posture, 'critical');
  assert.equal(applyDiagnosticsDelta(state, { baseSequence: 40, sequence: 42, operations: [] }), null);
});

test('XR layout loader reads the extension from the published schema response', async () => {
  const loaded = await loadDiagnosticsLayout({
    schemaUrl: '/schemas/edge-diagnostics-1.0.0.json',
    fetchImpl: async () => ({ ok: true, json: async () => schema })
  });
  assert.equal(loaded.panel.title, 'PI EDGE DIAGNOSTICS');
});
