(() => {
  'use strict';

  const SCHEMA_URL = 'assets/xr-ui-fx/sound-cues.csv';
  const AUDIO_ROOT = 'assets/xr-ui-fx/';
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const MAX_DURATION_SECONDS = 15;
  const FAMILY_ORDER = ['audio/ui', 'audio/spatial', 'audio/system'];
  const FAMILY_LABELS = {
    'audio/ui': ['Interface', 'Controls, workflow, voice, and evidence'],
    'audio/spatial': ['Spatial', 'World-positioned targets and guidance'],
    'audio/system': ['System', 'Connection, safety, and dashboard states']
  };
  const pending = new Map();
  const pendingResets = new Set();
  let cues = [];
  let overrides = new Map();
  let selectedCueId = '';
  let activeAudio = null;
  let activeButton = null;
  let previewRequest = 0;

  const elements = {};

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === '"') {
        if (quoted && text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (character === ',' && !quoted) {
        row.push(field);
        field = '';
      } else if ((character === '\n' || character === '\r') && !quoted) {
        if (character === '\r' && text[index + 1] === '\n') index += 1;
        row.push(field);
        if (row.some((value) => value.length)) rows.push(row);
        row = [];
        field = '';
      } else {
        field += character;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    const [headers = [], ...values] = rows;
    return values.map((columns) => Object.fromEntries(headers.map((header, index) => [header, columns[index] || ''])));
  }

  function soundName(filename) {
    return filename
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function formatDuration(milliseconds) {
    const value = Number(milliseconds || 0);
    return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 ? 1 : 0)} sec` : `${value} ms`;
  }

  function defaultUrl(cue) {
    return `${AUDIO_ROOT}${cue.folder}/${encodeURIComponent(cue.filename)}`;
  }

  function stopPreview() {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    }
    if (activeButton) {
      activeButton.textContent = 'Play';
      activeButton.setAttribute('aria-pressed', 'false');
    }
    activeAudio = null;
    activeButton = null;
  }

  async function previewCue(cue, button) {
    if (activeButton === button) {
      stopPreview();
      return;
    }
    stopPreview();
    const request = ++previewRequest;
    let source = pending.get(cue.id)?.url;
    if (!source && !pendingResets.has(cue.id) && overrides.has(cue.id)) {
      try { source = await globalThis.MXGeniusSoundStorage?.getCueUrl?.(cue.id); }
      catch { /* The bundled cue remains the safe playback fallback. */ }
    }
    source ||= defaultUrl(cue);
    if (request !== previewRequest) return;
    const audio = new Audio(source);
    activeAudio = audio;
    activeButton = button;
    button.textContent = 'Stop';
    button.setAttribute('aria-pressed', 'true');
    const finish = () => {
      if (activeAudio === audio) stopPreview();
    };
    audio.addEventListener('ended', finish, { once: true });
    audio.addEventListener('error', () => {
      elements.status.textContent = `${soundName(cue.filename)} could not be played`;
      finish();
    }, { once: true });
    audio.play().catch(() => {
      elements.status.textContent = 'Use Play again after allowing audio in this browser';
      finish();
    });
  }

  function updatePendingState() {
    const count = pending.size + pendingResets.size;
    elements.pending.textContent = count ? `${count} change${count === 1 ? '' : 's'} staged` : 'No staged changes';
    elements.save.disabled = count === 0;
  }

  function resetCue(cue) {
    const replacement = pending.get(cue.id);
    if (replacement) {
      URL.revokeObjectURL(replacement.url);
      pending.delete(cue.id);
      elements.status.textContent = `${soundName(cue.filename)} replacement cleared`;
    } else if (pendingResets.has(cue.id)) {
      pendingResets.delete(cue.id);
      elements.status.textContent = `${soundName(cue.filename)} restore cancelled`;
    } else if (overrides.has(cue.id)) {
      pendingResets.add(cue.id);
      elements.status.textContent = `${soundName(cue.filename)} will use the bundled file after saving`;
    }
    renderFamilies();
    updatePendingState();
  }

  function cueRow(cue) {
    const row = document.createElement('div');
    row.className = 'settings-sound-cue';
    row.dataset.cueId = cue.id;

    const copy = document.createElement('div');
    copy.className = 'settings-sound-copy';
    const heading = document.createElement('div');
    heading.className = 'settings-sound-heading';
    const name = document.createElement('strong');
    name.textContent = soundName(cue.filename);
    const id = document.createElement('span');
    id.textContent = cue.id;
    heading.append(name, id);
    const description = document.createElement('span');
    description.className = 'settings-sound-description';
    description.textContent = cue.character || cue.trigger;
    const meta = document.createElement('span');
    meta.className = 'settings-sound-meta';
    meta.append(`${formatDuration(cue.duration_target_ms)} · ${cue.priority}`);
    if (cue.loop === 'yes') meta.append(' · Loop');
    if (cue.spatial === 'yes') meta.append(' · Positioned');
    const file = document.createElement('span');
    file.className = 'settings-sound-file';
    const replacement = pending.get(cue.id);
    const override = overrides.get(cue.id);
    const restoring = pendingResets.has(cue.id);
    if (replacement || restoring) row.classList.add('has-pending-sound');
    file.textContent = replacement
      ? `${replacement.file.name} · staged`
      : restoring
        ? `${cue.filename} · default staged`
        : override
          ? `${override.filename} · Azure`
          : cue.filename;
    copy.append(heading, description, meta, file);

    const actions = document.createElement('div');
    actions.className = 'settings-sound-actions';
    const play = document.createElement('button');
    play.className = 'settings-sound-button';
    play.type = 'button';
    play.textContent = 'Play';
    play.setAttribute('aria-pressed', 'false');
    play.setAttribute('aria-label', `Play ${soundName(cue.filename)}`);
    play.addEventListener('click', () => void previewCue(cue, play));
    const replace = document.createElement('button');
    replace.className = 'settings-sound-button';
    replace.type = 'button';
    replace.textContent = 'Replace';
    replace.setAttribute('aria-label', `Replace ${soundName(cue.filename)}`);
    replace.addEventListener('click', () => {
      selectedCueId = cue.id;
      elements.fileInput.click();
    });
    const reset = document.createElement('button');
    reset.className = 'settings-sound-button settings-sound-reset';
    reset.type = 'button';
    reset.textContent = restoring ? 'Undo' : override ? 'Restore' : 'Reset';
    reset.disabled = !replacement && !override && !restoring;
    reset.setAttribute('aria-label', `${restoring ? 'Cancel restore for' : 'Restore'} ${soundName(cue.filename)}`);
    reset.addEventListener('click', () => resetCue(cue));
    actions.append(play, replace, reset);
    row.append(copy, actions);
    return row;
  }

  function renderFamilies() {
    elements.families.replaceChildren();
    FAMILY_ORDER.forEach((folder, familyIndex) => {
      const familyCues = cues.filter((cue) => cue.folder === folder);
      if (!familyCues.length) return;
      const family = document.createElement('details');
      family.className = 'settings-sound-family';
      family.open = familyIndex === 0;
      const summary = document.createElement('summary');
      const labels = FAMILY_LABELS[folder] || [folder, ''];
      const title = document.createElement('span');
      title.append(document.createElement('strong'), document.createElement('small'));
      title.children[0].textContent = labels[0];
      title.children[1].textContent = labels[1];
      const count = document.createElement('span');
      count.className = 'settings-sound-count';
      count.textContent = String(familyCues.length);
      summary.append(title, count);
      const list = document.createElement('div');
      list.className = 'settings-sound-list';
      familyCues.forEach((cue) => list.append(cueRow(cue)));
      family.append(summary, list);
      elements.families.append(family);
    });
  }

  function audioDuration(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const probe = new Audio();
      const cleanup = () => URL.revokeObjectURL(url);
      probe.preload = 'metadata';
      probe.addEventListener('loadedmetadata', () => {
        const duration = probe.duration;
        cleanup();
        if (!Number.isFinite(duration)) reject(new Error('Audio duration could not be read'));
        else resolve(duration);
      }, { once: true });
      probe.addEventListener('error', () => {
        cleanup();
        reject(new Error('The selected file is not readable audio'));
      }, { once: true });
      probe.src = url;
    });
  }

  async function stageReplacement(file) {
    const cue = cues.find((candidate) => candidate.id === selectedCueId);
    if (!cue || !file) return;
    const extensionAllowed = /\.(wav|mp3|m4a)$/i.test(file.name);
    const typeAllowed = ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a'].includes(file.type);
    if (!extensionAllowed || (file.type && !typeAllowed)) throw new Error('Choose a WAV, MP3, or M4A file');
    if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('Sound files must be between 1 byte and 5 MiB');
    const duration = await audioDuration(file);
    if (duration > MAX_DURATION_SECONDS) throw new Error('Interface sounds must be 15 seconds or shorter');
    const prior = pending.get(cue.id);
    if (prior) URL.revokeObjectURL(prior.url);
    pendingResets.delete(cue.id);
    pending.set(cue.id, { cueId: cue.id, file, url: URL.createObjectURL(file), duration });
    const row = elements.families.querySelector(`[data-cue-id="${cue.id}"]`);
    row?.classList.add('has-pending-sound');
    const filename = row?.querySelector('.settings-sound-file');
    if (filename) filename.textContent = `${file.name} · staged`;
    const reset = row?.querySelector('.settings-sound-reset');
    if (reset) reset.disabled = false;
    elements.status.textContent = `${soundName(cue.filename)} is ready to preview`;
    updatePendingState();
  }

  async function saveChanges() {
    const adapter = globalThis.MXGeniusSoundStorage;
    if (!adapter?.saveIndex) {
      elements.status.textContent = 'Azure save is not connected yet; staged replacements remain on this page';
      elements.storageState.textContent = 'Azure next';
      return;
    }
    elements.save.disabled = true;
    elements.status.textContent = 'Saving sound library…';
    try {
      await adapter.saveIndex({
        schemaVersion: 1,
        cues,
        replacements: [...pending.values()].map(({ cueId, file, duration }) => ({ cueId, file, duration })),
        resets: [...pendingResets]
      });
      pending.forEach((replacement) => URL.revokeObjectURL(replacement.url));
      pending.clear();
      pendingResets.clear();
      const current = await adapter.loadIndex({ force: true });
      overrides = current.byCue;
      elements.storageState.textContent = 'Azure';
      elements.status.textContent = `${cues.length} cues · ${overrides.size} custom saved`;
      renderFamilies();
      updatePendingState();
    } catch (error) {
      elements.status.textContent = error?.message || 'Sound library could not be saved';
      elements.save.disabled = false;
    }
  }

  async function initialize() {
    Object.assign(elements, {
      families: document.getElementById('settingsSoundFamilies'),
      status: document.getElementById('settingsSoundStatus'),
      storageState: document.getElementById('settingsSoundStorageState'),
      pending: document.getElementById('settingsSoundPending'),
      save: document.getElementById('settingsSoundSave'),
      fileInput: document.getElementById('settingsSoundFileInput')
    });
    if (Object.values(elements).some((element) => !element)) return;
    elements.fileInput.addEventListener('change', async () => {
      const file = elements.fileInput.files?.[0];
      try {
        await stageReplacement(file);
      } catch (error) {
        elements.status.textContent = error?.message || 'Sound could not be staged';
      } finally {
        elements.fileInput.value = '';
        selectedCueId = '';
      }
    });
    elements.save.addEventListener('click', saveChanges);
    try {
      const response = await fetch(SCHEMA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Sound manifest returned ${response.status}`);
      cues = parseCsv(await response.text()).filter((cue) => cue.id && cue.filename && FAMILY_ORDER.includes(cue.folder));
      renderFamilies();
      elements.status.textContent = `${cues.length} cues · checking Azure`;
      try {
        const current = await globalThis.MXGeniusSoundStorage?.loadIndex?.();
        if (current) {
          overrides = current.byCue;
          elements.storageState.textContent = 'Azure';
        }
      } catch {
        elements.storageState.textContent = 'Bundled';
      }
      renderFamilies();
      elements.status.textContent = `${cues.length} cues · ${overrides.size} custom`;
    } catch (error) {
      elements.status.textContent = error?.message || 'Sound manifest could not be loaded';
    }
    updatePendingState();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
