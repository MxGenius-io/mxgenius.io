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
const authzCacheTtlMs = Math.max(0, Number(process.env.MXGENIUS_AUTHZ_CACHE_SECONDS || 10)) * 1000;
const rateLimitPerMinute = Math.max(10, Number(process.env.FLEET_RATE_LIMIT_PER_MINUTE || 180));
const internalBearerToken = process.env.MXGENIUS_INTERNAL_BEARER_TOKEN || '';
const allowedOrigins = new Set([
  'https://mxgenius.io',
  'https://www.mxgenius.io'
]);

const session = { bearer: '', apiToken: '', authenticating: null };
const fleetSnapshot = { result: null, loadedAt: 0, inFlight: null };
const fleetSnapshotTtlMs = 30 * 60 * 1000;
const imageHosts = new Set(['evo-assets-3wl.s3.us-west-2.amazonaws.com']);
const maxImageBytes = 15 * 1024 * 1024;
const authzCache = new Map();
const rateWindows = new Map();

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
  if (isInternalBearer(token)) return `internal:${fingerprint}`;
  const cached = authzCache.get(fingerprint);
  if (cached?.expiresAt > Date.now()) {
    if (cached.promise) await cached.promise;
    return fingerprint;
  }

  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let result;
    try {
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      const organizationId = String(request.headers['x-mxg-organization-id'] || '').trim();
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

  authzCache.set(fingerprint, { expiresAt: Date.now() + authzCacheTtlMs, promise });
  try {
    await promise;
    authzCache.set(fingerprint, { expiresAt: Date.now() + authzCacheTtlMs, promise: null });
    return fingerprint;
  } catch (error) {
    authzCache.delete(fingerprint);
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

async function authenticate() {
  if (session.authenticating) return session.authenticating;
  session.authenticating = (async () => {
    if (!providerIdentity || !providerCredential) throw new Error('Provider access is not configured');
    const result = await providerRequest('POST', '/api/Admin/APILogin', {
      EmailAddress: providerIdentity,
      Password: providerCredential
    });
    if (!result.body?.bearerToken || !result.body?.apiToken) throw new Error('Provider authentication was rejected');
    session.bearer = result.body.bearerToken;
    session.apiToken = result.body.apiToken;
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

async function forward(method, path, body) {
  if (!session.bearer || !session.apiToken) await authenticate();
  if (path.includes('/Aircraft/getAircraftList/')) {
    path = `${path.replace('/Aircraft/getAircraftList/', '/Aircraft/getBulkAircraftExportPaged/')}/50/1`;
    method = 'POST';
    body = { pageSize: 50, pageNumber: 1, make: 'Gulfstream' };
  }

  const isFleetSnapshot = path.includes('/Aircraft/getBulkAircraftExportPaged/');
  if (isFleetSnapshot && fleetSnapshot.result && Date.now() - fleetSnapshot.loadedAt < fleetSnapshotTtlMs) {
    return fleetSnapshot.result;
  }
  if (isFleetSnapshot && fleetSnapshot.inFlight) return fleetSnapshot.inFlight;

  const execute = async () => {
    const providerPath = `/api${path.split('/').map((part) => part === 'LIVE_TOKEN' ? session.apiToken : part).join('/')}`;
    const providerMethod = method === 'PUT' ? 'POST' : method;
    let result = await providerRequest(providerMethod, providerPath, body, session.bearer);
    if (invalidSession(result)) {
      session.bearer = '';
      session.apiToken = '';
      await authenticate();
      const retryPath = `/api${path.split('/').map((part) => part === 'LIVE_TOKEN' ? session.apiToken : part).join('/')}`;
      result = await providerRequest(providerMethod, retryPath, body, session.bearer);
    }
    return result;
  };

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
  if (request.url === '/api/status') return respond(response, 200, {
    ready: Boolean(session.bearer && session.apiToken),
    internalAccessConfigured: Boolean(internalBearerToken),
    fleetSnapshotReady: Boolean(fleetSnapshot.result),
    fleetSnapshotAgeSeconds: fleetSnapshot.result ? Math.floor((Date.now() - fleetSnapshot.loadedAt) / 1000) : null
  }, origin);
  if (!request.url?.startsWith('/api/')) return respond(response, 404, { error: 'Not found' }, origin);
  if (origin && !allowedOrigins.has(origin)) return respond(response, 403, { error: 'Origin denied' }, origin);

  let requester;
  try {
    requester = await authorize(request);
  } catch (error) {
    return respond(response, error.status || 503, { error: error.message || 'Access verification failed' }, origin);
  }
  if (!consumeRateLimit(requester)) {
    return respond(response, 429, { error: 'Fleet request limit reached; retry shortly' }, origin, { 'Retry-After': '60' });
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
      const result = await forward(request.method || 'GET', request.url.slice(4), body);
      respond(response, result.status, result.body, origin);
    } catch (error) {
      console.error('Fleet proxy request failed:', error.message);
      respond(response, 502, { responsestatus: 'Fleet provider temporarily unavailable' }, origin);
    }
  });
});

authenticate()
  .then(() => console.log('Fleet provider session ready.'))
  .catch((error) => console.error('Fleet provider startup failed:', error.message));

server.listen(port, '0.0.0.0', () => console.log(`Fleet proxy listening on ${port}.`));
