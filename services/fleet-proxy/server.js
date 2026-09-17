'use strict';

const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');

const port = Number(process.env.PORT || 8080);
const providerHost = 'customer.jetnetconnect.com';
const providerIdentity = process.env.JETNET_IDENTITY || '';
const providerCredential = process.env.JETNET_CREDENTIAL || '';
const authzUrl = process.env.MXGENIUS_AUTHZ_URL
  || 'https://mxg-core.kindbush-8fee3a17.centralus.azurecontainerapps.io/api/profile';
const providerCredentialsUrl = process.env.MXGENIUS_PROVIDER_CREDENTIALS_URL
  || 'https://mxg-core.kindbush-8fee3a17.centralus.azurecontainerapps.io/api/internal/integrations/jetnet/credentials';
const authzCacheTtlMs = Math.max(0, Number(process.env.MXGENIUS_AUTHZ_CACHE_SECONDS || 10)) * 1000;
const rateLimitPerMinute = Math.max(10, Number(process.env.FLEET_RATE_LIMIT_PER_MINUTE || 180));
const internalBearerToken = process.env.MXGENIUS_INTERNAL_BEARER_TOKEN || '';
const allowedOrigins = new Set([
  'https://mxgenius.io',
  'https://www.mxgenius.io'
]);

const providerSessions = new Map();
const tenantSnapshots = new Map();
const fleetSnapshotTtlMs = 30 * 60 * 1000;
const imageHosts = new Set(['evo-assets-3wl.s3.us-west-2.amazonaws.com']);
const maxImageBytes = 15 * 1024 * 1024;
const authzCache = new Map();
const rateWindows = new Map();

function tenantKey(organizationId) {
  return organizationId || '__system__';
}

function providerSession(organizationId) {
  const key = tenantKey(organizationId);
  if (!providerSessions.has(key)) {
    providerSessions.set(key, { bearer: '', apiToken: '', authenticating: null, credentialSource: '', loadedAt: 0 });
  }
  return providerSessions.get(key);
}

function snapshotState(organizationId) {
  const key = tenantKey(organizationId);
  if (!tenantSnapshots.has(key)) {
    tenantSnapshots.set(key, {
      fleet: { result: null, loadedAt: 0, inFlight: null },
      aircraftList: { result: null, loadedAt: 0, inFlight: null }
    });
  }
  return tenantSnapshots.get(key);
}

function clearTenantState(organizationId) {
  providerSessions.delete(tenantKey(organizationId));
  tenantSnapshots.delete(tenantKey(organizationId));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requestBearer(request) {
  const value = String(request.headers.authorization || '');
  const match = /^Bearer\s+([^\s]+)$/i.exec(value);
  if (!match) throw new HttpError(401, 'MXGenius sign-in required');
  return match[1];
}

function tokenFingerprint(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isInternalBearer(token) {
  if (!internalBearerToken) return false;
  const supplied = Buffer.from(token);
  const expected = Buffer.from(internalBearerToken);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

async function authorize(request) {
  const token = requestBearer(request);
  const fingerprint = tokenFingerprint(token);
  const organizationId = String(request.headers['x-mxg-organization-id'] || '').trim();
  const authorizationKey = tokenFingerprint(`${token}\0${organizationId}`);
  if (isInternalBearer(token)) return { key: `internal:${fingerprint}`, organizationId };
  const cached = authzCache.get(authorizationKey);
  if (cached?.expiresAt > Date.now()) {
    if (cached.promise) await cached.promise;
    return { key: authorizationKey, organizationId };
  }

  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let result;
    try {
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      if (organizationId) headers['X-MXG-Organization-ID'] = organizationId;
      result = await fetch(authzUrl, { headers, signal: controller.signal });
    } catch {
      throw new HttpError(503, 'MXGenius access verification is temporarily unavailable');
    } finally {
      clearTimeout(timeout);
    }
    if (result.status === 401) throw new HttpError(401, 'MXGenius sign-in required');
    if (result.status === 403) throw new HttpError(403, 'MXGenius access is not approved');
    if (!result.ok) throw new HttpError(503, 'MXGenius access verification is temporarily unavailable');
  })();

  authzCache.set(authorizationKey, { expiresAt: Date.now() + authzCacheTtlMs, promise });
  try {
    await promise;
    authzCache.set(authorizationKey, { expiresAt: Date.now() + authzCacheTtlMs, promise: null });
    return { key: authorizationKey, organizationId };
  } catch (error) {
    authzCache.delete(authorizationKey);
    throw error;
  }
}

function consumeRateLimit(key) {
  const now = Date.now();
  const current = rateWindows.get(key);
  if (!current || current.resetAt <= now) {
    rateWindows.set(key, { count: 1, resetAt: now + 60000 });
    return true;
  }
  current.count += 1;
  return current.count <= rateLimitPerMinute;
}

function providerRequest(method, path, body, bearer) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const request = https.request({
      hostname: providerHost,
      port: 443,
      path,
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {})
      },
      timeout: 120000
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode || 502, body: JSON.parse(raw) });
        } catch {
          reject(new Error('Provider returned an invalid response'));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Provider request timed out')));
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function organizationProviderAccount(organizationId) {
  if (organizationId && internalBearerToken) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetch(providerCredentialsUrl, {
        headers: {
          Authorization: `Bearer ${internalBearerToken}`,
          'X-MXG-Organization-ID': organizationId,
          Accept: 'application/json'
        },
        signal: controller.signal
      });
    } catch {
      throw new Error('Organization provider connection is temporarily unavailable');
    } finally {
      clearTimeout(timeout);
    }
    if (response.ok) {
      const value = await response.json();
      if (value?.identity && value?.credential) {
        return { identity: value.identity, credential: value.credential, source: 'organization' };
      }
      throw new Error('Organization provider connection is invalid');
    }
    if (response.status !== 404) {
      throw new Error('Organization provider connection could not be opened');
    }
  }
  if (!providerIdentity || !providerCredential) throw new Error('Provider access is not configured');
  return { identity: providerIdentity, credential: providerCredential, source: 'service' };
}

