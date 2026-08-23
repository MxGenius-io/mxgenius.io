import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../build-board.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../build-board.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../build-board.css', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const auth = await readFile(new URL('../auth.js', import.meta.url), 'utf8');

test('Settings has one build-board entry and one Reports entry without a Getting Started duplicate', () => {
  assert.match(dashboard, /value="build-board\.html">Build Board/);
  assert.match(dashboard, /value="progress\.html">Reports/);
  assert.doesNotMatch(dashboard, /Open Tracker/);
  assert.doesNotMatch(dashboard, /Final Build Plan · coming next/);
  assert.equal((dashboard.match(/value="build-board\.html"/g) || []).length, 1);
  assert.equal((dashboard.match(/value="progress\.html"/g) || []).length, 1);
});

test('the board is authenticated and persists through the shared workspace boundary', () => {
  assert.match(auth, /dashboard\|progress\|patent-workspace\|build-board/);
  assert.match(auth, /progress\|patent-workspace\|build-board/);
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

test('the starter build list reflects the known apparatus work without live-test plumbing blockers', () => {
  assert.match(js, /Refine the apparatus mount and cable routing/);
  assert.match(js, /Run the integrated headset apparatus test/);
  assert.match(js, /Smoke-check the recovered manual image path/);
  assert.match(js, /Separate thermal and Pi transport paths/);
  assert.match(js, /Publish the shared provisional-patent workspace/);
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
