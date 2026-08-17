(() => {
  'use strict';

  const WORKSPACE_KEY = 'apparatus-build-board';
  const WORKSPACE_TITLE = 'MXGenius Build Board';
  const LANES = [
    ['question', 'Open question'],
    ['sprint', 'Current sprint'],
    ['complete', 'Completed']
  ];

  const starterCards = [
    {
      id: 'question-sprint-configuration',
      lane: 'question',
      title: 'Which physical configuration is the sprint target?',
      message: 'Lock the casing/model, thermal-camera position, Pi placement, battery representation, and cable route that the next integrated apparatus should prove.',
      owner: 'Joshua Millard + Thomas Hagy',
      author: 'Team board starter',
      created_at: '2026-08-17T00:00:00Z',
      updated_at: '2026-08-17T00:00:00Z',
      updates: []
    },
    {
      id: 'question-demonstration-done',
      lane: 'question',
      title: 'What must the demonstration prove to count as done?',
      message: 'Confirm the minimum evidence for secure mounting, protected power/data routing, heat, balance, visibility, ergonomics, assembly order, and serviceability.',
      owner: 'Dwayne Tillman',
      author: 'Team board starter',
      created_at: '2026-08-17T00:00:00Z',
      updated_at: '2026-08-17T00:00:00Z',
      updates: []
    },
    {
      id: 'sprint-mount-refinement',
      lane: 'sprint',
      title: 'Refine the apparatus mount and cable routing',
      message: 'Tighten the thermal-sensor mounting, reduce clunky interactions, protect connectors, and make the Pi/battery arrangement easier to assemble and handle.',
      owner: 'Unassigned',
      author: 'Team board starter',
      created_at: '2026-08-17T00:00:00Z',
      updated_at: '2026-08-17T00:00:00Z',
      updates: []
    },
    {
      id: 'sprint-live-apparatus-test',
      lane: 'sprint',
      title: 'Run the integrated headset apparatus test',
      message: 'With the device connected, verify FLIR pixels in the XR floating panel, independent Pi diagnostics, the VR exit path, and headset performance with the high-detail apparatus model.',
      owner: 'Dwayne Tillman',
      author: 'Team board starter',
      created_at: '2026-08-17T00:00:00Z',
      updated_at: '2026-08-17T00:00:00Z',
      updates: []
    },
    {
      id: 'sprint-manual-image-smoke',
      lane: 'sprint',
      title: 'Smoke-check the recovered manual image path',
      message: 'Manual retrieval is healthy on the frozen CL350 v2 pack after restoring the missing deployment settings. Confirm one real page-linked image in the signed-in application.',
      owner: 'Dwayne Tillman',
      author: 'Team board starter',
      created_at: '2026-08-17T00:00:00Z',
      updated_at: '2026-08-17T00:00:00Z',
      updates: []
    },
    {
      id: 'complete-sensor-bridge',
      lane: 'complete',
      title: 'Quest Sensor Bridge accepted in Alpha',
      message: 'The Quest build was accepted, the launcher/banner packaging was corrected, and the landscape cover was visually confirmed in Meta Quest Developer Hub.',
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
    }
  ];

  const state = {
    version: 0,
    document: null,
    dirty: false,
    saving: false
  };
  const elements = {};

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultDocument() {
    return { schema_version: 1, cards: clone(starterCards) };
  }

  function normalizeCard(value) {
    const card = value && typeof value === 'object' ? value : {};
    return {
      id: String(card.id || globalThis.crypto?.randomUUID?.() || `card-${Date.now()}`),
      lane: LANES.some(([lane]) => lane === card.lane) ? card.lane : 'question',
      title: String(card.title || 'Untitled post').slice(0, 140),
      message: String(card.message || '').slice(0, 3000),
      owner: String(card.owner || 'Unassigned').slice(0, 100),
      author: String(card.author || 'Team member').slice(0, 120),
      created_at: card.created_at || new Date().toISOString(),
      updated_at: card.updated_at || card.created_at || new Date().toISOString(),
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
    const cards = Array.isArray(input.cards) ? input.cards.map(normalizeCard) : clone(starterCards);
    return { schema_version: 1, cards };
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
  }

  function setDirty() {
    state.dirty = true;
    elements.save.disabled = false;
    elements.error.hidden = true;
    setSaveState('Unsaved changes', 'dirty');
  }

  function showError(error) {
    const message = error?.message || String(error);
    elements.errorText.textContent = error?.code === 'WORKSPACE_VERSION_CONFLICT'
      ? 'Someone else updated the board. Reload the team version before posting again.'
      : message;
    elements.error.hidden = false;
    setSaveState('Save failed', 'error');
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
    article.append(topline, makeElement('p', 'card-message', card.message));

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
    state.version = Number(workspace?.version || 0);
    state.document = normalizeDocument(workspace?.document);
    state.dirty = false;
    elements.save.disabled = true;
    setSaveState(
      state.version ? `Team board v${state.version} · saved ${formatDate(workspace.updated_at)}` : 'Starter board · saves with the first post',
      state.version ? 'saved' : ''
    );
    renderBoard();
  }

  async function loadBoard() {
    elements.error.hidden = true;
    setSaveState('Loading team board…');
    try {
      const payload = await globalThis.MXApplicationClient.projectWorkspaces.get(
        WORKSPACE_KEY,
        await authenticatedSession()
      );
      applyPayload(payload);
    } catch (error) {
      showError(error);
      if (!state.document) applyPayload({ workspace: null });
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
    const now = new Date().toISOString();
    state.document.cards.unshift(normalizeCard({
      id: globalThis.crypto?.randomUUID?.() || `card-${Date.now()}`,
      lane: elements.postLane.value,
      title,
      message,
      owner: elements.postOwner.value.trim() || 'Unassigned',
      author: authorName(),
      created_at: now,
      updated_at: now,
      updates: []
    }));
    elements.composer.reset();
    elements.postLane.value = 'question';
    setDirty();
    renderBoard();
    await persistBoard();
  }

  function collectElements() {
    Object.assign(elements, {
      saveState: document.getElementById('boardSaveState'),
      save: document.getElementById('boardSave'),
      error: document.getElementById('boardError'),
      errorText: document.getElementById('boardErrorText'),
      reload: document.getElementById('boardReload'),
      composer: document.getElementById('boardComposer'),
      postLane: document.getElementById('postLane'),
      postTitle: document.getElementById('postTitle'),
      postOwner: document.getElementById('postOwner'),
      postMessage: document.getElementById('postMessage'),
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
    elements.save.addEventListener('click', persistBoard);
    elements.reload.addEventListener('click', loadBoard);
    loadBoard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
