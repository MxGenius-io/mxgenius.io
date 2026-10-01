(() => {
  'use strict';

  const WORKSPACE_KEY = 'apparatus-build-board';
  const WORKSPACE_TITLE = 'MXGenius Build Board';
  const CARD_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const MAX_CARD_IMAGE_BYTES = 8 * 1024 * 1024;
  const BUILD_BOARD_SCHEMA_VERSION = 6;
  const STATIC_CARD_ARTWORK = new Map([
    ['sprint-xr-spatial-workspace', {
      src: 'assets/xr-spatial-workspace-map.png',
      alt: 'Lean XR spatial workspace Mermaid flowchart'
    }]
  ]);
  const LANES = [
    ['question', 'Open question'],
    ['sprint', 'Current sprint'],
    ['complete', 'Completed']
  ];

  const starterCards = [
    {
      id: 'sprint-xr-spatial-workspace',
      lane: 'sprint',
      title: 'Consolidate XR into one spatial workspace',
      message: 'Architecture lock: replace the separate Operations, Maintenance, sensor, and fallback scene choices with one spatial workspace. Execute XR 01-09 below in order so World and Focus preserve context, one control summons relevant actions, system controls stay tucked away, and the Quest companion surfaces only for consent or recovery.',
      owner: 'Dwayne Tillman',
      author: 'September 27 XR architecture decision',
      created_at: '2026-09-27T11:30:00Z',
      updated_at: '2026-09-27T11:30:00Z',
      updates: []
    },
    {
      id: 'sprint-xr-controller-contract',
      lane: 'sprint',
      title: 'XR 01 · Establish the workspace controller contract',
      message: 'Create one SpatialWorkspaceController owned by the canonical 3D viewer. It must own view (World or Focus), reality mode (VR or AR), normalized spatial context, active window, system-menu state, and normal/degraded/recovery service state. Route existing shell, model-selection, recenter, session, and window events through it without changing visible behavior.\n\nAcceptance: controller state is inspectable and deterministic; only it may request view changes; context and minimized-window state survive controller updates; unit tests cover valid transitions and reject competing session owners.',
      owner: 'Dwayne Tillman',
      author: 'September 27 XR stack audit',
      created_at: '2026-09-27T12:00:00Z',
      updated_at: '2026-09-27T12:00:00Z',
      updates: []
    },
    {
      id: 'sprint-xr-world-surface',
      lane: 'sprint',
      title: 'XR 02 · Mount World in the canonical renderer',
      message: 'Import XROperationsSurface into the 3D viewer and mount it as the World scene group beside the existing Focus/model group. Share the current Three.js renderer, camera rig, input raycasters, session lifecycle, spatial context, and window manager—do not embed globe-vr or create a second WebXR renderer.\n\nAcceptance: entering the workspace can reveal World inside the existing XR session; globe markers accept controller and hand input; Focus remains loaded but hidden; there is one renderer, one animation loop, and one active XR session.',
      owner: 'Dwayne Tillman',
      author: 'September 27 XR stack audit',
      created_at: '2026-09-27T12:01:00Z',
      updated_at: '2026-09-27T12:01:00Z',
      updates: []
    },
    {
      id: 'sprint-xr-jetnet-layer',
      lane: 'sprint',
      title: 'XR 03 · Port the mature JetNet globe layer',
      message: 'Extract the production globe features still trapped in globe-vr into reusable World modules: fleet data provider, Blue Marble presentation, stable clusters, filters, aircraft selection, JetNet detail and image grid, live-flight ribbon, locations, nodes, loading, empty, stale, and error states. Keep JetNet registry data separate from throttled public flight observations.\n\nAcceptance: World matches the mature globe for aircraft discovery and imagery; selecting a marker publishes aircraft and location into MXSpatialContext; sparse or unavailable provider data degrades clearly without breaking the scene.',
      owner: 'Dwayne Tillman',
      author: 'September 27 XR stack audit',
      created_at: '2026-09-27T12:02:00Z',
      updated_at: '2026-09-27T12:02:00Z',
      updates: []
    },
    {
      id: 'sprint-xr-world-focus-transition',
      lane: 'sprint',
      title: 'XR 04 · Make World and Focus one continuous journey',
      message: 'Replace the Operations page-navigation handoff with controller-driven World and Focus transitions. Selecting an aircraft, model, case, component, part, location, or live device must update the shared context; the contextual action returns to World without losing that selection. Keep VR-to-AR as the separate fresh-gesture session handoff required by the browser.\n\nAcceptance: World to Focus to World never ends the XR session, navigates the page, flashes black, duplicates a scene, or discards context; VR-to-AR and AR-to-VR preserve the same workspace snapshot after the required user gesture.',
      owner: 'Dwayne Tillman',
      author: 'September 27 XR stack audit',
      created_at: '2026-09-27T12:03:00Z',
      updated_at: '2026-09-27T12:03:00Z',
      updates: []
    },
    {
      id: 'sprint-xr-capability-registry',
      lane: 'sprint',
      title: 'XR 05 · Gate tools through a capability registry',
      message: 'Create a registry that derives contextual actions from selection, case state, service readiness, permissions, and live connections. Route Ask AI, Capture, Thermal, and Witness through their existing engines and the one-window manager. Split thermal viewing from setup and diagnostics so service controls do not occupy the action surface.\n\nAcceptance: unavailable capabilities are absent or explicitly disabled with a reason; Capture requires an evidence target; Thermal appears only when a valid source is available; Witness follows its connection and consent state; opening one tool minimizes the previous window without ending its allowed background lifecycle.',
      owner: 'Dwayne Tillman',
      author: 'September 27 XR stack audit',
      created_at: '2026-09-27T12:04:00Z',
      updated_at: '2026-09-27T12:04:00Z',
      updates: []
    },
    {
      id: 'sprint-xr-layout-interaction',
      lane: 'sprint',
      title: 'XR 06 · Replace the button wall with two controls',
      message: 'Replace the permanent two-mode tray and tool row with one contextual action control and one compact system menu. The action control serves select, return, Ask AI, Capture, Thermal, and Witness according to context. The system menu owns VR/AR, recenter, sound, service/diagnostics, and exit. Both must rest quietly, share one stable world anchor, and remain recoverable after recenter.\n\nAcceptance: no duplicate or unintended head-attached panels; all controls are reachable by controller and hand dwell; panels remain separated and readable; the system menu cannot obscure the selected asset; every action has hover, active, disabled, loading, and failure feedback.',
      owner: 'Dwayne Tillman',
      author: 'September 27 XR stack audit',
      created_at: '2026-09-27T12:05:00Z',
      updated_at: '2026-09-27T12:05:00Z',
      updates: []
    },
    {
      id: 'sprint-xr-native-boundary',
      lane: 'sprint',
      title: 'XR 07 · Reduce the Quest companion to service boundaries',
      message: 'Keep SensorBridgeService as the normal thermal and witness bridge. Use the native activity only for MediaProjection consent, explicit diagnostics, or degraded/recovery operation; it must not become a competing everyday workspace. Preserve opaque session binding, secure local transport, bounded reconnects, deterministic teardown, and the browser resume handoff.\n\nAcceptance: normal Thermal and Witness return to the same WebXR workspace after consent; remote viewing recovers from a stalled or black frame within its bounded policy; revocation and exit release capture, peer, socket, and wake-lock resources; the native immersive panel is reachable only through Service/recovery.',
      owner: 'Dwayne Tillman',
      author: 'September 27 XR stack audit',
      created_at: '2026-09-27T12:06:00Z',
      updated_at: '2026-09-27T12:06:00Z',
      updates: []
    },
    {
      id: 'sprint-xr-route-retirement',
      lane: 'sprint',
      title: 'XR 08 · Fence and retire the legacy scene routes',
      message: 'Point the dashboard and all XR launchers at the canonical workspace. Remove Operations-to-globe navigation messages and stop offering separate bridge, sensor, bare-globe, and maintenance destinations. Temporarily retain old routes only behind an explicit service or rollback flag, then remove them after hardware acceptance and telemetry review.\n\nAcceptance: one public launcher reaches one session owner; normal use never loads globe-vr scene variants; deep links fail or redirect safely; existing bookmarks receive a clear transition; automated tests assert the unified contract instead of the legacy page handoff.',
      owner: 'Dwayne Tillman',
      author: 'September 27 XR stack audit',
      created_at: '2026-09-27T12:07:00Z',
      updated_at: '2026-09-27T12:07:00Z',
      updates: []
    },
    {
      id: 'sprint-operations-xr-acceptance',
      lane: 'sprint',
      title: 'XR 09 · Run unified workspace acceptance on Quest',
      message: 'Run the final physical matrix in VR and AR: launch, World, fleet filters, JetNet images, marker selection, Focus, model raycast, contextual return, Ask AI, Capture, Thermal, Witness consent and recovery, one-window behavior, recenter, sound, diagnostics, VR/AR handoff, and exit. Include controller, hands, network loss, companion loss, stale flight data, denied permission, and interrupted consent.\n\nAcceptance: no session loss during World/Focus movement; no duplicate or head-locked clutter; context survives every supported handoff; Remote Witness shows advancing frames after recovery; all resources release on exit; automated XR suites and a recorded physical-device checklist pass before legacy routes are removed.',
      owner: 'Dwayne Tillman',
      author: 'September 27 XR stack audit',
      created_at: '2026-09-27T12:08:00Z',
      updated_at: '2026-09-27T12:08:00Z',
      updates: []
    },
    {
      id: 'question-sprint-configuration',
      lane: 'complete',
      title: 'Wire the Pi power and data paths',
      message: 'The 52Pi supply is wired directly to the Pi header, freeing USB-C for the mass-storage gadget and separating sustained power from host data transfer.',
      owner: 'Joshua Millard + Thomas Hagy',
      author: 'September 27 readiness refresh',
      created_at: '2026-08-17T00:00:00Z',
      updated_at: '2026-09-27T00:00:00Z',
      updates: []
    },
    {
      id: 'question-pi-poc-stack',
      lane: 'complete',
      title: 'Define the Pi POC stack',
      message: 'The appliance stack now owns kiosk diagnostics, Wi-Fi and Bluetooth control, scanner and thermal relay health, Equipment Drive delivery, and USB mass-storage transport. New sensors and robotics embodiments remain separate expansion work.',
      owner: 'Dwayne Tillman',
      author: 'September 27 readiness refresh',
      created_at: '2026-08-24T10:30:00Z',
      updated_at: '2026-09-27T00:00:00Z',
      updates: []
    },
    {
      id: 'complete-dewalt-runtime',
      lane: 'complete',
      title: 'Prove 18-hour DeWalt battery runtime',
      message: 'The current Raspberry Pi and 52Pi brain configuration ran for 18 hours on a single DeWalt battery charge. This establishes the mobile compute power baseline; future actuator power remains a separate robotics requirement.',
      owner: 'Dwayne Tillman',
      author: 'September 27 hardware closeout',
      created_at: '2026-09-27T00:00:00Z',
      updated_at: '2026-09-27T00:00:00Z',
      updates: []
    },
    {
      id: 'sprint-quest-alpha25-acceptance',
      lane: 'sprint',
      title: 'Publish and accept Quest Sensor Bridge alpha.25',
      message: 'Publish the verified alpha.25 APK to the private Meta Alpha lane, confirm the runtime label, then prove FLIR, full-display Remote Witness capture, guest audio, bounded recovery, pause/resume, and teardown on the physical Quest.',
      owner: 'Dwayne Tillman',
      author: 'September 27 readiness refresh',
      created_at: '2026-08-24T09:48:00Z',
      updated_at: '2026-09-27T00:00:00Z',
      updates: []
    },
    {
      id: 'sprint-remote-witness-acceptance',
      lane: 'sprint',
      title: 'Run Remote Witness end-to-end acceptance',
      message: 'Prove PIN creation and exchange, wearer approval, Horizon capture consent, advancing video frames, customer microphone return, pause/resume with fresh consent, viewer count, expiry, and deterministic teardown without a frozen last frame or black view.',
      owner: 'Dwayne Tillman',
      author: 'September 27 readiness refresh',
      created_at: '2026-09-27T00:00:00Z',
      updated_at: '2026-09-27T00:00:00Z',
      updates: []
    },
    {
      id: 'sprint-pi-poc29-acceptance',
      lane: 'sprint',
      title: 'Accept Pi appliance 0.3.1-poc.29 on hardware',
      message: 'Boot the exact checksummed image from the direct GPIO power path, verify health/version/schema, Wi-Fi password persistence, Bluetooth, scanner, thermal relay, USB data, safe shutdown, and recovery after battery loss.',
      owner: 'Dwayne Tillman',
      author: 'September 27 readiness refresh',
      created_at: '2026-09-27T00:00:00Z',
      updated_at: '2026-09-27T00:00:00Z',
      updates: []
    },
    {
      id: 'sprint-equipment-drive-lifecycle',
      lane: 'sprint',
      title: 'Verify the complete Equipment Drive lifecycle',
      message: 'Publish, assign, download, resume, verify, activate, reboot, inspect health, roll back, and recover from interrupted transfer using a real customer-scoped Pi without bypassing approval or version checks.',
      owner: 'Dwayne Tillman',
      author: 'September 27 readiness refresh',
      created_at: '2026-09-27T00:00:00Z',
      updated_at: '2026-09-27T00:00:00Z',
      updates: []
    },
    {
      id: 'sprint-usb-gadget-acceptance',
      lane: 'sprint',
      title: 'Accept the USB mass-storage gadget workflow',
      message: 'Connect to representative Windows hosts, transfer a bounded file set, verify the complete handoff, safely eject, reconnect, and recover from cable removal or battery loss without corrupting the exposed volume.',
      owner: 'Dwayne Tillman',
      author: 'September 27 readiness refresh',
      created_at: '2026-09-27T00:00:00Z',
      updated_at: '2026-09-27T00:00:00Z',
      updates: []
    },
    {
      id: 'sprint-opensky-trip-acceptance',
      lane: 'sprint',
      title: 'Field-test selected OpenSky trip paths',
      message: 'Select live aircraft on the production globe and verify observed takeoff and landing bounds, sparse or empty tracks, cache reuse, provider throttling, stale fallback, and clear separation from JetNet registry and recent-flight layers.',
      owner: 'Dwayne Tillman',
      author: 'September 27 readiness refresh',
      created_at: '2026-09-27T00:00:00Z',
      updated_at: '2026-09-27T00:00:00Z',
      updates: []
    },
    {
      id: 'sprint-model-response-loop',
      lane: 'sprint',
      title: 'Close the model response-loop regression',
      message: 'Reproduce the function path that repeatedly asks the model for another response, enforce a bounded response/tool cycle, preserve the useful failure reason, and add a regression test covering cancellation, timeout, and recovery.',
      owner: 'Dwayne Tillman',
      author: 'September 27 readiness refresh',
      created_at: '2026-09-27T00:00:00Z',
      updated_at: '2026-09-27T00:00:00Z',
      updates: []
    },
    {
      id: 'complete-sensor-bridge',
      lane: 'complete',
      title: 'Establish the Quest Sensor Bridge Alpha lane',
      message: 'The private Alpha entitlement, launcher/banner packaging, landscape cover, and native companion delivery path were accepted. Current alpha.25 publication and hardware behavior are tracked separately.',
      owner: 'Team',
      author: 'Team board starter',
      created_at: '2026-08-17T00:00:00Z',
      updated_at: '2026-08-17T00:00:00Z',
      updates: []
    },
    {
      id: 'complete-independent-transports',
      lane: 'complete',
      title: 'Separate thermal and Pi transport paths',
      message: 'Quest-local thermal delivery and Raspberry Pi diagnostics no longer depend on the same socket or on Azure to operate locally.',
      owner: 'Team',
      author: 'Team board starter',
      created_at: '2026-08-17T00:00:00Z',
      updated_at: '2026-08-17T00:00:00Z',
      updates: []
    },
    {
      id: 'complete-patent-workspace',
      lane: 'complete',
      title: 'Publish the shared provisional-patent workspace',
      message: 'The structured team document is live in Settings with proposed inventors, private references, versioned saves, and a revision trail.',
      owner: 'Team',
      author: 'Team board starter',
      created_at: '2026-08-17T00:00:00Z',
      updated_at: '2026-08-17T00:00:00Z',
      updates: []
    },
    {
      id: 'complete-deck-landing-page',
      lane: 'complete',
      title: 'Publish the investor-deck landing page',
      message: 'The pitch deck now drives one flowing public story with aviation imagery, the retained media carousel, a compact AI entry point, the canonical logo, and current live smoke coverage.',
      owner: 'Joshua Millard + Dwayne Tillman',
      author: 'Week 23 closeout',
      created_at: '2026-08-24T09:48:00Z',
      updated_at: '2026-08-24T09:48:00Z',
      updates: []
    },
    {
      id: 'complete-ios-build33-upload',
      lane: 'complete',
      title: 'Upload native spatial AR Build 33 to TestFlight',
      message: 'The signed MxGenius 3.2.0 arm64 archive adds the ARKit fleet globe, independent anchors, camera placement, world lock, Realtime microphone control, spatial audio, and native MxGenius branding; App Store Connect accepted the upload.',
      owner: 'Dwayne Tillman',
      author: 'Week 23 closeout',
      created_at: '2026-08-24T09:48:00Z',
      updated_at: '2026-08-24T09:48:00Z',
      updates: []
    },
    {
      id: 'complete-map-xr-refinement',
      lane: 'complete',
      title: 'Ship the fleet map and XR software refinement',
      message: 'Higher-quality map textures, stable zoom clusters, panel-safe marker layering, denser AI particles, managed mic lifecycle, snapshots, and world-pinned sensor surfaces are integrated. Physical layout and interaction acceptance remain a separate sprint gate.',
      owner: 'Dwayne Tillman',
      author: 'Week 23 closeout',
      created_at: '2026-08-24T09:48:00Z',
      updated_at: '2026-08-24T09:48:00Z',
      updates: []
    }
  ];
  const BUILD_BOARD_V6_STARTER_IDS = new Set(starterCards.map((card) => card.id));
  const BUILD_BOARD_V6_STARTER_TITLES = new Set(starterCards.map((card) => card.title));
  const BUILD_BOARD_V6_RETIRED_IDS = new Set([
    'question-operations-connections',
    'question-structured-output-example',
    'question-demonstration-done',
    'question-thermal-acceptance-duration',
    'question-ios-build33-owner',
    'sprint-mount-refinement',
    'sprint-live-apparatus-test',
    'sprint-manual-image-smoke',
    'sprint-quest-poc12-acceptance',
    'sprint-ios-build33-acceptance',
    'sprint-flir-libssh2-disposition',
    'sprint-final-release-closeout'
  ]);
  const BUILD_BOARD_V6_RETIRED_TITLES = new Set([
    'Can we provide a model structured-output example to mimic?',
    'Which POC devices and programs should run with the Pi?',
    'Prepare the final release and handoff report',
    'What third-party connections does Operations need?',
    'What must the demonstration prove to count as done?',
    'What qualifies poc.12 as thermally stable?',
    'Who signs off TestFlight Build 33?',
    'Smoke-check the recovered manual image path',
    'Verify the registered manual image path',
    'Accept Quest Sensor Bridge poc.12 on hardware',
    'Complete TestFlight Build 33 device acceptance',
    'Disposition the FLIR libssh2 advisory',
    'Refine the apparatus mount and cable routing',
    'Run the integrated headset apparatus test'
  ]);

  const state = {
    version: 0,
    document: null,
    dirty: false,
    saving: false,
    assetUrls: new Map()
  };
  const elements = {};
  let composerPreviewUrl = '';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultDocument() {
    return { schema_version: BUILD_BOARD_SCHEMA_VERSION, cards: clone(starterCards) };
  }

  function normalizeCard(value) {
    const card = value && typeof value === 'object' ? value : {};
    const image = card.image && typeof card.image === 'object' && /^[0-9a-f-]{36}$/i.test(String(card.image.asset_id || ''))
      ? {
          asset_id: String(card.image.asset_id),
          name: String(card.image.name || 'Card picture').slice(0, 180),
          media_type: CARD_IMAGE_TYPES.has(card.image.media_type) ? card.image.media_type : 'image/jpeg'
        }
      : null;
    return {
      id: String(card.id || globalThis.crypto?.randomUUID?.() || `card-${Date.now()}`),
      lane: LANES.some(([lane]) => lane === card.lane) ? card.lane : 'question',
      title: String(card.title || 'Untitled post').slice(0, 140),
      message: String(card.message || '').slice(0, 3000),
      owner: String(card.owner || 'Unassigned').slice(0, 100),
      author: String(card.author || 'Team member').slice(0, 120),
      created_at: card.created_at || new Date().toISOString(),
      updated_at: card.updated_at || card.created_at || new Date().toISOString(),
      image,
      updates: Array.isArray(card.updates)
        ? card.updates.slice(-50).map((update) => ({
          id: String(update?.id || globalThis.crypto?.randomUUID?.() || `update-${Date.now()}`),
          message: String(update?.message || '').slice(0, 2000),
          author: String(update?.author || 'Team member').slice(0, 120),
          created_at: update?.created_at || new Date().toISOString()
        })).filter((update) => update.message)
        : []
    };
  }

  function normalizeDocument(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    let cards = Array.isArray(input.cards) ? input.cards.map(normalizeCard) : clone(starterCards);
    if (Number(input.schema_version || 0) < BUILD_BOARD_SCHEMA_VERSION) {
      const retained = cards.filter((card) => (
        !BUILD_BOARD_V6_RETIRED_IDS.has(card.id)
        && !BUILD_BOARD_V6_RETIRED_TITLES.has(card.title)
      ));
      const existingById = new Map(retained.map((card) => [card.id, card]));
      const legacyByTitle = new Map(retained.map((card) => [card.title, card]));
      const refreshedStarters = starterCards.map((starter) => {
        const existing = existingById.get(starter.id) || legacyByTitle.get(starter.title);
        return normalizeCard(existing ? {
          ...starter,
          created_at: existing.created_at || starter.created_at,
          image: existing.image,
          updates: existing.updates
        } : starter);
      });
      const teamCards = retained.filter((card) => (
        !BUILD_BOARD_V6_STARTER_IDS.has(card.id)
        && !BUILD_BOARD_V6_STARTER_TITLES.has(card.title)
      ));
      cards = [...refreshedStarters, ...teamCards];
    }
    return { schema_version: BUILD_BOARD_SCHEMA_VERSION, cards };
  }

  function currentSession() {
    const current = globalThis.MXGENIUS_CONFIG?.getSession?.() || {};
    return {
      accessToken: current.accessToken,
      organizationId: current.organizationId,
      account: current.account,
      correlationId: globalThis.crypto?.randomUUID?.()
    };
  }

  async function authenticatedSession() {
    await globalThis.MXGENIUS_CONFIG?.ready;
    let current = currentSession();
    if (!current.accessToken && globalThis.MXGENIUS_AUTH?.getToken) {
      await globalThis.MXGENIUS_AUTH.getToken();
      current = currentSession();
    }
    if (!current.accessToken) throw new Error('Sign in is required to open the shared build board.');
    return current;
  }

  function authorName() {
    const account = currentSession().account || globalThis.MXGENIUS_AUTH?.account?.() || {};
    return String(
      account.name
      || account.display_name
      || account.idTokenClaims?.name
      || account.username
      || account.idTokenClaims?.preferred_username
      || 'Team member'
    ).slice(0, 120);
  }

  function setSaveState(message, value = '') {
    elements.saveState.textContent = message;
    elements.saveState.dataset.state = value;
    if (value !== 'error') elements.saveState.removeAttribute('title');
  }

  function setDirty() {
    state.dirty = true;
    elements.save.disabled = false;
    setSaveState('Unsaved changes', 'dirty');
  }

  function showError(error) {
    const message = error?.message || String(error);
    const display = error?.code === 'WORKSPACE_VERSION_CONFLICT'
      ? 'Someone else updated the board. Reload the team version before posting again.'
      : message;
    setSaveState(display, 'error');
    elements.saveState.title = message;
    elements.save.disabled = false;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return 'Unknown time';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function laneLabel(lane) {
    return LANES.find(([value]) => value === lane)?.[1] || 'Open question';
  }

  function moveLabel(lane) {
    if (lane === 'complete') return 'Reopen';
    return 'Mark complete';
  }

  function renderUpdates(card, container) {
    const details = makeElement('details', 'card-updates');
    const summary = makeElement('summary', '', `Updates (${card.updates.length})`);
    const list = makeElement('div', 'update-list');
    if (!card.updates.length) list.append(makeElement('div', 'empty-lane', 'No updates yet.'));
    for (const update of card.updates) {
      const item = makeElement('div', 'update-item');
      item.append(
        makeElement('p', '', update.message),
        makeElement('small', '', `${update.author} · ${formatDate(update.created_at)}`)
      );
      list.append(item);
    }
    const form = makeElement('form', 'update-form');
    const textarea = document.createElement('textarea');
    textarea.rows = 2;
    textarea.maxLength = 2000;
    textarea.required = true;
    textarea.setAttribute('aria-label', `Add an update to ${card.title}`);
    textarea.placeholder = 'Add a short answer, decision, or progress note…';
    const submit = makeElement('button', 'button button--small', 'Post update');
    submit.type = 'submit';
    form.append(textarea, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = textarea.value.trim();
      if (!message) return;
      card.updates.push({
        id: globalThis.crypto?.randomUUID?.() || `update-${Date.now()}`,
        message,
        author: authorName(),
        created_at: new Date().toISOString()
      });
      card.updated_at = new Date().toISOString();
      setDirty();
      renderBoard();
      await persistBoard();
    });
    details.append(summary, list, form);
    container.append(details);
  }

  async function hydrateCardImage(card, image) {
    const assetId = card.image?.asset_id;
    if (!assetId) return;
    let pending = state.assetUrls.get(assetId);
    if (!pending) {
      pending = authenticatedSession()
        .then((session) => globalThis.MXApplicationClient.projectWorkspaces.getAsset(
          WORKSPACE_KEY,
          assetId,
          session
        ))
        .then((blob) => {
          if (!(blob instanceof Blob) || !CARD_IMAGE_TYPES.has(blob.type)) {
            throw new Error('The card asset is not a supported image.');
          }
          return URL.createObjectURL(blob);
        });
      state.assetUrls.set(assetId, pending);
    }
    try {
      const url = await pending;
      state.assetUrls.set(assetId, url);
      if (!image.isConnected || image.dataset.assetId !== assetId) return;
      image.src = url;
      image.hidden = false;
    } catch {
      state.assetUrls.delete(assetId);
    }
  }

  function renderCard(card) {
    const article = makeElement('article', 'board-card');
    article.dataset.lane = card.lane;
    const topline = makeElement('div', 'card-topline');
    const heading = makeElement('div');
    heading.append(
      makeElement('span', 'card-type', laneLabel(card.lane)),
      makeElement('h3', '', card.title)
    );
    topline.append(heading);
    article.append(topline);
    const staticArtwork = STATIC_CARD_ARTWORK.get(card.id);
    if (staticArtwork) {
      const image = document.createElement('img');
      image.className = 'card-image card-image--diagram';
      image.src = staticArtwork.src;
      image.alt = staticArtwork.alt;
      image.loading = 'lazy';
      article.append(image);
    } else if (card.image?.asset_id) {
      const image = document.createElement('img');
      image.className = 'card-image';
      image.alt = card.image.name || `${card.title} card picture`;
      image.dataset.assetId = card.image.asset_id;
      image.hidden = true;
      article.append(image);
      void hydrateCardImage(card, image);
    }
    article.append(makeElement('p', 'card-message', card.message));

    const meta = makeElement('div', 'card-meta');
    meta.append(
      makeElement('span', 'card-owner', `Owner: ${card.owner || 'Unassigned'}`),
      makeElement('span', 'card-creator', `Created by ${card.author} · ${formatDate(card.created_at)}`)
    );
    if (card.updated_at !== card.created_at) {
      meta.append(makeElement('span', '', `Last activity ${formatDate(card.updated_at)}`));
    }
    article.append(meta);

    const actions = makeElement('div', 'card-actions');
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Move ${card.title}`);
    for (const [lane, label] of LANES) {
      const option = document.createElement('option');
      option.value = lane;
      option.textContent = `Move to ${label}`;
      option.selected = lane === card.lane;
      select.append(option);
    }
    select.addEventListener('change', async () => {
      card.lane = select.value;
      card.updated_at = new Date().toISOString();
      setDirty();
      renderBoard();
      await persistBoard();
    });
    const complete = makeElement('button', 'button button--small', moveLabel(card.lane));
    complete.type = 'button';
    complete.addEventListener('click', async () => {
      card.lane = card.lane === 'complete' ? 'sprint' : 'complete';
      card.updated_at = new Date().toISOString();
      setDirty();
      renderBoard();
      await persistBoard();
    });
    actions.append(select, complete);
    article.append(actions);
    renderUpdates(card, article);
    return article;
  }

  function renderBoard() {
    const targets = {
      question: elements.questionCards,
      sprint: elements.sprintCards,
      complete: elements.completeCards
    };
    for (const target of Object.values(targets)) target.replaceChildren();

    const counts = { question: 0, sprint: 0, complete: 0 };
    const cards = state.document?.cards || [];
    for (const card of cards) {
      counts[card.lane] += 1;
      targets[card.lane].append(renderCard(card));
    }
    for (const [lane, target] of Object.entries(targets)) {
      if (!counts[lane]) target.append(makeElement('div', 'empty-lane', 'Nothing here yet.'));
    }
    for (const lane of Object.keys(counts)) {
      elements[`${lane}Count`].textContent = counts[lane];
      elements[`${lane}Total`].textContent = counts[lane];
    }
  }

  function applyPayload(payload) {
    const workspace = payload?.workspace;
    const needsSchemaSave = Boolean(workspace)
      && Number(workspace?.document?.schema_version || 0) < BUILD_BOARD_SCHEMA_VERSION;
    state.version = Number(workspace?.version || 0);
    state.document = normalizeDocument(workspace?.document);
    state.dirty = needsSchemaSave;
    elements.save.disabled = !needsSchemaSave;
    setSaveState(
      needsSchemaSave
        ? `Build refresh applied to team board v${state.version} · save to publish it`
        : state.version ? `Team board v${state.version} · saved ${formatDate(workspace.updated_at)}` : 'Starter board · saves with the first post',
      needsSchemaSave ? 'dirty' : state.version ? 'saved' : ''
    );
    renderBoard();
  }

  async function loadBoard() {
    elements.reload.disabled = true;
    setSaveState('Loading team board…');
    try {
      const payload = await globalThis.MXApplicationClient.projectWorkspaces.get(
        WORKSPACE_KEY,
        await authenticatedSession()
      );
      applyPayload(payload);
    } catch (error) {
      if (!state.document) applyPayload({ workspace: null });
      showError(error);
    } finally {
      elements.reload.disabled = false;
    }
  }

  async function persistBoard() {
    if (state.saving || !state.dirty) return !state.dirty;
    state.saving = true;
    elements.save.disabled = true;
    setSaveState('Saving team board…', 'saving');
    try {
      const allComplete = state.document.cards.length > 0
        && state.document.cards.every((card) => card.lane === 'complete');
      const payload = await globalThis.MXApplicationClient.projectWorkspaces.save(
        WORKSPACE_KEY,
        {
          title: WORKSPACE_TITLE,
          status: allComplete ? 'review_complete' : 'collecting',
          expectedVersion: state.version,
          document: state.document
        },
        await authenticatedSession()
      );
      applyPayload(payload);
      return true;
    } catch (error) {
      state.dirty = true;
      showError(error);
      return false;
    } finally {
      state.saving = false;
    }
  }

  async function createPost(event) {
    event.preventDefault();
    const title = elements.postTitle.value.trim();
    const message = elements.postMessage.value.trim();
    if (!title || !message) return;
    const imageFile = elements.postImage.files?.[0] || null;
    if (imageFile && (!CARD_IMAGE_TYPES.has(imageFile.type) || imageFile.size > MAX_CARD_IMAGE_BYTES)) {
      showError(new Error('Card pictures must be JPG, PNG, or WebP files no larger than 8 MB.'));
      return;
    }
    const now = new Date().toISOString();
    const card = normalizeCard({
      id: globalThis.crypto?.randomUUID?.() || `card-${Date.now()}`,
      lane: elements.postLane.value,
      title,
      message,
      owner: elements.postOwner.value.trim() || 'Unassigned',
      author: authorName(),
      created_at: now,
      updated_at: now,
      updates: []
    });
    state.document.cards.unshift(card);
    elements.postSubmit.disabled = true;
    setDirty();
    renderBoard();
    const saved = await persistBoard();
    if (!saved) {
      elements.postSubmit.disabled = false;
      return;
    }
    if (imageFile) {
      try {
        const savedCard = state.document.cards.find((item) => item.id === card.id);
        if (!savedCard) throw new Error('The new card could not be matched after saving.');
        setSaveState('Uploading card picture…', 'saving');
        const payload = await globalThis.MXApplicationClient.projectWorkspaces.uploadAsset(
          WORKSPACE_KEY,
          imageFile,
          {
            section: `board-card-${card.id}`.slice(0, 64),
            note: `Card picture for ${title}`,
            session: await authenticatedSession()
          }
        );
        savedCard.image = {
          asset_id: payload.asset.id,
          name: payload.asset.original_filename || imageFile.name,
          media_type: payload.asset.media_type || imageFile.type
        };
        savedCard.updated_at = new Date().toISOString();
        setDirty();
        renderBoard();
        if (!await persistBoard()) {
          elements.postSubmit.disabled = false;
          return;
        }
      } catch (error) {
        showError(error);
        elements.postSubmit.disabled = false;
        return;
      }
    }
    elements.composer.reset();
    elements.postLane.value = 'question';
    clearComposerImage();
    elements.postSubmit.disabled = false;
  }

  function clearComposerImage() {
    if (composerPreviewUrl) URL.revokeObjectURL(composerPreviewUrl);
    composerPreviewUrl = '';
    elements.postImage.value = '';
    elements.postImagePreviewImage.removeAttribute('src');
    elements.postImagePreview.hidden = true;
  }

  function previewComposerImage() {
    const file = elements.postImage.files?.[0];
    if (!file) {
      clearComposerImage();
      return;
    }
    if (!CARD_IMAGE_TYPES.has(file.type) || file.size > MAX_CARD_IMAGE_BYTES) {
      clearComposerImage();
      showError(new Error('Card pictures must be JPG, PNG, or WebP files no larger than 8 MB.'));
      return;
    }
    if (composerPreviewUrl) URL.revokeObjectURL(composerPreviewUrl);
    composerPreviewUrl = URL.createObjectURL(file);
    elements.postImagePreviewImage.src = composerPreviewUrl;
    elements.postImagePreview.hidden = false;
  }

  function collectElements() {
    Object.assign(elements, {
      saveState: document.getElementById('boardSaveState'),
      save: document.getElementById('boardSave'),
      reload: document.getElementById('boardReload'),
      composer: document.getElementById('boardComposer'),
      postLane: document.getElementById('postLane'),
      postTitle: document.getElementById('postTitle'),
      postOwner: document.getElementById('postOwner'),
      postMessage: document.getElementById('postMessage'),
      postImage: document.getElementById('postImage'),
      postImagePreview: document.getElementById('postImagePreview'),
      postImagePreviewImage: document.getElementById('postImagePreviewImage'),
      postImageClear: document.getElementById('postImageClear'),
      postSubmit: document.getElementById('postSubmit'),
      questionCards: document.getElementById('questionCards'),
      sprintCards: document.getElementById('sprintCards'),
      completeCards: document.getElementById('completeCards'),
      questionCount: document.getElementById('questionCount'),
      sprintCount: document.getElementById('sprintCount'),
      completeCount: document.getElementById('completeCount'),
      questionTotal: document.getElementById('questionTotal'),
      sprintTotal: document.getElementById('sprintTotal'),
      completeTotal: document.getElementById('completeTotal')
    });
  }

  function boot() {
    collectElements();
    elements.composer.addEventListener('submit', createPost);
    elements.postImage.addEventListener('change', previewComposerImage);
    elements.postImageClear.addEventListener('click', clearComposerImage);
    elements.save.addEventListener('click', persistBoard);
    elements.reload.addEventListener('click', loadBoard);
    window.addEventListener('pagehide', () => {
      clearComposerImage();
      for (const value of state.assetUrls.values()) {
        if (typeof value === 'string') URL.revokeObjectURL(value);
      }
      state.assetUrls.clear();
    });
    loadBoard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
