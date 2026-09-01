/**
 * Browser-only OpenAI Realtime media transport.
 * Domain reads and mutations remain behind MXApplicationClient/MCP.
 */
const MXRealtime = (() => {
  class RealtimeSession {
    constructor({ exchangeSdp, onEvent = () => {}, peerFactory, mediaDevices, connectionTimeoutMs = 30_000, iceGatheringTimeoutMs = 5_000 } = {}) {
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
      this.connectionEpoch = 0;
      this.connectionTimer = null;
      this.connectionTimeoutMs = Math.max(1_000, Number(connectionTimeoutMs) || 30_000);
      this.iceGatheringTimeoutMs = Math.max(500, Number(iceGatheringTimeoutMs) || 5_000);
      this.localCandidateCount = 0;
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
      const epoch = ++this.connectionEpoch;
      this.connecting = this.open({ session, audioElement }, epoch).finally(() => { this.connecting = null; });
      return this.connecting;
    }

    async open({ session, audioElement }, epoch) {
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
        const peer = this.peerFactory();
        this.peer = peer;
        this.localCandidateCount = 0;
        peer.onicecandidate = (event) => {
          if (epoch !== this.connectionEpoch || this.peer !== peer || !event?.candidate) return;
          this.localCandidateCount += 1;
        };
        peer.ontrack = (event) => {
          this.audioElement.srcObject = event.streams[0];
        };
        peer.onconnectionstatechange = () => {
          if (epoch !== this.connectionEpoch || this.peer !== peer) return;
          const state = peer.connectionState;
          if (state === 'connected') {
            this.reconnectAttempts = 0;
            this.emit('handshake', { phase: 'peer-connected', peerState: state });
          }
          if (state === 'failed' || state === 'disconnected') {
            this.scheduleReconnect(state === 'failed' ? 'WebRTC connection failed' : 'Realtime connection interrupted');
          }
        };
        peer.oniceconnectionstatechange = () => {
          if (epoch !== this.connectionEpoch || this.peer !== peer) return;
          const state = peer.iceConnectionState;
          this.emit('handshake', { phase: `ice-${state}`, iceState: state });
          if (state === 'connected' || state === 'completed') {
            this.reconnectAttempts = 0;
          }
          if (state === 'failed' || state === 'disconnected') {
            this.scheduleReconnect(state === 'failed' ? 'Realtime ICE negotiation failed' : 'Realtime ICE connection interrupted');
          }
        };
        peer.onicecandidateerror = (event) => {
          if (epoch !== this.connectionEpoch || this.peer !== peer) return;
          this.emit('transport-error', {
            code: 'REALTIME_ICE_CANDIDATE_ERROR',
            reason: event?.errorText || 'Realtime network candidate failed',
            transport: this.transportSnapshot(peer, this.channel)
          });
        };
        const media = await this.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        if (this.manualDisconnect || epoch !== this.connectionEpoch || this.peer !== peer) {
          for (const track of media.getTracks()) track.stop();
          return;
        }
        this.media = media;
        this.emit('handshake', { phase: 'microphone-ready' });
        for (const track of media.getAudioTracks()) {
          track.enabled = this.microphoneEnabled;
          peer.addTrack(track, media);
        }
        this.emit('microphone', { enabled: this.microphoneEnabled });
        const channel = peer.createDataChannel('oai-events');
        this.channel = channel;
        channel.addEventListener('open', () => {
          if (epoch !== this.connectionEpoch || this.channel !== channel) return;
          this.clearConnectionTimer();
          this.reconnectAttempts = 0;
          // Safari can open the SCTP data channel before it updates the peer's
          // connectionState. The open channel is the definitive socket signal.
          this.setState('listening', { transport: 'data-channel' });
          this.emit('channel-open');
        });
        channel.addEventListener('close', () => {
          this.emit('channel-close');
          if (!this.manualDisconnect && !this.closingResources) {
            this.scheduleReconnect('Realtime event channel closed');
          }
        });
        channel.addEventListener('error', (event) => {
          if (epoch !== this.connectionEpoch || this.channel !== channel) return;
          const reason = event?.error?.message || 'Realtime event channel failed';
          this.emit('transport-error', {
            code: 'REALTIME_DATA_CHANNEL_ERROR',
            reason,
            transport: this.transportSnapshot(peer, channel)
          });
          this.scheduleReconnect(reason);
        });
        channel.addEventListener('message', (event) => this.handleMessage(event.data));
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await this.waitForIceGathering(peer, epoch);
        this.emit('handshake', { phase: 'local-offer-ready' });
        if (this.manualDisconnect || epoch !== this.connectionEpoch || this.peer !== peer) return;
        const localSdp = peer.localDescription?.sdp || offer.sdp;
        const answer = await this.exchangeSdp({ sdp: localSdp, session });
        this.emit('handshake', { phase: 'server-answer-received' });
        if (this.manualDisconnect || epoch !== this.connectionEpoch || this.peer !== peer) return;
        await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
        this.emit('handshake', { phase: 'peer-connecting' });
        if (this.manualDisconnect || epoch !== this.connectionEpoch || this.peer !== peer) return;
        this.armConnectionTimer(epoch, peer, channel);
        this.emit('connected', { callId: answer.callId, correlationId: answer.correlationId });
      } catch (error) {
        this.closeResources();
        if (this.manualDisconnect || epoch !== this.connectionEpoch) return;
        this.setState('failed', { reason: error.message, code: error.code || 'REALTIME_CONNECT_FAILED' });
        throw error;
      }
    }

    transportSnapshot(peer = this.peer, channel = this.channel) {
      return {
        peer: peer?.connectionState || 'unavailable',
        ice: peer?.iceConnectionState || 'unavailable',
        iceGathering: peer?.iceGatheringState || 'unavailable',
        localCandidates: this.localCandidateCount,
        signaling: peer?.signalingState || 'unavailable',
        channel: channel?.readyState || 'unavailable'
      };
    }

    transportLabel(snapshot = this.transportSnapshot()) {
      return `peer ${snapshot.peer} · ICE ${snapshot.ice} · gathering ${snapshot.iceGathering} · candidates ${snapshot.localCandidates} · signaling ${snapshot.signaling} · channel ${snapshot.channel}`;
    }

    async waitForIceGathering(peer, epoch) {
      if (!peer?.localDescription || peer.iceGatheringState === 'complete' || typeof peer.addEventListener !== 'function') {
        this.emit('handshake', {
          phase: 'ice-gathering-complete',
          iceGatheringState: peer?.iceGatheringState || 'unavailable',
          localCandidates: this.localCandidateCount
        });
        return;
      }
      this.emit('handshake', { phase: 'ice-gathering', iceGatheringState: peer.iceGatheringState });
      const timedOut = await new Promise((resolve) => {
        let settled = false;
        let timer;
        const finish = (didTimeOut) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          peer.removeEventListener?.('icegatheringstatechange', onStateChange);
          resolve(didTimeOut);
        };
        const onStateChange = () => {
          if (peer.iceGatheringState === 'complete' || this.manualDisconnect || epoch !== this.connectionEpoch || this.peer !== peer) {
            finish(false);
          }
        };
        timer = setTimeout(() => finish(true), this.iceGatheringTimeoutMs);
        peer.addEventListener('icegatheringstatechange', onStateChange);
        onStateChange();
      });
      this.emit('handshake', {
        phase: timedOut ? 'ice-gathering-timeout' : 'ice-gathering-complete',
        iceGatheringState: peer.iceGatheringState,
        localCandidates: this.localCandidateCount
      });
    }

    armConnectionTimer(epoch, peer, channel) {
      this.clearConnectionTimer();
      this.connectionTimer = setTimeout(() => {
        this.connectionTimer = null;
        if (this.manualDisconnect || epoch !== this.connectionEpoch || this.peer !== peer || channel.readyState === 'open') return;
        const transport = this.transportSnapshot(peer, channel);
        this.closeResources();
        this.setState('failed', {
          code: 'REALTIME_CHANNEL_TIMEOUT',
          reason: `Realtime socket timed out · ${this.transportLabel(transport)}`,
          transport
        });
      }, this.connectionTimeoutMs);
    }

    clearConnectionTimer() {
      if (this.connectionTimer) clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
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

    configureTools(tools, { instructions, clientTools = [], toolChoice = 'auto' } = {}) {
      this.toolSpecs.clear();
      const realtimeTools = [...(tools || []), ...(clientTools || [])]
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
          tool_choice: toolChoice,
          ...(instructions ? { instructions } : {})
        }
      });
    }

    sendToolOutput(callId, output, { toolChoice = 'none', createResponse = true } = {}) {
      const sent = this.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: typeof output === 'string' ? output : JSON.stringify(output)
        }
      });
      if (sent && createResponse) {
        this.send({
          type: 'response.create',
          response: { tool_choice: toolChoice }
        });
      }
      return sent;
    }

    sendUserMessage({ text = '', images = [] } = {}) {
      const content = [];
      const normalizedText = String(text || '').trim();
      if (normalizedText) content.push({ type: 'input_text', text: normalizedText });
      for (const image of images.slice(0, 4)) {
        const imageUrl = image?.dataUrl || image?.data_url;
        if (typeof imageUrl === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/i.test(imageUrl)) {
          content.push({ type: 'input_image', image_url: imageUrl });
        }
      }
      if (!content.length) return false;
      const sent = this.send({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content
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
      this.connectionEpoch += 1;
      this.clearReconnectTimer();
      this.closeResources();
      this.setState('disconnected');
    }

    scheduleReconnect(reason) {
      if (this.manualDisconnect || !this.lastConnectOptions || this.reconnectTimer || this.connecting) return;
      this.clearConnectionTimer();
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
      this.clearConnectionTimer();
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
        this.localCandidateCount = 0;
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
