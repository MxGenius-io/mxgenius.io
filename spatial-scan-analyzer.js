export const SPATIAL_SCAN_POLICY = Object.freeze({
  providerMaximum: 5,
  displayMaximum: 3,
  confidenceThreshold: 0.85,
  candidateLifetimeMs: 15_000
});

const SCENARIOS = Object.freeze({
  empty: [],
  single: [
    {
      providerId: 'hydraulic-junction',
      label: 'Hydraulic line junction',
      kind: 'component',
      confidence: 0.94,
      bounds: { x: 0.36, y: 0.28, width: 0.23, height: 0.31 },
      aliases: { componentId: 'sim-hydraulic-junction' }
    }
  ],
  multi: [
    {
      providerId: 'service-panel',
      label: 'Service access panel',
      kind: 'component',
      confidence: 0.96,
      bounds: { x: 0.12, y: 0.21, width: 0.24, height: 0.28 },
      aliases: { componentId: 'sim-service-panel' }
    },
    {
      providerId: 'hydraulic-junction',
      label: 'Hydraulic line junction',
      kind: 'component',
      confidence: 0.92,
      bounds: { x: 0.57, y: 0.29, width: 0.22, height: 0.3 },
      aliases: { componentId: 'sim-hydraulic-junction' }
    },
    {
      providerId: 'electrical-connector',
      label: 'Electrical connector',
      kind: 'component',
      confidence: 0.87,
      bounds: { x: 0.42, y: 0.63, width: 0.16, height: 0.15 },
      aliases: { componentId: 'sim-electrical-connector' }
    },
    {
      providerId: 'reflection',
      label: 'Reflective surface',
      kind: 'observed-object',
      confidence: 0.72,
      bounds: { x: 0.74, y: 0.08, width: 0.12, height: 0.12 },
      aliases: {}
    }
  ]
});

const TARGET_KINDS = new Set(['aircraft', 'component', 'mesh', 'part-unit', 'sensor', 'observed-object']);

export class SpatialScanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SpatialScanError';
    this.code = code;
  }
}

function clean(value, fallback = '', limit = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, limit);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBounds(input) {
  if (!input || typeof input !== 'object') return null;
  const x = finite(input.x);
  const y = finite(input.y);
  const width = finite(input.width);
  const height = finite(input.height);
  if ([x, y, width, height].some((value) => value === null) || width <= 0 || height <= 0 || x < 0 || y < 0 || x >= 1 || y >= 1) return null;
  return {
    x,
    y,
    width: Math.min(width, 1 - x),
    height: Math.min(height, 1 - y)
  };
}

function normalizeAliases(input = {}) {
  const aliases = {};
  for (const field of ['aircraftId', 'caseId', 'componentId', 'meshId', 'modelId', 'partNumber', 'serialNumber', 'zoneId']) {
    const value = clean(input[field], '', 180);
    if (value) aliases[field] = value;
  }
  return aliases;
}

/** Provider contract: one deliberate scan in, bounded object locations out. */
export class SpatialScanAnalyzer {
  constructor({ source = 'spatial-analyzer' } = {}) {
    this.source = clean(source, 'spatial-analyzer', 120);
  }

  async analyzeFrame() {
    throw new SpatialScanError('analyzer-not-implemented', 'Spatial scan analyzer is not implemented');
  }
}

/** Deterministic local/CI provider. It never reads or retains the JPEG bytes. */
export class SimulatedSpatialScanAnalyzer extends SpatialScanAnalyzer {
  constructor({ scenario = 'multi', now = () => Date.now() } = {}) {
    super({ source: 'simulated-spatial-analyzer' });
    this.scenario = Object.hasOwn(SCENARIOS, scenario) ? scenario : 'multi';
    this.now = now;
  }

  async analyzeFrame(frame = {}) {
    if (frame.purpose !== 'scan' || !clean(frame.scanId, '', 80)) {
      throw new SpatialScanError('scan-frame-invalid', 'A correlated scan frame is required');
    }
    const candidates = clone(SCENARIOS[this.scenario]);
    return {
      status: candidates.length ? 'ready' : 'empty',
      scanId: clean(frame.scanId, '', 80),
      requestId: clean(frame.requestId, '', 80) || null,
      source: this.source,
      observedAtMs: Math.max(0, Math.trunc(Number(this.now()) || 0)),
      candidates
    };
  }
}

