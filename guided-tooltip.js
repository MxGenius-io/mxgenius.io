/** Reusable video + voiceover guidance for onboarding and contextual help. */
const MXGuidedTooltip = (() => {
  const scriptBase = document.currentScript?.src
    ? new URL('.', document.currentScript.src)
    : new URL('.', document.baseURI);
  const DEFAULT_MANIFEST = new URL('assets/xr-ui-fx/audio/tooltips/scripts/manifest.json?v=4', scriptBase).href;
  let manifestUrl = DEFAULT_MANIFEST;
  let manifestPromise = null;
  let activeMedia = [];
  let activeToken = 0;
  let activeAnchor = null;
  let activePopover = null;
  const boundRoots = new WeakSet();

  function configure(options = {}) {
    if (options.manifestUrl && options.manifestUrl !== manifestUrl) {
      manifestUrl = String(options.manifestUrl);
      manifestPromise = null;
    }
  }

  async function loadManifest() {
    if (!manifestPromise) {
      manifestPromise = fetch(manifestUrl, { credentials: 'same-origin' })
        .then((response) => {
          if (!response.ok) throw new Error(`Guided tooltip manifest returned ${response.status}`);
          return response.json();
        })
        .then((payload) => Array.isArray(payload?.tooltips) ? payload.tooltips : [])
        .catch((error) => {
          console.warn('Guided tooltip manifest unavailable:', error);
          return [];
        });
    }
    return manifestPromise;
  }

  function safeAssetUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(String(value), new URL(manifestUrl, document.baseURI));
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
    if (event.key === 'Escape' && activePopover) close({ restoreFocus: true });
  });
  window.addEventListener('resize', positionPopover);
  window.addEventListener('scroll', positionPopover, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => bind(), { once: true });
  else bind();

  return Object.freeze({ configure, loadManifest, mount, open, close, bind, stop });
})();

window.MXGuidedTooltip = MXGuidedTooltip;
