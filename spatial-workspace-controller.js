export const SPATIAL_WORKSPACE_VIEWS = Object.freeze({
  WORLD: 'world',
  FOCUS: 'focus'
});

export const SPATIAL_REALITY_MODES = Object.freeze({
  VR: 'immersive-vr',
  AR: 'immersive-ar'
});

export const SPATIAL_SERVICE_STATES = Object.freeze({
  NORMAL: 'normal',
  DEGRADED: 'degraded',
  RECOVERY: 'recovery'
});

const VIEWS = new Set(Object.values(SPATIAL_WORKSPACE_VIEWS));
const REALITY_MODES = new Set(Object.values(SPATIAL_REALITY_MODES));
const SERVICE_STATES = new Set(Object.values(SPATIAL_SERVICE_STATES));

function copy(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function required(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`Invalid spatial workspace ${label}: ${value}`);
  return value;
}

function owner(value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error('A spatial session owner is required');
  return normalized;
}

function windowSnapshot(value = {}) {
  const windows = Array.isArray(value.windows)
    ? value.windows.map((entry) => ({
      id: String(entry?.id || ''),
      state: ['closed', 'minimized', 'open'].includes(entry?.state) ? entry.state : 'closed',
      active: Boolean(entry?.active)
    })).filter((entry) => entry.id)
    : [];
  const activeId = value.activeId && windows.some((entry) => entry.id === value.activeId)
    ? String(value.activeId)
    : null;
  return { activeId, windows };
}

export class SpatialWorkspaceController {
  constructor({
    view = SPATIAL_WORKSPACE_VIEWS.FOCUS,
    realityMode = SPATIAL_REALITY_MODES.VR,
    context = {},
    activeWindow = null,
    windows = [],
    systemMenuOpen = false,
    serviceState = SPATIAL_SERVICE_STATES.NORMAL,
    normalizeContext = (value) => value && typeof value === 'object' ? value : {},
    onChange = () => {}
  } = {}) {
    this.normalizeContext = normalizeContext;
    this.onChange = onChange;
    const normalizedWindows = windowSnapshot({ activeId: activeWindow, windows });
    this.state = {
      version: 1,
      revision: 0,
      view: required(view, VIEWS, 'view'),
      realityMode: required(realityMode, REALITY_MODES, 'reality mode'),
      pendingRealityMode: null,
      context: copy(this.normalizeContext(copy(context))) || {},
      activeWindow: normalizedWindows.activeId,
      windows: normalizedWindows.windows,
      systemMenuOpen: Boolean(systemMenuOpen),
      serviceState: required(serviceState, SERVICE_STATES, 'service state'),
      session: {
        active: false,
        ownerId: null
      }
    };
  }

  snapshot() {
    return freeze(copy(this.state));
  }

  transition(type, mutate, detail = {}) {
    const previous = this.snapshot();
    const changed = mutate(this.state) !== false;
    if (!changed) return previous;
    this.state.revision += 1;
    const state = this.snapshot();
    this.onChange({ type, detail: copy(detail), previous, state });
    return state;
  }

  requestView(view, detail = {}) {
    required(view, VIEWS, 'view');
    return this.transition('view', (state) => {
      if (state.view === view) return false;
      state.view = view;
    }, detail);
  }

  setContext(context, detail = {}) {
    const normalized = copy(this.normalizeContext(copy(context))) || {};
    return this.transition('context', (state) => {
      state.context = normalized;
    }, detail);
  }

  updateWindowSnapshot(snapshot, detail = {}) {
    const normalized = windowSnapshot(snapshot);
    return this.transition('windows', (state) => {
      state.activeWindow = normalized.activeId;
      state.windows = normalized.windows;
    }, detail);
  }

  setSystemMenuOpen(open, detail = {}) {
    const next = Boolean(open);
    return this.transition('system-menu', (state) => {
      if (state.systemMenuOpen === next) return false;
      state.systemMenuOpen = next;
    }, detail);
  }

  setServiceState(serviceState, detail = {}) {
    required(serviceState, SERVICE_STATES, 'service state');
    return this.transition('service', (state) => {
      if (state.serviceState === serviceState) return false;
      state.serviceState = serviceState;
    }, detail);
  }

  beginRealityHandoff(realityMode, detail = {}) {
    required(realityMode, REALITY_MODES, 'reality mode');
    return this.transition('reality-handoff', (state) => {
      state.pendingRealityMode = realityMode;
    }, detail);
  }

  cancelRealityHandoff(detail = {}) {
    return this.transition('reality-handoff-cancelled', (state) => {
      if (!state.pendingRealityMode) return false;
      state.pendingRealityMode = null;
    }, detail);
  }

  activateSession(ownerId, { realityMode = this.state.pendingRealityMode || this.state.realityMode, ...detail } = {}) {
    const requestedOwner = owner(ownerId);
    required(realityMode, REALITY_MODES, 'reality mode');
    if (this.state.session.ownerId && this.state.session.ownerId !== requestedOwner) {
      throw new Error(`Spatial session is already owned by ${this.state.session.ownerId}`);
    }
    return this.transition('session-active', (state) => {
      state.session = { active: true, ownerId: requestedOwner };
      state.realityMode = realityMode;
      state.pendingRealityMode = null;
    }, detail);
  }

  releaseSession(ownerId, { preserveHandoff = false, ...detail } = {}) {
    const requestedOwner = owner(ownerId);
    if (!this.state.session.ownerId) return this.snapshot();
    if (this.state.session.ownerId !== requestedOwner) {
      throw new Error(`Spatial session is owned by ${this.state.session.ownerId}, not ${requestedOwner}`);
    }
    return this.transition('session-released', (state) => {
      state.session = { active: false, ownerId: null };
      if (!preserveHandoff) state.pendingRealityMode = null;
    }, detail);
  }
}
