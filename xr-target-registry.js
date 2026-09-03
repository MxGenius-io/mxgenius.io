/**
 * Bounded spatial target state shared by browser, WebXR, and native adapters.
 * The registry owns identity, revisions, expiry, and the single active lock.
 */
(function mountTargetRegistry(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MXTargetRegistry = api;
})(typeof window !== 'undefined' ? window : globalThis, (root) => {
  const STORAGE_KEY = 'mxg_target_registry_v1';
  const SCHEMA = 'mxg.spatial.targets';
  const SCHEMA_VERSION = '1.0.0';
  const MAX_TARGETS = 8;
  const MODEL_PROJECTION_MAX = 3;
  const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
  const TARGET_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}:[A-Za-z0-9._:-]{1,240}$/;
  const targetKinds = new Set([
    'aircraft', 'case', 'component', 'mesh', 'part-unit', 'sensor',
    'fleet-location', 'observed-object'
  ]);
  const targetStates = new Set(['candidate', 'locked', 'lost', 'cleared']);
  const confidenceBases = new Set(['detector', 'mapped-geometry', 'deterministic-lookup', 'user']);
  const coordinateFrames = new Set([
    'screen-normalized', 'model-local', 'xr-local', 'ar-world', 'geographic', 'dom'
  ]);
  const aliasFields = Object.freeze([
    'aircraftId', 'caseId', 'componentId', 'icao', 'meshId', 'meshPath',
    'modelId', 'partNumber', 'serialNumber', 'zoneId'
  ]);
  const namespaces = Object.freeze({
    aircraft: 'aircraft',
    case: 'case',
    component: 'component',
    mesh: 'mesh',
    'part-unit': 'part',
    sensor: 'sensor',
    'fleet-location': 'fleet',
    'observed-object': 'observation'
  });

  function clean(value, limit = 180) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, limit) : '';
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, number(value, min)));
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function fnv1a(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  }

  function idSegment(value) {
    const raw = clean(value, 600);
    if (!raw) return '';
    const safe = raw.replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
    const changed = safe !== raw || safe.length > 180;
    const base = (safe || 'target').slice(0, changed ? 168 : 180);
    return changed ? `${base}-${fnv1a(raw)}` : base;
  }

  function makeTargetId(kind, primary, secondary) {
    const canonicalKind = targetKinds.has(kind) ? kind : 'observed-object';
    const namespace = namespaces[canonicalKind];
    const parts = [primary, secondary].map(idSegment).filter(Boolean);
    if (!parts.length) return '';
    return `${namespace}:${parts.join(':')}`.slice(0, 273);
  }

  function makeSessionId() {
    if (root.crypto?.randomUUID) return `spatial-${root.crypto.randomUUID()}`;
    return `spatial-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function normalizeSessionId(value) {
    const proposed = clean(value, 128);
    return SESSION_ID_PATTERN.test(proposed) ? proposed : makeSessionId();
  }

  function normalizeAliases(input = {}) {
    const aliases = {};
    aliasFields.forEach((field) => {
      const value = clean(input[field], field === 'meshPath' ? 360 : field === 'icao' ? 16 : 180);
      if (value) aliases[field] = value;
    });
    return aliases;
  }

  function normalizeBounds(input) {
    if (!input || typeof input !== 'object') return null;
    const bounds = {
      x: clamp(input.x, 0, 1),
      y: clamp(input.y, 0, 1),
      width: clamp(input.width, Number.EPSILON, 1),
      height: clamp(input.height, Number.EPSILON, 1)
    };
    bounds.width = Math.min(bounds.width, 1 - bounds.x || 1);
    bounds.height = Math.min(bounds.height, 1 - bounds.y || 1);
    return bounds;
  }

  function normalizePosition(input) {
    if (!input || typeof input !== 'object') return null;
    if (!['x', 'y', 'z'].every((axis) => Number.isFinite(Number(input[axis])))) return null;
    return { x: Number(input.x), y: Number(input.y), z: Number(input.z) };
  }

  function normalizeQuaternion(input) {
    if (!input || typeof input !== 'object') return null;
    if (!['x', 'y', 'z', 'w'].every((axis) => Number.isFinite(Number(input[axis])))) return null;
    return { x: Number(input.x), y: Number(input.y), z: Number(input.z), w: Number(input.w) };
  }

  function normalizeAnchor(input = {}) {
    const frame = coordinateFrames.has(input.coordinateFrame) ? input.coordinateFrame : 'dom';
    const bounds = normalizeBounds(input.bounds);
    const position = normalizePosition(input.pose?.position);
    const quaternion = normalizeQuaternion(input.pose?.quaternion);
    const selector = clean(input.selector, 240);
    const objectName = clean(input.objectName, 180);
    return {
      coordinateFrame: frame,
      ...(bounds ? { bounds } : {}),
      ...(position && quaternion ? { pose: { position, quaternion } } : {}),
      ...(selector ? { selector } : {}),
      ...(objectName ? { objectName } : {})
    };
  }

  function isCanonicalTarget(input) {
    if (!input || typeof input !== 'object') return false;
    const required = ['targetId', 'kind', 'label', 'state', 'confidence', 'confidenceBasis', 'source', 'targetRevision', 'observedAtMs', 'expiresAtMs', 'aliases', 'anchor'];
    if (!required.every((field) => Object.hasOwn(input, field))) return false;
    if (Object.keys(input).some((field) => !required.includes(field))) return false;
    if (!TARGET_ID_PATTERN.test(input.targetId) || !targetKinds.has(input.kind) || !targetStates.has(input.state)) return false;
    if (!confidenceBases.has(input.confidenceBasis) || typeof input.confidence !== 'number' || input.confidence < 0 || input.confidence > 1) return false;
    if (!clean(input.label, 180) || clean(input.label, 181).length > 180 || !clean(input.source, 120) || clean(input.source, 121).length > 120) return false;
    if (!Number.isInteger(input.targetRevision) || input.targetRevision < 1 || !Number.isInteger(input.observedAtMs) || input.observedAtMs < 0) return false;
    if (!Number.isInteger(input.expiresAtMs) || input.expiresAtMs < input.observedAtMs) return false;
    if (!input.aliases || typeof input.aliases !== 'object' || Array.isArray(input.aliases)) return false;
    if (Object.keys(input.aliases).length > 10 || Object.keys(input.aliases).some((field) => !aliasFields.includes(field))) return false;
    if (Object.entries(input.aliases).some(([field, value]) => {
      const limit = field === 'meshPath' ? 360 : field === 'icao' ? 16 : 180;
      return typeof value !== 'string' || !value.length || value.length > limit;
    })) return false;
    if (!input.anchor || typeof input.anchor !== 'object' || Array.isArray(input.anchor)) return false;
    if (!coordinateFrames.has(input.anchor.coordinateFrame)) return false;
    if (Object.keys(input.anchor).some((field) => !['coordinateFrame', 'bounds', 'pose', 'selector', 'objectName'].includes(field))) return false;
    if (input.anchor.selector !== undefined && (typeof input.anchor.selector !== 'string' || !input.anchor.selector.length || input.anchor.selector.length > 240)) return false;
    if (input.anchor.objectName !== undefined && (typeof input.anchor.objectName !== 'string' || !input.anchor.objectName.length || input.anchor.objectName.length > 180)) return false;
    if (input.anchor.bounds !== undefined) {
      const bounds = input.anchor.bounds;
      if (!bounds || typeof bounds !== 'object' || Object.keys(bounds).sort().join(',') !== 'height,width,x,y') return false;
      if (!['x', 'y', 'width', 'height'].every((field) => typeof bounds[field] === 'number' && Number.isFinite(bounds[field]))) return false;
      if (bounds.x < 0 || bounds.x > 1 || bounds.y < 0 || bounds.y > 1 || bounds.width <= 0 || bounds.width > 1 || bounds.height <= 0 || bounds.height > 1) return false;
    }
    if (input.anchor.pose !== undefined) {
      const pose = input.anchor.pose;
      if (!pose || typeof pose !== 'object' || Object.keys(pose).sort().join(',') !== 'position,quaternion') return false;
      const position = pose.position;
      const quaternion = pose.quaternion;
      if (!position || Object.keys(position).sort().join(',') !== 'x,y,z' || !['x', 'y', 'z'].every((axis) => Number.isFinite(position[axis]))) return false;
      if (!quaternion || Object.keys(quaternion).sort().join(',') !== 'w,x,y,z' || !['x', 'y', 'z', 'w'].every((axis) => Number.isFinite(quaternion[axis]))) return false;
    }
    return true;
  }

  function normalizeTarget(input = {}, options = {}) {
    if (!input || typeof input !== 'object') return null;
    if (options.strict && !isCanonicalTarget(input)) return null;
    const now = Math.max(0, Math.trunc(number(options.now, Date.now())));
    const kind = targetKinds.has(input.kind) ? input.kind : 'observed-object';
    const aliases = normalizeAliases(input.aliases || {});
    const fallbackIdentity = aliases.componentId || aliases.aircraftId || aliases.caseId ||
      aliases.serialNumber || aliases.partNumber || aliases.icao || aliases.meshPath || aliases.meshId;
    const proposedId = clean(input.targetId, 273);
    const targetId = TARGET_ID_PATTERN.test(proposedId)
      ? proposedId
      : makeTargetId(kind, proposedId || fallbackIdentity || input.label);
    if (!TARGET_ID_PATTERN.test(targetId)) return null;
    const state = targetStates.has(input.state) ? input.state : 'candidate';
    const observedAtMs = Math.max(0, Math.trunc(number(input.observedAtMs, now)));
    const expiresAtMs = Math.max(observedAtMs, Math.trunc(number(input.expiresAtMs, now + 15_000)));
    return {
      targetId,
      kind,
      label: clean(input.label || targetId, 180),
      state,
      confidence: clamp(input.confidence, 0, 1),
      confidenceBasis: confidenceBases.has(input.confidenceBasis) ? input.confidenceBasis : 'user',
      source: clean(input.source || 'target-registry', 120),
      targetRevision: Math.max(1, Math.trunc(number(input.targetRevision, 1))),
      observedAtMs,
      expiresAtMs,
      aliases,
      anchor: normalizeAnchor(input.anchor)
    };
  }

  class Registry {
    constructor(options = {}) {
      this.root = options.root || root;
      if (options.storage !== undefined) this.storage = options.storage;
      else {
        try { this.storage = this.root.sessionStorage; } catch { this.storage = null; }
      }
      this.now = typeof options.now === 'function' ? options.now : () => Date.now();
      this.storageKey = options.storageKey || STORAGE_KEY;
      this.listeners = new Set();
      this.targets = new Map();
      this.retiredSessionIds = new Set();
      this.sessionId = normalizeSessionId(options.sessionId || makeSessionId());
      this.registryRevision = 1;
      this.observedAtMs = Math.max(0, Math.trunc(this.now()));
      this.activeTargetId = null;
      if (options.restore !== false) this.restore();
    }

    snapshot(options = {}) {
      if (options.expire !== false) this.expire({ reason: 'target-expired' });
      return {
        type: 'spatial.targets.state',
        schema: SCHEMA,
        schemaVersion: SCHEMA_VERSION,
        sessionId: this.sessionId,
        registryRevision: this.registryRevision,
        observedAtMs: this.observedAtMs,
        activeTargetId: this.activeTargetId,
        targets: Array.from(this.targets.values(), clone)
      };
    }

    get(targetId) {
      this.expire({ reason: 'target-expired' });
      return clone(this.targets.get(String(targetId)) || null);
    }

    getActive() {
      this.expire({ reason: 'target-expired' });
      return clone(this.activeTargetId ? this.targets.get(this.activeTargetId) || null : null);
    }

    upsert(input, options = {}) {
      const now = Math.max(0, Math.trunc(this.now()));
      const normalized = normalizeTarget(input, { now });
      if (!normalized) return null;
      const previousActive = this.activeTargetId ? clone(this.targets.get(this.activeTargetId)) : null;
      const existing = this.targets.get(normalized.targetId);
      normalized.targetRevision = existing ? existing.targetRevision + 1 : normalized.targetRevision;

      if (options.activate) {
        for (const [targetId, target] of this.targets) {
          if (targetId !== normalized.targetId && target.state === 'locked') {
            this.targets.set(targetId, { ...target, state: 'candidate', targetRevision: target.targetRevision + 1 });
          }
        }
        normalized.state = 'locked';
        this.activeTargetId = normalized.targetId;
      } else if (this.activeTargetId === normalized.targetId && normalized.state !== 'locked') {
        this.activeTargetId = null;
      } else if (!this.activeTargetId && normalized.state === 'locked') {
        this.activeTargetId = normalized.targetId;
      }

      this.targets.set(normalized.targetId, normalized);
      this.trim();
      this.commit(options.reason || (existing ? 'target-updated' : 'target-added'), previousActive, options);
      return clone(normalized);
    }

    lock(targetId, options = {}) {
      this.expire({ reason: 'target-expired' });
      const selected = this.targets.get(String(targetId));
      if (!selected || selected.state === 'lost' || selected.state === 'cleared') return null;
      const previousActive = this.activeTargetId ? clone(this.targets.get(this.activeTargetId)) : null;
      for (const [id, target] of this.targets) {
        const shouldLock = id === selected.targetId;
        if ((shouldLock && target.state !== 'locked') || (!shouldLock && target.state === 'locked')) {
          this.targets.set(id, {
            ...target,
            state: shouldLock ? 'locked' : 'candidate',
            targetRevision: target.targetRevision + 1
          });
        }
      }
      this.activeTargetId = selected.targetId;
      this.commit(options.reason || 'target-locked', previousActive, options);
      return this.getActive();
    }

    remove(targetId, options = {}) {
      const id = String(targetId);
      if (!this.targets.has(id)) return false;
      const previousActive = this.activeTargetId ? clone(this.targets.get(this.activeTargetId)) : null;
      this.targets.delete(id);
      if (this.activeTargetId === id) this.activeTargetId = null;
      this.commit(options.reason || 'target-removed', previousActive, options);
      return true;
    }

    clear(options = {}) {
      if (!this.activeTargetId) return false;
      const previousActive = clone(this.targets.get(this.activeTargetId));
      if (options.remove) this.targets.delete(this.activeTargetId);
      else {
        const target = this.targets.get(this.activeTargetId);
        if (target) this.targets.set(target.targetId, { ...target, state: 'cleared', targetRevision: target.targetRevision + 1 });
      }
      this.activeTargetId = null;
      this.commit(options.reason || 'target-cleared', previousActive, options);
      return true;
    }

    expire(options = {}) {
      const now = Math.max(0, Math.trunc(this.now()));
      const expired = Array.from(this.targets.values()).filter((target) => target.expiresAtMs <= now);
      if (!expired.length) return [];
      const previousActive = this.activeTargetId ? clone(this.targets.get(this.activeTargetId)) : null;
      expired.forEach((target) => this.targets.delete(target.targetId));
      if (this.activeTargetId && !this.targets.has(this.activeTargetId)) this.activeTargetId = null;
      this.commit(options.reason || 'targets-expired', previousActive, options);
      return expired.map((target) => target.targetId);
    }

    applyDelta(delta, options = {}) {
      if (!delta || delta.type !== 'spatial.targets.delta' || delta.schema !== SCHEMA || delta.schemaVersion !== SCHEMA_VERSION) {
        return { status: 'rejected', reason: 'invalid-delta', registryRevision: this.registryRevision };
      }
      const deltaFields = ['type', 'schema', 'schemaVersion', 'sessionId', 'baseRevision', 'registryRevision', 'observedAtMs', 'operations'];
      if (Object.keys(delta).some((field) => !deltaFields.includes(field)) ||
          !SESSION_ID_PATTERN.test(delta.sessionId) || !Number.isInteger(delta.baseRevision) || delta.baseRevision < 1 ||
          !Number.isInteger(delta.registryRevision) || delta.registryRevision < 2 ||
          !Number.isInteger(delta.observedAtMs) || delta.observedAtMs < 0) {
        return { status: 'rejected', reason: 'invalid-delta', registryRevision: this.registryRevision };
      }
      if (delta.sessionId !== this.sessionId) {
        return { status: 'stale', reason: 'session-mismatch', registryRevision: this.registryRevision };
      }
      if (delta.baseRevision !== this.registryRevision || delta.registryRevision <= delta.baseRevision) {
        return { status: 'stale', reason: 'revision-mismatch', registryRevision: this.registryRevision };
      }
      if (!Array.isArray(delta.operations) || !delta.operations.length || delta.operations.length > 16) {
        return { status: 'rejected', reason: 'invalid-operations', registryRevision: this.registryRevision };
      }

      const next = new Map(this.targets);
      for (const operation of delta.operations) {
        const operationFields = operation?.op === 'remove' ? ['op', 'targetId'] : ['op', 'targetId', 'target'];
        if (!operation || Object.keys(operation).some((field) => !operationFields.includes(field)) ||
            Object.keys(operation).length !== operationFields.length) {
          return { status: 'rejected', reason: 'invalid-operation', registryRevision: this.registryRevision };
        }
        const id = clean(operation?.targetId, 273);
        if (!TARGET_ID_PATTERN.test(id)) return { status: 'rejected', reason: 'invalid-target-id', registryRevision: this.registryRevision };
        if (operation.op === 'remove') next.delete(id);
        else if (operation.op === 'add' || operation.op === 'replace') {
          const target = normalizeTarget(operation.target, { now: this.now(), strict: true });
          if (!target || target.targetId !== id) return { status: 'rejected', reason: 'invalid-target', registryRevision: this.registryRevision };
          next.set(id, target);
        } else return { status: 'rejected', reason: 'invalid-operation', registryRevision: this.registryRevision };
      }

      const locked = Array.from(next.values()).filter((target) => target.state === 'locked');
      if (next.size > MAX_TARGETS || locked.length > 1) {
        return { status: 'rejected', reason: 'target-invariant', registryRevision: this.registryRevision };
      }
      const previousActive = this.activeTargetId ? clone(this.targets.get(this.activeTargetId)) : null;
      this.targets = next;
      this.registryRevision = delta.registryRevision;
      this.observedAtMs = Math.max(0, Math.trunc(number(delta.observedAtMs, this.now())));
      this.reconcileActive();
      this.trim();
      this.persist();
      this.notify(options.reason || 'target-delta-applied', previousActive, { delta: clone(delta) }, options);
      return { status: 'applied', registryRevision: this.registryRevision };
    }

    replaceSnapshot(snapshot, options = {}) {
      if (!snapshot || snapshot.type !== 'spatial.targets.state' || snapshot.schema !== SCHEMA || snapshot.schemaVersion !== SCHEMA_VERSION) {
        return { status: 'rejected', reason: 'invalid-snapshot', registryRevision: this.registryRevision };
      }
      const snapshotFields = ['type', 'schema', 'schemaVersion', 'sessionId', 'registryRevision', 'observedAtMs', 'activeTargetId', 'targets'];
      if (Object.keys(snapshot).some((field) => !snapshotFields.includes(field)) ||
          !Array.isArray(snapshot.targets) || snapshot.targets.length > MAX_TARGETS || !SESSION_ID_PATTERN.test(snapshot.sessionId) ||
          !Number.isInteger(snapshot.registryRevision) || snapshot.registryRevision < 1 ||
          !Number.isInteger(snapshot.observedAtMs) || snapshot.observedAtMs < 0 ||
          (snapshot.activeTargetId !== null && !TARGET_ID_PATTERN.test(snapshot.activeTargetId))) {
        return { status: 'rejected', reason: 'invalid-snapshot', registryRevision: this.registryRevision };
      }
      if (!options.force && snapshot.sessionId === this.sessionId && snapshot.registryRevision < this.registryRevision) {
        return { status: 'stale', reason: 'revision-mismatch', registryRevision: this.registryRevision };
      }
      if (!options.force && snapshot.sessionId !== this.sessionId && !options.replaceSession) {
        return { status: 'stale', reason: 'session-mismatch', registryRevision: this.registryRevision };
      }
      if (!options.force && this.retiredSessionIds.has(snapshot.sessionId)) {
        return { status: 'stale', reason: 'retired-session', registryRevision: this.registryRevision };
      }
      const targets = new Map();
      for (const item of snapshot.targets) {
        const target = normalizeTarget(item, { now: snapshot.observedAtMs, strict: true });
        if (!target || targets.has(target.targetId)) return { status: 'rejected', reason: 'invalid-targets', registryRevision: this.registryRevision };
        targets.set(target.targetId, target);
      }
      const locked = Array.from(targets.values()).filter((target) => target.state === 'locked');
      const activeIsLocked = snapshot.activeTargetId === null
        ? locked.length === 0
        : targets.get(snapshot.activeTargetId)?.state === 'locked' && locked.length === 1;
      if (!activeIsLocked) return { status: 'rejected', reason: 'target-invariant', registryRevision: this.registryRevision };
      const previousActive = this.activeTargetId ? clone(this.targets.get(this.activeTargetId)) : null;
      if (snapshot.sessionId !== this.sessionId) {
        this.retiredSessionIds.add(this.sessionId);
        while (this.retiredSessionIds.size > 8) this.retiredSessionIds.delete(this.retiredSessionIds.values().next().value);
      }
      this.sessionId = normalizeSessionId(snapshot.sessionId);
      this.registryRevision = Math.max(1, Math.trunc(number(snapshot.registryRevision, 1)));
      this.observedAtMs = Math.max(0, Math.trunc(number(snapshot.observedAtMs, this.now())));
      this.targets = targets;
      this.activeTargetId = snapshot.activeTargetId && targets.has(snapshot.activeTargetId) ? snapshot.activeTargetId : null;
      this.reconcileActive();
      this.expire({ silent: true });
      this.persist();
      this.notify(options.reason || 'target-registry-resynced', previousActive, { resync: true }, options);
      return { status: 'applied', registryRevision: this.registryRevision };
    }

    resolveAlias(expected = {}) {
      const entries = aliasFields
        .filter((field) => expected[field] !== undefined)
        .map((field) => [field, clean(expected[field], field === 'meshPath' ? 360 : 180)]);
      if (!entries.length) return { status: 'not-found', target: null, targetIds: [] };
      const matches = Array.from(this.targets.values()).filter((target) =>
        (!expected.kind || target.kind === expected.kind) &&
        entries.every(([field, value]) => target.aliases[field] === value)
      );
      if (matches.length === 1) return { status: 'resolved', target: clone(matches[0]), targetIds: [matches[0].targetId] };
      return {
        status: matches.length ? 'ambiguous' : 'not-found',
        target: null,
        targetIds: matches.map((target) => target.targetId)
      };
    }

    modelProjection(options = {}) {
      this.expire({ reason: 'target-expired' });
      const active = this.activeTargetId ? this.targets.get(this.activeTargetId) : null;
      const maximum = Math.min(MODEL_PROJECTION_MAX, Math.max(0, Math.trunc(number(options.maxCandidates, MODEL_PROJECTION_MAX))));
      const candidates = Array.from(this.targets.values())
        .filter((target) => target.targetId !== this.activeTargetId && target.state === 'candidate')
        .sort((left, right) => right.confidence - left.confidence || right.observedAtMs - left.observedAtMs)
        .slice(0, maximum);
      const project = (target) => target ? ({
        targetId: target.targetId,
        kind: target.kind,
        label: target.label,
        state: target.state,
        confidence: target.confidence,
        confidenceBasis: target.confidenceBasis,
        source: target.source,
        targetRevision: target.targetRevision,
        aliases: clone(target.aliases),
        anchor: clone(target.anchor)
      }) : null;
      return {
        sessionId: this.sessionId,
        registryRevision: this.registryRevision,
        activeTarget: project(active),
        candidates: candidates.map(project)
      };
    }

    subscribe(listener, options = {}) {
      if (typeof listener !== 'function') return () => {};
      this.listeners.add(listener);
      if (options.emitCurrent) listener({
        reason: 'current-target-registry',
        snapshot: this.snapshot(),
        activeTarget: this.getActive(),
        previousActive: null
      });
      return () => this.listeners.delete(listener);
    }

    reconcileActive() {
      const locked = Array.from(this.targets.values()).filter((target) => target.state === 'locked');
      let chosen = this.activeTargetId && this.targets.get(this.activeTargetId)?.state === 'locked'
        ? this.activeTargetId
        : locked[0]?.targetId || null;
      for (const target of locked) {
        if (target.targetId !== chosen) this.targets.set(target.targetId, { ...target, state: 'candidate' });
      }
      this.activeTargetId = chosen;
    }

    trim() {
      if (this.targets.size <= MAX_TARGETS) return;
      const removable = Array.from(this.targets.values())
        .filter((target) => target.targetId !== this.activeTargetId)
        .sort((left, right) => left.observedAtMs - right.observedAtMs || left.confidence - right.confidence);
      while (this.targets.size > MAX_TARGETS && removable.length) this.targets.delete(removable.shift().targetId);
    }

    commit(reason, previousActive, options = {}) {
      this.registryRevision += 1;
      this.observedAtMs = Math.max(0, Math.trunc(this.now()));
      if (options.persist !== false) this.persist();
      this.notify(reason, previousActive, {}, options);
    }

    notify(reason, previousActive, extra = {}, options = {}) {
      if (options.silent) return;
      const detail = {
        reason: clean(reason || 'target-registry-changed', 120),
        snapshot: this.snapshot({ expire: false }),
        activeTarget: this.activeTargetId ? clone(this.targets.get(this.activeTargetId)) : null,
        previousActive: clone(previousActive),
        ...extra
      };
      this.listeners.forEach((listener) => {
        try { listener(detail); } catch (error) { console.warn('Target registry listener failed:', error); }
      });
      if (typeof this.root.dispatchEvent === 'function' && typeof this.root.CustomEvent === 'function') {
        this.root.dispatchEvent(new this.root.CustomEvent('mxgenius:targets-changed', { detail }));
        if (extra.resync) this.root.dispatchEvent(new this.root.CustomEvent('mxgenius:targets-resynced', { detail }));
      }
    }

    persist() {
      try {
        if (this.storage) this.storage.setItem(this.storageKey, JSON.stringify(this.snapshot({ expire: false })));
      } catch {
        // Runtime target state remains usable when browser storage is unavailable.
      }
    }

    restore() {
      try {
        const raw = this.storage?.getItem(this.storageKey);
        if (!raw) return false;
        return this.replaceSnapshot(JSON.parse(raw), { force: true, silent: true, persist: false }).status === 'applied';
      } catch {
        return false;
      }
    }
  }

  function create(options = {}) {
    return new Registry(options);
  }

  const defaultRegistry = create();
  return Object.freeze({
    STORAGE_KEY,
    SCHEMA,
    SCHEMA_VERSION,
    MAX_TARGETS,
    MODEL_PROJECTION_MAX,
    SESSION_ID_PATTERN,
    TARGET_ID_PATTERN,
    Registry,
    create,
    defaultRegistry,
    makeTargetId,
    normalizeTarget
  });
});
