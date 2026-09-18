(function initSpatialContext(global) {
  'use strict';

  const VERSION = 2;
  const STORAGE_KEY = 'mxg_spatial_context_v2';
  const LEGACY_KEY = 'mxg_spatial_context_v1';
  const MODES = new Set(['operations', 'maintenance']);
  const MAX_REFS = 24;

  function text(value, max = 240) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null;
  }

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function identity(value, extra = {}) {
    if (!value || typeof value !== 'object') return null;
    const normalized = {
      id: text(value.id ?? value.aircraftId ?? value.caseId ?? value.componentId ?? value.partId ?? value.locationId, 160),
      revision: text(value.revision ?? value.version, 120),
      ...extra
    };
    return Object.values(normalized).some((entry) => entry !== null && entry !== undefined) ? normalized : null;
  }

  function references(values) {
    if (!Array.isArray(values)) return [];
    return values.slice(0, MAX_REFS).map((value) => {
      if (typeof value === 'string') return { id: text(value, 200) };
      return identity(value, {
        kind: text(value?.kind, 80),
        label: text(value?.label, 200)
      });
    }).filter((value) => value?.id);
  }

  function normalize(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const aircraftSource = source.aircraft || { id: source.aircraftId, registration: source.registration };
    const caseSource = source.case || { id: source.caseId };
    const componentSource = source.component || {
      id: source.componentId,
      meshName: source.meshName,
      path: source.componentPath
    };
    const partSource = source.part || { id: source.partId, partNumber: source.partNumber, requestId: source.requestId };
    const locationSource = source.location && typeof source.location === 'object'
      ? source.location
      : { id: source.locationId, icao: typeof source.location === 'string' ? source.location : source.icao };
    return {
      version: VERSION,
      source: text(source.source ?? source.spatialSource, 100) || 'dashboard',
      mode: MODES.has(source.mode) ? source.mode : 'maintenance',
      tenantId: text(source.tenantId, 160),
      organizationId: text(source.organizationId, 160),
      aircraft: identity(aircraftSource, {
        registration: text(aircraftSource?.registration ?? aircraftSource?.regnbr, 80),
        family: text(aircraftSource?.family ?? aircraftSource?.model, 160)
      }),
      case: identity(caseSource),
      component: identity(componentSource, {
        meshName: text(componentSource?.meshName ?? componentSource?.name, 240),
        path: text(componentSource?.path, 500)
      }),
      part: identity(partSource, {
        partNumber: text(partSource?.partNumber, 160),
        requestId: text(partSource?.requestId, 160)
      }),
      location: identity(locationSource, {
        icao: text(locationSource?.icao, 12)?.toUpperCase() || null,
        latitude: finite(locationSource?.latitude ?? locationSource?.lat),
        longitude: finite(locationSource?.longitude ?? locationSource?.lng)
      }),
      evidenceRefs: references(source.evidenceRefs),
      manualRefs: references(source.manualRefs),
      updatedAt: text(source.updatedAt, 40) || new Date().toISOString()
    };
  }

  function assertTenantBoundary(current, next) {
    if (current?.tenantId && next?.tenantId && current.tenantId !== next.tenantId) {
      throw new Error('Spatial context cannot cross tenant boundaries');
    }
    if (current?.organizationId && next?.organizationId && current.organizationId !== next.organizationId) {
      throw new Error('Spatial context cannot cross organization boundaries');
    }
  }

  function merge(current = {}, update = {}) {
    const left = normalize(current);
    const right = normalize({ ...left, ...update });
    assertTenantBoundary(left, right);
    for (const key of ['aircraft', 'case', 'component', 'part', 'location']) {
      if (Object.prototype.hasOwnProperty.call(update, key)) {
        const candidate = update[key] === null ? null : { ...(left[key] || {}), ...(update[key] || {}) };
        right[key] = candidate ? normalize({ [key]: candidate })[key] : null;
      }
      else right[key] = left[key];
    }
    if (!Object.prototype.hasOwnProperty.call(update, 'evidenceRefs')) right.evidenceRefs = left.evidenceRefs;
    if (!Object.prototype.hasOwnProperty.call(update, 'manualRefs')) right.manualRefs = left.manualRefs;
    right.updatedAt = new Date().toISOString();
    return right;
  }

  function storage(candidate) {
    return candidate || global.sessionStorage;
  }

  function read(candidate) {
    const target = storage(candidate);
    try {
      const current = JSON.parse(target?.getItem?.(STORAGE_KEY) || 'null');
      if (current?.version === VERSION) return normalize(current);
      const legacy = JSON.parse(target?.getItem?.(LEGACY_KEY) || 'null');
      return legacy?.version === 1 ? normalize(legacy) : normalize();
    } catch {
      return normalize();
    }
  }

  function write(value, candidate) {
    const target = storage(candidate);
    const normalized = normalize(value);
    target?.setItem?.(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function update(value, candidate) {
    return write(merge(read(candidate), value), candidate);
  }

  function clear(candidate) {
    const target = storage(candidate);
    target?.removeItem?.(STORAGE_KEY);
    target?.removeItem?.(LEGACY_KEY);
  }

  global.MXSpatialContext = Object.freeze({
    VERSION,
    STORAGE_KEY,
    normalize,
    merge,
    read,
    write,
    update,
    clear
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
