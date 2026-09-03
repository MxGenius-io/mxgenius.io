import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../application-client.js', import.meta.url), 'utf8');

function harness(outputs, orchestration = null) {
  const requests = [];
  const context = {
    Date,
    Object,
    String,
    TypeError,
    Error,
    Blob,
    URL,
    URLSearchParams,
    MXGENIUS_CONFIG: {
      mcpBase: '',
      fleetBase: '',
      getSession: () => ({
        accessToken: 'fleet-access-token',
        organizationId: 'fleet-org'
      })
    },
    globalThis: null,
    fetch: async (url, options) => {
      if (url.endsWith('/realtime/calls')) {
        requests.push({ url, options, request: options.body });
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => ({
            'content-type': 'application/sdp',
            'x-mxg-realtime-call-id': 'rtc-test',
            'x-correlation-id': 'correlation-server'
          }[name.toLowerCase()] || null) },
          text: async () => 'v=0\r\no=answer'
        };
      }
      if (url.endsWith('/confirmations')) {
        const request = JSON.parse(options.body);
        requests.push({ url, options, request });
        return {
          ok: true,
          status: 201,
          headers: { get: () => 'application/json' },
          json: async () => ({
            token: 'single-use-grant',
            tool_name: request.tool_name,
            // Mirrors the server's own fallback: a create has no case to bind to,
            // so the grant binds to the aircraft instead.
            object_id: request.arguments.case_id ?? request.arguments.aircraft_id,
            object_version: request.arguments.expected_version
          })
        };
      }
      if (url.includes('/api/')) {
        const request = options.body && typeof options.body === 'string'
          ? JSON.parse(options.body)
          : options.body;
        requests.push({ url, options, request });
        const responsePayload = url.includes('/api/content/uploads')
          ? { source_reference: 'azure-blob://documents/content-uploads/org-1/headset.jpg' }
          : { ok: true, request };
        return {
          ok: true,
          status: options.method === 'DELETE' ? 204 : 200,
          headers: { get: () => 'application/json' },
          json: async () => responsePayload,
          arrayBuffer: async () => new TextEncoder().encode('glTF-test').buffer,
          blob: async () => new Blob(['workspace-asset'], { type: 'application/pdf' }),
          text: async () => ''
        };
      }
      const request = JSON.parse(options.body);
      requests.push({ url, options, request });
      if (request.method === 'initialize') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              protocolVersion: '2025-11-25',
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: 'mxgenius-mcp', version: '0.1.0' }
            }
          })
        };
      }
      if (request.method === 'notifications/initialized') {
        return {
          ok: true,
          status: 202,
          headers: { get: () => null }
        };
      }
      if (request.method === 'tools/list') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            jsonrpc: '2.0',
            id: request.id,
            result: { tools: [] }
          })
        };
      }
      if (url.endsWith('/orchestration/cases/first-slice')) {
        const status = orchestration?.status || 200;
        const payload = orchestration?.payload || {};
        return {
          ok: status >= 200 && status < 300,
          status,
          headers: { get: () => 'application/json' },
          json: async () => payload
        };
      }
      const output = outputs[request.params?.name] || {};
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            status: 'success',
            output,
            errors: [],
            warnings: [],
            trace_id: `trace-${requests.length}`,
            request_id: `request-${requests.length}`
          }
        })
      };
    }
  };
  context.globalThis = context;
  vm.runInNewContext(`${source}\n;globalThis.client = MXApplicationClient;`, context);
  return { client: context.client, requests };
}

