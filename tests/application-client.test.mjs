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
            object_id: request.arguments.case_id,
            object_version: request.arguments.expected_version
          })
        };
      }
      const request = JSON.parse(options.body);
      requests.push({ url, options, request });
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

test('chat uses application identity and carries canonical case context without a browser API key', async () => {
  const { client, requests } = harness({});
  assert.throws(
    () => client.chat({ message: 'status', fleetSignals: [] }),
    /Authenticated application session required/
  );
  await client.chat({
    message: 'status',
    fleetSignals: [],
    caseContext: { case_id: 'case-1', version: 3 },
    accessToken: 'oidc-token',
    organizationId: 'org-1',
    correlationId: 'correlation-1'
  });
  assert.equal(requests[0].options.headers.Authorization, 'Bearer oidc-token');
  assert.equal(requests[0].options.headers['X-MXG-Organization-ID'], 'org-1');
  assert.equal(requests[0].request.case_context.case_id, 'case-1');
  assert.equal(requests[0].request.case_context.version, 3);
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
  assert.equal(requests.length, 3);
  assert.equal(requests[0].options.headers['X-MXG-Confirmation-Grant'], undefined);
  assert.equal(requests[1].options.headers['X-MXG-Confirmation-Grant'], undefined);
  assert.equal(requests[2].options.headers['X-MXG-Confirmation-Grant'], 'grant');
  assert.equal(requests[2].request.params.arguments.severity, 'high');
});

test('FAA candidate AD reads use the authenticated compliance capability', async () => {
  const { client, requests } = harness({
    'mxg.compliance.applicable_ads': { ads: [] }
  });
  await client.compliance.applicableAds({
    aircraftId: 'aircraft-1',
    caseId: 'case-1',
    session: { accessToken: 'oidc-token', organizationId: 'org-1', confirmationGrant: 'must-not-leak' }
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].request.params.name, 'mxg.compliance.applicable_ads');
  assert.equal(requests[0].request.params.arguments.aircraft_id, 'aircraft-1');
  assert.equal(requests[0].request.params.arguments.case_id, 'case-1');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer oidc-token');
  assert.equal(requests[0].options.headers['X-MXG-Confirmation-Grant'], undefined);
});
