import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import registryApi from '../xr-target-registry.js';
import {
  ConnectedSpatialScanAnalyzer,
  SPATIAL_SCAN_POLICY,
  SimulatedSpatialScanAnalyzer,
  SpatialScanAnalyzer,
  applySpatialScanResult,
  normalizeSpatialCandidates,
  prepareSpatialScanFrame
} from '../spatial-scan-analyzer.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function scanFrame(scanId = 'scan-contract-0001') {
  return {
    requestId: 'frame-contract-0001', scanId, purpose: 'scan',
    width: 1280, height: 720, capturedAtMs: 1_780_000_000_000,
    dataUrl: 'data:image/jpeg;base64,/9j/2Q=='
  };
}

test('provider-neutral base analyzer fails honestly when no provider is implemented', async () => {
  await assert.rejects(new SpatialScanAnalyzer().analyzeFrame(scanFrame()), (error) => error.code === 'analyzer-not-implemented');
});

test('simulated analyzer is deterministic and supports empty, single, and multi-target scenarios', async () => {
  for (const [scenario, expected] of [['empty', 0], ['single', 1], ['multi', 4]]) {
    const analyzer = new SimulatedSpatialScanAnalyzer({ scenario, now: () => 1_780_000_000_000 });
    const first = await analyzer.analyzeFrame(scanFrame());
    const second = await analyzer.analyzeFrame(scanFrame());
    assert.deepEqual(first, second);
    assert.equal(first.candidates.length, expected);
    assert.equal(first.status, expected ? 'ready' : 'empty');
  }
});

test('bounded frames pass through local preparation without browser image APIs', async () => {
  const frame = scanFrame();
  assert.deepEqual(await prepareSpatialScanFrame(frame), frame);
});

test('connected analyzer makes one correlated call and preserves typed provider states', async () => {
  let calls = 0;
  const frame = scanFrame('scan-connected-1');
  const analyzer = new ConnectedSpatialScanAnalyzer({
    sessionId: 'session-connected-1',
    prepare: async (value) => value,
    analyze: async ({ sessionId, frame: prepared }) => {
      calls += 1;
      assert.equal(sessionId, 'session-connected-1');
      assert.equal(prepared, frame);
      return {
        status: 'rate-limited',
        scanId: frame.scanId,
        requestId: frame.requestId,
        source: 'mxgenius-spatial-model',
        reason: 'Scan cooldown is active',
        retryAfterMs: 1_500,
        candidates: []
      };
    }
  });
  const result = await analyzer.analyzeFrame(frame);
  assert.equal(calls, 1);
  assert.equal(result.status, 'rate-limited');
  assert.equal(result.retryAfterMs, 1_500);
  assert.equal(result.candidates.length, 0);
});

test('connected analyzer rejects mismatched scan correlation', async () => {
  const analyzer = new ConnectedSpatialScanAnalyzer({
    sessionId: 'session-connected-2',
    prepare: async (value) => value,
    analyze: async () => ({ status: 'empty', scanId: 'different-scan', candidates: [] })
  });
  await assert.rejects(analyzer.analyzeFrame(scanFrame('expected-scan')), (error) => error.code === 'scan-correlation');
});

test('normalization caps, thresholds, sorts, namespaces, and expires provider detections', async () => {
  const result = await new SimulatedSpatialScanAnalyzer({ scenario: 'multi', now: () => 2_000 }).analyzeFrame(scanFrame('scan-normalize-1'));
  const targets = normalizeSpatialCandidates(result, { registryApi, now: () => 2_000 });
  assert.equal(targets.length, SPATIAL_SCAN_POLICY.displayMaximum);
  assert.deepEqual(targets.map((target) => target.confidence), [0.96, 0.92, 0.87]);
  assert.ok(targets.every((target) => target.targetId.startsWith('observation:scan-normalize-1:')));
  assert.ok(targets.every((target) => target.anchor.coordinateFrame === 'screen-normalized'));
  assert.ok(targets.every((target) => target.expiresAtMs === 17_000));
  assert.ok(targets.every((target) => target.confidence >= SPATIAL_SCAN_POLICY.confidenceThreshold));
});

test('one applied scan atomically replaces its provider candidates and preserves unrelated targets', async () => {
  let now = 5_000;
  const registry = registryApi.create({ sessionId: 'simulation-session', storage: new MemoryStorage(), now: () => now, restore: false });
  registry.upsert({
    targetId: 'sensor:thermal-source', kind: 'sensor', label: 'FLIR thermal source', state: 'locked',
    confidence: 1, confidenceBasis: 'deterministic-lookup', source: 'sensor-bridge', targetRevision: 1,
    observedAtMs: now, expiresAtMs: Number.MAX_SAFE_INTEGER, aliases: {}, anchor: { coordinateFrame: 'xr-local' }
  }, { activate: true });

  const analyzer = new SimulatedSpatialScanAnalyzer({ scenario: 'multi', now: () => now });
  const applied = applySpatialScanResult(registry, await analyzer.analyzeFrame(scanFrame('scan-apply-1')), { registryApi, now: () => now });
  assert.equal(applied.status, 'ready');
  assert.equal(applied.count, 3);
  assert.equal(registry.snapshot().targets.length, 4);
  assert.equal(registry.getActive().targetId, 'sensor:thermal-source');

  now += 1_000;
  const empty = new SimulatedSpatialScanAnalyzer({ scenario: 'empty', now: () => now });
  const cleared = applySpatialScanResult(registry, await empty.analyzeFrame(scanFrame('scan-apply-2')), { registryApi, now: () => now });
  assert.equal(cleared.status, 'empty');
  assert.deepEqual(registry.snapshot().targets.map((target) => target.targetId), ['sensor:thermal-source']);
});

test('target HUD source keeps navigation, locking, clearing, expiry, and staged non-blinking reveal explicit', async () => {
  const hud = await readFile(new URL('../xr-spatial-target-hud.js', import.meta.url), 'utf8');
  const scene = await readFile(new URL('../globe-vr.html', import.meta.url), 'utf8');
  assert.match(hud, /nextCandidate\(input = 'xr'\)/);
  assert.match(hud, /this\.registry\.lock\(target\.targetId/);
  assert.match(hud, /reason: 'spatial-targets-cleared'/);
  assert.match(hud, /this\.registry\.expire\(\{ reason: 'spatial-targets-expired' \}\)/);
  assert.match(hud, /phase\(progress, 0, 0\.24\)/);
  assert.match(hud, /phase\(progress, 0\.16, 0\.44\)/);
  assert.match(hud, /phase\(progress, 0\.38, 0\.66\)/);
  assert.match(hud, /phase\(progress, 0\.58, 0\.88\)/);
  assert.doesNotMatch(hud, /blink|setInterval/);
  assert.match(scene, /spatialSimulationEnabled = sensorOnlyScene && localPreviewHost/);
  assert.match(scene, /new ConnectedSpatialScanAnalyzer/);
  assert.match(scene, /MXApplicationClient\.spatial\.scan/);
  assert.match(scene, /onScanFrame: sensorOnlyScene \? analyzeSpatialFrame : null/);
  assert.match(scene, /spatialPreviewScan\.addEventListener/);
});