test('first case slice uses one authenticated backend orchestration request', async () => {
  const { client, requests } = harness({}, { payload: {
    case_id: 'case-1',
    aircraft: { aircraft_id: 'aircraft:1', matches: [{ aircraft_id: 'aircraft:1', registration: 'N12345' }] },
    case: { case_id: 'case-1', version: 1 },
    context: { timeline: [], documents: [], evidence_map: [], unresolved_conflicts: [] },
    trace: [
      { tool: 'mxg.aircraft.lookup', status: 'ok', trace_id: 'trace-1' },
      { tool: 'mxg.maintenance_case.create', status: 'ok', trace_id: 'trace-2' },
      { tool: 'mxg.maintenance_case.get', status: 'ok', trace_id: 'trace-3' },
      { tool: 'mxg.maintenance_case.build_context', status: 'ok', trace_id: 'trace-4' }
    ]
  }});

  const result = await client.caseWorkspace.runFirstSlice({
    registration: ' N12345 ',
    discrepancy: ' hydraulic pressure low ',
    session: {
      accessToken: 'access-token',
      organizationId: '11111111-1111-1111-1111-111111111111',
      correlationId: '22222222-2222-2222-2222-222222222222',
      confirmationGrant: 'single-use-grant'
    }
  });

  assert.equal(result.caseId, 'case-1');
  assert.equal(result.aircraft.matches[0].registration, 'N12345');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].request.registration, 'N12345');
  assert.equal(requests[0].request.discrepancy, 'hydraulic pressure low');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer access-token');
  assert.equal(requests[0].options.headers['X-MXG-Organization-ID'], '11111111-1111-1111-1111-111111111111');
  assert.equal(requests[0].options.headers['X-Correlation-ID'], '22222222-2222-2222-2222-222222222222');
  assert.equal(requests[0].options.headers['X-MXG-Confirmation-Grant'], 'single-use-grant');
  assert.equal(result.trace.length, 4);
});

test('first case slice mints an aircraft-bound confirmation grant when the caller has none', async () => {
  const { client, requests } = harness({
    'mxg.aircraft.lookup': {
      aircraft_id: 'aircraft:1',
      matches: [{ aircraft_id: 'aircraft:1', registration: 'N12345' }]
    }
  }, { payload: {
    case_id: 'case-1',
    aircraft: { aircraft_id: 'aircraft:1', matches: [] },
    case: { case_id: 'case-1', version: 1 },
    context: { timeline: [], documents: [], evidence_map: [], unresolved_conflicts: [] },
    trace: []
  }});

  const result = await client.caseWorkspace.runFirstSlice({
    registration: ' N12345 ',
    discrepancy: 'hydraulic pressure low',
    // No confirmationGrant: this is what the signed-in dashboard actually sends.
    session: { accessToken: 'access-token', organizationId: 'org-1' }
  });

  assert.equal(result.caseId, 'case-1');

  const confirmation = requests.find((entry) => entry.url.endsWith('/confirmations'));
  assert.ok(confirmation, 'a confirmation grant must be requested');
  assert.equal(confirmation.request.tool_name, 'mxg.maintenance_case.create');
  assert.equal(confirmation.request.arguments.aircraft_id, 'aircraft:1');

  const slice = requests.find((entry) => entry.url.endsWith('/orchestration/cases/first-slice'));
  assert.equal(slice.options.headers['X-MXG-Confirmation-Grant'], 'single-use-grant');
});

test('first case slice needs no grant when no application session is signed in', async () => {
  const { client, requests } = harness({}, { payload: {
    case_id: 'case-1',
    aircraft: { aircraft_id: 'aircraft:1', matches: [] },
    case: { case_id: 'case-1', version: 1 },
    context: { timeline: [], documents: [], evidence_map: [], unresolved_conflicts: [] },
    trace: []
  }});

  await client.caseWorkspace.runFirstSlice({ registration: 'N12345', discrepancy: 'test' });

  // An insecure local server carries its own trusted confirmation; asking it for
  // a grant it does not issue would fail the call for no reason.
  assert.equal(requests.filter((entry) => entry.url.endsWith('/confirmations')).length, 0);
  assert.equal(requests.length, 1);
});

test('first case slice reports an unresolvable registration before it mints a grant', async () => {
  const { client, requests } = harness({ 'mxg.aircraft.lookup': { matches: [] } });

  await assert.rejects(
    client.caseWorkspace.runFirstSlice({
      registration: 'N00000',
      discrepancy: 'test',
      session: { accessToken: 'access-token' }
    }),
    (error) => error.code === 'AIRCRAFT_NOT_FOUND'
  );
  assert.equal(requests.filter((entry) => entry.url.endsWith('/confirmations')).length, 0);
  assert.equal(requests.filter((entry) => entry.url.includes('first-slice')).length, 0);
});

test('first case slice stops before mutation when aircraft resolution is ambiguous', async () => {
  const { client, requests } = harness({}, {
    status: 422,
    payload: { error: { code: 'AIRCRAFT_AMBIGUOUS', message: 'aircraft could not be resolved unambiguously' } }
  });
  await assert.rejects(
    client.caseWorkspace.runFirstSlice({ registration: 'N12345', discrepancy: 'test' }),
    (error) => error.code === 'AIRCRAFT_AMBIGUOUS'
  );
  assert.equal(requests.length, 1);
});

