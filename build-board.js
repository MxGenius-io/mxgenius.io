(() => {
  'use strict';

  const WORKSPACE_KEY = 'apparatus-build-board';
  const WORKSPACE_TITLE = 'MXGenius Build Board';
  const CARD_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const MAX_CARD_IMAGE_BYTES = 8 * 1024 * 1024;
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
    saving: false,
    assetUrls: new Map()
  };
  const elements = {};
  let composerPreviewUrl = '';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultDocument() {
    return { schema_version: 1, cards: clone(starterCards) };
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
    if (card.image?.asset_id) {
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
