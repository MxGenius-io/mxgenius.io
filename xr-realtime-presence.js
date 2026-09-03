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
  constructor({
    sessionProvider,
    contextProvider = () => null,
    pointCount = 720,
    pointSize = 0.0012,
    onSnapshotRequest = null,
    onSnapshotCaptured = null,
    onScanFrame = null,
    spatialCommands = null,
    onAction = () => {}
  } = {}) {
    this.sessionProvider = sessionProvider || (() => globalThis.MXGENIUS_CONFIG?.getSession?.() || {});
    this.contextProvider = contextProvider;
    this.onSnapshotRequest = typeof onSnapshotRequest === 'function' ? onSnapshotRequest : null;
    this.onSnapshotCaptured = typeof onSnapshotCaptured === 'function' ? onSnapshotCaptured : null;
    this.onScanFrame = typeof onScanFrame === 'function' ? onScanFrame : null;
    this.spatialCommands = spatialCommands;
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
    this.connectAttempt = 0;
    this.connectPromise = null;
    this.disposed = false;
    this.snapshotBusy = false;
    this.framePurpose = null;
    this.scanState = 'idle';
    this.evidenceContext = { caseId: null, aircraftId: null, count: 0 };
    this.captureAnimations = [];
    this.handledCalls = new Set();
    this.audioContext = null;
    this.analysers = [];
    this.audioSamples = new Uint8Array(128);
    this.cameraPosition = new THREE.Vector3();
    this.cameraQuaternion = new THREE.Quaternion();
    this.dockOffset = new THREE.Vector3(-0.32, -0.12, -0.65);
    this.dockTarget = null;
    this.dockTargetPosition = new THREE.Vector3();
    this.dockTargetQuaternion = new THREE.Quaternion();
    this.localPoint = new THREE.Vector3();
    this.pointCount = THREE.MathUtils.clamp(Math.round(Number(pointCount) || 720), 240, 4000);
    this.pointSize = THREE.MathUtils.clamp(Number(pointSize) || 0.0012, 0.0004, 0.003);

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

    this.micCanvas = document.createElement('canvas');
    this.micCanvas.width = 384;
    this.micCanvas.height = 144;
    this.micContext = this.micCanvas.getContext('2d');
    this.micTexture = new THREE.CanvasTexture(this.micCanvas);
    this.micTexture.colorSpace = THREE.SRGBColorSpace;
    this.micButton = new THREE.Mesh(
      new THREE.PlaneGeometry(0.18, 0.09),
      new THREE.MeshBasicMaterial({ map: this.micTexture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    this.micButton.name = 'MXGeniusRealtimeMic';
    this.micButton.position.set(-0.105, -0.205, 0.012);
    this.micButton.userData.xrVoiceAction = 'toggle-realtime';
    this.micButton.userData.xrHitSize = { width: 0.18, height: 0.09 };
    this.micButton.visible = false;
    this.group.add(this.micButton);

    this.snapshotCanvas = document.createElement('canvas');
    this.snapshotCanvas.width = 320;
    this.snapshotCanvas.height = 144;
    this.snapshotContext = this.snapshotCanvas.getContext('2d');
    this.snapshotTexture = new THREE.CanvasTexture(this.snapshotCanvas);
    this.snapshotTexture.colorSpace = THREE.SRGBColorSpace;
    this.snapshotButton = new THREE.Mesh(
      new THREE.PlaneGeometry(0.18, 0.09),
      new THREE.MeshBasicMaterial({ map: this.snapshotTexture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    this.snapshotButton.name = 'MXGeniusRealtimeSnapshot';
    this.snapshotButton.position.set(0.105, -0.205, 0.012);
    this.snapshotButton.userData.xrVoiceAction = 'capture-snapshot';
    this.snapshotButton.userData.xrHitSize = { width: 0.18, height: 0.09 };
    this.snapshotButton.visible = false;
    this.group.add(this.snapshotButton);

    this.scanCanvas = document.createElement('canvas');
    this.scanCanvas.width = 320;
    this.scanCanvas.height = 144;
    this.scanContext = this.scanCanvas.getContext('2d');
    this.scanTexture = new THREE.CanvasTexture(this.scanCanvas);
    this.scanTexture.colorSpace = THREE.SRGBColorSpace;
    this.scanButton = new THREE.Mesh(
      new THREE.PlaneGeometry(0.18, 0.09),
      new THREE.MeshBasicMaterial({ map: this.scanTexture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    this.scanButton.name = 'MXGeniusSpatialScan';
    this.scanButton.position.set(0.315, -0.205, 0.012);
    this.scanButton.userData.xrVoiceAction = 'scan-scene';
    this.scanButton.userData.xrHitSize = { width: 0.18, height: 0.09 };
    this.scanButton.visible = false;
    this.group.add(this.scanButton);

    this.evidenceCanvas = document.createElement('canvas');
    this.evidenceCanvas.width = 640;
    this.evidenceCanvas.height = 160;
    this.evidenceContext2d = this.evidenceCanvas.getContext('2d');
    this.evidenceTexture = new THREE.CanvasTexture(this.evidenceCanvas);
    this.evidenceTexture.colorSpace = THREE.SRGBColorSpace;
    this.evidenceTray = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.105),
      new THREE.MeshBasicMaterial({ map: this.evidenceTexture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    this.evidenceTray.name = 'MXGeniusCaseEvidenceTray';
    this.evidenceTray.position.set(0.34, -0.33, 0.01);
    this.evidenceTray.visible = false;
    this.group.add(this.evidenceTray);
    this.drawPanel();
    this.drawMicButton();
    this.drawSnapshotButton();
    this.drawScanButton();
    this.drawEvidenceTray();
  }

  createPointCloud() {
    const count = this.pointCount;
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
      size: this.pointSize,
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
    return [this.dockTarget ? this.micButton : this.hitTarget, this.snapshotButton, this.scanButton, this.pinTarget]
      .filter((object) => object.visible);
  }

  setDockTarget(target = null) {
    this.dockTarget = target;
    this.micButton.visible = Boolean(target);
    this.snapshotButton.visible = Boolean(target && this.onSnapshotRequest);
    this.scanButton.visible = Boolean(target && this.onSnapshotRequest);
    this.evidenceTray.visible = Boolean(target);
    this.hitTarget.visible = !target;
    if (target) {
      this.panel.position.set(0.58, 0.27, 0);
      this.pinTarget.position.set(0.96, 0.44, 0.012);
    } else {
      this.panel.position.set(0.58, 0.08, 0);
      this.pinTarget.position.set(-0.19, 0.13, 0);
    }
  }

  controlInstruction() {
    return this.dockTarget
      ? 'Tap mic: voice | SCAN: inspect | CAPTURE: case evidence | diamond: pin'
      : 'Tap cloud: voice | tap diamond: pin';
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
    if (target?.userData?.xrVoiceAction === 'capture-snapshot') {
      void this.captureSnapshot(input);
      return true;
    }
    if (target?.userData?.xrVoiceAction === 'scan-scene') {
      void this.scanScene(input);
      return true;
    }
    void this.toggle(input);
    return true;
  }

  setPinned(pinned, input = 'xr') {
    this.pinned = Boolean(pinned);
    this.pinTarget.material.color.setHex(this.pinned ? 0xfbbf24 : 0x94a3b8);
    this.toolText = this.pinned ? 'Voice workspace pinned in place' : 'Voice workspace returned to floating dock';
    this.onAction('realtime-pin', input, { pinned: this.pinned });
    this.drawPanel();
  }

  fingerTargetAt(point) {
    if (!this.presenting || !this.group.visible) return null;
    if (this.dockTarget) {
      for (const button of [this.micButton, this.snapshotButton, this.scanButton]) {
        if (!button.visible) continue;
        button.updateMatrixWorld(true);
        button.worldToLocal(this.localPoint.copy(point));
        const { width, height } = button.userData.xrHitSize;
        if (Math.abs(this.localPoint.z) < 0.04
          && Math.abs(this.localPoint.x) <= width / 2
          && Math.abs(this.localPoint.y) <= height / 2) {
          return button;
        }
      }
    } else {
      this.hitTarget.updateMatrixWorld(true);
      this.hitTarget.worldToLocal(this.localPoint.copy(point));
      if (this.localPoint.length() <= 0.17) return this.hitTarget;
    }
    this.pinTarget.worldToLocal(this.localPoint.copy(point));
    return this.localPoint.length() <= 0.055 ? this.pinTarget : null;
  }

  setPresenting(presenting) {
    if (this.disposed) return;
    this.presenting = Boolean(presenting);
    this.group.visible = this.presenting;
    if (this.presenting && !this.toolText) {
      this.toolText = this.controlInstruction();
      this.drawPanel();
    }
    if (!this.presenting) {
      this.pinned = false;
      this.pinTarget.material.color.setHex(0x94a3b8);
      this.disconnect();
    }
  }

  async toggle(input = 'xr') {
    if (this.disposed) return;
    this.onAction('realtime-toggle', input, { state: this.state });
    if (this.connectPromise || (this.session && !['disconnected', 'failed'].includes(this.session.state))) {
      this.disconnect();
      return;
    }
    await this.connect(input);
  }

  setEvidenceContext({ caseId = null, aircraftId = null, count = 0 } = {}) {
    this.evidenceContext = {
      caseId: cleanText(caseId, '') || null,
      aircraftId: cleanText(aircraftId, '') || null,
      count: Math.max(0, Number(count) || 0)
    };
    this.drawEvidenceTray();
  }

  async captureSnapshot(input = 'xr') {
    if (this.disposed || this.framePurpose) return;
    if (!this.onSnapshotRequest) {
      this.toolText = 'Headset snapshot bridge is unavailable';
      this.drawPanel();
      return;
    }
    if (!this.evidenceContext.caseId) {
      this.toolText = 'Open a maintenance case before capturing evidence';
      this.drawPanel();
      return;
    }
    this.snapshotBusy = true;
    this.framePurpose = 'evidence';
    this.toolText = 'Capturing one passthrough frame…';
    this.drawPanel();
    this.drawSnapshotButton();
    this.drawScanButton();
    this.onAction('realtime-snapshot-request', input, { state: this.state });
    try {
      const snapshot = await this.onSnapshotRequest({ purpose: 'evidence' });
      if (!snapshot?.dataUrl || !/^data:image\/jpeg;base64,/i.test(snapshot.dataUrl)) {
        throw new Error('Quest companion returned an invalid snapshot');
      }
      const saved = this.onSnapshotCaptured
        ? await this.onSnapshotCaptured(snapshot, { input, context: this.contextProvider() || null })
        : null;
      if (saved?.count !== undefined) {
        this.setEvidenceContext({
          caseId: saved.caseId || this.evidenceContext.caseId,
          aircraftId: saved.aircraftId || this.evidenceContext.aircraftId,
          count: saved.count
        });
      }
      this.animateSnapshotToEvidence(snapshot.dataUrl);
      const modelReady = Boolean(this.session) && !['disconnected', 'connecting', 'failed'].includes(this.state);
      const sent = modelReady ? this.session.sendUserMessage({
        text: 'Use this headset snapshot as visual context for the active maintenance session. Describe what is visible and connect it to the current discussion.',
        images: [{ dataUrl: snapshot.dataUrl }]
      }) : false;
      this.userText = `Passthrough capture saved · ${snapshot.width || '?'}×${snapshot.height || '?'}`;
      this.toolText = sent
        ? 'Saved to the active case and shared with the model'
        : 'Saved to the active maintenance case';
      this.panelTarget = 1;
      this.onAction('case-evidence-captured', input, {
        width: snapshot.width || 0,
        height: snapshot.height || 0,
        eye: snapshot.eye || 'unknown',
        caseId: saved?.caseId || this.evidenceContext.caseId,
        sharedWithModel: sent
      });
    } catch (error) {
      this.toolText = cleanText(error?.message, 'Headset snapshot failed');
      this.onAction('realtime-snapshot-failed', input, { reason: this.toolText });
    } finally {
      this.snapshotBusy = false;
      this.framePurpose = null;
      this.drawPanel();
      this.drawSnapshotButton();
      this.drawScanButton();
    }
  }

  async scanScene(input = 'xr', { isCurrent = null } = {}) {
    if (this.disposed || this.framePurpose) return { status: 'unavailable', count: 0, reason: 'Headset frame capture is busy' };
    if (!this.onSnapshotRequest) {
      this.scanState = 'unavailable';
      this.toolText = 'Headset scan bridge is unavailable';
      this.drawPanel();
      this.drawScanButton();
      return { status: 'unavailable', count: 0, reason: this.toolText };
    }
    this.framePurpose = 'scan';
    this.scanState = 'scanning';
    this.toolText = 'Scanning one passthrough frame…';
    this.drawPanel();
    this.drawSnapshotButton();
    this.drawScanButton();
    this.onAction('spatial-scan-requested', input, { state: this.scanState });
    try {
      const frame = await this.onSnapshotRequest({ purpose: 'scan' });
      if (!frame?.dataUrl || !/^data:image\/jpeg;base64,/i.test(frame.dataUrl)) {
        throw new Error('Quest companion returned an invalid scan frame');
      }
      const outcome = this.onScanFrame
        ? await this.onScanFrame(frame, { input, context: this.contextProvider() || null, isCurrent })
        : { status: 'unavailable', reason: 'Scene analyzer is not connected yet' };
      const status = ['ready', 'empty', 'stale', 'unavailable', 'failed'].includes(outcome?.status)
        ? outcome.status
        : Number(outcome?.count) > 0 ? 'ready' : 'empty';
      const candidateCount = Math.max(0, Number(outcome?.count) || 0);
      this.scanState = status;
      if (status === 'ready') this.toolText = `${Math.max(1, candidateCount)} high-confidence target${candidateCount === 1 ? '' : 's'} found`;
      else if (status === 'empty') this.toolText = 'Scan complete · no high-confidence targets';
      else if (status === 'stale') this.toolText = cleanText(outcome?.reason, 'Scene changed · scan again');
      else if (status === 'unavailable') this.toolText = cleanText(outcome?.reason, 'Scan captured · scene analysis unavailable');
      else this.toolText = cleanText(outcome?.reason, 'Scene analysis failed');
      this.onAction('spatial-scan-completed', input, {
        status: this.scanState,
        scanId: frame.scanId || null,
        requestId: frame.requestId || null,
        width: frame.width || 0,
        height: frame.height || 0,
        capturedAtMs: frame.capturedAtMs || 0,
        camera: frame.camera || null,
        candidateCount
      });
      return { ...outcome, status, count: candidateCount };
    } catch (error) {
      this.scanState = error?.code === 'frame-unavailable' ? 'unavailable' : 'failed';
      this.toolText = cleanText(error?.message, 'Headset scan failed');
      this.onAction('spatial-scan-failed', input, { status: this.scanState, reason: this.toolText });
      return { status: this.scanState, count: 0, reason: this.toolText };
    } finally {
      // The scan JPEG is deliberately not retained, attached, or sent to the
      // conversation here. Wave 3 consumes it only through onScanFrame.
      this.framePurpose = null;
      this.drawPanel();
      this.drawSnapshotButton();
      this.drawScanButton();
    }
  }

  setScanState(state = 'idle', message = '') {
    if (this.disposed || this.framePurpose) return false;
    const nextState = ['idle', 'ready', 'empty', 'unavailable', 'failed'].includes(state)
      ? state
      : 'idle';
    this.scanState = nextState;
    if (message) this.toolText = cleanText(message, '');
    this.drawPanel();
    this.drawScanButton();
    return true;
  }

  setSpatialCommands(spatialCommands = null) {
    this.spatialCommands = spatialCommands;
    if (this.session) void this.configureTools();
  }

  animateSnapshotToEvidence(dataUrl) {
    if (!dataUrl || this.disposed) return;
    new THREE.TextureLoader().load(dataUrl, (texture) => {
      if (this.disposed) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      const thumbnail = new THREE.Mesh(
        new THREE.PlaneGeometry(0.18, 0.12),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 1, toneMapped: false, side: THREE.DoubleSide })
      );
      thumbnail.position.copy(this.snapshotButton.position);
      thumbnail.position.z += 0.02;
      this.group.add(thumbnail);
      this.captureAnimations.push({
        mesh: thumbnail,
        texture,
        elapsed: 0,
        duration: 0.78,
        from: thumbnail.position.clone(),
        to: this.evidenceTray.position.clone().add(new THREE.Vector3(-0.14, 0, 0.018))
      });
    });
  }

  async connect(input) {
    if (this.disposed || this.connectPromise) return this.connectPromise;
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
    const attempt = ++this.connectAttempt;
    let realtimeSession = null;
    realtimeSession = new globalThis.MXRealtime.RealtimeSession({
      exchangeSdp: ({ sdp, session }) => globalThis.MXApplicationClient.realtime.exchangeSdp({ sdp, session }),
      onEvent: (event) => {
        if (this.session === realtimeSession && attempt === this.connectAttempt) void this.handleRealtimeEvent(event);
      }
    });
    this.session = realtimeSession;
    const pending = realtimeSession.connect({ session: this.applicationSession });
    this.connectPromise = pending;
    try {
      await pending;
      if (this.disposed || attempt !== this.connectAttempt || this.session !== realtimeSession) {
        realtimeSession.disconnect();
        return;
      }
      this.onAction('realtime-connect', input, { state: this.state });
    } catch (error) {
      if (this.disposed || attempt !== this.connectAttempt || this.session !== realtimeSession) return;
      this.setState('failed', error.message || 'Voice connection failed');
    } finally {
      if (this.connectPromise === pending) this.connectPromise = null;
    }
  }

  disconnect() {
    this.connectAttempt += 1;
    const realtimeSession = this.session;
    this.session = null;
    this.connectPromise = null;
    realtimeSession?.disconnect();
    this.applicationSession = null;
    this.handledCalls.clear();
    this.toolText = this.presenting ? this.controlInstruction() : '';
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
      const fleetLocation = caseContext?.fleetLocation || null;
      const fleetInstruction = caseContext?.surface === 'fleet-globe'
        ? fleetLocation?.icao
          ? `The selected JetNet fleet location is ${cleanText(fleetLocation.icao)} in ${cleanText([fleetLocation.city, fleetLocation.country].filter(Boolean).join(', '), 'an unknown location')}, representing ${Number(fleetLocation.count) || 0} cached aircraft. Use that location as the current fleet context.`
          : 'The fleet globe is active, but no JetNet location is selected yet.'
        : '';
      const spatialProjection = caseContext?.spatialTargets || null;
      const spatialInstruction = spatialProjection
        ? `The bounded spatial target projection is ${JSON.stringify(spatialProjection)}. Use only exact target IDs and revisions from this projection. A stale command acknowledgement means the scene changed; do not retry it or move the visible highlight.`
        : 'No spatial target projection is available. Do not claim a target is visible or invoke a target-specific spatial command.';
      this.session?.configureTools(listed.tools, {
        clientTools: this.spatialCommands?.clientTools?.() || [],
        instructions: `You are the MXGenius maintenance copilot in an immersive workspace. Be concise because the transcript is spatial. Use only supplied typed capabilities for operational facts. ${caseInstruction} ${fleetInstruction} ${spatialInstruction} Spatial commands change local presentation only and must be acknowledged by their client tool result. Read evidence, confidence, warnings, and partial states. Operational mutations require confirmation outside this immersive control and must not execute here.`
      });
      const spatialCount = this.spatialCommands?.clientTools?.().length || 0;
      this.toolText = `${(listed.tools?.length || 0) + spatialCount} operations ready`;
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
    if (event.spec?.meta?.client_handler === 'spatial_command') {
      if (!this.spatialCommands?.dispatchTool) {
        this.session?.sendToolOutput(event.callId, { status: 'unavailable', reason: 'Spatial command bridge is unavailable' });
        this.toolText = `${event.spec.title || event.name} unavailable`;
        this.drawPanel();
        return;
      }
      this.setState('thinking');
      const result = await this.spatialCommands.dispatchTool(event.spec.name, args || {});
      this.session?.sendToolOutput(event.callId, result);
      this.toolText = `${event.spec.title || event.name} · ${result.status}`;
      this.drawPanel();
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
    this.drawMicButton();
    this.drawSnapshotButton();
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
    ctx.fillText(this.pinned ? 'PINNED' : 'FLOATING', 790, 106);
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
      const lines = wrapLines(ctx, text || (label === 'YOU' ? 'Tap the mic and speak.' : 'Ready when you are.'), 910, 4);
      for (const line of lines) {
        y += 38;
        ctx.fillText(line, 46, y);
      }
      y += 54;
    }
    this.texture.needsUpdate = true;
  }

  drawMicButton() {
    const ctx = this.micContext;
    const active = !['disconnected', 'failed'].includes(this.state);
    const color = new THREE.Color(STATE_COLORS[this.state] || STATE_COLORS.disconnected);
    ctx.clearRect(0, 0, this.micCanvas.width, this.micCanvas.height);
    ctx.fillStyle = 'rgba(5, 18, 31, 0.96)';
    ctx.fillRect(4, 4, 376, 136);
    ctx.strokeStyle = `#${color.getHexString()}`;
    ctx.lineWidth = 7;
    ctx.strokeRect(4, 4, 376, 136);
    ctx.fillStyle = active ? '#e9fff7' : '#dff7ff';
    ctx.font = '700 38px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(active ? 'MIC ON' : 'MIC', 192, 91);
    this.micTexture.needsUpdate = true;
  }

  async refreshContext() {
    if (!this.session || ['disconnected', 'connecting', 'failed'].includes(this.state)) return false;
    await this.configureTools();
    return true;
  }

  drawSnapshotButton() {
    if (!this.snapshotContext) return;
    const ctx = this.snapshotContext;
    const active = Boolean(this.onSnapshotRequest && this.evidenceContext.caseId);
    const busy = Boolean(this.framePurpose);
    ctx.clearRect(0, 0, this.snapshotCanvas.width, this.snapshotCanvas.height);
    ctx.fillStyle = 'rgba(5, 18, 31, 0.97)';
    ctx.fillRect(4, 4, this.snapshotCanvas.width - 8, this.snapshotCanvas.height - 8);
    ctx.strokeStyle = busy ? '#fbbf24' : active ? '#a78bfa' : '#64748b';
    ctx.lineWidth = 7;
    ctx.strokeRect(4, 4, this.snapshotCanvas.width - 8, this.snapshotCanvas.height - 8);
    ctx.fillStyle = active ? '#edf6ff' : '#94a3b8';
    ctx.font = '700 38px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(busy ? 'WAIT' : 'CAPTURE', this.snapshotCanvas.width / 2, 94);
    this.snapshotTexture.needsUpdate = true;
  }

  drawScanButton() {
    if (!this.scanContext) return;
    const ctx = this.scanContext;
    const busy = Boolean(this.framePurpose);
    const palette = {
      idle: '#22d3ee', scanning: '#fbbf24', ready: '#34d399', empty: '#94a3b8', stale: '#fbbf24',
      unavailable: '#64748b', failed: '#fb7185'
    };
    const labels = {
      idle: 'SCAN', scanning: 'SCANNING', ready: 'TARGETS', empty: 'EMPTY',
      stale: 'STALE', unavailable: 'OFFLINE', failed: 'RETRY'
    };
    ctx.clearRect(0, 0, this.scanCanvas.width, this.scanCanvas.height);
    ctx.fillStyle = 'rgba(5, 18, 31, 0.97)';
    ctx.fillRect(4, 4, this.scanCanvas.width - 8, this.scanCanvas.height - 8);
    ctx.strokeStyle = busy ? '#fbbf24' : palette[this.scanState] || palette.idle;
    ctx.lineWidth = 7;
    ctx.strokeRect(4, 4, this.scanCanvas.width - 8, this.scanCanvas.height - 8);
    ctx.fillStyle = this.onSnapshotRequest ? '#edf6ff' : '#94a3b8';
    ctx.font = '700 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(busy ? 'WAIT' : labels[this.scanState] || labels.idle, this.scanCanvas.width / 2, 94);
    this.scanTexture.needsUpdate = true;
  }

  drawEvidenceTray() {
    if (!this.evidenceContext2d) return;
    const ctx = this.evidenceContext2d;
    const { caseId, aircraftId, count } = this.evidenceContext;
    ctx.clearRect(0, 0, this.evidenceCanvas.width, this.evidenceCanvas.height);
    ctx.fillStyle = 'rgba(5, 18, 31, 0.97)';
    ctx.fillRect(4, 4, this.evidenceCanvas.width - 8, this.evidenceCanvas.height - 8);
    ctx.strokeStyle = caseId ? '#2dd4bf' : '#475569';
    ctx.lineWidth = 7;
    ctx.strokeRect(4, 4, this.evidenceCanvas.width - 8, this.evidenceCanvas.height - 8);
    ctx.fillStyle = caseId ? '#99f6e4' : '#94a3b8';
    ctx.font = '700 24px ui-monospace, monospace';
    ctx.fillText(caseId ? 'ACTIVE CASE EVIDENCE' : 'NO ACTIVE CASE', 30, 48);
    ctx.fillStyle = '#edf6ff';
    ctx.font = '700 34px system-ui, sans-serif';
    ctx.fillText(caseId ? `${aircraftId || 'CASE'} · ${count} SAVED` : 'Open a case on the dashboard', 30, 105);
    ctx.fillStyle = caseId ? '#2dd4bf' : '#64748b';
    ctx.beginPath();
    ctx.arc(590, 80, 22, 0, Math.PI * 2);
    ctx.fill();
    this.evidenceTexture.needsUpdate = true;
    this.drawSnapshotButton();
  }

  update(delta, time, { camera = null } = {}) {
    if (this.disposed || !this.presenting) return;
    if (!this.pinned && this.dockTarget) {
      this.dockTarget.getWorldPosition(this.dockTargetPosition);
      this.dockTarget.getWorldQuaternion(this.dockTargetQuaternion);
      this.group.position.lerp(this.dockTargetPosition, 1 - Math.exp(-delta * 16));
      this.group.quaternion.slerp(this.dockTargetQuaternion, 1 - Math.exp(-delta * 16));
    } else if (!this.pinned && camera) {
      camera.getWorldPosition(this.cameraPosition);
      camera.getWorldQuaternion(this.cameraQuaternion);
      const desired = this.dockOffset.clone().applyQuaternion(this.cameraQuaternion).add(this.cameraPosition);
      this.group.position.lerp(desired, 1 - Math.exp(-delta * 14));
    }
    if (camera && !this.dockTarget) {
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
    this.orb.material.size = this.pointSize * (0.93 + level * 0.79);
    this.ring.rotation.z -= delta * (0.35 + level * 2);
    this.ring.material.opacity = 0.35 + level * 0.55;
    const panelScale = THREE.MathUtils.lerp(this.panel.scale.x, this.panelTarget, 1 - Math.exp(-delta * 11));
    this.panel.scale.setScalar(Math.max(0.001, panelScale));
    for (const animation of [...this.captureAnimations]) {
      animation.elapsed += delta;
      const progress = Math.min(1, animation.elapsed / animation.duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      animation.mesh.position.lerpVectors(animation.from, animation.to, eased);
      const scale = THREE.MathUtils.lerp(1, 0.28, eased);
      animation.mesh.scale.setScalar(scale);
      animation.mesh.material.opacity = 1 - Math.max(0, (progress - 0.72) / 0.28);
      if (progress >= 1) {
        this.group.remove(animation.mesh);
        animation.mesh.geometry.dispose();
        animation.mesh.material.dispose();
        animation.texture.dispose();
        this.captureAnimations.splice(this.captureAnimations.indexOf(animation), 1);
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.presenting = false;
    this.group.visible = false;
    this.disconnect();
    const geometries = new Set();
    const materials = new Set();
    for (const animation of this.captureAnimations.splice(0)) {
      this.group.remove(animation.mesh);
      animation.mesh.geometry.dispose();
      animation.mesh.material.dispose();
      animation.texture.dispose();
    }
    const textures = new Set([this.texture, this.micTexture, this.snapshotTexture, this.scanTexture, this.evidenceTexture]);
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
