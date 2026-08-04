import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SITE = String(process.env.MXGENIUS_SITE_URL || 'https://mxgenius.io').replace(/\/$/, '');
const CORE = String(
  process.env.MXGENIUS_API_URL
    || 'https://mxg-core.kindbush-8fee3a17.centralus.azurecontainerapps.io'
).replace(/\/$/, '');
const FLEET = String(
  process.env.MXGENIUS_FLEET_URL
    || 'https://mxg-fleet.kindbush-8fee3a17.centralus.azurecontainerapps.io'
).replace(/\/$/, '');
const ACCESS_TOKEN = process.env.MXGENIUS_ACCESS_TOKEN || '';
const ORGANIZATION_ID = process.env.MXGENIUS_ORGANIZATION_ID || '';
const PROTOCOL_VERSION = '2025-11-25';
const startedAt = new Date();
const runId = startedAt.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
const results = [];
let rpcSequence = 0;

function bounded(value, limit = 500) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    ...(ORGANIZATION_ID ? { 'X-MXG-Organization-ID': ORGANIZATION_ID } : {}),
    ...extra
  };
}

async function request(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'cache-control': 'no-cache',
      ...(options.headers || {})
    },
    signal: options.signal || AbortSignal.timeout(90_000)
  });
}

async function responseBody(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return response.text();
}

async function check(name, scope, operation) {
  const before = Date.now();
  try {
    const detail = await operation();
    results.push({
      name,
      scope,
      status: detail?.status || 'PASS',
      duration_ms: Date.now() - before,
      detail: detail?.detail || detail || 'Passed'
    });
  } catch (error) {
    results.push({
      name,
      scope,
      status: 'FAIL',
      duration_ms: Date.now() - before,
      detail: error?.message || String(error)
    });
  }
}

function skip(name, scope, detail) {
  results.push({ name, scope, status: 'SKIP', duration_ms: 0, detail });
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function mcp(method, params = {}, { notification = false } = {}) {
  const id = notification ? undefined : `mxg-probe-${Date.now()}-${++rpcSequence}`;
  const response = await request(`${CORE}/mcp`, {
    method: 'POST',
    headers: authHeaders({
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...(method === 'initialize' ? {} : { 'MCP-Protocol-Version': PROTOCOL_VERSION })
    }),
    body: JSON.stringify({
      jsonrpc: '2.0',
      ...(!notification ? { id } : {}),
      method,
      params
    })
  });
  if (notification && response.status === 202) return null;
  const payload = await responseBody(response);
  requireCondition(response.ok, `MCP ${method} failed (${response.status}): ${bounded(payload)}`);
  requireCondition(!payload?.error, `MCP ${method} returned ${bounded(payload.error)}`);
  requireCondition(payload?.id === id, `MCP ${method} response correlation mismatch`);
  return payload.result;
}

let deployedDashboard = '';
let createdThreadId = null;
let structuredResponse = null;
let probeAircraft = null;

await check('Dashboard release assets', 'frontend', async () => {
  const response = await request(`${SITE}/dashboard.html?probe=${encodeURIComponent(runId)}`);
  requireCondition(response.status === 200, `Dashboard returned ${response.status}`);
  deployedDashboard = await response.text();
  for (const marker of [
    'application-client.js?v=18',
    'realtime-client.js?v=4',
    'app.js?v=27',
    'id="chatAttachBtn"',
    'value="gpt-5.5"'
  ]) {
    requireCondition(deployedDashboard.includes(marker), `Missing deployed marker: ${marker}`);
  }
  return { detail: 'Current multimodal, Realtime companion, and model-selector assets are live.' };
});

await check('Realtime companion bundle', 'frontend', async () => {
  const response = await request(`${SITE}/app.js?v=27&probe=${encodeURIComponent(runId)}`);
  requireCondition(response.status === 200, `app.js returned ${response.status}`);
  const source = await response.text();
  for (const marker of [
    'mxg.chat.structured_response',
    'collectApplicationDisplayContext',
    'suppressNextRealtimeAssistantBubble',
    'pendingRealtimeImages'
  ]) {
    requireCondition(source.includes(marker), `Missing companion marker: ${marker}`);
  }
  return { detail: 'Deployed browser bundle contains the unified voice/structured-output lane.' };
});

await check('Core liveness', 'core', async () => {
  const response = await request(`${CORE}/healthz`);
  const body = await response.text();
  requireCondition(response.ok && body.trim() === 'ok', `healthz returned ${response.status}: ${bounded(body)}`);
  return { detail: 'Core reports ok.' };
});

await check('Core readiness', 'core', async () => {
  const response = await request(`${CORE}/readyz`);
  const body = await responseBody(response);
  requireCondition(response.ok, `readyz returned ${response.status}: ${bounded(body)}`);
  requireCondition(body?.ready === true, `Core is not ready: ${bounded(body)}`);
  return { detail: `Database ${body.database}; mode ${body.mode}; ready ${body.ready}.` };
});

await check('Adapter status', 'core', async () => {
  const response = await request(`${CORE}/adapterz`);
  const body = await responseBody(response);
  requireCondition(response.ok, `adapterz returned ${response.status}: ${bounded(body)}`);
  return { detail: bounded(body, 1_200) };
});

await check('Authentication boundary', 'security', async () => {
  const response = await request(`${CORE}/api/threads`);
  requireCondition(
    response.status === 401 || response.status === 403,
    `Unauthenticated thread request unexpectedly returned ${response.status}`
  );
  return { detail: `Unauthenticated tenant data fails closed (${response.status}).` };
});

await check('Fleet authentication boundary', 'security', async () => {
  const response = await request(`${FLEET}/api/Model/getModelIntelligence/LIVE_TOKEN`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ make: ['GULFSTREAM'], model: ['G550'] })
  });
  requireCondition(
    response.status === 401 || response.status === 403,
    `Unauthenticated fleet request unexpectedly returned ${response.status}`
  );
  return { detail: `Licensed fleet data fails closed without MXGenius identity (${response.status}).` };
});