function encodedBytes(dataUrl) {
  const encoded = String(dataUrl || '').split(',', 2)[1] || '';
  if (!encoded) return Number.POSITIVE_INFINITY;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(encoded.length * 3 / 4) - padding);
}

function canvasJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new SpatialScanError('scan-frame-encode-failed', 'The scan frame could not be encoded'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new SpatialScanError('scan-frame-encode-failed', 'The scan frame could not be read'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(blob);
    }, 'image/jpeg', quality);
  });
}

/** Downscale locally before the single provider request; no frame is retained. */
export async function prepareSpatialScanFrame(frame = {}, {
  maximumLongEdge = 1_280,
  maximumBytes = 1024 * 1024
} = {}) {
  if (frame.purpose !== 'scan' || !clean(frame.scanId, '', 80) ||
      !/^data:image\/jpeg;base64,/i.test(String(frame.dataUrl || ''))) {
    throw new SpatialScanError('scan-frame-invalid', 'A correlated JPEG scan frame is required');
  }
  const width = Math.trunc(Number(frame.width));
  const height = Math.trunc(Number(frame.height));
  if (width < 1 || height < 1) throw new SpatialScanError('scan-frame-invalid', 'Scan frame dimensions are invalid');
  const edgeLimit = Math.min(1_280, Math.max(320, Math.trunc(Number(maximumLongEdge) || 1_280)));
  const byteLimit = Math.min(1024 * 1024, Math.max(32 * 1024, Math.trunc(Number(maximumBytes) || 1024 * 1024)));
  if (Math.max(width, height) <= edgeLimit && encodedBytes(frame.dataUrl) <= byteLimit) {
    return { ...frame, width, height };
  }
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    throw new SpatialScanError('scan-frame-resize-unavailable', 'This browser cannot prepare a bounded scan frame');
  }
  const source = await fetch(frame.dataUrl).then((response) => response.blob());
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, edgeLimit / Math.max(bitmap.width, bitmap.height));
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new SpatialScanError('scan-frame-resize-unavailable', 'This browser cannot resize the scan frame');
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    for (const quality of [0.82, 0.68, 0.52]) {
      const dataUrl = await canvasJpeg(canvas, quality);
      if (encodedBytes(dataUrl) <= byteLimit) {
        return { ...frame, dataUrl, width: targetWidth, height: targetHeight, mimeType: 'image/jpeg' };
      }
    }
    throw new SpatialScanError('scan-frame-too-large', 'The scan frame remains too large after local preparation');
  } finally {
    bitmap.close();
  }
}

/** Connected provider backed by the authenticated MXGenius application API. */
export class ConnectedSpatialScanAnalyzer extends SpatialScanAnalyzer {
  constructor({ analyze, sessionId, prepare = prepareSpatialScanFrame } = {}) {
    super({ source: 'mxgenius-spatial-model' });
    if (typeof analyze !== 'function') throw new TypeError('Connected spatial analyzer requires an application scan function');
    this.analyze = analyze;
    this.sessionId = clean(sessionId, '', 128);
    this.prepare = prepare;
  }

  async analyzeFrame(frame = {}) {
    const prepared = await this.prepare(frame);
    const result = await this.analyze({ sessionId: this.sessionId, frame: prepared });
    const status = clean(result?.status, '', 40);
    if (!['ready', 'empty', 'unavailable', 'rate-limited', 'budget-exhausted', 'invalid-image'].includes(status)) {
      throw new SpatialScanError('analyzer-result-invalid', 'Connected analyzer returned an unknown state');
    }
    if (clean(result?.scanId, '', 80) !== clean(frame.scanId, '', 80)) {
      throw new SpatialScanError('scan-correlation', 'Connected analyzer response did not match the scan request');
    }
    return {
      status,
      scanId: result.scanId,
      requestId: clean(result.requestId, '', 80) || null,
      source: clean(result.source, this.source, 120),
      observedAtMs: Math.max(0, Math.trunc(Number(result.observedAtMs) || Date.now())),
      candidates: Array.isArray(result.candidates)
        ? result.candidates.slice(0, SPATIAL_SCAN_POLICY.providerMaximum)
        : [],
      reason: clean(result.reason, '', 240) || null,
      cached: result.cached === true,
      retryAfterMs: Math.max(0, Math.trunc(Number(result.retryAfterMs) || 0)) || null
    };
  }
}

