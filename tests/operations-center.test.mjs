import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const html = await readFile(new URL('../operations-center.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../operations-center.css', import.meta.url), 'utf8');
const js = await readFile(new URL('../operations-center.js', import.meta.url), 'utf8');
const application = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const progress = await readFile(new URL('../progress.html', import.meta.url), 'utf8');
const auth = await readFile(new URL('../auth.js', import.meta.url), 'utf8');

test('Operations Center is the one Settings workspace destination and R&D Highlights opens first', () => {
  assert.equal((dashboard.match(/id="settingsOperationsCenterOpen"/g) || []).length, 1);
  assert.match(application, /operations-center\.html\?release=rd-highlights/);
  assert.doesNotMatch(dashboard, /id="settingsWorkspacesCard"|id="settingsWorkspaceSelect"/);
  assert.doesNotMatch(dashboard, /<option value="(?:build-board|integration-readiness|feature-catalog|progress|feedback|feedback-admin)\.html">/);
  assert.match(html, /id="tab-highlights"[\s\S]*aria-selected="true"/);
  assert.ok(html.indexOf('id="tab-highlights"') < html.indexOf('id="tab-reports"'));
  assert.match(html, /id="reportsFrame"[^>]+src="progress\.html\?embed=1"/);
  assert.match(js, /activate\(requestedTab \|\| 'highlights'/);
});

test('the consolidated tabs preserve every existing operational workspace', () => {
  for (const tab of ['highlights', 'reports', 'customers', 'build', 'readiness', 'features', 'patents', 'feedback', 'settings', 'access']) {
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

test('provider settings own the server-managed JetNet connection', () => {
  assert.doesNotMatch(dashboard, /id="settingsJetNetCard"/);
  assert.match(html, /id="tab-settings"[\s\S]*id="panel-settings"/);
  assert.match(html, /id="settingsJetNetCard"[\s\S]*JetNet Connection/);
  assert.match(js, /MXApplicationClient\.jetnetConnection\.get/);
  assert.match(js, /MXApplicationClient\.jetnetConnection\.put/);
  assert.match(js, /MXApplicationClient\.jetnetConnection\.delete/);
  assert.match(js, /authenticatedSession\(\{ forceRefresh: true \}\)/);
  assert.doesNotMatch(js, /localStorage|sessionStorage/);
});

test('R&D Highlights contains every and only report-referenced video on the canonical media route', async () => {
  const reportsRoot = new URL('../Generated Reports/', import.meta.url);
  const weekFolders = (await readdir(reportsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^week-\d+$/.test(entry.name));
  const expected = [];
  for (const folder of weekFolders) {
    const reportUrl = new URL(`${folder.name}/${folder.name}-report.md`, reportsRoot);
    let report;
    try {
      report = await readFile(reportUrl, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const match of report.matchAll(/🎬\s+\*\*Video:\*\*\s*(.+)/g)) {
      expected.push(`Generated Reports/${folder.name}/${match[1].trim()}`);
    }
  }

  const catalog = [...html.matchAll(/data-report-video="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(expected.length, 7);
  assert.deepEqual(catalog.toSorted(), expected.toSorted());
  assert.equal((html.match(/<video controls playsinline preload="metadata"/g) || []).length, expected.length);
  for (const path of expected) {
    const encoded = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    assert.ok(html.includes(`https://media.githubusercontent.com/media/MxGenius-io/mxgenius.io/main/${encoded}`), path);
  }
  assert.match(js, /if \(next !== 'highlights'\) highlightVideos\.forEach\(\(video\) => video\.pause\(\)\)/);
  assert.match(js, /candidate !== video && !candidate\.paused/);
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
