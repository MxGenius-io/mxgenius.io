const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const LOCAL_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const LOCAL_THERMAL_PORT = 4109;

function normalizedBase(value) {
  const parsed = new URL(String(value || ''));
  if (parsed.protocol !== 'https:') throw new Error('XR session gateway requires HTTPS');
  return parsed.href.replace(/\/$/, '');
}

function validSessionId(value) {
  const sessionId = String(value || '');
  if (!SESSION_ID.test(sessionId)) throw new Error('Invalid XR session identifier');
  return sessionId;
}

function validBridgeUrl(value, { allowInsecurePilot = false } = {}) {
  const parsed = new URL(String(value || ''));
  if (parsed.protocol !== 'wss:' && !(allowInsecurePilot && parsed.protocol === 'ws:')) {
    throw new Error('XR production bridge must use WSS');
  }
  return parsed.href;
}

function validLocalToken(value) {
  const token = String(value || '');
  if (!LOCAL_TOKEN.test(token)) throw new Error('Invalid Quest-local thermal token');
  return token;
}

export function createSensorLocalToken(cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.getRandomValues) throw new Error('Secure random token generation is unavailable');
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(32));
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function buildSensorLocalBridgeUrl({ sessionId, localToken, port = LOCAL_THERMAL_PORT }) {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1024 || numericPort > 65535) {
    throw new Error('Invalid Quest-local thermal port');
  }
  const url = new URL(`ws://127.0.0.1:${numericPort}/thermal`);
  url.searchParams.set('sessionId', validSessionId(sessionId));
  url.searchParams.set('token', validLocalToken(localToken));
  return url.href;
}

export function deriveSensorSourceState({
  thermalBridgeUrl = '',
  piDiagnosticsBridgeUrl = '',
  remoteWitnessUrl = ''
} = {}) {
  const thermalConfigured = Boolean(String(thermalBridgeUrl || '').trim());
  const piConfigured = Boolean(String(piDiagnosticsBridgeUrl || '').trim());
  return {
    mode: thermalConfigured && piConfigured
      ? 'thermal-and-pi'
      : thermalConfigured
        ? 'thermal-only'
        : piConfigured ? 'pi-only' : 'none',
    thermalTransport: thermalConfigured ? 'configured' : 'unconfigured',
    thermalSource: 'standby',
    piDiagnostics: piConfigured ? 'configured' : 'unconfigured',
    remoteWitness: String(remoteWitnessUrl || '').trim() ? 'configured' : 'unconfigured',
    companion: thermalConfigured ? 'unknown' : 'not-requested'
  };
}

function companionQuery({ sessionId, bridgeUrl = '', localToken = '', allowInsecurePilot = false }) {
  const query = new URLSearchParams({ sessionId: validSessionId(sessionId) });
  if (localToken) query.set('localToken', validLocalToken(localToken));
  if (bridgeUrl) {
    const normalized = validBridgeUrl(bridgeUrl, { allowInsecurePilot });
    query.set('bridge', normalized);
    if (normalized.startsWith('ws:')) query.set('pilot', '1');
  }
  if (!localToken && !bridgeUrl) throw new Error('A Quest-local token or optional relay is required');
  return query;
}

export function buildSensorCompanionLaunchUrl({
  base = 'mxgenius://sensor-bridge',
  sessionId,
  bridgeUrl = '',
  localToken = '',
  allowInsecurePilot = false
}) {
  const parsed = new URL(String(base || ''));
  if (parsed.protocol !== 'mxgenius:' || parsed.hostname !== 'sensor-bridge') {
    throw new Error('Unsupported sensor companion launch target');
  }
  const query = companionQuery({ sessionId, bridgeUrl, localToken, allowInsecurePilot });
  return `${base}?${query}`;
}

export function buildSensorCompanionIntentUrl({
  packageName = 'io.mxgenius.sensorbridge',
  sessionId,
  bridgeUrl = '',
  localToken = '',
  fallbackUrl = '',
  allowInsecurePilot = false
}) {
  const applicationId = String(packageName || '');
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(applicationId)) {
    throw new Error('Invalid Android companion package');
  }
  const query = companionQuery({ sessionId, bridgeUrl, localToken, allowInsecurePilot });
  let fallback = '';
  if (fallbackUrl) {
    const parsed = new URL(String(fallbackUrl));
    if (parsed.protocol !== 'https:') throw new Error('Companion download fallback requires HTTPS');
    fallback = `;S.browser_fallback_url=${encodeURIComponent(parsed.href)}`;
  }
  return `intent://sensor-bridge?${query}#Intent;scheme=mxgenius;package=${applicationId}${fallback};end`;
}

