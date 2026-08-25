import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('dashboard.html', 'utf8');
const js = readFileSync('parts-workspace.js', 'utf8');
const client = readFileSync('application-client.js', 'utf8');
const css = readFileSync('parts-workspace.css', 'utf8');
const partsHttp = readFileSync('services/mcp/server/src/transport/http.rs', 'utf8');

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

  await t.test('document extraction uses the MXGenius model pipeline behind human review', () => {
    assert.match(partsHttp, /PARTS_EXTRACTION_PROVIDER: &str = "openai_responses"/);
    assert.match(partsHttp, /\.post\(OPENAI_RESPONSES_URL\)/);
    assert.match(partsHttp, /"type": "json_schema"/);
    assert.match(partsHttp, /"strict": true/);
    assert.match(partsHttp, /"store": false/);
    assert.match(partsHttp, /confidence: None/);
    assert.doesNotMatch(partsHttp, /azure_document_intelligence|prebuilt-layout/);
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

  await t.test('a part can be traced through shipment legs and install history', () => {
    for (const method of ['listShipments', 'createShipment', 'setShipmentStatus', 'listPartEvents', 'createPartEvent']) {
      assert.match(client, new RegExp(`${method}: async`), `${method} should be exposed`);
    }
    assert.match(js, /data-open-trace=/);
    assert.match(js, /const SHIPMENT_ACTIONS = \{/);
    // A delivered leg is the fact; nothing offers a way to un-arrive it.
    assert.match(js, /delivered: \[\]/);
  });

  await t.test('an install and a removal are separate events, never one row', () => {
    const repository = readFileSync('services/mcp/server/src/application/part_traceability.rs', 'utf8');
    assert.match(repository, /a swap is recorded as two events/);
    assert.match(repository, /an install does not carry a removal reason/);
    // No combined kind exists at any layer.
    const domain = readFileSync('services/mcp/shared/src/domain/part_trace.rs', 'utf8');
    assert.doesNotMatch(domain, /Swap|Exchange\b/);
  });

  await t.test('the paperwork vocabulary covers the forms a shop receives', () => {
    // ATA 106 is the standard used-parts trace form; TSO is a real
    // authorization; a manufacturer CoC outranks a vendor CoC.
    for (const value of ['ata106', 'tso', 'coc_mfr', 'coc_vendor']) {
      assert.match(js, new RegExp(`'${value}'`), `${value} should be offered`);
    }
    // The ambiguous legacy value stays readable but is never offered.
    assert.match(js, /coc \(source not recorded\)/i);
    assert.doesNotMatch(js, /\['coc', 'CoC'\]/);
  });

  await t.test('a confidently read capture never asks the mechanic to proofread', () => {
    // The headset path: when the server flags nothing for review, the wizard
    // accepts the fields and goes straight to the details.
    assert.match(js, /async function acceptConfidentCandidates/);
    assert.match(js, /candidate\.requiresReview/);
    assert.match(js, /if \(state\.candidates\.length && !needsReview\.length\)/);
    // The threshold is the server's decision, not a number the client invents.
    assert.doesNotMatch(js, /confidence\s*>=?\s*0\.\d/, 'client must not hold its own threshold');
  });

  await t.test('only flagged fields are offered for review', () => {
    assert.match(js, /const confident = state\.candidates\.filter/);
    assert.match(js, /const review = state\.candidates\.filter/);
    // A row with no decision control is accepted as proposed rather than skipped.
    assert.match(js, /if \(!decision\)/);
    assert.match(js, /reviewState: 'accepted'/);
  });

  await t.test('the demo carries enough parts to run the scenario', () => {
    const seed = readFileSync('services/mcp/demo/seed.sql', 'utf8');
    const parts = (seed.match(/'MXG-DEMO-[0-9A-Z-]+'/g) || []);
    assert.ok(parts.length >= 35, `expected ~35 seeded parts, found ${parts.length}`);
    // Wheel and brake hardware for the Challenger 350 scenario.
    assert.match(seed, /Main wheel assembly/);
    assert.match(seed, /Brake lining set/);
    assert.match(seed, /Thermal fuse plug/);
    // Nothing may look like a real OEM number.
    assert.doesNotMatch(seed, /'BD-[0-9]/, 'no Bombardier-shaped part numbers');
  });

  await t.test('demo requirements carry the tenant the schema now requires', () => {
    const seed = readFileSync('services/mcp/demo/seed.sql', 'utf8');
    const insert = seed.slice(seed.indexOf('INSERT INTO part_requirements'));
    assert.match(insert.slice(0, 400), /organization_id/,
      'part_requirements is NOT NULL on organization_id since 0019');
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

test('Hands-free inventory search from the headset', async (t) => {
  const app = readFileSync('app.js', 'utf8');

  await t.test('a spoken stock question reaches the parts search', () => {
    assert.match(app, /name: 'mxg\.parts\.lookup_stock'/);
    assert.match(app, /client_handler: 'parts_stock_lookup'/);
    assert.match(app, /async function executeRealtimePartsLookup/);
    assert.match(app, /MXApplicationClient\.parts\.search/);
  });

  await t.test('the lookup is read-only and says so', () => {
    // A voice capability that could reserve or order stock by accident is a
    // different risk from one that only reports what is on the shelf.
    assert.match(app, /requires_human_approval: false/);
    assert.match(app, /does not reserve, issue, or order anything/);
    const handler = app.slice(
      app.indexOf('async function executeRealtimePartsLookup'),
      app.indexOf('async function executeRealtimeStructuredResponse')
    );
    for (const mutating of ['dispositionUnit', 'confirmReceiving', 'createOrder', 'adjustQuantity', 'splitUnit']) {
      assert.ok(!handler.includes(mutating), `lookup must not call ${mutating}`);
    }
  });

  await t.test('the answer is shaped to be spoken, not dumped', () => {
    assert.match(app, /spoken_summary/);
    // Collapsed per part number so the model reads one line per part.
    assert.match(app, /quantityOnHand/);
    assert.match(app, /match_count/);
  });

  await t.test('the voice model is told when to use it', () => {
    assert.match(app, /call mxg__parts__lookup_stock/);
  });
});

test('Rotable register', async (t) => {
  const js = readFileSync('parts-workspace.js', 'utf8');
  const client = readFileSync('application-client.js', 'utf8');
  const repo = readFileSync('services/mcp/server/src/application/rotables.rs', 'utf8');
  const domain = readFileSync('services/mcp/shared/src/domain/rotable.rs', 'utf8');

  await t.test('the register is reachable from the workspace', () => {
    for (const method of ['listRotables', 'createRotable', 'updateRotable', 'retireRotable']) {
      assert.match(client, new RegExp(`${method}: async`), `${method} should be exposed`);
    }
    assert.match(js, /id="partsRotablesView"/);
    assert.match(js, /client\.listRotables\(/);
  });

  await t.test('retirement runs serializable so an obligation cannot slip in', () => {
    // Under a weaker level an obligation created between the check and the
    // write commits fine and ends up pointing at a retired unit.
    assert.match(repo, /SET TRANSACTION ISOLATION LEVEL SERIALIZABLE/);
    assert.match(repo, /OPEN_CORE_STATUSES/);
    assert.match(repo, /OPEN_WARRANTY_STATUSES/);
    assert.match(repo, /OPEN_CANNIBALIZATION_STATUSES/);
  });

  await t.test('retirement demands a reason and keeps the history', () => {
    assert.match(repo, /retiring a unit is a disposition; record why/);
    assert.match(domain, /pub fn retirement_note/);
    // The stamp is prepended; existing notes survive beneath it.
    assert.match(domain, /\{stamp\}\\n\\n\{previous\}/);
  });

  await t.test('coherence is judged only when the caller touched the pairing', () => {
    assert.match(repo, /edit_touches_pairing/);
    assert.match(domain, /pub fn status_aircraft_contradiction/);
    // in_repair, in_transit and on_loan stay unconstrained on purpose.
    assert.match(domain, /deliberately unconstrained/);
  });
});

test('Cannibalization', async (t) => {
  const js = readFileSync('parts-workspace.js', 'utf8');
  const client = readFileSync('application-client.js', 'utf8');
  const domain = readFileSync('services/mcp/shared/src/domain/cannibalization.rs', 'utf8');
  const repo = readFileSync('services/mcp/server/src/application/cannibalizations.rs', 'utf8');
  const http = readFileSync('services/mcp/server/src/transport/http.rs', 'utf8');
  const migration = readFileSync('services/mcp/migrations/0022_cannibalizations.sql', 'utf8');

  await t.test('the approval chain is reachable and cannot be skipped', () => {
    for (const method of ['listCannibalizations', 'proposeCannibalization', 'decideCannibalization']) {
      assert.match(client, new RegExp(`${method}: async`), `${method} should be exposed`);
    }
    assert.match(js, /const ROB_DECISIONS = \{/);
    // Approval cannot be skipped: proposed offers no path to completed.
    const proposed = js.slice(js.indexOf('proposed: ['), js.indexOf('approved: ['));
    assert.ok(!proposed.includes("'completed'"), 'a proposed rob must not offer completion');
    // Terminal states offer nothing.
    assert.match(js, /rejected: \[\]/);
    assert.match(js, /completed: \[\]/);
  });

  await t.test('separation of duties is enforced and returns 403', () => {
    assert.match(domain, /pub fn violates_separation_of_duties/);
    assert.match(repo, /the person who proposed a cannibalization cannot decide it/);
    // 400 would imply retrying with better input helps; it does not.
    assert.match(repo, /PartsInventoryError::Forbidden/);
    assert.match(http, /PartsInventoryError::Forbidden\(message\) => \{\s*realtime_error\(StatusCode::FORBIDDEN/);
    assert.match(migration, /cannibalizations_sod_check/);
  });

  await t.test('a life-limited rob records the life crossing the tail boundary', () => {
    assert.match(domain, /pub fn life_transfer_missing/);
    assert.match(repo, /record the hours or cycles crossing to the receiving aircraft/);
    assert.match(migration, /cannibalizations_life_check/);
    assert.match(js, /data-rob-hours=/);
    assert.match(js, /data-rob-cycles=/);
  });

  await t.test('completion is gated on the event ledger, not the record itself', () => {
    assert.match(domain, /pub fn completion_problem/);
    for (const gate of [
      'DonorNotRemoval', 'ReceiverNotInstall', 'DonorReasonNotCannibalized',
      'RotableMismatch', 'DonorAircraftMismatch', 'ReceiverAircraftMismatch',
      'DonorEventAlreadyUsed', 'ReceiverEventAlreadyUsed'
    ]) {
      assert.match(domain, new RegExp(gate), `${gate} must be a checked condition`);
    }
    // The facts come from part_events, not from the cannibalization row.
    assert.match(repo, /FROM part_events/);
  });

  await t.test('one event cannot complete two robs', () => {
    // Enforced twice: a unique index, and an explicit check that names it.
    assert.match(migration, /cannibalizations_donor_event_once_idx/);
    assert.match(migration, /cannibalizations_receiver_event_once_idx/);
    assert.match(domain, /one event cannot be the donor side of two/);
  });
});

test('Denial messages state the actual rule', async (t) => {
  const js = readFileSync('parts-workspace.js', 'utf8');

  await t.test('a specific 403 reason is shown, not a generic tenant message', () => {
    // An allowlist of denial codes silently mistranslates every new code that
    // gets added, which is how separation of duties first surfaced as
    // "your account does not have access to this organization".
    assert.match(js, /OPAQUE_DENIALS/);
    assert.doesNotMatch(js, /error\?\.code === 'PARTS_INSPECTION_DENIED'/);
    assert.match(js, /if \(error\.message && !OPAQUE_DENIALS\.has\(error\.code\)\) return error\.message;/);
  });
});

test('Bulk import', async (t) => {
  const js = readFileSync('parts-workspace.js', 'utf8');
  const client = readFileSync('application-client.js', 'utf8');
  const domain = readFileSync('services/mcp/shared/src/domain/part_import.rs', 'utf8');
  const repo = readFileSync('services/mcp/server/src/application/part_imports.rs', 'utf8');
  const http = readFileSync('services/mcp/server/src/transport/http.rs', 'utf8');
  const migration = readFileSync('services/mcp/migrations/0023_part_imports.sql', 'utf8');

  await t.test('the import surface is reachable', () => {
    for (const method of ['previewImport', 'applyImport', 'listImportBatches', 'rollbackImport', 'downloadImportTemplate']) {
      assert.match(client, new RegExp(`${method}: async`), `${method} should be exposed`);
    }
    assert.match(js, /id="partsImportView"/);
    assert.match(js, /client\.previewImport\(/);
  });

  await t.test('nothing can be applied without previewing that exact file', () => {
    // Preview-before is the layer that prevents the mistake; rollback only
    // reverses it afterwards.
    assert.match(js, /id="btnApplyImport" disabled/);
    assert.match(js, /function invalidateImportPreview/);
    // Changing either the file or the mode retires an approved preview.
    assert.match(js, /byId\('importFile'\)\?\.addEventListener\('change'/);
    assert.match(js, /byId\('importMode'\)\?\.addEventListener\('change'/);
    // The server refuses too, so a crafted request cannot skip the preview.
    assert.match(http, /PARTS_IMPORT_PREVIEW_REQUIRED/);
    assert.match(repo, /this is not the file that was previewed/);
  });

  await t.test('add-only is the default at every layer', () => {
    assert.match(domain, /#\[default\]\s*\n\s*AddOnly/);
    assert.match(http, /None => ImportMode::default\(\)/);
    // The picker offers the safe mode first.
    const select = js.slice(js.indexOf('id="importMode"'), js.indexOf('id="importMode"') + 400);
    assert.ok(select.indexOf('add_only') < select.indexOf('add_and_update'),
      'add_only should be the first option');
  });

  await t.test('an overwrite is called out before it happens', () => {
    assert.match(js, /will overwrite/);
    assert.match(js, /count-conflict/);
    assert.match(js, /is-update/);
    // Updates and conflicts must not look like ordinary creates.
    const css = readFileSync('parts-workspace.css', 'utf8');
    assert.match(css, /\.import-row\.is-update/);
    assert.match(css, /\.import-row\.is-conflict/);
  });

  await t.test('a bad file is refused whole, never partially applied', () => {
    assert.match(repo, /row\(s\) cannot be read; nothing was imported/);
    assert.match(repo, /nothing was imported/);
  });

  await t.test('re-importing an export does not double the stock', () => {
    assert.match(repo, /re-importing would double the stock/);
    assert.match(repo, /find_duplicate_unit/);
    // Export uses the same column contract, so a round trip is lossless.
    assert.match(repo, /csv_header\(\)/);
    assert.match(domain, /IMPORT_COLUMNS/);
  });

  await t.test('rollback refuses when reversing would contradict later work', () => {
    assert.match(repo, /roll that one back first/);
    assert.match(repo, /would contradict them/);
    // Rows archived in the same pass are excluded explicitly, or every
    // parent still looks occupied.
    assert.match(repo, /archived_units/);
    assert.match(repo, /NOT \(id = ANY\(\$3\)\)/);
  });

  await t.test('the journal is append-only and rollback is privileged', () => {
    assert.match(migration, /part_import_changes_append_only/);
    assert.match(migration, /append-only/);
    assert.match(http, /PARTS_IMPORT_ROLLBACK_DENIED/);
    assert.match(http, /parts_inspection_release_allowed/);
  });
});
