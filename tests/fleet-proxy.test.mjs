import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';

const fleetProxySource = readFileSync(new URL('../services/fleet-proxy/server.js', import.meta.url), 'utf8');

test('aircraft list requests use a bounded tenant-scoped fleet snapshot for every HTTP method', () => {
  assert.match(fleetProxySource, /const isAircraftList = path\.includes\('\/Aircraft\/getAircraftList\/'\)/);
  assert.match(fleetProxySource, /const tenantSnapshots = new Map\(\)/);
  assert.match(fleetProxySource, /const aircraftListSnapshot = snapshots\.aircraftList/);
  assert.match(fleetProxySource, /snapshotAge < fleetSnapshotTtlMs/);
  assert.match(fleetProxySource, /return aircraftListSnapshot\.result/);
  assert.doesNotMatch(fleetProxySource, /replace\('\/Aircraft\/getAircraftList\/', '\/Aircraft\/getBulkAircraftExportPaged\/'\)/);
});

test('flight route requests use a short tenant-scoped query cache', () => {
  assert.match(fleetProxySource, /FLEET_FLIGHT_SNAPSHOT_SECONDS/);
  assert.match(fleetProxySource, /const isFlightData = path\.includes\('\/Aircraft\/getFlightData\/'\)/);
  assert.match(fleetProxySource, /const flightDataSnapshot = snapshots\.flightData/);
  assert.match(fleetProxySource, /flightDataSnapshot\.inFlightQueryKey === queryKey/);
  assert.match(fleetProxySource, /Array\.isArray\(result\.body\?\.flightdata\)/);
  assert.match(fleetProxySource, /flightDataReady/);
});

