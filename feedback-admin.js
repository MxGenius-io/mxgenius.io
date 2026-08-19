(() => {
  'use strict';

  const TYPE_LABELS = { bug: 'Bug', feature: 'Feature request' };
  const STATUS_LABELS = {
    new: 'New',
    in_progress: 'In progress',
    needs_info: 'Needs info',
    resolved: 'Resolved',
    declined: 'Declined'
  };
  const CLOSED_STATUSES = new Set(['resolved', 'declined']);

  const state = { reports: [], filterType: '', filterStatus: '', openOnly: true, openReportId: null };
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
    if (!current.accessToken) throw new Error('Sign in is required to view the feedback queue.');
    return current;
  }

  function formatDate(value) {
    if (!value) return 'Unknown time';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString();
  }

  function ticketLabel(report) {
    return report.report_number ? `FB-${report.report_number}` : '';
  }

  function showError(error) {
    const forbidden = error?.status === 403 || /forbidden|manager or administrator/i.test(error?.message || '');
    elements.errorText.textContent = forbidden
      ? 'This queue is limited to Manager and Administrator roles. Ask an administrator for access.'
      : (error?.message || String(error));
    elements.error.hidden = false;
  }

  function filteredReports() {
    return state.reports.filter((report) => {
      if (state.filterType && report.report_type !== state.filterType) return false;
      if (state.filterStatus && report.status !== state.filterStatus) return false;
      if (state.openOnly && !state.filterStatus && CLOSED_STATUSES.has(report.status)) return false;
      return true;
    });
  }

  function renderCard(report) {
    const card = document.createElement('article');
    card.className = 'feedback-card';
    card.dataset.status = report.status;

    const top = document.createElement('div');
    top.className = 'feedback-card__top';
    const title = document.createElement('h3');
    title.textContent = `${ticketLabel(report)} · ${report.title}`;
    const status = document.createElement('span');
    status.className = 'feedback-badge feedback-badge--status';
    status.textContent = STATUS_LABELS[report.status] || report.status;
    top.append(title, status);

    const meta = document.createElement('div');
    meta.className = 'feedback-card__meta';
    const type = document.createElement('span');
    type.className = 'feedback-badge';
    type.textContent = TYPE_LABELS[report.report_type] || report.report_type;
    const reporter = document.createElement('span');
    reporter.className = 'feedback-badge feedback-badge--reporter';
    reporter.textContent = report.reporter_name || 'Unknown reporter';
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
    meta.append(reporter, created);

    card.append(top, meta);

    if (report.has_screenshot) {
      const thumb = document.createElement('img');
      thumb.className = 'feedback-card__thumb';
      thumb.alt = '';
      card.append(thumb);
      authenticatedSession()
        .then((current) => globalThis.MXApplicationClient.feedback.getScreenshot(report.id, current))
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
    const visible = filteredReports();
    elements.list.replaceChildren();
    elements.empty.hidden = visible.length > 0;
    for (const report of visible) elements.list.append(renderCard(report));
    elements.state.textContent = state.reports.length
      ? `${visible.length} of ${state.reports.length} report${state.reports.length === 1 ? '' : 's'}`
      : 'No reports yet';
  }

  function currentReport() {
    return state.reports.find((report) => report.id === state.openReportId) || null;
  }

  async function openDetail(report) {
    state.openReportId = report.id;
    const typeLabel = TYPE_LABELS[report.report_type] || report.report_type;
    elements.detailKicker.textContent = report.severity ? `${typeLabel} · ${report.severity}` : typeLabel;
    elements.detailTitle.textContent = `${ticketLabel(report)} · ${report.title}`;
    elements.detailMeta.textContent = `${STATUS_LABELS[report.status] || report.status} · Reported by ${report.reporter_name || 'Unknown reporter'} · Submitted ${formatDate(report.created_at)}${report.page_url ? ` · ${report.page_url}` : ''}`;
    elements.detailDescription.textContent = report.description || 'No description provided.';
    elements.detailStatus.value = report.status;
    elements.detailNotes.value = report.admin_notes || '';
    elements.detailSaveStatus.textContent = '';

    if (report.reporter_email) {
      elements.detailContact.hidden = false;
      elements.detailContact.href = `mailto:${encodeURIComponent(report.reporter_email)}?subject=${encodeURIComponent(`Re: ${ticketLabel(report)} — ${report.title}`)}`;
    } else {
      elements.detailContact.hidden = true;
    }

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
    state.openReportId = null;
  }

  async function saveTriage() {
    const report = currentReport();
    if (!report) return;
    elements.detailSave.disabled = true;
    elements.detailSaveStatus.textContent = 'Saving…';
    try {
      const payload = await globalThis.MXApplicationClient.feedback.updateAdmin(
        report.id,
        { status: elements.detailStatus.value, adminNotes: elements.detailNotes.value },
        await authenticatedSession()
      );
      const updated = payload?.report;
      if (updated) {
        const index = state.reports.findIndex((candidate) => candidate.id === updated.id);
        if (index !== -1) state.reports[index] = updated;
        elements.detailMeta.textContent = `${STATUS_LABELS[updated.status] || updated.status} · Reported by ${updated.reporter_name || 'Unknown reporter'} · Submitted ${formatDate(updated.created_at)}${updated.page_url ? ` · ${updated.page_url}` : ''}`;
      }
      elements.detailSaveStatus.textContent = 'Saved';
      renderList();
    } catch (error) {
      elements.detailSaveStatus.textContent = error?.message || 'Could not save changes.';
    } finally {
      elements.detailSave.disabled = false;
    }
  }

  async function loadReports() {
    elements.error.hidden = true;
    elements.state.textContent = 'Loading…';
    try {
      const payload = await globalThis.MXApplicationClient.feedback.listAdmin(await authenticatedSession());
      state.reports = Array.isArray(payload?.reports) ? payload.reports : [];
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
    elements.filterType = document.getElementById('feedbackFilterType');
    elements.filterStatus = document.getElementById('feedbackFilterStatus');
    elements.filterOpenOnly = document.getElementById('feedbackFilterOpenOnly');
    elements.detailModal = document.getElementById('feedbackDetailModal');
    elements.detailBackdrop = document.getElementById('feedbackDetailBackdrop');
    elements.detailClose = document.getElementById('feedbackDetailClose');
    elements.detailKicker = document.getElementById('feedbackDetailKicker');
    elements.detailTitle = document.getElementById('feedbackDetailTitle');
    elements.detailMeta = document.getElementById('feedbackDetailMeta');
    elements.detailContact = document.getElementById('feedbackDetailContact');
    elements.detailScreenshot = document.getElementById('feedbackDetailScreenshot');
    elements.detailScreenshotState = document.getElementById('feedbackDetailScreenshotState');
    elements.detailDescription = document.getElementById('feedbackDetailDescription');
    elements.detailStatus = document.getElementById('feedbackDetailStatus');
    elements.detailNotes = document.getElementById('feedbackDetailNotes');
    elements.detailSave = document.getElementById('feedbackDetailSave');
    elements.detailSaveStatus = document.getElementById('feedbackDetailSaveStatus');
  }

  function bindEvents() {
    elements.reload.addEventListener('click', loadReports);
    elements.detailClose.addEventListener('click', closeDetail);
    elements.detailBackdrop.addEventListener('click', closeDetail);
    elements.detailSave.addEventListener('click', saveTriage);
    elements.filterType.addEventListener('change', () => {
      state.filterType = elements.filterType.value;
      renderList();
    });
    elements.filterStatus.addEventListener('change', () => {
      state.filterStatus = elements.filterStatus.value;
      renderList();
    });
    elements.filterOpenOnly.addEventListener('change', () => {
      state.openOnly = elements.filterOpenOnly.checked;
      renderList();
    });
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
