(() => {
  const api = globalThis.MXApplicationClient?.witness;
  const joinCard = document.getElementById('joinCard');
  const joinForm = document.getElementById('joinForm');
  const witnessPin = document.getElementById('witnessPin');
  const joinStatus = document.getElementById('joinStatus');
  const roomElement = document.getElementById('room');
  const roomAudience = document.getElementById('roomAudience');
  const connectionState = document.getElementById('connectionState');
  const videoCard = document.getElementById('videoCard');
  const video = document.getElementById('witnessVideo');
  const lastFrame = document.getElementById('witnessLastFrame');
  const lastFrameContext = lastFrame.getContext('2d', { alpha: false });
  const videoWaiting = document.getElementById('videoWaiting');
  const videoWaitingTitle = document.getElementById('videoWaitingTitle');
  const videoWaitingDetail = document.getElementById('videoWaitingDetail');
  const liveFlag = document.getElementById('liveFlag');
  const roomMessage = document.getElementById('roomMessage');
  const commentForm = document.getElementById('commentForm');
  const commentText = document.getElementById('commentText');
  const microphoneButton = document.getElementById('microphoneButton');
  const microphoneStatus = document.getElementById('microphoneStatus');
  const recordingConsent = document.getElementById('recordingConsent');
  const targetSection = document.getElementById('targetSection');
  const targetName = document.getElementById('targetName');
  const targetDetail = document.getElementById('targetDetail');
  const caseSection = document.getElementById('caseSection');
  const caseAircraft = document.getElementById('caseAircraft');
  const caseDiscrepancy = document.getElementById('caseDiscrepancy');
  const caseState = document.getElementById('caseState');
  const mediaSection = document.getElementById('mediaSection');
  const mediaGrid = document.getElementById('mediaGrid');
  const emptyContext = document.getElementById('emptyContext');
  let viewerSession = null;
  let room = null;
  let socket = null;
  let socketGeneration = 0;
  let reconnectAttempt = 0;
  let reconnectTimer = 0;
  let peer = null;
  let projection = {};
  let mediaGeneration = 0;
  let mediaObjectUrls = [];
  let microphoneStream = null;
  let microphoneState = 'off';
  let microphoneRequestGeneration = 0;
  let liveFrameReceived = false;
  let playbackBlocked = false;
  let peerConnected = false;
  let frameCallbackGeneration = 0;
  let lastFrameSnapshotAt = 0;
  let fallbackDecodedFrames = -1;

  const mediaHealth = new globalThis.MXWitnessMediaHealth({
    stallMs: 4_500,
    recoveryWindowMs: 5_000,
    maxRecoveryAttempts: 3,
    onState: (status) => {
      liveFrameReceived = status.state === 'live';
      videoCard.dataset.viewState = ['recovering', 'unavailable'].includes(status.state)
        ? 'recovering' : status.state;
      if (status.state === 'live') lastFrame.hidden = true;
      else if (lastFrame.width > 0 && lastFrame.height > 0) lastFrame.hidden = false;
      renderRoom();
    },
    onRecover: ({ attempt, maxAttempts }) => {
      resetPeerForRecovery();
      const requested = send({ type: 'witness.signal', signal: { kind: 'viewer-ready' } });
      roomMessage.textContent = requested
        ? `Restoring the private live view · attempt ${attempt} of ${maxAttempts}.`
        : 'The private link is reconnecting before video recovery can continue.';
    }
  });

  function clean(value, fallback = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
  }

  function setConnection(label, state = 'waiting') {
    connectionState.dataset.state = state;
    connectionState.querySelector('strong').textContent = label;
  }

  function setVideoWaiting(title, detail, action = '') {
    videoWaitingTitle.textContent = title;
    videoWaitingDetail.textContent = detail;
    videoCard.dataset.action = action;
  }

  function hasDecodedFrame() {
    return liveFrameReceived;
  }

  function captureLastFrame() {
    if (!video.srcObject || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    const now = Date.now();
    if (lastFrame.width > 0 && now - lastFrameSnapshotAt < 750) return;
    try {
      if (lastFrame.width !== video.videoWidth || lastFrame.height !== video.videoHeight) {
        lastFrame.width = video.videoWidth;
        lastFrame.height = video.videoHeight;
      }
      lastFrameContext.drawImage(video, 0, 0, lastFrame.width, lastFrame.height);
      lastFrameSnapshotAt = now;
    } catch (_) {
      // A transient decoder transition must not interrupt the live element.
    }
  }

  function clearLastFrame() {
    lastFrame.hidden = true;
    lastFrameContext.clearRect(0, 0, lastFrame.width, lastFrame.height);
    lastFrame.width = 0;
    lastFrame.height = 0;
    lastFrameSnapshotAt = 0;
  }

  function markLiveFrame() {
    if (!video.srcObject || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    const wasLive = liveFrameReceived;
    captureLastFrame();
    playbackBlocked = false;
    mediaHealth.frame();
    if (!wasLive) roomMessage.textContent = 'Live video is flowing through the private peer-to-peer view.';
  }

  function decodedFrameCount() {
    const qualityFrames = Number(video.getVideoPlaybackQuality?.().totalVideoFrames);
    if (Number.isFinite(qualityFrames)) return qualityFrames;
    const webkitFrames = Number(video.webkitDecodedFrameCount);
    return Number.isFinite(webkitFrames) ? webkitFrames : null;
  }

  function observeFallbackFrame() {
    if (typeof video.requestVideoFrameCallback === 'function' || !video.srcObject) return;
    const decodedFrames = decodedFrameCount();
    if (decodedFrames === null) {
      if (fallbackDecodedFrames >= 0) return;
      fallbackDecodedFrames = 0;
    } else {
      if (decodedFrames <= 0 || decodedFrames <= fallbackDecodedFrames) return;
      fallbackDecodedFrames = decodedFrames;
    }
    markLiveFrame();
  }

  function startFrameMonitoring() {
    const generation = ++frameCallbackGeneration;
    if (typeof video.requestVideoFrameCallback !== 'function') {
      fallbackDecodedFrames = -1;
      observeFallbackFrame();
      return;
    }
    const observeFrame = () => {
      if (generation !== frameCallbackGeneration || !video.srcObject) return;
      markLiveFrame();
      video.requestVideoFrameCallback(observeFrame);
    };
    video.requestVideoFrameCallback(observeFrame);
  }

  async function attemptLivePlayback() {
    if (!video.srcObject) return;
    try {
      await video.play();
      playbackBlocked = false;
      startFrameMonitoring();
    } catch (_) {
      playbackBlocked = true;
      renderRoom();
    }
  }

  function renderVideoState(state) {
    const roomLive = state === 'live' && room?.layers?.pov !== false;
    const decoded = roomLive && hasDecodedFrame();
    videoWaiting.hidden = decoded;
    liveFlag.hidden = !decoded;
    if (decoded) {
      setConnection('Live view', 'live');
      videoCard.dataset.action = '';
      return;
    }
    const health = mediaHealth.status();
    if (roomLive && ['recovering', 'unavailable'].includes(health.state)) {
      setConnection(health.state === 'unavailable' ? 'Live view interrupted' : 'Restoring live view', 'waiting');
      setVideoWaiting(
        health.state === 'unavailable' ? 'The live picture needs a restart' : 'Video interrupted · restoring',
        health.state === 'unavailable'
          ? 'The automatic recovery limit was reached. Ask the technician to pause and resume the private view.'
          : 'Holding the last good frame while the peer-to-peer video path reconnects.'
      );
      return;
    }
    if (playbackBlocked && video.srcObject) {
      setConnection('View ready', 'waiting');
      setVideoWaiting('Live view is ready', 'Tap the view once to let this browser resume the live picture.', 'resume');
      return;
    }
    if (roomLive && (peerConnected || video.srcObject)) {
      setConnection('Connected · waiting for video', 'waiting');
      setVideoWaiting(
        'Connected · waiting for the first frame',
        'On the headset, select Start live view and approve the screen-sharing request. The guest browser does not need camera permission.'
      );
      return;
    }
    if (state === 'paused') {
      setVideoWaiting('Live view paused', 'The technician can resume this same private view from the headset.');
    } else if (['revoked', 'expired'].includes(state)) {
      setVideoWaiting('This guest view has ended', 'Ask the technician for a new service PIN if another view is needed.');
    } else if (state === 'headset-offline') {
      setVideoWaiting('Waiting for the headset', 'The private room is ready and will continue automatically when the headset reconnects.');
    } else {
      setVideoWaiting('Waiting for wearer approval', 'The technician controls when the live view begins and can pause it at any time.');
    }
  }

  function renderMicrophone() {
    const supported = Boolean(navigator.mediaDevices?.getUserMedia);
    const ended = !viewerSession || ['revoked', 'expired'].includes(room?.status);
    microphoneButton.disabled = microphoneState === 'requesting' || ended || !supported;
    microphoneButton.setAttribute('aria-pressed', microphoneState === 'live' ? 'true' : 'false');
    microphoneButton.textContent = microphoneState === 'live' ? 'Mute'
      : microphoneState === 'muted' ? 'Unmute'
        : microphoneState === 'requesting' ? 'Waiting…' : 'Enable microphone';
    microphoneStatus.textContent = !supported ? 'Microphone sharing is unavailable in this browser.'
      : microphoneState === 'live' ? 'Microphone on. The technician can hear you.'
        : microphoneState === 'muted' ? 'Microphone muted.'
          : microphoneState === 'requesting' ? 'Waiting for browser permission…'
            : microphoneState === 'blocked' ? 'Permission was not granted. Video and text still work.'
              : 'Microphone is off until you enable it.';
  }

  function attachMicrophone(connection) {
    if (!connection || !microphoneStream?.active) return false;
    const existing = new Set((connection.getSenders?.() || []).map((sender) => sender.track?.id));
    let added = false;
    for (const track of microphoneStream.getAudioTracks()) {
      if (existing.has(track.id)) continue;
      connection.addTrack(track, microphoneStream);
      added = true;
    }
    return added;
  }

  function stopMicrophone(nextState = 'off') {
    microphoneRequestGeneration += 1;
    for (const track of microphoneStream?.getTracks?.() || []) track.stop();
    microphoneStream = null;
    microphoneState = nextState;
    renderMicrophone();
  }

  async function toggleMicrophone() {
    if (microphoneState === 'live' || microphoneState === 'muted') {
      const enable = microphoneState === 'muted';
      for (const track of microphoneStream?.getAudioTracks?.() || []) track.enabled = enable;
      microphoneState = enable ? 'live' : 'muted';
      renderMicrophone();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      microphoneState = 'blocked';
      renderMicrophone();
      return;
    }
    microphoneState = 'requesting';
    renderMicrophone();
    const requestGeneration = ++microphoneRequestGeneration;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
      if (requestGeneration !== microphoneRequestGeneration || !viewerSession || ['paused', 'revoked', 'expired', 'headset-offline'].includes(room?.status)) {
        for (const track of stream.getTracks()) track.stop();
        microphoneState = 'off';
        renderMicrophone();
        return;
      }
      microphoneStream = stream;
      microphoneState = 'live';
      for (const track of stream.getAudioTracks()) {
        track.addEventListener('ended', () => {
          if (microphoneStream === stream) stopMicrophone('off');
        }, { once: true });
      }
      const added = attachMicrophone(peer);
      renderMicrophone();
      roomMessage.textContent = 'Microphone enabled by you.';
      if (added && room?.status === 'live') send({ type: 'witness.signal', signal: { kind: 'viewer-ready' } });
    } catch (_) {
      if (requestGeneration === microphoneRequestGeneration) stopMicrophone('blocked');
    }
  }

  function renderRoom() {
    if (!room) return;
    roomAudience.textContent = clean(room.audience, 'Aircraft inspection');
    const state = room.status || 'waiting';
    setConnection(state.replaceAll('-', ' '), ['revoked', 'expired'].includes(state) ? 'ended' : 'waiting');
    renderVideoState(state);
    recordingConsent.checked = Boolean(room.recording?.viewerConsented);
    recordingConsent.disabled = ['revoked', 'expired'].includes(state);
    const mediaOpen = Boolean(peer || video.srcObject || mediaHealth.status().active);
    if (mediaOpen && ['paused', 'headset-offline'].includes(state)) closePeer({ preserveLastFrame: true });
    if (mediaOpen && ['revoked', 'expired'].includes(state)) closePeer({ preserveLastFrame: false });
    renderProjection();
  }

  function renderProjection() {
    const layers = room?.layers || {};
    const target = layers.target === false ? null : projection.target;
    const caseSummary = layers.caseSummary === false ? null : projection.caseSummary;
    const caseMedia = layers.caseMedia ? projection.caseMedia : null;
    targetSection.hidden = !target;
    if (target) {
      targetName.textContent = clean(target.label || target.name, 'Selected component');
      targetDetail.textContent = clean(target.detail || target.description || target.classification, 'Technician-selected spatial target');
    }
    caseSection.hidden = !caseSummary;
    if (caseSummary) {
      caseAircraft.textContent = clean(caseSummary.aircraftId || caseSummary.tailNumber, 'Aircraft');
      caseDiscrepancy.textContent = clean(caseSummary.discrepancy, 'Maintenance case shared by the technician.');
      caseState.textContent = clean(caseSummary.status, 'Active').toUpperCase();
    }
    const media = Array.isArray(caseMedia) ? caseMedia.slice(0, 8) : [];
    void renderMedia(media);
    emptyContext.hidden = !targetSection.hidden || !caseSection.hidden || !mediaSection.hidden;
  }

  async function renderMedia(items) {
    const generation = ++mediaGeneration;
    for (const source of mediaObjectUrls) URL.revokeObjectURL(source);
    mediaObjectUrls = [];
    mediaGrid.replaceChildren();
    mediaSection.hidden = true;
    if (!viewerSession?.credential || !items.length) return;
    const results = await Promise.allSettled(items.map(async (item) => ({
      item,
      source: URL.createObjectURL(await api.getMedia({
        observationId: item.observationId,
        mediaIndex: item.mediaIndex,
        credential: viewerSession.credential
      }))
    })));
    if (generation !== mediaGeneration) {
      for (const result of results) if (result.status === 'fulfilled') URL.revokeObjectURL(result.value.source);
      return;
    }
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const { item, source } = result.value;
      const element = document.createElement(item.kind === 'video' ? 'video' : 'img');
      element.src = source;
      if (element instanceof HTMLVideoElement) {
        element.controls = true;
        element.preload = 'metadata';
      } else {
        element.alt = clean(item.note, 'Shared case evidence');
        element.loading = 'lazy';
      }
      mediaObjectUrls.push(source);
      mediaGrid.append(element);
    }
    mediaSection.hidden = mediaGrid.childElementCount === 0;
    emptyContext.hidden = !targetSection.hidden || !caseSection.hidden || !mediaSection.hidden;
  }

  async function join(input) {
    if (!api) throw new Error('Remote Witness is unavailable.');
    joinForm.querySelector('button').disabled = true;
    joinStatus.textContent = 'Checking service PIN…';
    try {
      viewerSession = await api.exchangeInvitation(input);
      room = viewerSession.state;
      witnessPin.value = '';
      history.replaceState(null, '', `${location.pathname}`);
      joinCard.hidden = true;
      roomElement.hidden = false;
      renderRoom();
      renderMicrophone();
      connectSocket();
    } catch (error) {
      joinStatus.textContent = clean(error?.message, 'That PIN could not be opened. Check it and try again.');
    } finally {
      joinForm.querySelector('button').disabled = false;
    }
  }

  function connectSocket() {
    clearTimeout(reconnectTimer);
    socketGeneration += 1;
    const generation = socketGeneration;
    if (socket) socket.close();
    try {
      socket = new WebSocket(api.socketUrl(viewerSession.socketPath), ['mxg-witness.v1', viewerSession.credential]);
    } catch (error) {
      roomMessage.textContent = clean(error?.message, 'Unable to open the private viewing link.');
      return;
    }
    socket.addEventListener('open', () => {
      if (generation !== socketGeneration) return;
      reconnectAttempt = 0;
      roomMessage.textContent = 'Private guest room connected. Waiting for the technician.';
      send({ type: 'witness.signal', signal: { kind: 'viewer-ready' } });
    });
    socket.addEventListener('message', (event) => {
      if (generation !== socketGeneration) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      void handleMessage(message);
    });
    socket.addEventListener('close', () => {
      if (generation !== socketGeneration) return;
      closePeer({ preserveLastFrame: true });
      if (Date.now() >= Number(viewerSession.expiresAtMs) || ['revoked', 'expired'].includes(room?.status)) return;
      const delay = Math.min(10_000, 500 * (2 ** reconnectAttempt));
      reconnectAttempt += 1;
      roomMessage.textContent = 'Connection interrupted · reconnecting…';
      reconnectTimer = setTimeout(connectSocket, delay);
    });
  }

  function send(payload) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  }

  async function handleMessage(message) {
    if (message?.room) {
      const priorState = room?.status;
      room = message.room;
      renderRoom();
      if (room.status === 'live' && priorState !== 'live' && !peer) {
        send({ type: 'witness.signal', signal: { kind: 'viewer-ready' } });
      }
    }
    if (message?.type === 'witness.state') {
      projection = message.state || {};
      renderProjection();
    }
    if (message?.type === 'witness.proposed-observation') roomMessage.textContent = 'Observation sent to the technician for review.';
    if (message?.type === 'witness.error') roomMessage.textContent = clean(message.message, 'The witness service rejected that request.');
    if (message?.type === 'witness.room-ended') {
      viewerSession = null;
      socketGeneration += 1;
      socket?.close();
      socket = null;
      closePeer({ preserveLastFrame: false });
      setConnection('Session ended', 'ended');
      roomMessage.textContent = 'This temporary guest room has closed.';
      commentText.disabled = true;
      commentForm.querySelector('button').disabled = true;
      recordingConsent.disabled = true;
      microphoneButton.disabled = true;
      return;
    }
    if (message?.type !== 'witness.signal' || message.from !== 'producer') return;
    const signal = message.signal || {};
    if (signal.to && signal.to !== viewerSession.participantId) return;
    if (signal.kind === 'offer' && signal.description) {
      const connection = ensurePeer();
      await connection.setRemoteDescription(signal.description);
      attachMicrophone(connection);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      send({ type: 'witness.signal', signal: { kind: 'answer', description: connection.localDescription } });
    } else if (signal.kind === 'ice' && signal.candidate) {
      await ensurePeer().addIceCandidate(signal.candidate).catch(() => {});
    }
  }

  function ensurePeer() {
    if (peer && !['closed', 'failed'].includes(peer.connectionState)) return peer;
    resetPeerForRecovery();
    const connection = new RTCPeerConnection({ iceServers: viewerSession.iceServers || [] });
    peer = connection;
    connection.addEventListener('icecandidate', (event) => {
      if (event.candidate) send({ type: 'witness.signal', signal: { kind: 'ice', candidate: event.candidate } });
    });
    connection.addEventListener('track', (event) => {
      liveFrameReceived = false;
      playbackBlocked = false;
      video.srcObject = event.streams[0] || new MediaStream([event.track]);
      mediaHealth.start();
      event.track.addEventListener('mute', () => {
        mediaHealth.interrupt('track-muted', { delayMs: 1_500 });
      });
      event.track.addEventListener('unmute', () => void attemptLivePlayback());
      event.track.addEventListener('ended', () => {
        mediaHealth.interrupt('track-ended');
      }, { once: true });
      void attemptLivePlayback();
      renderRoom();
    });
    connection.addEventListener('connectionstatechange', () => {
      if (peer !== connection) return;
      peerConnected = connection.connectionState === 'connected';
      if (peerConnected) roomMessage.textContent = 'Private peer-to-peer path connected. Waiting for live video frames.';
      if (connection.connectionState === 'disconnected') {
        mediaHealth.interrupt('peer-disconnected', { delayMs: 1_500 });
      } else if (['failed', 'closed'].includes(connection.connectionState)) {
        mediaHealth.interrupt(`peer-${connection.connectionState}`);
      }
      renderRoom();
    });
    return connection;
  }

  function resetPeerForRecovery() {
    if (!peer) return;
    const stalePeer = peer;
    peer = null;
    peerConnected = false;
    frameCallbackGeneration += 1;
    captureLastFrame();
    video.srcObject = null;
    try { stalePeer.close(); } catch (_) { /* already closed */ }
  }

  function closePeer({ preserveLastFrame = false } = {}) {
    if (preserveLastFrame) captureLastFrame();
    frameCallbackGeneration += 1;
    const closingPeer = peer;
    peer = null;
    peerConnected = false;
    liveFrameReceived = false;
    playbackBlocked = false;
    video.srcObject = null;
    mediaHealth.stop();
    closingPeer?.close();
    if (preserveLastFrame && lastFrame.width > 0) lastFrame.hidden = false;
    else clearLastFrame();
    stopMicrophone('off');
    if (room) {
      videoWaiting.hidden = false;
      liveFlag.hidden = true;
    }
  }

  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const pin = witnessPin.value.replace(/\D/g, '');
    if (pin.length !== 7) {
      joinStatus.textContent = 'Enter the 7-digit PIN shown by the technician.';
      return;
    }
    void join({ pin });
  });

  commentForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = clean(commentText.value);
    if (!text) return;
    if (send({ type: 'witness.comment', text })) {
      commentText.value = '';
      roomMessage.textContent = 'Sending observation…';
    }
  });

  microphoneButton.addEventListener('click', () => {
    void toggleMicrophone();
  });

  recordingConsent.addEventListener('change', () => {
    send({ type: 'witness.recording-consent', consent: recordingConsent.checked });
  });

  for (const eventName of ['loadeddata', 'canplay', 'playing', 'timeupdate']) {
    video.addEventListener(eventName, observeFallbackFrame);
  }
  video.addEventListener('emptied', () => {
    if (!video.srcObject) {
      renderRoom();
      return;
    }
    if (room?.status === 'live' && mediaHealth.status().active) {
      mediaHealth.interrupt('media-emptied');
    }
    renderRoom();
  });
  videoCard.addEventListener('click', () => {
    if (videoCard.dataset.action === 'resume') void attemptLivePlayback();
  });

  window.addEventListener('pagehide', () => {
    clearTimeout(reconnectTimer);
    socketGeneration += 1;
    socket?.close();
    closePeer({ preserveLastFrame: false });
    for (const source of mediaObjectUrls) URL.revokeObjectURL(source);
    mediaObjectUrls = [];
  });

  renderMicrophone();
})();
