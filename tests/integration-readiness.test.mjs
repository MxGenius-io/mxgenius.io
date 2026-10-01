import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../integration-readiness.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../integration-readiness.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../integration-readiness.css', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const auth = await readFile(new URL('../auth.js', import.meta.url), 'utf8');
const operationsCenter = await readFile(new URL('../operations-center.html', import.meta.url), 'utf8');

test('Integration Readiness stays authenticated behind the consolidated Operations Center', () => {
  assert.doesNotMatch(dashboard, /value="integration-readiness\.html">Integration Readiness/);
  assert.match(dashboard, /id="settingsOperationsCenterOpen"[^>]*>Open Operations Center/);
  assert.match(auth, /dashboard\|operations-center\|progress\|patent-workspace\|build-board\|feedback\|feedback-admin\|integration-readiness/);
  assert.match(auth, /operations-center\|progress\|patent-workspace\|build-board\|feedback\|feedback-admin\|integration-readiness/);
  assert.match(html, /src="auth\.js\?v=\d+"/);
  assert.match(html, /src="application-client\.js\?v=\d+"/);
});

test('the workspace owns the four requested editable lists', () => {
  for (const label of [
    'What must MXGenius talk to?',
    'What attaches to the demo box?',
    'What should a correct answer look like?',
    'What must move under MXGenius?',
    '+ Add software',
    '+ Add device',
    '+ Add process',
    '+ Add migration'
  ]) assert.match(html, new RegExp(label.replace(/[+?]/g, '\\$&')));
  assert.match(js, /state\.document\.software\.unshift/);
  assert.match(js, /state\.document\.devices\.unshift/);
  assert.match(js, /state\.document\.workflows\.unshift/);
  assert.match(js, /state\.document\.migrations\.unshift/);
  assert.match(js, /Remove from checklist/);
});

test('migration separates entity ownership, access, and service cutover', () => {
  for (const name of [
    'Azure account ownership + operator access',
    'Azure production services, data + secrets cutover',
    'Apple Developer + App Store Connect',
    'Microsoft Partner Center',
    'GitHub organization + release ownership',
    'Domain, DNS + company email administration',
    'Meta Horizon developer team + Quest builds',
    'Vendor, API + data subscription ownership',
    'Edge release artifacts, checksums + retention custody',
    'OpenSky/API quota, credentials + provider ownership'
  ]) assert.match(js, new RegExp(name.replace(/[+/.]/g, '\\$&')));
  assert.match(js, /Josh — confirm developer account; Rock — proposed setup lead \(confirm\)/);
  assert.match(js, /self-imposed, not represented as a Microsoft requirement/i);
  assert.match(js, /person who configures money to another account should not be the only person operating or approving/i);
  assert.match(js, /Complete and test Azure company ownership and operator access first/i);
  assert.match(js, /Array\.isArray\(input\.migrations\).*clone\(starterMigrations\)/);
});

test('migration provides current official help paths without crowding the first view', () => {
  for (const domain of ['learn.microsoft.com', 'developer.apple.com', 'docs.github.com', 'developers.meta.com', 'www.icann.org']) {
    assert.match(js, new RegExp(domain.replace('.', '\\.')));
  }
  assert.match(js, /Open official help ↗/);
  assert.match(html, /class="supporting-disclosure migration-guide"/);
  assert.match(html, /Access first\.[\s\S]*Then transfer\.[\s\S]*Prove the handoff\./);
});

test('starter software inventory includes known external, live-flight, model, and internal boundaries', () => {
  for (const name of ['Microsoft Teams', 'ADP', 'FAA Dynamic Regulatory System', 'Boeing technical data', 'JetNet', 'Microsoft Entra ID', 'Internal maintenance / MRO record system', 'OpenSky Network live traffic', 'AI model runtime and response reliability']) {
    assert.match(js, new RegExp(name.replace(/[/.]/g, '\\$&')));
  }
  assert.match(js, /never declares compliance/i);
  assert.match(js, /licensing limits/);
});

