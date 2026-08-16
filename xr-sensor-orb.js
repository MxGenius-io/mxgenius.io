import * as THREE from 'three';

const BRIDGE_STORAGE_KEY = 'mxg_sensor_bridge_url';
const TOKEN_STORAGE_KEY = 'mxg_sensor_bridge_token';
const FRAME_MAGIC = 0x4d584753;

function clean(value, fallback = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

function configuredBridge() {
  const query = new URLSearchParams(location.search);
  const url = query.get('sensorBridge')
    || globalThis.MXGENIUS_CONFIG?.sensorBridgeUrl
    || localStorage.getItem(BRIDGE_STORAGE_KEY)
    || '';
  const token = query.get('sensorToken') || localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  if (!url) return { url: '', token };
  try {
    const parsed = new URL(url, location.href);
    if (!['ws:', 'wss:'].includes(parsed.protocol)) return { url: '', token };
    if (token && !parsed.searchParams.has('token')) parsed.searchParams.set('token', token);
    return { url: parsed.href, token };
  } catch {
    return { url: '', token };
  }
}

function formatBytes(value = 0) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = Number(value) || 0;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
}

function ironColor(normalized) {
  const value = THREE.MathUtils.clamp(normalized, 0, 1);
  if (value < 0.25) return [Math.round(value * 4 * 70), 0, Math.round(45 + value * 4 * 130)];
  if (value < 0.55) return [Math.round(70 + (value - 0.25) * 3.33 * 185), Math.round((value - 0.25) * 3.33 * 55), Math.round(175 - (value - 0.25) * 3.33 * 120)];
  if (value < 0.82) return [255, Math.round(55 + (value - 0.55) * 3.7 * 185), Math.round(55 - (value - 0.55) * 3.7 * 45)];
  return [255, 240 + Math.round((value - 0.82) * 83), Math.round((value - 0.82) * 5.55 * 230)];
}

