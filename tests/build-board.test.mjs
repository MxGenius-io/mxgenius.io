import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../build-board.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../build-board.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../build-board.css', import.meta.url), 'utf8');
const xrMap = await readFile(new URL('../docs/design/xr-spatial-workspace-map.md', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const auth = await readFile(new URL('../auth.js', import.meta.url), 'utf8');

test('Settings collapses shared workspaces into one Operations Center entry', () => {
  assert.match(dashboard, /id="settingsOperationsCenterOpen"[^>]*>Open Operations Center/);
  assert.doesNotMatch(dashboard, /id="settingsWorkspacesCard"|id="settingsWorkspaceSelect"/);
  assert.doesNotMatch(dashboard, /value="build-board\.html">Build Board/);
  assert.doesNotMatch(dashboard, /value="progress\.html">Reports/);
  assert.doesNotMatch(dashboard, /Open Tracker/);
  assert.doesNotMatch(dashboard, /Final Build Plan · coming next/);
  assert.equal((dashboard.match(/id="settingsOperationsCenterOpen"/g) || []).length, 1);
});

test('the board is authenticated and persists through the shared workspace boundary', () => {
  assert.match(auth, /dashboard\|operations-center\|progress\|patent-workspace\|build-board/);
  assert.match(auth, /operations-center\|progress\|patent-workspace\|build-board/);
  assert.match(html, /src="auth\.js\?v=\d+"/);
  assert.match(html, /src="application-client\.js\?v=\d+"/);
  assert.doesNotMatch(js, /fetch\(/);
  assert.match(js, /WORKSPACE_KEY = 'apparatus-build-board'/);
  assert.match(js, /projectWorkspaces\.get/);
  assert.match(js, /projectWorkspaces\.save/);
  assert.match(js, /expectedVersion: state\.version/);
  assert.match(js, /WORKSPACE_VERSION_CONFLICT/);
});

test('the simple board has questions, current sprint, completion, and post updates', () => {
  for (const label of ['Open questions', 'Current sprint', 'Completed', 'Post to board', 'Post update']) {
    assert.match(`${html}\n${js}`, new RegExp(label));
  }
  assert.match(js, /card\.lane === 'complete'/);
  assert.match(js, /card\.updates\.push/);
  assert.match(js, /Mark complete/);
});

test('board lanes lead the composer and cards support private picture attachments', () => {
  assert.ok(html.indexOf('class="lanes"') < html.indexOf('class="composer"'));
  assert.match(html, /aria-label="Refresh team board"/);
  assert.doesNotMatch(html, /id="boardError"/);
  assert.match(html, /id="postImage"[^>]+accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(js, /MAX_CARD_IMAGE_BYTES = 8 \* 1024 \* 1024/);
  assert.match(js, /projectWorkspaces\.uploadAsset/);
  assert.match(js, /projectWorkspaces\.getAsset/);
  assert.match(js, /URL\.revokeObjectURL/);
  assert.match(css, /\.card-image/);
});

test('the starter build list reflects the current hardware and release work', () => {
  const starterSource = js.slice(js.indexOf('const starterCards'), js.indexOf('const BUILD_BOARD_V6_STARTER_IDS'));
  assert.equal((starterSource.match(/lane: 'question'/g) || []).length, 0);
  assert.equal((starterSource.match(/lane: 'sprint'/g) || []).length, 18);
  assert.equal((starterSource.match(/lane: 'complete'/g) || []).length, 10);
  assert.match(starterSource, /Publish and accept Quest Sensor Bridge alpha\.25/);
  assert.match(starterSource, /Run Rocky acceptance on Feedback and Parts/);
  assert.match(starterSource, /Wire the Pi power and data paths/);
  assert.match(starterSource, /Define the Pi POC stack/);
  assert.match(starterSource, /Prove 18-hour DeWalt battery runtime/);
  assert.match(starterSource, /Consolidate XR into one spatial workspace/);
  assert.match(starterSource, /ran for 18 hours on a single DeWalt battery charge/);
  assert.doesNotMatch(starterSource, /Can we provide a model structured-output example to mimic\?|Prepare the final release and handoff report|What qualifies poc\.12 as thermally stable\?|Who signs off TestFlight Build 33\?|What must the demonstration prove to count as done\?|Which POC devices and programs should run with the Pi\?|Smoke-check the recovered manual image path/);
  assert.match(js, /Separate thermal and Pi transport paths/);
  assert.match(js, /Publish the shared provisional-patent workspace/);
  assert.match(js, /Publish the investor-deck landing page/);
  assert.match(js, /Promote Feedback and Parts expansion to Azure/);
  assert.match(js, /Upload native spatial AR Build 33 to TestFlight/);
  for (const title of [
    'Run Remote Witness end-to-end acceptance',
    'XR 01 · Establish the workspace controller contract',
    'XR 02 · Mount World in the canonical renderer',
    'XR 03 · Port the mature JetNet globe layer',
    'XR 04 · Make World and Focus one continuous journey',
    'XR 05 · Gate tools through a capability registry',
    'XR 06 · Replace the button wall with two controls',
    'XR 07 · Reduce the Quest companion to service boundaries',
    'XR 08 · Fence and retire the legacy scene routes',
    'XR 09 · Run unified workspace acceptance on Quest',
    'Accept Pi appliance 0.3.1-poc.29 on hardware',
    'Verify the complete Equipment Drive lifecycle',
    'Accept the USB mass-storage gadget workflow',
    'Field-test selected OpenSky trip paths',
    'Close the model response-loop regression'
  ]) assert.match(starterSource, new RegExp(title.replace(/[+/.]/g, '\\$&')));
  assert.match(js, /BUILD_BOARD_SCHEMA_VERSION = 6/);
  assert.match(js, /BUILD_BOARD_V6_STARTER_IDS/);
  assert.match(js, /BUILD_BOARD_V6_STARTER_TITLES/);
  assert.match(js, /BUILD_BOARD_V6_RETIRED_IDS/);
  assert.match(js, /BUILD_BOARD_V6_RETIRED_TITLES/);
  for (const id of ['question-demonstration-done', 'question-thermal-acceptance-duration', 'question-ios-build33-owner', 'sprint-quest-poc12-acceptance']) {
    assert.match(js, new RegExp(id));
  }
  assert.match(js, /needsSchemaSave/);
  assert.match(js, /created_at: existing\.created_at \|\| starter\.created_at/);
  assert.match(js, /image: existing\.image/);
  assert.match(js, /updates: existing\.updates/);
  assert.match(html, /build-board\.js\?v=7/);
});

test('the locked lean spatial workspace direction is a Current sprint card', () => {
  assert.doesNotMatch(html, /class="xr-direction"/);
  assert.match(js, /id: 'sprint-xr-spatial-workspace'/);
  assert.match(js, /Consolidate XR into one spatial workspace/);
  assert.match(js, /assets\/xr-spatial-workspace-map\.png/);
  assert.match(js, /STATIC_CARD_ARTWORK/);
  assert.match(css, /\.card-image--diagram/);
  assert.match(xrMap, /```mermaid/);
  assert.match(xrMap, /Enter Spatial Workspace/);
  assert.match(xrMap, /Tools are capabilities, not destinations/);
});

test('user-authored board text is rendered with DOM text content and the board is responsive', () => {
  assert.match(js, /element\.textContent = text/);
  assert.doesNotMatch(js, /innerHTML/);
  assert.match(css, /grid-template-columns: minmax\(220px, 0\.78fr\) minmax\(360px, 1\.45fr\) minmax\(220px, 0\.78fr\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(html, /class="button button--quiet" href="progress\.html">Reports<\/a>/);
  assert.doesNotMatch(html, /legacy roadmap/i);
  assert.match(js, /Created by \$\{card\.author\}/);
  assert.match(js, /account\.idTokenClaims\?\.name/);
});
