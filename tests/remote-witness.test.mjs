import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const [clientSource, producerSource, viewerSource, mediaHealthSource, viewerHtml, transportSource, serviceSource, globeSource, sensorOrbSource, nativeWitnessSource, nativePeerSource, nativeCaptureSource, nativeMediaProgressSource, witnessSchema, androidOfferFixture, androidIceFixture, nativeServiceSource, nativeActivitySource, nativeLayoutSource, nativeUiStateSource, nativeAudioSource, nativeManifestSource, maintenanceViewerSource] = await Promise.all([
  readFile(new URL('application-client.js', root), 'utf8'),
  readFile(new URL('xr-remote-witness.js', root), 'utf8'),
  readFile(new URL('witness.js', root), 'utf8'),
  readFile(new URL('witness-media-health.js', root), 'utf8'),
  readFile(new URL('witness.html', root), 'utf8'),
  readFile(new URL('services/mcp/server/src/transport/http.rs', root), 'utf8'),
  readFile(new URL('services/mcp/server/src/application/remote_witness.rs', root), 'utf8'),
  readFile(new URL('globe-vr.html', root), 'utf8'),
  readFile(new URL('xr-sensor-orb.js', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/RemoteWitnessSocket.java', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/RemoteWitnessPeerController.java', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/RemoteWitnessCaptureController.java', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/RemoteWitnessMediaProgress.java', root), 'utf8'),
  readFile(new URL('services/xr-diagnostics-kiosk/contracts/remote-witness-session.schema.json', root), 'utf8'),
  readFile(new URL('services/xr-diagnostics-kiosk/fixtures/witness-android-offer.json', root), 'utf8'),
  readFile(new URL('services/xr-diagnostics-kiosk/fixtures/witness-android-ice.json', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/SensorBridgeService.java', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/ThermalImmersiveActivity.kt', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/app/src/main/res/layout/immersive_thermal_panel.xml', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/RemoteWitnessUiState.java', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/RemoteWitnessAudioController.java', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/app/src/main/AndroidManifest.xml', root), 'utf8'),
  readFile(new URL('3d-viewer/index.html', root), 'utf8')
]);

test('public PIN exchange does not require or emit an application bearer', async () => {
  const requests = [];
  const context = {
    Object, String, TypeError, Error, Blob, URL, URLSearchParams,
    globalThis: null,
    location: { href: 'https://mxgenius.io/witness.html' },
    MXGENIUS_CONFIG: { mcpBase: 'https://core.example', allowInsecurePilot: false },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ credential: 'a'.repeat(64), socketPath: '/api/xr/witness/ws' })
      };
    }
  };
  context.globalThis = context;
  vm.runInNewContext(clientSource, context);
  await context.MXApplicationClient.witness.exchangeInvitation({ pin: '7319042' });
  assert.equal(requests[0].url, 'https://core.example/api/xr/witness/invitations/exchange');
  assert.equal('Authorization' in requests[0].options.headers, false);
  assert.deepEqual(JSON.parse(requests[0].options.body), { pin: '7319042' });
});

test('producer and viewer credentials travel in WebSocket subprotocols, never query strings', () => {
  assert.match(producerSource, /new WebSocket\(this\.api\.socketUrl\(socketPath\), \['mxg-witness\.v1', credential\]\)/);
  assert.match(viewerSource, /new WebSocket\(api\.socketUrl\(viewerSession\.socketPath\), \['mxg-witness\.v1', viewerSession\.credential\]\)/);
  assert.doesNotMatch(producerSource, /[?&](?:token|credential)=/);
  assert.doesNotMatch(viewerSource, /[?&](?:token|credential)=/);
});

test('live witness contract replaces the legacy message family and stays bounded', () => {
  const schema = JSON.parse(witnessSchema);
  assert.equal(schema.$defs.bootstrap.properties.type.const, 'witness.bootstrap');
  assert.equal(schema.$defs.bootstrap.properties.producerCredential.$ref, '#/$defs/credential');
  assert.equal(schema.$defs.bootstrap.properties.pin.pattern, '^[0-9]{7}$');
  assert.equal(schema.$defs.bootstrap.properties.joinUrl, undefined);
  assert.equal(schema.$defs.bootstrap.properties.qrDataUrl, undefined);
  assert.equal(schema.$defs.bootstrap.properties.socketUrl.pattern, '^wss://');
  assert.equal(schema.$defs.candidate.properties.candidate.maxLength, 4096);
  assert.doesNotMatch(witnessSchema, /remote-witness\./);
  assert.match(serviceSource, /MAX_SIGNAL_BYTES/);
  assert.match(serviceSource, /MAX_SDP_BYTES/);
  assert.match(serviceSource, /MAX_ICE_CANDIDATE_BYTES/);
  assert.match(serviceSource, /exact_keys/);
});