test('starter hardware separates enclosure internals, power/data paths, and attached demo equipment', () => {
  const starterDevices = js.match(/const starterDevices = \[([\s\S]*?)\n  \];\n\n  const starterWorkflows/)[1];
  for (const name of ['Raspberry Pi 5 · 16 GB', 'DeWalt battery + adapter', 'DC step-down converter', 'External port panel + cable harness', 'FLIR ONE thermal camera', 'Meta Quest headset', 'Pressure gauge / transducer', 'iPhone / iPad test device', '52Pi direct GPIO power path', 'USB-C mass-storage gadget and data path']) {
    assert.match(starterDevices, new RegExp(name.replace(/[+/.]/g, '\\$&')));
  }
  assert.doesNotMatch(starterDevices, /Enclosure cooling fan|Demo drill \/ driver/);
  assert.equal((starterDevices.match(/id: 'device-/g) || []).length, 10);
  assert.equal((starterDevices.match(/status: 'ready_to_test'/g) || []).length, 10);
  assert.doesNotMatch(starterDevices, /status: 'needs_input'/);
  assert.match(html, /Inside[\s\S]*Pi 5 · 16 GB[\s\S]*Outside/);
  assert.match(js, /calibration/);
  assert.match(js, /What the first demo must prove/);
});

test('structured output is explained in executive language with human authority intact', () => {
  const starterWorkflows = js.match(/const starterWorkflows = \[([\s\S]*?)\n  \];\n\n  const starterMigrations/)[1];
  assert.match(html, /What “structured output” means/);
  for (const label of ['Observation', 'Evidence', 'Meaning', 'Next action', 'Human decision', 'Record']) assert.match(html, new RegExp(label));
  assert.match(html, /Use approved aircraft data/);
  assert.match(html, /Values and limits are never assumed/);
  assert.equal((starterWorkflows.match(/id: 'workflow-/g) || []).length, 6);
  for (const name of ['Commission, update, and recover the Pi appliance', 'Complete the Equipment Drive transfer lifecycle', 'Run a Remote Witness support session', 'Transition between VR and AR without losing work', 'Stop and recover a model response loop', 'Select and follow a live flight trip']) {
    assert.match(starterWorkflows, new RegExp(name.replace(/[+/.]/g, '\\$&')));
  }
  assert.doesNotMatch(starterWorkflows, /status: 'needs_input'/);
  assert.doesNotMatch(starterWorkflows, /Troubleshoot a maintenance discrepancy|Interpret a connected tool or sensor reading|Identify, source, and request a part|Review an FAA or OEM requirement|Create a shift, escalation, or remote-support handoff/);
  assert.match(js, /Gold-standard example for MXGenius to mimic/);
});

test('the shared checklist persists with optimistic versioning and safe DOM rendering', () => {
  assert.match(js, /WORKSPACE_KEY = 'integration-readiness'/);
  assert.match(js, /projectWorkspaces\.get/);
  assert.match(js, /projectWorkspaces\.save/);
  assert.match(js, /expectedVersion: state\.version/);
  assert.match(js, /WORKSPACE_VERSION_CONFLICT/);
  assert.match(js, /element\.textContent = text/);
  assert.doesNotMatch(js, /innerHTML/);
  assert.match(js, /beforeunload/);
  assert.match(js, /READINESS_SCHEMA_VERSION = 4/);
  assert.match(js, /READINESS_V3_IDS/);
  assert.match(js, /READINESS_V4_REMOVED_DEVICE_IDS/);
  assert.match(js, /READINESS_V4_REMOVED_DEVICE_NAMES/);
  assert.match(js, /inputSchemaVersion < 3/);
  assert.match(js, /inputSchemaVersion < 4\) applyReadinessV4\(document\)/);
  assert.match(js, /mergeStarterUpgrade/);
  assert.match(js, /needsSchemaSave/);
  assert.match(js, /needsInitialSave = !workspace/);
  assert.match(js, /state\.dirty = needsInitialSave \|\| needsSchemaSave/);
  assert.match(js, /elements\.save\.disabled = !state\.dirty/);
  assert.match(js, /save to publish it/);
});

test('readiness v4 clears retired and yellow work while leaving migrations outside the v4 transform', () => {
  const migration = js.match(/function applyReadinessV4\(document\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(migration, /READINESS_V4_REMOVED_DEVICE_IDS/);
  assert.match(migration, /READINESS_V4_REMOVED_DEVICE_NAMES/);
  assert.match(migration, /status: 'ready_to_test'/);
  assert.match(migration, /item\.status !== 'needs_input'/);
  assert.doesNotMatch(migration, /migrations/);
  assert.match(html, /integration-readiness\.js\?v=5/);
  assert.match(operationsCenter, /integration-readiness\.html\?embed=1&amp;release=readiness-v5/);
});

test('progressive disclosure keeps the first view light and forms usable on narrow screens', () => {
  assert.match(html, /class="guide-steps"/);
  assert.match(html, /class="available-disclosure"/);
  assert.match(html, /class="supporting-disclosure example-disclosure"/);
  assert.match(html, /<details id="software" class="checklist-section" open>/);
  assert.match(html, /<details id="devices" class="checklist-section">/);
  assert.match(html, /<details id="outputs" class="checklist-section">/);
  assert.match(html, /<details id="migration" class="checklist-section">/);
  assert.match(js, /details\.open = state\.openItemId === item\.id/);
  assert.match(js, /makeElement\('span', 'summary-meta'\)/);
  assert.match(css, /grid-template-columns: 26px minmax\(180px, 1fr\) auto auto/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
});
