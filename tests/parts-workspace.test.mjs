import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('dashboard.html', 'utf8');
const js = readFileSync('parts-workspace.js', 'utf8');
const client = readFileSync('application-client.js', 'utf8');
const css = readFileSync('parts-workspace.css', 'utf8');

test('Parts Frontend Shell requirements', async (t) => {
  await t.test('dashboard.html contains parts navigation', () => {
    assert.match(html, /data-tab="parts"/);
    assert.match(html, /id="partsNav"/);
    assert.match(html, /id="tab-parts"/);
  });

  await t.test('dashboard.html includes parts CSS and JS', () => {
    assert.match(html, /href="parts-workspace\.css\?v=\d+"/);
    assert.match(html, /src="parts-workspace\.js\?v=\d+"/);
  });

  await t.test('application-client.js exposes the production parts namespace', () => {
    assert.match(client, /const parts = Object\.freeze\({/);
    for (const operation of [
      'search', 'getUnit', 'createReceivingDraft', 'registerAssetUpload',
      'uploadAsset', 'requestExtraction', 'reviewExtraction',
      'confirmReceiving', 'listDocuments', 'listTransactions',
      'getFaaCandidates', 'getLabel', 'listLocations', 'createLocation',
      'updateLocation', 'dispositionUnit', 'correctUnit'
    ]) {
      assert.match(client, new RegExp(`${operation}: async`), `${operation} should be exposed`);
    }
    assert.match(client, /\/api\/parts/);
    assert.doesNotMatch(client, /mockUnits|unit-\s*\+\s*Date\.now/);
  });

  await t.test('parts-workspace.js avoids direct fetch calls', () => {
    assert.doesNotMatch(js, /fetch\(/, 'parts-workspace.js must not call fetch directly');
  });

  await t.test('parts-workspace.js defines the receiving wizard steps', () => {
    assert.match(js, /data-step="1"/);
    assert.match(js, /data-step="4"/);
    assert.match(js, /id="wizardStep4"/);
  });

  await t.test('parts-workspace.js escapes HTML to prevent XSS (OCR Review)', () => {
    assert.match(js, /function escapeHtml/);
    assert.match(js, /escapeHtml\(candidate\.proposedValue/);
  });

  await t.test('parts-workspace.js implements authenticated routing, search, OCR review, and receiving', () => {
    assert.match(js, /switchTab\?\.\('parts'\)/);
    assert.match(js, /client\.search\(\{[\s\S]*?query: state\.query,[\s\S]*?session: await session\(\)[\s\S]*?\}\)/);
    assert.match(js, /client\.reviewExtraction\(/);
    assert.match(js, /client\.confirmReceiving\(/);
    assert.match(js, /crypto\.subtle\.digest\('SHA-256'/);
    assert.match(js, /crypto\.randomUUID\(\)/);
  });

  await t.test('receiving can proceed to details without uploading evidence', () => {
    assert.match(js, /id="btnWizardSkipCapture"/);
    assert.match(js, /async function skipCapture/);
    assert.match(js, /client\.createReceivingDraft\(\{ session: await session\(\) \}\)/);
  });

  await t.test('quarantined stock can be dispositioned out of the drawer', () => {
    assert.match(js, /id="btnInspectPass"/);
    assert.match(js, /id="btnInspectReject"/);
    assert.match(js, /client\.dispositionUnit\(/);
    assert.match(js, /unit\.status === 'quarantine'/);
  });

  await t.test('confirmed records can be corrected without touching the ledger fields', () => {
    assert.match(js, /client\.correctUnit\(/);
    assert.match(js, /id="btnCorrectUnit"/);
    // Quantity, status, and location move through their own ledger events.
    assert.doesNotMatch(js, /correctQuantity|correctStatus|correctLocation/);
  });

  await t.test('the daily loop is reachable from the unit drawer', () => {
    assert.match(js, /const MOVEMENTS = \{/);
    for (const action of ['issue', 'transfer', 'reserve', 'scrap', 'ship']) {
      assert.match(js, new RegExp(`action: '${action}'`), `${action} should be offered`);
    }
    // Return is offered from the issued state rather than the movement table.
    assert.match(js, /data-movement="return"/);
    assert.match(js, /client\.dispositionUnit\(/);
    assert.match(js, /referenceId:/);
  });

  await t.test('movements are offered only from a status that permits them', () => {
    // Quarantined stock is inspected, never issued straight to a job.
    assert.match(js, /unit\.status === 'quarantine'/);
    assert.match(js, /id="btnInspectPass"/);
    assert.doesNotMatch(js, /^\s*quarantine: \[/m, 'quarantine must not be in the movement table');
    for (const status of ['available', 'reserved', 'rejected', 'in_repair']) {
      assert.match(js, new RegExp(`^\\s*${status}: \\[`, 'm'), `${status} should have movements`);
    }
  });

  await t.test('spent units expose nothing beyond returning an issued part', () => {
    assert.match(js, /TERMINAL_STATUSES/);
    assert.match(js, /issued', 'shipped', 'scrapped', 'archived/);
    // An issued unit is the one terminal state that can still come back.
    assert.match(js, /data-movement="return"/);
  });

  await t.test('lots can be cycle counted but serialized units cannot', () => {
    assert.match(js, /client\.adjustQuantity\(/);
    assert.match(js, /id="btnAdjustQuantity"/);
    // A serialized unit always holds exactly one, so the block is suppressed.
    assert.match(js, /if \(unit\.serialNumber\) return '';/);
    assert.match(client, /toolName: 'mxg\.parts\.adjust'/);
  });

  await t.test('lots can be split so part of a lot moves independently', () => {
    assert.match(js, /client\.splitUnit\(/);
    assert.match(js, /id="btnSplitUnit"/);
    // A serialized item is one thing, and a lot of one has nothing to give.
    assert.match(js, /if \(unit\.serialNumber \|\| !\(unit\.quantity > 1\)\) return '';/);
    assert.match(client, /toolName: 'mxg\.parts\.split'/);
  });

  await t.test('every inventory event type the schema defines is reachable', () => {
    const repository = readFileSync('services/mcp/server/src/application/parts_inventory.rs', 'utf8');
    for (const event of [
      'receive', 'inspect_pass', 'inspect_reject', 'issue', 'transfer',
      'adjust', 'return', 'ship', 'scrap', 'split', 'metadata_corrected'
    ]) {
      assert.ok(
        repository.includes(`'${event}'`) || repository.includes(`"${event}"`),
        `${event} should be written by some code path`
      );
    }
  });

  await t.test('the request queue reaches the procurement endpoints', () => {
    for (const method of ['listRequests', 'listOrders', 'createOrder', 'setOrderStatus', 'listRequestHistory']) {
      assert.match(client, new RegExp(`${method}: async`), `${method} should be exposed`);
    }
    assert.match(client, /\/api\/parts\/requests/);
    assert.match(client, /\/api\/parts\/orders\//);
    assert.match(js, /id="partsRequestsView"/);
    assert.match(js, /client\.listRequests\(/);
  });

  await t.test('the overdue verdict is rendered from server fields, never recomputed', () => {
    // A second copy of the overdue rule in the client is exactly how it
    // drifted in the system this design came from.
    assert.match(js, /row\.isOverdue/);
    assert.match(js, /row\.daysOverdue/);
    assert.match(js, /row\.missingNeedBy/);
    assert.doesNotMatch(js, /Date\.now\(\)\s*[-<>]/, 'no client-side overdue arithmetic');
    assert.doesNotMatch(js, /requiredBy\s*<\s*new Date/, 'no client-side overdue comparison');
  });

  await t.test('order actions are offered only from a status that permits them', () => {
    assert.match(js, /const ORDER_ACTIONS = \{/);
    // Procurement is directional: nothing returns a placed order to draft.
    assert.doesNotMatch(js, /status: 'draft'/);
    assert.match(js, /cancelled: \[\]/, 'a cancelled order offers nothing');
    assert.match(js, /client\.setOrderStatus\(/);
  });

  await t.test('a request without a need-by is surfaced rather than counted on time', () => {
    assert.match(js, /missingNeedBy/);
    assert.match(js, /cannot be measured because nobody set a need-by/);
    assert.match(js, /id="requestMissingNeedBy"/);
  });

  await t.test('open case demand is set against free stock', () => {
    assert.match(client, /listShortages: async/);
    assert.match(client, /\/api\/parts\/shortages/);
    assert.match(js, /id="partsShortageView"/);
    assert.match(js, /client\.listShortages\(/);
    // AOG and urgent work must be visually distinguishable in the list.
    assert.match(js, /priority-\$\{escapeHtml\(row\.casePriority\)\}/);
    assert.match(css, /\.shortage-priority\.priority-aog/);
  });

  await t.test('only genuinely free stock counts against a requirement', () => {
    const repository = readFileSync('services/mcp/server/src/application/parts_inventory.rs', 'utf8');
    // Quarantined stock has not passed inspection; reserved and issued stock
    // is already committed, so none of it may cover a new requirement.
    assert.match(repository, /su\.status='available'/);
    assert.match(repository, /acceptable_conditions \? fs\.condition_code/);
    // Closed and cancelled cases no longer demand anything.
    assert.match(repository, /mc\.status NOT IN \('closed', 'cancelled'\)/);
  });

  await t.test('a shop can define its own bins from the workspace', () => {
    assert.match(js, /id="partsLocationsView"/);
    assert.match(js, /client\.createLocation\(/);
    assert.match(js, /client\.updateLocation\(/);
    // Retiring is a soft state, never a delete: stock history must survive.
    assert.doesNotMatch(js, /deleteLocation/);
    assert.match(js, /Reinstate/);
  });

  await t.test('inventory can be filtered by status and location', () => {
    assert.match(js, /id="partsStatusFilter"/);
    assert.match(js, /id="partsLocationFilter"/);
    assert.match(js, /status: state\.status/);
    assert.match(js, /location: state\.location/);
  });

  await t.test('destination fields suggest real locations', () => {
    assert.match(js, /id="partsLocationOptions"/);
    assert.match(js, /client\.listLocations\(/);
    assert.match(js, /list="partsLocationOptions"/);
  });

  await t.test('ledger mutations carry a bound single-use confirmation grant', () => {
    assert.match(client, /toolName: 'mxg\.parts\.inspect'/);
    assert.match(client, /toolName: 'mxg\.parts\.correct'/);
    const grantBindings = client.match(/expected_version: version/g) || [];
    assert.ok(grantBindings.length >= 3, 'each confirmable operation binds the version');
    assert.match(client, /'X-MXG-Confirmation-Grant': confirmation\.token/);
  });

  await t.test('parts workspace has no simulated success or mock rendering path', () => {
    assert.doesNotMatch(js, /mock content|simulate async/i);
    assert.doesNotMatch(client, /mock/i);
  });

  await t.test('part details dock beside inventory on desktop and become a drawer on narrow screens', () => {
    assert.match(js, /<main class="parts-main">/);
    assert.match(js, /drawer\.setAttribute\('aria-hidden', 'false'\)/);
    assert.match(js, /drawer\?\.setAttribute\('aria-hidden', 'true'\)/);
    assert.match(css, /\.parts-workspace\s*\{[\s\S]*flex-direction:\s*row;/);
    assert.match(css, /\.parts-drawer\.open\s*\{[\s\S]*flex-basis:\s*var\(--parts-drawer-width\);/);
    assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.parts-drawer\.open[\s\S]*transform:\s*translateX\(0\);/);
  });
});
