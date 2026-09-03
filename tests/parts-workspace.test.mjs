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

  await t.test('model warnings and source evidence stay attached to the existing asset review', () => {
    assert.match(js, /state\.extractionWarnings = Array\.isArray\(extraction\.warnings\)/);
    assert.match(js, /candidate\.sourceRegion\?\.sourceExcerpt/);
    assert.match(js, /candidate\.sourceRegion\?\.pageNumber/);
    assert.match(js, /escapeHtml\(warning\.trim\(\)\)/);
    assert.match(js, /escapeHtml\(sourceExcerpt\)/);
    assert.match(js, /id="btnWizardViewSource"/);
    assert.match(js, /client\.downloadAsset\(\{ assetId: state\.asset\.id/);
    assert.match(js, /URL\.createObjectURL\(blob\)/);
    assert.match(js, /URL\.revokeObjectURL\(state\.sourcePreviewUrl\)/);
    assert.match(js, /viewer\.setAttribute\('sandbox', ''\)/);
    assert.match(js, /function closeWizard\(\) \{\s*clearWizardSourcePreview\(\)/);
    assert.match(css, /\.extraction-warning-panel/);
    assert.match(css, /\.candidate-source-evidence/);
    assert.match(css, /\.wizard-source-preview/);
  });

  await t.test('receiving can proceed to details without uploading evidence', () => {
    assert.match(js, /id="btnWizardSkipCapture"/);
    assert.match(js, /async function skipCapture/);
    assert.match(js, /client\.createReceivingDraft\(\{ session: await session\(\) \}\)/);
  });

  await t.test('quarantined stock can be dispositioned out of the drawer', () => {
    // The single pass/reject pair was replaced by the five-gate inspection
    // form, so the release now carries the evidence behind it.
    assert.match(js, /id="btnRecordInspection"/);
    assert.match(js, /client\.recordInspection\(/);
    assert.match(js, /unit\.status === 'quarantine'/);
    // Movements still go through the disposition adapter.
    assert.match(js, /client\.dispositionUnit\(/);
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
    assert.match(js, /id="btnRecordInspection"/);
    assert.doesNotMatch(js, /^\s*quarantine: \[/m, 'quarantine must not be in the movement table');
    for (const status of ['available', 'reserved', 'rejected', 'in_repair', 'hold_ncm']) {
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

test('Server-side paging', async (t) => {
  const paging = readFileSync('services/mcp/shared/src/application/paging.rs', 'utf8');
  const procurement = readFileSync(
    'services/mcp/server/src/application/part_procurement.rs', 'utf8');
  const inventory = readFileSync(
    'services/mcp/server/src/application/parts_inventory.rs', 'utf8');
  const listSources = [
    procurement,
    inventory,
    readFileSync('services/mcp/server/src/application/rotables.rs', 'utf8'),
    readFileSync('services/mcp/server/src/application/cannibalizations.rs', 'utf8'),
    readFileSync('services/mcp/server/src/application/part_traceability.rs', 'utf8')
  ];

  await t.test('no parts list silently truncates at a hard cap', () => {
    // A bare LIMIT with no offset, total, or signal tells the caller "there
    // are this many" when the truth is "there are more".
    for (const source of listSources) {
      assert.doesNotMatch(source, /LIMIT 250/,
        'a hard row cap must be replaced by a window with a total');
    }
  });

  await t.test('every paged query takes its window from the clamped request', () => {
    for (const source of listSources) {
      assert.match(source, /LIMIT \$\d+ OFFSET \$\d+/);
      assert.match(source, /paging\.limit\(\)/);
      assert.match(source, /paging\.offset\(\)/);
    }
  });

  await t.test('the window is clamped and unparseable input falls back', () => {
    assert.match(paging, /MAX_PAGE_SIZE: i64 = 200/);
    assert.match(paging, /DEFAULT_PAGE_SIZE: i64 = 50/);
    assert.match(paging, /\.clamp\(1, Self::MAX_PAGE_SIZE\)/);
    assert.match(paging, /pub fn lenient_page_number/);
    // A stale bookmark must not overflow the offset arithmetic.
    assert.match(paging, /saturating_sub\(1\)\.saturating_mul/);
  });

  await t.test('totals are counted over the filtered set, not the page', () => {
    // The queue summary was previously derived by filtering the returned
    // rows, which caps every count at the page size and puts the summary and
    // the list back into the disagreement the overdue rule exists to prevent.
    assert.match(procurement, /count\(\*\) FILTER \(WHERE/);
    assert.match(procurement, /struct RequestQueueTotals/);
    assert.match(inventory, /struct ShortageTotals/);
    assert.doesNotMatch(partsHttp, /requests\s*\n?\s*\.iter\(\)\s*\n?\s*\.filter\(\|row\| row\.is_overdue\)/);
    assert.doesNotMatch(partsHttp, /\.filter\(\|row: &&PartShortageDto\| row\.shortfall > 0\.0\)/);
  });

  await t.test('paged sorts carry a unique tiebreaker', () => {
    // Without one, rows sharing a sort key can straddle a page boundary and
    // be returned twice or skipped entirely.
    assert.match(procurement, /pr\.required_by NULLS LAST,\s*\n\s*pr\.id/);
    assert.match(listSources[3], /created_at DESC,\s*\n\s*id/);
  });

  await t.test('paged responses keep rows under their existing key', () => {
    // Serializing the Page itself under that key would turn the array into an
    // object and silently break every existing reader.
    assert.match(partsHttp, /fn paged_json<T: Serialize>/);
    assert.match(partsHttp, /"totalCount": page\.total_count/);
    assert.match(partsHttp, /"units": units\.items/);
    assert.match(partsHttp, /"requests": page\.page\.items/);
  });

  await t.test('the request queue exposes a pager the user can reach page 2 with', () => {
    assert.match(js, /id="requestPager"/);
    assert.match(js, /requestPagerPrev/);
    assert.match(js, /requestPagerNext/);
    assert.match(js, /function renderRequestPager/);
    // A filter change must not leave the user stranded on a page the new
    // result set may not have.
    assert.match(js, /requestPage = 1;/);
    assert.match(css, /\.parts-pager/);
  });

  await t.test('the client forwards the window and never recomputes the counts', () => {
    assert.match(client, /params\.set\('page', String\(page\)\)/);
    assert.match(client, /params\.set\('pageSize', String\(pageSize\)\)/);
    // overdue/missingNeedBy come from the server; the workspace only renders.
    assert.doesNotMatch(js, /rows\.filter\(\(r\) => r\.isOverdue\)\.length/);
  });
});

test('Part interchangeability', async (t) => {
  const migration = readFileSync(
    'services/mcp/migrations/0025_part_alternates.sql', 'utf8');
  const domain = readFileSync(
    'services/mcp/shared/src/domain/part_alternate.rs', 'utf8');
  const handler = readFileSync('services/mcp/server/src/handlers/parts.rs', 'utf8');

  await t.test('the alternates tool is backed by a table rather than stubbed', () => {
    assert.match(handler, /pub struct PartsAlternatesTool/);
    assert.match(handler, /PartsAlternatesTool \{ pool/);
    // The tool used to register as permanently not_configured because no
    // supersession table existed.
    assert.doesNotMatch(handler, /no supersession table in the supplied/);
  });

  await t.test('interchangeability is recorded as a sourced claim', () => {
    // Asserting two part numbers interchange is an airworthiness claim, so it
    // is never anonymous.
    assert.match(migration, /authority/);
    assert.match(migration, /asserted_by\s+uuid NOT NULL/);
    assert.match(migration, /asserted_by_organization_id/);
    assert.match(handler, /no authority recorded/);
  });

  await t.test('a part cannot be its own alternate', () => {
    assert.match(migration, /part_alternates_no_self/);
    assert.match(migration, /CHECK \(part_id <> alternate_part_id\)/);
  });

  await t.test('claims are withdrawn rather than deleted', () => {
    assert.match(migration, /retired_at/);
    // Uniqueness covers live rows only, so a corrected claim can replace a
    // withdrawn one.
    assert.match(migration, /part_alternates_live_pair_idx[\s\S]*?WHERE retired_at IS NULL/);
  });

  await t.test('a one-way claim does not read back from the far side', () => {
    // The uprated part may replace the original; the original may not replace
    // the uprated one.
    assert.match(handler, /AND a\.one_way = false/);
    assert.match(migration, /one_way\s+boolean NOT NULL DEFAULT false/);
  });

  await t.test('a supersession inverts when read from the other part', () => {
    assert.match(domain, /pub fn inverted/);
    assert.match(handler, /if direction < 0 \{ parsed\.inverted\(\) \}/);
  });

  await t.test('silence is not a determination that no alternate exists', () => {
    assert.match(handler, /absence of a claim is not a determination/);
    assert.match(handler, /EnvelopeStatus::Partial/);
  });

  await t.test('an unknown relation is skipped rather than offered', () => {
    assert.match(migration, /CHECK \(relation IN \('alternate', 'supersedes', 'superseded_by'\)\)/);
    assert.match(handler, /Skipping is the safe direction/);
  });
});

test('Receiving inspection and non-conforming material', async (t) => {
  const migration = readFileSync(
    'services/mcp/migrations/0026_receiving_inspection.sql', 'utf8');
  const domain = readFileSync(
    'services/mcp/shared/src/domain/receiving_inspection.rs', 'utf8');
  const repo = readFileSync(
    'services/mcp/server/src/application/receiving_inspection.rs', 'utf8');

  await t.test('releasing from quarantine now records what was inspected', () => {
    // The slice ships quarantine_then_inspect, but the release was a bare
    // status flip carrying no reference and no required evidence.
    assert.match(migration, /CREATE TABLE IF NOT EXISTS receiving_inspections/);
    for (const gate of [
      'part_number_matches_order', 'serial_matches_tag', 'tag_present_and_legible',
      'shelf_life_acceptable', 'dangerous_goods_paperwork'
    ]) {
      assert.match(migration, new RegExp(`${gate}\\s+text NOT NULL`), gate);
      assert.match(migration, new RegExp(`${gate} IN \\('pass', 'fail', 'na'\\)`), gate);
    }
  });

  await t.test('the outcome is stored, never recomputed at read time', () => {
    // Re-deriving a historical acceptance under a later gate set would
    // restate what an inspector concluded rather than report it.
    assert.match(migration, /CHECK \(outcome IN \('accepted', 'quarantined'\)\)/);
    assert.match(migration, /Stored, not derived/);
    assert.match(domain, /never re-derived at read/);
  });

  await t.test('an acceptance cannot stand on a failed gate', () => {
    assert.match(migration, /receiving_inspections_acceptance_has_no_failed_gate/);
    // Refused in the API first, so the caller gets a usable message rather
    // than a constraint name.
    assert.match(repo, /a part cannot be accepted with/);
    assert.match(domain, /pub fn is_supported_by/);
  });

  await t.test('a quarantine call stands even when every gate passed', () => {
    // The proposal is advisory in one direction only.
    assert.match(domain, /Self::Quarantined => true/);
  });

  await t.test('not-applicable is a third value, not a silent pass or fail', () => {
    assert.match(domain, /NotApplicable/);
    assert.match(repo, /fn default_gate/);
    assert.match(repo, /not a silent pass/);
  });

  await t.test('suspected unapproved is a flag beside the condition, not inside it', () => {
    assert.match(migration, /suspected_unapproved boolean NOT NULL DEFAULT false/);
    // Never set without a stated reason.
    assert.match(migration, /stock_units_sup_reason_required/);
    assert.match(domain, /pub fn marks_suspected_unapproved/);
  });

  await t.test('released material is never left flagged suspected unapproved', () => {
    // A part on the serviceable shelf still marked SUP is a contradiction
    // someone could fit an aircraft from.
    assert.match(repo, /suspected_unapproved=false/);
    assert.match(repo, /contradiction someone could fit/);
  });

  await t.test('a resolution names a disposition and an approver or is not one', () => {
    assert.match(migration, /discrepancy_reports_resolution_is_complete/);
    assert.match(migration, /status <> 'resolved' OR/);
    assert.match(migration, /disposition IS NOT NULL/);
    assert.match(migration, /approved_by IS NOT NULL/);
  });

  await t.test('held material is only released when nothing else is open on it', () => {
    assert.match(repo, /still_open/);
    assert.match(repo, /AND status='open' AND id <> \$3/);
  });

  await t.test('the evidence and the movement are written together', () => {
    // A stored acceptance whose unit never moved, or a released unit with no
    // inspection behind it, are the states this record exists to prevent.
    assert.match(repo, /self\.pool\.begin\(\)/);
    assert.match(repo, /tx\.commit\(\)/);
    // The ledger row points back at the record that justified it.
    assert.match(repo, /"receiving_inspection"/);
    assert.match(repo, /"discrepancy_report"/);
  });

  await t.test('the migration does not rebuild constraints from stale definitions', () => {
    // 0020 widened trace_type; recreating it from the 0015 list would drop
    // values already on file.
    assert.match(migration, /deliberately does NOT redefine/);
    assert.match(migration, /live definition rather than from 0015/);
    // The ledger vocabulary keeps everything it had plus the new events.
    for (const kept of ['receive', 'inspect_pass', 'metadata_corrected', 'split']) {
      assert.match(migration, new RegExp(`'${kept}'`), `${kept} must survive`);
    }
  });

  await t.test('the workflow is confirmation-gated like every stock mutation', () => {
    assert.match(partsHttp, /"mxg\.parts\.discrepancy"/);
    assert.match(partsHttp, /PARTS_CONFIRMABLE_OPERATIONS: \[&str; 6\]/);
    // Accepting material onto the serviceable shelf is an inspection buy-off.
    assert.match(partsHttp, /can accept stock into serviceable inventory/);
    assert.match(partsHttp, /can accept non-conforming material as is/);
  });
});

test('The inspection and discrepancy workflow is reachable from the UI', async (t) => {
  await t.test('every backend stock action is offered somewhere in the drawer', () => {
    const repo = readFileSync(
      'services/mcp/server/src/application/parts_inventory.rs', 'utf8');
    const backend = [...repo.matchAll(/^\s+"([a-z_]+)" => Self \{/gm)].map((m) => m[1]);
    assert.ok(backend.length >= 9, `expected the full action set, saw ${backend.length}`);
    for (const action of backend) {
      // Either in the MOVEMENTS map or wired as its own control.
      assert.ok(
        js.includes(`action: '${action}'`) || js.includes(`data-movement="${action}"`)
          || action.startsWith('inspect_'),
        `${action} has no way to reach it from the UI`
      );
    }
  });

  await t.test('non-conforming material is not a dead end', () => {
    // hold_ncm had no MOVEMENTS entry and is not terminal, so the drawer
    // offered correction fields and no way to move the part at all.
    assert.match(js, /hold_ncm: \[/);
    assert.match(js, /Return to vendor/);
    // And the release path is stated, since it is a resolution not a movement.
    assert.match(js, /resolving its discrepancy as/);
  });

  await t.test('the five gates are a form, not a single pass button', () => {
    assert.match(js, /const INSPECTION_GATES = \[/);
    for (const gate of [
      'partNumberMatchesOrder', 'serialMatchesTag', 'tagPresentAndLegible',
      'shelfLifeAcceptable', 'dangerousGoodsPaperwork'
    ]) {
      assert.match(js, new RegExp(gate), gate);
    }
    // n/a is offered as a real answer.
    assert.match(js, /\['na', 'n\/a'\]/);
  });

  await t.test('a raised discrepancy can be resolved without leaving the app', () => {
    // Raising one with no way to resolve it would trap the material.
    assert.match(js, /data-view="discrepancies"/);
    assert.match(js, /function loadDiscrepancies/);
    assert.match(js, /function resolveDiscrepancy/);
    assert.match(js, /data-resolve-discrepancy=/);
  });

  await t.test('the client adapter covers every inspection endpoint', () => {
    for (const method of [
      'listInspections', 'recordInspection', 'listDiscrepancies',
      'openDiscrepancy', 'resolveDiscrepancy'
    ]) {
      assert.match(client, new RegExp(`${method}: async`), `${method} missing`);
    }
    // The workspace calls the adapter only.
    assert.match(js, /client\.recordInspection/);
    assert.match(js, /client\.openDiscrepancy/);
    assert.match(js, /client\.resolveDiscrepancy/);
  });

  await t.test('a resolution grant binds to the report, not the unit', () => {
    assert.match(client, /arguments: \{ report_id: reportId/);
    // The server has to accept that key or the grant would misdescribe itself.
    assert.match(partsHttp, /arguments\.get\("report_id"\)/);
  });

  await t.test('assets changed together get a fresh cache-bust version', () => {
    // dashboard.html is the only page loading the parts workspace; a stale
    // pin serves the build without these controls.
    assert.match(html, /parts-workspace\.js\?v=24/);
    assert.match(html, /parts-workspace\.css\?v=19/);
    assert.match(html, /application-client\.js\?v=37/);
  });
});

test('Defects found by the QA pass stay fixed', async (t) => {
  const domain = readFileSync('services/mcp/shared/src/domain/part.rs', 'utf8');
  const inspection = readFileSync(
    'services/mcp/shared/src/domain/receiving_inspection.rs', 'utf8');
  const repo = readFileSync(
    'services/mcp/server/src/application/parts_inventory.rs', 'utf8');
  const disc = readFileSync(
    'services/mcp/server/src/application/receiving_inspection.rs', 'utf8');

  await t.test('serviceable stock can be held as non-conforming', () => {
    // Without these a discrepancy raised against available stock silently did
    // nothing: the report was written, the unit stayed available, and a part
    // flagged suspected-unapproved could still be issued to a job.
    assert.match(domain, /\(Available, HoldNcm\)/);
    assert.match(domain, /\(Reserved, HoldNcm\)/);
  });

  await t.test('a hold that cannot be applied refuses instead of passing quietly', () => {
    assert.match(disc, /cannot be held as non-conforming material/);
  });

  await t.test('an issued part returns to the bin it came from', () => {
    // `issue` leaves the unit recorded at its bin, so the no-op guard used to
    // reject the ordinary return and demand a different destination.
    assert.match(repo, /spec\.target_status\.is_none\(\)/);
    assert.match(repo, /Only a pure relocation can be a no-op/);
  });

  await t.test('every list query takes the same camelCase paging parameters', () => {
    // /api/parts silently ignored pageSize because this one struct was the
    // only list query without the rename.
    const structs = [
      ['parts_inventory.rs', 'SearchPartsQuery'],
      ['part_procurement.rs', 'RequestQueueQuery'],
      ['rotables.rs', 'RotableQuery'],
      ['cannibalizations.rs', 'CannibalizationQuery'],
      ['part_traceability.rs', 'EventQuery']
    ];
    for (const [file, name] of structs) {
      const src = readFileSync(`services/mcp/server/src/application/${file}`, 'utf8');
      const decl = src.slice(0, src.indexOf(`pub struct ${name} {`));
      const tail = decl.slice(-160);
      assert.match(tail, /rename_all = "camelCase"/, `${name} must accept camelCase paging`);
    }
  });

  await t.test('an inspection that checked nothing cannot release a part', () => {
    // Posting an empty body accepted the unit into serviceable stock with
    // every gate left at n/a.
    assert.match(inspection, /pub fn any_assessed/);
    assert.match(inspection, /!gates\.any_assessed\(\)/);
    assert.match(inspection, /Self::Accepted => gates\.any_assessed\(\)/);
    // And the refusal says which of the two reasons it was.
    assert.match(disc, /checked nothing/);
  });
});

test('The second QA round stays fixed', async (t) => {
  const quantity = readFileSync('services/mcp/shared/src/domain/quantity.rs', 'utf8');
  const policy = readFileSync('services/mcp/shared/src/application/policy.rs', 'utf8');
  const mainRs = readFileSync('services/mcp/server/src/main.rs', 'utf8');
  const ctx = readFileSync('services/mcp/server/src/context.rs', 'utf8');
  const inventory = readFileSync(
    'services/mcp/server/src/application/parts_inventory.rs', 'utf8');
  const importDomain = readFileSync(
    'services/mcp/shared/src/domain/part_import.rs', 'utf8');

  await t.test('the quantity bound is published once and covers both ends', () => {
    // Four call sites each checked some of is_finite / > 0 and none checked
    // the column's range, so an out-of-range value reached Postgres and came
    // back as 503 "persistence is temporarily unavailable".
    assert.match(quantity, /MAX_QUANTITY: f64 = 999_999_999\.999/);
    assert.match(quantity, /MIN_QUANTITY: f64 = 0\.001/);
    assert.match(quantity, /BelowResolution/);
    // Every quantity ingress resolves through it rather than re-checking.
    const sites = (inventory.match(/quantity_problem\(/g) || []).length;
    assert.ok(sites >= 4, `expected every ingress to use it, saw ${sites}`);
    assert.doesNotMatch(inventory, /input\.quantity <= 0\.0/);
    assert.doesNotMatch(inventory, /!input\.counted_quantity\.is_finite\(\)/);
  });

  await t.test('a split cannot leave a remainder the column cannot hold', () => {
    // Taking 5.9996 off 6 leaves 0.0004, which rounds to 0.000 and fails
    // CHECK (quantity > 0) -- the same 503, from the other end.
    assert.match(inventory, /remainder_left/);
    assert.match(inventory, /would leave \{remainder_left:\.3\}/);
  });

  await t.test('one bad import row does not roll the batch back as an outage', () => {
    assert.match(importDomain, /QuantityOutOfRange/);
    // A zero quantity still means "catalog row, no stock" and must not start
    // failing.
    assert.match(importDomain, /value > 0\.0 && crate::domain::quantity::quantity_problem/);
  });

  await t.test('the role list is published once, including the production path', () => {
    assert.match(policy, /pub const ALL: \[Role; 8\]/);
    assert.match(policy, /pub fn parse\(value: &str\) -> Option<Self>/);
    // context.rs held a fourth copy on the membership path, where a missed
    // role means 503 for every user holding it.
    assert.match(ctx, /Role::parse\(value\)\.ok_or_else/);
    assert.doesNotMatch(ctx, /"technician" => Ok\(Role::Technician\)/);
  });

  await t.test('the local role override cannot reach pilot mode', () => {
    // The auth arm is `insecure_local || pilot`, but pilot runs against a real
    // database, so the override takes the narrower condition the rest of
    // main.rs uses for "this is a developer machine".
    assert.match(mainRs, /if insecure_local && !pilot \{\s*\n\s*insecure_local_role/);
    assert.match(mainRs, /MXGENIUS_INSECURE_LOCAL_ROLE/);
  });

  await t.test('a misspelled role refuses to boot rather than defaulting', () => {
    // Defaulting to Administrator on a typo makes a gated action succeed and
    // reads as "the role is permitted" when nothing was tested.
    assert.match(mainRs, /is not a role; expected one of/);
    assert.match(mainRs, /a_misspelled_role_refuses_to_boot_and_names_the_valid_set/);
  });

  await t.test('an overridden role does not keep approval it could not hold', () => {
    // The local provider forced approval_granted true regardless of role, so
    // a role test would have run as a Technician still carrying qualified
    // approval -- a context production can never build.
    assert.match(ctx, /approval_granted && role\.can_grant_qualified_approval\(\)/);
    assert.match(policy, /pub fn can_grant_qualified_approval/);
  });

  await t.test('an exported file re-imports, without blessing the legacy value', () => {
    assert.match(importDomain, /pub enum RowNote/);
    assert.match(importDomain, /LegacyTraceType/);
    assert.match(importDomain, /if value == "coc"/);
    // Any other unknown trace value is still a hard error.
    assert.match(importDomain, /RowProblem::UnknownTraceType/);
    // And a note never blocks a file.
    assert.match(js, /function withNote/);
    assert.match(css, /\.import-row\.is-note/);
  });
});
