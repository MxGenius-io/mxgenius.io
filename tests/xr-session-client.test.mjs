import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  XRSessionClient,
  buildSensorCompanionIntentUrl,
  buildSensorCompanionLaunchUrl,
  deriveSensorCompanionBridgeUrl,
  deriveSensorActivationState
} from '../xr-session-client.js';

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
      message: 'A session relay is required before the Quest bridge can open.'
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
