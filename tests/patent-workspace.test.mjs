import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../patent-workspace.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../patent-workspace.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../patent-workspace.css', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const auth = await readFile(new URL('../auth.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../application-client.js', import.meta.url), 'utf8');

test('Settings exposes the shared provisional patent workspace before the future build plan', () => {
  assert.match(dashboard, /id="settingsWorkspacesCard"/);
  assert.match(dashboard, /value="patent-workspace\.html">Provisional Patent Application/);
  assert.match(dashboard, /Final Build Plan · coming next/);
  assert.match(html, /Back to Settings/);
});

test('the patent workspace is authenticated and uses only the application client boundary', () => {
  assert.match(auth, /dashboard\|progress\|patent-workspace/);
  assert.match(auth, /mx_auth_protected_return/);
  assert.match(auth, /progress\|patent-workspace/);
  assert.match(html, /src="auth\.js\?v=\d+"/);
  assert.match(html, /src="application-client\.js\?v=\d+"/);
  assert.doesNotMatch(js, /fetch\(/);
  assert.match(client, /projectWorkspaces: Object\.freeze/);
  assert.match(client, /\/api\/project-workspaces/);
});

test('the existing draft is converted into bounded decision sections', () => {
  for (const section of [
    'People & ownership',
    'Disclosure & filing facts',
    'Technical disclosure',
    'Drawing intake',
    'Substantive review',
    'Filing readiness'
  ]) {
    assert.match(js, new RegExp(section.replace(/[&]/g, '&')));
  }
  assert.match(js, /Perspective assembly/);
  assert.match(js, /Kit and installation method/);
  assert.match(js, /WORKSPACE_VERSION_CONFLICT/);
  assert.match(js, /expectedVersion: state\.version/);
});

test('the requested inventor names are prefilled but remain proposed pending filing facts', () => {
  for (const inventor of ['Dwayne Tillman', 'Joshua Millard', 'Thomas Hagy']) {
    assert.match(js, new RegExp(inventor));
  }
  assert.match(js, /defaultState: 'proposed'/);
  assert.match(js, /specific feature or concept they personally conceived/);
});

test('references are private blob-backed application assets and the UI is responsive', () => {
  assert.match(js, /projectWorkspaces\.uploadAsset/);
  assert.match(js, /projectWorkspaces\.getAsset/);
  assert.match(html, /Files stay private behind the application API/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.drawing-grid/);
});
