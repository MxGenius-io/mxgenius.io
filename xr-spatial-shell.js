import * as THREE from 'three';

const MODES = Object.freeze({
  operations: { label: 'OPERATIONS', color: '#38bdf8' },
  maintenance: { label: 'MAINTENANCE', color: '#2dd4bf' }
});

const TOOL_DEFAULTS = Object.freeze([
  { id: 'thermal', label: 'THERMAL', icon: 'thermal', color: '#fb923c' },
  { id: 'witness', label: 'WITNESS', icon: 'witness', color: '#38bdf8' },
  { id: 'voice', label: 'VOICE', icon: 'voice', color: '#2dd4bf' },
  { id: 'capture', label: 'CAPTURE', icon: 'capture', color: '#a78bfa' }
]);

function rounded(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

export class XRSpatialShell {
  constructor({
    mode = 'operations',
    tools = [],
    onModeChange = () => {},
    onRecenter = () => {},
    onToolAction = () => {},
    onAction = () => {}
  } = {}) {
    this.mode = MODES[mode] ? mode : 'operations';
    this.onModeChange = onModeChange;
    this.onRecenter = onRecenter;
    this.onToolAction = onToolAction;
    this.onAction = onAction;
    this.presenting = false;
    this.disposed = false;
    this.placementPending = true;
    this.hoveredTarget = null;
    this.cameraPosition = new THREE.Vector3();
    this.cameraQuaternion = new THREE.Quaternion();
    this.forward = new THREE.Vector3();
    this.localPoint = new THREE.Vector3();

    this.group = new THREE.Group();
    this.group.name = 'MXGeniusSpatialShell';
    this.group.visible = false;

    this.backplate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68, tools.length ? 0.365 : 0.205),
      new THREE.MeshBasicMaterial({ color: 0x07131f, transparent: true, opacity: 0.92, toneMapped: false, side: THREE.DoubleSide })
    );
    this.backplate.name = 'MXGeniusSpatialTray';
    this.backplate.position.z = -0.012;
    this.group.add(this.backplate);

    this.buttons = [
      this.createModeButton('operations', -0.165, tools.length ? 0.08 : 0),
      this.createModeButton('maintenance', 0.165, tools.length ? 0.08 : 0)
    ];
    this.toolStates = new Map();
    this.toolButtons = tools.map((tool, index) => {
      const preset = TOOL_DEFAULTS.find((entry) => entry.id === tool.id) || {};
      const normalized = { ...preset, ...tool, enabled: tool.enabled !== false, active: Boolean(tool.active) };
      this.toolStates.set(normalized.id, normalized);
      return this.createToolButton(normalized, index, tools.length);
    });
    this.group.add(...this.buttons, ...this.toolButtons);
    this.draw();
  }

  createModeButton(mode, x, y = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const button = new THREE.Mesh(
      new THREE.PlaneGeometry(0.30, 0.155),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    button.name = mode === 'maintenance' ? 'MXGeniusMaintenanceMode' : 'MXGeniusOperationsMode';
    button.position.set(x, y, 0);
    button.userData.xrShellAction = 'select-mode';
    button.userData.xrShellMode = mode;
    button.userData.xrHitSize = { width: 0.30, height: 0.155 };
    button.userData.canvas = canvas;
    button.userData.context = canvas.getContext('2d');
    button.userData.texture = texture;
    return button;
  }

  createToolButton(tool, index, count) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 192;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const gap = 0.012;
    const width = (0.64 - gap * Math.max(0, count - 1)) / Math.max(1, count);
    const start = -0.32 + width / 2;
    const button = new THREE.Mesh(
      new THREE.PlaneGeometry(width, 0.12),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    button.name = `MXGeniusTool-${tool.id}`;
    button.position.set(start + index * (width + gap), -0.105, 0.001);
    button.userData.xrShellAction = 'select-tool';
    button.userData.xrShellTool = tool.id;
    button.userData.xrHitSize = { width, height: 0.12 };
    button.userData.canvas = canvas;
    button.userData.context = canvas.getContext('2d');
    button.userData.texture = texture;
    return button;
  }

  drawModeIcon(context, mode, x, y, color) {
    context.save();
    context.strokeStyle = color;
    context.lineWidth = 10;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (mode === 'maintenance') {
      context.beginPath();
      context.moveTo(x - 28, y + 25);
      context.lineTo(x + 22, y - 25);
      context.stroke();
      context.beginPath();
      context.arc(x + 31, y - 34, 22, 0.55, 4.15);
      context.stroke();
      context.beginPath();
      context.arc(x - 35, y + 33, 12, 0, Math.PI * 2);
      context.stroke();
    } else {
      context.beginPath();
      context.arc(x, y, 39, 0, Math.PI * 2);
      context.moveTo(x - 38, y);
      context.lineTo(x + 38, y);
      context.moveTo(x, y - 38);
      context.bezierCurveTo(x - 22, y - 19, x - 22, y + 19, x, y + 38);
      context.moveTo(x, y - 38);
      context.bezierCurveTo(x + 22, y - 19, x + 22, y + 19, x, y + 38);
      context.stroke();
    }
    context.restore();
  }

  drawToolIcon(context, icon, x, y, color) {
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 8;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    if (icon === 'thermal') {
      context.arc(x - 11, y + 17, 15, 0, Math.PI * 2);
      context.moveTo(x - 11, y + 2); context.lineTo(x - 11, y - 33);
      context.arc(x - 11, y - 33, 9, Math.PI, 0);
      context.moveTo(x + 16, y - 24); context.quadraticCurveTo(x + 36, y - 9, x + 16, y + 6);
      context.moveTo(x + 28, y - 34); context.quadraticCurveTo(x + 52, y - 9, x + 28, y + 16);
    } else if (icon === 'witness') {
      context.arc(x - 18, y - 15, 16, 0, Math.PI * 2);
      context.arc(x + 19, y - 15, 16, 0, Math.PI * 2);
      context.moveTo(x - 42, y + 28); context.quadraticCurveTo(x - 18, y + 1, x + 6, y + 28);
      context.moveTo(x - 5, y + 28); context.quadraticCurveTo(x + 19, y + 1, x + 43, y + 28);
    } else if (icon === 'voice') {
      context.roundRect(x - 16, y - 38, 32, 55, 16);
      context.moveTo(x - 32, y); context.quadraticCurveTo(x - 31, y + 34, x, y + 34);
      context.quadraticCurveTo(x + 31, y + 34, x + 32, y);
      context.moveTo(x, y + 34); context.lineTo(x, y + 48);
      context.moveTo(x - 20, y + 48); context.lineTo(x + 20, y + 48);
    } else {
      context.roundRect(x - 42, y - 27, 84, 58, 10);
      context.moveTo(x - 20, y - 27); context.lineTo(x - 10, y - 39); context.lineTo(x + 12, y - 39); context.lineTo(x + 22, y - 27);
      context.moveTo(x + 17, y + 2); context.arc(x, y + 2, 17, 0, Math.PI * 2);
    }
    context.stroke();
    context.restore();
  }

  draw() {
    for (const button of this.buttons) {
      const mode = button.userData.xrShellMode;
      const active = mode === this.mode;
      const config = MODES[mode];
      const context = button.userData.context;
      context.clearRect(0, 0, 512, 256);
      rounded(context, 10, 10, 492, 236, 34);
      context.fillStyle = active ? 'rgba(17, 57, 76, 0.98)' : 'rgba(10, 25, 40, 0.96)';
      context.fill();
      context.strokeStyle = active ? config.color : 'rgba(104, 137, 159, 0.55)';
      context.lineWidth = active ? 8 : 4;
      context.stroke();
      this.drawModeIcon(context, mode, 256, 86, active ? config.color : '#91a7ba');
      context.fillStyle = active ? '#edfaff' : '#a8bac8';
      context.font = '700 27px ui-monospace, monospace';
      context.textAlign = 'center';
      context.fillText(config.label, 256, 194);
      context.font = '20px system-ui, sans-serif';
      context.fillStyle = active ? '#86efdc' : '#68859a';
      context.fillText(active ? 'ACTIVE · TAP TO RECENTER' : 'OPEN', 256, 225);
      button.userData.texture.needsUpdate = true;
    }
    for (const button of this.toolButtons) {
      const tool = this.toolStates.get(button.userData.xrShellTool);
      const active = Boolean(tool?.active);
      const enabled = tool?.enabled !== false;
      const context = button.userData.context;
      context.clearRect(0, 0, 256, 192);
      rounded(context, 8, 8, 240, 176, 26);
      context.fillStyle = active ? 'rgba(17, 57, 76, 0.98)' : 'rgba(10, 25, 40, 0.96)';
      context.fill();
      context.strokeStyle = enabled ? (active ? tool.color : 'rgba(104, 137, 159, 0.72)') : 'rgba(71, 85, 105, 0.55)';
      context.lineWidth = active ? 7 : 4;
      context.stroke();
      this.drawToolIcon(context, tool.icon, 128, 70, enabled ? tool.color : '#64748b');
      context.fillStyle = enabled ? '#e4f5ff' : '#64748b';
      context.font = '700 24px ui-monospace, monospace';
      context.textAlign = 'center';
      context.fillText(tool.label, 128, 151);
      button.visible = this.mode === 'maintenance';
      button.userData.texture.needsUpdate = true;
    }
  }

  interactiveObjects() {
    if (!this.presenting) return [];
    return this.mode === 'maintenance' ? [...this.buttons, ...this.toolButtons] : this.buttons;
  }

  owns(object) {
    let node = object;
    while (node) {
      if (node.userData?.xrShellAction) return true;
      node = node.parent;
    }
    return false;
  }

  handleObject(object, input = 'xr') {
    if (!this.owns(object)) return false;
    let target = object;
    while (target && !target.userData?.xrShellAction) target = target.parent;
    const toolId = target?.userData?.xrShellTool;
    if (target?.userData?.xrShellAction === 'select-tool' && toolId) {
      const tool = this.toolStates.get(toolId);
      if (!tool || tool.enabled === false) return true;
      this.onToolAction(toolId, { input, tool: { ...tool } });
      this.onAction(`spatial-tool-${toolId}`, input, { tool: toolId, active: Boolean(tool.active) });
      return true;
    }
    const nextMode = target?.userData?.xrShellMode;
    if (!MODES[nextMode]) return false;
    if (nextMode === this.mode) {
      this.placementPending = true;
      this.onRecenter({ mode: this.mode, input });
      this.onAction('spatial-shell-recenter', input, { mode: this.mode });
      return true;
    }
    this.onAction('spatial-shell-mode', input, { from: this.mode, to: nextMode });
    this.onModeChange(nextMode, { from: this.mode, input });
    return true;
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
        this.hoveredTarget = button;
        return button;
      }
    }
    this.hoveredTarget = null;
    return null;
  }

  setToolState(id, state = {}) {
    const current = this.toolStates.get(id);
    if (!current) return false;
    this.toolStates.set(id, { ...current, ...state });
    this.draw();
    return true;
  }

  setMode(mode) {
    if (!MODES[mode] || mode === this.mode) return;
    this.mode = mode;
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
    this.forward.set(0, 0, -1).applyQuaternion(this.cameraQuaternion);
    this.group.position.copy(this.cameraPosition)
      .addScaledVector(this.forward, 1.05)
      .add(new THREE.Vector3(0, 0.52, 0));
    this.group.quaternion.copy(this.cameraQuaternion);
    this.placementPending = false;
  }

  update(delta, { camera = null } = {}) {
    if (this.disposed || !this.presenting) return;
    this.placeForView(camera);
    const blend = 1 - Math.exp(-Math.max(0, delta) * 14);
    for (const button of [...this.buttons, ...this.toolButtons]) {
      const mode = button.userData.xrShellMode;
      const target = button === this.hoveredTarget ? 1.1 : mode === this.mode ? 1.035 : 1;
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
    for (const button of [...this.buttons, ...this.toolButtons]) {
      button.geometry.dispose();
      button.material.dispose();
      button.userData.texture.dispose();
    }
  }
}