export function deriveSensorCompanionBridgeUrl(bridgeUrl, { allowInsecurePilot = false } = {}) {
  const parsed = new URL(validBridgeUrl(bridgeUrl, { allowInsecurePilot }));
  if (!parsed.pathname.endsWith('/ws/xr')) {
    throw new Error('The companion producer relay must be issued separately by the session gateway');
  }
  parsed.pathname = `${parsed.pathname.slice(0, -'/ws/xr'.length)}/ws/ingest`;
  return parsed.href;
}

export function deriveSensorActivationState({
  bridgeUrl = '',
  relayState = 'unconfigured',
  companionStatus = 'unknown',
  sourceStatus = 'standby',
  activating = false
} = {}) {
  if (!bridgeUrl) {
    return {
      state: 'relay-required',
      canActivate: false,
      relay: 'required',
      companion: 'blocked',
      camera: 'blocked',
      message: 'A thermal link is required before the Quest companion can stream into XR.'
    };
  }
  if (companionStatus === 'ready' && sourceStatus === 'streaming') {
    return {
      state: 'streaming', canActivate: true, relay: 'ready', companion: 'ready', camera: 'streaming',
      message: 'FLIR ONE is streaming into this XR session.'
    };
  }
  if (companionStatus === 'ready') {
    return {
      state: 'camera-required', canActivate: true, relay: relayState === 'connected' ? 'ready' : relayState,
      companion: 'ready', camera: sourceStatus === 'offline' ? 'offline' : 'waiting',
      message: sourceStatus === 'offline'
        ? 'Quest bridge is present; reconnect the FLIR ONE and approve USB access.'
        : 'Quest bridge is present and waiting for FLIR ONE permission.'
    };
  }
  if (activating) {
    return {
      state: 'activating', canActivate: true, relay: relayState, companion: 'opening', camera: 'waiting',
      message: 'Opening the Quest bridge. Return here after approving USB access.'
    };
  }
  if (companionStatus === 'missing') {
    return {
      state: 'companion-missing', canActivate: true, relay: relayState, companion: 'offline', camera: 'blocked',
      message: 'No Quest bridge checked in. Install it if needed, then try opening it again.'
    };
  }
  if (['failed', 'disconnected'].includes(relayState)) {
    return {
      state: 'relay-unavailable', canActivate: true, relay: relayState, companion: 'unknown', camera: 'blocked',
      message: 'The thermal link did not answer. The companion can open, but XR cannot receive frames yet.'
    };
  }
  return {
    state: 'ready-to-open', canActivate: true, relay: relayState, companion: companionStatus, camera: 'waiting',
    message: 'Thermal link assigned. Open the Quest companion, then approve the FLIR ONE connection.'
  };
}

export class XRSessionClient {
  constructor({ mcpBase, getSession = () => ({}), fetchImpl = globalThis.fetch } = {}) {
    this.mcpBase = normalizedBase(mcpBase);
    this.getSession = getSession;
    this.fetch = fetchImpl;
  }

  async negotiate({ sessionId, nodeType, capabilities = [] }) {
    const session = await this.getSession();
    if (!session?.accessToken) throw new Error('Authenticated MXGenius session required');
    const response = await this.fetch(`${this.mcpBase}/api/xr/sessions/negotiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        ...(session.organizationId ? { 'X-MXG-Organization-ID': session.organizationId } : {})
      },
      body: JSON.stringify({
        version: 1,
        sessionId: validSessionId(sessionId),
        nodeType: String(nodeType || 'xr-client'),
        capabilities: [...new Set(capabilities.map(String))].sort()
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `XR negotiation failed (${response.status})`);
    return {
      sessionId: validSessionId(payload.sessionId),
      bridgeUrl: validBridgeUrl(payload.bridgeUrl),
      companionBridgeUrl: validBridgeUrl(payload.companionBridgeUrl),
      expiresAtMs: Number(payload.expiresAtMs),
      connectionId: String(payload.connectionId || '')
    };
  }
}
