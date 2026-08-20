(() => {
  'use strict';

  const TYPE_LABELS = { bug: 'Bug', feature: 'Feature request' };
  const STATUS_LABELS = { new: 'New', in_progress: 'In progress', needs_info: 'Needs info', resolved: 'Resolved', declined: 'Declined' };

  const state = { reports: [] };
  const elements = {};
  const objectUrls = [];

  function session() {
    const current = globalThis.MXGENIUS_CONFIG?.getSession?.() || {};
    return {
      accessToken: current.accessToken,
      organizationId: current.organizationId,
      correlationId: globalThis.crypto?.randomUUID?.()
    };
  }

  async function authenticatedSession() {
    await globalThis.MXGENIUS_CONFIG?.ready;
    let current = session();
    if (!current.accessToken && globalThis.MXGENIUS_AUTH?.getToken) {
      await globalThis.MXGENIUS_AUTH.getToken();
      current = session();
    }
    if (!current.accessToken) throw new Error('Sign in is required to view your feedback.');
    return current;
  }

  function formatDate(value) {
    if (!value) return 'Unknown time';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString();
  }

  function showError(error) {
    elements.errorText.textContent = error?.message || String(error);
    elements.error.hidden = false;
  }

  function renderCard(report) {
    const card = document.createElement('article');
    card.className = 'feedback-card';
    card.dataset.status = report.status;

    const top = document.createElement('div');
    top.className = 'feedback-card__top';
    const title = document.createElement('h3');
    title.textContent = report.report_number ? `FB-${report.report_number} · ${report.title}` : report.title;
    const status = document.createElement('span');
    status.className = 'feedback-badge feedback-badge--status';
    status.textContent = STATUS_LABELS[report.status] || report.status;
    top.append(title, status);

    const meta = document.createElement('div');
    meta.className = 'feedback-card__meta';
    const type = document.createElement('span');
    type.className = 'feedback-badge';
    type.textContent = TYPE_LABELS[report.report_type] || report.report_type;
    const created = document.createElement('span');
    created.className = 'feedback-card__date';
    created.textContent = formatDate(report.created_at);
    meta.append(type);
    if (report.severity) {
      const severity = document.createElement('span');
      severity.className = 'feedback-badge';
      severity.dataset.severity = report.severity;
      severity.textContent = report.severity;
      meta.append(severity);
    }
    meta.append(created);

    card.append(top, meta);

    if (report.has_screenshot) {
      const thumb = document.createElement('img');
      thumb.className = 'feedback-card__thumb';
      thumb.alt = '';
      card.append(thumb);
      globalThis.MXApplicationClient.feedback.getScreenshot(report.id, session())
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          objectUrls.push(url);
          thumb.src = url;
        })
        .catch(() => { thumb.remove(); });
    }

    card.addEventListener('click', () => openDetail(report));
    return card;
  }

  function renderList() {
    elements.list.replaceChildren();
    elements.empty.hidden = state.reports.length > 0;
    for (const report of state.reports) elements.list.append(renderCard(report));
  }

  async function openDetail(report) {
    const typeLabel = TYPE_LABELS[report.report_type] || report.report_type;
    elements.detailKicker.textContent = report.severity ? `${typeLabel} · ${report.severity}` : typeLabel;
    elements.detailTitle.textContent = report.report_number ? `FB-${report.report_number} · ${report.title}` : report.title;
    elements.detailMeta.textContent = `${STATUS_LABELS[report.status] || report.status} · Submitted ${formatDate(report.created_at)}${report.page_url ? ` · ${report.page_url}` : ''}`;
    elements.detailDescription.textContent = report.description || 'No description provided.';
    elements.detailScreenshot.hidden = true;
    elements.detailScreenshot.removeAttribute('src');
    elements.detailScreenshotState.hidden = true;
    elements.detailModal.classList.remove('hidden');

    if (report.has_screenshot) {
      elements.detailScreenshotState.hidden = false;
      elements.detailScreenshotState.textContent = 'Loading screenshot…';
      try {
        const blob = await globalThis.MXApplicationClient.feedback.getScreenshot(report.id, await authenticatedSession());
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        elements.detailScreenshot.src = url;
        elements.detailScreenshot.hidden = false;
        elements.detailScreenshotState.hidden = true;
      } catch (error) {
        elements.detailScreenshotState.textContent = 'Screenshot could not be loaded.';
      }
    }
  }

  function closeDetail() {
    elements.detailModal.classList.add('hidden');
  }

  async function loadReports() {
    elements.error.hidden = true;
    elements.state.textContent = 'Loading…';
    try {
      const payload = await globalThis.MXApplicationClient.feedback.list(await authenticatedSession());
      state.reports = Array.isArray(payload?.reports) ? payload.reports : [];
      elements.state.textContent = state.reports.length
        ? `${state.reports.length} report${state.reports.length === 1 ? '' : 's'}`
        : 'No reports yet';
      renderList();
    } catch (error) {
      showError(error);
      elements.state.textContent = 'Could not load';
    }
  }

  function captureElements() {
    elements.state = document.getElementById('feedbackListState');
    elements.error = document.getElementById('feedbackListError');
    elements.errorText = document.getElementById('feedbackListErrorText');
    elements.reload = document.getElementById('feedbackListReload');
    elements.empty = document.getElementById('feedbackListEmpty');
    elements.list = document.getElementById('feedbackList');
    elements.detailModal = document.getElementById('feedbackDetailModal');
    elements.detailBackdrop = document.getElementById('feedbackDetailBackdrop');
    elements.detailClose = document.getElementById('feedbackDetailClose');
    elements.detailKicker = document.getElementById('feedbackDetailKicker');
    elements.detailTitle = document.getElementById('feedbackDetailTitle');
    elements.detailMeta = document.getElementById('feedbackDetailMeta');
    elements.detailScreenshot = document.getElementById('feedbackDetailScreenshot');
    elements.detailScreenshotState = document.getElementById('feedbackDetailScreenshotState');
    elements.detailDescription = document.getElementById('feedbackDetailDescription');
  }

  function bindEvents() {
    elements.reload.addEventListener('click', loadReports);
    elements.detailClose.addEventListener('click', closeDetail);
    elements.detailBackdrop.addEventListener('click', closeDetail);
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDetail();
    });
    window.addEventListener('beforeunload', () => {
      for (const url of objectUrls) URL.revokeObjectURL(url);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    captureElements();
    bindEvents();
    loadReports();
  });
})();
