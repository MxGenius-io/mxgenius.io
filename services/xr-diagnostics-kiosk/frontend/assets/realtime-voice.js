const CONNECTION_TIMEOUT_MS = 30_000;
const ICE_GATHERING_TIMEOUT_MS = 5_000;
const MIN_TURN_MS = 180;

export class RealtimeVoice {
  constructor({ onEvent = () => {} } = {}) {
    this.onEvent = onEvent;
    this.peer = null;
    this.channel = null;
    this.media = null;
    this.audio = null;
    this.connecting = null;
    this.responseActive = false;
    this.responseId = null;
    this.talking = false;
    this.talkRequested = false;
    this.talkStartedAt = 0;
    this.eventSequence = 0;
    this.userTranscript = '';
    this.assistantTranscript = '';
    this.outputVolume = 0.7;
    this.state = 'disconnected';
  }

  emit(type, detail = {}) {
    this.onEvent({ type, state: this.state, ...detail });
  }

  setState(state, detail = {}) {
    this.state = state;
    this.emit('state', { state, ...detail });
  }

  async exchangeSdp(sdp) {
    const response = await fetch('/api/v1/realtime/calls', {
      method: 'POST',
      headers: { Accept: 'application/sdp', 'Content-Type': 'application/sdp' },
      body: sdp,
    });
    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json') ? await response.json() : null;
      throw new Error(payload?.detail || `Realtime setup failed (${response.status})`);
    }
    const answer = await response.text();
    if (!answer.startsWith('v=0')) throw new Error('Realtime returned an invalid SDP answer');
    return answer;
  }

  async connect() {
    if (this.channel?.readyState === 'open') return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async open() {
    this.disconnect(false);
    this.setState('connecting');
    try {
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.hidden = true;
      document.body.append(audio);
      this.audio = audio;

      const peer = new RTCPeerConnection();
      this.peer = peer;
      peer.addEventListener('track', (event) => {
        audio.srcObject = event.streams[0];
        audio.volume = this.outputVolume;
        void audio.play().catch(() => {});
      });
      peer.addEventListener('connectionstatechange', () => {
        if (peer.connectionState === 'failed') this.setState('failed', { reason: 'Realtime media connection failed' });
      });

      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.media = media;
      for (const track of media.getAudioTracks()) {
        track.enabled = false;
        peer.addTrack(track, media);
      }

      const channel = peer.createDataChannel('oai-events');
      this.channel = channel;
      channel.addEventListener('message', (event) => this.handleMessage(event.data));
      channel.addEventListener('close', () => {
        if (this.state !== 'disconnected') this.setState('failed', { reason: 'Realtime event channel closed' });
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await this.waitForIceGathering(peer);
      const answer = await this.exchangeSdp(peer.localDescription?.sdp || offer.sdp);
      await peer.setRemoteDescription({ type: 'answer', sdp: answer });
      if (channel.readyState !== 'open') {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Realtime connection timed out')), CONNECTION_TIMEOUT_MS);
          channel.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
          channel.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Realtime event channel failed')); }, { once: true });
          channel.addEventListener('close', () => { clearTimeout(timeout); reject(new Error('Realtime event channel closed')); }, { once: true });
        });
      }
      this.setState('ready');
      this.emit('connected');
    } catch (error) {
      this.disconnect(false);
      this.setState('failed', { reason: error.message });
      throw error;
    }
  }

  send(event) {
    if (this.channel?.readyState !== 'open') return false;
    this.channel.send(JSON.stringify({
      ...event,
      event_id: event.event_id || `mxg_edge_${Date.now()}_${++this.eventSequence}`,
    }));
    return true;
  }

  setMicrophone(enabled) {
    for (const track of this.media?.getAudioTracks?.() || []) track.enabled = enabled;
  }

  setOutputVolume(value) {
    this.outputVolume = Math.max(0, Math.min(1, Number(value) || 0));
    if (this.audio) this.audio.volume = this.outputVolume;
    this.emit('volume', { volume: this.outputVolume });
  }

  async waitForIceGathering(peer) {
    if (peer.iceGatheringState === 'complete') return;
    await new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', onStateChange);
        resolve();
      };
      const onStateChange = () => {
        if (peer.iceGatheringState === 'complete') finish();
      };
      timer = setTimeout(finish, ICE_GATHERING_TIMEOUT_MS);
      peer.addEventListener('icegatheringstatechange', onStateChange);
      onStateChange();
    });
  }

  interrupt() {
    if (!this.responseActive) return;
    this.send({ type: 'response.cancel', ...(this.responseId ? { response_id: this.responseId } : {}) });
    this.send({ type: 'output_audio_buffer.clear' });
    this.responseActive = false;
    this.responseId = null;
  }

  async startTalking() {
    this.talkRequested = true;
    if (this.talking) return;
    await this.connect();
    if (!this.talkRequested) return;
    this.interrupt();
    this.userTranscript = '';
    this.send({ type: 'input_audio_buffer.clear' });
    this.setMicrophone(true);
    this.talking = true;
    this.talkStartedAt = performance.now();
    this.setState('listening');
    this.emit('talk', { pressed: true });
  }

  stopTalking() {
    this.talkRequested = false;
    if (!this.talking) return;
    this.setMicrophone(false);
    this.talking = false;
    const durationMs = performance.now() - this.talkStartedAt;
    this.emit('talk', { pressed: false, durationMs });
    if (durationMs < MIN_TURN_MS) {
      this.send({ type: 'input_audio_buffer.clear' });
      this.setState('ready');
      return;
    }
    this.send({ type: 'input_audio_buffer.commit' });
    this.send({ type: 'response.create' });
    this.setState('thinking');
  }

  handleMessage(raw) {
    let event;
    try { event = JSON.parse(raw); } catch { return; }
    if (event.type === 'response.created') {
      this.assistantTranscript = '';
      this.responseActive = true;
      this.responseId = event.response?.id || null;
      this.setState('thinking');
    } else if (event.type === 'response.output_audio.delta') {
      this.setState('speaking');
    } else if (event.type === 'response.done') {
      this.responseActive = false;
      this.responseId = null;
      this.setState('ready');
    } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
      this.userTranscript = event.transcript || this.userTranscript;
      this.emit('transcript', { role: 'user', text: this.userTranscript, final: true });
    } else if (event.type === 'conversation.item.input_audio_transcription.delta') {
      this.userTranscript += event.delta || '';
      this.emit('transcript', { role: 'user', text: this.userTranscript, final: false });
    } else if (event.type === 'response.output_audio_transcript.delta') {
      this.assistantTranscript += event.delta || '';
      this.emit('transcript', { role: 'assistant', text: this.assistantTranscript, final: false });
    } else if (event.type === 'response.output_audio_transcript.done') {
      this.assistantTranscript = event.transcript || this.assistantTranscript;
      this.emit('transcript', { role: 'assistant', text: this.assistantTranscript, final: true });
    } else if (event.type === 'error') {
      this.setState('failed', { reason: event.error?.message || 'Realtime service error' });
    }
  }

  disconnect(announce = true) {
    this.talking = false;
    this.talkRequested = false;
    this.setMicrophone(false);
    this.state = 'disconnected';
    this.channel?.close();
    this.peer?.close();
    for (const track of this.media?.getTracks?.() || []) track.stop();
    if (this.audio) {
      this.audio.srcObject = null;
      this.audio.remove();
    }
    this.channel = null;
    this.peer = null;
    this.media = null;
    this.audio = null;
    this.responseActive = false;
    this.responseId = null;
    this.userTranscript = '';
    this.assistantTranscript = '';
    if (announce) this.emit('state', { state: 'disconnected' });
  }
}
