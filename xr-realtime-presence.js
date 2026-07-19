import * as THREE from 'three';

const STATE_COLORS = Object.freeze({
  disconnected: 0x64748b,
  connecting: 0xf59e0b,
  listening: 0x22d3ee,
  thinking: 0xa78bfa,
  speaking: 0x34d399,
  degraded: 0xf59e0b,
  failed: 0xfb7185
});

function cleanText(value, fallback = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

function wrapLines(context, value, maxWidth, maxLines) {
  const words = cleanText(value).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.length && lines.length === maxLines) {
    const last = lines.length - 1;
    lines[last] = `${lines[last].slice(0, 78).trim()}…`;
  }
  return lines;
}

export class XRRealtimePresence {
  constructor({ sessionProvider, contextProvider = () => null, onAction = () => {} } = {}) {
    this.sessionProvider = sessionProvider || (() => globalThis.MXGENIUS_CONFIG?.getSession?.() || {});
    this.contextProvider = contextProvider;
    this.onAction = onAction;
    this.state = 'disconnected';
    this.userText = '';
    this.assistantText = '';
    this.toolText = '';
    this.presenting = false;
    this.pinned = false;
    this.panelTarget = 0;
    this.session = null;
    this.applicationSession = null;
    this.handledCalls = new Set();
    this.audioContext = null;
    this.analysers = [];
    this.audioSamples = new Uint8Array(128);
    this.anchorPosition = new THREE.Vector3();
    this.anchorQuaternion = new THREE.Quaternion();
    this.cameraPosition = new THREE.Vector3();
    this.offset = new THREE.Vector3(0.12, 0.08, -0.12);
    this.localPoint = new THREE.Vector3();

    this.group = new THREE.Group();
    this.group.name = 'MXGeniusRealtimePresence';
    this.group.position.set(-0.48, 1.3, -0.82);
    this.group.visible = false;

    this.orb = this.createPointCloud();
    this.group.add(this.orb);

    this.hitTarget = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 20, 14),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false })
    );
    this.hitTarget.name = 'MXGeniusRealtimeToggle';
    this.hitTarget.userData.xrVoiceAction = 'toggle-realtime';
    this.group.add(this.hitTarget);

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.004, 8, 64),
      new THREE.MeshBasicMaterial({ color: STATE_COLORS.disconnected, transparent: true, opacity: 0.5, toneMapped: false })
    );
    this.ring.rotation.x = Math.PI / 2;
    this.group.add(this.ring);

    this.pinTarget = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.035, 0),
      new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.9, toneMapped: false })
    );
    this.pinTarget.name = 'MXGeniusRealtimePin';
    this.pinTarget.position.set(-0.19, 0.13, 0);
    this.pinTarget.userData.xrVoiceAction = 'toggle-pin';
    this.group.add(this.pinTarget);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 576;
    this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.82, 0.46),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    this.panel.name = 'MXGeniusSpatialTranscript';
    this.panel.position.set(0.58, 0.08, 0);
    this.panel.scale.setScalar(0.001);
    this.group.add(this.panel);
    this.drawPanel();
  }

  createPointCloud() {
    const count = 720;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    this.basePositions = new Float32Array(count * 3);
    const cyan = new THREE.Color(0x22d3ee);
    const violet = new THREE.Color(0xa78bfa);
    const mixed = new THREE.Color();
    for (let index = 0; index < count; index += 1) {
      const y = 1 - (index / (count - 1)) * 2;
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = Math.PI * (3 - Math.sqrt(5)) * index;
      const shell = 0.105 + 0.025 * Math.sin(index * 1.73);
      const offset = index * 3;
      positions[offset] = Math.cos(theta) * radius * shell;
      positions[offset + 1] = y * shell;
      positions[offset + 2] = Math.sin(theta) * radius * shell;
      this.basePositions.set(positions.subarray(offset, offset + 3), offset);
      mixed.copy(cyan).lerp(violet, (y + 1) * 0.5);
      colors[offset] = mixed.r;
      colors[offset + 1] = mixed.g;
      colors[offset + 2] = mixed.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.012,
      transparent: true,
      opacity: 0.9,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    const points = new THREE.Points(geometry, material);
    points.name = 'MXGeniusVoicePointCloud';
    return points;
  }

  interactiveObjects() {
    return [this.hitTarget, this.pinTarget];
  }

  owns(object) {
    let node = object;
    while (node) {
      if (node.userData?.xrVoiceAction) return true;
      node = node.parent;
    }
    return false;
  }

  handleObject(object, input = 'xr') {
    if (!this.owns(object)) return false;
    let target = object;
    while (target && !target.userData?.xrVoiceAction) target = target.parent;
    if (target?.userData?.xrVoiceAction === 'toggle-pin') {
      this.setPinned(!this.pinned, input);
      return true;
    }
    void this.toggle(input);
    return true;
  }

  setPinned(pinned, input = 'xr') {
    this.pinned = Boolean(pinned);
    this.pinTarget.material.color.setHex(this.pinned ? 0xfbbf24 : 0x94a3b8);
    this.toolText = this.pinned ? 'Voice workspace pinned in place' : 'Voice workspace attached to right wrist';
    this.onAction('realtime-pin', input, { pinned: this.pinned });
    this.drawPanel();
  }

  fingerTargetAt(point) {
    if (!this.presenting || !this.group.visible) return null;
    this.hitTarget.updateMatrixWorld(true);
    this.hitTarget.worldToLocal(this.localPoint.copy(point));
    if (this.localPoint.length() <= 0.17) return this.hitTarget;
    this.pinTarget.worldToLocal(this.localPoint.copy(point));
    return this.localPoint.length() <= 0.055 ? this.pinTarget : null;
  }

  setPresenting(presenting) {
    this.presenting = Boolean(presenting);
    this.group.visible = this.presenting;
    if (this.presenting && !this.toolText) {
      this.toolText = 'Tap cloud: voice | tap diamond: pin';
      this.drawPanel();
    }
    if (!this.presenting) {
      this.pinned = false;
      this.pinTarget.material.color.setHex(0x94a3b8);
      this.disconnect();
    }
  }

  async toggle(input = 'xr') {
    this.onAction('realtime-toggle', input, { state: this.state });
    if (this.session && !['disconnected', 'failed'].includes(this.session.state)) {
      this.disconnect();
      return;
    }
    await this.connect(input);
  }

  async connect(input) {
    if (!globalThis.MXRealtime?.RealtimeSession || !globalThis.MXApplicationClient?.realtime) {
      this.setState('failed', 'Realtime client unavailable');
      return;
    }
    const configured = this.sessionProvider() || {};
    if (!configured.accessToken && !globalThis.MXGENIUS_CONFIG?.allowInsecurePilot) {
      this.setState('failed', 'Sign in to use voice');
      return;
    }
    this.applicationSession = {
      accessToken: configured.accessToken,
      organizationId: configured.organizationId,
      correlationId: globalThis.crypto?.randomUUID?.()
    };
    this.session = new globalThis.MXRealtime.RealtimeSession({
      exchangeSdp: ({ sdp, session }) => globalThis.MXApplicationClient.realtime.exchangeSdp({ sdp, session }),
      onEvent: (event) => void this.handleRealtimeEvent(event)
    });
    try {
      await this.session.connect({ session: this.applicationSession });
      this.onAction('realtime-connect', input, { state: this.state });
    } catch (error) {
      this.setState('failed', error.message || 'Voice connection failed');
    }
  }

  disconnect() {
    this.session?.disconnect();
    this.session = null;
    this.applicationSession = null;
    this.handledCalls.clear();
    this.toolText = this.presenting ? 'Tap cloud: voice | tap diamond: pin' : '';
    this.userText = '';
    this.assistantText = '';
    this.analysers = [];
    if (this.audioContext) void this.audioContext.close();
    this.audioContext = null;
    this.setState('disconnected');
  }

  async handleRealtimeEvent(event) {
    if (event.type === 'state') {
      this.setState(event.state, event.reason || '');
      if (['listening', 'speaking'].includes(event.state)) await this.attachAudioAnalysers();
      return;
    }
    if (event.type === 'transcript') {
      if (event.role === 'user') this.userText = event.text || '';
      else this.assistantText = event.text || '';
      this.panelTarget = 1;
      this.drawPanel();
      return;
    }
    if (event.type === 'channel-open') {
      await this.configureTools();
      return;
    }
    if (event.type === 'tool-request') await this.routeTool(event);
  }

  async configureTools() {
    try {
      const listed = await globalThis.MXApplicationClient.capabilities.list(this.applicationSession);
      const caseContext = this.contextProvider() || null;
      const caseInstruction = caseContext?.caseId
        ? `The active maintenance case is ${caseContext.caseId}.`
        : 'No maintenance case is active. Do not attempt a case-bound mutation.';
      this.session?.configureTools(listed.tools, {
        instructions: `You are the MXGenius maintenance copilot in an immersive workspace. Be concise because the transcript is spatial. Use only supplied typed capabilities for operational facts. ${caseInstruction} Read evidence, confidence, warnings, and partial states. Operational mutations require confirmation outside this immersive control and must not execute here.`
      });
      this.toolText = `${listed.tools?.length || 0} operations ready`;
      this.drawPanel();
    } catch (error) {
      this.setState('degraded', `Tools unavailable: ${error.code || 'request failed'}`);
    }
  }

  async routeTool(event) {
    if (!event.callId || this.handledCalls.has(event.callId)) return;
    this.handledCalls.add(event.callId);
    let args;
    try {
      args = typeof event.arguments === 'string' ? JSON.parse(event.arguments) : event.arguments;
    } catch {
      this.session?.sendToolOutput(event.callId, { status: 'failed', error: { code: 'INVALID_TOOL_ARGUMENTS', message: 'Tool arguments were not valid JSON.' } });
      return;
    }
    if (!event.spec?.name || !/^mxg\.[a-z_]+\.[a-z_]+$/.test(event.spec.name)) {
      this.session?.sendToolOutput(event.callId, { status: 'failed', error: { code: 'UNKNOWN_CAPABILITY', message: 'Capability is not in the authenticated registry.' } });
      return;
    }
    this.toolText = `Running ${event.spec.title || event.name}`;
    this.setState('thinking');
    if (event.spec.meta?.requires_human_approval) {
      this.toolText = `${event.spec.title || event.name} requires dashboard confirmation`;
      this.session?.sendToolOutput(event.callId, {
        status: 'blocked',
        requires_human_approval: true,
        warning: 'Review and confirm this operational change in the dashboard.'
      });
      this.drawPanel();
      return;
    }
    try {
      const envelope = await globalThis.MXApplicationClient.capabilities.call(event.spec.name, args || {}, {
        ...this.applicationSession,
        correlationId: globalThis.crypto?.randomUUID?.()
      });
      this.session?.sendToolOutput(event.callId, envelope);
      this.toolText = `${event.spec.title || event.name} · ${envelope.status || 'complete'}`;
    } catch (error) {
      this.session?.sendToolOutput(event.callId, {
        status: 'failed',
        error: { code: error.code || 'CAPABILITY_FAILED', message: error.message }
      });
      this.toolText = `${event.spec.title || event.name} failed`;
    }
    this.drawPanel();
  }

  setState(state, reason = '') {
    this.state = state || 'disconnected';
    if (reason) this.toolText = reason;
    this.panelTarget = this.state === 'disconnected' ? 0 : 1;
    const color = STATE_COLORS[this.state] || STATE_COLORS.disconnected;
    this.ring.material.color.setHex(color);
    this.drawPanel();
  }

  async attachAudioAnalysers() {
    if (this.audioContext || !this.session) return;
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      this.audioContext = new AudioContextClass();
      await this.audioContext.resume();
      for (const stream of [this.session.media, this.session.audioElement?.srcObject]) {
        if (!stream?.getAudioTracks?.().length) continue;
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.78;
        this.audioContext.createMediaStreamSource(stream).connect(analyser);
        this.analysers.push(analyser);
      }
    } catch {
      this.analysers = [];
    }
  }

  audioLevel(time) {
    let level = 0;
    for (const analyser of this.analysers) {
      analyser.getByteTimeDomainData(this.audioSamples);
      let sum = 0;
      for (const sample of this.audioSamples) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }
      level = Math.max(level, Math.sqrt(sum / this.audioSamples.length));
    }
    if (level > 0.006) return THREE.MathUtils.clamp(level * 5, 0, 1);
    if (this.state === 'speaking') return 0.48 + Math.sin(time * 0.012) * 0.18;
    if (this.state === 'listening') return 0.16 + Math.sin(time * 0.006) * 0.08;
    if (this.state === 'thinking') return 0.25 + Math.sin(time * 0.009) * 0.12;
    return 0.04;
  }

  drawPanel() {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = 'rgba(5, 13, 25, 0.96)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const color = new THREE.Color(STATE_COLORS[this.state] || STATE_COLORS.disconnected);
    ctx.strokeStyle = `#${color.getHexString()}`;
    ctx.lineWidth = 7;
    ctx.strokeRect(4, 4, this.canvas.width - 8, this.canvas.height - 8);
    ctx.fillStyle = `#${color.getHexString()}`;
    ctx.font = '700 34px ui-monospace, monospace';
    ctx.fillText('MXGENIUS REALTIME', 46, 62);
    ctx.fillStyle = '#dff7ff';
    ctx.font = '600 27px system-ui, sans-serif';
    ctx.fillText(cleanText(this.state, 'disconnected').toUpperCase(), 46, 108);
    ctx.fillStyle = this.pinned ? '#fbbf24' : '#94a3b8';
    ctx.font = '700 21px ui-monospace, monospace';
    ctx.fillText(this.pinned ? 'PINNED' : 'RIGHT WRIST', 790, 106);
    if (this.toolText) {
      ctx.fillStyle = '#9cb5c9';
      ctx.font = '24px system-ui, sans-serif';
      ctx.fillText(cleanText(this.toolText).slice(0, 74), 46, 148);
    }
    const sections = [
      ['YOU', this.userText, '#67e8f9'],
      ['MXGENIUS', this.assistantText, '#a7f3d0']
    ];
    let y = 205;
    for (const [label, text, fill] of sections) {
      ctx.fillStyle = fill;
      ctx.font = '700 23px ui-monospace, monospace';
      ctx.fillText(label, 46, y);
      ctx.fillStyle = '#edf6ff';
      ctx.font = '28px system-ui, sans-serif';
      const lines = wrapLines(ctx, text || (label === 'YOU' ? 'Tap the point cloud and speak.' : 'Ready when you are.'), 910, 4);
      for (const line of lines) {
        y += 38;
        ctx.fillText(line, 46, y);
      }
      y += 54;
    }
    this.texture.needsUpdate = true;
  }

  update(delta, time, { anchor = null, camera = null } = {}) {
    if (!this.presenting) return;
    if (!this.pinned && anchor?.visible) {
      anchor.getWorldPosition(this.anchorPosition);
      anchor.getWorldQuaternion(this.anchorQuaternion);
      const desired = this.offset.clone().applyQuaternion(this.anchorQuaternion).add(this.anchorPosition);
      this.group.position.lerp(desired, 1 - Math.exp(-delta * 14));
    }
    if (camera) {
      camera.getWorldPosition(this.cameraPosition);
      this.group.lookAt(this.cameraPosition);
    }
    const level = this.audioLevel(time);
    const position = this.orb.geometry.getAttribute('position');
    for (let index = 0; index < position.count; index += 1) {
      const offset = index * 3;
      const wave = 1 + level * (0.32 + 0.12 * Math.sin(time * 0.004 + index * 0.21));
      position.array[offset] = this.basePositions[offset] * wave;
      position.array[offset + 1] = this.basePositions[offset + 1] * wave;
      position.array[offset + 2] = this.basePositions[offset + 2] * wave;
    }
    position.needsUpdate = true;
    this.orb.rotation.y += delta * (0.28 + level * 1.8);
    this.orb.rotation.x = Math.sin(time * 0.0007) * 0.16;
    this.orb.material.size = 0.011 + level * 0.009;
    this.ring.rotation.z -= delta * (0.35 + level * 2);
    this.ring.material.opacity = 0.35 + level * 0.55;
    const panelScale = THREE.MathUtils.lerp(this.panel.scale.x, this.panelTarget, 1 - Math.exp(-delta * 11));
    this.panel.scale.setScalar(Math.max(0.001, panelScale));
  }
}
