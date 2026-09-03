import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FRAME_TIMEOUT_POLICY,
  HeadsetFrameAcquirer
} from '../xr-headset-frame.js';

const root = new URL('../', import.meta.url);
const JPEG = 'data:image/jpeg;base64,/9j/2Q==';

function harness(overrides = {}) {
  const sent = [];
  const statuses = [];
  const timers = [];
  let counter = 0;
  const acquirer = new HeadsetFrameAcquirer({
    send: (message) => sent.push(message),
    isConnected: () => true,
    idFactory: (prefix) => `${prefix}-contract-${String(++counter).padStart(2, '0')}`,
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { timer.cleared = true; },
    onStatus: (status) => statuses.push(status),
    ...overrides
  });
  return { acquirer, sent, statuses, timers };
}

test('evidence acquisition preserves old responses while returning typed frame metadata', async () => {
  const { acquirer, sent } = harness();
  const pending = acquirer.acquireHeadsetFrame({ purpose: 'evidence' });
  assert.deepEqual(sent[0], {
    type: 'headset.snapshot.request',
    requestId: 'frame-contract-01',
    purpose: 'evidence'
  });
  assert.equal(acquirer.handleMessage({
    type: 'headset.snapshot.result',
    requestId: sent[0].requestId,
    status: 'ok',
    mimeType: 'image/jpeg',
    width: 800,
    height: 600,
    eye: 'right',
    capturedAtMs: 1_780_000_000_000,
    dataUrl: JPEG
  }), true);
  const frame = await pending;
  assert.equal(frame.purpose, 'evidence');
  assert.equal(frame.scanId, undefined);
  assert.deepEqual(frame.camera, {
    source: 'quest-passthrough', eye: 'right', poseAvailable: false, intrinsicsAvailable: false
  });
});

test('scan acquisition is correlated and rejects repeated input while one frame is pending', async () => {
  const { acquirer, sent } = harness();
  const pending = acquirer.acquireHeadsetFrame({ purpose: 'scan' });
  assert.equal(sent[0].purpose, 'scan');
  assert.equal(sent[0].scanId, 'scan-contract-02');
  await assert.rejects(acquirer.acquireHeadsetFrame({ purpose: 'scan' }), (error) => error.code === 'frame-busy');

  acquirer.handleMessage({
    type: 'headset.snapshot.result', requestId: sent[0].requestId, purpose: 'scan', scanId: sent[0].scanId,
    status: 'ok', mimeType: 'image/jpeg', width: 640, height: 480, eye: 'left',
    capturedAtMs: 1_780_000_000_100, dataUrl: JPEG,
    camera: { source: 'quest-passthrough', eye: 'left', poseAvailable: false, intrinsicsAvailable: false }
  });
  const frame = await pending;
  assert.equal(frame.scanId, sent[0].scanId);
  assert.equal(frame.purpose, 'scan');
});

test('timeout policy is isolated, bounded, and returns a typed failure', async () => {
  const { acquirer, timers } = harness();
  const pending = acquirer.acquireHeadsetFrame({ purpose: 'scan', timeoutMs: 250 });
  assert.equal(timers[0].delay, FRAME_TIMEOUT_POLICY.minimumMs);
  timers[0].callback();
  await assert.rejects(pending, (error) => error.code === 'frame-timeout' && /2000 ms/.test(error.message));

  const second = acquirer.acquireHeadsetFrame({ purpose: 'evidence', timeoutMs: 99_000 });
  assert.equal(timers[1].delay, FRAME_TIMEOUT_POLICY.maximumMs);
  acquirer.failPending('test complete');
  await assert.rejects(second, (error) => error.code === 'frame-disconnected');
});

test('malformed JPEG and mismatched scan correlation fail closed and release single-flight state', async () => {
  const { acquirer, sent } = harness();
  const malformed = acquirer.acquireHeadsetFrame({ purpose: 'scan' });
  acquirer.handleMessage({
    type: 'headset.snapshot.result', requestId: sent[0].requestId, status: 'ok', width: 640, height: 480,
    eye: 'right', capturedAtMs: 10, dataUrl: 'data:image/jpeg;base64,bm90LWEtanBlZw=='
  });
  await assert.rejects(malformed, (error) => error.code === 'frame-invalid');

  const mismatch = acquirer.acquireHeadsetFrame({ purpose: 'scan' });
  acquirer.handleMessage({
    type: 'headset.snapshot.result', requestId: sent[1].requestId, purpose: 'evidence', status: 'ok',
    width: 640, height: 480, eye: 'right', capturedAtMs: 11, dataUrl: JPEG
  });
  await assert.rejects(mismatch, (error) => error.code === 'frame-correlation');
});

