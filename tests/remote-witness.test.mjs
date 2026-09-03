import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const [clientSource, producerSource, viewerSource, viewerHtml, transportSource, serviceSource, globeSource, sensorOrbSource, nativeWitnessSource, witnessSchema, androidOfferFixture, androidIceFixture, nativeServiceSource, nativeActivitySource, nativeLayoutSource, nativeUiStateSource] = await Promise.all([
  readFile(new URL('application-client.js', root), 'utf8'),
  readFile(new URL('xr-remote-witness.js', root), 'utf8'),
  readFile(new URL('witness.js', root), 'utf8'),
  readFile(new URL('witness.html', root), 'utf8'),
  readFile(new URL('services/mcp/server/src/transport/http.rs', root), 'utf8'),
  readFile(new URL('services/mcp/server/src/application/remote_witness.rs', root), 'utf8'),
  readFile(new URL('globe-vr.html', root), 'utf8'),
  readFile(new URL('xr-sensor-orb.js', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/RemoteWitnessSocket.java', root), 'utf8'),
  readFile(new URL('services/xr-diagnostics-kiosk/contracts/remote-witness-session.schema.json', root), 'utf8'),
  readFile(new URL('services/xr-diagnostics-kiosk/fixtures/witness-android-offer.json', root), 'utf8'),
  readFile(new URL('services/xr-diagnostics-kiosk/fixtures/witness-android-ice.json', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/SensorBridgeService.java', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/ThermalImmersiveActivity.kt', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/app/src/main/res/layout/immersive_thermal_panel.xml', root), 'utf8'),
  readFile(new URL('services/xr-flir-companion/app/src/main/java/io/mxgenius/sensorbridge/RemoteWitnessUiState.java', root), 'utf8')
]);

test('public invitation exchange does not require or emit an application bearer', async () => {
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
  await context.MXApplicationClient.witness.exchangeInvitation({ manualCode: 'ABCDEF012345' });
  assert.equal(requests[0].url, 'https://core.example/api/xr/witness/invitations/exchange');
  assert.equal('Authorization' in requests[0].options.headers, false);
  assert.deepEqual(JSON.parse(requests[0].options.body), { invitation: null, manualCode: 'ABCDEF012345' });
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
  assert.match(sensorOrbSource, /qrDataUrl: String\(invitation\.qrDataUrl\)/);
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

test('customer surface is intentionally read-only and keeps credentials in memory only', () => {
  assert.match(viewerHtml, /READ-ONLY CUSTOMER VIEW/);
  assert.doesNotMatch(viewerHtml, /auth\.js/);
  assert.doesNotMatch(viewerSource, /localStorage|sessionStorage|indexedDB/);
  assert.match(viewerSource, /witness\.comment/);
  assert.match(viewerSource, /witness\.recording-consent/);
  assert.doesNotMatch(viewerSource, /controlRoom|create maintenance|approve case|close case/i);
});

test('wearer approval gates media and recording remains consent-only', () => {
  assert.match(producerSource, /this\.room\?\.status !== 'live'/);
  assert.match(producerSource, /toggleApproval/);
  assert.match(transportSource, /RemoteWitnessError::ApprovalRequired/);
  assert.match(transportSource, /accepts_media.*false/s);
  assert.match(producerSource, /recording.*state/s);
});

test('case and target context use the existing case gallery and target registry seams', () => {
  assert.match(globeSource, /spatialRegistry\?\.modelProjection\?\.\(\)\.activeTarget/);
  assert.match(globeSource, /caseMedia: activeCaseState\?\.media/);
  assert.match(viewerSource, /api\.getMedia/);
  assert.match(transportSource, /workspace_read_blob_access/);
});

test('headset panel provides invitation, approval, layers, viewer count, expiry, and revoke', () => {
  for (const signal of ['manualCode', 'viewerCount', 'expiresAtMs', 'APPROVE VIEW', 'SHARE EXTRAS', 'REVOKE ACCESS']) {
    assert.match(producerSource, new RegExp(signal));
  }
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
  for (const id of ['immersive_witness_qr', 'immersive_witness_capture', 'immersive_witness_pause', 'immersive_witness_resume', 'immersive_witness_end']) {
    assert.match(nativeLayoutSource, new RegExp(id));
  }
  assert.match(nativeActivitySource, /createScreenCaptureIntent\(\)/);
  assert.match(nativeUiStateSource, /enum Phase \{ WAITING, CONNECTING, LIVE, PAUSED, ENDED, ERROR \}/);
  assert.match(nativeUiStateSource, /"live"\.equals\(mediaState\)/);
  assert.doesNotMatch(nativeLayoutSource, /immersive_trace|Waiting for bridge trace/);
  assert.doesNotMatch(viewerSource, /beginWitnessStart|pauseWitness|endWitness|toggleWitnessExtras/);
});
