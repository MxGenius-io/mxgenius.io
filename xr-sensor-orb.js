import * as THREE from 'three';
import {
  applyDiagnosticsDelta,
  DEFAULT_SCHEMA_URL,
  formatDiagnosticsLayout,
  loadDiagnosticsLayout
} from './xr-diagnostics-layout.js';

const THERMAL_BRIDGE_STORAGE_KEY = 'mxg_thermal_bridge_url';
const THERMAL_TOKEN_STORAGE_KEY = 'mxg_thermal_bridge_token';
const PI_DIAGNOSTICS_BRIDGE_STORAGE_KEY = 'mxg_pi_diagnostics_bridge_url';
const FRAME_MAGIC = 0x4d584753;
const MAX_THERMAL_PIXELS = 1920 * 1080;
const MAX_HANDSHAKE_TRACE_ENTRIES = 64;
const MAX_SNAPSHOT_DATA_URL_CHARS = 1_450_000;
const SNAPSHOT_TIMEOUT_MS = 10_000;

function clean(value, fallback = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

function traceSafe(value, fallback = '—') {
  return clean(value, fallback)
    .replace(/([?&](?:token|localToken|access_token)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/(authorization\s*[:=]\s*(?:bearer|basic)\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/((?:token|localToken|access_token)\s*[:=]\s*)["']?[A-Za-z0-9._~-]{8,256}["']?/gi, '$1[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\b[0-9a-f]{64}\b/gi, '[redacted]');
}

function bridgeLabel(value) {
  try {
    const parsed = new URL(value, location.href);
    const host = parsed.hostname === '127.0.0.1' ? 'Quest loopback' : parsed.hostname;
    return `${host} ${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return 'invalid thermal endpoint';
  }
}

function normalizedSocket(url, token = '') {
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

function configuredThermalBridge({ url: preferredUrl = '', token: preferredToken = '' } = {}) {
  const query = new URLSearchParams(location.search);
  const url = preferredUrl
    || query.get('thermalBridge')
    || globalThis.MXGENIUS_CONFIG?.thermalBridgeUrl
    || localStorage.getItem(THERMAL_BRIDGE_STORAGE_KEY)
    || '';
  const token = preferredToken || query.get('thermalToken') || localStorage.getItem(THERMAL_TOKEN_STORAGE_KEY) || '';
  return normalizedSocket(url, token);
}

function configuredDiagnosticsBridge({ url: preferredUrl = '' } = {}) {
  const query = new URLSearchParams(location.search);
  return normalizedSocket(preferredUrl
    || query.get('piDiagnosticsBridge')
    || globalThis.MXGENIUS_CONFIG?.piDiagnosticsBridgeUrl
    || localStorage.getItem(PI_DIAGNOSTICS_BRIDGE_STORAGE_KEY)
    || '');
}

function configuredDiagnosticsSchemas() {
  const query = new URLSearchParams(location.search);
  const configured = query.get('sensorSchema')
    || globalThis.MXGENIUS_CONFIG?.sensorDiagnosticsSchemaUrl
    || DEFAULT_SCHEMA_URL;
  const urls = [configured];
  if (['localhost', '127.0.0.1'].includes(location.hostname) && configured === DEFAULT_SCHEMA_URL) {
    urls.push('services/xr-diagnostics-kiosk/contracts/diagnostics-state.schema.json');
  }
  return urls;
}

function ironColor(normalized) {
  const value = THREE.MathUtils.clamp(normalized, 0, 1);
  if (value < 0.25) return [Math.round(value * 4 * 70), 0, Math.round(45 + value * 4 * 130)];
  if (value < 0.55) return [Math.round(70 + (value - 0.25) * 3.33 * 185), Math.round((value - 0.25) * 3.33 * 55), Math.round(175 - (value - 0.25) * 3.33 * 120)];
  if (value < 0.82) return [255, Math.round(55 + (value - 0.55) * 3.7 * 185), Math.round(55 - (value - 0.55) * 3.7 * 45)];
  return [255, 240 + Math.round((value - 0.82) * 83), Math.round((value - 0.82) * 5.55 * 230)];
}

export class XRSensorOrb {
  constructor({
    sessionId = null,
    bridgeUrl = '',
    bridgeToken = '',
    diagnosticsBridgeUrl = '',
    remoteWitnessUrl = '',
    surface = 'fleet-globe',
    presentation = 'wrist-orb',
    screenScale = 1,
    headOffset = { x: 0, y: 0.16, z: -1.12 },
    bridgeHandoff = false,
    onAction = () => {},
    onStatus = () => {},
    onTrace = () => {}
  } = {}) {
    this.sessionId = clean(sessionId) || null;
    this.surface = clean(surface, 'fleet-globe');
    this.presentation = presentation === 'head-screen' ? 'head-screen' : 'wrist-orb';
    this.screenScale = THREE.MathUtils.clamp(Number(screenScale) || 1, 0.65, 1.6);
    this.headOffset = new THREE.Vector3(
      Number(headOffset?.x) || 0,
      Number(headOffset?.y) || 0,
      Number(headOffset?.z) || -1.12
    );
    this.bridgeHandoff = Boolean(bridgeHandoff);
    this.onAction = onAction;
    this.onStatus = onStatus;
    this.onTrace = onTrace;
    this.traceStartedAt = performance.now();
    this.handshakeTrace = [];
    this.traceThrottle = new Map();
    this.presenting = false;
    this.preflighting = false;
    this.disposed = false;
    this.active = this.presentation === 'head-screen';
    this.screenPinned = false;
    this.state = 'unconfigured';
    this.socket = null;
    this.pendingSnapshots = new Map();
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.diagnosticsState = 'unconfigured';
    this.diagnosticsSocket = null;
    this.diagnosticsReconnectTimer = null;
    this.diagnosticsReconnectAttempt = 0;
    this.diagnostics = null;
    this.sourceStatus = 'standby';
    this.bridgeRuntimeStatus = 'unknown';
    this.companionStatus = 'unknown';
    this.nodes = new Map();
    this.scans = [];
    this.frames = 0;
    this.lastFrameAt = 0;
    this.latestFrameTimestamp = 0n;
    this.commissioning = null;
    this.commissioningFrameBaseline = 0;
    this.commissioningAckSent = false;
    this.rightHand = null;
    this.rightController = null;
    this.cameraPosition = new THREE.Vector3();
    this.cameraQuaternion = new THREE.Quaternion();
    this.headTargetPosition = new THREE.Vector3();
    this.hitPosition = new THREE.Vector3();
    this.fallbackOffset = new THREE.Vector3(0.42, -0.2, -0.66);
    this.bridge = configuredThermalBridge({ url: bridgeUrl, token: bridgeToken });
    this.diagnosticsBridge = configuredDiagnosticsBridge({ url: diagnosticsBridgeUrl });
    this.remoteWitnessState = remoteWitnessUrl ? 'configured' : 'unconfigured';
    this.diagnosticsSchemaUrls = configuredDiagnosticsSchemas();
    this.diagnosticsLayout = null;
    this.diagnosticsLayoutState = 'loading';

    this.group = new THREE.Group();
    this.group.name = this.presentation === 'head-screen' ? 'MXGeniusThermalScreenRig' : 'MXGeniusSensorOrb';
    this.group.position.set(0.48, 1.18, -0.82);
    this.group.visible = false;

    this.thermalCanvas = document.createElement('canvas');
    this.thermalCanvas.width = 320;
    this.thermalCanvas.height = 240;
    this.thermalContext = this.thermalCanvas.getContext('2d', { alpha: false });
    this.thermalTexture = new THREE.CanvasTexture(this.thermalCanvas);
    this.thermalTexture.colorSpace = THREE.SRGBColorSpace;
    this.thermalTexture.minFilter = THREE.LinearFilter;
    this.thermalTexture.magFilter = THREE.NearestFilter;
    this.thermalTexture.generateMipmaps = false;
    this.drawStandbyTexture();

    this.orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.115, 48, 32),
      new THREE.MeshBasicMaterial({ map: this.thermalTexture, color: 0x86cdd6, transparent: true, opacity: 0.72, toneMapped: false })
    );
    this.orb.name = 'MXGeniusThermalSurface';
    this.orb.visible = this.presentation === 'wrist-orb';
    this.group.add(this.orb);

    this.shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.127, 2),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true, transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false })
    );
    this.shell.visible = this.presentation === 'wrist-orb';
    this.group.add(this.shell);

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.145, 0.004, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.8, toneMapped: false })
    );
    this.ring.visible = this.presentation === 'wrist-orb';
    this.ring.rotation.x = Math.PI / 2;
    this.group.add(this.ring);

    this.hitTarget = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 20, 14),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false })
    );
    this.hitTarget.name = 'MXGeniusSensorToggle';
    this.hitTarget.userData.xrSensorAction = 'toggle-sensor-orb';
    this.hitTarget.visible = this.presentation === 'wrist-orb';
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
    this.panel.position.set(this.presentation === 'head-screen' ? -0.88 : -0.5, this.presentation === 'head-screen' ? 0.02 : 0.1, -0.03);
    this.panel.scale.setScalar(0.001);
    this.group.add(this.panel);

    this.screenRoot = new THREE.Group();
    this.screenRoot.name = 'MXGeniusThermalScreen';
    this.screenRoot.visible = this.presentation === 'head-screen' && this.active;
    this.screenFrame = new THREE.Mesh(
      new THREE.PlaneGeometry(1.02, 0.78),
      new THREE.MeshBasicMaterial({ color: 0x07131f, transparent: true, opacity: 0.98, toneMapped: false, side: THREE.DoubleSide })
    );
    this.screenFrame.position.z = -0.008;
    this.screenRoot.add(this.screenFrame);
    this.thermalScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.72),
      new THREE.MeshBasicMaterial({ map: this.thermalTexture, toneMapped: false, side: THREE.DoubleSide })
    );
    this.thermalScreen.name = 'MXGeniusThermalPixels';
    this.screenRoot.add(this.thermalScreen);
    this.group.add(this.screenRoot);

    this.screenControls = new THREE.Group();
    this.screenControls.name = 'MXGeniusThermalControls';
    this.screenControls.visible = this.presentation === 'head-screen';
    this.group.add(this.screenControls);
    this.screenToggle = this.createScreenButton('MXGeniusThermalToggle', 'toggle-thermal-screen', 0.27);
    this.screenPin = this.createScreenButton('MXGeniusThermalPin', 'pin-thermal-screen', 0.2);
    this.screenScaleDown = this.createScreenButton('MXGeniusThermalScaleDown', 'thermal-scale-down', 0.18);
    this.screenScaleUp = this.createScreenButton('MXGeniusThermalScaleUp', 'thermal-scale-up', 0.18);
    this.screenControls.add(this.screenToggle, this.screenPin, this.screenScaleDown, this.screenScaleUp);

    this.voiceDock = new THREE.Object3D();
    this.voiceDock.name = 'MXGeniusAIPanelDock';
    this.voiceDock.visible = this.presentation === 'head-screen';
    this.group.add(this.voiceDock);
    this.applyScreenLayout();
    this.trace('W01 PAIR', `${this.bridgeHandoff ? 'native bridge handoff restored' : 'browser session prepared'} · session ${this.sessionId?.slice(0, 8) || 'none'}`, 'success');
    this.trace('TARGET', this.bridge.url ? bridgeLabel(this.bridge.url) : 'thermal transport not configured', this.bridge.url ? 'info' : 'warn');
    this.drawPanel();
    this.drawScreenButtons();
    this.loadLayout();
  }

  trace(stage, message, level = 'info', { key = '', throttleMs = 0 } = {}) {
    if (this.disposed) return;
    const now = performance.now();
    const throttleKey = key || `${stage}:${message}`;
    const lastAt = this.traceThrottle.get(throttleKey) || 0;
    if (throttleMs && now - lastAt < throttleMs) return;
    this.traceThrottle.set(throttleKey, now);
    const entry = {
      elapsedMs: Math.max(0, Math.round(now - this.traceStartedAt)),
      stage: traceSafe(stage, 'TRACE').slice(0, 18).toUpperCase(),
      message: traceSafe(message).slice(0, 96),
      level: ['info', 'success', 'warn', 'error'].includes(level) ? level : 'info'
    };
    this.handshakeTrace.push(entry);
    this.handshakeTrace.splice(0, Math.max(0, this.handshakeTrace.length - MAX_HANDSHAKE_TRACE_ENTRIES));
    this.onTrace({ entry: { ...entry }, entries: this.handshakeTrace.map((item) => ({ ...item })) });
    if (this.panelTexture) this.drawPanel();
  }

  createScreenButton(name, action, width) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const button = new THREE.Mesh(
      new THREE.PlaneGeometry(width, 0.085),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    button.name = name;
    button.userData.xrSensorAction = action;
    button.userData.xrHitSize = { width, height: 0.085 };
    button.userData.canvas = canvas;
    button.userData.context = canvas.getContext('2d');
    button.userData.texture = texture;
    return button;
  }

  applyScreenLayout() {
    this.screenRoot.scale.setScalar(this.screenScale);
    const baseY = -0.43 * this.screenScale - 0.08;
    this.screenToggle.position.set(-0.38, baseY, 0.014);
    this.screenPin.position.set(-0.12, baseY, 0.014);
    this.screenScaleDown.position.set(0.1, baseY, 0.014);
    this.screenScaleUp.position.set(0.31, baseY, 0.014);
    this.voiceDock.position.set(0.53, baseY + 0.015, 0.02);
    this.panel.position.x = -0.42 * this.screenScale - 0.34;
    this.drawScreenButtons();
  }

  drawScreenButton(button, label, active = false) {
    const { canvas, context: ctx, texture } = button.userData;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(5, 18, 31, 0.96)';
    ctx.fillRect(4, 4, canvas.width - 8, canvas.height - 8);
    ctx.strokeStyle = active ? '#fb923c' : '#22d3ee';
    ctx.lineWidth = 7;
    ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
    ctx.fillStyle = '#eaf7ff';
    ctx.font = '700 38px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, canvas.width / 2, 101);
    texture.needsUpdate = true;
  }

  drawScreenButtons() {
    if (!this.screenToggle) return;
    this.drawScreenButton(this.screenToggle, this.active ? 'HIDE THERMAL' : 'SHOW THERMAL', this.active);
    this.drawScreenButton(this.screenPin, this.screenPinned ? 'FOLLOW HEAD' : 'PIN HERE', this.screenPinned);
    this.drawScreenButton(this.screenScaleDown, 'SIZE −');
    this.drawScreenButton(this.screenScaleUp, 'SIZE +');
  }

  async loadLayout() {
    let lastError = null;
    for (const schemaUrl of this.diagnosticsSchemaUrls) {
      try {
        this.diagnosticsLayout = await loadDiagnosticsLayout({ schemaUrl });
        if (this.disposed) return;
        this.diagnosticsLayoutState = 'ready';
        this.drawPanel();
        return;
      } catch (error) {
        lastError = error;
      }
    }
    this.diagnosticsLayout = null;
    this.diagnosticsLayoutState = 'unavailable';
    console.warn('XR diagnostics layout unavailable', lastError);
    this.drawPanel();
  }

  interactiveObjects() {
    return this.presentation === 'head-screen'
      ? [this.screenToggle, this.screenPin, this.screenScaleDown, this.screenScaleUp]
      : [this.hitTarget];
  }

  setAnchors({ rightHand = null, rightController = null } = {}) {
    if (this.presentation === 'head-screen') return;
    this.rightHand = rightHand || this.rightHand;
    this.rightController = rightController || this.rightController;
  }

  setPresenting(presenting) {
    if (this.disposed) return;
    this.presenting = Boolean(presenting);
    this.group.visible = this.presenting;
    if (this.presenting) {
      this.trace('XR', 'immersive session started');
      this.connect();
      if (this.presentation === 'head-screen') this.sendThermalControl('session-start');
    } else if (this.presentation === 'head-screen') {
      this.trace('XR', 'immersive session ended · thermal display disabled');
      this.sendThermalControl('session-end', false);
      this.setScreenPinned(false, 'session-end');
    } else {
      this.setActive(false, 'session-end');
    }
  }

  startPreflight() {
    if (this.disposed) return;
    this.preflighting = true;
    this.trace('PREFLIGHT', 'starting thermal and diagnostics checks');
    this.connect();
  }

  setActive(active, input = 'unknown') {
    this.active = Boolean(active);
    if (this.presentation === 'head-screen') {
      this.screenRoot.visible = this.active;
      this.drawScreenButtons();
      this.sendThermalControl(input);
      this.onAction('toggle-thermal-screen', input, { active: this.active, state: this.state, frames: this.frames });
    } else {
      this.panel.material.visible = this.active;
      this.sendThermalControl(input);
      this.onAction('toggle-sensor-orb', input, { active: this.active, state: this.state, frames: this.frames });
    }
    this.drawPanel();
  }

  sendThermalControl(input, enabled = this.active) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'thermal.control', enabled: Boolean(enabled), input }));
      this.trace('CONTROL', `${enabled ? 'enable' : 'disable'} thermal · ${input}`, 'info', {
        key: `control:${enabled}:${input}`,
        throttleMs: 500
      });
    }
  }

  requestHeadsetSnapshot({ timeoutMs = SNAPSHOT_TIMEOUT_MS } = {}) {
    if (this.disposed) return Promise.reject(new Error('Sensor scene is closed'));
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Quest snapshot bridge is not connected'));
    }
    const requestId = globalThis.crypto?.randomUUID?.()
      || `snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    const boundedTimeout = THREE.MathUtils.clamp(Number(timeoutMs) || SNAPSHOT_TIMEOUT_MS, 2000, 20000);
    this.trace('W11 SNAPSHOT', 'request sent · waiting for one Quest RGB frame', 'info');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSnapshots.delete(requestId);
        this.trace('W12 SNAPSHOT', 'timed out · companion did not return a frame', 'error');
        reject(new Error('Headset snapshot timed out'));
      }, boundedTimeout);
      this.pendingSnapshots.set(requestId, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ type: 'headset.snapshot.request', requestId }));
      } catch (error) {
        clearTimeout(timer);
        this.pendingSnapshots.delete(requestId);
        reject(error);
      }
    });
  }

  failPendingSnapshots(reason = 'Quest snapshot bridge disconnected') {
    for (const pending of this.pendingSnapshots.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingSnapshots.clear();
  }

  handleObject(object, input = 'unknown') {
    let node = object;
    while (node && !node.userData?.xrSensorAction) node = node.parent;
    if (!node) return false;
    if (node.userData.xrSensorAction === 'pin-thermal-screen') {
      this.setScreenPinned(!this.screenPinned, input);
      return true;
    }
    if (node.userData.xrSensorAction === 'thermal-scale-down') {
      this.setScreenScale(this.screenScale - 0.1, input);
      return true;
    }
    if (node.userData.xrSensorAction === 'thermal-scale-up') {
      this.setScreenScale(this.screenScale + 0.1, input);
      return true;
    }
    this.setActive(!this.active, input);
    return true;
  }

  setScreenScale(scale, input = 'unknown') {
    this.screenScale = THREE.MathUtils.clamp(Math.round(Number(scale) * 10) / 10, 0.65, 1.6);
    this.applyScreenLayout();
    this.onAction('thermal-screen-scale', input, { scale: this.screenScale });
  }

  setScreenPinned(pinned, input = 'unknown') {
    if (this.presentation !== 'head-screen') return;
    const next = Boolean(pinned);
    if (this.screenPinned === next) return;
    this.screenPinned = next;
    this.drawScreenButtons();
    this.trace('ANCHOR', next ? 'thermal screen pinned in world space' : 'thermal screen following headset', 'success');
    this.onAction('thermal-screen-anchor', input, { pinned: next });
  }

  fingerTargetAt(point) {
    if (!this.presenting || !this.group.visible) return null;
    if (this.presentation === 'head-screen') {
      for (const button of [this.screenToggle, this.screenPin, this.screenScaleDown, this.screenScaleUp]) {
        button.updateMatrixWorld(true);
        button.worldToLocal(this.hitPosition.copy(point));
        const { width, height } = button.userData.xrHitSize;
        if (Math.abs(this.hitPosition.z) < 0.04 && Math.abs(this.hitPosition.x) <= width / 2 && Math.abs(this.hitPosition.y) <= height / 2) {
          return button;
        }
      }
      return null;
    }
    this.hitTarget.getWorldPosition(this.hitPosition);
    return this.hitPosition.distanceTo(point) <= 0.17 ? this.hitTarget : null;
  }

  connect() {
    if (this.disposed) return;
    this.connectThermal();
    this.connectDiagnostics();
  }

  connectThermal() {
    if (!this.bridge.url || this.socket || (!this.presenting && !this.preflighting)) {
      if (!this.bridge.url) {
        this.trace('CONFIG', 'thermal transport is not configured', 'error', { key: 'thermal-unconfigured', throttleMs: 5000 });
        this.setState('unconfigured');
      }
      return;
    }
    const attempt = this.reconnectAttempt + 1;
    this.trace('W02 SOCKET', `attempt ${attempt} · ${bridgeLabel(this.bridge.url)}`);
    this.setState('connecting');
    try {
      const socket = new WebSocket(this.bridge.url);
      socket.binaryType = 'arraybuffer';
      this.socket = socket;
      socket.addEventListener('open', () => {
        this.reconnectAttempt = 0;
        this.trace('W03 SOCKET', 'open · browser reached Quest bridge', 'success');
        this.setState('connected');
        socket.send(JSON.stringify({
          type: 'node.announce',
          nodeType: 'xr-client',
          nodeName: this.surface === 'sensor-diagnostics' ? 'MXG Sensor Diagnostics' : 'MXG Fleet Globe',
          capabilities: ['thermal-display', 'webxr'],
          surface: this.surface
        }));
        this.trace('W04 CLIENT', `announce sent · ${this.surface}`, 'success');
        if (this.sessionId) {
          socket.send(JSON.stringify({ type: 'bridge.session', sessionId: this.sessionId }));
          this.trace('W05 SESSION', `bind sent · ${this.sessionId.slice(0, 8)}`, 'success');
        }
        if (this.presentation === 'head-screen') this.sendThermalControl('bridge-open');
      });
      socket.addEventListener('message', (event) => this.handleMessage(event));
      socket.addEventListener('close', (event) => {
        if (this.socket === socket) this.socket = null;
        this.failPendingSnapshots('Quest snapshot bridge disconnected');
        this.trace(
          'W00 SOCKET',
          `closed ${event.code || 1006} · ${event.reason || (event.wasClean ? 'clean close' : 'no bridge response')}`,
          event.wasClean ? 'warn' : 'error'
        );
        this.setState('disconnected');
        this.scheduleReconnect();
      });
      socket.addEventListener('error', () => {
        this.trace('W00 SOCKET', 'connection error · verify bridge is installed and running', 'error', {
          key: 'thermal-socket-error',
          throttleMs: 2000
        });
        this.setState('failed');
      });
    } catch (error) {
      this.socket = null;
      this.trace('W00 SOCKET', `open failed · ${error?.message || 'unknown error'}`, 'error');
      this.setState('failed');
      this.scheduleReconnect();
    }
  }

  connectDiagnostics() {
    if (!this.diagnosticsBridge.url || this.diagnosticsSocket || (!this.presenting && !this.preflighting)) {
      if (!this.diagnosticsBridge.url) {
        this.trace('PI', 'diagnostics transport not configured · FLIR remains independent', 'info', {
          key: 'pi-unconfigured',
          throttleMs: 10000
        });
        this.setDiagnosticsState('unconfigured');
      }
      return;
    }
    this.trace('PI SOCKET', `attempt ${this.diagnosticsReconnectAttempt + 1} · ${bridgeLabel(this.diagnosticsBridge.url)}`);
    this.setDiagnosticsState('connecting');
    try {
      const socket = new WebSocket(this.diagnosticsBridge.url);
      this.diagnosticsSocket = socket;
      socket.addEventListener('open', () => {
        this.diagnosticsReconnectAttempt = 0;
        this.trace('PI SOCKET', 'open · diagnostics bridge reached', 'success');
        this.setDiagnosticsState('connected');
        socket.send(JSON.stringify({
          type: 'node.announce',
          nodeType: 'xr-client',
          nodeName: this.surface === 'sensor-diagnostics' ? 'MXG Pi Diagnostics' : 'MXG Fleet Globe',
          capabilities: ['diagnostics-display', 'webxr'],
          surface: this.surface
        }));
        if (this.sessionId) socket.send(JSON.stringify({ type: 'bridge.session', sessionId: this.sessionId }));
      });
      socket.addEventListener('message', (event) => this.handleDiagnosticsMessage(event));
      socket.addEventListener('close', (event) => {
        if (this.diagnosticsSocket === socket) this.diagnosticsSocket = null;
        this.trace('PI SOCKET', `closed ${event.code || 1006} · ${event.reason || 'no reason'}`, 'warn');
        this.setDiagnosticsState('disconnected');
        this.scheduleDiagnosticsReconnect();
      });
      socket.addEventListener('error', () => {
        this.trace('PI SOCKET', 'connection error', 'error', { key: 'pi-socket-error', throttleMs: 2000 });
        this.setDiagnosticsState('failed');
      });
    } catch (error) {
      this.diagnosticsSocket = null;
      this.trace('PI SOCKET', `open failed · ${error?.message || 'unknown error'}`, 'error');
      this.setDiagnosticsState('failed');
      this.scheduleDiagnosticsReconnect();
    }
  }

  scheduleReconnect() {
    if (this.disposed || (!this.presenting && !this.preflighting) || !this.bridge.url || this.reconnectTimer) return;
    const delay = Math.min(15000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.trace('RETRY', `thermal socket in ${Math.round(delay / 1000)}s · attempt ${this.reconnectAttempt + 1}`, 'warn');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  scheduleDiagnosticsReconnect() {
    if (this.disposed || (!this.presenting && !this.preflighting) || !this.diagnosticsBridge.url || this.diagnosticsReconnectTimer) return;
    const delay = Math.min(15000, 1000 * 2 ** this.diagnosticsReconnectAttempt);
    this.diagnosticsReconnectAttempt += 1;
    this.diagnosticsReconnectTimer = setTimeout(() => {
      this.diagnosticsReconnectTimer = null;
      this.connectDiagnostics();
    }, delay);
  }

  emitStatus() {
    this.onStatus({
      state: this.state,
      sourceStatus: this.sourceStatus,
      bridgeRuntimeStatus: this.bridgeRuntimeStatus,
      companionStatus: this.companionStatus,
      thermalTransport: this.state,
      thermalSource: this.sourceStatus,
      piDiagnostics: this.diagnosticsState,
      remoteWitness: this.remoteWitnessState,
      frames: this.frames
    });
  }

  setState(state) {
    const previous = this.state;
    this.state = state;
    const colors = { unconfigured: 0x64748b, connecting: 0xf59e0b, connected: 0x22d3ee, streaming: 0xfb923c, disconnected: 0x64748b, failed: 0xfb7185 };
    this.ring.material.color.setHex(colors[state] || colors.disconnected);
    if (state !== previous) {
      this.trace(
        'TRANSPORT',
        `${previous} → ${state}`,
        ['connected', 'streaming'].includes(state) ? 'success' : state === 'failed' ? 'error' : state === 'connecting' ? 'info' : 'warn'
      );
    }
    this.emitStatus();
    this.drawPanel();
  }

  setDiagnosticsState(state) {
    const previous = this.diagnosticsState;
    this.diagnosticsState = state;
    if (state !== previous) {
      this.trace('PI STATE', `${previous} → ${state}`, state === 'failed' ? 'error' : state === 'receiving' ? 'success' : 'info');
    }
    this.emitStatus();
    this.drawPanel();
  }

  handleMessage(event) {
    if (this.disposed) return;
    if (typeof event.data === 'string') {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'headset.snapshot.result') {
          const pending = this.pendingSnapshots.get(message.requestId);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pendingSnapshots.delete(message.requestId);
          if (message.status !== 'ok') {
            const detail = clean(message.detail, message.code || 'Headset snapshot failed');
            this.trace('W12 SNAPSHOT', detail, 'error');
            pending.reject(new Error(detail));
            return;
          }
          if (typeof message.dataUrl !== 'string'
            || !/^data:image\/jpeg;base64,/i.test(message.dataUrl)
            || message.dataUrl.length > MAX_SNAPSHOT_DATA_URL_CHARS) {
            this.trace('W12 SNAPSHOT', 'rejected · invalid or oversized JPEG result', 'error');
            pending.reject(new Error('Headset snapshot payload was invalid or oversized'));
            return;
          }
          const result = {
            dataUrl: message.dataUrl,
            width: Number(message.width) || 0,
            height: Number(message.height) || 0,
            eye: clean(message.eye, 'unknown'),
            capturedAtMs: Number(message.capturedAtMs) || Date.now()
          };
          this.trace('W12 SNAPSHOT', `${result.width}×${result.height} ${result.eye}-eye JPEG received`, 'success');
          pending.resolve(result);
        } else if (message.type === 'bridge.hello') {
          this.bridgeHello = message;
          this.trace('W06 HELLO', `${message.transport || 'bridge'} · ${message.frameProtocol || 'unknown protocol'} · v${message.version || '?'}`, 'success');
          this.drawPanel();
        } else if (message.type === 'bridge.trace') {
          const step = clean(message.step, 'N00').slice(0, 4).toUpperCase();
          const vector = clean(message.vector, 'BRIDGE').slice(0, 12).toUpperCase();
          const state = clean(message.state, 'unknown');
          const detail = clean(message.detail, 'no detail');
          this.trace(`${step} ${vector}`, `${state} · ${detail}`, message.level || 'info');
        } else if (message.type === 'commissioning.status') {
          const runId = clean(message.runId);
          const phase = clean(message.phase, 'unknown');
          const result = clean(message.result, 'running');
          if (!runId) return;
          const previousRunId = this.commissioning?.runId;
          const previousPhase = this.commissioning?.phase;
          this.commissioning = { ...message, runId, phase, result };
          if (phase === 'awaiting-browser' && (previousRunId !== runId || previousPhase !== phase)) {
            this.commissioningFrameBaseline = this.frames;
            this.commissioningAckSent = false;
          }
          const boundary = message.failureBoundary ? ` · ${clean(message.failureBoundary)}` : '';
          const detail = message.failureDetail ? ` · ${clean(message.failureDetail)}` : '';
          this.trace(
            result === 'pass' ? 'W14 PASS' : result === 'fail' ? 'W14 FAIL' : 'W13 COMMISSION',
            `${phase} · native ${Number(message.nativeFrames) || 0} · browser ${Number(message.browserFrames) || 0}/${Number(message.requiredBrowserFrames) || 10}${boundary}${detail}`,
            result === 'pass' ? 'success' : result === 'fail' ? 'error' : phase === 'awaiting-browser' ? 'success' : 'info'
          );
          this.drawPanel();
        } else if (message.type === 'bridge.status') {
          const phase = clean(message.phase, 'unknown');
          this.bridgeRuntimeStatus = phase;
          if (message.ready === true) this.companionStatus = 'ready';
          else if (['failed', 'stopped'].includes(phase)) this.companionStatus = 'offline';
          else this.companionStatus = 'starting';
          this.trace(
            'W07 BRIDGE',
            `${phase}${message.reason ? ` · ${message.reason}` : ''}${message.version ? ` · ${message.version}` : ''}`,
            message.ready === true ? 'success' : phase === 'failed' ? 'error' : phase === 'stopped' ? 'warn' : 'info'
          );
          this.emitStatus();
          this.drawPanel();
        } else if (message.type === 'source.status') {
          this.sourceStatus = message.status || 'unknown';
          if (message.sourceType === 'flir-one-pro') this.companionStatus = message.status === 'offline' ? 'offline' : 'ready';
          this.trace(
            'W08 FLIR',
            `${message.status || 'unknown'}${message.reason ? ` · ${message.reason}` : ''}`,
            message.status === 'streaming' ? 'success' : ['failed', 'offline'].includes(message.status) ? 'error' : 'warn'
          );
          this.emitStatus();
          this.drawPanel();
        } else if (message.type === 'node.status' && message.node?.nodeId) {
          if (message.status === 'disconnected') this.nodes.delete(message.node.nodeId);
          else this.nodes.set(message.node.nodeId, message.node);
          const hasFlirCompanion = [...this.nodes.values()].some((node) =>
            Array.isArray(node.capabilities) && node.capabilities.includes('flir-one-pro-usb-c'));
          this.companionStatus = hasFlirCompanion ? 'ready' : 'missing';
          this.trace(
            'W06 COMPANION',
            `${message.status || 'unknown'} · ${message.node.nodeName || message.node.nodeType || 'Quest node'}${hasFlirCompanion ? ' · FLIR capability advertised' : ''}`,
            hasFlirCompanion ? 'success' : 'warn'
          );
          this.emitStatus();
          this.drawPanel();
        }
      } catch (error) {
        this.trace('PROTOCOL', `invalid bridge message · ${error?.message || 'JSON parse failed'}`, 'error', {
          key: 'invalid-bridge-message',
          throttleMs: 2000
        });
        this.setState('failed');
      }
      return;
    }
    this.decodeFrame(event.data).catch((error) => {
      this.trace('FRAME', `decode failed · ${error?.message || 'unknown error'}`, 'error', {
        key: 'frame-decode-failed',
        throttleMs: 2000
      });
      this.setState('failed');
    });
  }

  handleDiagnosticsMessage(event) {
    if (this.disposed) return;
    if (typeof event.data !== 'string') return;
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'diagnostics.snapshot' || message.type === 'diagnostics.summary' || message.type === 'diagnostics.state') {
        this.diagnostics = message;
        this.setDiagnosticsState('receiving');
        window.dispatchEvent(new CustomEvent('mxgenius:sensor-diagnostics', { detail: message }));
      } else if (message.type === 'diagnostics.delta') {
        const next = applyDiagnosticsDelta(this.diagnostics, message);
        if (!next) {
          this.diagnosticsSocket?.send(JSON.stringify({ type: 'diagnostics.resync' }));
          return;
        }
        this.diagnostics = next;
        this.setDiagnosticsState('receiving');
        window.dispatchEvent(new CustomEvent('mxgenius:sensor-diagnostics', { detail: next }));
      } else if (message.type === 'scan.observed') {
        this.scans.unshift(message);
        this.scans.splice(5);
        this.setDiagnosticsState('receiving');
        window.dispatchEvent(new CustomEvent('mxgenius:scan-observed', { detail: message }));
      }
    } catch {
      this.setDiagnosticsState('failed');
    }
  }

  async decodeFrame(buffer) {
    if (this.disposed) return;
    if (!(buffer instanceof ArrayBuffer)) {
      this.trace('FRAME', 'rejected · payload is not binary', 'error', { key: 'frame-not-binary', throttleMs: 2000 });
      return;
    }
    const view = new DataView(buffer);
    if (buffer.byteLength < 24 || view.getUint32(0, false) !== FRAME_MAGIC || view.getUint8(4) !== 1) {
      this.trace('FRAME', 'rejected · invalid MXGS/1 envelope', 'error', { key: 'frame-envelope', throttleMs: 2000 });
      return;
    }
    const format = view.getUint8(6);
    const width = view.getUint16(8, true);
    const height = view.getUint16(10, true);
    const timestamp = view.getBigUint64(12, true);
    const metadataLength = view.getUint32(20, true);
    const offset = 24 + metadataLength;
    const pixelCount = width * height;
    if (!width || !height || pixelCount > MAX_THERMAL_PIXELS || offset > buffer.byteLength) {
      this.trace('FRAME', `rejected · invalid ${width}×${height} dimensions or metadata`, 'error', { key: 'frame-dimensions', throttleMs: 2000 });
      return;
    }
    const payload = buffer.slice(offset);
    if (timestamp <= this.latestFrameTimestamp) {
      this.trace('FRAME', 'dropped · stale timestamp', 'warn', { key: 'frame-stale', throttleMs: 5000 });
      return;
    }
    if ((format === 1 && !payload.byteLength)
      || (format === 2 && payload.byteLength < pixelCount * 4)
      || (format === 3 && payload.byteLength < pixelCount * 2)) {
      this.trace('FRAME', 'rejected · truncated pixel payload', 'error', { key: 'frame-truncated', throttleMs: 2000 });
      return;
    }
    if (![1, 2, 3].includes(format)) {
      this.trace('FRAME', `rejected · unsupported format ${format}`, 'error', { key: `frame-format-${format}`, throttleMs: 5000 });
      return;
    }
    if (this.frames === 0) {
      this.trace('W09 FRAME', `first MXGS/1 envelope accepted · ${width}×${height} · format ${format}`, 'success');
    }
    this.latestFrameTimestamp = timestamp;
    if (format === 1) {
      const bitmap = await createImageBitmap(new Blob([payload], { type: 'image/jpeg' }));
      if (this.disposed || timestamp !== this.latestFrameTimestamp) {
        bitmap.close();
        return;
      }
      this.resizeThermalCanvas(width, height);
      this.thermalContext.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
    } else if (format === 2) {
      this.resizeThermalCanvas(width, height);
      const pixels = new Uint8ClampedArray(payload, 0, pixelCount * 4);
      this.thermalContext.putImageData(new ImageData(pixels, width, height), 0, 0);
    } else if (format === 3) {
      this.resizeThermalCanvas(width, height);
      this.drawY16(new DataView(payload), width, height);
    }
    this.frames += 1;
    this.lastFrameAt = performance.now();
    this.thermalTexture.needsUpdate = true;
    this.sourceStatus = 'streaming';
    const formatLabel = format === 1 ? 'JPEG' : format === 2 ? 'RGBA' : 'Y16';
    this.acknowledgeCommissioningRender();
    if (this.frames === 1) this.trace('W10 RENDER', `first thermal frame rendered · ${width}×${height} ${formatLabel}`, 'success');
    else if (this.frames % 30 === 0) this.trace('FRAME', `#${this.frames} rendered · ${width}×${height} ${formatLabel}`, 'success');
    this.setState('streaming');
  }

  acknowledgeCommissioningRender() {
    if (this.commissioningAckSent || this.commissioning?.phase !== 'awaiting-browser') return;
    const renderedFrames = this.frames - this.commissioningFrameBaseline;
    const requiredFrames = Math.max(1, Number(this.commissioning.requiredBrowserFrames) || 10);
    if (renderedFrames < requiredFrames || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({
      type: 'commissioning.browser_ack',
      runId: this.commissioning.runId,
      renderedFrames
    }));
    this.commissioningAckSent = true;
    this.trace('W13 COMMISSION', `${renderedFrames} ordered frames rendered · authenticated acknowledgement sent`, 'success');
  }

  resizeThermalCanvas(width, height) {
    if (this.thermalCanvas.width !== width) this.thermalCanvas.width = width;
    if (this.thermalCanvas.height !== height) this.thermalCanvas.height = height;
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
    ctx.clearRect(0, 0, this.panelCanvas.width, this.panelCanvas.height);
    ctx.fillStyle = 'rgba(4, 13, 24, 0.96)';
    ctx.fillRect(0, 0, this.panelCanvas.width, this.panelCanvas.height);
    ctx.strokeStyle = this.state === 'failed' || this.diagnosticsState === 'failed'
      ? '#fb7185'
      : this.state === 'streaming' ? '#fb923c' : '#22d3ee';
    ctx.lineWidth = 7;
    ctx.strokeRect(4, 4, 1016, 632);
    ctx.fillStyle = '#67e8f9';
    ctx.font = '700 30px ui-monospace, monospace';
    ctx.fillText(this.presentation === 'head-screen' ? 'FLIR HANDSHAKE TRACE' : 'PI EDGE DIAGNOSTICS', 42, 58);
    ctx.fillStyle = '#e9f8ff';
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillText(
      this.presentation === 'head-screen'
        ? `THERMAL ${clean(this.state, 'offline').toUpperCase()}/${clean(this.sourceStatus, 'standby').toUpperCase()} · BRIDGE ${clean(this.bridgeRuntimeStatus).toUpperCase()}`
        : `THERMAL ${clean(this.state, 'offline').toUpperCase()}/${clean(this.sourceStatus, 'standby').toUpperCase()} · PI ${clean(this.diagnosticsState).toUpperCase()}`,
      42,
      98
    );
    if (this.presentation === 'head-screen') {
      const trace = this.handshakeTrace.slice(-10);
      let y = 146;
      for (const entry of trace) {
        const seconds = (entry.elapsedMs / 1000).toFixed(1).padStart(5, ' ');
        ctx.fillStyle = {
          success: '#6ee7b7',
          warn: '#fcd34d',
          error: '#fda4af',
          info: '#7dd3fc'
        }[entry.level] || '#7dd3fc';
        ctx.font = '700 18px ui-monospace, monospace';
        ctx.fillText(`${seconds}s ${entry.stage.padEnd(12).slice(0, 12)}`, 42, y);
        ctx.fillStyle = '#e5f4fb';
        ctx.font = '500 18px ui-monospace, monospace';
        ctx.fillText(entry.message.slice(0, 65), 276, y);
        y += 43;
      }
      ctx.fillStyle = '#8ba6b8';
      ctx.font = '18px ui-monospace, monospace';
      ctx.fillText(`SESSION ${this.sessionId?.slice(0, 8) || 'none'} · ${this.frames} FRAMES · credentials redacted`, 42, 600);
      this.panelTexture.needsUpdate = true;
      return;
    }
    const rows = this.diagnostics && this.diagnosticsLayout
      ? formatDiagnosticsLayout(this.diagnosticsLayout, data)
      : [{
          label: 'PI DIAGNOSTICS',
          value: this.diagnosticsBridge.url
            ? this.diagnosticsLayoutState === 'loading' ? 'loading schema…' : this.diagnosticsState
            : 'not configured'
        }];
    let y = 158;
    for (const { label, value } of rows) {
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
    const thermalSummary = this.bridge.url ? 'FLIR independent' : 'FLIR not configured';
    const piSummary = this.diagnosticsBridge.url ? 'Pi independent' : 'Pi not configured';
    ctx.fillText(`${thermalSummary} · ${piSummary} · thermal screen is independently controlled.`, 42, 600);
    this.panelTexture.needsUpdate = true;
  }

  update(delta, time, { camera = null } = {}) {
    if (this.disposed || !this.presenting) return;
    if (this.presentation === 'head-screen') {
      if (camera && !this.screenPinned) {
        camera.getWorldPosition(this.cameraPosition);
        camera.getWorldQuaternion(this.cameraQuaternion);
        this.headTargetPosition.copy(this.headOffset).applyQuaternion(this.cameraQuaternion).add(this.cameraPosition);
        this.group.position.lerp(this.headTargetPosition, 1 - Math.exp(-delta * 18));
        this.group.quaternion.slerp(this.cameraQuaternion, 1 - Math.exp(-delta * 18));
      }
      const diagnosticsTarget = 0.9;
      const diagnosticsScale = THREE.MathUtils.lerp(this.panel.scale.x, diagnosticsTarget, 1 - Math.exp(-delta * 11));
      this.panel.scale.setScalar(Math.max(0.001, diagnosticsScale));
      return;
    }
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

  dispose() {
    if (this.disposed) return;
    this.trace('TEARDOWN', 'closing controls, sockets, timers, and GPU resources', 'warn');
    this.sendThermalControl('scene-dispose', false);
    this.disposed = true;
    this.presenting = false;
    this.preflighting = false;
    this.group.visible = false;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.diagnosticsReconnectTimer);
    this.reconnectTimer = null;
    this.diagnosticsReconnectTimer = null;
    this.failPendingSnapshots('Sensor scene closed before snapshot completed');

    const thermalSocket = this.socket;
    const diagnosticsSocket = this.diagnosticsSocket;
    this.socket = null;
    this.diagnosticsSocket = null;
    if (thermalSocket && thermalSocket.readyState < WebSocket.CLOSING) thermalSocket.close(1000, 'sensor scene disposed');
    if (diagnosticsSocket && diagnosticsSocket.readyState < WebSocket.CLOSING) diagnosticsSocket.close(1000, 'sensor scene disposed');

    const geometries = new Set();
    const materials = new Set();
    const textures = new Set([this.thermalTexture, this.panelTexture]);
    this.group.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      objectMaterials.filter(Boolean).forEach((material) => {
        materials.add(material);
        if (material.map) textures.add(material.map);
      });
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
  }
}