test('socket loss releases scan state and a delayed frame cannot contaminate evidence', async () => {
  let connected = true;
  const { acquirer, sent } = harness({ isConnected: () => connected });
  const scan = acquirer.acquireHeadsetFrame({ purpose: 'scan' });
  const staleScanRequest = sent[0];

  connected = false;
  assert.equal(acquirer.failPending('socket lost'), true);
  await assert.rejects(scan, (error) => error.code === 'frame-disconnected');
  assert.equal(acquirer.handleMessage({
    type: 'headset.snapshot.result', requestId: staleScanRequest.requestId,
    purpose: 'scan', scanId: staleScanRequest.scanId, status: 'ok',
    mimeType: 'image/jpeg', width: 640, height: 480, eye: 'left',
    capturedAtMs: 12, dataUrl: JPEG
  }), false);

  connected = true;
  const evidence = acquirer.acquireHeadsetFrame({ purpose: 'evidence' });
  assert.notEqual(sent[1].requestId, staleScanRequest.requestId);
  assert.equal(sent[1].scanId, undefined);
  assert.equal(acquirer.handleMessage({
    type: 'headset.snapshot.result', requestId: sent[1].requestId,
    purpose: 'evidence', status: 'ok', mimeType: 'image/jpeg',
    width: 640, height: 480, eye: 'right', capturedAtMs: 13, dataUrl: JPEG
  }), true);
  const frame = await evidence;
  assert.equal(frame.purpose, 'evidence');
  assert.equal(frame.scanId, undefined);
});

test('scan HUD path is ephemeral while evidence retains the existing explicit attachment path', async () => {
  const presence = await readFile(new URL('xr-realtime-presence.js', root), 'utf8');
  const sensor = await readFile(new URL('xr-sensor-orb.js', root), 'utf8');
  const globe = await readFile(new URL('globe-vr.html', root), 'utf8');
  const scanStart = presence.indexOf('async scanScene(');
  const scanEnd = presence.indexOf('animateSnapshotToEvidence(', scanStart);
  const scanPath = presence.slice(scanStart, scanEnd);
  const evidenceStart = presence.indexOf('async captureSnapshot(');
  const evidencePath = presence.slice(evidenceStart, scanStart);

  assert.match(sensor, /acquireHeadsetFrame\(\{ purpose = 'evidence', timeoutMs \} = \{\}\)/);
  assert.match(globe, /xrSensors\.acquireHeadsetFrame\(options\)/);
  assert.match(scanPath, /onSnapshotRequest\(\{ purpose: 'scan' \}\)/);
  assert.match(scanPath, /onScanFrame/);
  assert.match(scanPath, /no high-confidence targets/);
  assert.doesNotMatch(scanPath, /onSnapshotCaptured|attachMedia|sendUserMessage|animateSnapshotToEvidence/);
  assert.match(evidencePath, /onSnapshotRequest\(\{ purpose: 'evidence' \}\)/);
  assert.match(evidencePath, /onSnapshotCaptured/);
  assert.match(evidencePath, /sendUserMessage/);
});

test('socket and realtime reconnect hooks fail pending capture and publish fresh context', async () => {
  const presence = await readFile(new URL('xr-realtime-presence.js', root), 'utf8');
  const sensor = await readFile(new URL('xr-sensor-orb.js', root), 'utf8');
  const channelOpen = presence.slice(
    presence.indexOf("if (event.type === 'channel-open')"),
    presence.indexOf("if (event.type === 'tool-request')")
  );

  assert.match(sensor, /addEventListener\('close',[\s\S]*failPendingSnapshots\('Quest snapshot bridge disconnected'\)/);
  assert.match(channelOpen, /await this\.configureTools\(\)/);
  assert.match(presence, /if \(!event\.callId \|\| this\.handledCalls\.has\(event\.callId\)\) return/);
});
