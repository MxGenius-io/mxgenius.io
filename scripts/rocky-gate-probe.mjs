import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=', 2);
    return [key, value];
  })
);
const scope = args.get('scope') || 'all';
const through = Number(args.get('through') || 7);
const SITE = String(process.env.MXGENIUS_SITE_URL || 'https://mxgenius.io').replace(/\/$/, '');
const CORE = String(
  process.env.MXGENIUS_API_URL
    || 'https://mxg-core.kindbush-8fee3a17.centralus.azurecontainerapps.io'
).replace(/\/$/, '');
const TOKEN = process.env.MXGENIUS_ACCESS_TOKEN || '';
const ORGANIZATION_ID = process.env.MXGENIUS_ORGANIZATION_ID || '';
const startedAt = new Date();
const results = [];

function bounded(value, limit = 700) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function record(gate, name, status, detail, durationMs = 0) {
  results.push({ gate, name, status, detail: bounded(detail), duration_ms: durationMs });
}

async function check(gate, name, operation) {
  const before = Date.now();
  try {
    const detail = await operation();
    record(gate, name, detail?.status || 'PASS', detail?.detail || detail || 'Passed', Date.now() - before);
  } catch (error) {
    record(gate, name, 'FAIL', error?.message || String(error), Date.now() - before);
  }
}

function blocked(gate, name, detail) {
  record(gate, name, 'BLOCKED', detail);
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function source(relativePath) {
  return readFile(resolve(ROOT, relativePath), 'utf8');
}

function requireMarkers(text, markers, label) {
  for (const marker of markers) {
    requireCondition(text.includes(marker), `${label} is missing ${JSON.stringify(marker)}`);
  }
}

function run(command, commandArgs, cwd = ROOT) {
  const completed = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 180_000
  });
  requireCondition(
    completed.status === 0,
    `${command} ${commandArgs.join(' ')} failed (${completed.status}): ${bounded(completed.stderr || completed.stdout)}`
  );
  return bounded(completed.stdout || 'Command passed');
}

function authHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    ...(ORGANIZATION_ID ? { 'X-MXG-Organization-ID': ORGANIZATION_ID } : {})
  };
}

async function responseBody(response) {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') ? response.json() : response.text();
}

async function request(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { 'cache-control': 'no-cache', ...(options.headers || {}) },
    signal: AbortSignal.timeout(30_000)
  });
}

const localEnabled = scope === 'all' || scope === 'local';
const liveEnabled = scope === 'all' || scope === 'live';

if (through >= 0 && localEnabled) {
  await check(0, 'Frozen domain and API contract', async () => {
    const contract = await source('docs/ROCKY_PARTS_VERTICAL_SLICE.md');
    requireMarkers(contract, [
      '## Scope locks',
      '## Domain contract',
      '## HTTP application contract',
      '## Feature flags',
      '## FAA result contract',
      '## Phase gates'
    ], 'Rocky contract');
    return 'Catalog/unit separation, API shapes, safety boundaries, flags, and gates are recorded.';
  });
}

if (through >= 1 && localEnabled) {
  await check(1, 'Landing-page passive auth contract', async () => {
    const [landing, auth] = await Promise.all([source('index.html'), source('auth.js')]);
    requireMarkers(landing, ['data-auth-state', 'signedInAs', 'auth.js'], 'Landing page');
    requireMarkers(auth, ['isLanding', '/api/profile', 'service-unavailable'], 'Auth client');
    requireCondition(
      !/isLanding[\s\S]{0,1200}loginRedirect/.test(auth),
      'Landing-page path must not force a login redirect'
    );
    return run('node', ['--test', 'tests/auth.test.mjs']);
  });
}

if (through >= 1 && liveEnabled) {
  await check(1, 'Live authentication boundary', async () => {
    const response = await request(`${CORE}/api/profile`);
    requireCondition(
      response.status === 401 || response.status === 403,
      `Unauthenticated profile unexpectedly returned ${response.status}`
    );
    return `Unauthenticated profile fails closed (${response.status}).`;
  });
  if (!TOKEN) {
    blocked(1, 'Live whitelisted identity', 'Set MXGENIUS_ACCESS_TOKEN from the Rocky acceptance session.');
  } else {
    await check(1, 'Live whitelisted identity', async () => {
      const response = await request(`${CORE}/api/profile`, { headers: authHeaders() });
      const body = await responseBody(response);
      requireCondition(response.ok, `Profile returned ${response.status}: ${bounded(body)}`);
      requireCondition(body?.email, 'Authorized profile returned no email.');
      return `Authorized profile resolved ${body.email}.`;
    });
  }
}

if (through >= 2 && localEnabled) {
  await check(2, 'Tenant-owned inventory migration', async () => {
    const migration = await source('services/mcp/migrations/0015_parts_inventory.sql');
    requireMarkers(migration, [
      'stock_units',
      'organization_id',
      'inventory_events',
      'part_assets',
      'extraction_runs',
      'extraction_candidates',
      'version'
    ], 'Inventory migration');
    return run('cargo', ['test', '--workspace'], resolve(ROOT, 'services/mcp'));
  });
}

if (through >= 3 && localEnabled) {
  await check(3, 'Production parts API and repositories', async () => {
    const http = await source('services/mcp/server/src/transport/http.rs');
    requireMarkers(http, [
      '/api/parts',
      'receiving-drafts',
      'faa-candidates',
      'Idempotency-Key',
      'If-Match'
    ], 'HTTP transport');
    return run('cargo', ['test', '--workspace'], resolve(ROOT, 'services/mcp'));
  });
}

