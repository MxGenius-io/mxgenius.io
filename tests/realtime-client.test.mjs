import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../realtime-client.js', import.meta.url), 'utf8');

function loadClient() {
  const context = { console, JSON, Map, Object, TypeError, Error };
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
});

test('barge-in cancels current output and service errors become an honest degraded state', () => {
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
  assert.equal(sent[0].type, 'response.cancel');
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