test('authenticated Quest loopback transfers witness bootstrap once without URL or storage persistence', () => {
  assert.match(globeSource, /nativeBootstrapProvider: \(invitation, projection\) => xrSensors\.sendWitnessBootstrap/);
  assert.match(sensorOrbSource, /type: 'witness\.bootstrap'/);
  assert.match(sensorOrbSource, /socketUrl: clean\(invitation\?\.socketUrl\)/);
  assert.match(sensorOrbSource, /pin: clean\(invitation\?\.pin\)/);
  assert.match(sensorOrbSource, /audience: clean\(invitation\?\.state\?\.audience/);
  assert.match(producerSource, /socketUrl: this\.api\.socketUrl\(invitation\.socketPath\)/);
  assert.match(sensorOrbSource, /message\.type === 'witness\.bootstrap\.ack'/);
  assert.match(sensorOrbSource, /this\.pendingWitnessBootstrap/);
  assert.doesNotMatch(sensorOrbSource, /localStorage.*producerCredential|sessionStorage.*producerCredential/);
  assert.doesNotMatch(sensorOrbSource, /[?&#](?:credential|producerCredential)=/);
  assert.match(nativeWitnessSource, /Sec-WebSocket-Protocol/);
  assert.match(nativeWitnessSource, /mxg-witness\.v1/);
  assert.match(nativeWitnessSource, /witness\.room-ended/);
  assert.doesNotMatch(nativeWitnessSource, /SharedPreferences|producerCredential.*(?:Log|trace|print)/s);
  assert.match(producerSource, /if \(!this\.nativeProducer\)/);
  assert.match(producerSource, /this\.connectSocket\(invitation\.producerCredential/);
});

test('core permits one active producer and gives viewers no control path', () => {
  assert.match(serviceSource, /ProducerAlreadyConnected/);
  assert.match(serviceSource, /room\.headset_connected/);
  assert.match(serviceSource, /WitnessSocketRole::Producer, "witness\.control"/);
  assert.match(serviceSource, /WitnessSocketRole::Viewer, _.*AccessDenied/s);
  assert.match(serviceSource, /format!\("witness\.\{event\}"\)/);
});

test('continuous witness media is WebRTC-only and the application socket rejects binary', () => {
  assert.match(producerSource, /new RTCPeerConnection/);
  assert.match(producerSource, /createOffer\(\)/);
  assert.match(viewerSource, /createAnswer\(\)/);
  assert.match(transportSource, /WITNESS_MEDIA_NOT_ACCEPTED/);
  assert.match(transportSource, /continuous media must use peer-to-peer WebRTC/);
  assert.doesNotMatch(producerSource, /MediaRecorder/);
});

test('public guest surface is temporary, identity-agnostic, and keeps credentials in memory only', () => {
  assert.match(viewerHtml, /TEMPORARY GUEST VIEW/);
  assert.match(viewerHtml, /7-digit service PIN/);
  assert.match(viewerHtml, /inputmode="numeric"/);
  assert.match(viewerHtml, /No account is required/);
  assert.match(viewerHtml, /name="referrer" content="no-referrer"/);
  assert.doesNotMatch(viewerHtml, /auth\.js/);
  assert.doesNotMatch(viewerHtml, /type="(?:email|tel)"|name="(?:email|phone|name)"/i);
  assert.doesNotMatch(viewerSource, /URLSearchParams|\?invite=/);
  assert.doesNotMatch(viewerSource, /localStorage|sessionStorage|indexedDB/);
  assert.match(clientSource, /publicApplicationJson[\s\S]*credentials: 'omit'/);
  assert.match(clientSource, /Authorization: `Witness[\s\S]*credentials: 'omit'/);
  assert.match(viewerSource, /witness\.comment/);
  assert.match(viewerSource, /witness\.recording-consent/);
  assert.match(viewerSource, /witness\.room-ended/);
  assert.match(viewerSource, /viewerSession = null/);
  assert.doesNotMatch(viewerSource, /controlRoom|create maintenance|approve case|close case/i);
});

test('guest view behaves like a live viewport and does not report live before a decoded frame', () => {
  const liveVideoTag = viewerHtml.match(/<video id="witnessVideo"[^>]*>/)?.[0] || '';
  assert.ok(liveVideoTag);
  assert.doesNotMatch(liveVideoTag, /\scontrols(?:\s|>)/);
  assert.match(liveVideoTag, /autoplay/);
  assert.match(liveVideoTag, /playsinline/);
  assert.doesNotMatch(viewerSource, /video\.readyState >= HTMLMediaElement\.HAVE_CURRENT_DATA/);
  assert.match(viewerSource, /function startFrameMonitoring\(\)/);
  assert.match(viewerSource, /video\.requestVideoFrameCallback\(observeFrame\)/);
  assert.match(viewerSource, /video\.addEventListener\(eventName, observeFallbackFrame\)/);
  assert.doesNotMatch(viewerSource, /video\.addEventListener\(eventName, markLiveFrame\)/);
  assert.match(viewerSource, /decodedFrames <= fallbackDecodedFrames/);
  assert.match(mediaHealthSource, /'frame-stalled'/);
  assert.match(viewerHtml, /id="witnessLastFrame"/);
  assert.match(viewerHtml, /witness-media-health\.js\?v=1/);
  assert.match(viewerSource, /requestVideoFrameCallback/);
  assert.match(viewerSource, /Connected · waiting for the first frame/);
  assert.match(viewerSource, /approve the screen-sharing request/);
});

test('Quest requests full-display projection instead of a disappearing single-app capture', () => {
  assert.match(nativeActivitySource, /MediaProjectionConfig\.createConfigForDefaultDisplay\(\)/);
  assert.match(nativeActivitySource, /createScreenCaptureIntent\(projectionConfig\)/);
  assert.doesNotMatch(nativeActivitySource, /createScreenCaptureIntent\(\)/);
});

test('frame health detects stalls, recovers with a bounded budget, and resets on a fresh frame', () => {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map();
  const states = [];
  const recoveries = [];
  const schedule = (callback, delay) => {
    const id = nextTimer++;
    timers.set(id, { callback, at: now + Number(delay || 0) });
    return id;
  };
  const cancel = (id) => timers.delete(id);
  const advance = (milliseconds) => {
    const target = now + milliseconds;
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      now = timer.at;
      timer.callback();
    }
    now = target;
  };
  const context = { globalThis: null };
  context.globalThis = context;
  vm.runInNewContext(mediaHealthSource, context);
  const health = new context.MXWitnessMediaHealth({
    stallMs: 4_500,
    recoveryWindowMs: 5_000,
    maxRecoveryAttempts: 3,
    now: () => now,
    schedule,
    cancel,
    onState: (state) => states.push({ ...state }),
    onRecover: (recovery) => recoveries.push({ ...recovery })
  });

  health.start();
  health.frame();
  advance(4_000);
  assert.equal(health.status().state, 'live');
  assert.equal(recoveries.length, 0);

  advance(501);
  assert.equal(health.status().state, 'recovering');
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].reason, 'frame-stalled');

  health.start();
  assert.equal(health.status().recoveryAttempt, 1, 'a replacement track without a frame must not reset the retry budget');
  health.frame();
  assert.equal(health.status().state, 'live');
  assert.equal(health.status().recoveryAttempt, 1, 'one decoded frame must not grant a fresh retry budget');
  health.interrupt('track-muted', { delayMs: 1_500 });
  advance(1_000);
  health.frame();
  advance(1_000);
  assert.equal(recoveries.length, 1, 'a transient mute must not rebuild the peer');

  advance(3_501);
  assert.equal(recoveries.length, 2);
  advance(5_000);
  assert.equal(recoveries.length, 3);
  advance(5_000);
  assert.equal(health.status().state, 'unavailable');
  assert.equal(recoveries.length, 3, 'recovery attempts must stop at the configured cap across short flaps');
  assert.ok(states.some((entry) => entry.state === 'unavailable'));

  health.frame();
  assert.equal(health.status().recoveryAttempt, 3);
  for (let sample = 0; sample < 8; sample += 1) {
    advance(4_000);
    health.frame();
  }
  assert.equal(health.status().recoveryAttempt, 0, 'only a sustained healthy stream grants a fresh budget');
  advance(4_501);
  assert.equal(recoveries.length, 4);
});

test('wearer approval gates media and recording remains consent-only', () => {
  assert.match(producerSource, /this\.room\?\.status !== 'live'/);
  assert.match(producerSource, /toggleApproval/);
  assert.match(transportSource, /RemoteWitnessError::ApprovalRequired/);
  assert.match(transportSource, /accepts_media.*false/s);
  assert.match(producerSource, /recording.*state/s);
  assert.match(producerSource, /nativeApprovalProvider/);
  assert.match(producerSource, /witness-native-approval-requested/);
  assert.match(maintenanceViewerSource, /launchQuestWitnessApproval/);
  assert.match(maintenanceViewerSource, /mxgenius;package=io\.mxgenius\.sensorbridge/);
  assert.match(nativeManifestSource, /android:scheme="mxgenius" android:host="witness-consent"/);
  assert.match(nativeActivitySource, /launchRequestedWitnessConsentIfReady/);
  assert.match(nativeActivitySource, /requestWitnessProjection\(witnessConsentResume\)/);
});

test('customer microphone is explicit, permission-scoped, and uses the existing peer', () => {
  assert.match(viewerHtml, /id="microphoneButton"[\s\S]*Enable microphone/);
  assert.match(viewerHtml, /aria-describedby="microphoneStatus"/);
  assert.match(viewerSource, /microphoneButton\.addEventListener\('click'/);
  assert.match(viewerSource, /navigator\.mediaDevices\.getUserMedia\(\{/);
  assert.match(viewerSource, /echoCancellation: true/);
  assert.match(viewerSource, /attachMicrophone\(connection\)[\s\S]*createAnswer\(\)/);
  assert.match(viewerSource, /microphoneStream\?\.getTracks[\s\S]*track\.stop\(\)/);
  assert.match(viewerSource, /requestGeneration !== microphoneRequestGeneration/);
  assert.doesNotMatch(viewerSource, /getUserMedia[\s\S]{0,160}addEventListener\(['"]load/);
  assert.match(producerSource, /addTransceiver\?\.\('audio', \{ direction: 'recvonly' \}\)/);
  assert.match(producerSource, /event\.track\?\.kind !== 'audio'/);
  assert.match(globeSource, /remoteStreamConsumer: \(stream\)/);
  assert.match(nativePeerSource, /setAudioPlayout\(true\)/);
  assert.match(nativePeerSource, /OfferToReceiveAudio", "true"/);
  assert.match(nativePeerSource, /instanceof AudioTrack/);
  assert.match(nativePeerSource, /JavaAudioDeviceModule\.builder/);
  assert.match(nativePeerSource, /setAudioTrackStateCallback/);
  assert.match(nativePeerSource, /setAudioTrackErrorCallback/);
  assert.match(nativePeerSource, /"inbound-rtp"/);
  assert.match(nativePeerSource, /"packetsReceived"/);
  assert.match(nativePeerSource, /"bytesReceived"/);
  assert.match(nativeAudioSource, /MODE_IN_COMMUNICATION/);
  assert.match(nativeAudioSource, /requestAudioFocus/);
  assert.match(nativeAudioSource, /setCommunicationDevice/);
  assert.match(nativeAudioSource, /customer-audio-received-no-playout/);
  assert.match(nativeAudioSource, /playoutStarted \? "customer-audio-live"/);
  assert.match(nativeManifestSource, /android\.permission\.MODIFY_AUDIO_SETTINGS/);
  assert.doesNotMatch(nativeManifestSource, /android\.permission\.RECORD_AUDIO/);
});

test('case and target context use the existing case gallery and target registry seams', () => {
  assert.match(globeSource, /spatialRegistry\?\.modelProjection\?\.\(\)\.activeTarget/);
  assert.match(globeSource, /caseMedia: activeCaseState\?\.media/);
  assert.match(viewerSource, /api\.getMedia/);
  assert.match(transportSource, /workspace_read_blob_access/);
});

test('headset panel provides PIN, approval, layers, viewer count, expiry, and revoke', () => {
  for (const signal of ['viewerCount', 'expiresAtMs', 'APPROVE VIEW', 'SHARE EXTRAS', 'REVOKE ACCESS']) {
    assert.match(producerSource, new RegExp(signal));
  }
  assert.match(producerSource, /this\.invitation\?\.pin/);
  assert.match(producerSource, /7-DIGIT SERVICE PIN/);
  assert.doesNotMatch(producerSource, /qrDataUrl|loadQr|qrImage/);
  assert.doesNotMatch(transportSource, /WITNESS_QR_FAILED/);
  assert.match(globeSource, /xrWitness\?\.interactiveObjects/);
  assert.match(globeSource, /xrWitness\?\.fingerTargetAt/);
});

test('Android-shaped H264 offer and ICE fixtures match the browser answer boundary', () => {
  const offer = JSON.parse(androidOfferFixture);
  const ice = JSON.parse(androidIceFixture);
  assert.equal(offer.type, 'witness.signal');
  assert.equal(offer.signal.kind, 'offer');
  assert.equal(offer.signal.description.type, 'offer');
  assert.match(offer.signal.description.sdp, /m=video/);
  assert.match(offer.signal.description.sdp, /H264\/90000/);
  assert.match(offer.signal.description.sdp, /m=audio/);
  assert.match(offer.signal.description.sdp, /opus\/48000\/2/);
  assert.match(offer.signal.description.sdp, /a=recvonly/);
  assert.equal(ice.signal.kind, 'ice');
  assert.equal(ice.signal.candidate.sdpMid, '0');
  assert.equal(ice.signal.candidate.sdpMLineIndex, 0);
  assert.match(viewerSource, /signal\.kind === 'offer'/);
  assert.match(viewerSource, /setRemoteDescription\(signal\.description\)/);
  assert.match(viewerSource, /addIceCandidate\(signal\.candidate\)/);
});

test('native wearer controls own consent and never expose operational mutations to the customer', () => {
  for (const action of ['beginWitnessStart', 'pauseWitness', 'endWitness', 'toggleWitnessExtras']) {
    assert.match(nativeServiceSource, new RegExp(action));
  }
  for (const id of ['immersive_witness_code', 'immersive_witness_capture', 'immersive_witness_pause', 'immersive_witness_resume', 'immersive_witness_end']) {
    assert.match(nativeLayoutSource, new RegExp(id));
  }
  assert.match(nativeActivitySource, /SERVICE PIN/);
  assert.doesNotMatch(nativeActivitySource, /RemoteWitnessQrCode|renderWitnessQr/);
  assert.doesNotMatch(nativeLayoutSource, /immersive_witness_qr/);
  assert.match(nativeActivitySource, /createScreenCaptureIntent\(projectionConfig\)/);
  assert.match(nativeUiStateSource, /enum Phase \{ WAITING, CONNECTING, LIVE, PAUSED, ENDED, ERROR \}/);
  assert.match(nativeUiStateSource, /"live"\.equals\(mediaState\)/);
  assert.match(nativeServiceSource, /void projectionConsentDenied\(\)[\s\S]*sendControl\("pause", null, null\)/);
  assert.doesNotMatch(nativeLayoutSource, /immersive_trace|Waiting for bridge trace/);
  assert.doesNotMatch(viewerSource, /beginWitnessStart|pauseWitness|endWitness|toggleWitnessExtras/);
});

test('native witness reports live only from advancing media and bounds peer recovery', () => {
  assert.match(nativePeerSource, /new RemoteWitnessMediaProgress\(\)/);
  assert.match(nativePeerSource, /RemoteWitnessMediaProgress\.State\.LIVE/);
  assert.match(nativePeerSource, /RemoteWitnessMediaProgress\.State\.CAPTURE_STALLED/);
  assert.match(nativePeerSource, /recoverPeer\("transport-stalled", generation\)/);
  assert.match(nativePeerSource, /PeerConnection\.PeerConnectionState\.DISCONNECTED/);
  assert.match(nativePeerSource, /MAX_PEER_RECONNECT_ATTEMPTS/);
  assert.match(nativePeerSource, /progress == RemoteWitnessMediaProgress\.State\.STABLE/);
  assert.match(nativePeerSource, /observedGeneration != peerGeneration/);
  assert.match(nativePeerSource, /peerState != PeerConnection\.PeerConnectionState\.CONNECTED/);
  assert.match(nativePeerSource, /generation != peerGeneration \|\| current != peer/);
  assert.doesNotMatch(nativePeerSource, /PeerConnectionState\.CONNECTED \? "live"/);
  assert.match(nativeMediaProgressSource, /enum State \{ WARMING, LIVE, STABLE, CAPTURE_STALLED, TRANSPORT_STALLED \}/);
  assert.match(nativeCaptureSource, /currentCapturer\.stopCapture\(\)/);
  assert.match(nativeServiceSource, /activeSocket != null && witnessRoomLive/);
});
