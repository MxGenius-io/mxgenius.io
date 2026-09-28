(() => {
  const tabs = [...document.querySelectorAll('[role="tab"][data-tab]')];
  const panels = [...document.querySelectorAll('[role="tabpanel"][data-panel]')];
  const stateLabel = document.getElementById('operationsState');
  const validTabs = new Set(tabs.map((tab) => tab.dataset.tab));
  const labels = {
    highlights: 'R&D highlights ready',
    reports: 'Deprecated reports archive open',
    customers: 'Customer operations active',
    build: 'Build board active',
    readiness: 'Readiness record active',
    features: 'Feature inventory active',
    patents: 'Patent portfolio active',
    feedback: 'Feedback queue active',
    settings: 'Operations settings active',
    access: 'Access registry active'
  };
  const highlightVideos = [...document.querySelectorAll('#panel-highlights video')];
  let accessLoaded = false;
  let customersLoaded = false;
  let settingsLoaded = false;

  function embeddedStyle(frame) {
    const canvas = frame.id === 'reportsFrame' ? '#0f172a' : 'transparent';
    const readinessControls = frame.id === 'readinessFrame' ? `
      .workspace-header {
        display: flex !important;
        min-height: 52px !important;
        justify-content: flex-end !important;
        padding: 8px 20px !important;
      }
      .workspace-header .brand,
      .workspace-header .header-actions > a { display: none !important; }
      .workspace-header .header-actions {
        width: 100% !important;
        justify-content: flex-end !important;
      }
    ` : '';
    const buildControls = frame.id === 'buildFrame' ? `
      .board-header {
        display: flex !important;
        min-height: 52px !important;
        justify-content: flex-end !important;
        padding: 8px 20px !important;
      }
      .board-header .brand,
      .board-header .header-actions > a { display: none !important; }
      .board-header .header-actions {
        width: 100% !important;
        justify-content: flex-end !important;
      }
    ` : '';
    return `
      body > header,
      body > .container > header,
      .board-header,
      .workspace-header,
      .catalog-header,
      .patent-header,
      .feedback-page__header { display: none !important; }
      html, body { min-height: auto !important; background: ${canvas} !important; }
      body > .container,
      .board-shell,
      .workspace-shell,
      .catalog-shell,
      .feedback-page__shell { width: 100% !important; max-width: none !important; margin: 0 !important; padding: 20px !important; }
      ${readinessControls}
      ${buildControls}
    `;
  }

  function prepareFrame(frame) {
    try {
      const documentRef = frame.contentDocument;
      if (!documentRef?.head) return;
      if (!documentRef.getElementById('operations-center-embed-style')) {
        const style = documentRef.createElement('style');
        style.id = 'operations-center-embed-style';
        style.textContent = embeddedStyle(frame);
        documentRef.head.appendChild(style);
      }
    } catch {
      // Same-origin pages are expected. Their own shell remains usable if embedding is unavailable.
    }
  }

  function loadPanel(panel) {
    const frames = [...panel.querySelectorAll('iframe')];
    frames.forEach((frame) => {
      frame.addEventListener('load', () => prepareFrame(frame), { once: true });
      if (!frame.getAttribute('src') && frame.dataset.src) frame.src = frame.dataset.src;
      else if (frame.contentDocument?.readyState === 'complete') prepareFrame(frame);
    });
  }

  function activate(name, { focus = false, updateHash = true } = {}) {
    const next = validTabs.has(name) ? name : 'highlights';
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === next;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    panels.forEach((panel) => {
      const active = panel.dataset.panel === next;
      panel.hidden = !active;
      if (active) loadPanel(panel);
    });
    if (next !== 'highlights') highlightVideos.forEach((video) => video.pause());
    if (stateLabel) stateLabel.textContent = labels[next];
    if (next === 'access' && !accessLoaded) void refreshAccess();
    if (next === 'settings' && !settingsLoaded) void refreshJetNetConnection();
    if (next === 'customers' && !customersLoaded) {
      customersLoaded = true;
      void window.MXCustomerOperations?.load?.();
    }
    if (updateHash) history.replaceState(null, '', `#${next}`);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      activate(tabs[nextIndex].dataset.tab, { focus: true });
    });
  });

  highlightVideos.forEach((video) => {
    video.addEventListener('play', () => {
      highlightVideos.forEach((candidate) => {
        if (candidate !== video && !candidate.paused) candidate.pause();
      });
    });
  });

  const feedbackFrame = document.getElementById('feedbackFrame');
  document.querySelectorAll('[data-feedback-view]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-feedback-view]').forEach((candidate) => candidate.classList.toggle('is-active', candidate === button));
      const mine = button.dataset.feedbackView === 'mine';
      feedbackFrame.src = mine ? 'feedback.html?embed=1' : 'feedback-admin.html?embed=1';
      feedbackFrame.title = mine ? 'My MXGenius feedback' : 'MXGenius feedback queue';
      feedbackFrame.addEventListener('load', () => prepareFrame(feedbackFrame), { once: true });
    });
  });

  const accessForm = document.getElementById('accessForm');
  const accessInput = document.getElementById('accessRuleInput');
  const accessAdd = document.getElementById('accessAdd');
  const accessRefresh = document.getElementById('accessRefresh');
  const accessStatus = document.getElementById('accessStatus');
  const accessRows = document.getElementById('accessRuleRows');
  const accessEmpty = document.getElementById('accessEmpty');
  const accessRuleTotal = document.getElementById('accessRuleTotal');
  const accessEmailTotal = document.getElementById('accessEmailTotal');
  const accessDomainTotal = document.getElementById('accessDomainTotal');
  const jetNetForm = document.getElementById('settingsJetNetForm');
  const jetNetIdentity = document.getElementById('settingsJetNetIdentity');
  const jetNetCredential = document.getElementById('settingsJetNetCredential');
  const jetNetStatus = document.getElementById('settingsJetNetStatus');
  const jetNetBadge = document.getElementById('settingsJetNetBadge');
  const jetNetConnect = document.getElementById('settingsJetNetConnect');
  const jetNetDisconnect = document.getElementById('settingsJetNetDisconnect');
  const modelKnowledgeFilesChoose = document.getElementById('settingsModelKnowledgeFilesChoose');
  const modelKnowledgeFolderChoose = document.getElementById('settingsModelKnowledgeFolderChoose');
  const modelKnowledgeFiles = document.getElementById('settingsModelKnowledgeFiles');
  const modelKnowledgeFolder = document.getElementById('settingsModelKnowledgeFolder');
  const modelKnowledgeClear = document.getElementById('settingsModelKnowledgeClear');
  const modelKnowledgePublish = document.getElementById('settingsModelKnowledgePublish');
  const modelKnowledgeList = document.getElementById('settingsModelKnowledgeList');
  const modelKnowledgeSummary = document.getElementById('settingsModelKnowledgeSummary');
  const modelKnowledgeStatus = document.getElementById('settingsModelKnowledgeStatus');
  const modelKnowledgeBadge = document.getElementById('settingsModelKnowledgeBadge');
  let accessRules = [];
  let modelKnowledgeQueue = [];
  let modelKnowledgePublishing = false;

  const MODEL_KNOWLEDGE_MAX_BYTES = 50 * 1024 * 1024;
  const MODEL_KNOWLEDGE_EXTENSIONS = new Set([
    'pdf', 'docx', 'txt', 'md', 'csv', 'json', 'html', 'htm', 'jpg', 'jpeg', 'png'
  ]);

  function setAccessStatus(message, state = '') {
    accessStatus.textContent = message;
    accessStatus.dataset.state = state;
  }

  async function authenticatedSession({ forceRefresh = false } = {}) {
    await Promise.resolve(globalThis.MXGENIUS_CONFIG?.ready);
    const renewed = globalThis.MXGENIUS_AUTH?.getToken
      ? await globalThis.MXGENIUS_AUTH.getToken({ forceRefresh })
      : '';
    const current = globalThis.MXGENIUS_CONFIG?.getSession?.() || {};
    const accessToken = renewed || current.accessToken;
    if (!accessToken && !globalThis.MXGENIUS_CONFIG?.allowInsecurePilot) {
      const error = new Error('Sign in is required to manage Operations Center data.');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    return { ...current, accessToken, correlationId: globalThis.crypto?.randomUUID?.() };
  }

  async function withSession(operation) {
    let session = await authenticatedSession();
    try {
      return await operation(session);
    } catch (error) {
      if (!['AUTH_REQUIRED', 'ACCESS_DENIED'].includes(String(error?.code || '')) && error?.status !== 401) throw error;
      session = await authenticatedSession({ forceRefresh: true });
      return operation(session);
    }
  }

  function formatBytes(value) {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  }

  function modelKnowledgePath(file) {
    return String(file.webkitRelativePath || file.name || 'unnamed-file');
  }

  function modelKnowledgeExtension(file) {
    const name = String(file.name || '');
    const separator = name.lastIndexOf('.');
    return separator >= 0 ? name.slice(separator + 1).toLowerCase() : '';
  }

  function modelKnowledgeStateLabel(item) {
    if (item.state === 'uploading') return 'Publishing';
    if (item.state === 'ready') return 'Ready';
    if (item.state === 'error') return 'Retry';
    return 'Staged';
  }

  function renderModelKnowledgeQueue() {
    modelKnowledgeList.replaceChildren();
    const totalBytes = modelKnowledgeQueue.reduce((sum, item) => sum + item.file.size, 0);
    const publishable = modelKnowledgeQueue.filter((item) => item.state === 'pending' || item.state === 'error').length;

    if (modelKnowledgeQueue.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'model-knowledge-empty';
      empty.textContent = 'Add individual files or choose a folder to begin.';
      modelKnowledgeList.appendChild(empty);
      modelKnowledgeSummary.textContent = 'No files staged';
    } else {
      modelKnowledgeSummary.textContent = `${modelKnowledgeQueue.length} ${modelKnowledgeQueue.length === 1 ? 'file' : 'files'} · ${formatBytes(totalBytes)}`;
      modelKnowledgeQueue.forEach((item) => {
        const row = document.createElement('div');
        const path = document.createElement('span');
        const size = document.createElement('span');
        const state = document.createElement('span');
        row.className = 'model-knowledge-item';
        row.dataset.state = item.state;
        path.className = 'model-knowledge-item__path';
        path.textContent = item.path;
        path.title = item.path;
        size.className = 'model-knowledge-item__size';
        size.textContent = item.message || formatBytes(item.file.size);
        state.className = 'model-knowledge-item__state';
        state.textContent = modelKnowledgeStateLabel(item);
        row.append(path, size, state);
        modelKnowledgeList.appendChild(row);
      });
    }

    modelKnowledgeFilesChoose.disabled = modelKnowledgePublishing;
    modelKnowledgeFolderChoose.disabled = modelKnowledgePublishing;
    modelKnowledgeClear.disabled = modelKnowledgePublishing || modelKnowledgeQueue.length === 0;
    modelKnowledgePublish.disabled = modelKnowledgePublishing || publishable === 0;
  }

  function stageModelKnowledgeFiles(fileList) {
    const incoming = [...(fileList || [])];
    let unsupported = 0;
    let oversized = 0;
    let empty = 0;
    let duplicates = 0;
    let added = 0;
    const known = new Set(modelKnowledgeQueue.map((item) => item.key));

    incoming.forEach((file) => {
      const path = modelKnowledgePath(file);
      const key = `${path.toLowerCase()}::${file.size}::${file.lastModified || 0}`;
      if (!MODEL_KNOWLEDGE_EXTENSIONS.has(modelKnowledgeExtension(file))) {
        unsupported += 1;
      } else if (file.size === 0) {
        empty += 1;
      } else if (file.size > MODEL_KNOWLEDGE_MAX_BYTES) {
        oversized += 1;
      } else if (known.has(key)) {
        duplicates += 1;
      } else {
        known.add(key);
        modelKnowledgeQueue.push({ key, file, path, state: 'pending', message: '' });
        added += 1;
      }
    });

    const skipped = [];
    if (unsupported) skipped.push(`${unsupported} unsupported`);
    if (oversized) skipped.push(`${oversized} over 50 MiB`);
    if (empty) skipped.push(`${empty} empty`);
    if (duplicates) skipped.push(`${duplicates} duplicate`);
    modelKnowledgeStatus.textContent = added
      ? `${added} ${added === 1 ? 'file' : 'files'} staged${skipped.length ? `; skipped ${skipped.join(', ')}` : ''}. Review the queue, then publish.`
      : `No files added${skipped.length ? `; skipped ${skipped.join(', ')}` : ''}.`;
    modelKnowledgeBadge.dataset.state = modelKnowledgeQueue.length ? 'checking' : 'live';
    modelKnowledgeBadge.textContent = modelKnowledgeQueue.length ? 'Staged' : 'Ready';
    renderModelKnowledgeQueue();
  }

  async function publishModelKnowledge() {
    const publishable = modelKnowledgeQueue.filter((item) => item.state === 'pending' || item.state === 'error');
    if (publishable.length === 0 || modelKnowledgePublishing) return;

    modelKnowledgePublishing = true;
    modelKnowledgeBadge.dataset.state = 'checking';
    modelKnowledgeBadge.textContent = 'Publishing';
    renderModelKnowledgeQueue();
    let completed = 0;
    let failed = 0;

    for (const item of publishable) {
      item.state = 'uploading';
      item.message = formatBytes(item.file.size);
      modelKnowledgeStatus.textContent = `Publishing ${completed + failed + 1} of ${publishable.length}: ${item.path}`;
      renderModelKnowledgeQueue();
      try {
        const result = await withSession((session) => MXApplicationClient.content.upload(item.file, session));
        if (result.status !== 'available_in_model_context' || !(Number(result.indexed_chunks) > 0)) {
          throw new Error('The source was stored but the model-context index did not confirm it.');
        }
        item.state = 'ready';
        item.message = `${result.indexed_chunks} ${result.indexed_chunks === 1 ? 'chunk' : 'chunks'} · available to the model`;
        completed += 1;
      } catch (error) {
        item.state = 'error';
        item.message = error.message || 'Publication failed';
        failed += 1;
      }
    }

    modelKnowledgePublishing = false;
    modelKnowledgeBadge.dataset.state = failed ? 'degraded' : 'live';
    modelKnowledgeBadge.textContent = failed ? 'Needs attention' : 'Published';
    modelKnowledgeStatus.textContent = failed
      ? `${completed} published; ${failed} failed. Fix the failed items, then publish again to retry them.`
      : `${completed} ${completed === 1 ? 'source is' : 'sources are'} available in model context.`;
    renderModelKnowledgeQueue();
  }

  modelKnowledgeFilesChoose.addEventListener('click', () => modelKnowledgeFiles.click());
  modelKnowledgeFolderChoose.addEventListener('click', () => modelKnowledgeFolder.click());
  modelKnowledgeFiles.addEventListener('change', () => {
    stageModelKnowledgeFiles(modelKnowledgeFiles.files);
    modelKnowledgeFiles.value = '';
  });
  modelKnowledgeFolder.addEventListener('change', () => {
    stageModelKnowledgeFiles(modelKnowledgeFolder.files);
    modelKnowledgeFolder.value = '';
  });
  modelKnowledgeClear.addEventListener('click', () => {
    if (modelKnowledgePublishing) return;
    modelKnowledgeQueue = [];
    modelKnowledgeStatus.textContent = 'Queue cleared. Nothing has been uploaded.';
    modelKnowledgeBadge.dataset.state = 'live';
    modelKnowledgeBadge.textContent = 'Ready';
    renderModelKnowledgeQueue();
  });
  modelKnowledgePublish.addEventListener('click', () => void publishModelKnowledge());

  function renderJetNetConnection(payload, message = '') {
    const configured = payload?.configured === true;
    const connection = payload?.connection || {};
    jetNetBadge.dataset.state = configured ? 'live' : 'unavailable';
    jetNetBadge.textContent = configured ? 'Connected' : 'Not connected';
    jetNetStatus.textContent = message || (configured
      ? `${connection.identityHint || 'Organization account'} verified with JetNet`
      : 'Add your organization’s JetNet account to use its licensed fleet data.');
    jetNetIdentity.value = '';
    jetNetIdentity.placeholder = configured
      ? connection.identityHint || 'Enter the account email to replace'
      : 'account@company.com';
    jetNetCredential.value = '';
    jetNetConnect.textContent = configured ? 'Replace connection' : 'Connect JetNet';
    jetNetDisconnect.hidden = !configured;
  }

  async function refreshJetNetConnection() {
    jetNetBadge.dataset.state = 'checking';
    jetNetBadge.textContent = 'Checking';
    jetNetStatus.textContent = 'Checking organization connection…';
    try {
      const payload = await withSession((session) => MXApplicationClient.jetnetConnection.get(session));
      settingsLoaded = true;
      renderJetNetConnection(payload);
    } catch (error) {
      jetNetBadge.dataset.state = 'degraded';
      jetNetBadge.textContent = 'Unavailable';
      jetNetStatus.textContent = error.message;
    }
  }

  jetNetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const identity = jetNetIdentity.value.trim();
    const credential = jetNetCredential.value;
    if (!identity || credential.length < 8) {
      jetNetStatus.textContent = 'Enter the JetNet account email and API credential.';
      return;
    }
    jetNetConnect.disabled = true;
    jetNetStatus.textContent = 'Verifying with JetNet…';
    jetNetBadge.dataset.state = 'checking';
    jetNetBadge.textContent = 'Checking';
    try {
      const payload = await withSession((session) => (
        MXApplicationClient.jetnetConnection.put({ identity, credential, session })
      ));
      settingsLoaded = true;
      renderJetNetConnection(payload, 'Connection verified. Fleet requests now use this organization’s JetNet access.');
    } catch (error) {
      jetNetCredential.value = '';
      jetNetBadge.dataset.state = 'degraded';
      jetNetBadge.textContent = 'Not connected';
      jetNetStatus.textContent = error.message;
    } finally {
      jetNetConnect.disabled = false;
    }
  });

  jetNetDisconnect.addEventListener('click', async () => {
    if (!globalThis.confirm('Disconnect this organization’s JetNet account? Fleet requests will return to the MXGenius service connection.')) return;
    jetNetDisconnect.disabled = true;
    jetNetStatus.textContent = 'Disconnecting…';
    try {
      await withSession((session) => MXApplicationClient.jetnetConnection.delete(session));
      renderJetNetConnection({ configured: false });
    } catch (error) {
      jetNetStatus.textContent = error.message;
    } finally {
      jetNetDisconnect.disabled = false;
    }
  });

  function renderAccess() {
    accessRows.replaceChildren();
    const emailCount = accessRules.filter((rule) => rule.rule_type !== 'domain').length;
    const domainCount = accessRules.filter((rule) => rule.rule_type === 'domain').length;
    accessRuleTotal.textContent = String(accessRules.length);
    accessEmailTotal.textContent = String(emailCount);
    accessDomainTotal.textContent = String(domainCount);
    accessEmpty.hidden = accessRules.length !== 0;

    accessRules.forEach((rule) => {
      const row = document.createElement('tr');
      const ruleCell = document.createElement('td');
      const typeCell = document.createElement('td');
      const controlCell = document.createElement('td');
      const type = document.createElement('span');
      type.className = 'rule-type';
      type.textContent = rule.rule_type || 'email';
      ruleCell.textContent = rule.rule;
      typeCell.appendChild(type);
      if (rule.locked) {
        const locked = document.createElement('span');
        locked.className = 'locked-rule';
        locked.textContent = 'Baseline rule';
        controlCell.appendChild(locked);
      } else {
        const remove = document.createElement('button');
        remove.className = 'button remove-rule';
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          setAccessStatus(`Removing ${rule.rule}…`);
          try {
            await withSession((session) => MXApplicationClient.betaAccess.delete(rule.id, session));
            accessRules = accessRules.filter((entry) => entry.id !== rule.id);
            renderAccess();
            setAccessStatus(`${rule.rule} removed`, 'success');
          } catch (error) {
            remove.disabled = false;
            setAccessStatus(error.message, 'error');
          }
        });
        controlCell.appendChild(remove);
      }
      row.append(ruleCell, typeCell, controlCell);
      accessRows.appendChild(row);
    });
  }

  async function refreshAccess() {
    accessRefresh.disabled = true;
    setAccessStatus('Loading server-managed access rules…');
    try {
      const result = await withSession((session) => MXApplicationClient.betaAccess.list(session));
      accessRules = [...(result.rules || [])].sort((left, right) => left.rule.localeCompare(right.rule));
      accessLoaded = true;
      renderAccess();
      setAccessStatus(`${accessRules.length} active access ${accessRules.length === 1 ? 'rule' : 'rules'}`, 'success');
    } catch (error) {
      setAccessStatus(error.message, 'error');
    } finally {
      accessRefresh.disabled = false;
    }
  }

  accessForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = accessInput.value.trim().toLowerCase();
    if (!value) return;
    accessAdd.disabled = true;
    setAccessStatus(value.startsWith('@') ? 'Adding domain rule…' : 'Creating Entra guest invitation…');
    try {
      const result = await withSession((session) => MXApplicationClient.betaAccess.add(value, session));
      if (!accessRules.some((rule) => rule.id === result.rule.id)) accessRules.push(result.rule);
      accessRules.sort((left, right) => left.rule.localeCompare(right.rule));
      renderAccess();
      accessInput.value = '';
      setAccessStatus(result.invited ? `Invitation sent to ${result.rule.rule}` : `${result.rule.rule} is allowed`, 'success');
    } catch (error) {
      setAccessStatus(error.message, 'error');
    } finally {
      accessAdd.disabled = false;
    }
  });

  accessRefresh.addEventListener('click', () => void refreshAccess());
  const requestedTab = location.hash.slice(1);
  activate(requestedTab || 'highlights', { updateHash: false });
})();
