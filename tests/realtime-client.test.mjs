import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../realtime-client.js', import.meta.url), 'utf8');

function loadClient() {
  const context = { console, JSON, Map, Object, TypeError, Error, Number, setTimeout, clearTimeout };
  context.window = context;
  vm.runInNewContext(`${source}\n;globalThis.exported = MXRealtime;`, context);
  return context.exported;
}

test('Realtime tools are generated from canonical MCP schemas and decoded back to canonical names', () => {
  const MXRealtime = loadClient();
  const events = [];
  const sent = [];
  const session = new MXRealtime.RealtimeSession({
    exchangeSdp: async () => ({ sdp: 'v=0' }),
    mediaDevices: {},
    onEvent: (event) => events.push(event)
  });
  session.channel = { readyState: 'open', send: (value) => sent.push(JSON.parse(value)) };
  const spec = {
    name: 'mxg.maintenance_case.update_status',
    description: 'Update case status',
    inputSchema: { type: 'object', required: ['case_id'] },
    meta: { requires_human_approval: true }
  };
  assert.equal(session.configureTools([spec]), true);
  assert.equal(sent[0].type, 'session.update');
  assert.equal(sent[0].session.tools[0].name, 'mxg__maintenance_case__update_status');
  assert.deepEqual(sent[0].session.tools[0].parameters, spec.inputSchema);

  session.handleMessage(JSON.stringify({
    type: 'response.function_call_arguments.done',
    call_id: 'call-1',
    name: 'mxg__maintenance_case__update_status',
    arguments: '{"case_id":"case-1"}'
  }));
  const request = events.find((event) => event.type === 'tool-request');
  assert.equal(request.name, spec.name);
  assert.equal(request.spec.meta.requires_human_approval, true);
});

test('Realtime omits capabilities declared not configured by the MCP registry', () => {
  const MXRealtime = loadClient();
  const sent = [];
  const session = new MXRealtime.RealtimeSession({ exchangeSdp: async () => ({ sdp: 'v=0' }), mediaDevices: {} });
  session.channel = { readyState: 'open', send: (value) => sent.push(JSON.parse(value)) };
  session.configureTools([
    { name: 'mxg.aircraft.lookup', description: 'Lookup', inputSchema: {}, meta: { availability: 'available', callable: true } },
    { name: 'mxg.weather.airport_now', description: 'Weather', inputSchema: {}, meta: { availability: 'not_configured', callable: false } }
  ]);
  assert.deepEqual(sent[0].session.tools.map((tool) => tool.name), ['mxg__aircraft__lookup']);
  assert.equal(session.toolSpecs.has('mxg__weather__airport_now'), false);
});

test('Realtime mounts a client companion tool beside canonical MCP capabilities', () => {
  const MXRealtime = loadClient();
  const events = [];
  const sent = [];
  const session = new MXRealtime.RealtimeSession({
    exchangeSdp: async () => ({ sdp: 'v=0' }),
    mediaDevices: {},
    onEvent: (event) => events.push(event)
  });
  session.channel = { readyState: 'open', send: (value) => sent.push(JSON.parse(value)) };
  const companion = {
    name: 'mxg.chat.structured_response',
    description: 'Render one authoritative structured response',
    inputSchema: { type: 'object', required: ['message'] },
    meta: { availability: 'available', callable: true, client_handler: 'structured_chat' }
  };
  session.configureTools([], { clientTools: [companion] });
  assert.deepEqual(sent[0].session.tools.map((tool) => tool.name), ['mxg__chat__structured_response']);
  session.handleMessage(JSON.stringify({
    type: 'response.function_call_arguments.done',
    call_id: 'call-structured',
    name: 'mxg__chat__structured_response',
    arguments: '{"message":"Show the applicable manual evidence"}'
  }));
  const request = events.find((event) => event.type === 'tool-request');
  assert.equal(request.name, companion.name);
  assert.equal(request.spec.meta.client_handler, 'structured_chat');
});

test('Realtime tool output is correlated and followed by one response request', () => {
  const MXRealtime = loadClient();
  const sent = [];
  const session = new MXRealtime.RealtimeSession({ exchangeSdp: async () => ({ sdp: 'v=0' }), mediaDevices: {} });
  session.channel = { readyState: 'open', send: (value) => sent.push(JSON.parse(value)) };
  assert.equal(session.sendToolOutput('call-1', { status: 'ok', trace_id: 'trace-1' }), true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].item.type, 'function_call_output');
  assert.equal(sent[0].item.call_id, 'call-1');
  assert.equal(JSON.parse(sent[0].item.output).trace_id, 'trace-1');
  assert.equal(sent[1].type, 'response.create');
  assert.equal(sent[1].response.tool_choice, 'none');
});

test('cancelled companion tools close their call without creating stale speech', () => {
  const MXRealtime = loadClient();
  const sent = [];
  const session = new MXRealtime.RealtimeSession({ exchangeSdp: async () => ({ sdp: 'v=0' }), mediaDevices: {} });
  session.channel = { readyState: 'open', send: (value) => sent.push(JSON.parse(value)) };
  assert.equal(session.sendToolOutput('call-cancelled', { status: 'cancelled' }, { createResponse: false }), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].item.type, 'function_call_output');
  assert.equal(JSON.parse(sent[0].item.output).status, 'cancelled');
});