test('model intelligence uses the subscribed catalog endpoint and array filters', async () => {
  const { client, requests } = harness({});

  await client.modelIntelligence({
    token: 'LIVE_TOKEN',
    make: 'GULFSTREAM',
    model: 'G550'
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/Model/getModelIntelligence/LIVE_TOKEN');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer fleet-access-token');
  assert.equal(requests[0].options.headers['X-MXG-Organization-ID'], 'fleet-org');
  assert.deepEqual(requests[0].request, {
    make: ['GULFSTREAM'],
    model: ['G550']
  });
});

test('demo workspace loader uses the authenticated tenant endpoint and exact confirmation', async () => {
  const { client, requests } = harness({});
  await client.demoData.load({
    accessToken: 'admin-token',
    organizationId: 'demo-org',
    correlationId: 'demo-correlation'
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/demo-data');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer admin-token');
  assert.equal(requests[0].options.headers['X-MXG-Organization-ID'], 'demo-org');
  assert.deepEqual(requests[0].request, { confirm: 'LOAD_DEMO_DATA' });
});

test('chat uses application identity and carries canonical case context without a browser API key', async () => {
  const { client, requests } = harness({});
  assert.throws(
    () => client.chat({ message: 'status', fleetSignals: [] }),
    /Authenticated application session required/
  );
  await client.chat({
    message: 'status',
    threadId: 'thread-1',
    fleetSignals: [],
    caseContext: { case_id: 'case-1', version: 3 },
    aircraftContext: { registration: 'N350MX', source_id: 'jetnet-350' },
    displayContext: { active_tab: 'case', visible_response: { advisory_title: 'Hydraulic review' } },
    accessToken: 'oidc-token',
    organizationId: 'org-1',
    correlationId: 'correlation-1'
  });
  assert.equal(requests[0].options.headers.Authorization, 'Bearer oidc-token');
  assert.equal(requests[0].options.headers['X-MXG-Organization-ID'], 'org-1');
  assert.equal(requests[0].request.case_context.case_id, 'case-1');
  assert.equal(requests[0].request.case_context.version, 3);
  assert.equal(requests[0].request.aircraft_context.registration, 'N350MX');
  assert.equal(requests[0].request.aircraft_context.source_id, 'jetnet-350');
  assert.equal(requests[0].request.display_context.active_tab, 'case');
  assert.equal(requests[0].request.display_context.visible_response.advisory_title, 'Hydraulic review');
  assert.equal(requests[0].request.thread_id, 'thread-1');
});

test('chat sends bounded image inputs and content uploads use the authenticated application API', async () => {
  const { client, requests } = harness({});
  await client.chat({
    message: 'Inspect this panel',
    images: [{
      name: 'panel.png',
      dataUrl: 'data:image/png;base64,aGVsbG8=',
      detail: 'high'
    }],
    fleetSignals: [],
    accessToken: 'oidc-token',
    organizationId: 'org-1'
  });
  const file = new Blob(['manual'], { type: 'application/pdf' });
  Object.defineProperty(file, 'name', { value: 'ATA 29.pdf' });
  await client.content.upload(file, {
    accessToken: 'oidc-token',
    organizationId: 'org-1'
  });

  assert.equal(requests[0].request.images[0].data_url, 'data:image/png;base64,aGVsbG8=');
  assert.equal(requests[0].request.images[0].detail, 'high');
  assert.match(requests[1].url, /\/api\/content\/uploads\?filename=ATA%2029\.pdf$/);
  assert.equal(requests[1].options.headers.Authorization, 'Bearer oidc-token');
  assert.equal(requests[1].options.headers['Content-Type'], 'application/pdf');
  assert.equal(requests[1].request, file);
});

test('case media upload is explicitly confirmed and attached to the active case', async () => {
  const { client, requests } = harness({
    'mxg.maintenance_case.attach_observation': {
      observation_id: 'observation-1',
      evidence_id: 'evidence-1'
    }
  });
  const media = new Blob(['jpeg'], { type: 'image/jpeg' });
  Object.defineProperty(media, 'name', { value: 'headset.jpg' });
  const session = { accessToken: 'oidc-token', organizationId: 'org-1' };

  const result = await client.cases.attachMedia({
    caseId: 'case-1',
    media,
    note: 'Quest passthrough capture',
    session
  });

  const confirmation = requests.find((entry) => entry.url.endsWith('/confirmations'));
  assert.equal(confirmation.request.tool_name, 'mxg.maintenance_case.attach_observation');
  assert.deepEqual(confirmation.request.arguments.media_refs, [
    'azure-blob://documents/content-uploads/org-1/headset.jpg'
  ]);
  const attach = requests.find((entry) => entry.request?.params?.name === 'mxg.maintenance_case.attach_observation');
  assert.equal(attach.options.headers['X-MXG-Confirmation-Grant'], 'single-use-grant');
  assert.equal(result.observation.observation_id, 'observation-1');
});

test('project workspaces use tenant-authenticated versioned saves and private assets', async () => {
  const { client, requests } = harness({});
  const session = { accessToken: 'oidc-token', organizationId: 'org-1' };
  const file = new Blob(['drawing'], { type: 'image/png' });
  Object.defineProperty(file, 'name', { value: 'FIG 1.png' });

  await client.projectWorkspaces.get('provisional-patent', session);
  await client.projectWorkspaces.save('provisional-patent', {
    title: 'Provisional Patent Application',
    status: 'collecting',
    expectedVersion: 3,
    document: { schema_version: 1 }
  }, session);
  await client.projectWorkspaces.uploadAsset('provisional-patent', file, {
    section: 'drawings',
    note: 'Perspective example',
    session
  });
  const blob = await client.projectWorkspaces.getAsset('provisional-patent', 'asset-1', session);

  assert.equal(blob.type, 'application/pdf');
  assert.deepEqual(requests.map(({ options }) => options.method), ['GET', 'PUT', 'POST', 'GET']);
  assert.equal(requests[1].request.expected_version, 3);
  assert.deepEqual(requests[1].request.document, { schema_version: 1 });
  assert.match(requests[2].url, /\/api\/project-workspaces\/provisional-patent\/assets\?/);
  assert.match(requests[2].url, /section=drawings/);
  assert.match(requests[2].url, /note=Perspective\+example/);
  assert.equal(requests[2].request, file);
  assert.ok(requests.every(({ options }) => options.headers.Authorization === 'Bearer oidc-token'));
});

test('server persistence clients keep threads cases and profiles behind application identity', async () => {
  const { client, requests } = harness({});
  const session = {
    accessToken: 'oidc-token',
    organizationId: 'org-1',
    correlationId: 'correlation-1'
  };

  await client.cases.list(session);
  await client.cases.get('case-1', session);
  await client.threads.create({ title: 'Hydraulics', caseId: 'case-1', session });
  await client.threads.update('thread-1', { title: 'Hydraulics follow-up' }, session);
  await client.threads.messages('thread-1', session);
  await client.profile.update({
    displayName: 'MX User',
    timezone: 'America/New_York',
    settings: { compactMode: true }
  }, session);
  await client.profile.putImage(new Blob(['image'], { type: 'image/png' }), session);
  await client.digitalTwin.saveHighlight({
    modelId: 'model-1',
    meshId: 'mesh-1',
    session
  });

  assert.deepEqual(
    requests.map(({ url, options }) => [url, options.method]),
    [
      ['/api/cases', 'GET'],
      ['/api/cases/case-1', 'GET'],
      ['/api/threads', 'POST'],
      ['/api/threads/thread-1', 'PATCH'],
      ['/api/threads/thread-1/messages', 'GET'],
      ['/api/profile', 'PATCH'],
      ['/api/profile/image', 'PUT'],
      ['/api/digital-twin/highlight', 'PUT']
    ]
  );
  assert.ok(requests.every(({ options }) => options.headers.Authorization === 'Bearer oidc-token'));
  assert.equal(requests[2].request.case_id, 'case-1');
  assert.equal(requests[5].request.settings.compactMode, true);
});

test('beta access rules use the authenticated server boundary instead of browser storage', async () => {
  const { client, requests } = harness({});
  const session = { accessToken: 'oidc-token', organizationId: 'org-1' };
  await client.betaAccess.list(session);
  await client.betaAccess.add('sameera.tillman@advancedaog.com', session);
  await client.betaAccess.delete('rule-1', session);

  assert.deepEqual(
    requests.map(({ url, options }) => [url, options.method]),
    [
      ['/api/beta-access', 'GET'],
      ['/api/beta-access', 'POST'],
      ['/api/beta-access/rule-1', 'DELETE']
    ]
  );
  assert.equal(requests[1].request.rule, 'sameera.tillman@advancedaog.com');
  assert.ok(requests.every(({ options }) => options.headers.Authorization === 'Bearer oidc-token'));
});

test('chat sends only bounded relevant fleet context instead of the full compatibility dataset', async () => {
  const { client, requests } = harness({});
  const fleetSignals = Array.from({ length: 4437 }, (_, index) => ({
    aircraftid: index + 1,
    regnbr: index === 4100 ? 'N750MX' : `N${10000 + index}`,
    make: index === 4100 ? 'Bombardier' : 'Example',
    model: index === 4100 ? 'Global 7500' : 'Aircraft',
    nested_provider_payload: { ignored: 'x'.repeat(4000) },
    mro: { aftt: index, isAOG: index === 20, isForSale: false }
  }));

  await client.chat({
    message: 'Brief the GL7500 aircraft N750MX',
    fleetSignals,
    accessToken: 'oidc-token',
    organizationId: 'org-1'
  });

  const sent = requests[0].request.fleet_signals;
  assert.equal(sent.length, 50);
  assert.equal(sent[0].registration, 'N750MX');
  assert.equal(sent[0].model, 'Global 7500');
  assert.equal('nested_provider_payload' in sent[0], false);
  assert.ok(requests[0].options.body.length < 100_000);
});

test('chat omits fleet compatibility records for a general conversation', async () => {
  const { client, requests } = harness({});
  await client.chat({
    message: 'hello',
    fleetSignals: [{ aircraftid: 1, regnbr: 'N100MX', provider_blob: 'x'.repeat(10_000) }],
    accessToken: 'oidc-token',
    organizationId: 'org-1'
  });
  assert.deepEqual(requests[0].request.fleet_signals, []);
});

test('Realtime SDP exchange uses application identity and never sends an OpenAI key', async () => {
  const { client, requests } = harness({});
  await assert.rejects(
    client.realtime.exchangeSdp({ sdp: 'v=0\r\no=offer' }),
    /Authenticated application session required/
  );
  const result = await client.realtime.exchangeSdp({
    sdp: 'v=0\r\no=offer',
    session: {
      accessToken: 'oidc-token',
      organizationId: 'org-1',
      correlationId: 'correlation-client'
    }
  });
  assert.equal(result.callId, 'rtc-test');
  assert.equal(result.sdp, 'v=0\r\no=answer');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer oidc-token');
  assert.equal(requests[0].options.headers['X-MXG-Organization-ID'], 'org-1');
  assert.equal(requests[0].options.headers['X-Correlation-ID'], 'correlation-client');
  assert.equal(requests[0].options.headers['Content-Type'], 'application/sdp');
  assert.ok(!JSON.stringify(requests[0]).includes('OPENAI_API_KEY'));
});

test('confirmation request preserves exact tool, object, version, and application identity', async () => {
  const { client, requests } = harness({});
  const result = await client.confirmations.issue({
    toolName: 'mxg.maintenance_case.update_status',
    arguments: { case_id: 'case-1', target_status: 'open', expected_version: 3 },
    session: { accessToken: 'oidc-token', organizationId: 'org-1' }
  });
  assert.equal(result.token, 'single-use-grant');
  assert.equal(requests[0].request.tool_name, 'mxg.maintenance_case.update_status');
  assert.equal(requests[0].request.arguments.case_id, 'case-1');
  assert.equal(requests[0].request.arguments.expected_version, 3);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer oidc-token');
});

test('digital-twin reads omit confirmation and marker mutation carries it', async () => {
  const { client, requests } = harness({
    'mxg.digital_twin.component_state': { component: { component_id: 'cmp-1', canonical: true } },
    'mxg.digital_twin.link_documents': { documents: [] },
    'mxg.digital_twin.attach_case_marker': { marker_id: 'marker-1', case_id: 'case-1' }
  });
  const session = { accessToken: 'token', confirmationGrant: 'grant' };
  await client.digitalTwin.inspectSelection({
    aircraftId: 'aircraft-1', caseId: 'case-1', componentId: 'cmp-1', session
  });
  await client.digitalTwin.attachMarker({
    caseId: 'case-1', componentId: 'cmp-1', severity: 'high', session
  });
  const calls = requests.filter(({ request }) => request.method === 'tools/call');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.headers['X-MXG-Confirmation-Grant'], undefined);
  assert.equal(calls[1].options.headers['X-MXG-Confirmation-Grant'], undefined);
  assert.equal(calls[2].options.headers['X-MXG-Confirmation-Grant'], 'grant');
  assert.equal(calls[2].request.params.arguments.severity, 'high');
});

test('digital-twin model catalog, GLB upload, and content reads use the authenticated REST boundary', async () => {
  const { client, requests } = harness({});
  const session = { accessToken: 'oidc-token', organizationId: 'org-1' };
  const file = new Blob(['glTF-test'], { type: 'model/gltf-binary' });

  await client.digitalTwin.listModels(session);
  await client.digitalTwin.uploadModel({
    file,
    name: 'NASA reference copy',
    revision: 'source-revision',
    lod: 'reference',
    applicableAircraft: ['N123MX'],
    session
  });
  const content = await client.digitalTwin.modelContent('model-1', session);

  assert.equal(content.byteLength, 9);
  assert.deepEqual(requests.map(({ options }) => options.method), ['GET', 'POST', 'GET']);
  assert.match(requests[0].url, /\/api\/digital-twin\/models$/);
  assert.match(requests[1].url, /name=NASA\+reference\+copy/);
  assert.match(requests[1].url, /revision=source-revision/);
  assert.match(requests[1].url, /applicable_aircraft=N123MX/);
  assert.equal(requests[1].options.headers['Content-Type'], 'model/gltf-binary');
  assert.equal(requests[1].request, file);
  assert.match(requests[2].url, /\/api\/digital-twin\/models\/model-1\/content$/);
  assert.ok(requests.every(({ options }) => options.headers.Authorization === 'Bearer oidc-token'));
});

test('FAA candidate AD flow resolves a canonical aircraft before the compliance capability', async () => {
  const { client, requests } = harness({
    'mxg.aircraft.lookup': { aircraft_id: '11111111-1111-1111-1111-111111111111', matches: [] },
    'mxg.compliance.applicable_ads': { ads: [] }
  });
  const session = { accessToken: 'oidc-token', organizationId: 'org-1', confirmationGrant: 'must-not-leak' };
  await client.aircraft.lookup({
    registration: 'N12345',
    serial: '750-0123',
    sourceId: 987,
    session
  });
  await client.compliance.applicableAds({
    aircraftId: '11111111-1111-1111-1111-111111111111',
    caseId: 'case-1',
    session
  });
  const calls = requests.filter(({ request }) => request.method === 'tools/call');
  assert.equal(calls[0].request.params.name, 'mxg.aircraft.lookup');
  assert.equal(calls[0].request.params.arguments.registration, 'N12345');
  assert.equal(calls[0].request.params.arguments.serial_number, '750-0123');
  assert.equal(calls[0].request.params.arguments.source_id, '987');
  assert.equal(calls[1].request.params.name, 'mxg.compliance.applicable_ads');
  assert.equal(calls[1].request.params.arguments.aircraft_id, '11111111-1111-1111-1111-111111111111');
  assert.equal(calls[1].request.params.arguments.case_id, 'case-1');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer oidc-token');
  assert.equal(calls[1].options.headers['X-MXG-Confirmation-Grant'], undefined);
});

test('capability calls complete one MCP initialization lifecycle per application session', async () => {
  const { client, requests } = harness({
    'mxg.aircraft.lookup': { matches: [] },
    'mxg.aircraft.profile': { aircraft: null }
  });
  const session = { accessToken: 'oidc-token', organizationId: 'org-1', confirmationGrant: 'grant-for-tool-only' };
  await client.capabilities.call('mxg.aircraft.lookup', { registration: 'N12345' }, session);
  await client.capabilities.call('mxg.aircraft.profile', { aircraft_id: 'aircraft-1' }, session);
  assert.deepEqual(
    requests.map(({ request }) => request.method),
    ['initialize', 'notifications/initialized', 'tools/call', 'tools/call']
  );
  assert.equal('id' in requests[1].request, false);
  assert.equal(requests[0].options.headers['MCP-Protocol-Version'], undefined);
  assert.equal(requests[1].options.headers['MCP-Protocol-Version'], '2025-11-25');
  assert.equal(requests[0].options.headers['X-MXG-Confirmation-Grant'], undefined);
  assert.equal(requests[1].options.headers['X-MXG-Confirmation-Grant'], undefined);
  assert.equal(requests[2].options.headers['X-MXG-Confirmation-Grant'], 'grant-for-tool-only');
});
