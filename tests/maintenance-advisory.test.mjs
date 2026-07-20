import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../application-client.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const backend = await readFile(new URL('../services/mcp/server/src/transport/http.rs', import.meta.url), 'utf8');

test('chat requests strict MRO structured output and retrieves 33 manual records', () => {
  assert.match(backend, /"type": "json_schema"/);
  assert.match(backend, /"strict": true/);
  assert.match(backend, /limit: Some\(33\)/);
  assert.match(backend, /"requested": 33/);
});

test('structured advisory keeps chat and renders semantic percentages without diagnostic claims', () => {
  assert.match(app, /response_kind !== 'maintenance_advisory'/);
  assert.match(app, /% semantic match/);
  assert.match(app, /evidence strength/);
  assert.match(app, /What Worked in Retrieved Records/);
});

test('manual images stay behind the application API boundary', () => {
  assert.match(client, /manualAssetUrl/);
  assert.match(client, /\/manual-assets\?reference=/);
  assert.match(app, /MXApplicationClient\.evidence\.manualAssetUrl/);
  assert.match(dashboard, /app\.js\?v=12/);
});