async function authenticate(organizationId) {
  const session = providerSession(organizationId);
  if (session.authenticating) return session.authenticating;
  session.authenticating = (async () => {
    const account = await organizationProviderAccount(organizationId);
    const result = await providerRequest('POST', '/api/Admin/APILogin', {
      EmailAddress: account.identity,
      Password: account.credential
    });
    if (!result.body?.bearerToken || !result.body?.apiToken) throw new Error('Provider authentication was rejected');
    session.bearer = result.body.bearerToken;
    session.apiToken = result.body.apiToken;
    session.credentialSource = account.source;
    session.loadedAt = Date.now();
  })().finally(() => { session.authenticating = null; });
  return session.authenticating;
}

function invalidSession(result) {
  return /(?:INVALID|EXPIRED) SECURITY TOKEN/i.test(String(result?.body?.responsestatus || ''));
}

function normalizeFleetSnapshot(result) {
  if (!Array.isArray(result?.body?.aircraft)) return result;
  return {
    ...result,
    body: {
      ...result.body,
      aircraft: result.body.aircraft.map((aircraft) => ({
        ...aircraft,
        baseiata: aircraft.baseiata || aircraft.acbaseiata || '',
        baseicao: aircraft.baseicao || aircraft.acbaseicao || '',
        basecity: aircraft.basecity || aircraft.acbasecity || '',
        basestate: aircraft.basestate || aircraft.acbasestate || '',
        basecountry: aircraft.basecountry || aircraft.acbasecountry || '',
        baseairport: aircraft.baseairport || aircraft.acbasename || '',
        owner: aircraft.owner || aircraft.owrcompanyname || aircraft.owrregisteredas || '',
        operator: aircraft.operator || aircraft.oprcompanyname || '',
        yearmfg: aircraft.yearmfg || aircraft.yearmfr || aircraft.yeardelivered || null
      }))
    }
  };
}