function applyDiagnosticsDelta(state, delta) {
  if (!state || state.sequence !== delta.baseSequence) return null;
  const next = structuredClone(state);
  for (const operation of delta.operations || []) {
    const parts = String(operation.path || '').split('/').slice(1).map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
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

export class XRSensorOrb {
  constructor({ sessionId = null, onAction = () => {}, onStatus = () => {} } = {}) {
    this.sessionId = clean(sessionId) || null;
    this.onAction = onAction;
    this.onStatus = onStatus;
    this.presenting = false;
    this.preflighting = false;
    this.active = false;
    this.state = 'unconfigured';
    this.socket = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.diagnostics = null;
    this.sourceStatus = 'standby';
    this.companionStatus = 'unknown';
    this.nodes = new Map();
    this.scans = [];
    this.frames = 0;
    this.lastFrameAt = 0;
    this.rightHand = null;
    this.rightController = null;
    this.cameraPosition = new THREE.Vector3();
    this.cameraQuaternion = new THREE.Quaternion();
    this.hitPosition = new THREE.Vector3();
    this.fallbackOffset = new THREE.Vector3(0.42, -0.2, -0.66);
    this.bridge = configuredBridge();

    this.group = new THREE.Group();
    this.group.name = 'MXGeniusSensorOrb';
    this.group.position.set(0.48, 1.18, -0.82);
    this.group.visible = false;

    this.thermalCanvas = document.createElement('canvas');
    this.thermalCanvas.width = 320;
    this.thermalCanvas.height = 240;
    this.thermalContext = this.thermalCanvas.getContext('2d', { alpha: false });
    this.thermalTexture = new THREE.CanvasTexture(this.thermalCanvas);
    this.thermalTexture.colorSpace = THREE.SRGBColorSpace;
    this.drawStandbyTexture();

    this.orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.115, 48, 32),
      new THREE.MeshBasicMaterial({ map: this.thermalTexture, color: 0x86cdd6, transparent: true, opacity: 0.72, toneMapped: false })
    );
    this.orb.name = 'MXGeniusThermalSurface';
    this.group.add(this.orb);

    this.shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.127, 2),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true, transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false })
    );
    this.group.add(this.shell);

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.145, 0.004, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.8, toneMapped: false })
    );
    this.ring.rotation.x = Math.PI / 2;
    this.group.add(this.ring);

    this.hitTarget = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 20, 14),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false })
    );
    this.hitTarget.name = 'MXGeniusSensorToggle';
    this.hitTarget.userData.xrSensorAction = 'toggle-sensor-orb';
    this.group.add(this.hitTarget);

    this.panelCanvas = document.createElement('canvas');
    this.panelCanvas.width = 1024;
    this.panelCanvas.height = 640;
    this.panelContext = this.panelCanvas.getContext('2d');
    this.panelTexture = new THREE.CanvasTexture(this.panelCanvas);
    this.panelTexture.colorSpace = THREE.SRGBColorSpace;
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.45),
      new THREE.MeshBasicMaterial({ map: this.panelTexture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    this.panel.name = 'MXGeniusDiagnosticsPanel';
    this.panel.position.set(-0.5, 0.1, -0.03);
    this.panel.scale.setScalar(0.001);
    this.group.add(this.panel);
    this.drawPanel();
  }

  interactiveObjects() {
    return [this.hitTarget];
  }

  setAnchors({ rightHand = null, rightController = null } = {}) {
    this.rightHand = rightHand || this.rightHand;
    this.rightController = rightController || this.rightController;
  }

  setPresenting(presenting) {
    this.presenting = Boolean(presenting);
    this.group.visible = this.presenting;
    if (this.presenting) this.connect();
    if (!this.presenting) this.setActive(false, 'session-end');
  }

  startPreflight() {
    this.preflighting = true;
    this.connect();
  }

  setActive(active, input = 'unknown') {
    this.active = Boolean(active);
    this.panel.material.visible = this.active;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'thermal.control', enabled: this.active, input }));
    }
    this.onAction('toggle-sensor-orb', input, { active: this.active, state: this.state, frames: this.frames });
    this.drawPanel();
  }

  handleObject(object, input = 'unknown') {
    let node = object;
    while (node && !node.userData?.xrSensorAction) node = node.parent;
    if (!node) return false;
    this.setActive(!this.active, input);
    return true;
  }

  fingerTargetAt(point) {
    if (!this.presenting || !this.group.visible) return null;
    this.hitTarget.getWorldPosition(this.hitPosition);
    return this.hitPosition.distanceTo(point) <= 0.17 ? this.hitTarget : null;
  }

  connect() {
    if (!this.bridge.url || this.socket || (!this.presenting && !this.preflighting)) {
      if (!this.bridge.url) this.setState('unconfigured');
      return;
    }
    this.setState('connecting');
    try {
      const socket = new WebSocket(this.bridge.url);
      socket.binaryType = 'arraybuffer';
      this.socket = socket;
      socket.addEventListener('open', () => {
        this.reconnectAttempt = 0;
        this.setState('connected');
        socket.send(JSON.stringify({
          type: 'node.announce',
          nodeType: 'xr-client',
          nodeName: 'MXG Fleet Globe',
          capabilities: ['thermal-display', 'diagnostics-display', 'webxr'],
          surface: 'fleet-globe'
        }));
        if (this.sessionId) socket.send(JSON.stringify({ type: 'bridge.session', sessionId: this.sessionId }));
      });
      socket.addEventListener('message', (event) => this.handleMessage(event));
      socket.addEventListener('close', () => {
        if (this.socket === socket) this.socket = null;
        this.setState('disconnected');
        this.scheduleReconnect();
      });
      socket.addEventListener('error', () => this.setState('failed'));
    } catch {
      this.socket = null;
      this.setState('failed');
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if ((!this.presenting && !this.preflighting) || !this.bridge.url || this.reconnectTimer) return;
    const delay = Math.min(15000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  setState(state) {
    this.state = state;
    const colors = { unconfigured: 0x64748b, connecting: 0xf59e0b, connected: 0x22d3ee, streaming: 0xfb923c, disconnected: 0x64748b, failed: 0xfb7185 };
    this.ring.material.color.setHex(colors[state] || colors.disconnected);
    this.onStatus({ state, sourceStatus: this.sourceStatus, companionStatus: this.companionStatus, frames: this.frames });
    this.drawPanel();
  }

  handleMessage(event) {
    if (typeof event.data === 'string') {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'bridge.hello') {
          this.bridgeHello = message;
          this.drawPanel();
        } else if (message.type === 'diagnostics.snapshot' || message.type === 'diagnostics.summary' || message.type === 'diagnostics.state') {
          this.diagnostics = message;
          this.drawPanel();
          window.dispatchEvent(new CustomEvent('mxgenius:sensor-diagnostics', { detail: message }));
        } else if (message.type === 'diagnostics.delta') {
          const next = applyDiagnosticsDelta(this.diagnostics, message);
          if (!next) {
            this.socket?.send(JSON.stringify({ type: 'diagnostics.resync' }));
            return;
          }
          this.diagnostics = next;
          this.drawPanel();
          window.dispatchEvent(new CustomEvent('mxgenius:sensor-diagnostics', { detail: next }));
        } else if (message.type === 'scan.observed') {
          this.scans.unshift(message);
          this.scans.splice(5);
          this.drawPanel();
          window.dispatchEvent(new CustomEvent('mxgenius:scan-observed', { detail: message }));
        } else if (message.type === 'source.status') {
          this.sourceStatus = message.status || 'unknown';
          if (message.sourceType === 'flir-one-pro') this.companionStatus = message.status === 'offline' ? 'offline' : 'ready';
          this.onStatus({ state: this.state, sourceStatus: this.sourceStatus, companionStatus: this.companionStatus, frames: this.frames });
          this.drawPanel();
        } else if (message.type === 'node.status' && message.node?.nodeId) {
          if (message.status === 'disconnected') this.nodes.delete(message.node.nodeId);
          else this.nodes.set(message.node.nodeId, message.node);
          const hasFlirCompanion = [...this.nodes.values()].some((node) =>
            Array.isArray(node.capabilities) && node.capabilities.includes('flir-one-pro-usb-c'));
          this.companionStatus = hasFlirCompanion ? 'ready' : 'missing';
          this.onStatus({ state: this.state, sourceStatus: this.sourceStatus, companionStatus: this.companionStatus, frames: this.frames });
          this.drawPanel();
        }
      } catch {
        this.setState('failed');
      }
      return;
    }
    this.decodeFrame(event.data).catch(() => this.setState('failed'));
  }

  async decodeFrame(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 24 || view.getUint32(0, false) !== FRAME_MAGIC || view.getUint8(4) !== 1) return;
    const format = view.getUint8(6);
    const width = view.getUint16(8, true);
    const height = view.getUint16(10, true);
    const metadataLength = view.getUint32(20, true);
    const offset = 24 + metadataLength;
    if (!width || !height || offset > buffer.byteLength) return;
    const payload = buffer.slice(offset);
    this.thermalCanvas.width = width;
    this.thermalCanvas.height = height;
    if (format === 1) {
      const bitmap = await createImageBitmap(new Blob([payload], { type: 'image/jpeg' }));
      this.thermalContext.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
    } else if (format === 2 && payload.byteLength >= width * height * 4) {
      const pixels = new Uint8ClampedArray(payload, 0, width * height * 4);
      this.thermalContext.putImageData(new ImageData(pixels, width, height), 0, 0);
    } else if (format === 3 && payload.byteLength >= width * height * 2) {
      this.drawY16(new DataView(payload), width, height);
    } else {
      return;
    }
    this.frames += 1;
    this.lastFrameAt = performance.now();
    this.thermalTexture.needsUpdate = true;
    this.sourceStatus = 'streaming';
    this.setState('streaming');
  }

  drawY16(source, width, height) {
    let minimum = 65535;
    let maximum = 0;
    for (let offset = 0; offset < width * height * 2; offset += 2) {
      const value = source.getUint16(offset, true);
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    const range = Math.max(1, maximum - minimum);
    const image = this.thermalContext.createImageData(width, height);
    for (let index = 0; index < width * height; index += 1) {
      const value = source.getUint16(index * 2, true);
      const [red, green, blue] = ironColor((value - minimum) / range);
      const target = index * 4;
      image.data[target] = red;
      image.data[target + 1] = green;
      image.data[target + 2] = blue;
      image.data[target + 3] = 255;
    }
    this.thermalContext.putImageData(image, 0, 0);
  }

  drawStandbyTexture() {
    const context = this.thermalContext;
    const { width, height } = this.thermalCanvas;
    const gradient = context.createRadialGradient(width * 0.5, height * 0.45, 8, width * 0.5, height * 0.5, width * 0.65);
    gradient.addColorStop(0, '#155167');
    gradient.addColorStop(0.55, '#071c2a');
    gradient.addColorStop(1, '#020710');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(65,215,231,.2)';
    for (let x = 0; x < width; x += 32) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
    }
    for (let y = 0; y < height; y += 24) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
    this.thermalTexture.needsUpdate = true;
  }

  drawPanel() {
    const ctx = this.panelContext;
    const data = this.diagnostics || {};
    const bridge = data.bridge || {};
    const metrics = data.metrics || {};
    const hardware = data.hardware || {};
    const cpuPercent = metrics['cpu.utilization']?.value ?? metrics.cpuPercent;
    const temperature = metrics['cpu.temperature']?.value ?? metrics.temperatureC;
    const memoryPercent = metrics['memory.utilization']?.value ?? metrics.memoryPercent;
    const transports = Object.values(data.transports || {});
    const findingCount = Array.isArray(data.findings) ? data.findings.length : Object.keys(data.findings || {}).length;
    ctx.clearRect(0, 0, this.panelCanvas.width, this.panelCanvas.height);
    ctx.fillStyle = 'rgba(4, 13, 24, 0.96)';
    ctx.fillRect(0, 0, this.panelCanvas.width, this.panelCanvas.height);
    ctx.strokeStyle = this.state === 'failed' ? '#fb7185' : this.state === 'streaming' ? '#fb923c' : '#22d3ee';
    ctx.lineWidth = 7;
    ctx.strokeRect(4, 4, 1016, 632);
    ctx.fillStyle = '#67e8f9';
    ctx.font = '700 30px ui-monospace, monospace';
    ctx.fillText('MXG SENSOR CHAIN', 42, 58);
    ctx.fillStyle = '#e9f8ff';
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillText(`${clean(this.state, 'offline').toUpperCase()} · ${clean(this.sourceStatus, 'standby').toUpperCase()}`, 42, 98);
    const rows = [
      ['PI NODE', clean(data.host?.name || data.node, 'not connected')],
      ['CPU', data.cpu ? `${Number(data.cpu.usedPercent || 0).toFixed(1)}% · ${data.cpu.temperatureC ?? '—'}°C` : cpuPercent != null ? `${Number(cpuPercent).toFixed(1)}% · ${temperature ?? '—'}°C` : '—'],
      ['MEMORY', data.memory ? `${Number(data.memory.usedPercent || 0).toFixed(1)}% · ${formatBytes(data.memory.availableBytes)} free` : memoryPercent != null ? `${Number(memoryPercent).toFixed(1)}%` : '—'],
      ['TRANSPORTS', transports.length ? `${transports.filter((item) => item.status === 'online').length}/${transports.length} online` : `${hardware.usbDevices ?? '—'} USB / ${hardware.serialPorts ?? '—'} serial`],
      ['FINDINGS', data.findings ? `${findingCount} active` : data.portProbes ? `${data.portProbes.filter((item) => item.status !== 'open').length} active` : '—'],
      ['XR / SOURCES', `${bridge.consumers ?? 0} / ${bridge.sources ?? 0}`],
      ['THERMAL FRAMES', String(this.frames || bridge.thermalFrames || 0)],
      ['LATEST SCAN', this.scans[0]?.normalized?.partNumber || this.scans[0]?.normalized?.serialNumber || this.scans[0]?.normalized?.identifierCandidate || '—']
    ];
    let y = 158;
    for (const [label, value] of rows) {
      ctx.fillStyle = '#7f9daf';
      ctx.font = '700 19px ui-monospace, monospace';
      ctx.fillText(label, 42, y);
      ctx.fillStyle = '#eefaff';
      ctx.font = '600 25px ui-monospace, monospace';
      ctx.fillText(clean(value, '—').slice(0, 52), 330, y);
      y += 55;
    }
    ctx.fillStyle = '#8ba6b8';
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(this.bridge.url ? 'Tap the orb to activate or suspend the thermal source.' : 'Configure ?sensorBridge=wss://host/ws/xr to connect.', 42, 600);
    this.panelTexture.needsUpdate = true;
  }

  update(delta, time, { camera = null } = {}) {
    if (!this.presenting) return;
    const wrist = this.rightHand?.joints?.wrist;
    const anchor = wrist?.visible ? wrist : this.rightController;
    if (anchor && this.group.parent !== anchor) anchor.attach(this.group);
    if (anchor) {
      this.group.position.lerp(new THREE.Vector3(0.1, 0.12, -0.08), 1 - Math.exp(-delta * 16));
    } else if (camera) {
      camera.getWorldPosition(this.cameraPosition);
      camera.getWorldQuaternion(this.cameraQuaternion);
      const desired = this.fallbackOffset.clone().applyQuaternion(this.cameraQuaternion).add(this.cameraPosition);
      this.group.position.lerp(desired, 1 - Math.exp(-delta * 12));
      this.group.lookAt(this.cameraPosition);
    }
    const targetScale = this.active ? 1 : 0.58;
    this.orb.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 1 - Math.exp(-delta * 10));
    this.orb.material.opacity = this.active ? 1 : 0.55;
    this.shell.rotation.x += delta * 0.16;
    this.shell.rotation.y -= delta * (this.active ? 0.42 : 0.18);
    this.shell.material.opacity = this.active ? 0.48 : 0.2 + Math.sin(time * 0.003) * 0.06;
    this.ring.rotation.z += delta * (this.active ? 1.4 : 0.38);
    const panelTarget = this.active ? 1 : 0.001;
    const panelScale = THREE.MathUtils.lerp(this.panel.scale.x, panelTarget, 1 - Math.exp(-delta * 11));
    this.panel.scale.setScalar(Math.max(0.001, panelScale));
  }
}
