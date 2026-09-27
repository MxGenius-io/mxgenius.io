import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPATIAL_REALITY_MODES,
  SPATIAL_SERVICE_STATES,
  SPATIAL_WORKSPACE_VIEWS,
  SpatialWorkspaceController
} from '../spatial-workspace-controller.js';

function controller(options = {}) {
  return new SpatialWorkspaceController({
    context: { version: 2, case: { id: 'CASE-1' } },
    normalizeContext: (value) => ({ ...value, normalized: true }),
    ...options
  });
}

test('workspace controller owns the complete spatial state contract', () => {
  const workspace = controller();
  assert.deepEqual(workspace.snapshot(), {
    version: 1,
    revision: 0,
    view: SPATIAL_WORKSPACE_VIEWS.FOCUS,
    realityMode: SPATIAL_REALITY_MODES.VR,
    pendingRealityMode: null,
    context: { version: 2, case: { id: 'CASE-1' }, normalized: true },
    activeWindow: null,
    windows: [],
    systemMenuOpen: false,
    serviceState: SPATIAL_SERVICE_STATES.NORMAL,
    session: { active: false, ownerId: null }
  });
  assert.ok(Object.isFrozen(workspace.snapshot()));
  assert.ok(Object.isFrozen(workspace.snapshot().context));
});

test('view and reality transitions preserve context and minimized windows', () => {
  const workspace = controller();
  workspace.updateWindowSnapshot({
    activeId: 'thermal',
    windows: [
      { id: 'thermal', state: 'open', active: true },
      { id: 'witness', state: 'minimized', active: false }
    ]
  });
  workspace.requestView(SPATIAL_WORKSPACE_VIEWS.WORLD, { source: 'test' });
  workspace.beginRealityHandoff(SPATIAL_REALITY_MODES.AR);
  workspace.activateSession('canonical-viewer');

  const state = workspace.snapshot();
  assert.equal(state.view, SPATIAL_WORKSPACE_VIEWS.WORLD);
  assert.equal(state.realityMode, SPATIAL_REALITY_MODES.AR);
  assert.equal(state.pendingRealityMode, null);
  assert.equal(state.context.case.id, 'CASE-1');
  assert.equal(state.activeWindow, 'thermal');
  assert.equal(state.windows.find((entry) => entry.id === 'witness').state, 'minimized');
});

test('a World and Focus journey updates view and context atomically without touching the session', () => {
  const events = [];
  const workspace = controller({ onChange: (event) => events.push(event) });
  workspace.activateSession('canonical-viewer');
  const beforeOwner = workspace.snapshot().session.ownerId;
  workspace.navigate(SPATIAL_WORKSPACE_VIEWS.WORLD, {
    version: 2,
    aircraft: { id: 'AIRCRAFT-9' },
    device: { id: 'QUEST-1', kind: 'thermal-sensor' }
  }, { source: 'test-journey' });

  const state = workspace.snapshot();
  assert.equal(state.view, SPATIAL_WORKSPACE_VIEWS.WORLD);
  assert.equal(state.context.aircraft.id, 'AIRCRAFT-9');
  assert.equal(state.context.device.id, 'QUEST-1');
  assert.equal(state.session.ownerId, beforeOwner);
  assert.equal(state.session.active, true);
  assert.equal(events.at(-1).type, 'journey');
});

test('a competing renderer cannot take ownership of the immersive session', () => {
  const workspace = controller();
  workspace.activateSession('canonical-viewer');
  assert.throws(
    () => workspace.activateSession('legacy-globe'),
    /already owned by canonical-viewer/
  );
  assert.throws(
    () => workspace.releaseSession('legacy-globe'),
    /owned by canonical-viewer, not legacy-globe/
  );
  workspace.releaseSession('canonical-viewer');
  assert.deepEqual(workspace.snapshot().session, { active: false, ownerId: null });
});

test('invalid view, reality, and service transitions fail closed', () => {
  const workspace = controller();
  assert.throws(() => workspace.requestView('maintenance'), /Invalid spatial workspace view/);
  assert.throws(() => workspace.beginRealityHandoff('inline'), /Invalid spatial workspace reality mode/);
  assert.throws(() => workspace.setServiceState('offline'), /Invalid spatial workspace service state/);
  assert.equal(workspace.snapshot().revision, 0);
});

test('controller publishes immutable transition events and supports handoff cancellation', () => {
  const events = [];
  const workspace = controller({ onChange: (event) => events.push(event) });
  workspace.beginRealityHandoff(SPATIAL_REALITY_MODES.AR, { input: 'xr' });
  workspace.cancelRealityHandoff({ reason: 'user-cancelled' });
  workspace.setSystemMenuOpen(true);
  workspace.setServiceState(SPATIAL_SERVICE_STATES.DEGRADED);

  assert.deepEqual(events.map((event) => event.type), [
    'reality-handoff',
    'reality-handoff-cancelled',
    'system-menu',
    'service'
  ]);
  assert.ok(events.every((event) => Object.isFrozen(event.state)));
  assert.equal(workspace.snapshot().pendingRealityMode, null);
  assert.equal(workspace.snapshot().systemMenuOpen, true);
  assert.equal(workspace.snapshot().serviceState, SPATIAL_SERVICE_STATES.DEGRADED);
});
