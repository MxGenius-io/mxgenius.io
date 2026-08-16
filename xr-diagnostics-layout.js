const DEFAULT_SCHEMA_URL = '/schemas/edge-diagnostics-1.0.0.json';

function clean(value, fallback = '—') {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

function decodePointerPart(part) {
  return part.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function resolveDiagnosticsPointer(document, pointer) {
  if (!pointer || pointer === '/') return document;
  if (!String(pointer).startsWith('/')) return undefined;
  return String(pointer)
    .split('/')
    .slice(1)
    .map(decodePointerPart)
    .reduce((value, key) => value != null && typeof value === 'object' ? value[key] : undefined, document);
}

export function applyDiagnosticsDelta(state, delta) {
  if (!state || state.sequence !== delta?.baseSequence) return null;
  const next = structuredClone(state);
  for (const operation of delta.operations || []) {
    const parts = String(operation.path || '').split('/').slice(1).map(decodePointerPart);
    if (!parts.length) continue;
    let target = next;
    for (const part of parts.slice(0, -1)) {
      if (!target[part] || typeof target[part] !== 'object') target[part] = {};
      target = target[part];
    }
    const key = parts.at(-1);
    if (operation.op === 'remove') delete target[key];
    else target[key] = operation.value;
  }
  next.sequence = delta.sequence;
  next.observedAtMs = delta.observedAtMs;
  next.sessionId = delta.sessionId;
  return next;
}

function formattedNumber(value, format = 'number', decimals = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (format === 'integer') return Math.round(number).toLocaleString();
  if (format === 'ratio') return number.toFixed(Math.max(0, decimals));
  return number.toFixed(Math.max(0, decimals));
}

function formatMetric(state, spec) {
  const metric = resolveDiagnosticsPointer(state, spec.path);
  const value = metric && typeof metric === 'object' ? metric.value : metric;
  const formatted = formattedNumber(value, spec.format, spec.decimals ?? 1);
  if (formatted === null) return clean(spec.fallback);
  if (spec.format === 'percent') return `${formatted}%`;
  if (spec.format === 'celsius') return `${formatted}°C`;
  if (spec.format === 'ratio') return formatted;
  const unit = clean(spec.unit || (metric && typeof metric === 'object' ? metric.unit : ''), '');
  return unit ? `${formatted} ${unit}` : formatted;
}

export function formatDiagnosticsLayoutRow(row, state = {}) {
  let value = '—';
  if (row.kind === 'value') {
    value = clean(resolveDiagnosticsPointer(state, row.path), row.fallback);
  } else if (row.kind === 'metric') {
    value = formatMetric(state, row);
  } else if (row.kind === 'metric-pair') {
    const separator = typeof row.separator === 'string' ? row.separator : ' · ';
    value = (row.items || []).map((item) => formatMetric(state, item)).join(separator);
  } else if (row.kind === 'collection-status') {
    const collection = resolveDiagnosticsPointer(state, row.path) || {};
    const items = Array.isArray(collection) ? collection : Object.values(collection);
    const online = items.filter((item) => item?.[row.statusProperty || 'status'] === (row.onlineValue || 'online')).length;
    value = items.length ? `${online}/${items.length} ${clean(row.suffix, 'online')}` : clean(row.fallback);
  } else if (row.kind === 'collection-count') {
    const collection = resolveDiagnosticsPointer(state, row.path) || {};
    const items = Array.isArray(collection) ? collection : Object.values(collection);
    const active = row.activeOnly ? items.filter((item) => item?.active !== false) : items;
    value = `${active.length.toLocaleString()} ${clean(row.suffix, 'active')}`;
  }
  return { id: clean(row.id, 'row'), label: clean(row.label, row.id), value: clean(value) };
}

export function formatDiagnosticsLayout(layout, state = {}) {
  return (layout?.panel?.rows || []).slice(0, 8).map((row) => formatDiagnosticsLayoutRow(row, state));
}

export function validateDiagnosticsLayout(layout) {
  if (!layout || layout.version !== 1 || layout.surface !== 'sensor-diagnostics') {
    throw new Error('Unsupported XR diagnostics layout');
  }
  if (!Array.isArray(layout.panel?.rows) || !layout.panel.rows.length) {
    throw new Error('XR diagnostics layout has no rows');
  }
  const ids = new Set();
  for (const row of layout.panel.rows) {
    if (!row.id || !row.label || !row.kind || ids.has(row.id)) throw new Error('XR diagnostics layout row is invalid');
    ids.add(row.id);
  }
  return layout;
}

export async function loadDiagnosticsLayout({ schemaUrl = DEFAULT_SCHEMA_URL, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable for XR diagnostics schema');
  const response = await fetchImpl(schemaUrl, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`XR diagnostics schema request failed (${response.status})`);
  const schema = await response.json();
  return validateDiagnosticsLayout(schema['x-mxg-xr-layout']);
}

export { DEFAULT_SCHEMA_URL };
