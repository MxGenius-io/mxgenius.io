(() => {
  'use strict';

  const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff'];
  const KEYBOARD_SHORTCUT = 'b';
  const MAX_CANVAS_WIDTH = 1600;
  const CONFIRMATION_DISMISS_MS = 10000;

  const MODES = {
    bug: {
      heading: 'Report a Bug',
      closeLabel: 'Close bug report',
      confirmationMessage: "Thank you — we've received your bug report. Our team will review it and follow up if we need more information."
    },
    feature: {
      heading: 'Request a Feature',
      closeLabel: 'Close feature request',
      confirmationMessage: "Thank you — we've received your feature request. Our team will review it and follow up if we have questions."
    }
  };

  const state = {
    open: false,
    mode: 'bug',
    tool: 'draw',
    color: COLORS[0],
    baseImage: null,
    ops: [],
    drawing: null,
    submitting: false
  };

  const elements = {};
  let confirmationTimer = null;

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
    if (!current.accessToken) throw new Error('Sign in is required to submit feedback.');
    return current;
  }

  function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function setStatus(message) {
    elements.status.textContent = message || '';
  }

  function showError(message) {
    elements.error.textContent = message || '';
    elements.error.hidden = !message;
  }

  function canvasContext() {
    return elements.canvas.getContext('2d');
  }

  function redraw() {
    if (!elements.canvas.width || !elements.canvas.height) return;
    const ctx = canvasContext();
    ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
    if (state.baseImage) {
      ctx.drawImage(state.baseImage, 0, 0, elements.canvas.width, elements.canvas.height);
    }
    for (const op of state.ops) renderOp(ctx, op);
  }

  function drawArrowHead(ctx, x1, y1, x2, y2) {
    const headLength = Math.max(10, elements.canvas.width / 90);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function renderOp(ctx, op) {
    ctx.save();
    ctx.strokeStyle = op.color;
    ctx.fillStyle = op.color;
    ctx.lineWidth = Math.max(2, elements.canvas.width / 480);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (op.type === 'draw') {
      ctx.beginPath();
      op.points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    } else if (op.type === 'rect') {
      ctx.globalAlpha = 0.22;
      ctx.fillRect(op.x, op.y, op.w, op.h);
      ctx.globalAlpha = 1;
      ctx.strokeRect(op.x, op.y, op.w, op.h);
    } else if (op.type === 'arrow') {
      drawArrowHead(ctx, op.x1, op.y1, op.x2, op.y2);
    } else if (op.type === 'text') {
      const fontSize = Math.max(16, elements.canvas.width / 60);
      ctx.font = `700 ${fontSize}px Inter, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(op.text, op.x, op.y);
    }
    ctx.restore();
  }

  function canvasPoint(event) {
    const rect = elements.canvas.getBoundingClientRect();
    const scaleX = elements.canvas.width / rect.width;
    const scaleY = elements.canvas.height / rect.height;
    return [(event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY];
  }

  function previewOp() {
    const drawing = state.drawing;
    if (drawing.type === 'rect') {
      const x2 = drawing.x2 ?? drawing.x1;
      const y2 = drawing.y2 ?? drawing.y1;
      return {
        type: 'rect',
        color: drawing.color,
        x: Math.min(drawing.x1, x2),
        y: Math.min(drawing.y1, y2),
        w: Math.abs(x2 - drawing.x1),
        h: Math.abs(y2 - drawing.y1)
      };
    }
    if (drawing.type === 'arrow') {
      return {
        type: 'arrow',
        color: drawing.color,
        x1: drawing.x1,
        y1: drawing.y1,
        x2: drawing.x2 ?? drawing.x1,
        y2: drawing.y2 ?? drawing.y1
      };
    }
    return { type: 'draw', color: drawing.color, points: drawing.points };
  }

  function onPointerDown(event) {
    if (!elements.canvas.width || !elements.canvas.height) return;
    event.preventDefault();
    const [x, y] = canvasPoint(event);
    if (state.tool === 'text') {
      const text = window.prompt('Annotation text');
      if (text && text.trim()) {
        state.ops.push({ type: 'text', color: state.color, text: text.trim(), x, y });
        redraw();
      }
      return;
    }
    state.drawing = { type: state.tool, color: state.color, points: [[x, y]], x1: x, y1: y };
    elements.canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!state.drawing) return;
    const [x, y] = canvasPoint(event);
    if (state.drawing.type === 'draw') state.drawing.points.push([x, y]);
    else {
      state.drawing.x2 = x;
      state.drawing.y2 = y;
    }
    redraw();
    renderOp(canvasContext(), previewOp());
  }

  function onPointerUp() {
    if (!state.drawing) return;
    const op = previewOp();
    state.drawing = null;
    const tooSmall =
      (op.type === 'draw' && op.points.length < 2) ||
      (op.type === 'rect' && (op.w < 2 || op.h < 2)) ||
      (op.type === 'arrow' && op.x1 === op.x2 && op.y1 === op.y2);
    if (tooSmall) {
      redraw();
      return;
    }
    state.ops.push(op);
    redraw();
  }

  function selectTool(tool) {
    state.tool = tool;
    for (const button of elements.toolButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
    }
  }

  function renderColorSwatches() {
    elements.colorSwatches.replaceChildren();
    for (const color of COLORS) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'feedback-color-swatch';
      swatch.style.background = color;
      swatch.setAttribute('aria-label', `Use ${color} for annotations`);
      swatch.setAttribute('aria-pressed', String(color === state.color));
      swatch.addEventListener('click', () => {
        state.color = color;
        for (const node of elements.colorSwatches.children) {
          node.setAttribute('aria-pressed', String(node === swatch));
        }
      });
      elements.colorSwatches.append(swatch);
    }
  }

  function undo() {
    state.ops.pop();
    redraw();
  }

  function clearAnnotations() {
    state.ops = [];
    redraw();
  }

  function setBaseImage(image) {
    state.baseImage = image;
    state.ops = [];
    const scale = image.width > MAX_CANVAS_WIDTH ? MAX_CANVAS_WIDTH / image.width : 1;
    elements.canvas.width = Math.round(image.width * scale);
    elements.canvas.height = Math.round(image.height * scale);
    redraw();
  }

  function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not read image'));
      image.src = dataUrl;
    });
  }

  async function captureScreenshot() {
    elements.captureStatus.hidden = false;
    elements.captureStatus.textContent = 'Capturing screenshot…';
    try {
      const target = document.getElementById('content');
      const captured = await globalThis.html2canvas(target, {
        backgroundColor: '#0a0e1a',
        useCORS: true,
        logging: false,
        ignoreElements: (element) => element.id === 'feedbackReporterModal'
      });
      const image = await loadImageFromDataUrl(captured.toDataURL('image/png'));
      setBaseImage(image);
      elements.captureStatus.hidden = true;
    } catch (error) {
      console.warn('Feedback screenshot capture failed', error);
      state.baseImage = null;
      elements.canvas.width = 0;
      elements.canvas.height = 0;
      elements.captureStatus.textContent = 'Screenshot unavailable — you can still submit, or attach one manually.';
    }
  }

  async function replaceFromFile(file) {
    if (!file) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const image = await loadImageFromDataUrl(dataUrl);
    setBaseImage(image);
    elements.captureStatus.hidden = true;
  }

  async function pasteFromClipboard() {
    if (!navigator.clipboard?.read) {
      showError('Clipboard paste is not supported in this browser — try Ctrl+V instead.');
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((candidate) => candidate.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type);
        await replaceFromFile(blob);
        showError('');
        return;
      }
      showError('No image was found on the clipboard.');
    } catch (error) {
      showError('Could not read the clipboard — copy an image, then try again.');
    }
  }

  function onPaste(event) {
    if (!state.open) return;
    const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (file) replaceFromFile(file).catch((error) => console.warn('Feedback paste failed', error));
  }

  function resetForm() {
    elements.form.reset();
    state.ops = [];
    state.baseImage = null;
    state.drawing = null;
    elements.canvas.width = 0;
    elements.canvas.height = 0;
    showError('');
    setStatus('');
  }

  function applyMode(mode) {
    const config = MODES[mode] || MODES.bug;
    state.mode = MODES[mode] ? mode : 'bug';
    if (elements.type) elements.type.value = state.mode;
    elements.heading.textContent = config.heading;
    elements.closeBtn.setAttribute('aria-label', config.closeLabel);
    elements.severityField.hidden = state.mode !== 'bug';
  }

  async function open(mode = 'bug') {
    if (state.open) return;
    state.open = true;
    resetForm();
    applyMode(mode);
    elements.modal.classList.remove('hidden');
    selectTool('draw');
    elements.title.focus();
    await captureScreenshot();
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    elements.modal.classList.add('hidden');
  }

  function closeConfirmation() {
    window.clearTimeout(confirmationTimer);
    confirmationTimer = null;
    elements.confirmationModal.classList.add('hidden');
  }

  function showConfirmation(mode, screenshotFailed, reportNumber) {
    const config = MODES[mode] || MODES.bug;
    const message = reportNumber ? `${config.confirmationMessage} Reference: FB-${reportNumber}.` : config.confirmationMessage;
    elements.confirmationMessage.textContent = screenshotFailed
      ? `${message} (Your screenshot couldn't be uploaded, but the rest of the report was saved.)`
      : message;
    elements.confirmationModal.classList.remove('hidden');
    window.clearTimeout(confirmationTimer);
    confirmationTimer = window.setTimeout(closeConfirmation, CONFIRMATION_DISMISS_MS);
  }

  async function submit(event) {
    event.preventDefault();
    if (state.submitting) return;
    const title = elements.title.value.trim();
    if (!title) {
      showError('Title is required.');
      return;
    }
    state.submitting = true;
    elements.submitBtn.disabled = true;
    showError('');
    setStatus('Submitting…');
    try {
      const authSession = await authenticatedSession();
      const screenshotDataUrl = state.baseImage ? elements.canvas.toDataURL('image/png') : null;
      const mode = state.mode;
      const payload = await globalThis.MXApplicationClient.feedback.submit(
        {
          title,
          reportType: mode,
          severity: mode === 'bug' ? elements.severity.value : undefined,
          description: elements.description.value.trim() || undefined,
          pageUrl: location.href,
          pageTitle: document.title,
          screenshotDataUrl
        },
        authSession
      );
      close();
      showConfirmation(
        mode,
        Boolean(screenshotDataUrl) && payload?.screenshot_uploaded === false,
        payload?.report?.report_number
      );
    } catch (error) {
      showError(error?.message || 'Could not submit the report.');
      setStatus('');
    } finally {
      state.submitting = false;
      elements.submitBtn.disabled = false;
    }
  }

  function captureElements() {
    elements.modal = document.getElementById('feedbackReporterModal');
    elements.heading = document.getElementById('feedbackReporterHeading');
    elements.canvas = document.getElementById('feedbackCanvas');
    elements.captureStatus = document.getElementById('feedbackCaptureStatus');
    elements.toolButtons = Array.from(document.querySelectorAll('.feedback-tool-btn[data-tool]'));
    elements.colorSwatches = document.getElementById('feedbackColorSwatches');
    elements.undoBtn = document.getElementById('feedbackUndoBtn');
    elements.clearBtn = document.getElementById('feedbackClearBtn');
    elements.pasteBtn = document.getElementById('feedbackPasteBtn');
    elements.form = document.getElementById('feedbackReporterForm');
    elements.type = document.getElementById('feedbackType');
    elements.title = document.getElementById('feedbackTitle');
    elements.severityField = document.getElementById('feedbackSeverityField');
    elements.severity = document.getElementById('feedbackSeverity');
    elements.description = document.getElementById('feedbackDescription');
    elements.error = document.getElementById('feedbackReporterError');
    elements.status = document.getElementById('feedbackReporterStatus');
    elements.submitBtn = document.getElementById('feedbackReporterSubmit');
    elements.cancelBtn = document.getElementById('feedbackReporterCancel');
    elements.closeBtn = document.getElementById('feedbackReporterClose');
    elements.openBtn = document.getElementById('feedbackReporterBtn');
    elements.confirmationModal = document.getElementById('feedbackConfirmationModal');
    elements.confirmationMessage = document.getElementById('feedbackConfirmationMessage');
    elements.confirmationClose = document.getElementById('feedbackConfirmationClose');
  }

  function bindEvents() {
    elements.openBtn?.addEventListener('click', () => {
      open('bug').catch((error) => console.warn('Feedback reporter failed to open', error));
    });
    elements.type?.addEventListener('change', () => applyMode(elements.type.value));
    elements.closeBtn?.addEventListener('click', close);
    elements.cancelBtn?.addEventListener('click', close);
    elements.form?.addEventListener('submit', submit);
    elements.undoBtn?.addEventListener('click', undo);
    elements.clearBtn?.addEventListener('click', clearAnnotations);
    elements.pasteBtn?.addEventListener('click', () => {
      pasteFromClipboard().catch((error) => console.warn('Feedback clipboard paste failed', error));
    });
    elements.confirmationClose?.addEventListener('click', closeConfirmation);
    for (const button of elements.toolButtons) {
      button.addEventListener('click', () => selectTool(button.dataset.tool));
    }
    elements.canvas.addEventListener('pointerdown', onPointerDown);
    elements.canvas.addEventListener('pointermove', onPointerMove);
    elements.canvas.addEventListener('pointerup', onPointerUp);
    elements.canvas.addEventListener('pointerleave', onPointerUp);
    document.addEventListener('paste', onPaste);
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.open) {
        close();
        return;
      }
      if (event.key === 'Escape' && !elements.confirmationModal.classList.contains('hidden')) {
        closeConfirmation();
        return;
      }
      if (state.open || event.repeat) return;
      if (event.key.toLowerCase() !== KEYBOARD_SHORTCUT || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(document.activeElement)) return;
      event.preventDefault();
      open().catch((error) => console.warn('Feedback reporter failed to open', error));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('feedbackReporterModal')) return;
    captureElements();
    renderColorSwatches();
    bindEvents();
  });
})();
