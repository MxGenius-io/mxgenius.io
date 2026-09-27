export const SPATIAL_WINDOW_STATES = Object.freeze({
  CLOSED: 'closed',
  MINIMIZED: 'minimized',
  OPEN: 'open'
});

export class SpatialWindowManager {
  constructor({ onChange = () => {} } = {}) {
    this.windows = new Map();
    this.activeId = null;
    this.onChange = onChange;
  }

  register(id, handlers = {}) {
    if (!id || this.windows.has(id)) throw new Error(`Spatial window already registered: ${id}`);
    this.windows.set(id, {
      id,
      state: SPATIAL_WINDOW_STATES.CLOSED,
      show: typeof handlers.show === 'function' ? handlers.show : () => {},
      hide: typeof handlers.hide === 'function' ? handlers.hide : () => {},
      focus: typeof handlers.focus === 'function' ? handlers.focus : () => {}
    });
    return this.state(id);
  }

  state(id) {
    const entry = this.windows.get(id);
    return entry ? { id: entry.id, state: entry.state, active: this.activeId === id } : null;
  }

  snapshot() {
    return {
      activeId: this.activeId,
      windows: [...this.windows.values()].map((entry) => this.state(entry.id))
    };
  }

  open(id, detail = {}) {
    const entry = this.windows.get(id);
    if (!entry) return false;
    if (this.activeId && this.activeId !== id) this.minimize(this.activeId, { reason: 'replaced', ...detail });
    entry.state = SPATIAL_WINDOW_STATES.OPEN;
    this.activeId = id;
    entry.show(detail);
    entry.focus(detail);
    this.emit(id, detail);
    return true;
  }

  minimize(id, detail = {}) {
    const entry = this.windows.get(id);
    if (!entry || entry.state === SPATIAL_WINDOW_STATES.CLOSED) return false;
    entry.state = SPATIAL_WINDOW_STATES.MINIMIZED;
    if (this.activeId === id) this.activeId = null;
    entry.hide({ preserve: true, ...detail });
    this.emit(id, detail);
    return true;
  }

  close(id, detail = {}) {
    const entry = this.windows.get(id);
    if (!entry || entry.state === SPATIAL_WINDOW_STATES.CLOSED) return false;
    entry.state = SPATIAL_WINDOW_STATES.CLOSED;
    if (this.activeId === id) this.activeId = null;
    entry.hide({ preserve: false, ...detail });
    this.emit(id, detail);
    return true;
  }

  toggle(id, detail = {}) {
    const entry = this.windows.get(id);
    if (!entry) return false;
    return entry.state === SPATIAL_WINDOW_STATES.OPEN
      ? this.minimize(id, detail)
      : this.open(id, detail);
  }

  minimizeAll(detail = {}) {
    for (const id of this.windows.keys()) this.minimize(id, detail);
  }

  restoreSnapshot(snapshot = {}, detail = {}) {
    const requested = new Map(
      (Array.isArray(snapshot.windows) ? snapshot.windows : [])
        .filter((entry) => entry?.id && this.windows.has(entry.id))
        .map((entry) => [entry.id, entry.state])
    );
    const requestedActive = snapshot.activeId && requested.get(snapshot.activeId) === SPATIAL_WINDOW_STATES.OPEN
      ? snapshot.activeId
      : null;

    for (const id of this.windows.keys()) {
      if (id === requestedActive) continue;
      const state = requested.get(id);
      if (state === SPATIAL_WINDOW_STATES.MINIMIZED) {
        const entry = this.windows.get(id);
        entry.state = SPATIAL_WINDOW_STATES.MINIMIZED;
        if (this.activeId === id) this.activeId = null;
        entry.hide({ preserve: true, ...detail });
        this.emit(id, detail);
      } else if (state === SPATIAL_WINDOW_STATES.CLOSED || !state) {
        this.close(id, detail);
      }
    }
    if (requestedActive) this.open(requestedActive, detail);
    return this.snapshot();
  }

  emit(id, detail) {
    this.onChange({ ...this.state(id), detail, snapshot: this.snapshot() });
  }
}
