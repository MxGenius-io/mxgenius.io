import * as THREE from 'three';

const MODES = Object.freeze({
  operations: { label: 'WORLD', color: '#38bdf8' },
  maintenance: { label: 'FOCUS', color: '#2dd4bf' }
});

const TOOL_DEFAULTS = Object.freeze([
  { id: 'voice', label: 'ASK AI', color: '#2dd4bf' },
  { id: 'capture', label: 'CAPTURE', color: '#a78bfa' },
  { id: 'thermal', label: 'THERMAL', color: '#fb923c' },
  { id: 'witness', label: 'WITNESS', color: '#38bdf8' }
]);

const SYSTEM_DEFAULTS = Object.freeze([
  { id: 'reality', label: 'VR / AR', color: '#22d3ee' },
  { id: 'recenter', label: 'RECENTER', color: '#2dd4bf' },
  { id: 'sound', label: 'SOUND', color: '#a78bfa' },
  { id: 'service', label: 'SERVICE', color: '#fbbf24' },
  { id: 'exit', label: 'EXIT', color: '#fb7185' }
]);

function rounded(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function clean(value, fallback = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

export class XRSpatialShell {
  constructor({
    mode = 'operations',
    context = {},
    tools = [],
    placement = null,
    sessionMode = 'immersive-vr',
    sessionModeSupport = {},
    systemMenuOpen = false,
    onModeChange = () => {},
    onSessionModeChange = null,
    onRecenter = () => {},
    onExit = () => {},
    onToolAction = () => {},
    onSystemAction = () => {},
    onSystemMenuChange = () => {},
    onAction = () => {}
  } = {}) {
    this.mode = MODES[mode] ? mode : 'operations';
    this.context = { ...context };
    this.sessionMode = sessionMode === 'immersive-ar' ? 'immersive-ar' : 'immersive-vr';
    this.sessionModeSupport = {
      'immersive-vr': sessionModeSupport['immersive-vr'] ?? null,
      'immersive-ar': sessionModeSupport['immersive-ar'] ?? null
    };
    this.onModeChange = onModeChange;
    this.onSessionModeChange = typeof onSessionModeChange === 'function' ? onSessionModeChange : null;
    this.onRecenter = onRecenter;
    this.onExit = onExit;
    this.onToolAction = onToolAction;
    this.onSystemAction = onSystemAction;
    this.onSystemMenuChange = onSystemMenuChange;
    this.onAction = onAction;
    this.presenting = false;
    this.disposed = false;
    this.placementPending = true;
    this.actionMenuOpen = false;
    this.systemMenuOpen = Boolean(systemMenuOpen);
    this.hoveredTarget = null;
    this.cameraPosition = new THREE.Vector3();
    this.cameraQuaternion = new THREE.Quaternion();
    this.localPoint = new THREE.Vector3();
    this.placementOffset = new THREE.Vector3(
      Number.isFinite(placement?.x) ? placement.x : 0,
      Number.isFinite(placement?.y) ? placement.y : -0.34,
      Number.isFinite(placement?.z) ? placement.z : -1.08
    );

    this.group = new THREE.Group();
    this.group.name = 'MXGeniusSpatialShell';
    this.group.visible = false;

    this.contentDock = new THREE.Object3D();
    this.contentDock.name = 'MXGeniusSpatialContentDock';
    this.contentDock.position.set(0.92, 0.18, -0.02);
    this.group.add(this.contentDock);

    this.backplate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.66, 0.14),
      new THREE.MeshBasicMaterial({ color: 0x07131f, transparent: true, opacity: 0.88, toneMapped: false, side: THREE.DoubleSide })
    );
    this.backplate.name = 'MXGeniusSpatialControlDock';
    this.backplate.position.z = -0.012;
    this.group.add(this.backplate);

    this.actionButton = this.createButton({
      id: 'actions', name: 'MXGeniusContextualAction', action: 'toggle-actions',
      width: 0.46, height: 0.11, x: -0.09, y: 0, canvasWidth: 640, canvasHeight: 192
    });
    this.systemButton = this.createButton({
      id: 'system', name: 'MXGeniusSystemMenu', action: 'toggle-system',
      width: 0.15, height: 0.11, x: 0.235, y: 0, canvasWidth: 256, canvasHeight: 192
    });
    this.buttons = [this.actionButton, this.systemButton];
    this.group.add(...this.buttons);

    this.actionMenu = new THREE.Group();
    this.actionMenu.name = 'MXGeniusContextualActionMenu';
    this.actionMenu.position.set(0, -0.14, 0.004);
    this.group.add(this.actionMenu);
    this.contextButton = this.createButton({
      id: 'context', name: 'MXGeniusContextJourneyAction', action: 'context-action',
      width: 0.64, height: 0.08, x: 0, y: -0.01, canvasWidth: 768, canvasHeight: 128
    });
    this.actionMenu.add(this.contextButton);

    this.toolStates = new Map();
    this.toolButtons = tools.map((tool, index) => {
      const preset = TOOL_DEFAULTS.find((entry) => entry.id === tool.id) || {};
      const normalized = {
        ...preset,
        ...tool,
        enabled: tool.enabled !== false,
        active: Boolean(tool.active),
        loading: Boolean(tool.loading),
        failure: clean(tool.failure),
        windowState: tool.windowState || (tool.active ? 'open' : 'closed')
      };
      this.toolStates.set(normalized.id, normalized);
      const column = index % 2;
      const row = Math.floor(index / 2);
      const button = this.createButton({
        id: normalized.id, name: `MXGeniusTool-${normalized.id}`, action: 'select-tool',
        width: 0.305, height: 0.085, x: column ? 0.1675 : -0.1675,
        y: -0.11 - row * 0.095, canvasWidth: 512, canvasHeight: 144
      });
      button.userData.xrShellTool = normalized.id;
      this.actionMenu.add(button);
      return button;
    });

    this.systemMenu = new THREE.Group();
    this.systemMenu.name = 'MXGeniusCompactSystemMenu';
    this.systemMenu.position.set(-0.49, 0.16, 0.006);
    this.group.add(this.systemMenu);
    this.systemStates = new Map();
    this.systemButtons = SYSTEM_DEFAULTS.map((item, index) => {
      const state = { ...item, enabled: true, active: false, loading: false, failure: '' };
      this.systemStates.set(item.id, state);
      const button = this.createButton({
        id: item.id, name: `MXGeniusSystem-${item.id}`, action: 'system-action',
        width: 0.29, height: 0.072, x: 0, y: -index * 0.081,
        canvasWidth: 512, canvasHeight: 128
      });
      button.userData.xrSystemAction = item.id;
      this.systemMenu.add(button);
      return button;
    });
    this.sessionModeButton = this.systemButtons.find((button) => button.userData.xrSystemAction === 'reality') || null;
    this.exitButton = this.systemButtons.find((button) => button.userData.xrSystemAction === 'exit') || null;
    this.setMenuVisibility();
    this.draw();
  }

  createButton({ id, name, action, width, height, x, y, canvasWidth, canvasHeight }) {
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const button = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    button.name = name;
    button.position.set(x, y, 0);
    button.userData.xrShellAction = action;
    button.userData.xrShellId = id;
    button.userData.xrHitSize = { width, height };
    button.userData.canvas = canvas;
    button.userData.context = canvas.getContext('2d');
    button.userData.texture = texture;
    return button;
  }

  drawSurface(button, { label, status = '', color = '#38bdf8', enabled = true, active = false, loading = false, failure = '', primary = false } = {}) {
    if (!button) return;
    const { canvas, context, texture } = button.userData;
    const hovered = button === this.hoveredTarget;
    const message = clean(failure || (loading ? 'WORKING…' : status));
    context.clearRect(0, 0, canvas.width, canvas.height);
    rounded(context, 7, 7, canvas.width - 14, canvas.height - 14, primary ? 34 : 24);
    context.fillStyle = active ? 'rgba(14, 67, 80, 0.98)'
      : hovered ? 'rgba(15, 48, 65, 0.98)' : 'rgba(7, 23, 37, 0.96)';
    context.fill();
    context.strokeStyle = failure ? '#fb7185' : enabled ? color : '#475569';
    context.lineWidth = active || hovered ? 7 : 4;
    context.stroke();
    context.textAlign = 'center';
    context.fillStyle = enabled ? '#eefaff' : '#718096';
    context.font = primary
      ? `700 ${Math.round(canvas.height * 0.25)}px ui-monospace, monospace`
      : `700 ${Math.round(canvas.height * 0.23)}px ui-monospace, monospace`;
    context.fillText(clean(label, 'ACTION'), canvas.width / 2, message ? canvas.height * 0.52 : canvas.height * 0.62);
    if (message) {
      context.fillStyle = failure ? '#fecdd3' : enabled ? '#8fd8eb' : '#94a3b8';
      context.font = `600 ${Math.round(canvas.height * 0.135)}px system-ui, sans-serif`;
      context.fillText(message.slice(0, primary ? 42 : 30), canvas.width / 2, canvas.height * 0.78);
    }
    if (loading) {
      context.fillStyle = '#fbbf24';
      context.beginPath();
      context.arc(canvas.width - 28, 28, 8, 0, Math.PI * 2);
      context.fill();
    }
    texture.needsUpdate = true;
  }

  primaryActionLabel() {
    if (this.actionMenuOpen) return { label: 'CLOSE ACTIONS', status: 'RETURN TO WORKSPACE' };
    if (this.mode === 'operations') return { label: 'SELECT AN ASSET', status: 'POINT AT THE WORLD' };
    return { label: 'CONTEXTUAL ACTIONS', status: this.contextLabel() };
  }

  contextLabel() {
    return clean(
      this.context.component?.id || this.context.part?.partNumber || this.context.model?.name
      || this.context.aircraft?.registration || this.context.aircraft?.id || this.context.location?.icao,
      this.mode === 'operations' ? 'WORLD' : 'FOCUS'
    ).toUpperCase().slice(0, 34);
  }

  draw() {
    const primary = this.primaryActionLabel();
    this.drawSurface(this.actionButton, {
      ...primary, color: MODES[this.mode].color, active: this.actionMenuOpen, primary: true
    });
    this.drawSurface(this.systemButton, {
      label: '•••', status: this.systemMenuOpen ? 'CLOSE' : 'SYSTEM', color: '#94a3b8',
      active: this.systemMenuOpen, primary: true
    });
    const contextEnabled = this.mode === 'maintenance';
    this.contextButton.userData.xrContextAction = contextEnabled ? 'return-world' : 'select-asset';
    this.drawSurface(this.contextButton, {
      label: contextEnabled ? 'RETURN TO WORLD' : 'SELECT ON THE GLOBE',
      status: contextEnabled ? 'KEEP CURRENT SELECTION' : 'USE RAY OR HAND DWELL',
      color: contextEnabled ? '#38bdf8' : '#64748b', enabled: contextEnabled
    });
    for (const button of this.toolButtons) {
      const tool = this.toolStates.get(button.userData.xrShellTool);
      const toolStatus = tool?.windowState === 'minimized'
        ? 'MINIMIZED · TAP TO RESTORE'
        : tool?.enabled === false ? tool.reason : tool?.status;
      this.drawSurface(button, {
        label: tool?.label, status: toolStatus,
        color: tool?.color, enabled: tool?.enabled !== false, active: Boolean(tool?.active),
        loading: Boolean(tool?.loading), failure: tool?.failure
      });
    }
    for (const button of this.systemButtons) {
      const id = button.userData.xrSystemAction;
      const item = this.systemStates.get(id) || {};
      let label = item.label;
      let status = item.status || '';
      let enabled = item.enabled !== false;
      if (id === 'reality') {
        const targetMode = this.sessionMode === 'immersive-ar' ? 'immersive-vr' : 'immersive-ar';
        const supported = this.sessionModeSupport[targetMode];
        label = targetMode === 'immersive-ar' ? 'SWITCH TO AR' : 'SWITCH TO VR';
        status = supported === null ? 'CHECKING DEVICE' : supported === false ? 'UNAVAILABLE' : 'PRESERVE CONTEXT';
        enabled = supported !== false;
        button.userData.xrShellSessionMode = targetMode;
      } else if (id === 'sound') {
        status = item.muted ? 'MUTED' : 'ON';
      } else if (id === 'service') {
        status = item.active ? 'DIAGNOSTICS OPEN' : clean(item.status, 'DIAGNOSTICS');
      } else if (id === 'exit') {
        label = this.sessionMode === 'immersive-ar' ? 'EXIT AR' : 'EXIT VR';
        status = 'END SESSION';
      }
      this.drawSurface(button, {
        label, status, color: item.color, enabled, active: Boolean(item.active),
        loading: Boolean(item.loading), failure: item.failure
      });
    }
  }

  setMenuVisibility() {
    this.actionMenu.visible = this.actionMenuOpen;
    this.systemMenu.visible = this.systemMenuOpen;
  }

  interactiveObjects() {
    if (!this.presenting) return [];
    return [
      ...this.buttons,
      ...(this.actionMenuOpen ? [
        this.contextButton,
        ...this.toolButtons.filter((button) => this.toolStates.get(button.userData.xrShellTool)?.visible !== false)
      ] : []),
      ...(this.systemMenuOpen ? this.systemButtons : [])
    ];
  }

  contentAnchor() {
    return this.contentDock;
  }

  owns(object) {
    let node = object;
    while (node) {
      if (node.userData?.xrShellAction) return true;
      node = node.parent;
    }
    return false;
  }

  setHoveredObject(object = null) {
    let target = object;
    while (target && !target.userData?.xrShellAction) target = target.parent;
    const next = target?.userData?.xrShellAction ? target : null;
    if (next === this.hoveredTarget) return next;
    this.hoveredTarget = next;
    this.draw();
    return next;
  }

  invokeWithFeedback(kind, id, invoke) {
    const states = kind === 'tool' ? this.toolStates : this.systemStates;
    const current = states.get(id);
    if (!current || current.enabled === false || current.loading) return true;
    states.set(id, { ...current, loading: true, failure: '' });
    this.draw();
    Promise.resolve().then(invoke).then((result) => {
      const latest = states.get(id) || current;
      const failed = result?.ok === false;
      states.set(id, { ...latest, loading: false, failure: failed ? clean(result.reason, 'Action unavailable') : '' });
      this.draw();
    }).catch((error) => {
      const latest = states.get(id) || current;
      states.set(id, { ...latest, loading: false, failure: clean(error?.message, 'Action failed') });
      this.draw();
    });
    return true;
  }

  handleObject(object, input = 'xr') {
    if (!this.owns(object)) return false;
    let target = object;
    while (target && !target.userData?.xrShellAction) target = target.parent;
    const action = target?.userData?.xrShellAction;
    if (action === 'toggle-actions') {
      this.setActionMenuOpen(!this.actionMenuOpen);
      this.onAction('spatial-actions-menu', input, { open: this.actionMenuOpen, mode: this.mode });
      return true;
    }
    if (action === 'toggle-system') {
      this.setSystemMenuOpen(!this.systemMenuOpen, { input, notify: true });
      this.onAction('spatial-system-menu', input, { open: this.systemMenuOpen });
      return true;
    }
    if (action === 'context-action') {
      if (target.userData.xrContextAction !== 'return-world') return true;
      const previousMode = this.mode;
      this.setMode('operations');
      this.setActionMenuOpen(false);
      this.onModeChange('operations', { from: previousMode, input, reason: 'context-return' });
      this.onAction('spatial-context-return', input, { from: previousMode, to: 'operations' });
      return true;
    }
    if (action === 'select-tool') {
      const toolId = target.userData.xrShellTool;
      const tool = this.toolStates.get(toolId);
      if (!tool || tool.enabled === false) return true;
      return this.invokeWithFeedback('tool', toolId, () => this.onToolAction(toolId, { input, tool: { ...tool } }));
    }
    if (action === 'system-action') {
      const systemId = target.userData.xrSystemAction;
      if (systemId === 'reality') {
        const nextMode = target.userData.xrShellSessionMode;
        const supported = this.sessionModeSupport[nextMode];
        if (supported !== false) this.onSessionModeChange?.(nextMode, { input });
        this.onAction(supported === false ? 'spatial-shell-session-mode-unavailable' : 'spatial-shell-session-mode', input, {
          from: this.sessionMode, to: nextMode, supported
        });
        return true;
      }
      if (systemId === 'recenter') {
        this.placementPending = true;
        this.onRecenter({ mode: this.mode, input });
        this.onAction('spatial-shell-recenter', input, { mode: this.mode });
        return true;
      }
      if (systemId === 'exit') {
        this.onExit({ input });
        this.onAction('spatial-shell-exit', input, { mode: this.mode });
        return true;
      }
      return this.invokeWithFeedback('system', systemId, () => this.onSystemAction(systemId, { input }));
    }
    return false;
  }

  fingerTargetAt(point) {
    if (!this.presenting || !this.group.visible) return null;
    for (const button of this.interactiveObjects()) {
      button.updateMatrixWorld(true);
      button.worldToLocal(this.localPoint.copy(point));
      const { width, height } = button.userData.xrHitSize;
      if (Math.abs(this.localPoint.z) < 0.04
        && Math.abs(this.localPoint.x) <= width / 2
        && Math.abs(this.localPoint.y) <= height / 2) {
        return this.setHoveredObject(button);
      }
    }
    this.setHoveredObject(null);
    return null;
  }

  setActionMenuOpen(open) {
    this.actionMenuOpen = Boolean(open);
    if (this.actionMenuOpen && this.systemMenuOpen) this.setSystemMenuOpen(false, { notify: true });
    this.setMenuVisibility();
    this.draw();
  }

  setSystemMenuOpen(open, { input = 'system', notify = false } = {}) {
    const next = Boolean(open);
    if (next === this.systemMenuOpen) return;
    this.systemMenuOpen = next;
    if (next) this.actionMenuOpen = false;
    this.setMenuVisibility();
    this.draw();
    if (notify) this.onSystemMenuChange(next, { input });
  }

  setToolState(id, state = {}) {
    const current = this.toolStates.get(id);
    if (!current) return false;
    this.toolStates.set(id, { ...current, ...state });
    this.draw();
    return true;
  }

  setSystemState(id, state = {}) {
    const current = this.systemStates.get(id);
    if (!current) return false;
    this.systemStates.set(id, { ...current, ...state });
    this.draw();
    return true;
  }

  setSoundState({ muted = false, status = '' } = {}) {
    return this.setSystemState('sound', { muted: Boolean(muted), status });
  }

  setContext(context = {}) {
    this.context = { ...context };
    this.draw();
  }

  setMode(mode) {
    if (!MODES[mode]) return;
    this.mode = mode;
    this.draw();
  }

  setSessionMode(mode) {
    const normalized = mode === 'immersive-ar' ? 'immersive-ar' : 'immersive-vr';
    if (normalized === this.sessionMode) return;
    this.sessionMode = normalized;
    this.draw();
  }

  setSessionModeSupport(mode, supported) {
    if (mode !== 'immersive-ar' && mode !== 'immersive-vr') return;
    this.sessionModeSupport[mode] = typeof supported === 'boolean' ? supported : null;
    this.draw();
  }

  setPresenting(value, camera = null) {
    this.presenting = Boolean(value);
    this.group.visible = this.presenting;
    if (this.presenting) {
      this.placementPending = true;
      this.placeForView(camera);
    }
  }

  placeForView(camera = null) {
    if (!this.placementPending || !camera) return;
    camera.getWorldPosition(this.cameraPosition);
    camera.getWorldQuaternion(this.cameraQuaternion);
    this.group.position.copy(this.placementOffset).applyQuaternion(this.cameraQuaternion).add(this.cameraPosition);
    this.group.quaternion.copy(this.cameraQuaternion);
    this.placementPending = false;
  }

  update(delta, { camera = null } = {}) {
    if (this.disposed || !this.presenting) return;
    this.placeForView(camera);
    const blend = 1 - Math.exp(-Math.max(0, delta) * 14);
    const allButtons = [...this.buttons, this.contextButton, ...this.toolButtons, ...this.systemButtons];
    for (const button of allButtons) {
      const target = button === this.hoveredTarget ? 1.075 : 1;
      const scale = THREE.MathUtils.lerp(button.scale.x, target, blend);
      button.scale.setScalar(scale);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.visible = false;
    this.backplate.geometry.dispose();
    this.backplate.material.dispose();
    for (const button of [...this.buttons, this.contextButton, ...this.toolButtons, ...this.systemButtons]) {
      button.geometry.dispose();
      button.material.dispose();
      button.userData.texture.dispose();
    }
  }
}