await check('Browser CORS contract', 'security', async () => {
  const response = await request(`${CORE}/chat`, {
    method: 'OPTIONS',
    headers: {
      Origin: SITE,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,x-mxg-organization-id'
    }
  });
  const allowedOrigin = response.headers.get('access-control-allow-origin');
  requireCondition(response.ok, `CORS preflight returned ${response.status}`);
  requireCondition(allowedOrigin === SITE, `CORS allowed origin was ${allowedOrigin || 'missing'}`);
  return { detail: `Authenticated browser requests are allowed from ${allowedOrigin}.` };
});

if (!ACCESS_TOKEN) {
  for (const [name, detail] of [
    ['MCP registry', 'Set MXGENIUS_ACCESS_TOKEN to verify the authenticated 50-tool registry.'],
    ['Authenticated fleet source', 'Set MXGENIUS_ACCESS_TOKEN to verify JetNet through the protected fleet proxy.'],
    ['FAA candidate retrieval', 'Set MXGENIUS_ACCESS_TOKEN to resolve a fleet aircraft and verify the live FAA adapter.'],
    ['Structured chat', 'Set MXGENIUS_ACCESS_TOKEN to create a probe thread and call the selected model.'],
    ['Thread persistence', 'Set MXGENIUS_ACCESS_TOKEN to reopen the structured probe response.'],
    ['Manual retrieval and images', 'Set MXGENIUS_ACCESS_TOKEN to query the RAG corpus and verify returned image assets.'],
    ['Realtime WebRTC', 'A signed-in browser and microphone permission are required for a true WebRTC media probe.']
  ]) {
    skip(name, 'authenticated', detail);
  }
} else {
  await check('Authenticated fleet source', 'authenticated', async () => {
    const response = await request(`${FLEET}/api/Aircraft/getBulkAircraftExportPaged/LIVE_TOKEN/50/1`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ pageSize: 50, pageNumber: 1, make: 'Gulfstream' })
    });
    const payload = await responseBody(response);
    requireCondition(response.ok, `Fleet request failed (${response.status}): ${bounded(payload)}`);
    const aircraft = Array.isArray(payload?.aircraft) ? payload.aircraft : [];
    requireCondition(aircraft.length > 0, `Fleet source returned no aircraft: ${bounded(payload)}`);
    probeAircraft = aircraft.find((item) => item?.regnbr && item?.aircraftid) || aircraft.find((item) => item?.aircraftid) || aircraft[0];
    requireCondition(probeAircraft?.aircraftid || probeAircraft?.regnbr, 'Fleet source returned no usable aircraft identity');
    return { detail: `Protected JetNet proxy returned ${aircraft.length} aircraft for acceptance sampling.` };
  });

  await check('MCP registry', 'authenticated', async () => {
    const initialized = await mcp('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'mxgenius-live-field-probe', version: '0.1.0' }
    });
    requireCondition(initialized?.protocolVersion === PROTOCOL_VERSION, 'MCP protocol version mismatch');
    await mcp('notifications/initialized', {}, { notification: true });
    const listed = await mcp('tools/list');
    requireCondition(Array.isArray(listed?.tools), 'MCP tools/list returned no tools');
    requireCondition(listed.tools.length === 50, `Expected 50 MCP tools; received ${listed.tools.length}`);
    const counts = listed.tools.reduce((summary, tool) => {
      const availability = String(tool.meta?.availability || 'unknown');
      summary[availability] = (summary[availability] || 0) + 1;
      return summary;
    }, {});
    return { detail: `Authenticated MCP returned all 50 typed tools: ${Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(', ')}.` };
  });

  await check('FAA candidate retrieval', 'authenticated', async () => {
    requireCondition(probeAircraft, 'Authenticated fleet sampling did not return an aircraft');
    const lookup = await mcp('tools/call', {
      name: 'mxg.aircraft.lookup',
      arguments: {
        registration: probeAircraft.regnbr || null,
        serial_number: probeAircraft.sernbr || null,
        source_id: probeAircraft.aircraftid == null ? null : String(probeAircraft.aircraftid)
      }
    });
    const aircraftId = lookup?.output?.aircraft_id
      || (Array.isArray(lookup?.output?.matches) && lookup.output.matches.length === 1
        ? lookup.output.matches[0].aircraft_id
        : null);
    requireCondition(aircraftId, `Fleet sample could not be resolved canonically: ${bounded(lookup)}`);
    const faa = await mcp('tools/call', {
      name: 'mxg.compliance.applicable_ads',
      arguments: { aircraft_id: aircraftId, case_id: null }
    });
    requireCondition(!['partial', 'not_configured', 'failed'].includes(String(faa?.status || '').toLowerCase()), `FAA adapter did not complete: ${bounded(faa, 1_200)}`);
    const ads = Array.isArray(faa?.output?.ads) ? faa.output.ads : [];
    return { detail: `FAA DRS completed for ${probeAircraft.regnbr || aircraftId}; ${ads.length} candidate ADs returned.` };
  });

  await check('Structured chat', 'authenticated', async () => {
    const threadResponse = await request(`${CORE}/api/threads`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title: `Field probe ${runId}`, case_id: null })
    });
    const thread = await responseBody(threadResponse);
    requireCondition(threadResponse.ok, `Thread creation failed (${threadResponse.status}): ${bounded(thread)}`);
    createdThreadId = thread.thread?.id || thread.id || thread.thread_id;
    requireCondition(createdThreadId, `Thread creation returned no id: ${bounded(thread)}`);

    const chatResponse = await request(`${CORE}/chat`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        message: 'For a Challenger 350, retrieve applicable manual evidence and any available manual figures for checking hydraulic accumulator pressure. This is a field-test retrieval probe, not maintenance authorization.',
        text_model: 'gpt-5.5',
        images: [],
        thread_id: createdThreadId,
        history: [],
        fleet_signals: [],
        case_context: null,
        display_context: {
          active_tab: 'dashboard',
          probe: true,
          visible_response: null
        }
      })
    });
    const payload = await responseBody(chatResponse);
    requireCondition(chatResponse.ok, `Chat failed (${chatResponse.status}): ${bounded(payload, 1_000)}`);
    structuredResponse = payload.response || payload;
    requireCondition(structuredResponse?.thread_id === createdThreadId, 'Chat did not continue the probe thread');
    requireCondition(structuredResponse?.advisory?.response_kind, 'Chat returned no structured response kind');
    return {
      detail: `Structured ${structuredResponse.advisory.response_kind} returned through thread ${createdThreadId}.`
    };
  });

  await check('Thread persistence', 'authenticated', async () => {
    requireCondition(createdThreadId, 'Structured chat did not create a thread');
    const response = await request(`${CORE}/api/threads/${encodeURIComponent(createdThreadId)}/messages`, {
      headers: authHeaders()
    });
    const payload = await responseBody(response);
    requireCondition(response.ok, `Thread messages failed (${response.status}): ${bounded(payload)}`);
    const messages = payload.messages || [];
    requireCondition(messages.some((message) => message.role === 'user'), 'Persisted thread has no user turn');
    const assistant = messages.find((message) => message.role === 'assistant');
    requireCondition(assistant, 'Persisted thread has no assistant turn');
    requireCondition(
      assistant.payload?.advisory || assistant.payload?.response_kind,
      'Persisted assistant turn lost its structured payload'
    );
    return { detail: `Reopened ${messages.length} persisted messages with structured assistant state.` };
  });

  await check('Manual retrieval and images', 'authenticated', async () => {
    const records = structuredResponse?.manual_records || [];
    requireCondition(records.length > 0, 'Structured response returned no manual records');
    const images = records.flatMap((record) => record.images || []);
    if (!images.length) {
      return {
        status: 'WARN',
        detail: `${records.length} manual records were retrieved, but none of these matches contained an image.`
      };
    }
    const reference = images[0].source_reference
      || images[0].reference
      || images[0].asset_reference
      || images[0].uri;
    requireCondition(reference, `First manual image has no retrievable reference: ${bounded(images[0])}`);
    const response = await request(`${CORE}/manual-assets?reference=${encodeURIComponent(reference)}`, {
      headers: authHeaders()
    });
    requireCondition(response.ok, `Manual image proxy returned ${response.status}`);
    requireCondition(
      (response.headers.get('content-type') || '').startsWith('image/'),
      `Manual asset returned ${response.headers.get('content-type') || 'no content type'}`
    );
    return { detail: `${records.length} manual records returned; a hashed image was retrieved through the core proxy.` };
  });

  skip(
    'Realtime WebRTC',
    'authenticated',
    'HTTP orchestration passed; a signed-in browser and microphone permission are still required for the media handshake and audible-response probe.'
  );
}

