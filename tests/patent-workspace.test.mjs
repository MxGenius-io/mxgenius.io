import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../patent-workspace.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../patent-workspace.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../patent-workspace.css', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const auth = await readFile(new URL('../auth.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../application-client.js', import.meta.url), 'utf8');
const operationsCenter = await readFile(new URL('../operations-center.html', import.meta.url), 'utf8');
const httpRs = await readFile(new URL('../services/mcp/server/src/transport/http.rs', import.meta.url), 'utf8');

test('Settings keeps the patent workspace private behind one Operations Center entry', () => {
  assert.match(dashboard, /id="settingsOperationsCenterEntry"/);
  assert.doesNotMatch(dashboard, /id="settingsWorkspacesCard"|id="settingsWorkspaceSelect"/);
  assert.doesNotMatch(dashboard, /value="patent-workspace\.html">Provisional Patent Application/);
  assert.match(dashboard, /id="settingsOperationsCenterOpen"[^>]*>Open Operations Center/);
  assert.doesNotMatch(dashboard, /value="build-board\.html">Build Board/);
  assert.doesNotMatch(dashboard, /value="progress\.html">Reports/);
  assert.match(operationsCenter, /data-tab="patents">Patents/);
  assert.match(operationsCenter, /patent-workspace\.html\?embed=1/);
  assert.match(html, /Back to Operations Center/);
});

test('the patent workspace is authenticated and uses only the application client boundary', () => {
  assert.match(auth, /dashboard\|operations-center\|progress\|patent-workspace\|build-board/);
  assert.match(auth, /mx_auth_protected_return/);
  assert.match(auth, /operations-center\|progress\|patent-workspace\|build-board/);
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

test('patent portfolio creates, switches, and archives independent stable workspaces', () => {
  assert.match(html, /id="workspaceProjectSelect"/);
  assert.match(html, /id="workspaceNew"/);
  assert.match(html, /id="workspaceArchive"/);
  assert.match(js, /LEGACY_WORKSPACE_KEY = 'provisional-patent'/);
  assert.match(js, /`patent-\$\{globalThis\.crypto\.randomUUID\(\)\}`/);
  assert.match(js, /projectWorkspaces\.list\(\s*'patent'/);
  assert.match(js, /state\.workspaceKey/);
  assert.match(js, /status: 'archived'|state\.status = 'archived'/);
  assert.match(js, /Discard unsaved changes and switch patent projects/);
});

test('patent projects keep a neutral technology area and isolated asset/version keys', () => {
  for (const value of ['software', 'hardware', 'process', 'other']) {
    assert.match(html, new RegExp(`value="${value}"`));
  }
  assert.match(js, /workspace_family: 'patent'/);
  assert.match(js, /technology_area/);
  assert.match(js, /uploadAsset\(\s*state\.workspaceKey/);
  assert.match(js, /getAsset\(\s*state\.workspaceKey/);
  assert.match(client, /list: listProjectWorkspaces/);
  assert.match(httpRs, /async fn list_project_workspaces/);
  assert.match(httpRs, /WHERE w\.organization_id=\$1/);
  assert.match(httpRs, /workspace_key='provisional-patent' OR w\.workspace_key LIKE 'patent-%'/);
});
