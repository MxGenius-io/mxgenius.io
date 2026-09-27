const CAPABILITY_ORDER = Object.freeze(['voice', 'capture', 'thermal', 'witness']);

const CAPABILITY_META = Object.freeze({
  voice: Object.freeze({ label: 'AI', icon: 'voice' }),
  capture: Object.freeze({ label: 'CAPTURE', icon: 'capture' }),
  thermal: Object.freeze({ label: 'THERMAL', icon: 'thermal' }),
  witness: Object.freeze({ label: 'WITNESS', icon: 'witness' })
});

function compact(value) {
  return String(value ?? '').trim().toLowerCase();
}

function contextIdentity(value) {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim() || null;
  if (typeof value !== 'object') return null;
  return value.id || value.caseId || value.modelId || value.partNumber || value.icao
    || value.meshName || value.nodeId || value.nodeName || null;
}

function evidenceState(context = {}) {
  const caseId = contextIdentity(context.case) || contextIdentity(context.caseId);
  const targets = ['component', 'part', 'model', 'device', 'aircraft', 'location'];
  const target = targets.find((name) => contextIdentity(context[name])) || null;
  return { caseId, target, ready: Boolean(caseId && target) };
}

function thermalState(runtime = {}) {
  const transport = compact(runtime.transport || runtime.thermalTransport);
  const source = compact(runtime.source || runtime.thermalSource);
  const frames = Math.max(0, Number(runtime.frames) || 0);
  const transportReady = ['connected', 'streaming'].includes(transport);
  const sourceReady = ['available', 'connected', 'ready', 'streaming'].includes(source) || frames > 0;
  return { transport, source, frames, ready: transportReady && sourceReady };
}

function witnessState(runtime = {}) {
  const configured = runtime.configured !== false;
  const roomStatus = compact(runtime.roomStatus || runtime.status || 'ready');
  const approved = runtime.approved === true || roomStatus === 'live';
  const status = roomStatus === 'live' ? 'LIVE'
    : approved && roomStatus === 'paused' ? 'PAUSED · CONSENTED'
      : ['invited', 'pending', 'awaiting-approval'].includes(roomStatus) ? 'AWAITING CONSENT'
        : ['revoked', 'expired'].includes(roomStatus) ? 'READY · NEW CONSENT'
          : 'READY';
  return { configured, roomStatus, approved, status };
}

export class XRCapabilityRegistry {
  constructor({ context = {}, permissions = {}, runtime = {}, actions = {}, onChange = () => {} } = {}) {
    this.context = { ...context };
    this.permissions = { voice: true, capture: true, thermal: true, witness: true, ...permissions };
    this.runtime = { ...runtime };
    this.actions = new Map(Object.entries(actions));
    this.onChange = onChange;
    this.capabilities = new Map();
    this.recompute('initialize');
  }

  registerAction(id, action) {
    if (!CAPABILITY_META[id]) throw new Error(`Unknown XR capability: ${id}`);
    if (typeof action !== 'function') throw new TypeError(`XR capability action must be a function: ${id}`);
    this.actions.set(id, action);
    return this.get(id);
  }

  setContext(context = {}, detail = {}) {
    this.context = { ...context };
    return this.recompute(detail.reason || 'context');
  }

  setPermissions(permissions = {}, detail = {}) {
    this.permissions = { ...this.permissions, ...permissions };
    return this.recompute(detail.reason || 'permissions');
  }

  setRuntime(id, runtime = {}, detail = {}) {
    if (!CAPABILITY_META[id]) return this.snapshot();
    this.runtime = {
      ...this.runtime,
      [id]: { ...(this.runtime[id] || {}), ...runtime }
    };
    return this.recompute(detail.reason || `${id}-runtime`);
  }

  derive(id) {
    const meta = CAPABILITY_META[id];
    const permitted = this.permissions[id] !== false;
    if (!permitted) return { id, ...meta, visible: true, enabled: false, status: 'LOCKED', reason: 'Permission required' };

    if (id === 'capture') {
      const evidence = evidenceState(this.context);
      if (!evidence.caseId) {
        return { id, ...meta, visible: true, enabled: false, status: 'SELECT CASE', reason: 'Open a case before capturing evidence' };
      }
      if (!evidence.target) {
        return { id, ...meta, visible: true, enabled: false, status: 'SELECT TARGET', reason: 'Select an asset or part to capture' };
      }
      return { id, ...meta, visible: true, enabled: true, status: `READY · ${evidence.target.toUpperCase()}`, reason: '' };
    }

    if (id === 'thermal') {
      const thermal = thermalState(this.runtime.thermal);
      if (!thermal.ready) {
        const reason = !['connected', 'streaming'].includes(thermal.transport)
          ? 'Thermal bridge is not connected'
          : 'No valid thermal source is available';
        return { id, ...meta, visible: true, enabled: false, status: 'NO SOURCE', reason };
      }
      return { id, ...meta, visible: true, enabled: true, status: thermal.source === 'streaming' || thermal.frames ? 'LIVE' : 'READY', reason: '' };
    }

    if (id === 'witness') {
      const witness = witnessState(this.runtime.witness);
      if (!witness.configured) {
        return { id, ...meta, visible: true, enabled: false, status: 'UNAVAILABLE', reason: 'Remote Witness service is unavailable' };
      }
      return { id, ...meta, visible: true, enabled: true, status: witness.status, reason: '' };
    }

    const voiceStatus = compact(this.runtime.voice?.status);
    if (voiceStatus === 'unavailable') {
      return { id, ...meta, visible: true, enabled: false, status: 'UNAVAILABLE', reason: 'AI service is unavailable' };
    }
    return {
      id,
      ...meta,
      visible: true,
      enabled: true,
      status: ['listening', 'thinking', 'speaking'].includes(voiceStatus) ? voiceStatus.toUpperCase() : 'READY',
      reason: ''
    };
  }

  recompute(reason = 'update') {
    this.capabilities = new Map(CAPABILITY_ORDER.map((id) => [id, Object.freeze(this.derive(id))]));
    const snapshot = this.snapshot();
    this.onChange(snapshot, { reason });
    return snapshot;
  }

  get(id) {
    const value = this.capabilities.get(id);
    return value ? { ...value } : null;
  }

  snapshot() {
    return CAPABILITY_ORDER.map((id) => this.get(id));
  }

  async execute(id, detail = {}) {
    const capability = this.get(id);
    if (!capability) return { ok: false, id, reason: 'Unknown capability' };
    if (!capability.enabled) return { ok: false, id, reason: capability.reason, capability };
    const action = this.actions.get(id);
    if (typeof action !== 'function') return { ok: false, id, reason: 'Capability action is not registered', capability };
    const value = await action(detail, capability);
    return { ok: true, id, capability, value };
  }
}

export const XR_CAPABILITY_IDS = CAPABILITY_ORDER;
export const xrEvidenceTarget = evidenceState;
