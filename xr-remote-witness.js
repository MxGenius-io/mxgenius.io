import * as THREE from 'three';

const DEFAULT_LAYERS = Object.freeze({
  pov: true,
  thermal: false,
  target: true,
  caseSummary: true,
  caseMedia: false,
  microphone: false
});

function clean(value, fallback = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

function rounded(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function expiresIn(expiresAtMs) {
  const seconds = Math.max(0, Math.ceil((Number(expiresAtMs) - Date.now()) / 1000));
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)}m`;
  return `${seconds}s`;
}

export class XRRemoteWitnessPanel {
  constructor({
    api = globalThis.MXApplicationClient?.witness,
    sessionProvider,
    xrSessionId,
    caseProvider = () => null,
    projectionProvider = () => ({}),
    mediaStreamProvider,
    nativeBootstrapProvider,
    onAction = () => {},
    onStatus = () => {}
  } = {}) {
    if (!api || typeof api.createInvitation !== 'function') throw new TypeError('Remote Witness API is required');
    if (typeof sessionProvider !== 'function') throw new TypeError('Remote Witness session provider is required');
    this.api = api;
    this.sessionProvider = sessionProvider;
    this.xrSessionId = clean(xrSessionId);
    this.caseProvider = caseProvider;
    this.projectionProvider = projectionProvider;
    this.mediaStreamProvider = mediaStreamProvider;
    this.nativeBootstrapProvider = nativeBootstrapProvider;
    this.onAction = onAction;
    this.onStatus = onStatus;
    this.presenting = false;
    this.open = false;
    this.panelTarget = 0;
    this.invitation = null;
    this.room = null;
    this.socket = null;
    this.socketGeneration = 0;
    this.reconnectTimer = 0;
    this.reconnectAttempt = 0;
    this.peers = new Map();
    this.localStream = null;
    this.nativeProducer = false;
    this.qrImage = null;
    this.busy = false;
    this.message = 'Create an invitation when the customer is ready.';
    this.disposed = false;
    this.cameraPosition = new THREE.Vector3();
    this.cameraQuaternion = new THREE.Quaternion();
    this.targetPosition = new THREE.Vector3();
    this.localPoint = new THREE.Vector3();
    this.headOffset = new THREE.Vector3(-0.47, 0.28, -0.86);

    this.group = new THREE.Group();
    this.group.name = 'MXGeniusRemoteWitness';
    this.group.visible = false;

    this.buttonCanvas = document.createElement('canvas');
    this.buttonCanvas.width = 256;
    this.buttonCanvas.height = 256;
    this.buttonContext = this.buttonCanvas.getContext('2d');
    this.buttonTexture = new THREE.CanvasTexture(this.buttonCanvas);
    this.buttonTexture.colorSpace = THREE.SRGBColorSpace;
    this.button = this.makeSurface('MXGeniusWitnessButton', 0.105, 0.105, this.buttonTexture, 'toggle');
    this.group.add(this.button);

    this.panelRoot = new THREE.Group();
    this.panelRoot.name = 'MXGeniusWitnessPanel';
    // Open toward the center of the wearer's view so the panel remains inside
    // the headset frustum instead of growing past the left edge.
    this.panelRoot.position.set(0.39, -0.32, -0.018);
    this.panelRoot.scale.setScalar(0.001);
    this.panelRoot.visible = false;
    this.group.add(this.panelRoot);

    this.panelCanvas = document.createElement('canvas');
    this.panelCanvas.width = 1024;
    this.panelCanvas.height = 880;
    this.panelContext = this.panelCanvas.getContext('2d');
    this.panelTexture = new THREE.CanvasTexture(this.panelCanvas);
    this.panelTexture.colorSpace = THREE.SRGBColorSpace;
    this.panel = this.makeSurface('MXGeniusWitnessSurface', 0.78, 0.67, this.panelTexture);
    this.panelRoot.add(this.panel);

    this.closeButton = this.makeHitTarget('MXGeniusWitnessClose', 0.07, 0.07, 'close', 0.342, 0.285);
    this.actionTargets = [
      this.makeHitTarget('MXGeniusWitnessInvite', 0.30, 0.07, 'invite', -0.185, -0.190),
      this.makeHitTarget('MXGeniusWitnessApproval', 0.30, 0.07, 'approval', 0.185, -0.190),
      this.makeHitTarget('MXGeniusWitnessLayers', 0.30, 0.07, 'layers', -0.185, -0.269),
      this.makeHitTarget('MXGeniusWitnessRevoke', 0.30, 0.07, 'revoke', 0.185, -0.269)
    ];
    this.panelRoot.add(this.closeButton, ...this.actionTargets);
    this.drawButton();
    this.drawPanel();
  }

  makeSurface(name, width, height, texture, action = '') {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    mesh.name = name;
    if (action) mesh.userData.xrWitnessAction = action;
    mesh.userData.xrHitSize = { width, height };
    return mesh;
  }

  makeHitTarget(name, width, height, action, x, y) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, side: THREE.DoubleSide })
    );
    mesh.name = name;
    mesh.position.set(x, y, 0.012);
    mesh.userData.xrWitnessAction = action;
    mesh.userData.xrHitSize = { width, height };
    return mesh;
  }

  interactiveObjects() {
    if (!this.presenting || !this.group.visible) return [];
    return this.open ? [this.button, this.closeButton, ...this.actionTargets] : [this.button];
  }

  owns(object) {
    let node = object;
    while (node) {
      if (node.userData?.xrWitnessAction) return true;
      node = node.parent;
    }
    return false;
  }

  handleObject(object, input = 'xr') {
    if (!this.owns(object) || this.busy) return false;
    let target = object;
    while (target && !target.userData?.xrWitnessAction) target = target.parent;
    const action = target?.userData?.xrWitnessAction;
    if (action === 'toggle') this.setOpen(!this.open, input);
    else if (action === 'close') this.setOpen(false, input);
    else if (action === 'invite') void this.createInvitation(input);
    else if (action === 'approval') void this.toggleApproval(input);
    else if (action === 'layers') void this.toggleShareLayers(input);
    else if (action === 'revoke') void this.revoke(input);
    else return false;
    return true;
  }

  fingerTargetAt(point) {
    for (const target of this.interactiveObjects()) {
      target.updateMatrixWorld(true);
      target.worldToLocal(this.localPoint.copy(point));
      const { width, height } = target.userData.xrHitSize;
      if (Math.abs(this.localPoint.z) < 0.04
        && Math.abs(this.localPoint.x) <= width / 2
        && Math.abs(this.localPoint.y) <= height / 2) return target;
    }
    return null;
  }

  setOpen(open, input = 'xr') {
    this.open = Boolean(open);
    this.panelTarget = this.open ? 1 : 0;
    if (this.open) this.panelRoot.visible = true;
    this.onAction('witness-panel-toggle', input, { open: this.open });
    this.drawButton();
  }

  async createInvitation(input = 'xr') {
    this.busy = true;
    this.message = 'Creating private invitation…';
    this.drawPanel();
    try {
      if (this.room && !['revoked', 'expired'].includes(this.room.status)) {
        this.message = 'The current invitation is still active.';
        return;
      }
      const activeCase = this.caseProvider?.() || null;
      const session = await this.sessionProvider();
      const invitation = await this.api.createInvitation({
        xrSessionId: this.xrSessionId,
        caseId: activeCase?.caseId || null,
        audience: 'Aircraft customer',
        layers: { ...DEFAULT_LAYERS },
        session
      });
      this.invitation = invitation;
      this.room = invitation.state;
      this.loadQr(invitation.qrDataUrl);
      this.nativeProducer = false;
      if (typeof this.nativeBootstrapProvider === 'function') {
        try {
          await this.nativeBootstrapProvider({
            ...invitation,
            socketUrl: this.api.socketUrl(invitation.socketPath)
          }, this.projectionSnapshot());
          this.nativeProducer = true;
          this.message = 'Sensor Bridge received the room. Customer can scan the QR or enter the join code.';
        } catch {
          this.message = 'Native handoff unavailable · using the browser witness view.';
        }
      }
      if (!this.nativeProducer) {
        this.connectSocket(invitation.producerCredential, invitation.socketPath, invitation.sessionExpiresAtMs);
      }
      this.onAction('witness-invitation-created', input, { roomId: invitation.roomId });
    } catch (error) {
      this.message = clean(error?.message, 'Invitation could not be created.');
    } finally {
      this.busy = false;
      this.drawPanel();
      this.emitStatus();
    }
  }

  async toggleApproval(input = 'xr') {
    if (!this.invitation?.roomId) {
      this.message = 'Create an invitation first.';
      this.drawPanel();
      return;
    }
    const action = this.room?.status === 'live' ? 'pause'
      : this.room?.approved ? 'resume' : 'approve';
    if (!this.nativeProducer && ['approve', 'resume'].includes(action) && !this.localStream?.active) {
      try {
        // This runs only from the wearer's explicit APPROVE/RESUME gesture.
        // Acquiring the local source never grants the customer access by itself;
        // tracks are attached only after the server confirms the live state.
        this.localStream = await this.mediaStreamProvider?.({
          includeMicrophone: Boolean(this.room?.layers?.microphone)
        }) || null;
      } catch (error) {
        this.message = clean(error?.message, 'The shared view was not approved by the wearer.');
        this.drawPanel();
        return;
      }
    }
    const accepted = await this.control(action, {}, input);
    if (!accepted) {
      if (['approve', 'resume'].includes(action)) this.closeMedia();
      return;
    }
    if (['approve', 'resume'].includes(action)) {
      this.publishProjection();
      await this.negotiateAll();
    }
  }

  async toggleShareLayers(input = 'xr') {
    if (!this.invitation?.roomId) return;
    const current = this.room?.layers || DEFAULT_LAYERS;
    await this.control('set-layers', {
      layers: {
        ...current,
        thermal: !current.thermal,
        caseMedia: !current.caseMedia
      }
    }, input);
    this.publishProjection();
  }

  async revoke(input = 'xr') {
    if (!this.invitation?.roomId || this.room?.status === 'revoked') return;
    await this.control('revoke', {}, input);
    this.closeMedia();
  }

  async control(action, extra = {}, input = 'xr') {
    this.busy = true;
    let accepted = false;
    this.drawPanel();
    try {
      const session = await this.sessionProvider();
      this.room = await this.api.controlRoom(this.invitation.roomId, { action, ...extra }, session);
      this.message = action === 'revoke' ? 'Customer access revoked.' : `Witness ${this.room.status}.`;
      if (['pause', 'revoke'].includes(action)) this.closeMedia();
      this.onAction(`witness-${action}`, input, { roomId: this.invitation.roomId, status: this.room.status });
      accepted = true;
    } catch (error) {
      this.message = clean(error?.message, 'Witness control failed.');
    } finally {
      this.busy = false;
      this.drawPanel();
      this.emitStatus();
    }
    return accepted;
  }

  loadQr(source) {
    if (!/^data:image\/svg\+xml;base64,/i.test(String(source || ''))) return;
    const image = new Image();
    image.onload = () => {
      if (this.disposed) return;
      this.qrImage = image;
      this.drawPanel();
    };
    image.src = source;
  }

  connectSocket(credential, socketPath, expiresAtMs) {
    clearTimeout(this.reconnectTimer);
    this.socketGeneration += 1;
    const generation = this.socketGeneration;
    if (this.socket) this.socket.close();
    let socket;
    try {
      socket = new WebSocket(this.api.socketUrl(socketPath), ['mxg-witness.v1', credential]);
    } catch (error) {
      this.message = clean(error?.message, 'Witness signaling is unavailable.');
      this.drawPanel();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (generation !== this.socketGeneration) return;
      this.reconnectAttempt = 0;
      this.message = 'Private witness room connected.';
      this.drawPanel();
      this.publishProjection();
    });
    socket.addEventListener('message', (event) => {
      if (generation !== this.socketGeneration) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      void this.handleSocketMessage(message);
    });
    socket.addEventListener('close', () => {
      if (generation !== this.socketGeneration || this.disposed) return;
      this.closeMedia();
      if (Date.now() >= Number(expiresAtMs) || ['revoked', 'expired'].includes(this.room?.status)) return;
      const delay = Math.min(10_000, 500 * (2 ** this.reconnectAttempt));
      this.reconnectAttempt += 1;
      this.message = 'Witness link interrupted · reconnecting…';
      this.drawPanel();
      this.reconnectTimer = setTimeout(() => this.connectSocket(credential, socketPath, expiresAtMs), delay);
    });
  }

  async handleSocketMessage(message) {
    if (message?.type === 'witness.error') {
      if (message.code !== 'WITNESS_APPROVAL_REQUIRED') {
        this.message = clean(message.message, 'Witness signaling rejected a request.');
        this.drawPanel();
      }
      return;
    }
    if (message?.room) {
      this.room = message.room;
      this.drawPanel();
      this.emitStatus();
      if (['paused', 'revoked', 'expired', 'headset-offline'].includes(this.room.status)) this.closeMedia();
    }
    if (message?.type === 'witness.signal' && message.from === 'customer-viewer') {
      const participantId = clean(message.participantId);
      if (!participantId) return;
      const signal = message.signal || {};
      if (signal.kind === 'viewer-ready') {
        await this.ensurePeer(participantId);
        if (this.room?.status === 'live') await this.negotiate(participantId);
      } else if (signal.kind === 'answer' && signal.description) {
        await this.ensurePeer(participantId);
        await this.peers.get(participantId).setRemoteDescription(signal.description);
      } else if (signal.kind === 'ice' && signal.candidate) {
        await this.ensurePeer(participantId);
        await this.peers.get(participantId).addIceCandidate(signal.candidate).catch(() => {});
      }
    }
  }

  send(payload) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  publishProjection() {
    const state = this.projectionSnapshot();
    this.send({
      type: 'witness.state.publish',
      state
    });
  }

  projectionSnapshot() {
    const source = this.projectionProvider?.() || {};
    const caseState = this.caseProvider?.() || null;
    return {
      target: source.target || null,
      caseSummary: source.caseSummary || (caseState ? {
        caseId: caseState.caseId,
        aircraftId: caseState.case?.aircraft_id || null,
        discrepancy: caseState.case?.discrepancy || null,
        status: caseState.case?.status || null
      } : null),
      caseMedia: source.caseMedia || caseState?.media?.slice(0, 8) || []
    };
  }

  async ensurePeer(participantId) {
    if (this.peers.has(participantId)) return this.peers.get(participantId);
    const peer = new RTCPeerConnection({ iceServers: this.invitation?.iceServers || [] });
    peer.addEventListener('icecandidate', (event) => {
      if (event.candidate) this.send({
        type: 'witness.signal',
        signal: { kind: 'ice', to: participantId, candidate: event.candidate }
      });
    });
    peer.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed'].includes(peer.connectionState)) {
        peer.close();
        this.peers.delete(participantId);
      }
    });
    this.peers.set(participantId, peer);
    return peer;
  }

  async ensureLocalStream() {
    if (this.localStream?.active) return this.localStream;
    if (this.room?.status !== 'live' || !this.room?.layers?.pov) return null;
    this.localStream = await this.mediaStreamProvider?.({ includeMicrophone: Boolean(this.room.layers.microphone) });
    return this.localStream || null;
  }

  async negotiate(participantId) {
    const peer = await this.ensurePeer(participantId);
    const stream = await this.ensureLocalStream();
    if (!stream) return;
    const existing = new Set(peer.getSenders().map((sender) => sender.track?.id));
    for (const track of stream.getTracks()) {
      if (!existing.has(track.id)) peer.addTrack(track, stream);
    }
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    this.send({
      type: 'witness.signal',
      signal: { kind: 'offer', to: participantId, description: peer.localDescription }
    });
  }

  async negotiateAll() {
    for (const participantId of this.peers.keys()) await this.negotiate(participantId);
  }

  closeMedia() {
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    for (const track of this.localStream?.getTracks?.() || []) track.stop();
    this.localStream = null;
  }

  emitStatus() {
    this.onStatus({ invitation: this.invitation, room: this.room, message: this.message });
  }

  setPresenting(presenting) {
    this.presenting = Boolean(presenting);
    this.group.visible = this.presenting;
    if (!this.presenting) {
      this.open = false;
      this.panelTarget = 0;
      this.panelRoot.visible = false;
      this.panelRoot.scale.setScalar(0.001);
    }
    this.drawButton();
  }

  drawButton() {
    const ctx = this.buttonContext;
    ctx.clearRect(0, 0, 256, 256);
    rounded(ctx, 12, 12, 232, 232, 42);
    ctx.fillStyle = 'rgba(5, 18, 31, 0.96)';
    ctx.fill();
    ctx.strokeStyle = this.room?.status === 'live' ? '#34d399' : this.open ? '#67e8f9' : '#3c647b';
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.strokeStyle = '#dff7ff';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(92, 102, 31, 0, Math.PI * 2);
    ctx.arc(164, 102, 31, 0, Math.PI * 2);
    ctx.moveTo(58, 172);
    ctx.quadraticCurveTo(92, 137, 126, 172);
    ctx.moveTo(130, 172);
    ctx.quadraticCurveTo(164, 137, 198, 172);
    ctx.stroke();
    ctx.fillStyle = '#dff7ff';
    ctx.font = '700 23px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('WITNESS', 128, 222);
    this.buttonTexture.needsUpdate = true;
  }

  drawPanel() {
    const ctx = this.panelContext;
    ctx.clearRect(0, 0, 1024, 880);
    rounded(ctx, 5, 5, 1014, 870, 30);
    ctx.fillStyle = 'rgba(5, 14, 27, 0.98)';
    ctx.fill();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.fillStyle = '#67e8f9';
    ctx.font = '700 28px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('REMOTE WITNESS', 48, 62);
    ctx.fillStyle = '#e7f8ff';
    ctx.font = '700 37px system-ui, sans-serif';
    ctx.fillText('Customer viewing', 48, 112);
    ctx.strokeStyle = '#8dc9db';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(934, 43); ctx.lineTo(974, 83);
    ctx.moveTo(974, 43); ctx.lineTo(934, 83);
    ctx.stroke();

    const state = this.room?.status || 'offline';
    const stateColor = state === 'live' ? '#34d399' : state === 'revoked' ? '#fb7185' : '#fbbf24';
    ctx.fillStyle = stateColor;
    ctx.beginPath(); ctx.arc(61, 155, 8, 0, Math.PI * 2); ctx.fill();
    ctx.font = '700 23px ui-monospace, monospace';
    ctx.fillText(state.toUpperCase(), 82, 163);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#9ab3c7';
    ctx.fillText(`${this.room?.viewerCount || 0} VIEWER · ${this.room ? expiresIn(this.room.expiresAtMs) : '--'}`, 970, 163);
    ctx.textAlign = 'left';

    rounded(ctx, 48, 188, 360, 360, 22);
    ctx.fillStyle = '#f8fafc'; ctx.fill();
    if (this.qrImage) ctx.drawImage(this.qrImage, 68, 208, 320, 320);
    else {
      ctx.fillStyle = '#203447';
      ctx.font = '700 25px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.busy ? 'CREATING…' : 'QR READY AFTER INVITE', 228, 375);
      ctx.textAlign = 'left';
    }
    ctx.fillStyle = '#8da8ba';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText('Manual join code', 456, 228);
    ctx.fillStyle = '#e7f8ff';
    ctx.font = '700 42px ui-monospace, monospace';
    ctx.fillText(this.invitation?.manualCode || '—— ———— ————', 456, 278);
    ctx.fillStyle = '#8da8ba';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(`Audience  ${clean(this.room?.audience, 'Aircraft customer')}`, 456, 336);
    ctx.fillText(`POV       ${this.room?.layers?.pov === false ? 'OFF' : 'ON'}`, 456, 378);
    ctx.fillText(`Thermal   ${this.room?.layers?.thermal ? 'ON' : 'OFF'}`, 456, 420);
    ctx.fillText(`Case      ${this.room?.layers?.caseSummary === false ? 'OFF' : 'SUMMARY'}`, 456, 462);
    ctx.fillText(`Media     ${this.room?.layers?.caseMedia ? 'ON' : 'OFF'}`, 456, 504);
    ctx.fillText(`Recording ${String(this.room?.recording?.state || 'off').toUpperCase()}`, 456, 546);
    ctx.fillStyle = '#9ab3c7';
    ctx.font = '21px system-ui, sans-serif';
    ctx.fillText(clean(this.message).slice(0, 78), 48, 602);

    const buttons = [
      ['invite', this.room && !['revoked', 'expired'].includes(state) ? 'INVITE ACTIVE' : 'CREATE INVITE'],
      ['approval', state === 'live' ? 'PAUSE VIEW' : this.room?.approved ? 'RESUME VIEW' : 'APPROVE VIEW'],
      ['layers', this.room?.layers?.thermal ? 'HIDE EXTRAS' : 'SHARE EXTRAS'],
      ['revoke', 'REVOKE ACCESS']
    ];
    buttons.forEach(([key, label], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = 48 + column * 488;
      const y = 650 + row * 104;
      rounded(ctx, x, y, 440, 78, 16);
      const danger = key === 'revoke';
      ctx.fillStyle = danger ? 'rgba(84, 21, 34, .82)' : 'rgba(9, 47, 62, .92)'; ctx.fill();
      ctx.strokeStyle = danger ? '#fb7185' : '#2dd4bf'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = danger ? '#fecdd3' : '#b8fff2';
      ctx.font = '700 23px ui-monospace, monospace';
      ctx.textAlign = 'center'; ctx.fillText(label, x + 220, y + 49); ctx.textAlign = 'left';
    });
    this.panelTexture.needsUpdate = true;
    this.drawButton();
  }

  update(delta, { camera = null } = {}) {
    if (this.disposed || !this.presenting || !camera) return;
    camera.getWorldPosition(this.cameraPosition);
    camera.getWorldQuaternion(this.cameraQuaternion);
    this.targetPosition.copy(this.headOffset).applyQuaternion(this.cameraQuaternion).add(this.cameraPosition);
    const follow = 1 - Math.exp(-Math.max(0, delta) * 14);
    this.group.position.lerp(this.targetPosition, follow);
    this.group.quaternion.slerp(this.cameraQuaternion, follow);
    const reveal = 1 - Math.exp(-Math.max(0, delta) * 12);
    const scale = THREE.MathUtils.lerp(this.panelRoot.scale.x, this.panelTarget, reveal);
    this.panelRoot.scale.setScalar(Math.max(0.001, scale));
    if (!this.open && scale < 0.012) this.panelRoot.visible = false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.reconnectTimer);
    this.socketGeneration += 1;
    this.socket?.close();
    this.closeMedia();
    for (const mesh of [this.button, this.panel, this.closeButton, ...this.actionTargets]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.buttonTexture.dispose();
    this.panelTexture.dispose();
  }
}
