import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../application-client.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const backend = await readFile(new URL('../services/mcp/server/src/transport/http.rs', import.meta.url), 'utf8');
const manualAdapter = await readFile(new URL('../services/mcp/server/src/adapters/manual.rs', import.meta.url), 'utf8');

test('chat requests strict MRO structured output and retrieves 33 manual records', () => {
  assert.match(backend, /"type": "json_schema"/);
  assert.match(backend, /"strict": true/);
  assert.match(backend, /limit: Some\(33\)/);
  assert.match(backend, /MODEL_MANUAL_RECORD_LIMIT: usize = 12/);
  assert.match(backend, /build_manual_search_query/);
  assert.match(manualAdapter, /"searchFields": "title,section,content,aircraft_model"/);
  assert.match(manualAdapter, /"vectorFilterMode": "preFilter"/);
  assert.match(manualAdapter, /ata eq/);
  assert.match(backend, /Every technical procedure, limit, interval, or part claim must cite/);
  assert.match(backend, /"requested": 33/);
});

test('structured advisory keeps chat and labels retrieval relevance without diagnostic claims', () => {
  assert.match(app, /response_kind !== 'maintenance_advisory'/);
  assert.match(app, /% retrieval relevance/);
  assert.match(app, /evidence strength/);
  assert.match(app, /What Worked in Retrieved Records/);
});

test('manual images stay behind the application API boundary', () => {
  assert.match(client, /manualAssetUrl/);
  assert.match(client, /\/manual-assets\?reference=/);
  assert.match(app, /MXApplicationClient\.evidence\.manualAssetUrl/);
  assert.match(dashboard, /app\.js\?v=\d+/);
});
