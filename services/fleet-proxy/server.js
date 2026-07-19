'use strict';

const http = require('node:http');
const https = require('node:https');

const port = Number(process.env.PORT || 8080);
const providerHost = 'customer.jetnetconnect.com';
const providerIdentity = process.env.JETNET_IDENTITY || '';
const providerCredential = process.env.JETNET_CREDENTIAL || '';
const allowedOrigins = new Set([
  'https://mxgenius.io',
  'https://www.mxgenius.io'
]);

const session = { bearer: '', apiToken: '', authenticating: null };

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
  return /INVALID SECURITY TOKEN/i.test(String(result?.body?.responsestatus || ''));
}

async function forward(method, path, body) {
  if (!session.bearer || !session.apiToken) await authenticate();
  if (method === 'GET' && path.includes('/Aircraft/getAircraftList/')) {
    path = `${path.replace('/Aircraft/getAircraftList/', '/Aircraft/getBulkAircraftExportPaged/')}/5000/1`;
    method = 'POST';
    body = { pageSize: 50, pageNumber: 1, make: 'Gulfstream' };
  }
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
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://mxgenius.io',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Correlation-ID',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

function respond(response, status, body, origin = '') {
  response.writeHead(status, corsHeaders(origin));
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  const origin = String(request.headers.origin || '');
  if (request.method === 'OPTIONS') return respond(response, 204, {}, origin);
  if (request.url === '/healthz') return respond(response, 200, { status: 'ok' }, origin);
  if (request.url === '/api/status') return respond(response, 200, { ready: Boolean(session.bearer && session.apiToken) }, origin);
  if (!request.url?.startsWith('/api/')) return respond(response, 404, { error: 'Not found' }, origin);
  if (origin && !allowedOrigins.has(origin)) return respond(response, 403, { error: 'Origin denied' }, origin);

  let raw = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 2_000_000) request.destroy();
  });
  request.on('end', async () => {
    try {
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
