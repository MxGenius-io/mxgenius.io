import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('dashboard.html', 'utf8');
const js = readFileSync('parts-workspace.js', 'utf8');
const client = readFileSync('application-client.js', 'utf8');
const css = readFileSync('parts-workspace.css', 'utf8');

test('Parts Frontend Shell requirements', async (t) => {
  await t.test('dashboard.html contains parts navigation', () => {
    assert.match(html, /data-tab="parts"/);
    assert.match(html, /id="partsNav"/);
    assert.match(html, /id="tab-parts"/);
  });

  await t.test('dashboard.html includes parts CSS and JS', () => {
    assert.match(html, /href="parts-workspace\.css\?v=\d+"/);
    assert.match(html, /src="parts-workspace\.js\?v=\d+"/);
  });

  await t.test('application-client.js exposes the production parts namespace', () => {
    assert.match(client, /const parts = Object\.freeze\({/);
    for (const operation of [
      'search', 'getUnit', 'createReceivingDraft', 'registerAssetUpload',
      'uploadAsset', 'requestExtraction', 'reviewExtraction',
      'confirmReceiving', 'listDocuments', 'listTransactions',
      'getFaaCandidates', 'getLabel'
    ]) {
      assert.match(client, new RegExp(`${operation}: async`), `${operation} should be exposed`);
    }
    assert.match(client, /\/api\/parts/);
    assert.doesNotMatch(client, /mockUnits|unit-\s*\+\s*Date\.now/);
  });

  await t.test('parts-workspace.js avoids direct fetch calls', () => {
    assert.doesNotMatch(js, /fetch\(/, 'parts-workspace.js must not call fetch directly');
  });

  await t.test('parts-workspace.js defines the receiving wizard steps', () => {
    assert.match(js, /data-step="1"/);
    assert.match(js, /data-step="4"/);
    assert.match(js, /id="wizardStep4"/);
  });

  await t.test('parts-workspace.js escapes HTML to prevent XSS (OCR Review)', () => {
    assert.match(js, /function escapeHtml/);
    assert.match(js, /escapeHtml\(candidate\.proposedValue/);
  });

  await t.test('parts-workspace.js implements authenticated routing, search, OCR review, and receiving', () => {
    assert.match(js, /switchTab\?\.\('parts'\)/);
    assert.match(js, /client\.search\(\{ query: state\.query, session: await session\(\) \}\)/);
    assert.match(js, /client\.reviewExtraction\(/);
    assert.match(js, /client\.confirmReceiving\(/);
    assert.match(js, /crypto\.subtle\.digest\('SHA-256'/);
    assert.match(js, /crypto\.randomUUID\(\)/);
  });

  await t.test('parts workspace has no simulated success or mock rendering path', () => {
    assert.doesNotMatch(js, /mock content|simulate async/i);
    assert.doesNotMatch(client, /mock/i);
  });

  await t.test('part details dock beside inventory on desktop and become a drawer on narrow screens', () => {
    assert.match(js, /<main class="parts-main">/);
    assert.match(js, /drawer\.setAttribute\('aria-hidden', 'false'\)/);
    assert.match(js, /drawer\?\.setAttribute\('aria-hidden', 'true'\)/);
    assert.match(css, /\.parts-workspace\s*\{[\s\S]*flex-direction:\s*row;/);
    assert.match(css, /\.parts-drawer\.open\s*\{[\s\S]*flex-basis:\s*var\(--parts-drawer-width\);/);
    assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.parts-drawer\.open[\s\S]*transform:\s*translateX\(0\);/);
  });
});
