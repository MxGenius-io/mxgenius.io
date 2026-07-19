import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const application = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../3d-viewer/index.html', import.meta.url), 'utf8');
const modelCatalog = JSON.parse(await readFile(new URL('../3d-viewer/models.json', import.meta.url), 'utf8'));

function matches(pattern, text = dashboard) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

test('dashboard element IDs are unique', () => {
  const ids = matches(/\bid="([^"]+)"/g);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();
  assert.deepEqual(duplicates, []);
});

test('every navigation tab resolves to exactly one panel', () => {
  const tabs = matches(/\bdata-tab="([^"]+)"/g);
  assert.deepEqual(tabs.sort(), ['3d-viewer', 'dashboard', 'settings']);

  for (const tab of tabs) {
    const escaped = tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const panelCount = (dashboard.match(new RegExp(`id="tab-${escaped}"`, 'g')) || []).length;
    assert.equal(panelCount, 1, `tab-${tab} should exist exactly once`);
  }
});

test('critical retained surfaces remain present', () => {
  const requiredIds = [
    'tab-dashboard',
    'tab-3d-viewer',
    'tab-settings',
    'tab-docs',
    'globeViz',
    'aircraftGrid',
    'acDetailModal',
    'ai-chat-panel',
    'work-order-panel'
  ];

  for (const id of requiredIds) {
    assert.match(dashboard, new RegExp(`id="${id}"`), `${id} should remain present`);
  }
  assert.match(application, /function buildMROSignals\(/, 'fleet triage heuristic should remain available');
});

test('technical library remains deliberately dormant before adapter mount', () => {
  assert.doesNotMatch(dashboard, /data-tab="docs"/);
  assert.match(application, /display_index\/catalog\.json/);
  assert.match(application, /faa_data\/faa_ads_slim\.json/);
});

test('known POC-only data and loaders are absent', () => {
  for (const loader of ['loadProspecting', 'loadBases', 'loadCompliance', 'loadMarketplace']) {
    assert.doesNotMatch(application, new RegExp(loader), `${loader} must be removed`);
  }

  for (const fakeRecord of ['Acme Aviation', 'Advanced AOG Primary', 'N100GS', 'AeroParts Global']) {
    assert.doesNotMatch(application, new RegExp(fakeRecord), `${fakeRecord} must not ship as product data`);
  }

  assert.doesNotMatch(application, /Token Marketplace/i);
});

test('application script order preserves cache and client prerequisites', () => {
  const cacheIndex = dashboard.indexOf('<script src="cache.js"></script>');
  const clientIndex = dashboard.indexOf('<script src="application-client.js"></script>');
  const appIndex = dashboard.indexOf('<script src="app.js"></script>');

  assert.ok(cacheIndex >= 0, 'cache.js should be loaded');
  assert.ok(clientIndex > cacheIndex, 'application-client.js should load after cache.js');
  assert.ok(appIndex > clientIndex, 'app.js should load after application-client.js');
});

test('3D viewer exposes raycast selection through the application boundary', () => {
  assert.match(viewer, /new THREE\.Raycaster\(\)/);
  assert.match(viewer, /intersectObject\(currentModel, true\)/);
  assert.match(viewer, /mxgenius\.viewer\.part-selected/);
  assert.match(viewer, /mxgenius\.viewer\.highlight-part/);
  assert.match(application, /window\.MX3DViewer = MX3DViewer/);
  assert.match(application, /mxgenius:part-selected/);
});

test('bundled 3D catalog does not claim demo assets are validated operational twins', () => {
  assert.ok(modelCatalog.length > 0);
  for (const model of modelCatalog) {
    assert.equal(model.operationalStatus, 'demo_asset', `${model.file} must be explicitly classified`);
  }
});
