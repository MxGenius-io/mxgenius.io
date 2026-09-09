import {
  buildSensorLocalBridgeUrl,
  createSensorLocalToken,
  parseSensorHandoffFragment
} from './xr-session-client.js';

function opaqueId(prefix = 'xr') {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return `${prefix}-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function createOpaqueXrId(prefix = 'xr') {
  return opaqueId(prefix);
}

export function resolveXRSensorRuntime({ clearHandoffFragment = true } = {}) {
  const query = new URLSearchParams(globalThis.location?.search || '');
  let handoff = null;
  try {
    handoff = parseSensorHandoffFragment(globalThis.location?.hash || '');
  } catch (error) {
    console.warn('Rejected invalid sensor bridge handoff', error);
  }

  if (handoff) {
    sessionStorage.setItem('mxg_xr_session_id', handoff.sessionId);
    sessionStorage.setItem('mxg_thermal_local_token', handoff.localToken);
    if (clearHandoffFragment && globalThis.history && globalThis.location) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
  }

  const sessionId = handoff?.sessionId || sessionStorage.getItem('mxg_xr_session_id') || opaqueId();
  sessionStorage.setItem('mxg_xr_session_id', sessionId);
  let localToken = sessionStorage.getItem('mxg_thermal_local_token') || '';
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(localToken)) {
    localToken = createSensorLocalToken();
    sessionStorage.setItem('mxg_thermal_local_token', localToken);
  }

  const thermalLocalEnabled = query.get('thermal') !== 'off';
  const configuredThermalBridgeUrl = query.get('thermalBridge')
    || globalThis.MXGENIUS_CONFIG?.thermalBridgeUrl
    || localStorage.getItem('mxg_thermal_bridge_url')
    || '';
  const thermalBridgeUrl = configuredThermalBridgeUrl || (thermalLocalEnabled
    ? buildSensorLocalBridgeUrl({ sessionId, localToken })
    : '');

  return Object.freeze({
    query,
    handoff,
    sessionId,
    localToken,
    thermalLocalEnabled,
    thermalBridgeUrl,
    piDiagnosticsBridgeUrl: query.get('piDiagnosticsBridge')
      || globalThis.MXGENIUS_CONFIG?.piDiagnosticsBridgeUrl
      || localStorage.getItem('mxg_pi_diagnostics_bridge_url')
      || '',
    remoteWitnessUrl: query.get('remoteWitnessBridge')
      || globalThis.MXGENIUS_CONFIG?.remoteWitnessBridgeUrl
      || ''
  });
}

export async function applicationSession({ forceRefresh = false } = {}) {
  await globalThis.MXGENIUS_CONFIG?.ready;
  const refreshed = globalThis.MXGENIUS_AUTH?.getToken
    ? await globalThis.MXGENIUS_AUTH.getToken({ forceRefresh })
    : '';
  const configured = globalThis.MXGENIUS_CONFIG?.getSession?.() || {};
  return {
    accessToken: refreshed || configured.accessToken,
    organizationId: configured.organizationId,
    correlationId: opaqueId('request')
  };
}

export async function withRenewedApplicationSession(operation) {
  let session = await applicationSession();
  try {
    return await operation(session);
  } catch (error) {
    if (error?.status !== 401 || globalThis.MXGENIUS_CONFIG?.allowInsecurePilot) throw error;
    globalThis.MXApplicationClient?.capabilities?.disconnect?.(session);
    session = await applicationSession({ forceRefresh: true });
    return operation(session);
  }
}

export function snapshotFile(snapshot) {
  const encoded = String(snapshot?.dataUrl || '').split(',', 2)[1] || '';
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  Object.defineProperty(blob, 'name', { value: `quest-passthrough-${timestamp}.jpg` });
  return blob;
}
