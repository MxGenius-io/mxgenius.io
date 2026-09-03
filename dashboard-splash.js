// Four-second dashboard arrival sequence, synchronized to the welcome sound.
globalThis.MXDashboardSplash = (() => {
  const TOTAL_MS = 4000;
  const FADE_MS = 500;
  const EXIT_AT_MS = TOTAL_MS - FADE_MS;
  const root = document.getElementById('dashboardSplash');
  const audio = document.getElementById('dashboardWelcomeAudio');
  let started = false;
  let finished = false;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  function finish() {
    if (finished) return;
    finished = true;
    audio?.pause();
    root?.remove();
    document.removeEventListener('pointerdown', resumeAudio, true);
    document.removeEventListener('keydown', resumeAudio, true);
    globalThis.dispatchEvent(new CustomEvent('mxg:dashboard-splash-complete'));
    resolveReady();
  }

  function envelope(elapsed) {
    if (elapsed < FADE_MS) return elapsed / FADE_MS;
    if (elapsed > EXIT_AT_MS) return (TOTAL_MS - elapsed) / FADE_MS;
    return 1;
  }

  function syncAudio(startedAt) {
    const update = (now) => {
      if (finished || !audio) return;
      const elapsed = Math.max(0, now - startedAt);
      audio.volume = Math.max(0, Math.min(1, envelope(elapsed)));
      if (elapsed < TOTAL_MS) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }

  function resumeAudio() {
    if (!started || finished || !audio) return;
    const elapsed = Number(root?.dataset.startedAt || 0);
    const offsetSeconds = Math.max(0, Math.min(TOTAL_MS - 100, performance.now() - elapsed)) / 1000;
    try { audio.currentTime = offsetSeconds; } catch { /* Media may not be seekable yet. */ }
    audio.play().then(() => {
      document.removeEventListener('pointerdown', resumeAudio, true);
      document.removeEventListener('keydown', resumeAudio, true);
    }).catch(() => {});
  }

  function mayAutoplayWelcome() {
    const policy = globalThis.navigator?.getAutoplayPolicy?.(audio);
    if (policy) return policy !== 'disallowed';
    const touchDevice = Number(globalThis.navigator?.maxTouchPoints || 0) > 0;
    const coarsePointer = globalThis.matchMedia?.('(pointer: coarse)').matches === true;
    return !(touchDevice && coarsePointer);
  }

  function start() {
    if (started || !root) {
      if (!root) finish();
      return ready;
    }
    started = true;
    const startedAt = performance.now();
    root.dataset.startedAt = String(startedAt);
    root.classList.add('is-visible');

    if (audio && mayAutoplayWelcome()) {
      audio.volume = 0;
      try { audio.currentTime = 0; } catch { /* Ignore an unloaded media timeline. */ }
      audio.play().catch(() => {
        if (finished) return;
        // If autoplay is blocked, the first gesture joins the sound at the
        // matching point in the visual timeline instead of restarting it.
        document.addEventListener('pointerdown', resumeAudio, true);
        document.addEventListener('keydown', resumeAudio, true);
      });
      syncAudio(startedAt);
    }

    setTimeout(() => root.classList.add('is-exiting'), EXIT_AT_MS);
    setTimeout(finish, TOTAL_MS);
    return ready;
  }

  function skip() {
    finish();
    return ready;
  }

  const preview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    && new URLSearchParams(location.search).get('splash-preview') === '1';

  if (preview) {
    requestAnimationFrame(start);
  } else {
    Promise.resolve(globalThis.MXGENIUS_CONFIG?.ready).then(() => {
      if (document.getElementById('auth-state-panel')) return skip();
      return requestAnimationFrame(start);
    }).catch(skip);
  }

  return Object.freeze({ ready, start, skip, isRunning: () => started && !finished });
})();
