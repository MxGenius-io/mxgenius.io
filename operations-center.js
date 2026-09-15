(() => {
  const tabs = [...document.querySelectorAll('[role="tab"][data-tab]')];
  const panels = [...document.querySelectorAll('[role="tabpanel"][data-panel]')];
  const stateLabel = document.getElementById('operationsState');
  const validTabs = new Set(tabs.map((tab) => tab.dataset.tab));
  const labels = {
    reports: 'Reports centered',
    build: 'Build board active',
    readiness: 'Readiness record active',
    features: 'Feature inventory active',
    feedback: 'Feedback queue active',
    access: 'Access registry active'
  };
  let accessLoaded = false;

  function embeddedStyle() {
    return `
      body > header,
      body > .container > header,
      .board-header,
      .workspace-header,
      .catalog-header,
      .feedback-page__header { display: none !important; }
      html, body { min-height: auto !important; background: transparent !important; }
      body > .container,
      .board-shell,
      .workspace-shell,
      .catalog-shell,
      .feedback-page__shell { width: 100% !important; max-width: none !important; margin: 0 !important; padding: 20px !important; }
    `;
  }

  function prepareFrame(frame) {
    try {
      const documentRef = frame.contentDocument;
      if (!documentRef?.head) return;
      if (!documentRef.getElementById('operations-center-embed-style')) {
        const style = documentRef.createElement('style');
        style.id = 'operations-center-embed-style';
        style.textContent = embeddedStyle();
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
    const next = validTabs.has(name) ? name : 'reports';
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
    if (stateLabel) stateLabel.textContent = labels[next];
    if (next === 'access' && !accessLoaded) void refreshAccess();
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
  let accessRules = [];

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
      const error = new Error('Sign in is required to manage access.');
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
  activate(requestedTab || 'reports', { updateHash: false });
})();