async function forward(method, path, body, organizationId) {
  const session = providerSession(organizationId);
  const snapshots = snapshotState(organizationId);
  const fleetSnapshot = snapshots.fleet;
  const aircraftListSnapshot = snapshots.aircraftList;
  if (!session.bearer || !session.apiToken) await authenticate(organizationId);
  const isAircraftList = path.includes('/Aircraft/getAircraftList/');
  const isSharedAircraftList = isAircraftList && (!body || Object.keys(body).length === 0);
  const isFleetSnapshot = path.includes('/Aircraft/getBulkAircraftExportPaged/');

  const execute = async () => {
    const providerPath = `/api${path.split('/').map((part) => part === 'LIVE_TOKEN' ? session.apiToken : part).join('/')}`;
    const providerMethod = method === 'PUT' ? 'POST' : method;
    let result = await providerRequest(providerMethod, providerPath, body, session.bearer);
    if (invalidSession(result)) {
      session.bearer = '';
      session.apiToken = '';
      await authenticate(organizationId);
      const retryPath = `/api${path.split('/').map((part) => part === 'LIVE_TOKEN' ? session.apiToken : part).join('/')}`;
      result = await providerRequest(providerMethod, retryPath, body, session.bearer);
    }
    return result;
  };

  if (isSharedAircraftList) {
    const snapshotAge = Date.now() - aircraftListSnapshot.loadedAt;
    if (aircraftListSnapshot.result && snapshotAge < fleetSnapshotTtlMs) {
      return aircraftListSnapshot.result;
    }
    if (aircraftListSnapshot.result) {
      if (!aircraftListSnapshot.inFlight) {
        aircraftListSnapshot.inFlight = execute()
          .then((result) => {
            if (result.status >= 200 && result.status < 300 && Array.isArray(result.body?.aircraft)) {
              aircraftListSnapshot.result = result;
              aircraftListSnapshot.loadedAt = Date.now();
            }
            return result;
          })
          .catch((error) => {
            console.error('Fleet map snapshot refresh failed:', error.message);
            return aircraftListSnapshot.result;
          })
          .finally(() => { aircraftListSnapshot.inFlight = null; });
      }
      return aircraftListSnapshot.result;
    }
    if (!aircraftListSnapshot.inFlight) {
      aircraftListSnapshot.inFlight = execute()
        .then((result) => {
          if (result.status >= 200 && result.status < 300 && Array.isArray(result.body?.aircraft)) {
            aircraftListSnapshot.result = result;
            aircraftListSnapshot.loadedAt = Date.now();
          }
          return result;
        })
        .finally(() => { aircraftListSnapshot.inFlight = null; });
    }
    return aircraftListSnapshot.inFlight;
  }

  if (isAircraftList) return execute();
  if (isFleetSnapshot && fleetSnapshot.result && Date.now() - fleetSnapshot.loadedAt < fleetSnapshotTtlMs) {
    return fleetSnapshot.result;
  }
  if (isFleetSnapshot && fleetSnapshot.inFlight) return fleetSnapshot.inFlight;

  if (!isFleetSnapshot) return execute();
  fleetSnapshot.inFlight = execute()
    .then((result) => {
      const normalizedResult = normalizeFleetSnapshot(result);
      if (normalizedResult.status >= 200 && normalizedResult.status < 300 && Array.isArray(normalizedResult.body?.aircraft)) {
        fleetSnapshot.result = normalizedResult;
        fleetSnapshot.loadedAt = Date.now();
      }
      return normalizedResult;
    })
    .finally(() => { fleetSnapshot.inFlight = null; });
  return fleetSnapshot.inFlight;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://mxgenius.io',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Correlation-ID,X-MXG-Organization-ID',
    'Access-Control-Expose-Headers': 'X-Correlation-ID',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

function respond(response, status, body, origin = '', extraHeaders = {}) {
  response.writeHead(status, { ...corsHeaders(origin), ...extraHeaders });
  response.end(JSON.stringify(body));
}

function fetchImage(sourceUrl) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      reject(new Error('Invalid image URL'));
      return;
    }
    if (parsed.protocol !== 'https:' || !imageHosts.has(parsed.hostname)) {
      reject(new Error('Image host is not allowed'));
      return;
    }
    const upstream = https.get(parsed, {
      headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      timeout: 30000
    }, (upstreamResponse) => {
      const contentType = String(upstreamResponse.headers['content-type'] || '');
      if ((upstreamResponse.statusCode || 502) !== 200 || !contentType.startsWith('image/')) {
        upstreamResponse.resume();
        reject(new Error('Image source did not return an image'));
        return;
      }
      const chunks = [];
      let size = 0;
      upstreamResponse.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxImageBytes) {
          upstreamResponse.destroy(new Error('Image exceeds size limit'));
          return;
        }
        chunks.push(chunk);
      });
      upstreamResponse.on('end', () => resolve({ body: Buffer.concat(chunks), contentType }));
      upstreamResponse.on('error', reject);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Image request timed out')));
    upstream.on('error', reject);
  });
}