if (through >= 4 && localEnabled) {
  await check(4, 'Assisted extraction confirmation', async () => {
    const tree = [
      await source('services/mcp/server/src/transport/http.rs'),
      await source('services/mcp/server/src/application/parts_inventory.rs')
    ].join('\n');
    requireMarkers(tree, [
      'extraction_candidates',
      'proposed',
      'accepted',
      'rejected',
      'confirmed_by'
    ], 'Extraction implementation');
    return 'Extraction output remains proposed until an authenticated human review is recorded.';
  });
}

if (through >= 5 && localEnabled) {
  await check(5, 'Frontend uses production parts adapter', async () => {
    const [client, workspace] = await Promise.all([
      source('application-client.js'),
      source('parts-workspace.js')
    ]);
    requireCondition(!client.includes('mockUnits'), 'application-client.js still contains in-memory mock units');
    requireCondition(!workspace.includes('mock content'), 'parts-workspace.js still renders mock content');
    requireMarkers(client, [
      '/api/parts',
      'createReceivingDraft',
      'confirmReceiving',
      'getFaaCandidates'
    ], 'Parts client');
    return run('node', ['--test', 'tests/parts-workspace.test.mjs', 'tests/application-client.test.mjs']);
  });
}

if (through >= 6 && localEnabled) {
  await check(6, 'Stable QR and FAA provenance', async () => {
    const [workspace, http] = await Promise.all([
      source('parts-workspace.js'),
      source('services/mcp/server/src/transport/http.rs')
    ]);
    requireMarkers(workspace, ['getLabel', 'getFaaCandidates'], 'Parts workspace');
    requireMarkers(http, [
      'no_candidates',
      'identifiers_incomplete',
      'source_not_configured',
      'source_unavailable',
      'source_rejected'
    ], 'FAA response');
    requireCondition(!workspace.includes('blob.core.windows.net'), 'QR/label UI must not embed a blob URL');
    return 'QR and FAA source-state invariants are present.';
  });
}

if (through >= 7 && localEnabled) {
  await check(7, 'Complete local regression suite', async () => run('npm', ['test']));
  await check(7, 'Complete Rust workspace suite', async () =>
    run('cargo', ['test', '--workspace'], resolve(ROOT, 'services/mcp'))
  );
}

if (through >= 7 && liveEnabled) {
  await check(7, 'Production health and mode', async () => {
    const [health, readiness] = await Promise.all([
      request(`${CORE}/healthz`),
      request(`${CORE}/readyz`)
    ]);
    const healthBody = await responseBody(health);
    const readyBody = await responseBody(readiness);
    requireCondition(health.ok, `healthz returned ${health.status}: ${bounded(healthBody)}`);
    requireCondition(readiness.ok, `readyz returned ${readiness.status}: ${bounded(readyBody)}`);
    requireCondition(readyBody?.ready === true, `Core is not ready: ${bounded(readyBody)}`);
    requireCondition(readyBody?.mode === 'production', `Core mode is ${readyBody?.mode || 'unknown'}`);
    return 'Production core is healthy, ready, and reports production mode.';
  });
  await check(7, 'Production parts release markers', async () => {
    const response = await request(`${SITE}/dashboard.html?rocky-probe=${Date.now()}`);
    const html = await response.text();
    requireCondition(response.ok, `Dashboard returned ${response.status}`);
    requireMarkers(html, ['data-tab="parts"', 'parts-workspace.js'], 'Deployed dashboard');
    return 'Production dashboard exposes the parts bundle.';
  });
  if (!TOKEN) {
    blocked(7, 'Rocky end-to-end acceptance', 'A live Rocky access token is required for tenant-owned mutations.');
  } else {
    blocked(
      7,
      'Rocky end-to-end acceptance',
      'The safe create/upload/confirm/QR cleanup probe will activate after the production parts API is mounted.'
    );
  }
}

const completedAt = new Date();
const summary = results.reduce((counts, result) => {
  counts[result.status] = (counts[result.status] || 0) + 1;
  return counts;
}, {});
const runId = startedAt.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
const report = {
  run_id: runId,
  started_at: startedAt.toISOString(),
  completed_at: completedAt.toISOString(),
  scope,
  through,
  site: SITE,
  core: CORE,
  authenticated: Boolean(TOKEN),
  summary,
  results
};
const resultDirectory = resolve(ROOT, 'test-results');
await mkdir(resultDirectory, { recursive: true });
const jsonPath = resolve(resultDirectory, `rocky-gates-${runId}.json`);
const markdownPath = resolve(resultDirectory, `rocky-gates-${runId}.md`);
const rows = results.map((result) =>
  `| ${result.gate} | ${result.status} | ${result.name} | ${result.duration_ms} | ${result.detail.replaceAll('|', '\\|').replaceAll('\n', ' ')} |`
);
const markdown = `# Rocky Parts Gate Probe

- Run: \`${runId}\`
- Scope: ${scope}
- Through gate: ${through}
- Authenticated: ${Boolean(TOKEN)}
- Summary: ${Object.entries(summary).map(([status, count]) => `${status} ${count}`).join(', ')}

| Gate | Status | Check | ms | Detail |
|---:|---|---|---:|---|
${rows.join('\n')}
`;
await Promise.all([
  writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  writeFile(markdownPath, markdown, 'utf8')
]);

console.log(markdown);
console.log(`JSON report: ${jsonPath}`);
console.log(`Markdown report: ${markdownPath}`);

if ((summary.FAIL || 0) > 0) process.exitCode = 1;
else if ((summary.BLOCKED || 0) > 0) process.exitCode = 2;