if (createdThreadId) {
  await check('Probe cleanup', 'authenticated', async () => {
    const response = await request(`${CORE}/api/threads/${encodeURIComponent(createdThreadId)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    requireCondition(response.ok || response.status === 204, `Probe thread cleanup returned ${response.status}`);
    return { detail: `Archived probe thread ${createdThreadId}.` };
  });
}

const completedAt = new Date();
const counts = results.reduce((summary, result) => {
  summary[result.status] = (summary[result.status] || 0) + 1;
  return summary;
}, {});
const report = {
  run_id: runId,
  started_at: startedAt.toISOString(),
  completed_at: completedAt.toISOString(),
  site: SITE,
  core: CORE,
  fleet: FLEET,
  authenticated: Boolean(ACCESS_TOKEN),
  summary: counts,
  results
};
const reportDirectory = resolve('test-results');
await mkdir(reportDirectory, { recursive: true });
const jsonPath = resolve(reportDirectory, `mxgenius-live-probe-${runId}.json`);
const markdownPath = resolve(reportDirectory, `mxgenius-live-probe-${runId}.md`);
const rows = results.map((result) =>
  `| ${result.status} | ${result.scope} | ${result.name} | ${result.duration_ms} | ${String(result.detail).replaceAll('|', '\\|').replaceAll('\n', ' ')} |`
);
const markdown = `# MXGenius Live Field Probe

- Run: \`${runId}\`
- Site: ${SITE}
- Core: ${CORE}
- Fleet: ${FLEET}
- Authenticated: ${Boolean(ACCESS_TOKEN)}
- Summary: ${Object.entries(counts).map(([status, count]) => `${status} ${count}`).join(', ')}

| Status | Scope | Check | ms | Detail |
|---|---|---|---:|---|
${rows.join('\n')}
`;
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(markdownPath, markdown, 'utf8');

console.log(markdown);
console.log(`JSON report: ${jsonPath}`);
console.log(`Markdown report: ${markdownPath}`);
process.exitCode = (counts.FAIL || 0) > 0 ? 1 : 0;