async function proxyImage(request, response, origin) {
  const requestUrl = new URL(request.url, 'http://fleet-proxy.local');
  const image = await fetchImage(requestUrl.searchParams.get('url') || '');
  response.writeHead(200, {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://mxgenius.io',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    Vary: 'Origin',
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    'Content-Type': image.contentType,
    'Content-Length': image.body.length,
    'Cross-Origin-Resource-Policy': 'cross-origin'
  });
  response.end(image.body);
}

const server = http.createServer(async (request, response) => {
  const requestStartedAt = Date.now();
  const correlationId = String(request.headers['x-correlation-id'] || '').trim() || crypto.randomUUID();
  response.setHeader('X-Correlation-ID', correlationId);
  response.once('finish', () => {
    const pathname = String(request.url || '/').split('?', 1)[0].replace(/\/\d+(?=\/|$)/g, '/:id');
    console.log(JSON.stringify({
      event: 'fleet_request',
      correlation_id: correlationId,
      method: request.method,
      path: pathname,
      status: response.statusCode,
      duration_ms: Date.now() - requestStartedAt
    }));
  });
  const origin = String(request.headers.origin || '');
  if (request.method === 'OPTIONS') {
    if (origin && !allowedOrigins.has(origin)) return respond(response, 403, { error: 'Origin denied' }, origin);
    return respond(response, 204, {}, origin);
  }
  if (request.url === '/healthz') return respond(response, 200, { status: 'ok' }, origin);
  if (request.url === '/api/status') {
    const systemSession = providerSession('');
    const systemSnapshots = snapshotState('');
    return respond(response, 200, {
      ready: Boolean(systemSession.bearer && systemSession.apiToken),
      internalAccessConfigured: Boolean(internalBearerToken),
      aircraftListReady: Boolean(systemSnapshots.aircraftList.result),
      aircraftListAgeSeconds: systemSnapshots.aircraftList.result ? Math.floor((Date.now() - systemSnapshots.aircraftList.loadedAt) / 1000) : null,
      fleetSnapshotReady: Boolean(systemSnapshots.fleet.result),
      fleetSnapshotAgeSeconds: systemSnapshots.fleet.result ? Math.floor((Date.now() - systemSnapshots.fleet.loadedAt) / 1000) : null
    }, origin);
  }
  if (!request.url?.startsWith('/api/')) return respond(response, 404, { error: 'Not found' }, origin);
  if (origin && !allowedOrigins.has(origin)) return respond(response, 403, { error: 'Origin denied' }, origin);

  let requester;
  try {
    requester = await authorize(request);
  } catch (error) {
    return respond(response, error.status || 503, { error: error.message || 'Access verification failed' }, origin);
  }
  if (!consumeRateLimit(requester.key)) {
    return respond(response, 429, { error: 'Fleet request limit reached; retry shortly' }, origin, { 'Retry-After': '60' });
  }

  if (request.url === '/api/connection/refresh' && request.method === 'POST') {
    clearTenantState(requester.organizationId);
    return respond(response, 200, { refreshed: true }, origin);
  }

  if (request.url.startsWith('/api/image?')) {
    return proxyImage(request, response, origin).catch((error) => {
      console.error('Fleet image proxy failed:', error.message);
      if (!response.headersSent) respond(response, 502, { error: 'Image temporarily unavailable' }, origin);
      else response.destroy();
    });
  }
  let raw = '';
  let tooLarge = false;
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    if (tooLarge) return;
    raw += chunk;
    if (raw.length > 2_000_000) {
      tooLarge = true;
      raw = '';
    }
  });
  request.on('end', async () => {
    try {
      if (tooLarge) return respond(response, 413, { error: 'Request body is too large' }, origin);
      let body = raw ? JSON.parse(raw) : null;
      if (request.url.includes('/Aircraft/getBulkAircraftExportPaged/') && (!body || Object.keys(body).length === 0)) {
        body = { pageSize: 50, pageNumber: 1, make: 'Gulfstream' };
      }
      const result = await forward(request.method || 'GET', request.url.slice(4), body, requester.organizationId);
      respond(response, result.status, result.body, origin);
    } catch (error) {
      console.error('Fleet proxy request failed:', error.message);
      respond(response, 502, { responsestatus: 'Fleet provider temporarily unavailable' }, origin);
    }
  });
});

authenticate('')
  .then(() => console.log('Fleet provider session ready.'))
  .catch((error) => console.error('Fleet provider startup failed:', error.message));

server.listen(port, '0.0.0.0', () => console.log(`Fleet proxy listening on ${port}.`));
