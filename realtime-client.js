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
      this.connecting = this.open({ session, audioElement }).finally(() => { this.connecting = null; });
      return this.connecting;
    }

    async open({ session, audioElement }) {
      if (!this.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable');
      this.setState('connecting');
      try {
        this.audioElement = audioElement || document.createElement('audio');
        this.audioElement.autoplay = true;
        this.peer = this.peerFactory();
        this.peer.ontrack = (event) => {
          this.audioElement.srcObject = event.streams[0];
        };
        this.peer.onconnectionstatechange = () => {
          const state = this.peer?.connectionState;
          if (state === 'connected') this.setState('listening');
          if (state === 'failed') this.setState('failed', { reason: 'WebRTC connection failed' });
          if (state === 'disconnected') this.setState('degraded', { reason: 'Realtime connection interrupted' });
          if (state === 'closed') this.setState('disconnected');
        };
        this.media = await this.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        for (const track of this.media.getAudioTracks()) this.peer.addTrack(track, this.media);
        this.channel = this.peer.createDataChannel('oai-events');
        this.channel.addEventListener('open', () => this.emit('channel-open'));
        this.channel.addEventListener('close', () => this.emit('channel-close'));
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
        this.interrupt();
        this.setState('listening');
      } else if (event.type === 'input_audio_buffer.speech_stopped') {
        this.setState('thinking');
      } else if (event.type === 'response.created') {
        this.setState('thinking');
      } else if (event.type === 'response.output_audio.delta') {
        this.setState('speaking');
      } else if (event.type === 'response.done') {
        this.setState('listening');
        this.emit('usage', { usage: event.response?.usage || null });
      } else if (event.type === 'error') {
        this.setState('degraded', { reason: event.error?.message || 'Realtime service error', code: event.error?.code });
      } else if (event.type === 'conversation.item.input_audio_transcription.delta') {
        this.userTranscript += event.delta || '';
        this.emit('transcript', { role: 'user', text: this.userTranscript, final: false });
      } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
        this.userTranscript = event.transcript || this.userTranscript;
        this.emit('transcript', { role: 'user', text: this.userTranscript, final: true });
      } else if (event.type === 'response.output_audio_transcript.delta') {
        this.assistantTranscript += event.delta || '';
        this.emit('transcript', { role: 'assistant', text: this.assistantTranscript, final: false });
      } else if (event.type === 'response.output_audio_transcript.done') {
        this.assistantTranscript = event.transcript || this.assistantTranscript;
        this.emit('transcript', { role: 'assistant', text: this.assistantTranscript, final: true });
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
      const realtimeTools = (tools || []).map((tool) => {
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
      this.channel.send(JSON.stringify(event));
      return true;
    }

    interrupt() {
      const sent = this.send({ type: 'response.cancel' });
      if (sent) this.emit('interrupted');
      return sent;
    }

    disconnect() {
      this.closeResources();
      this.setState('disconnected');
    }

    closeResources() {
      if (this.channel) this.channel.close();
      if (this.peer) this.peer.close();
      if (this.media) for (const track of this.media.getTracks()) track.stop();
      if (this.audioElement) this.audioElement.srcObject = null;
      this.channel = null;
      this.peer = null;
      this.media = null;
    }
  }

  return Object.freeze({ RealtimeSession });
})();

window.MXRealtime = MXRealtime;
