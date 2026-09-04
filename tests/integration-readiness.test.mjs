import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../integration-readiness.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../integration-readiness.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../integration-readiness.css', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const auth = await readFile(new URL('../auth.js', import.meta.url), 'utf8');

test('Settings exposes one authenticated Integration Readiness workspace', () => {
  assert.equal((dashboard.match(/value="integration-readiness\.html"/g) || []).length, 1);
  assert.match(dashboard, /value="integration-readiness\.html">Integration Readiness/);
  assert.match(auth, /dashboard\|progress\|patent-workspace\|build-board\|feedback\|feedback-admin\|integration-readiness/);
  assert.match(auth, /progress\|patent-workspace\|build-board\|feedback\|feedback-admin\|integration-readiness/);
  assert.match(html, /src="auth\.js\?v=12"/);
  assert.match(html, /src="application-client\.js\?v=\d+"/);
});

test('the workspace owns the three requested editable lists', () => {
  for (const label of [
    'What must MXGenius talk to?',
    'What attaches to the demo box?',
    'What should a correct answer look like?',
    '+ Add software',
    '+ Add device',
    '+ Add process'
  ]) assert.match(html, new RegExp(label.replace(/[+?]/g, '\\$&')));
  assert.match(js, /state\.document\.software\.unshift/);
  assert.match(js, /state\.document\.devices\.unshift/);
  assert.match(js, /state\.document\.workflows\.unshift/);
  assert.match(js, /Remove from checklist/);
});

test('starter software inventory includes known external and internal boundaries', () => {
  for (const name of ['Microsoft Teams', 'ADP', 'PartSpace', 'FAA Dynamic Regulatory System', 'Boeing technical data', 'JetNet', 'Microsoft Entra ID', 'Internal maintenance / MRO record system']) {
    assert.match(js, new RegExp(name.replace(/[/.]/g, '\\$&')));
  }
  assert.match(js, /no autonomous purchase/i);
  assert.match(js, /never declares compliance/i);
  assert.match(js, /licensing limits/);
});

test('starter hardware separates enclosure internals from attached demo equipment', () => {
  for (const name of ['Raspberry Pi 5 · 16 GB', 'DeWalt battery + adapter', 'DC step-down converter', 'External port panel + cable harness', 'Enclosure cooling fan', 'FLIR ONE thermal camera', 'Meta Quest headset', 'Demo drill / driver', 'Pressure gauge / transducer']) {
    assert.match(js, new RegExp(name.replace(/[+/.]/g, '\\$&')));
  }
  assert.match(html, /Inside[\s\S]*Pi 5 · 16 GB[\s\S]*Outside/);
  assert.match(js, /calibration/);
  assert.match(js, /What the first demo must prove/);
});

test('structured output is explained in executive language with human authority intact', () => {
  assert.match(html, /What “structured output” means/);
  for (const label of ['Observation', 'Evidence', 'Meaning', 'Next action', 'Human decision', 'Record']) assert.match(html, new RegExp(label));
  assert.match(html, /Use approved aircraft data/);
  assert.match(html, /Values and limits are never assumed/);
  assert.equal((js.match(/id: 'workflow-/g) || []).length, 5);
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
});

test('progressive disclosure keeps the first view light and forms usable on narrow screens', () => {
  assert.match(html, /class="guide-steps"/);
  assert.match(html, /class="available-disclosure"/);
  assert.match(html, /class="supporting-disclosure example-disclosure"/);
  assert.match(html, /<details id="software" class="checklist-section" open>/);
  assert.match(html, /<details id="devices" class="checklist-section">/);
  assert.match(html, /<details id="outputs" class="checklist-section">/);
  assert.match(js, /details\.open = state\.openItemId === item\.id/);
  assert.match(js, /makeElement\('span', 'summary-meta'\)/);
  assert.match(css, /grid-template-columns: 26px minmax\(180px, 1fr\) auto auto/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
});