export function normalizeSpatialCandidates(result = {}, {
  registryApi,
  now = () => Date.now(),
  confidenceThreshold = SPATIAL_SCAN_POLICY.confidenceThreshold,
  maximum = SPATIAL_SCAN_POLICY.displayMaximum,
  lifetimeMs = SPATIAL_SCAN_POLICY.candidateLifetimeMs
} = {}) {
  if (!registryApi?.makeTargetId || !registryApi?.normalizeTarget) {
    throw new SpatialScanError('target-registry-unavailable', 'Spatial target registry is unavailable');
  }
  if (!['ready', 'empty'].includes(result?.status)) {
    throw new SpatialScanError('analyzer-result-invalid', 'Analyzer result status must be ready or empty');
  }
  const scanId = clean(result.scanId, '', 80);
  const source = clean(result.source, '', 120);
  if (!scanId || !source) throw new SpatialScanError('analyzer-result-invalid', 'Analyzer result is missing correlation metadata');
  const observedAtMs = Math.max(0, Math.trunc(Number(result.observedAtMs) || Number(now()) || 0));
  const threshold = Math.min(1, Math.max(0, Number(confidenceThreshold) || 0));
  const limit = Math.min(SPATIAL_SCAN_POLICY.displayMaximum, Math.max(0, Math.trunc(Number(maximum) || 0)));
  const ttl = Math.max(1_000, Math.min(60_000, Math.trunc(Number(lifetimeMs) || SPATIAL_SCAN_POLICY.candidateLifetimeMs)));
  const candidates = Array.isArray(result.candidates)
    ? result.candidates.slice(0, SPATIAL_SCAN_POLICY.providerMaximum)
    : [];

  return candidates
    .map((candidate) => {
      const providerId = clean(candidate?.providerId, '', 120);
      const label = clean(candidate?.label, '', 180);
      const confidence = finite(candidate?.confidence);
      const bounds = normalizeBounds(candidate?.bounds);
      if (!providerId || !label || confidence === null || confidence < threshold || confidence > 1 || !bounds) return null;
      const kind = TARGET_KINDS.has(candidate.kind) ? candidate.kind : 'observed-object';
      return registryApi.normalizeTarget({
        targetId: registryApi.makeTargetId('observed-object', scanId, providerId),
        kind,
        label,
        state: 'candidate',
        confidence,
        confidenceBasis: 'detector',
        source,
        targetRevision: 1,
        observedAtMs,
        expiresAtMs: observedAtMs + ttl,
        aliases: normalizeAliases(candidate.aliases),
        anchor: { coordinateFrame: 'screen-normalized', bounds }
      }, { now: observedAtMs });
    })
    .filter(Boolean)
    .sort((left, right) => right.confidence - left.confidence || left.targetId.localeCompare(right.targetId))
    .slice(0, limit);
}

export function applySpatialScanResult(registry, result, options = {}) {
  if (!registry?.snapshot || !registry?.replaceSnapshot) {
    throw new SpatialScanError('target-registry-unavailable', 'Spatial target registry is unavailable');
  }
  const targets = normalizeSpatialCandidates(result, options);
  const source = clean(result.source, '', 120);
  const current = registry.snapshot();
  const retained = current.targets.filter((target) => target.source !== source);
  const combined = [...retained, ...targets]
    .sort((left, right) => {
      if (left.targetId === current.activeTargetId) return -1;
      if (right.targetId === current.activeTargetId) return 1;
      return right.confidence - left.confidence || right.observedAtMs - left.observedAtMs;
    })
    .slice(0, 8);
  const activeTargetId = combined.some((target) => target.targetId === current.activeTargetId)
    ? current.activeTargetId
    : null;
  const replacement = {
    ...current,
    registryRevision: current.registryRevision + 1,
    observedAtMs: Math.max(0, Math.trunc(Number(result.observedAtMs) || Date.now())),
    activeTargetId,
    targets: combined
  };
  const applied = registry.replaceSnapshot(replacement, { reason: 'spatial-scan-applied' });
  if (applied.status !== 'applied') throw new SpatialScanError('target-registry-rejected', `Target registry rejected scan: ${applied.reason}`);
  return {
    status: targets.length ? 'ready' : 'empty',
    count: targets.length,
    scanId: result.scanId,
    source,
    targets
  };
}
