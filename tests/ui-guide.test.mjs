import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('services/mcp/config/environment-manifest.json', root), 'utf8'));
const contract = await readFile(new URL('services/mcp/shared/src/contracts/ui.rs', root), 'utf8');
const handler = await readFile(new URL('services/mcp/server/src/handlers/ui.rs', root), 'utf8');
const backend = await readFile(new URL('services/mcp/server/src/transport/http.rs', root), 'utf8');
const guided = await readFile(new URL('guided-tooltip.js', root), 'utf8');
const guidedStyles = await readFile(new URL('guided-tooltip.css', root), 'utf8');
const application = await readFile(new URL('app.js', root), 'utf8');
const dashboard = await readFile(new URL('dashboard.html', root), 'utf8');

test('UI guide tool accepts only bounded semantic IDs and reversible behavior', () => {
  assert.match(contract, /pub struct UiGuideRequest/);
  assert.match(contract, /pub surface_id: String/);
  assert.match(contract, /pub target_id: String/);
  assert.match(contract, /pub guidance: String/);
  assert.match(contract, /pub behavior: UiGuideBehavior/);
  assert.match(contract, /Auto,[\s\S]*Offer,/);
  assert.doesNotMatch(contract, /selector|javascript|script:/i);
  assert.match(handler, /environment_manifest::describe/);
  assert.match(handler, /Action::CaseRead/);
  assert.match(handler, /cannot submit, approve, delete, or mutate business records/);
  assert.match(backend, /tool_name == "mxg\.ui\.guide"[\s\S]*"type": "ui\.guide"/);
});

test('every primary surface has a manifest-owned semantic guide target', () => {
  const surfaceById = new Map(manifest.surfaces.map((surface) => [surface.id, surface]));
  const targetById = new Map(manifest.tooltips.map((target) => [target.id, target]));
  assert.deepEqual(manifest.navigation_order, ['dashboard', 'case', 'parts', 'maintenance-workspace', 'settings']);
  for (const surfaceId of manifest.navigation_order) {
    const surface = surfaceById.get(surfaceId);
    assert.ok(surface, `${surfaceId} must exist`);
    assert.ok(surface.target_ids.length > 0, `${surfaceId} needs a semantic guide target`);
    for (const targetId of surface.target_ids) {
      assert.equal(targetById.get(targetId)?.surface, surfaceId, `${targetId} must belong to ${surfaceId}`);
    }
    const tabId = surface.route.slice(1);
    assert.match(dashboard, new RegExp(`data-tab="${tabId}"`));
  }
});

test('Settings keeps Equipment Drives separate from the Operations Center', () => {
  const settings = manifest.surfaces.find((surface) => surface.id === 'settings');
  const operations = manifest.surfaces.find((surface) => surface.id === 'operations-center');
  const equipmentDriveTerm = manifest.terminology.find((entry) => entry.term === 'Equipment Drives');
  assert.match(settings.purpose, /directly in Settings/);
  assert.match(settings.purpose, /separate Operations Center/);
  assert.equal(operations.parent_id, 'settings');
  assert.match(equipmentDriveTerm.meaning, /managed directly in Settings below registered devices/);
});

test('browser guide navigates, reveals, scrolls, spotlights, and remains dismissible', () => {
  assert.match(guided, /function navigateToSurface\(surface, payload\)/);
  assert.match(guided, /\.nav-tab\[data-tab=/);
  assert.match(guided, /function revealTarget\(target\)/);
  assert.match(guided, /node\.tagName === 'DETAILS'/);
  assert.match(guided, /scrollIntoView\?\./);
  assert.match(guided, /mx-ui-guide-spotlight/);
  assert.match(guided, /setTimeout\(\(\) => \{[\s\S]*is-fading[\s\S]*\}, 3000\)/);
  assert.match(guided, /prefers-reduced-motion: reduce/);
  assert.match(guided, /dismiss\.addEventListener\('click', clearGuide\)/);
  assert.match(guided, /event\.key !== 'Escape'/);
  assert.match(guided, /if \(!surface \|\| !item \|\| item\.surface !== surface\.id/);
  assert.doesNotMatch(guided, /\.submit\(|requestSubmit|XMLHttpRequest/);
  assert.match(guidedStyles, /\.mx-ui-guide-spotlight/);
  assert.match(guidedStyles, /\.mx-ui-guide-note/);
  assert.match(guidedStyles, /prefers-reduced-motion: reduce/);
});

test('chat auto-guides only auto actions and otherwise renders Show me', () => {
  assert.match(application, /payload\.behavior === 'auto' && allowAuto/);
  assert.match(application, /button\.textContent = 'Show me'/);
  assert.match(application, /MXGuidedTooltip\?\.guide\(payload\)/);
  assert.match(application, /appendClientActions\(bubble, payload\.client_actions \|\| \[\], \{ allowAuto: false \}\)/);
  assert.match(application, /appendClientActions\(streamTarget, data\?\.client_actions \|\| \[\], \{ allowAuto: true \}\)/);
});