test('server VAD owns barge-in while explicit interruption cancels only active output', () => {
  const MXRealtime = loadClient();
  const events = [];
  const sent = [];
  const session = new MXRealtime.RealtimeSession({
    exchangeSdp: async () => ({ sdp: 'v=0' }),
    mediaDevices: {},
    onEvent: (event) => events.push(event)
  });
  session.channel = { readyState: 'open', send: (value) => sent.push(JSON.parse(value)) };
  session.handleMessage(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
  assert.equal(sent.length, 0);
  assert.equal(session.state, 'user-speaking');
  session.handleMessage(JSON.stringify({ type: 'response.created', response: { id: 'response-1' } }));
  assert.equal(session.interrupt(), true);
  assert.equal(sent[0].type, 'response.cancel');
  assert.equal(sent[0].response_id, 'response-1');
  assert.equal(sent[1].type, 'output_audio_buffer.clear');
  assert.ok(events.some((event) => event.type === 'interrupted'));
  session.handleMessage(JSON.stringify({ type: 'error', error: { code: 'rate_limit', message: 'Quota reached' } }));
  assert.equal(session.state, 'degraded');
  assert.ok(events.some((event) => event.type === 'state' && event.code === 'rate_limit'));
});

test('spatial transcript buffers reset at each new utterance', () => {
  const MXRealtime = loadClient();
  const events = [];
  const session = new MXRealtime.RealtimeSession({
    exchangeSdp: async () => ({ sdp: 'v=0' }),
    mediaDevices: {},
    onEvent: (event) => events.push(event)
  });
  session.channel = { readyState: 'open', send() {} };
  session.userTranscript = 'previous user utterance';
  session.assistantTranscript = 'previous assistant utterance';
  session.handleMessage(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
  session.handleMessage(JSON.stringify({ type: 'response.created' }));
  assert.equal(session.userTranscript, '');
  assert.equal(session.assistantTranscript, '');
});

test('microphone denial fails closed and releases partially-created peer resources', async () => {
  const MXRealtime = loadClient();
  const events = [];
  let peerClosed = false;
  const peer = {
    connectionState: 'new',
    close: () => { peerClosed = true; },
    createDataChannel: () => ({ addEventListener() {}, close() {} })
  };
  const session = new MXRealtime.RealtimeSession({
    exchangeSdp: async () => ({ sdp: 'v=0' }),
    peerFactory: () => peer,
    mediaDevices: { getUserMedia: async () => { throw new Error('Permission denied'); } },
    onEvent: (event) => events.push(event)
  });
  await assert.rejects(
    session.connect({ session: { accessToken: 'token' }, audioElement: {} }),
    /Permission denied/
  );
  assert.equal(session.state, 'failed');
  assert.equal(peerClosed, true);
  assert.ok(events.some((event) => event.type === 'state' && event.state === 'failed'));
});

test('concurrent connect requests share one in-flight operation', async () => {
  const MXRealtime = loadClient();
  let captureCount = 0;
  let releaseCapture;
  const capture = new Promise((resolve) => { releaseCapture = resolve; });
  const peer = {
    connectionState: 'new',
    close() {},
    createDataChannel: () => ({ addEventListener() {}, close() {} }),
    addTrack() {},
    createOffer: async () => ({ type: 'offer', sdp: 'v=0\r\no=offer' }),
    setLocalDescription: async () => {},
    setRemoteDescription: async () => {}
  };
  const media = { getAudioTracks: () => [], getTracks: () => [] };
  const session = new MXRealtime.RealtimeSession({
    exchangeSdp: async () => ({ sdp: 'v=0\r\no=answer' }),
    peerFactory: () => peer,
    mediaDevices: { getUserMedia: async () => { captureCount += 1; await capture; return media; } }
  });
  const first = session.connect({ session: { accessToken: 'token' }, audioElement: {} });
  const second = session.connect({ session: { accessToken: 'token' }, audioElement: {} });
  releaseCapture();
  await Promise.all([first, second]);
  assert.equal(captureCount, 1);
});

test('an open Realtime data channel is authoritative when Safari peer state lags', async () => {
  const MXRealtime = loadClient();
  const listeners = {};
  const channel = {
    readyState: 'connecting',
    addEventListener(type, handler) { listeners[type] = handler; },
    close() {},
    send() {}
  };
  const peer = {
    connectionState: 'new',
    iceConnectionState: 'checking',
    close() {},
    createDataChannel: () => channel,
    addTrack() {},
    createOffer: async () => ({ type: 'offer', sdp: 'v=0\r\no=offer' }),
    setLocalDescription: async () => {},
    setRemoteDescription: async () => {}
  };
  const media = { getAudioTracks: () => [], getTracks: () => [] };
  const events = [];
  const session = new MXRealtime.RealtimeSession({
    exchangeSdp: async () => ({ sdp: 'v=0\r\no=answer' }),
    peerFactory: () => peer,
    mediaDevices: { getUserMedia: async () => media },
    onEvent: (event) => events.push(event)
  });

  await session.connect({ session: { accessToken: 'token' }, audioElement: {} });
  assert.equal(session.state, 'connecting');
  channel.readyState = 'open';
  listeners.open();

  assert.equal(session.state, 'listening');
  assert.ok(events.some((event) => event.type === 'state' && event.transport === 'data-channel'));
  assert.ok(events.some((event) => event.type === 'channel-open'));
});

test('Realtime channel timeout reports the final peer and ICE state', async () => {
  const MXRealtime = loadClient();
  const channel = {
    readyState: 'connecting',
    addEventListener() {},
    close() {},
    send() {}
  };
  const peer = {
    connectionState: 'connecting',
    iceConnectionState: 'checking',
    signalingState: 'stable',
    close() {},
    createDataChannel: () => channel,
    addTrack() {},
    createOffer: async () => ({ type: 'offer', sdp: 'v=0\r\no=offer' }),
    setLocalDescription: async () => {},
    setRemoteDescription: async () => {}
  };
  const media = { getAudioTracks: () => [], getTracks: () => [] };
  const events = [];
  const session = new MXRealtime.RealtimeSession({
    exchangeSdp: async () => ({ sdp: 'v=0\r\no=answer' }),
    peerFactory: () => peer,
    mediaDevices: { getUserMedia: async () => media },
    connectionTimeoutMs: 1,
    onEvent: (event) => events.push(event)
  });

  await session.connect({ session: { accessToken: 'token' }, audioElement: {} });
  await new Promise((resolve) => setTimeout(resolve, 1_050));

  assert.equal(session.state, 'failed');
  const failure = events.find((event) => event.type === 'state' && event.code === 'REALTIME_CHANNEL_TIMEOUT');
  assert.match(failure.reason, /peer connecting · ICE checking · signaling stable · channel connecting/);
});

test('disconnect during microphone permission closes the pending connection without a failed or hanging session', async () => {
  const MXRealtime = loadClient();
  const events = [];
  let releaseCapture;
  let peerClosed = false;
  let trackStopped = false;
  const capture = new Promise((resolve) => { releaseCapture = resolve; });
  const track = { enabled: true, stop: () => { trackStopped = true; } };
  const media = { getAudioTracks: () => [track], getTracks: () => [track] };
  const peer = {
    connectionState: 'new',
    close: () => { peerClosed = true; },
    createDataChannel: () => ({ addEventListener() {}, close() {} }),
    addTrack() {},
    createOffer: async () => ({ type: 'offer', sdp: 'v=0\r\no=offer' }),
    setLocalDescription: async () => {},
    setRemoteDescription: async () => {}
  };
  const session = new MXRealtime.RealtimeSession({
    exchangeSdp: async () => ({ sdp: 'v=0\r\no=answer' }),
    peerFactory: () => peer,
    mediaDevices: { getUserMedia: async () => { await capture; return media; } },
    onEvent: (event) => events.push(event)
  });

  const pending = session.connect({ session: { accessToken: 'token' }, audioElement: {} });
  session.disconnect();
  releaseCapture();
  await pending;

  assert.equal(peerClosed, true);
  assert.equal(trackStopped, true);
  assert.equal(session.peer, null);
  assert.equal(session.media, null);
  assert.equal(session.state, 'disconnected');
  assert.equal(events.some((event) => event.type === 'state' && event.state === 'failed'), false);
});

test('Realtime capture starts live and mute state is controlled without closing WebRTC', async () => {
  const MXRealtime = loadClient();
  const events = [];
  const track = { enabled: false, stop() {} };
  const media = {
    getAudioTracks: () => [track],
    getTracks: () => [track]
  };
  const peer = {
    connectionState: 'new',
    close() {},
    createDataChannel: () => ({ addEventListener() {}, close() {} }),
    addTrack() {},
    createOffer: async () => ({ type: 'offer', sdp: 'v=0\r\no=offer' }),
    setLocalDescription: async () => {},
    setRemoteDescription: async () => {}
  };
  const session = new MXRealtime.RealtimeSession({
    exchangeSdp: async () => ({ sdp: 'v=0\r\no=answer' }),
    peerFactory: () => peer,
    mediaDevices: { getUserMedia: async () => media },
    onEvent: (event) => events.push(event)
  });

  await session.connect({ session: { accessToken: 'token' }, audioElement: {} });
  assert.equal(track.enabled, true);
  assert.equal(session.isMicrophoneEnabled(), true);

  assert.equal(session.setMicrophoneEnabled(false), false);
  assert.equal(track.enabled, false);
  assert.equal(session.peer, peer);

  assert.equal(session.setMicrophoneEnabled(true), true);
  assert.equal(track.enabled, true);
  assert.ok(events.some((event) => event.type === 'microphone' && event.enabled === true));
  assert.ok(events.some((event) => event.type === 'microphone' && event.enabled === false));
  assert.deepEqual(
    events.filter((event) => event.type === 'handshake').map((event) => event.phase),
    ['microphone-ready', 'local-offer-ready', 'server-answer-received', 'peer-connecting']
  );
});