test('OpenSky traffic uses one server-wide snapshot with a two-per-minute upstream ceiling', () => {
  assert.match(fleetProxySource, /OPENSKY_POLL_SECONDS \|\| 30/);
  assert.match(fleetProxySource, /Math\.max\(30,/);
  assert.match(fleetProxySource, /const openSkyState = \{/);
  assert.match(fleetProxySource, /if \(openSkyState\.result && age < openSkyPollMs\) return openSkyState\.result/);
  assert.match(fleetProxySource, /if \(openSkyState\.inFlight\) return openSkyState\.inFlight/);
  assert.match(fleetProxySource, /request\.url === '\/api\/live-traffic'/);
  assert.match(fleetProxySource, /x-rate-limit-retry-after-seconds/);
});

test('OpenSky selected tracks are validated, normalized, and cached independently', () => {
  assert.match(fleetProxySource, /OPENSKY_TRACK_CACHE_SECONDS \|\| 120/);
  assert.match(fleetProxySource, /const openSkyTrackStates = new Map\(\)/);
  assert.match(fleetProxySource, /\/tracks\/all\?icao24=\$\{encodeURIComponent\(icao24\)\}&time=0/);
  assert.match(fleetProxySource, /departureObserved/);
  assert.match(fleetProxySource, /arrivalObserved/);
  assert.match(fleetProxySource, /request\.url\?\.startsWith\('\/api\/live-traffic\/track\?'\)/);
});

test('organization-owned JetNet credentials are brokered server-side and tenant-scoped', () => {
  assert.match(fleetProxySource, /MXGENIUS_PROVIDER_CREDENTIALS_URL/);
  assert.match(fleetProxySource, /'X-MXG-Organization-ID': organizationId/);
  assert.match(fleetProxySource, /source: 'organization'/);
  assert.match(fleetProxySource, /clearTenantState\(requester\.organizationId\)/);
  assert.match(fleetProxySource, /const providerSessions = new Map\(\)/);
  assert.match(fleetProxySource, /tokenFingerprint\(`\$\{token\}\\0\$\{organizationId\}`\)/);
});

test('bulk aircraft records preserve the application aircraft-list contract', () => {
  assert.match(fleetProxySource, /baseicao: aircraft\.baseicao \|\| aircraft\.acbaseicao \|\| ''/);
  assert.match(fleetProxySource, /basecity: aircraft\.basecity \|\| aircraft\.acbasecity \|\| ''/);
  assert.match(fleetProxySource, /basecountry: aircraft\.basecountry \|\| aircraft\.acbasecountry \|\| ''/);
  assert.match(fleetProxySource, /owner: aircraft\.owner \|\| aircraft\.owrcompanyname \|\| aircraft\.owrregisteredas \|\| ''/);
  assert.match(fleetProxySource, /operator: aircraft\.operator \|\| aircraft\.oprcompanyname \|\| ''/);
  assert.match(fleetProxySource, /fleetSnapshot\.result = normalizedResult/);
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

  let openSkyRequests = 0;
  let openSkyTrackRequests = 0;
  const openSky = http.createServer((request, response) => {
    if ((request.url || '').startsWith('/tracks/all?')) {
      openSkyTrackRequests += 1;
      assert.equal(request.url, '/tracks/all?icao24=abc123&time=0');
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Rate-Limit-Remaining': '3988'
      });
      response.end(JSON.stringify({
        icao24: 'abc123',
        callsign: 'MXG123',
        startTime: 1_800_000_000,
        endTime: 1_800_000_600,
        path: [
          [1_800_000_000, 26.00, -80.00, 0, 45, true],
          [1_800_000_100, 26.05, -79.95, 1200, 45, false],
          [1_800_000_500, 27.00, -79.00, 1200, 45, false],
          [1_800_000_600, 27.05, -78.95, 0, 45, true]
        ]
      }));
      return;
    }
    openSkyRequests += 1;
    assert.match(request.url || '', /^\/states\/all\?extended=1$/);
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Rate-Limit-Remaining': '3996'
    });
    response.end(JSON.stringify({
      time: 1_800_000_000,
      states: [[
        'abc123', 'MXG123', 'United States', 1_800_000_000, 1_800_000_000,
        -80.1, 26.2, 10_000, false, 210, 45, 0, null, 10_100, '1200', false, 0, 3
      ]]
    }));
  });
  const openSkyPort = await listen(openSky);
  t.after(() => openSky.close());

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
      OPENSKY_API_URL: `http://127.0.0.1:${openSkyPort}`,
      OPENSKY_POLL_SECONDS: '30',
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

  const liveHeaders = { Authorization: 'Bearer approved-user', 'X-MXG-Organization-ID': 'org-1' };
  const firstLive = await fetch(`${base}/api/live-traffic`, { headers: liveHeaders });
  const firstLivePayload = await firstLive.json();
  assert.equal(firstLive.status, 200);
  assert.equal(firstLivePayload.source, 'OpenSky Network');
  assert.equal(firstLivePayload.aircraft[0].icao24, 'abc123');
  assert.equal(firstLivePayload.listedAircraft, 1);
  assert.equal(firstLivePayload.renderedAircraft, 1);
  assert.equal(firstLivePayload.remainingCredits, 3996);

  const secondLive = await fetch(`${base}/api/live-traffic`, { headers: liveHeaders });
  assert.equal(secondLive.status, 200);
  assert.equal(openSkyRequests, 1, 'all viewers should share one 30-second OpenSky snapshot');

  const firstTrack = await fetch(`${base}/api/live-traffic/track?icao24=abc123`, { headers: liveHeaders });
  const firstTrackPayload = await firstTrack.json();
  assert.equal(firstTrack.status, 200);
  assert.equal(firstTrackPayload.icao24, 'abc123');
  assert.equal(firstTrackPayload.departureObserved, true);
  assert.equal(firstTrackPayload.arrivalObserved, true);
  assert.equal(firstTrackPayload.tripState, 'landed');
  assert.equal(firstTrackPayload.path.length, 4);
  assert.equal(firstTrackPayload.remainingCredits, 3988);

  const secondTrack = await fetch(`${base}/api/live-traffic/track?icao24=abc123`, { headers: liveHeaders });
  assert.equal(secondTrack.status, 200);
  assert.equal(openSkyTrackRequests, 1, 'selected tracks should share one bounded server cache');

  const invalidTrack = await fetch(`${base}/api/live-traffic/track?icao24=not-valid`, { headers: liveHeaders });
  assert.equal(invalidTrack.status, 400);

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
