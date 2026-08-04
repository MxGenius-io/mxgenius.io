import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';

const fleetProxySource = readFileSync(new URL('../services/fleet-proxy/server.js', import.meta.url), 'utf8');

test('aircraft list requests use the bounded shared fleet snapshot for every HTTP method', () => {
  assert.match(fleetProxySource, /if \(path\.includes\('\/Aircraft\/getAircraftList\/'\)\)/);
  assert.match(fleetProxySource, /getBulkAircraftExportPaged\/.*\/50\/1/);
  assert.doesNotMatch(fleetProxySource, /method === 'GET' && path\.includes\('\/Aircraft\/getAircraftList\/'\)/);
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function waitForOutput(child, marker) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${marker}`)), 10_000);
    const inspect = (chunk) => {
      if (!String(chunk).includes(marker)) return;
      clearTimeout(timeout);
      child.stdout.off('data', inspect);
      resolve();
    };
    child.stdout.on('data', inspect);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Fleet proxy exited before startup (${code})`));
    });
  });
}

test('fleet proxy requires MXGenius identity while preserving its internal service lane', async (t) => {
  const authz = http.createServer((request, response) => {
    const authorized = request.headers.authorization === 'Bearer approved-user';
    response.writeHead(authorized ? 200 : 403, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(authorized ? { email: 'approved@example.test' } : { error: 'denied' }));
  });
  const authzPort = await listen(authz);
  t.after(() => authz.close());

  const reservation = http.createServer();
  const proxyPort = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('../services/fleet-proxy/', import.meta.url),
    env: {
      ...process.env,
      PORT: String(proxyPort),
      MXGENIUS_AUTHZ_URL: `http://127.0.0.1:${authzPort}/api/profile`,
      MXGENIUS_INTERNAL_BEARER_TOKEN: 'internal-service-token',
      MXGENIUS_AUTHZ_CACHE_SECONDS: '0',
      FLEET_RATE_LIMIT_PER_MINUTE: '20',
      JETNET_IDENTITY: '',
      JETNET_CREDENTIAL: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    if (!child.killed) child.kill();
    if (child.exitCode === null) await once(child, 'exit').catch(() => {});
  });
  await waitForOutput(child, 'Fleet proxy listening');

  const base = `http://127.0.0.1:${proxyPort}`;
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.ok(health.headers.get('x-correlation-id'));

  const anonymous = await fetch(`${base}/api/image?url=invalid`);
  assert.equal(anonymous.status, 401);

  const wrongOrigin = await fetch(`${base}/api/image?url=invalid`, {
    headers: { Origin: 'https://example.invalid', Authorization: 'Bearer approved-user' }
  });
  assert.equal(wrongOrigin.status, 403);

  const denied = await fetch(`${base}/api/image?url=invalid`, {
    headers: { Authorization: 'Bearer denied-user' }
  });
  assert.equal(denied.status, 403);

  const approved = await fetch(`${base}/api/image?url=invalid`, {
    headers: { Authorization: 'Bearer approved-user', 'X-MXG-Organization-ID': 'org-1' }
  });
  assert.equal(approved.status, 502, 'approved identity should pass authorization and reach image validation');

  const internal = await fetch(`${base}/api/image?url=invalid`, {
    headers: { Authorization: 'Bearer internal-service-token' }
  });
  assert.equal(internal.status, 502, 'internal service bearer should pass authorization');

  const preflight = await fetch(`${base}/api/Model/example`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://mxgenius.io',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,x-mxg-organization-id'
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://mxgenius.io');
  assert.match(preflight.headers.get('access-control-allow-headers') || '', /X-MXG-Organization-ID/i);
});
