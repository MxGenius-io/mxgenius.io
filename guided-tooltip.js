/** Reusable video + voiceover guidance for onboarding and contextual help. */
const MXGuidedTooltip = (() => {
  const scriptBase = document.currentScript?.src
    ? new URL('.', document.currentScript.src)
    : new URL('.', document.baseURI);
  const DEFAULT_MANIFEST = new URL('services/mcp/config/environment-manifest.json?v=7', scriptBase).href;
  const TOOLTIP_ASSET_BASE = new URL('assets/xr-ui-fx/audio/tooltips/scripts/', scriptBase).href;
  let manifestUrl = DEFAULT_MANIFEST;
  let environmentManifestPromise = null;
  let activeMedia = [];
  let activeToken = 0;
  let activeAnchor = null;
  let activePopover = null;
  let activeGuide = null;
  const boundRoots = new WeakSet();

  function configure(options = {}) {
    if (options.manifestUrl && options.manifestUrl !== manifestUrl) {
      manifestUrl = String(options.manifestUrl);
      environmentManifestPromise = null;
    }
  }

  async function loadEnvironmentManifest() {
    if (!environmentManifestPromise) {
      environmentManifestPromise = fetch(manifestUrl, { credentials: 'same-origin' })
        .then((response) => {
          if (!response.ok) throw new Error(`Guided tooltip manifest returned ${response.status}`);
          return response.json();
        })
        .catch((error) => {
          console.warn('Guided tooltip manifest unavailable:', error);
          return Object.freeze({ surfaces: [], terminology: [], tooltips: [] });
        });
    }
    return environmentManifestPromise;
  }

  async function loadManifest() {
    const payload = await loadEnvironmentManifest();
    return Array.isArray(payload?.tooltips) ? payload.tooltips : [];
  }

  function guideTargetIn(root, item) {
    if (!root?.querySelector) return null;
    const direct = root.querySelector(`[data-guide-id="${CSS.escape(item.id)}"]`);
    if (direct) return direct;
    for (const touchpoint of item.touchpoints || []) {
      const selector = String(touchpoint || '').trim();
      if (!selector || !['#', '.', '['].includes(selector[0])) continue;
      try {
        const target = root.querySelector(selector);
        if (target) return target;
      } catch {
        // Human-readable touchpoints are not treated as selectors.
      }
    }
    return null;
  }

  function currentGuideTarget(item, surface) {
    const local = guideTargetIn(document, item);
    if (local) return local;
    const frame = document.getElementById('viewer-iframe');
    try {
      const embedded = guideTargetIn(frame?.contentDocument, item);
      if (embedded) return embedded;
    } catch {
      // Cross-origin frames are never traversed.
    }
    const route = String(surface?.route || '');
    if (route.startsWith('#')) return document.getElementById(`tab-${route.slice(1)}`);
    return null;
  }

  function navigateToSurface(surface, payload) {
    const route = String(surface?.route || '');
    if (route.startsWith('#')) {
      const tabId = route.slice(1);
      const tab = document.querySelector(`.nav-tab[data-tab="${CSS.escape(tabId)}"]`);
      if (tab && !tab.classList.contains('active')) tab.click();
      return true;
    }
    if (surface?.id === 'copilot') {
      const toggle = document.getElementById('chatToggleNav');
      if (toggle && !document.getElementById('ai-chat-panel')?.classList.contains('open')) toggle.click();
      return true;
    }
    if (!route || !/^[a-z0-9./_-]+\.html(?:[#?].*)?$/i.test(route)) return true;
    const destination = new URL(route, document.baseURI);
    if (destination.pathname === location.pathname) return true;
    try {
      sessionStorage.setItem('mxg_pending_ui_guide', JSON.stringify(payload));
    } catch {
      // Navigation still works when storage is unavailable.
    }
    location.assign(destination.href);
    return false;
  }

  function revealTarget(target) {
    let node = target;
    while (node) {
      if (node.tagName === 'DETAILS') node.open = true;
      node = node.parentElement;
    }
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
    return Boolean(reducedMotion);
  }

  function clearGuide() {
    if (!activeGuide) return;
    clearTimeout(activeGuide.fadeTimer);
    clearTimeout(activeGuide.removeTimer);
    clearTimeout(activeGuide.noteTimer);
    activeGuide.target?.classList?.remove('mx-ui-guide-spotlight', 'is-fading', 'is-reduced-motion');
    activeGuide.note?.remove();
    activeGuide = null;
  }

  function presentGuide(target, payload) {
    clearGuide();
    const reducedMotion = revealTarget(target);
    target.classList.add('mx-ui-guide-spotlight');
    if (reducedMotion) target.classList.add('is-reduced-motion');

    const ownerDocument = target.ownerDocument || document;
    const note = ownerDocument.createElement('aside');
    note.className = 'mx-ui-guide-note';
    note.setAttribute('role', 'status');
    const text = ownerDocument.createElement('span');
    text.textContent = String(payload.guidance || '').slice(0, 400);
    const dismiss = ownerDocument.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', clearGuide);
    note.append(text, dismiss);
    ownerDocument.body.appendChild(note);

    activeGuide = { target, note, fadeTimer: 0, removeTimer: 0, noteTimer: 0 };
    activeGuide.fadeTimer = setTimeout(() => {
      if (activeGuide?.target === target) target.classList.add('is-fading');
    }, 3000);
    activeGuide.removeTimer = setTimeout(() => {
      target.classList.remove('mx-ui-guide-spotlight', 'is-fading', 'is-reduced-motion');
    }, reducedMotion ? 3000 : 3600);
    activeGuide.noteTimer = setTimeout(clearGuide, 9000);
    return true;
  }

  async function waitForGuideTarget(item, surface) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const target = currentGuideTarget(item, surface);
      if (target) return target;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  }

  async function guide(payload = {}) {
    const documentManifest = await loadEnvironmentManifest();
    const surface = (documentManifest.surfaces || []).find((entry) => entry.id === payload.surface_id);
    const item = (documentManifest.tooltips || []).find((entry) => entry.id === payload.target_id);
    if (!surface || !item || item.surface !== surface.id || item.status === 'retired') return false;
    if (!navigateToSurface(surface, payload)) return true;
    const target = await waitForGuideTarget(item, surface);
    return target ? presentGuide(target, payload) : false;
  }

  function consumePendingGuide() {
    let pending = null;
    try {
      pending = JSON.parse(sessionStorage.getItem('mxg_pending_ui_guide') || 'null');
      sessionStorage.removeItem('mxg_pending_ui_guide');
    } catch {
      return;
    }
    if (pending) void guide(pending);
  }

  function safeAssetUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(String(value), TOOLTIP_ASSET_BASE);
      if (url.origin !== location.origin || !url.pathname.includes('/assets/xr-ui-fx/')) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function stop() {
    activeToken += 1;
    activeMedia.forEach((media) => {
      try {
        media.pause();
        media.currentTime = 0;
      } catch {
        // A media element can disappear while its source is still settling.
      }
    });
    activeMedia = [];
  }

  function addScriptedState(host, item) {
    const shell = document.createElement('details');
    shell.className = 'guided-tooltip-guide guided-tooltip-guide--scripted';
    shell.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'Video + voiceover script ready';
    const transcript = document.createElement('p');
    transcript.textContent = item.script || 'Guidance media is being prepared.';
    shell.append(summary, transcript);
    host.appendChild(shell);
  }

  function addPlaybackFallback(shell, play) {
    const button = document.createElement('button');
    button.className = 'guided-tooltip-guide__play';
    button.type = 'button';
    button.textContent = 'Play';
    button.addEventListener('click', async () => {
      if (await play()) button.remove();
    });
    shell.appendChild(button);
  }

  async function mount(host, id, options = {}) {
    if (!host || !id) return false;
    const token = ++activeToken;
    activeMedia.forEach((media) => media.pause());
    activeMedia = [];
    const items = await loadManifest();
    if (token !== activeToken || !host.isConnected) return false;
    const item = items.find((entry) => entry.id === id);
    if (!item || item.status === 'retired') return false;

    host.replaceChildren();
    const videoUrl = item.status === 'ready' ? safeAssetUrl(item.video) : null;
    const voiceoverUrl = ['recording', 'ready'].includes(item.status) ? safeAssetUrl(item.voiceover) : null;
    const captionsUrl = item.status === 'ready' ? safeAssetUrl(item.captions) : null;
    if (!videoUrl && !voiceoverUrl) {
      addScriptedState(host, item);
      options.onReady?.();
      return true;
    }

    const shell = document.createElement('section');
    shell.className = 'guided-tooltip-guide';
    shell.setAttribute('aria-label', `${item.title || 'Section'} guide`);
    const eyebrow = document.createElement('span');
    eyebrow.className = 'guided-tooltip-guide__eyebrow';
    eyebrow.textContent = 'OVERVIEW';
    shell.appendChild(eyebrow);

    let video = null;
    let voiceover = null;
    let coordinatedPlay = false;
    if (videoUrl) {
      video = document.createElement('video');
      video.className = 'guided-tooltip-guide__video';
      video.src = videoUrl;
      video.preload = 'metadata';
      video.playsInline = true;
      video.controls = true;
      video.muted = Boolean(voiceoverUrl);
      if (captionsUrl) {
        const track = document.createElement('track');
        track.kind = 'captions';
        track.label = 'English';
        track.srclang = 'en';
        track.src = captionsUrl;
        track.default = false;
        video.appendChild(track);
      }
      shell.appendChild(video);
      activeMedia.push(video);
    }
    if (voiceoverUrl) {
      voiceover = document.createElement('audio');
      voiceover.src = voiceoverUrl;
      voiceover.preload = 'auto';
      // Playback is initiated explicitly below after the user opens the tip.
      // Avoid an autoplay attribute that mobile browsers can interpret as an
      // unsolicited media capability request.
      voiceover.autoplay = false;
      voiceover.controls = !video;
      voiceover.className = 'guided-tooltip-guide__voiceover';
      shell.appendChild(voiceover);
      activeMedia.push(voiceover);
    }
    if (item.script) {
      const transcript = document.createElement('p');
      transcript.className = 'guided-tooltip-guide__transcript';
      transcript.textContent = item.script;
      shell.appendChild(transcript);
    }

    const play = async ({ audioOnly = false } = {}) => {
      try {
        if (audioOnly && voiceover) {
          await voiceover.play();
        } else if (video && voiceover) {
          voiceover.currentTime = video.currentTime;
          coordinatedPlay = true;
          await Promise.all([video.play(), voiceover.play()]);
        } else if (video) {
          await video.play();
        } else if (voiceover) {
          await voiceover.play();
        }
        return true;
      } catch {
        return false;
      } finally {
        coordinatedPlay = false;
      }
    };

    if (video && voiceover) {
      video.addEventListener('play', () => {
        if (coordinatedPlay || !voiceover.paused) return;
        voiceover.currentTime = video.currentTime;
        void voiceover.play().catch(() => {});
      });
      video.addEventListener('pause', () => {
        // A shorter video should hold its final frame while narration finishes.
        if (!video.ended) voiceover.pause();
      });
      video.addEventListener('seeking', () => { voiceover.currentTime = video.currentTime; });
    }
    host.appendChild(shell);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (options.autoplay !== false && (!reducedMotion || voiceover)) {
      if (!(await play({ audioOnly: Boolean(reducedMotion && video && voiceover) }))) addPlaybackFallback(shell, play);
    } else {
      addPlaybackFallback(shell, play);
    }
    options.onReady?.();
    return true;
  }

  function positionPopover() {
    if (!activeAnchor?.isConnected || !activePopover?.isConnected) return;
    if (window.matchMedia?.('(max-width: 640px)').matches) {
      activePopover.style.removeProperty('top');
      activePopover.style.removeProperty('left');
      return;
    }
    const gap = 10;
    const margin = 12;
    const anchorRect = activeAnchor.getBoundingClientRect();
    const popoverRect = activePopover.getBoundingClientRect();
    const fitsBelow = anchorRect.bottom + gap + popoverRect.height <= window.innerHeight - margin;
    const top = fitsBelow
      ? anchorRect.bottom + gap
      : Math.max(margin, anchorRect.top - popoverRect.height - gap);
    const left = Math.min(
      window.innerWidth - popoverRect.width - margin,
      Math.max(margin, anchorRect.left + (anchorRect.width - popoverRect.width) / 2)
    );
    activePopover.style.top = `${Math.round(top)}px`;
    activePopover.style.left = `${Math.round(left)}px`;
    activePopover.dataset.placement = fitsBelow ? 'bottom' : 'top';
  }

  function close(options = {}) {
    const anchor = activeAnchor;
    stop();
    activePopover?.remove();
    activePopover = null;
    activeAnchor = null;
    anchor?.setAttribute('aria-expanded', 'false');
    if (options.restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
  }

  async function open(anchor, id, options = {}) {
    if (!anchor || !id) return false;
    const items = await loadManifest();
    const item = items.find((entry) => entry.id === id && entry.status !== 'retired');
    if (!item || !anchor.isConnected) return false;
    close();
    activeAnchor = anchor;
    const popover = document.createElement('section');
    popover.className = 'guided-tooltip-popover';
    popover.id = 'guidedTooltipPopover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'false');
    popover.setAttribute('aria-labelledby', 'guidedTooltipTitle');
    popover.innerHTML = `
      <header class="guided-tooltip-popover__header">
        <div>
          <span>SECTION HELP</span>
          <h2 id="guidedTooltipTitle"></h2>
        </div>
        <button type="button" class="guided-tooltip-popover__close" aria-label="Close guide">&times;</button>
      </header>
      <div class="guided-tooltip-host"></div>
    `;
    popover.querySelector('h2').textContent = item.title || 'Quick help';
    popover.querySelector('.guided-tooltip-popover__close').addEventListener('click', () => close({ restoreFocus: true }));
    document.body.appendChild(popover);
    activePopover = popover;
    anchor.setAttribute('aria-expanded', 'true');
    anchor.setAttribute('aria-controls', popover.id);
    positionPopover();
    const mounted = await mount(popover.querySelector('.guided-tooltip-host'), id, {
      autoplay: options.autoplay ?? true,
      onReady: positionPopover
    });
    if (!mounted && activePopover === popover) close();
    return mounted;
  }

  function bind(root = document) {
    if (!root?.addEventListener || boundRoots.has(root)) return;
    boundRoots.add(root);
    root.addEventListener('click', (event) => {
      const trigger = event.target.closest?.('[data-guide-id]');
      if (!trigger || !root.contains(trigger)) return;
      event.preventDefault();
      event.stopPropagation();
      const id = trigger.dataset.guideId;
      if (activeAnchor === trigger && activePopover) close({ restoreFocus: true });
      else void open(trigger, id, { autoplay: trigger.dataset.guideAutoplay !== 'false' });
    });
  }

  document.addEventListener('pointerdown', (event) => {
    if (!activePopover || activePopover.contains(event.target) || activeAnchor?.contains(event.target)) return;
    close();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (activePopover) close({ restoreFocus: true });
    clearGuide();
  });
  window.addEventListener('resize', positionPopover);
  window.addEventListener('scroll', positionPopover, true);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bind();
      consumePendingGuide();
    }, { once: true });
  } else {
    bind();
    consumePendingGuide();
  }

  return Object.freeze({ configure, loadEnvironmentManifest, loadManifest, mount, open, close, bind, stop, guide, clearGuide });
})();

window.MXGuidedTooltip = MXGuidedTooltip;
