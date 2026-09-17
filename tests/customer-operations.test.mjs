import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../operations-center.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../operations-center.css', import.meta.url), 'utf8');
const js = await readFile(new URL('../customer-operations.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../application-client.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');

test('Operations Center owns one modular customer dashboard', () => {
  assert.match(html, /data-tab="customers"/);
  assert.match(html, /data-panel="customers"/);
  for (const id of [
    'customerDirectoryList', 'customerCreateForm', 'customerDetail',
    'settingsDevicesCard', 'settingsPacksCard', 'customerPaymentForm',
    'customerTelemetryList'
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(dashboard, /id="settingsDevicesCard"|id="settingsPacksCard"/);
});

test('customer dashboard reuses the real device and Equipment Drive clients', () => {
  assert.match(html, /equipment-pack-workspace\.js\?v=12/);
  assert.match(js, /MXEquipmentPacks\?\.init/);
  assert.match(js, /MXApplicationClient/);
  assert.match(js, /client\.edgeDevices\.approveClaim/);
  assert.match(js, /client\.edgeDevices\.revoke/);
  assert.match(js, /client\.customerAccounts\.assignDevice/);
  assert.match(client, /customerAccounts: Object\.freeze/);
  assert.match(client, /\/api\/customer-accounts/);
  assert.doesNotMatch(js, /localStorage|sessionStorage/);
});

test('customer account supports multiple devices, payment history, and ledger-derived health', () => {
  assert.match(js, /customerAccountId/);
  assert.match(js, /recordPayment/);
  assert.match(js, /latestDeploymentState/);
  assert.match(js, /latestErrorCode/);
  assert.match(html, /stores no card or processor credentials/);
  assert.match(css, /\.customer-module--devices/);
  assert.match(css, /\.customer-module--billing/);
  assert.match(css, /\.customer-module--telemetry/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
