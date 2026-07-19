import assert from 'node:assert/strict';
import { test } from 'node:test';

const SITE = process.env.MXGENIUS_SITE_URL || 'https://mxgenius.io';
const API = process.env.MXGENIUS_API_URL || 'https://mxg-api.kindbush-8fee3a17.centralus.azurecontainerapps.io';

async function get(path, base = SITE) {
  return fetch(`${base}${path}`, {
    headers: { 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(20_000)
  });
}

test('landing page is reachable and contains the deployed carousel copy', async () => {
  const response = await get('/?smoke=application-plane');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Transform Your Operations<\/h1>/);
});

test('dashboard shell and retained navigation are reachable', async () => {
  const response = await get('/dashboard.html?smoke=application-plane');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /data-tab="dashboard"/);
  assert.match(html, /data-tab="3d-viewer"/);
  assert.match(html, /id="ai-chat-panel"/);
});

test('Azure application API health endpoint is reachable', async () => {
  const response = await get('/healthz', API);
  assert.equal(response.status, 200);
});

test('3D model catalog is reachable and non-empty', async () => {
  const response = await get('/3d-viewer/models.json');
  assert.equal(response.status, 200);
  const catalog = await response.json();
  const models = Array.isArray(catalog) ? catalog : catalog.models;
  assert.ok(Array.isArray(models));
  assert.ok(models.length >= 7);
});

test('known dormant technical-library bundles remain visibly unavailable', async () => {
  for (const path of [
    '/display_index/catalog.json',
    '/faa_data/faa_ads_slim.json',
    '/rag_image_map.json'
  ]) {
    const response = await get(path);
    assert.equal(response.status, 404, `${path} should remain an explicit known gap`);
  }
});

