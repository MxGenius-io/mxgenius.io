import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  XRSessionClient,
  buildSensorCompanionIntentUrl,
  buildSensorCompanionLaunchUrl,
  buildSensorLocalBridgeUrl,
  createSensorLocalToken,
  deriveSensorCompanionBridgeUrl,
  deriveSensorActivationState,
  deriveSensorSourceState,
  parseSensorHandoffFragment
} from '../xr-session-client.js';

const globeVr = await readFile(new URL('../globe-vr.html', import.meta.url), 'utf8');

test('Quest-local thermal session binds browser and companion without a Pi route', () => {
  const localToken = 'a'.repeat(64);
  assert.equal(
    buildSensorLocalBridgeUrl({ sessionId: 'case-42', localToken }),
    `ws://127.0.0.1:4109/thermal?sessionId=case-42&token=${localToken}`
  );
  assert.equal(
    buildSensorCompanionLaunchUrl({ sessionId: 'case-42', localToken }),
    `mxgenius://sensor-bridge?sessionId=case-42&localToken=${localToken}`
  );
  assert.match(createSensorLocalToken({ getRandomValues: (bytes) => bytes.fill(7) }), /^[a-f0-9]{64}$/);
  assert.match(globeVr, /buildSensorLocalBridgeUrl\(\{/);
  assert.doesNotMatch(globeVr, /deriveSensorCompanionBridgeUrl/);
});

test('native bridge handoff restores the browser session without placing credentials in the request URL', () => {
  const localToken = 'b'.repeat(64);
  assert.deepEqual(
    parseSensorHandoffFragment(`#sensorHandoff=1&sessionId=case-42&localToken=${localToken}`),
    { sessionId: 'case-42', localToken }
  );
  assert.equal(parseSensorHandoffFragment('#unrelated=1'), null);
  assert.throws(
    () => parseSensorHandoffFragment('#sensorHandoff=1&sessionId=case-42&localToken=short'),
    /Invalid Quest-local thermal token/
  );
  assert.match(globeVr, /history\.replaceState\(null, '', `\$\{location\.pathname\}\$\{location\.search\}`\)/);
});

test('thermal and Pi source state supports every independent configuration', () => {
  assert.equal(deriveSensorSourceState().mode, 'none');
  assert.equal(deriveSensorSourceState({ thermalBridgeUrl: 'ws://127.0.0.1:4109/thermal' }).mode, 'thermal-only');
  assert.equal(deriveSensorSourceState({ piDiagnosticsBridgeUrl: 'wss://pi.example/diagnostics' }).mode, 'pi-only');
  assert.deepEqual(
    deriveSensorSourceState({
      thermalBridgeUrl: 'ws://127.0.0.1:4109/thermal',
      piDiagnosticsBridgeUrl: 'wss://pi.example/diagnostics',
      remoteWitnessUrl: 'wss://witness.example/xr'
    }),
    {
      mode: 'thermal-and-pi',
      thermalTransport: 'configured',
      thermalSource: 'standby',
      piDiagnostics: 'configured',
      remoteWitness: 'configured',
      companion: 'unknown'
    }
  );
  assert.match(globeVr, /piDiagnosticsBridgeUrl/);
  assert.match(globeVr, /diagnosticsBridgeUrl: piDiagnosticsBridgeUrl/);
});

test('immersive scene exits XR before returning to the dashboard', () => {
  assert.match(globeVr, /backButton\.name = 'BackToDashboard'/);
  assert.match(globeVr, /uiTargets = \[[\s\S]*backButton[\s\S]*intersectObjects\(uiTargets/);
  assert.match(globeVr, /async function returnToDashboard[\s\S]*await session\.end\(\)[\s\S]*window\.location\.assign\('dashboard\.html'\)/);
  assert.match(globeVr, /if \(overBack && !wasOverBack\) returnToDashboard\(`finger-\$\{handIndex\}`\)/);
});

test('companion launch binds an opaque session and negotiated relay URL', () => {
  assert.equal(
    buildSensorCompanionLaunchUrl({ sessionId: 'case-42', bridgeUrl: 'wss://mxg.webpubsub.azure.com/client' }),
    'mxgenius://sensor-bridge?sessionId=case-42&bridge=wss%3A%2F%2Fmxg.webpubsub.azure.com%2Fclient'
  );
});

test('Quest intent targets the native package and carries an optional install fallback', () => {
  assert.equal(
    buildSensorCompanionIntentUrl({
      packageName: 'io.mxgenius.sensorbridge',
      sessionId: 'case-42',
      bridgeUrl: 'wss://mxg.webpubsub.azure.com/client',
      fallbackUrl: 'https://mxgenius.io/downloads/sensor-bridge.apk'
    }),
    'intent://sensor-bridge?sessionId=case-42&bridge=wss%3A%2F%2Fmxg.webpubsub.azure.com%2Fclient#Intent;scheme=mxgenius;package=io.mxgenius.sensorbridge;S.browser_fallback_url=https%3A%2F%2Fmxgenius.io%2Fdownloads%2Fsensor-bridge.apk;end'
  );
});

test('companion launch rejects cleartext relay URLs unless the local pilot is explicit', () => {
  assert.throws(
    () => buildSensorCompanionLaunchUrl({ sessionId: 'case-42', bridgeUrl: 'ws://192.168.1.20/ws/xr' }),
    /must use WSS/
  );
  assert.equal(
    buildSensorCompanionLaunchUrl({
      sessionId: 'case-42',
      bridgeUrl: 'ws://192.168.1.20/ws/xr',
      allowInsecurePilot: true
    }),
    'mxgenius://sensor-bridge?sessionId=case-42&bridge=ws%3A%2F%2F192.168.1.20%2Fws%2Fxr&pilot=1'
  );
});

test('local browser consumer route maps to the separate companion producer route', () => {
  assert.equal(
    deriveSensorCompanionBridgeUrl('ws://192.168.1.20/ws/xr?token=pilot', { allowInsecurePilot: true }),
    'ws://192.168.1.20/ws/ingest?token=pilot'
  );
  assert.equal(
    deriveSensorCompanionBridgeUrl('wss://relay.example/ws/xr?token=short'),
    'wss://relay.example/ws/ingest?token=short'
  );
  assert.throws(
    () => deriveSensorCompanionBridgeUrl('wss://mxg.webpubsub.azure.com/client/hubs/x'),
    /must be issued separately/
  );
});

test('activation state exposes the failing link in the browser-to-camera chain', () => {
  assert.deepEqual(
    deriveSensorActivationState({}),
    {
      state: 'relay-required',
      canActivate: false,
      relay: 'required',
      companion: 'blocked',
      camera: 'blocked',
      message: 'A thermal link is required before the Quest companion can stream into XR.'
    }
  );
  assert.equal(deriveSensorActivationState({
    bridgeUrl: 'wss://relay.example/ws',
    relayState: 'connected',
    companionStatus: 'ready',
    sourceStatus: 'streaming'
  }).state, 'streaming');
});

test('XR negotiation uses application identity and returns a short-lived WSS route', async () => {
  let request;
  const client = new XRSessionClient({
    mcpBase: 'https://mxg-core.example',
    getSession: async () => ({ accessToken: 'entra-token', organizationId: 'org-1' }),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          sessionId: 'case-42',
          bridgeUrl: 'wss://mxg.webpubsub.azure.com/client?access_token=short-lived',
          companionBridgeUrl: 'wss://mxg.webpubsub.azure.com/client?access_token=producer-only',
          expiresAtMs: 9000,
          connectionId: 'connection-1'
        })
      };
    }
  });
  const result = await client.negotiate({
    sessionId: 'case-42',
    nodeType: 'xr-client',
    capabilities: ['thermal-display', 'diagnostics-display']
  });
  assert.equal(request.url, 'https://mxg-core.example/api/xr/sessions/negotiate');
  assert.equal(request.options.headers.Authorization, 'Bearer entra-token');
  assert.equal(request.options.headers['X-MXG-Organization-ID'], 'org-1');
  assert.equal(result.connectionId, 'connection-1');
  assert.match(result.bridgeUrl, /^wss:/);
  assert.match(result.companionBridgeUrl, /producer-only/);
});

test('XR negotiation fails closed without an authenticated session', async () => {
  const client = new XRSessionClient({
    mcpBase: 'https://mxg-core.example',
    getSession: async () => ({}),
    fetchImpl: async () => assert.fail('fetch must not run')
  });
  await assert.rejects(() => client.negotiate({ sessionId: 'case-42' }), /Authenticated/);
});

test('XR production negotiation rejects cleartext relay URLs', async () => {
  const client = new XRSessionClient({
    mcpBase: 'https://mxg-core.example',
    getSession: async () => ({ accessToken: 'token' }),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ sessionId: 'case-42', bridgeUrl: 'ws://192.168.1.20/ws', expiresAtMs: 9000 })
    })
  });
  await assert.rejects(() => client.negotiate({ sessionId: 'case-42' }), /must use WSS/);
});
