/**
 * MXGenius application compatibility client.
 *
 * This is the single browser-side boundary for the current REST/static
 * application sources. It deliberately exposes compatibility DTOs, not the
 * canonical MCP/domain contracts. The post-MCP mount will replace the
 * implementation behind this boundary without rewriting workspace views.
 */
const MXApplicationClient = (() => {
  const MCP_PROTOCOL_VERSION = '2025-11-25';
  const runtimeConfig = globalThis.MXGENIUS_CONFIG || {};
  const MCP_BASE = String(runtimeConfig.mcpBase || '').replace(/\/$/, '');
  const FLEET_API_BASE = String(runtimeConfig.fleetBase || '').replace(/\/$/, '');
  let rpcSequence = 0;

  function compatibilitySession() {
    return globalThis.MXGENIUS_CONFIG?.getSession?.() || {};
  }

  async function fleetRequestJson(path, options = {}) {
    const response = await fetch(`${FLEET_API_BASE}${path}`, options);
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data?.error?.message || data?.responsestatus || `Fleet source failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return { response, data };
  }

  function jetNetHeaders(bearer) {
    const session = compatibilitySession();
    const accessToken = bearer || session.accessToken;
    if (!accessToken) throw new Error('Authenticated application session required');
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    };
    if (session.organizationId) headers['X-MXG-Organization-ID'] = session.organizationId;
    headers['X-Correlation-ID'] = session.correlationId || globalThis.crypto?.randomUUID?.() || `fleet-${Date.now()}`;
    return headers;
  }

  async function jetNetJson(path, { bearer, method = 'GET', body } = {}) {
    const options = {
      method: method === 'PUT' ? 'POST' : method,
      headers: jetNetHeaders(bearer)
    };
    if (body !== undefined) options.body = JSON.stringify(body);
    return (await fleetRequestJson(`/api/${path}`, options)).data;
  }

  async function bulkAircraft({ token, bearer, pageSize = 5000, page = 1, cacheTtl }) {
    const path = `/api/Aircraft/getBulkAircraftExportPaged/${token}/${pageSize}/${page}`;
    return MXCache.cachedFetch(
      `${FLEET_API_BASE}${path}`,
      { method: 'POST', headers: jetNetHeaders(bearer), body: JSON.stringify({ pageSize }) },
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

    const [aircraft, pictures, engines, features, equipment, leases, status] = await Promise.all([
      jetNetJson(`Aircraft/getAircraft/${id}/${token}`),
      safeJson(jetNetJson(`Aircraft/getPictures/${id}/${token}`)),
      safeJson(jetNetJson(`Engines/getEnginesByAircraft/${id}/${token}`)),
      safeJson(jetNetJson(`Aircraft/getFeatures/${id}/${token}`)),
      safeJson(jetNetJson(`Aircraft/getAdditionalEquipment/${id}/${token}`)),
      safeJson(jetNetJson(`Aircraft/getLeases/${id}/${token}`)),
      safeJson(jetNetJson(`Aircraft/getStatus/${id}/${token}`)),
    ]);

    return { aircraft, pictures, engines, features, equipment, leases, status };
  }

  function aircraftImageUrl(sourceUrl) {
    let parsed;
    try { parsed = new URL(String(sourceUrl || '')); } catch { return ''; }
    if (parsed.protocol !== 'https:') return '';
    return `${FLEET_API_BASE}/api/image?url=${encodeURIComponent(parsed.href)}`;
  }

  async function aircraftImageBlobUrl(sourceUrl, { bearer } = {}) {
    const path = aircraftImageUrl(sourceUrl);
    if (!path) return '';
    const response = await fetch(path, { headers: jetNetHeaders(bearer) });
    if (!response.ok) throw new Error(`Fleet image failed (${response.status})`);
    return URL.createObjectURL(await response.blob());
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

  const CHAT_FLEET_SIGNAL_LIMIT = 50;

  function compactFleetSignal(record) {
    const value = record && typeof record === 'object' ? record : {};
    const mro = value.mro && typeof value.mro === 'object' ? value.mro : {};
    return {
      aircraft_id: value.aircraftid ?? value.aircraft_id ?? null,
      registration: value.regnbr ?? value.registration ?? null,
      serial_number: value.sernbr ?? value.serial_number ?? null,
      make: value.make ?? null,
      model: value.model ?? null,
      aircraft_type: value.maketype ?? value.aircraft_type ?? null,
      year: value.yearmfg ?? value.yearmfr ?? value.year ?? null,
      base_icao: value.baseicao ?? value.baseicaocode ?? null,
      base_city: value.basecity ?? value.acbasecity ?? null,
      base_country: value.basecountry ?? null,
      lifecycle: value.lifecycle ?? null,
      reported_aftt: mro.aftt ?? value.aftt ?? value.estaftt ?? value.airfrmtt ?? null,
      for_sale: mro.isForSale ?? value.forsale ?? null,
      reported_aog: mro.isAOG ?? null
    };
  }

  function chatFleetSignals(message, fleetSignals) {
    if (!Array.isArray(fleetSignals) || !fleetSignals.length) return [];
    const text = String(message || '');
    const asksForFleetContext = /\b(fleet|aircraft|airplane|tail|registration|serial|aftt|cycles?|aog|for[ -]?sale|base|operator|owner)\b/i.test(text)
      || /\bN[0-9A-Z]{2,6}\b/i.test(text)
      || /\b(?:GL|G|CL|CRJ|ERJ|B|A|FALCON)[ -]?\d{2,4}[A-Z-]*\b/i.test(text);
    if (!asksForFleetContext) return [];

    const terms = (text.toUpperCase().match(/[A-Z0-9-]{3,}/g) || [])
      .filter((term) => !['THE', 'AND', 'AIRCRAFT', 'AIRPLANE', 'FLEET'].includes(term));
    return fleetSignals
      .map((record, index) => {
        const compact = compactFleetSignal(record);
        const searchable = Object.values(compact).filter((value) => value != null).join(' ').toUpperCase();
        const termScore = terms.reduce((score, term) => score + (searchable.includes(term) ? 10 : 0), 0);
        const attentionScore = compact.reported_aog ? 2 : compact.for_sale ? 1 : 0;
        return { compact, index, score: termScore + attentionScore };
      })
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, CHAT_FLEET_SIGNAL_LIMIT)
      .map(({ compact }) => compact);
  }

  function applicationHeaders(session = {}, contentType = 'application/json') {
    if (!session.accessToken && !runtimeConfig.allowInsecurePilot) {
      throw new Error('Authenticated application session required');
    }
    const headers = { 'Authorization': `Bearer ${session.accessToken}` };
    if (contentType) headers['Content-Type'] = contentType;
    if (session.organizationId) headers['X-MXG-Organization-ID'] = session.organizationId;
    if (session.correlationId) headers['X-Correlation-ID'] = session.correlationId;
    return headers;
  }

  async function applicationRequest(path, {
    session = {},
    method = 'GET',
    body,
    contentType = 'application/json',
    headers: extraHeaders = {}
  } = {}) {
    const response = await fetch(`${MCP_BASE}${path}`, {
      method,
      headers: { ...applicationHeaders(session, contentType), ...extraHeaders },
      credentials: 'include',
      signal: session.signal,
      body: body === undefined ? undefined : (contentType === 'application/json' ? JSON.stringify(body) : body)
    });
    if (!response.ok) {
      const responseType = response.headers.get('content-type') || '';
      const payload = responseType.includes('application/json')
        ? await response.json()
        : { error: { message: await response.text() } };
      const error = new Error(payload.error?.message || `Application request failed (${response.status})`);
      error.code = payload.error?.code || 'APPLICATION_REQUEST_FAILED';
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    return response;
  }

  async function applicationJson(path, options) {
    return (await applicationRequest(path, options)).json();
  }

  function chat({ message, images = [], textModel, threadId, history = [], fleetSignals, caseContext, aircraftContext, displayContext, accessToken, organizationId, correlationId, signal }) {
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
      signal,
      body: JSON.stringify({
        message,
        text_model: textModel || null,
        images: Array.isArray(images) ? images.slice(0, 4).map((image) => ({
          name: String(image.name || 'image').slice(0, 160),
          data_url: image.dataUrl || image.data_url,
          detail: image.detail || 'auto'
        })) : [],
        thread_id: threadId || null,
        history: Array.isArray(history) ? history.slice(-12) : [],
        fleet_signals: chatFleetSignals(message, fleetSignals),
        case_context: caseContext || null,
        aircraft_context: aircraftContext || null,
        display_context: displayContext || null
      })
    });
  }

  function listCases(session = {}) {
    return applicationJson('/api/cases', { session });
  }

  function getCase(caseId, session = {}) {
    return applicationJson(`/api/cases/${encodeURIComponent(caseId)}`, { session });
  }

  function listThreads(session = {}) {
    return applicationJson('/api/threads', { session });
  }

  function createThread({ title, caseId, session = {} } = {}) {
    return applicationJson('/api/threads', {
      session,
      method: 'POST',
      body: { title: title || null, case_id: caseId || null }
    });
  }

  function getThread(threadId, session = {}) {
    return applicationJson(`/api/threads/${encodeURIComponent(threadId)}`, { session });
  }

  function updateThread(threadId, changes, session = {}) {
    return applicationJson(`/api/threads/${encodeURIComponent(threadId)}`, {
      session,
      method: 'PATCH',
      body: {
        title: changes?.title ?? null,
        status: changes?.status ?? null
      }
    });
  }

  function archiveThread(threadId, session = {}) {
    return applicationJson(`/api/threads/${encodeURIComponent(threadId)}`, {
      session,
      method: 'DELETE'
    });
  }

  function listThreadMessages(threadId, session = {}) {
    return applicationJson(`/api/threads/${encodeURIComponent(threadId)}/messages`, { session });
  }

  function listChatModels(session = {}) {
    return applicationJson('/api/chat/models', { session });
  }

  function persistThreadExchange({ threadId, caseId, userContent, assistantContent, session = {} }) {
    return applicationJson('/api/thread-exchanges', {
      session,
      method: 'POST',
      body: {
        thread_id: threadId || null,
        case_id: caseId || null,
        user_content: userContent,
        assistant_content: assistantContent
      }
    });
  }

  function getProfile(session = {}) {
    return applicationJson('/api/profile', { session });
  }

  function updateProfile(profile, session = {}) {
    return applicationJson('/api/profile', {
      session,
      method: 'PATCH',
      body: {
        display_name: profile?.displayName ?? null,
        timezone: profile?.timezone ?? null,
        settings: profile?.settings || {}
      }
    });
  }

  async function getProfileImage(session = {}) {
    return (await applicationRequest('/api/profile/image', {
      session,
      contentType: null
    })).blob();
  }

  function putProfileImage(file, session = {}) {
    if (!(file instanceof Blob)) throw new TypeError('Profile image must be a Blob or File');
    return applicationJson('/api/profile/image', {
      session,
      method: 'PUT',
      body: file,
      contentType: file.type
    });
  }

  function deleteProfileImage(session = {}) {
    return applicationRequest('/api/profile/image', {
      session,
      method: 'DELETE',
      contentType: null
    });
  }

  function listBetaAccess(session = {}) {
    return applicationJson('/api/beta-access', { session });
  }

  function addBetaAccess(rule, session = {}) {
    return applicationJson('/api/beta-access', {
      session,
      method: 'POST',
      body: { rule }
    });
  }

  function deleteBetaAccess(ruleId, session = {}) {
    return applicationRequest(`/api/beta-access/${encodeURIComponent(ruleId)}`, {
      session,
      method: 'DELETE',
      contentType: null
    });
  }

  function uploadContent(file, session = {}) {
    if (!(file instanceof Blob)) throw new TypeError('Content upload must be a Blob or File');
    const filename = String(file.name || 'uploaded-content').slice(0, 180);
    return applicationJson(`/api/content/uploads?filename=${encodeURIComponent(filename)}`, {
      session,
      method: 'POST',
      body: file,
      contentType: file.type || 'application/octet-stream'
    });
  }

  function loadDemoData(session = {}) {
    return applicationJson('/api/demo-data', {
      session,
      method: 'POST',
      body: { confirm: 'LOAD_DEMO_DATA' }
    });
  }

  function getProjectWorkspace(workspaceKey, session = {}) {
    return applicationJson(`/api/project-workspaces/${encodeURIComponent(workspaceKey)}`, { session });
  }

  function saveProjectWorkspace(workspaceKey, workspace, session = {}) {
    return applicationJson(`/api/project-workspaces/${encodeURIComponent(workspaceKey)}`, {
      session,
      method: 'PUT',
      body: {
        title: workspace?.title,
        status: workspace?.status,
        expected_version: Number(workspace?.expectedVersion || 0),
        document: workspace?.document || {}
      }
    });
  }

  function uploadProjectWorkspaceAsset(workspaceKey, file, { section = 'general', note = '', session = {} } = {}) {
    if (!(file instanceof Blob)) throw new TypeError('Workspace reference must be a Blob or File');
    const filename = String(file.name || 'workspace-reference').slice(0, 180);
    const query = new URLSearchParams({
      filename,
      section: String(section || 'general').slice(0, 64)
    });
    if (note) query.set('note', String(note).slice(0, 1000));
    return applicationJson(`/api/project-workspaces/${encodeURIComponent(workspaceKey)}/assets?${query}`, {
      session,
      method: 'POST',
      body: file,
      contentType: file.type || 'application/octet-stream'
    });
  }

  async function getProjectWorkspaceAsset(workspaceKey, assetId, session = {}) {
    return (await applicationRequest(
      `/api/project-workspaces/${encodeURIComponent(workspaceKey)}/assets/${encodeURIComponent(assetId)}/content`,
      { session, contentType: null }
    )).blob();
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

  function manualAssetUrl(reference) {
    if (typeof reference !== 'string' || !reference.startsWith('azure-blob://documents/manual-assets/legacy-rag/')) {
      return '';
    }
    return `${MCP_BASE}/manual-assets?reference=${encodeURIComponent(reference)}`;
  }

  async function mcpRequest(method, params = {}, options = {}) {
    const notification = options.notification === true;
    const id = notification ? undefined : (options.id ?? `mxg-web-${Date.now()}-${++rpcSequence}`);
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

    const timeoutController = !options.signal && typeof AbortController !== 'undefined'
      ? new AbortController()
      : null;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30_000;
    const timeout = timeoutController
      ? setTimeout(() => timeoutController.abort(), timeoutMs)
      : null;
    let response;
    try {
      response = await fetch(`${MCP_BASE}/mcp`, {
        method: 'POST',
        headers,
        credentials: 'include',
        signal: options.signal || timeoutController?.signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          ...(!notification ? { id } : {}),
          method,
          params
        })
      });
    } catch (cause) {
      const error = new Error(cause?.name === 'AbortError' ? 'MCP request timed out or was cancelled' : 'MCP request failed');
      error.code = cause?.name === 'AbortError' ? 'MCP_REQUEST_TIMEOUT' : 'MCP_TRANSPORT_FAILED';
      error.cause = cause;
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    if (response.status === 202) {
      if (!notification) throw new Error('MCP request unexpectedly returned no response');
      return null;
    }

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
    if (!notification && payload.id !== id) throw new Error('MCP response correlation ID mismatch');
    return payload.result;
  }

  const capabilityConnections = new Map();

  function capabilityConnectionKey(options = {}) {
    return [
      MCP_BASE,
      options.organizationId || '',
      options.accessToken || 'cookie-session'
    ].join('|');
  }

  function initializeCapabilities(options = {}) {
    return mcpRequest('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'mxgenius-dashboard', version: '0.1.0' }
    }, options);
  }

  async function connectCapabilities(options = {}) {
    const key = capabilityConnectionKey(options);
    if (capabilityConnections.has(key)) return capabilityConnections.get(key);
    const lifecycleOptions = { ...options, confirmationGrant: undefined };
    const connection = (async () => {
      const initialized = await initializeCapabilities(lifecycleOptions);
      if (initialized?.protocolVersion !== MCP_PROTOCOL_VERSION) {
        const error = new Error(`MCP protocol mismatch: expected ${MCP_PROTOCOL_VERSION}`);
        error.code = 'MCP_PROTOCOL_MISMATCH';
        throw error;
      }
      if (!initialized?.capabilities?.tools) {
        const error = new Error('MCP server did not advertise tool capabilities');
        error.code = 'MCP_TOOLS_UNAVAILABLE';
        throw error;
      }
      await mcpRequest('notifications/initialized', {}, { ...lifecycleOptions, notification: true });
      return initialized;
    })();
    capabilityConnections.set(key, connection);
    try {
      return await connection;
    } catch (error) {
      capabilityConnections.delete(key);
      throw error;
    }
  }

  function disconnectCapabilities(options = {}) {
    capabilityConnections.delete(capabilityConnectionKey(options));
  }

  async function listCapabilities(options = {}) {
    await connectCapabilities(options);
    return mcpRequest('tools/list', {}, options);
  }

  async function callCapability(name, args = {}, options = {}) {
    if (!/^mxg\.[a-z_]+\.[a-z_]+$/.test(name)) {
      throw new TypeError(`Invalid MXGenius capability name: ${name}`);
    }
    await connectCapabilities(options);
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

  function listTwinModels(session = {}) {
    return applicationJson('/api/digital-twin/models', { session });
  }

  function uploadTwinModel({ file, name, revision = '1', lod = 'uploaded', applicableAircraft = [], session = {} }) {
    if (!(file instanceof Blob)) throw new Error('A GLB file is required');
    const query = new URLSearchParams({
      name: String(name || 'Uploaded model'),
      revision: String(revision || '1'),
      lod: String(lod || 'uploaded'),
      applicable_aircraft: applicableAircraft.map(String).join(',')
    });
    return applicationJson(`/api/digital-twin/models?${query}`, {
      session,
      method: 'POST',
      body: file,
      contentType: 'model/gltf-binary'
    });
  }

  async function twinModelContent(modelId, session = {}) {
    const response = await applicationRequest(
      `/api/digital-twin/models/${encodeURIComponent(modelId)}/content`,
      { session, contentType: null }
    );
    return response.arrayBuffer();
  }

  function saveTwinHighlight({ modelId, meshId, meshPath, componentId, zoneId, session = {} }) {
    return applicationJson('/api/digital-twin/highlight', {
      session,
      method: 'PUT',
      body: {
        model_id: modelId,
        mesh_id: meshId,
        mesh_path: meshPath || null,
        component_id: componentId || null,
        zone_id: zoneId || null
      }
    });
  }

  function currentTwinHighlight(session = {}) {
    return applicationJson('/api/digital-twin/highlight', { session });
  }

  function highlightTwinZone({ modelId, meshId, meshPath, componentId, zoneId, session = {} }) {
    return callCapability('mxg.digital_twin.highlight_zone', {
      model_id: modelId,
      mesh_id: meshId || null,
      mesh_path: meshPath || null,
      component_id: componentId || null,
      zone_id: zoneId || null,
      read_current: false
    }, { ...session, confirmationGrant: undefined });
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

  function lookupAircraft({ registration, serial, sourceId, session = {} }) {
    return callCapability('mxg.aircraft.lookup', {
      registration: registration || null,
      serial_number: serial || null,
      source_id: sourceId == null ? null : String(sourceId)
    }, { ...session, confirmationGrant: undefined });
  }

  function modelIntelligence({ token, bearer, make = [], model = [] }) {
    return jetNetJson(`Model/getModelIntelligence/${token}`, {
      bearer,
      method: 'PUT',
      body: {
        make: Array.isArray(make) ? make : [make],
        model: Array.isArray(model) ? model : [model]
      }
    });
  }

  const parts = Object.freeze({
    search: async ({ query, status, location, session = {} } = {}) => {
      const params = new URLSearchParams();
      if (query) params.set('query', query);
      if (status) params.set('status', status);
      if (location) params.set('location', location);
      const payload = await applicationJson(`/api/parts?${params}`, { session });
      return payload.units || [];
    },
    getUnit: async ({ unitId, session = {} }) => {
      return applicationJson(`/api/parts/units/${encodeURIComponent(unitId)}`, { session });
    },
    createReceivingDraft: async ({ partId = null, session = {} } = {}) => {
      const payload = await applicationJson('/api/parts/receiving-drafts', {
        session,
        method: 'POST',
        body: { partId }
      });
      return payload.draft;
    },
    registerAssetUpload: async ({ draftId, kind, file, sha256, session = {} }) => {
      return applicationJson(`/api/parts/receiving-drafts/${encodeURIComponent(draftId)}/assets`, {
        session,
        method: 'POST',
        body: {
          kind,
          originalFilename: file.name,
          mediaType: file.type,
          byteSize: file.size,
          sha256
        }
      });
    },
    uploadAsset: async ({ assetId, file, session = {} }) => {
      return applicationJson(`/api/parts/assets/${encodeURIComponent(assetId)}/content`, {
        session,
        method: 'PUT',
        body: file,
        contentType: file.type
      });
    },
    downloadAsset: async ({ assetId, session = {} }) => {
      return (await applicationRequest(`/api/parts/assets/${encodeURIComponent(assetId)}/content`, {
        session,
        contentType: null
      })).blob();
    },
    requestExtraction: async ({ assetId, session = {} }) => {
      return applicationJson(`/api/parts/assets/${encodeURIComponent(assetId)}/extractions`, {
        session,
        method: 'POST',
        body: {}
      });
    },
    reviewExtraction: async ({ runId, decisions, session = {} }) => {
      return applicationJson(`/api/parts/extractions/${encodeURIComponent(runId)}/reviews`, {
        session,
        method: 'POST',
        body: { decisions }
      });
    },
    confirmReceiving: async ({ draftId, version, values, idempotencyKey, session = {} }) => {
      const confirmation = await issueConfirmation({
        toolName: 'mxg.parts.receive',
        arguments: { draft_id: draftId, expected_version: version },
        session
      });
      const payload = await applicationJson(`/api/parts/receiving-drafts/${encodeURIComponent(draftId)}/confirm`, {
        session,
        method: 'POST',
        body: values,
        headers: {
          'Idempotency-Key': idempotencyKey,
          'If-Match': `"${version}"`,
          'X-MXG-Confirmation-Grant': confirmation.token
        }
      });
      return payload.unit;
    },
    listDocuments: async ({ unitId, session = {} }) => {
      const payload = await applicationJson(`/api/parts/units/${encodeURIComponent(unitId)}/assets`, { session });
      return payload.assets || [];
    },
    listTransactions: async ({ unitId, session = {} }) => {
      const payload = await applicationJson(`/api/parts/units/${encodeURIComponent(unitId)}/events`, { session });
      return payload.events || [];
    },
    getFaaCandidates: async ({ unitId, session = {} }) => {
      return applicationJson(`/api/parts/units/${encodeURIComponent(unitId)}/faa-candidates`, { session });
    },
    getLabel: async ({ unitId, session = {} }) => {
      return applicationJson(`/api/parts/units/${encodeURIComponent(unitId)}/label`, { session });
    },
  });

  return Object.freeze({

    parts,
    MCP_BASE,
    MCP_PROTOCOL_VERSION,
    aircraftBundle,
    aircraftImageBlobUrl,
    aircraftImageUrl,
    aircraftList,
    aircraft: Object.freeze({
      lookup: lookupAircraft
    }),
    bulkAircraft,
    chat,
    chatModels: Object.freeze({
      list: listChatModels
    }),
    cases: Object.freeze({
      list: listCases,
      get: getCase
    }),
    threads: Object.freeze({
      list: listThreads,
      create: createThread,
      get: getThread,
      update: updateThread,
      archive: archiveThread,
      messages: listThreadMessages,
      persistExchange: persistThreadExchange
    }),
    profile: Object.freeze({
      get: getProfile,
      update: updateProfile,
      getImage: getProfileImage,
      putImage: putProfileImage,
      deleteImage: deleteProfileImage
    }),
    content: Object.freeze({
      upload: uploadContent
    }),
    projectWorkspaces: Object.freeze({
      get: getProjectWorkspace,
      save: saveProjectWorkspace,
      uploadAsset: uploadProjectWorkspaceAsset,
      getAsset: getProjectWorkspaceAsset
    }),
    demoData: Object.freeze({
      load: loadDemoData
    }),
    betaAccess: Object.freeze({
      list: listBetaAccess,
      add: addBetaAccess,
      delete: deleteBetaAccess
    }),
    companyDetail,
    companyList,
    contactList,
    modelIntelligence,
    staticJson,
    caseWorkspace: Object.freeze({
      runFirstSlice: runFirstCaseSlice,
      output: capabilityOutput
    }),
    digitalTwin: Object.freeze({
      listModels: listTwinModels,
      uploadModel: uploadTwinModel,
      modelContent: twinModelContent,
      saveHighlight: saveTwinHighlight,
      currentHighlight: currentTwinHighlight,
      highlight: highlightTwinZone,
      inspectSelection: inspectTwinSelection,
      attachMarker: attachTwinMarker
    }),
    compliance: Object.freeze({
      applicableAds
    }),
    evidence: Object.freeze({
      manualAssetUrl
    }),
    realtime: Object.freeze({
      exchangeSdp: exchangeRealtimeSdp
    }),
    confirmations: Object.freeze({
      issue: issueConfirmation
    }),
    capabilities: Object.freeze({
      initialize: initializeCapabilities,
      connect: connectCapabilities,
      disconnect: disconnectCapabilities,
      list: listCapabilities,
      call: callCapability
    })
  });
})();

globalThis.MXApplicationClient = MXApplicationClient;
