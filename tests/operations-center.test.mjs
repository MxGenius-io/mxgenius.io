import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../operations-center.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../operations-center.css', import.meta.url), 'utf8');
const js = await readFile(new URL('../operations-center.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const progress = await readFile(new URL('../progress.html', import.meta.url), 'utf8');
const auth = await readFile(new URL('../auth.js', import.meta.url), 'utf8');

test('Operations Center is the one Settings workspace destination and Reports is centered first', () => {
  assert.equal((dashboard.match(/id="settingsOperationsCenterOpen"/g) || []).length, 1);
  assert.doesNotMatch(dashboard, /id="settingsWorkspacesCard"|id="settingsWorkspaceSelect"/);
  assert.doesNotMatch(dashboard, /<option value="(?:build-board|integration-readiness|feature-catalog|progress|feedback|feedback-admin)\.html">/);
  assert.match(html, /id="tab-reports"[\s\S]*aria-selected="true"/);
  assert.match(html, /id="reportsFrame"[^>]+src="progress\.html\?embed=1"/);
  assert.match(js, /activate\(requestedTab \|\| 'reports'/);
});

test('the consolidated tabs preserve every existing operational workspace', () => {
  for (const tab of ['reports', 'customers', 'build', 'readiness', 'features', 'patents', 'feedback', 'access']) {
    assert.match(html, new RegExp(`data-tab="${tab}"`));
    assert.match(html, new RegExp(`data-panel="${tab}"`));
  }
  for (const path of ['build-board.html?embed=1', 'integration-readiness.html?embed=1', 'feature-catalog.html?embed=1', 'patent-workspace.html?embed=1']) {
    assert.match(html, new RegExp(path.replace(/[.?]/g, '\\$&')));
  }
  assert.match(js, /feedback-admin\.html\?embed=1/);
  assert.match(js, /feedback\.html\?embed=1/);
  assert.match(css, /max-width: 1180px/);
  assert.match(css, /@media \(max-width: 760px\)/);
});

test('the access registry moved out of Settings and remains server-managed', () => {
  assert.doesNotMatch(dashboard, /id="betaWhitelist(?:Input|AddBtn|Tags|Status)"/);
  assert.match(html, /id="accessRuleInput"/);
  assert.match(html, /id="accessRuleRows"/);
  assert.match(js, /MXApplicationClient\.betaAccess\.list/);
  assert.match(js, /MXApplicationClient\.betaAccess\.add/);
  assert.match(js, /MXApplicationClient\.betaAccess\.delete/);
  assert.doesNotMatch(js, /localStorage|sessionStorage/);
});

test('Operations Center participates in the authenticated return boundary', () => {
  assert.match(auth, /dashboard\|operations-center\|progress/);
  assert.match(auth, /operations-center\|progress\|patent-workspace/);
  assert.match(html, /id="auth-gate"/);
  assert.match(html, /src="auth\.js\?v=\d+"/);
  assert.match(html, /src="application-client\.js\?v=\d+"/);
});

test('the retired weekly tracker ends with the open-ended extension draft', () => {
  assert.match(progress, /Weekly tracker retired · extension continues/);
  assert.match(progress, /class="weekly-report-section expanded"/);
  assert.match(progress, /<span class="timeline-week">Extension<\/span>/);
  assert.match(progress, /Sep 14, 2026 - Open ended/);
  assert.match(progress, /delivery-extension-2026-09-14\/delivery-extension-draft\.html/);
  assert.match(progress, /<details class="legacy-plan">/);
});
