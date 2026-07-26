/**
 * Browser-only OpenAI Realtime media transport.
 * Domain reads and mutations remain behind MXApplicationClient/MCP.
 */
const MXRealtime = (() => {
  class RealtimeSession {
    constructor({ exchangeSdp, onEvent = () => {}, peerFactory, mediaDevices } = {}) {
      if (typeof exchangeSdp !== 'function') throw new TypeError('exchangeSdp is required');
      this.exchangeSdp = exchangeSdp;
      this.onEvent = onEvent;
      this.peerFactory = peerFactory || (() => new RTCPeerConnection());
      this.mediaDevices = mediaDevices || navigator.mediaDevices;
      this.peer = null;
      this.channel = null;
      this.media = null;
      this.audioElement = null;
      this.state = 'disconnected';
      this.connecting = null;
      this.userTranscript = '';
      this.assistantTranscript = '';
      this.toolSpecs = new Map();
      this.responseActive = false;
      this.responseId = null;
      this.lastConnectOptions = null;
      this.manualDisconnect = false;
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 3;
      this.reconnectTimer = null;
      this.createdAudioElement = false;
      this.eventSequence = 0;
      this.closingResources = false;
      this.microphoneEnabled = true;
    }

    emit(type, detail = {}) {
      this.onEvent({ type, state: this.state, ...detail });
    }

    setState(state, detail = {}) {
      this.state = state;
      this.emit('state', { state, ...detail });
    }

    async connect({ session, audioElement } = {}) {
      if (this.connecting) return this.connecting;
      if (this.peer && ['connecting', 'connected'].includes(this.peer.connectionState)) return;
      this.manualDisconnect = false;
      this.lastConnectOptions = { session, audioElement };
      this.connecting = this.open({ session, audioElement }).finally(() => { this.connecting = null; });
      return this.connecting;
    }

    async open({ session, audioElement }) {
      if (!this.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable');
      this.setState('connecting');
      try {
        if (audioElement) {
          this.audioElement = audioElement;
          this.createdAudioElement = false;
        } else if (typeof document !== 'undefined') {
          this.audioElement = document.createElement('audio');
          this.createdAudioElement = true;
          document.body?.appendChild(this.audioElement);
        } else {
          this.audioElement = {};
          this.createdAudioElement = false;
        }
        this.audioElement.autoplay = true;
        if (this.audioElement.style) this.audioElement.style.display = 'none';
        this.peer = this.peerFactory();
        this.peer.ontrack = (event) => {
          this.audioElement.srcObject = event.streams[0];
        };
        this.peer.onconnectionstatechange = () => {
          const state = this.peer?.connectionState;
          if (state === 'connected') {
            this.reconnectAttempts = 0;
            this.setState('listening');
          }
          if (state === 'failed' || state === 'disconnected') {
            this.scheduleReconnect(state === 'failed' ? 'WebRTC connection failed' : 'Realtime connection interrupted');
          }
        };
        this.media = await this.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        for (const track of this.media.getAudioTracks()) {
          track.enabled = this.microphoneEnabled;
          this.peer.addTrack(track, this.media);
        }
        this.emit('microphone', { enabled: this.microphoneEnabled });
        this.channel = this.peer.createDataChannel('oai-events');
        this.channel.addEventListener('open', () => this.emit('channel-open'));
        this.channel.addEventListener('close', () => {
          this.emit('channel-close');
          if (!this.manualDisconnect && !this.closingResources && this.peer?.connectionState !== 'connected') {
            this.scheduleReconnect('Realtime event channel closed');
          }
        });
        this.channel.addEventListener('message', (event) => this.handleMessage(event.data));
        const offer = await this.peer.createOffer();
        await this.peer.setLocalDescription(offer);
        const answer = await this.exchangeSdp({ sdp: offer.sdp, session });
        await this.peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
        this.emit('connected', { callId: answer.callId, correlationId: answer.correlationId });
      } catch (error) {
        this.closeResources();
        this.setState('failed', { reason: error.message, code: error.code || 'REALTIME_CONNECT_FAILED' });
        throw error;
      }
    }

    handleMessage(raw) {
      let event;
      try { event = JSON.parse(raw); } catch { return; }
      this.emit('server-event', { event });
      if (event.type === 'input_audio_buffer.speech_started') {
        this.userTranscript = '';
        this.setState('user-speaking');
      } else if (event.type === 'input_audio_buffer.speech_stopped') {
        this.setState('thinking');
      } else if (event.type === 'response.created') {
        this.assistantTranscript = '';
        this.responseActive = true;
        this.responseId = event.response?.id || null;
        this.setState('thinking');
      } else if (event.type === 'response.output_audio.delta') {
        this.setState('speaking');
      } else if (event.type === 'response.done') {
        this.responseActive = false;
        this.responseId = null;
        this.setState('listening');
        this.emit('usage', {
          usage: event.response?.usage || null,
          status: event.response?.status || null,
          statusDetails: event.response?.status_details || null
        });
      } else if (event.type === 'error') {
        this.setState('degraded', { reason: event.error?.message || 'Realtime service error', code: event.error?.code });
      } else if (event.type === 'conversation.item.input_audio_transcription.delta') {
        this.userTranscript += event.delta || '';
        this.emit('transcript', { role: 'user', text: this.userTranscript, final: false });
      } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
        this.userTranscript = event.transcript || this.userTranscript;
        this.emit('transcript', { role: 'user', text: this.userTranscript, final: true, itemId: event.item_id || null });
      } else if (event.type === 'response.output_audio_transcript.delta') {
        this.assistantTranscript += event.delta || '';
        this.emit('transcript', { role: 'assistant', text: this.assistantTranscript, final: false });
      } else if (event.type === 'response.output_audio_transcript.done') {
        this.assistantTranscript = event.transcript || this.assistantTranscript;
        this.emit('transcript', { role: 'assistant', text: this.assistantTranscript, final: true, itemId: event.item_id || null });
      } else if (event.type === 'response.function_call_arguments.done') {
        const spec = this.toolSpecs.get(event.name) || null;
        this.emit('tool-request', {
          callId: event.call_id,
          name: spec?.name || event.name,
          arguments: event.arguments,
          spec
        });
      }
    }

    configureTools(tools, { instructions } = {}) {
      this.toolSpecs.clear();
      const realtimeTools = (tools || [])
        .filter((tool) => tool.meta?.callable !== false && tool.meta?.availability !== 'not_configured')
        .map((tool) => {
        const transportName = tool.name.replaceAll('.', '__');
        this.toolSpecs.set(transportName, tool);
        return {
          type: 'function',
          name: transportName,
          description: `${tool.description} Canonical MXGenius capability: ${tool.name}`,
          parameters: tool.inputSchema
        };
        });
      return this.send({
        type: 'session.update',
        session: {
          type: 'realtime',
          tools: realtimeTools,
          tool_choice: 'auto',
          ...(instructions ? { instructions } : {})
        }
      });
    }

    sendToolOutput(callId, output) {
      const sent = this.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: typeof output === 'string' ? output : JSON.stringify(output)
        }
      });
      if (sent) this.send({ type: 'response.create' });
      return sent;
    }

    send(event) {
      if (!this.channel || this.channel.readyState !== 'open') return false;
      const payload = event.event_id
        ? event
        : { ...event, event_id: `mxg_${Date.now()}_${++this.eventSequence}` };
      this.channel.send(JSON.stringify(payload));
      return true;
    }

    setMicrophoneEnabled(enabled) {
      this.microphoneEnabled = Boolean(enabled);
      if (this.media) {
        for (const track of this.media.getAudioTracks()) {
          track.enabled = this.microphoneEnabled;
        }
      }
      this.emit('microphone', { enabled: this.microphoneEnabled });
      return this.microphoneEnabled;
    }

    isMicrophoneEnabled() {
      return this.microphoneEnabled;
    }

    interrupt() {
      if (!this.responseActive) return false;
      const sent = this.send({
        type: 'response.cancel',
        ...(this.responseId ? { response_id: this.responseId } : {})
      });
      if (sent) {
        this.send({ type: 'output_audio_buffer.clear' });
        this.responseActive = false;
        this.responseId = null;
        this.setState('interrupted');
        this.emit('interrupted');
      }
      return sent;
    }

    disconnect() {
      this.manualDisconnect = true;
      this.clearReconnectTimer();
      this.closeResources();
      this.setState('disconnected');
    }

    scheduleReconnect(reason) {
      if (this.manualDisconnect || !this.lastConnectOptions || this.reconnectTimer || this.connecting) return;
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.setState('failed', { reason, code: 'REALTIME_RECONNECT_EXHAUSTED' });
        return;
      }
      this.reconnectAttempts += 1;
      const delayMs = Math.min(
        4250,
        500 * (2 ** (this.reconnectAttempts - 1)) + Math.floor(Math.random() * 250)
      );
      this.setState('reconnecting', { reason, attempt: this.reconnectAttempts, delayMs });
      this.reconnectTimer = setTimeout(async () => {
        this.reconnectTimer = null;
        const options = { ...this.lastConnectOptions, audioElement: this.audioElement };
        this.closeResources({ preserveAudio: true });
        try {
          await this.connect(options);
        } catch (error) {
          this.scheduleReconnect(error.message || reason);
        }
      }, delayMs);
    }

    clearReconnectTimer() {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    closeResources({ preserveAudio = false } = {}) {
      this.closingResources = true;
      try {
        if (this.channel) this.channel.close();
        if (this.peer) this.peer.close();
        if (this.media) for (const track of this.media.getTracks()) track.stop();
        if (this.audioElement && !preserveAudio) {
          this.audioElement.srcObject = null;
          if (this.createdAudioElement && typeof document !== 'undefined' && this.audioElement.parentNode === document.body) {
            document.body.removeChild(this.audioElement);
          }
          this.audioElement = null;
          this.createdAudioElement = false;
        }
        this.channel = null;
        this.peer = null;
        this.media = null;
        this.responseActive = false;
        this.responseId = null;
      } finally {
        this.closingResources = false;
      }
    }
  }

  return Object.freeze({ RealtimeSession });
})();

window.MXRealtime = MXRealtime;
