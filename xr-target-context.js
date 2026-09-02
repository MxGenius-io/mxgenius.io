/**
 * Canonical, bounded selection state shared by browser, WebXR, and embedded
 * workspaces. Operational records remain authoritative in their own services;
 * this module carries only the user's current navigation/inspection target.
 */
(function mountTargetContext(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MXTargetContext = api;
})(typeof window !== 'undefined' ? window : globalThis, (root) => {
  const STORAGE_KEY = 'mxg_active_target_v1';
  const TARGET_VERSION = 1;
  const listeners = new Set();
  const targetKinds = new Set([
    'aircraft', 'case', 'fleet-location', 'mesh', 'part-unit', 'sensor', 'unknown'
  ]);
  const targetStates = new Set([
    'active', 'candidate', 'confirmed', 'degraded', 'offline', 'ready', 'selected', 'streaming', 'unknown'
  ]);
  const contextFields = Object.freeze({
    aircraftId: ['aircraftId', 'aircraft_id'],
    caseId: ['caseId', 'case_id'],
    city: ['city'],
    componentId: ['componentId', 'component_id'],
    count: ['count'],
    country: ['country'],
    icao: ['icao'],
    location: ['location'],
    manufacturer: ['manufacturer'],
    meshName: ['meshName', 'mesh_name'],
    meshPath: ['meshPath', 'mesh_path', 'path'],
    modelId: ['modelId', 'model_id'],
    modelName: ['modelName', 'model_name'],
    partNumber: ['partNumber', 'part_number'],
    piDiagnostics: ['piDiagnostics', 'pi_diagnostics'],
    serialNumber: ['serialNumber', 'serial_number'],
    sourceStatus: ['sourceStatus', 'source_status'],
    transport: ['transport'],
    version: ['version']
  });
  let current = restore();

  function clean(value, limit = 180) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, limit) : '';
  }

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function scalarContext(input = {}) {
    const output = {};
    Object.entries(contextFields).forEach(([canonical, aliases]) => {
      const key = aliases.find((candidate) => input[candidate] !== undefined && input[candidate] !== null);
      if (!key) return;
      const value = input[key];
      if (typeof value === 'number' && Number.isFinite(value)) output[canonical] = value;
      else if (typeof value === 'boolean') output[canonical] = value;
      else {
        const text = clean(value, canonical === 'meshPath' ? 360 : 180);
        if (text) output[canonical] = text;
      }
    });
    return output;
  }

  function normalizeAnchor(anchor = {}) {
    if (!anchor || typeof anchor !== 'object') return null;
    const type = clean(anchor.type || 'virtual', 40);
    const selector = clean(anchor.selector, 240);
    const objectName = clean(anchor.objectName || anchor.object_name, 180);
    const rawPosition = anchor.position;
    const position = rawPosition && typeof rawPosition === 'object'
      ? ['x', 'y', 'z'].reduce((result, axis) => {
          const value = finite(rawPosition[axis]);
          if (value !== null) result[axis] = value;
          return result;
        }, {})
      : null;
    if (!type && !selector && !objectName && !Object.keys(position || {}).length) return null;
    return { type: type || 'virtual', ...(selector ? { selector } : {}), ...(objectName ? { objectName } : {}), ...(position && Object.keys(position).length ? { position } : {}) };
  }

  function normalize(input = {}) {
    if (!input || typeof input !== 'object') return null;
    const context = scalarContext({ ...(input.context || {}), ...input });
    const proposedKind = clean(input.kind, 40).toLowerCase();
    const kind = targetKinds.has(proposedKind) ? proposedKind : 'unknown';
    const id = clean(
      input.id || context.componentId || context.aircraftId || context.caseId ||
      context.partNumber || context.icao || context.meshPath || context.meshName,
      360
    );
    if (!id) return null;
    const proposedState = clean(input.state || 'selected', 40).toLowerCase();
    const state = targetStates.has(proposedState) ? proposedState : 'unknown';
    const confidenceValue = finite(input.confidence);
    const sources = Array.isArray(input.sources)
      ? input.sources.map((value) => clean(value, 120)).filter(Boolean).slice(0, 8)
      : [];
    return {
      version: TARGET_VERSION,
      kind,
      id,
      label: clean(input.label || id, 180),
      state,
      confidence: confidenceValue === null ? null : Math.min(1, Math.max(0, confidenceValue)),
      surface: clean(input.surface || input.context?.surface || 'browser', 80),
      source: clean(input.source || input.context?.source || 'user-selection', 120),
      context,
      anchor: normalizeAnchor(input.anchor),
      sources,
      updatedAt: new Date().toISOString()
    };
  }

  function fingerprint(target) {
    if (!target) return '';
    const { updatedAt, ...stable } = target;
    return JSON.stringify(stable);
  }

  function persist(target) {
    try {
      if (!root.sessionStorage) return;
      if (target) root.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(target));
      else root.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Selection context must remain usable when storage is unavailable.
    }
  }

  function restore() {
    try {
      if (!root.sessionStorage) return null;
      const raw = root.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return normalize(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  function notify(target, previous, reason) {
    const detail = { target, previous, reason: clean(reason || 'selection-changed', 120) };
    listeners.forEach((listener) => {
      try { listener(detail); } catch (error) { console.warn('Target listener failed:', error); }
    });
    if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
      root.dispatchEvent(new root.CustomEvent('mxgenius:target-changed', { detail }));
      if (!target) root.dispatchEvent(new root.CustomEvent('mxgenius:target-cleared', { detail }));
    }
  }

  function set(input, options = {}) {
    const next = normalize(input);
    if (!next) return null;
    const previous = current;
    if (fingerprint(previous) === fingerprint(next)) return current;
    current = next;
    if (options.persist !== false) persist(current);
    notify(current, previous, options.reason || 'selection-changed');
    return current;
  }

  function matches(expected = {}, target = current) {
    if (!target) return false;
    return (!expected.kind || target.kind === expected.kind)
      && (!expected.id || target.id === String(expected.id));
  }

  function clear(options = {}) {
    if (!current || (options.match && !matches(options.match))) return false;
    const previous = current;
    current = null;
    if (options.persist !== false) persist(null);
    notify(null, previous, options.reason || 'selection-cleared');
    return true;
  }

  function subscribe(listener, options = {}) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    if (options.emitCurrent && current) listener({ target: current, previous: null, reason: 'current-target' });
    return () => listeners.delete(listener);
  }

  function fromPartSelection(detail = {}) {
    const selection = detail.selection || {};
    const model = detail.model || {};
    const context = detail.context || {};
    return normalize({
      kind: 'mesh',
      id: selection.componentId || `${model.id || model.name || 'model'}:${selection.path || selection.meshName || 'mesh'}`,
      label: selection.componentId || selection.meshName || 'Selected component',
      state: ['mapped', 'validated'].includes(selection.mappingStatus) ? 'confirmed' : 'candidate',
      surface: '3d-viewer',
      source: model.operationalStatus || 'model-geometry',
      context: {
        caseId: context.caseId,
        aircraftId: context.aircraftId,
        modelId: model.id,
        modelName: model.name,
        componentId: selection.componentId,
        partNumber: selection.partNumber,
        meshName: selection.meshName,
        meshPath: selection.path
      },
      anchor: { type: 'object3d', objectName: selection.meshName },
      sources: ['MODEL GEOMETRY', selection.componentId ? 'COMPONENT MAP' : 'UNMAPPED SELECTION']
    });
  }

  function fromPartUnit(detail = {}) {
    const unit = detail.unit || detail;
    return normalize({
      kind: 'part-unit',
      id: unit.id,
      label: [unit.partNumber, unit.serialNumber].filter(Boolean).join(' · ') || 'Controlled part unit',
      state: unit.status === 'available' ? 'ready' : 'selected',
      surface: 'parts',
      source: 'controlled-inventory',
      context: {
        partNumber: unit.partNumber,
        serialNumber: unit.serialNumber,
        manufacturer: unit.manufacturer,
        location: unit.location,
        version: unit.version
      },
      anchor: { type: 'dom', selector: '#partsDrawer' },
      sources: ['CONTROLLED UNIT', 'INVENTORY LEDGER']
    });
  }

  function fromXRAction(detail = {}) {
    const target = detail.target || {};
    const context = detail.context || {};
    if (detail.action === 'open-fleet-location') {
      return normalize({
        kind: 'fleet-location',
        id: target.icao || target.index,
        label: [target.icao, target.city, target.country].filter(Boolean).join(' · '),
        state: 'selected',
        surface: context.surface || 'fleet-globe',
        source: 'fleet-context',
        context: target,
        anchor: { type: 'object3d', objectName: `fleet-location-${target.index ?? target.icao}` },
        sources: ['JETNET FLEET CONTEXT']
      });
    }
    if (detail.action === 'sensor-status') {
      return normalize({
        kind: 'sensor',
        id: 'thermal-source',
        label: 'FLIR thermal source',
        state: target.current === 'connected' ? 'streaming' : target.current === 'offline' ? 'offline' : 'degraded',
        surface: context.surface || 'sensor-diagnostics',
        source: 'sensor-bridge',
        context: { transport: target.current, sourceStatus: target.source },
        anchor: { type: 'object3d', objectName: 'SensorDiagnosticsSurface' },
        sources: ['THERMAL TRANSPORT', 'SENSOR DIAGNOSTICS']
      });
    }
    return null;
  }

  function ingestXRAction(detail, options = {}) {
    const target = fromXRAction(detail);
    return target ? set(target, { ...options, reason: options.reason || `xr:${detail.action}` }) : null;
  }

  function guideId(target = current) {
    if (!target) return 'model-context';
    if (target.kind === 'fleet-location' || target.kind === 'aircraft') return 'fleet-location-data';
    if (target.kind === 'mesh') return 'mesh-inspection';
    if (target.kind === 'part-unit') return 'parts-management';
    if (target.kind === 'sensor') return target.state === 'streaming' ? 'sensor-diagnostics' : 'sensor-bridge-flow';
    if (target.kind === 'case') return 'maintenance-case';
    return 'model-context';
  }

  return Object.freeze({
    STORAGE_KEY,
    TARGET_VERSION,
    normalize,
    set,
    get: () => current,
    clear,
    matches,
    subscribe,
    fromPartSelection,
    fromPartUnit,
    fromXRAction,
    ingestXRAction,
    guideId
  });
});
