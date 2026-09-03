/**
 * Compatibility facade for the original single-selection API. New code should
 * use MXTargetRegistry; existing callers keep their current shape and events.
 */
(function mountTargetContext(root, factory) {
  const registryApi = root.MXTargetRegistry || (
    typeof module === 'object' && module.exports ? require('./xr-target-registry.js') : null
  );
  const api = factory(root, registryApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MXTargetContext = api;
})(typeof window !== 'undefined' ? window : globalThis, (root, registryApi) => {
  const STORAGE_KEY = 'mxg_active_target_v1';
  const TARGET_VERSION = 1;
  const listeners = new Set();
  const legacyByTargetId = new Map();
  const registry = registryApi?.defaultRegistry || registryApi?.create?.({ root });
  const targetKinds = new Set(['aircraft', 'case', 'fleet-location', 'mesh', 'part-unit', 'sensor', 'unknown']);
  const targetStates = new Set(['active', 'candidate', 'confirmed', 'degraded', 'offline', 'ready', 'selected', 'streaming', 'unknown']);
  const contextFields = Object.freeze({
    aircraftId: ['aircraftId', 'aircraft_id'], caseId: ['caseId', 'case_id'], city: ['city'],
    componentId: ['componentId', 'component_id'], count: ['count'], country: ['country'], icao: ['icao'],
    location: ['location'], manufacturer: ['manufacturer'], meshName: ['meshName', 'mesh_name'],
    meshPath: ['meshPath', 'mesh_path', 'path'], modelId: ['modelId', 'model_id'], modelName: ['modelName', 'model_name'],
    partNumber: ['partNumber', 'part_number'], piDiagnostics: ['piDiagnostics', 'pi_diagnostics'],
    serialNumber: ['serialNumber', 'serial_number'], sourceStatus: ['sourceStatus', 'source_status'],
    transport: ['transport'], version: ['version']
  });
  let current = null;
  let skipLegacyPersistence = 0;

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
    const id = clean(input.id || context.componentId || context.aircraftId || context.caseId || context.partNumber || context.icao || context.meshPath || context.meshName, 360);
    if (!id) return null;
    const proposedState = clean(input.state || 'selected', 40).toLowerCase();
    const state = targetStates.has(proposedState) ? proposedState : 'unknown';
    const confidenceValue = finite(input.confidence);
    const sources = Array.isArray(input.sources) ? input.sources.map((value) => clean(value, 120)).filter(Boolean).slice(0, 8) : [];
    return {
      version: TARGET_VERSION, kind, id, label: clean(input.label || id, 180), state,
      confidence: confidenceValue === null ? null : Math.min(1, Math.max(0, confidenceValue)),
      surface: clean(input.surface || input.context?.surface || 'browser', 80),
      source: clean(input.source || input.context?.source || 'user-selection', 120),
      context, anchor: normalizeAnchor(input.anchor), sources, updatedAt: new Date().toISOString()
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

  function restoreLegacy() {
    try {
      if (!root.sessionStorage) return null;
      const raw = root.sessionStorage.getItem(STORAGE_KEY);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  function aliasValues(target) {
    const context = target.context || {};
    return {
      aircraftId: context.aircraftId || (target.kind === 'aircraft' ? target.id : undefined),
      caseId: context.caseId || (target.kind === 'case' ? target.id : undefined),
      componentId: context.componentId || (target.kind === 'mesh' ? target.id : undefined),
      icao: context.icao || (target.kind === 'fleet-location' ? target.id : undefined),
      meshId: context.meshName,
      meshPath: context.meshPath,
      modelId: context.modelId,
      partNumber: context.partNumber,
      serialNumber: context.serialNumber
    };
  }

  function canonicalKind(kind) {
    return kind === 'unknown' ? 'observed-object' : kind;
  }

  function confidenceBasis(target) {
    if (target.kind === 'mesh') return 'mapped-geometry';
    if (['aircraft', 'case', 'fleet-location', 'part-unit'].includes(target.kind)) return 'deterministic-lookup';
    if (target.state === 'candidate') return 'detector';
    return 'user';
  }

  function canonicalAnchor(anchor) {
    if (!anchor) return { coordinateFrame: 'dom' };
    const coordinateFrame = anchor.type === 'object3d' ? 'model-local' : anchor.type === 'dom' ? 'dom' : anchor.position ? 'xr-local' : 'dom';
    const position = anchor.position && ['x', 'y', 'z'].every((axis) => Number.isFinite(Number(anchor.position[axis])))
      ? { x: Number(anchor.position.x), y: Number(anchor.position.y), z: Number(anchor.position.z) }
      : null;
    return {
      coordinateFrame,
      ...(anchor.selector ? { selector: anchor.selector } : {}),
      ...(anchor.objectName ? { objectName: anchor.objectName } : {}),
      ...(position ? { pose: { position, quaternion: { x: 0, y: 0, z: 0, w: 1 } } } : {})
    };
  }

  function targetIdentity(target) {
    if (registryApi?.TARGET_ID_PATTERN?.test(target.id)) return target.id;
    const context = target.context || {};
    if (target.kind === 'mesh') {
      return registryApi?.makeTargetId('mesh', context.modelId || context.modelName || 'model', context.componentId || context.meshPath || target.id);
    }
    return registryApi?.makeTargetId(canonicalKind(target.kind), target.id);
  }

  function toCanonical(target) {
    const observedAtMs = Date.parse(target.updatedAt) || Date.now();
    return registryApi?.normalizeTarget({
      targetId: targetIdentity(target), kind: canonicalKind(target.kind), label: target.label, state: 'locked',
      confidence: target.confidence ?? 1, confidenceBasis: confidenceBasis(target),
      source: target.source || 'user-selection', targetRevision: 1, observedAtMs,
      // Existing explicit selections lived for the browser session. Preserve
      // that behavior; scan candidates receive short TTLs at their producer.
      expiresAtMs: Number.MAX_SAFE_INTEGER,
      aliases: aliasValues(target), anchor: canonicalAnchor(target.anchor)
    }, { now: observedAtMs });
  }

  function fromCanonical(target) {
    if (!target) return null;
    const cached = legacyByTargetId.get(target.targetId);
    if (cached) return { ...cached, updatedAt: new Date(target.observedAtMs).toISOString() };
    const aliases = target.aliases || {};
    const legacyKind = target.kind === 'observed-object' ? 'unknown' : target.kind;
    const state = target.state === 'locked' ? 'selected' : target.state === 'lost' ? 'offline' : target.state;
    const anchor = target.anchor?.coordinateFrame === 'model-local'
      ? { type: 'object3d', ...(target.anchor.objectName ? { objectName: target.anchor.objectName } : {}) }
      : { type: target.anchor?.coordinateFrame === 'dom' ? 'dom' : 'virtual', ...(target.anchor?.selector ? { selector: target.anchor.selector } : {}) };
    return normalize({
      kind: legacyKind,
      id: aliases.componentId || aliases.aircraftId || aliases.caseId || aliases.serialNumber || aliases.partNumber || aliases.icao || target.targetId,
      label: target.label, state, confidence: target.confidence, source: target.source, context: aliases, anchor
    });
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
    if (!next || !registry) return null;
    if (fingerprint(current) === fingerprint(next)) return current;
    const canonical = toCanonical(next);
    if (!canonical) return null;
    legacyByTargetId.set(canonical.targetId, next);
    if (options.persist !== false) persist(next);
    if (options.persist === false) skipLegacyPersistence += 1;
    try {
      registry.upsert(canonical, { activate: true, persist: options.persist, reason: options.reason || 'selection-changed' });
    } finally {
      if (options.persist === false) skipLegacyPersistence -= 1;
    }
    return current;
  }

  function get() {
    const active = registry?.getActive?.() || null;
    if (!active) current = null;
    else if (!current || targetIdentity(current) !== active.targetId) current = fromCanonical(active);
    return current;
  }

  function matches(expected = {}, target = get()) {
    if (!target) return false;
    return (!expected.kind || target.kind === expected.kind) && (!expected.id || target.id === String(expected.id));
  }

  function clear(options = {}) {
    if (!get() || (options.match && !matches(options.match))) return false;
    if (options.persist !== false) persist(null);
    if (options.persist === false) skipLegacyPersistence += 1;
    try {
      return registry.clear({ persist: options.persist, reason: options.reason || 'selection-cleared' });
    } finally {
      if (options.persist === false) skipLegacyPersistence -= 1;
    }
  }

  function subscribe(listener, options = {}) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    if (options.emitCurrent && get()) listener({ target: current, previous: null, reason: 'current-target' });
    return () => listeners.delete(listener);
  }

  function fromPartSelection(detail = {}) {
    const selection = detail.selection || {};
    const model = detail.model || {};
    const context = detail.context || {};
    return normalize({
      kind: 'mesh', id: selection.componentId || `${model.id || model.name || 'model'}:${selection.path || selection.meshName || 'mesh'}`,
      label: selection.componentId || selection.meshName || 'Selected component',
      state: ['mapped', 'validated'].includes(selection.mappingStatus) ? 'confirmed' : 'candidate',
      surface: '3d-viewer', source: model.operationalStatus || 'model-geometry',
      context: { caseId: context.caseId, aircraftId: context.aircraftId, modelId: model.id, modelName: model.name,
        componentId: selection.componentId, partNumber: selection.partNumber, meshName: selection.meshName, meshPath: selection.path },
      anchor: { type: 'object3d', objectName: selection.meshName },
      sources: ['MODEL GEOMETRY', selection.componentId ? 'COMPONENT MAP' : 'UNMAPPED SELECTION']
    });
  }

  function fromPartUnit(detail = {}) {
    const unit = detail.unit || detail;
    return normalize({
      kind: 'part-unit', id: unit.id,
      label: [unit.partNumber, unit.serialNumber].filter(Boolean).join(' · ') || 'Controlled part unit',
      state: unit.status === 'available' ? 'ready' : 'selected', surface: 'parts', source: 'controlled-inventory',
      context: { partNumber: unit.partNumber, serialNumber: unit.serialNumber, manufacturer: unit.manufacturer,
        location: unit.location, version: unit.version },
      anchor: { type: 'dom', selector: '#partsDrawer' }, sources: ['CONTROLLED UNIT', 'INVENTORY LEDGER']
    });
  }

  function fromXRAction(detail = {}) {
    const target = detail.target || {};
    const context = detail.context || {};
    if (detail.action === 'open-fleet-location') {
      return normalize({
        kind: 'fleet-location', id: target.icao || target.index,
        label: [target.icao, target.city, target.country].filter(Boolean).join(' · '), state: 'selected',
        surface: context.surface || 'fleet-globe', source: 'fleet-context', context: target,
        anchor: { type: 'object3d', objectName: `fleet-location-${target.index ?? target.icao}` },
        sources: ['JETNET FLEET CONTEXT']
      });
    }
    if (detail.action === 'sensor-status') {
      return normalize({
        kind: 'sensor', id: 'thermal-source', label: 'FLIR thermal source',
        state: target.current === 'connected' ? 'streaming' : target.current === 'offline' ? 'offline' : 'degraded',
        surface: context.surface || 'sensor-diagnostics', source: 'sensor-bridge',
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

  function guideId(target = get()) {
    if (!target) return 'model-context';
    if (target.kind === 'fleet-location' || target.kind === 'aircraft') return 'fleet-location-data';
    if (target.kind === 'mesh') return 'mesh-inspection';
    if (target.kind === 'part-unit') return 'parts-management';
    if (target.kind === 'sensor') return target.state === 'streaming' ? 'sensor-diagnostics' : 'sensor-bridge-flow';
    if (target.kind === 'case') return 'maintenance-case';
    return 'model-context';
  }

  if (registry) {
    const active = registry.getActive();
    if (active) current = fromCanonical(active);
    else {
      const restored = restoreLegacy();
      if (restored) {
        const canonical = toCanonical(restored);
        if (canonical) {
          legacyByTargetId.set(canonical.targetId, restored);
          registry.upsert(canonical, { activate: true, silent: true, reason: 'legacy-target-migrated' });
          current = restored;
        }
      }
    }
    registry.subscribe((detail) => {
      const previous = current;
      const next = fromCanonical(detail.activeTarget);
      if (fingerprint(previous) === fingerprint(next)) return;
      current = next;
      if (!skipLegacyPersistence) persist(current);
      notify(current, previous, detail.reason);
    });
  }

  return Object.freeze({
    STORAGE_KEY, TARGET_VERSION, registry, normalize, set, get, clear, matches, subscribe,
    fromPartSelection, fromPartUnit, fromXRAction, ingestXRAction, guideId
  });
});
