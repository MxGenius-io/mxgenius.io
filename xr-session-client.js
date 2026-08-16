const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

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

function companionQuery({ sessionId, bridgeUrl = '', allowInsecurePilot = false }) {
  const query = new URLSearchParams({ sessionId: validSessionId(sessionId) });
  if (bridgeUrl) {
    const normalized = validBridgeUrl(bridgeUrl, { allowInsecurePilot });
    query.set('bridge', normalized);
    if (normalized.startsWith('ws:')) query.set('pilot', '1');
  }
  return query;
}

export function buildSensorCompanionLaunchUrl({
  base = 'mxgenius://sensor-bridge',
  sessionId,
  bridgeUrl = '',
  allowInsecurePilot = false
}) {
  const parsed = new URL(String(base || ''));
  if (parsed.protocol !== 'mxgenius:' || parsed.hostname !== 'sensor-bridge') {
    throw new Error('Unsupported sensor companion launch target');
  }
  const query = companionQuery({ sessionId, bridgeUrl, allowInsecurePilot });
  return `${base}?${query}`;
}

export function buildSensorCompanionIntentUrl({
  packageName = 'io.mxgenius.sensorbridge',
  sessionId,
  bridgeUrl = '',
  fallbackUrl = '',
  allowInsecurePilot = false
}) {
  const applicationId = String(packageName || '');
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(applicationId)) {
    throw new Error('Invalid Android companion package');
  }
  const query = companionQuery({ sessionId, bridgeUrl, allowInsecurePilot });
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
      message: 'A session relay is required before the Quest bridge can open.'
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
      message: 'The relay did not answer. The bridge can open, but it cannot deliver frames yet.'
    };
  }
  return {
    state: 'ready-to-open', canActivate: true, relay: relayState, companion: companionStatus, camera: 'waiting',
    message: 'Relay assigned. Open the Quest bridge, then approve the FLIR ONE connection.'
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
