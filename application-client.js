/**
 * MXGenius application compatibility client.
 *
 * This is the single browser-side boundary for the current REST/static
 * application sources. It deliberately exposes compatibility DTOs, not the
 * canonical MCP/domain contracts. The post-MCP mount will replace the
 * implementation behind this boundary without rewriting workspace views.
 */
const MXApplicationClient = (() => {
  const API_BASE = 'https://mxg-api.kindbush-8fee3a17.centralus.azurecontainerapps.io';
  const MCP_PROTOCOL_VERSION = '2025-11-25';
  const runtimeConfig = globalThis.MXGENIUS_CONFIG || {};
  const MCP_BASE = String(runtimeConfig.mcpBase || API_BASE).replace(/\/$/, '');
  const FLEET_API_BASE = String(runtimeConfig.fleetBase || API_BASE).replace(/\/$/, '');
  let rpcSequence = 0;

  async function request(path, options = {}) {
    return fetch(`${API_BASE}${path}`, options);
  }

  async function requestJson(path, options = {}) {
    const response = await request(path, options);
    const data = await response.json();
    return { response, data };
  }

  async function fleetRequestJson(path, options = {}) {
    const response = await fetch(`${FLEET_API_BASE}${path}`, options);
    const data = await response.json();
    return { response, data };
  }

  function jetNetHeaders(bearer) {
    const headers = { 'Content-Type': 'application/json' };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    return headers;
  }

  async function jetNetJson(path, { bearer, method = 'GET', body } = {}) {
    const options = { method, headers: jetNetHeaders(bearer) };
    if (body !== undefined) options.body = JSON.stringify(body);
    return (await fleetRequestJson(`/api/${path}`, options)).data;
  }

  async function bulkAircraft({ token, bearer, pageSize = 5000, page = 1, cacheTtl }) {
    const path = `/api/Aircraft/getBulkAircraftExportPaged/${token}/${pageSize}/${page}`;
    return MXCache.cachedFetch(
      `${FLEET_API_BASE}${path}`,
      { method: 'PUT', headers: jetNetHeaders(bearer), body: JSON.stringify({}) },
      cacheTtl
    );
  }

  function aircraftList({ token, bearer, filters = {} }) {
    return jetNetJson(`Aircraft/getAircraftList/${token}`, {
      bearer,
      method: 'PUT',
      body: filters
    });
  }

  async function aircraftBundle({ id, token }) {
    const safeJson = async (promise) => {
      try { return await promise; } catch { return {}; }
    };

    const [aircraft, pictures, engines] = await Promise.all([
      jetNetJson(`Aircraft/getAircraft/${id}/${token}`),
      safeJson(jetNetJson(`Aircraft/getPictures/${id}/${token}`)),
      safeJson(jetNetJson(`Engines/getEnginesByAircraft/${id}/${token}`))
    ]);

    return { aircraft, pictures, engines };
  }

  function companyList({ token, bearer, filters }) {
    return jetNetJson(`Company/getCompanyList/${token}`, {
      bearer,
      method: 'PUT',
      body: filters
    });
  }

  function companyDetail({ id, token }) {
    return jetNetJson(`Company/getCompany/${id}/${token}`);
  }

  function contactList({ token, bearer, filters }) {
    return jetNetJson(`Contact/getContactList/${token}`, {
      bearer,
      method: 'PUT',
      body: filters
    });
  }

  function chat({ message, fleetSignals, caseContext, accessToken, organizationId, correlationId }) {
    if (!accessToken && !runtimeConfig.allowInsecurePilot) throw new Error('Authenticated application session required');
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    };
    if (organizationId) headers['X-MXG-Organization-ID'] = organizationId;
    if (correlationId) headers['X-Correlation-ID'] = correlationId;
    return fetch(`${MCP_BASE}/chat`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ message, fleet_signals: fleetSignals, case_context: caseContext || null })
    });
  }

  async function exchangeRealtimeSdp({ sdp, session = {} }) {
    if (!session.accessToken && !runtimeConfig.allowInsecurePilot) throw new Error('Authenticated application session required');
    if (typeof sdp !== 'string' || !sdp.startsWith('v=0')) {
      throw new TypeError('A valid WebRTC SDP offer is required');
    }
    const headers = {
      'Accept': 'application/sdp',
      'Content-Type': 'application/sdp',
      'Authorization': `Bearer ${session.accessToken}`
    };
    if (session.organizationId) headers['X-MXG-Organization-ID'] = session.organizationId;
    if (session.correlationId) headers['X-Correlation-ID'] = session.correlationId;
    const response = await fetch(`${MCP_BASE}/realtime/calls`, {
      method: 'POST',
      headers,
      credentials: 'include',
      signal: session.signal,
      body: sdp
    });
    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json')
        ? await response.json()
        : { error: { message: await response.text() } };
      const error = new Error(payload.error?.message || `Realtime SDP exchange failed (${response.status})`);
      error.code = payload.error?.code || 'REALTIME_EXCHANGE_FAILED';
      error.status = response.status;
      throw error;
    }
    const answer = await response.text();
    if (!answer.startsWith('v=0')) throw new Error('Realtime returned an invalid SDP answer');
    return {
      sdp: answer,
      callId: response.headers.get('x-mxg-realtime-call-id'),
      correlationId: response.headers.get('x-correlation-id')
    };
  }

  async function issueConfirmation({ toolName, arguments: capabilityArguments, qualifiedApproval = false, session = {} }) {
    if (!session.accessToken && !runtimeConfig.allowInsecurePilot) throw new Error('Authenticated application session required');
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.accessToken}`
    };
    if (session.organizationId) headers['X-MXG-Organization-ID'] = session.organizationId;
    if (session.correlationId) headers['X-Correlation-ID'] = session.correlationId;
    const response = await fetch(`${MCP_BASE}/confirmations`, {
      method: 'POST',
      headers,
      credentials: 'include',
      signal: session.signal,
      body: JSON.stringify({
        tool_name: toolName,
        arguments: capabilityArguments,
        qualified_approval: qualifiedApproval
      })
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      const error = new Error(payload.error?.message || `Confirmation issuance failed (${response.status})`);
      error.code = payload.error?.code || 'CONFIRMATION_ISSUANCE_FAILED';
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function staticJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Static source unavailable (${response.status}): ${path}`);
    return response.json();
  }

  async function mcpRequest(method, params = {}, options = {}) {
    const id = options.id ?? `mxg-web-${Date.now()}-${++rpcSequence}`;
    const headers = {
      'Accept': 'application/json, text/event-stream',
      'Content-Type': 'application/json'
    };
    if (method !== 'initialize') headers['MCP-Protocol-Version'] = MCP_PROTOCOL_VERSION;
    if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
    if (options.organizationId) headers['X-MXG-Organization-ID'] = options.organizationId;
    if (options.correlationId) headers['X-Correlation-ID'] = options.correlationId;
    if (options.confirmationGrant) {
      headers['X-MXG-Confirmation-Grant'] = options.confirmationGrant;
    }

    const response = await fetch(`${MCP_BASE}/mcp`, {
      method: 'POST',
      headers,
      credentials: 'include',
      signal: options.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
    });
    if (response.status === 202) return null;

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : { error: { message: await response.text() } };
    if (!response.ok || payload.error) {
      const error = new Error(payload.error?.message || `MCP request failed (${response.status})`);
      error.code = payload.error?.data?.stable_code || 'MCP_REQUEST_FAILED';
      error.status = response.status;
      error.details = payload.error?.data || null;
      throw error;
    }
    if (payload.id !== id) throw new Error('MCP response correlation ID mismatch');
    return payload.result;
  }

  function initializeCapabilities(options = {}) {
    return mcpRequest('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'mxgenius-dashboard', version: '0.1.0' }
    }, options);
  }

  function listCapabilities(options = {}) {
    return mcpRequest('tools/list', {}, options);
  }

  function callCapability(name, args = {}, options = {}) {
    if (!/^mxg\.[a-z_]+\.[a-z_]+$/.test(name)) {
      throw new TypeError(`Invalid MXGenius capability name: ${name}`);
    }
    return mcpRequest('tools/call', { name, arguments: args }, options);
  }

  function capabilityOutput(envelope) {
    if (!envelope || typeof envelope !== 'object') {
      throw new TypeError('Capability returned an invalid envelope');
    }
    if (envelope.status === 'failed' || (Array.isArray(envelope.errors) && envelope.errors.length)) {
      const first = envelope.errors?.[0];
      const error = new Error(first?.message || 'Capability execution failed');
      error.code = first?.code || 'CAPABILITY_FAILED';
      error.envelope = envelope;
      throw error;
    }
    return envelope.output;
  }

  async function runFirstCaseSlice({ registration, discrepancy, priority = 'routine', include, session = {} }) {
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (session.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
    if (session.organizationId) headers['X-MXG-Organization-ID'] = session.organizationId;
    if (session.correlationId) headers['X-Correlation-ID'] = session.correlationId;
    if (session.confirmationGrant) headers['X-MXG-Confirmation-Grant'] = session.confirmationGrant;
    const response = await fetch(`${MCP_BASE}/orchestration/cases/first-slice`, {
      method: 'POST',
      headers,
      credentials: 'include',
      signal: session.signal,
      body: JSON.stringify({
        registration: registration.trim(),
        discrepancy: discrepancy.trim(),
        priority,
        include
      })
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      const error = new Error(payload.error?.message || `Case orchestration failed (${response.status})`);
      error.code = payload.error?.code || 'CASE_ORCHESTRATION_FAILED';
      error.details = payload.error || null;
      error.trace = payload.trace || [];
      throw error;
    }
    return {
      caseId: payload.case_id,
      aircraft: payload.aircraft,
      case: payload.case,
      context: payload.context,
      trace: (payload.trace || []).map((entry) => ({
        tool: entry.tool,
        traceId: entry.trace_id || null,
        requestId: entry.request_id || null,
        status: entry.status || 'unknown',
        warnings: entry.warnings || [],
        confidence: entry.confidence || null
      }))
    };
  }

  async function inspectTwinSelection({ aircraftId, caseId, componentId, session = {} }) {
    const [component, documents] = await Promise.all([
      callCapability('mxg.digital_twin.component_state', {
        aircraft_id: aircraftId,
        component_id: componentId,
        case_id: caseId || null
      }, { ...session, confirmationGrant: undefined }),
      callCapability('mxg.digital_twin.link_documents', {
        aircraft_id: aircraftId,
        component_id: componentId,
        model_id: null
      }, { ...session, confirmationGrant: undefined })
    ]);
    return { component, documents };
  }

  function attachTwinMarker({ caseId, componentId, zoneId, severity, observationId, session = {} }) {
    return callCapability('mxg.digital_twin.attach_case_marker', {
      case_id: caseId,
      component_id: componentId || null,
      zone_id: zoneId || null,
      severity,
      observation_id: observationId || null
    }, session);
  }

  function applicableAds({ aircraftId, caseId, session = {} }) {
    return callCapability('mxg.compliance.applicable_ads', {
      aircraft_id: String(aircraftId),
      case_id: caseId || null
    }, { ...session, confirmationGrant: undefined });
  }

  return Object.freeze({
    API_BASE,
    MCP_BASE,
    MCP_PROTOCOL_VERSION,
    aircraftBundle,
    aircraftList,
    bulkAircraft,
    chat,
    companyDetail,
    companyList,
    contactList,
    staticJson,
    caseWorkspace: Object.freeze({
      runFirstSlice: runFirstCaseSlice,
      output: capabilityOutput
    }),
    digitalTwin: Object.freeze({
      inspectSelection: inspectTwinSelection,
      attachMarker: attachTwinMarker
    }),
    compliance: Object.freeze({
      applicableAds
    }),
    realtime: Object.freeze({
      exchangeSdp: exchangeRealtimeSdp
    }),
    confirmations: Object.freeze({
      issue: issueConfirmation
    }),
    capabilities: Object.freeze({
      initialize: initializeCapabilities,
      list: listCapabilities,
      call: callCapability
    })
  });
})();
