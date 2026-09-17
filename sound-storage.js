(() => {
  'use strict';

  let index = null;
  let indexPromise = null;
  const cueUrls = new Map();

  function parentValue(name) {
    try {
      return globalThis.parent !== globalThis ? globalThis.parent?.[name] : null;
    } catch {
      return null;
    }
  }

  function allowsInsecurePilot() {
    return Boolean(
      globalThis.MXGENIUS_CONFIG?.allowInsecurePilot
      || parentValue('MXGENIUS_CONFIG')?.allowInsecurePilot
    );
  }

  function publishUpdate(cueIds, current) {
    const detail = {
      cueIds: [...new Set(cueIds.filter(Boolean))],
      version: Number(current?.version || 0),
      updatedAt: current?.updatedAt || null
    };
    const targets = [globalThis];
    try {
      if (globalThis.parent !== globalThis) targets.push(globalThis.parent);
    } catch {
      // A cross-origin parent cannot share the authenticated sound library.
    }
    [...new Set(targets)].forEach((target) => {
      if (!target?.dispatchEvent || typeof target.CustomEvent !== 'function') return;
      target.dispatchEvent(new target.CustomEvent('mxgenius:ui-sounds-updated', { detail }));
    });
  }

  async function session({ forceRefresh = false } = {}) {
    const localConfig = globalThis.MXGENIUS_CONFIG || {};
    const parentConfig = parentValue('MXGENIUS_CONFIG') || {};
    await Promise.resolve(localConfig.ready || parentConfig.ready);
    const localSession = localConfig.getSession?.() || {};
    const parentSession = parentConfig.getSession?.() || {};
    const configured = localSession.accessToken ? localSession : { ...localSession, ...parentSession };
    const auth = globalThis.MXGENIUS_AUTH?.getToken
      ? globalThis.MXGENIUS_AUTH
      : parentValue('MXGENIUS_AUTH');
    const refreshedAccessToken = auth?.getToken
      ? await auth.getToken({ forceRefresh })
      : '';
    const accessToken = refreshedAccessToken || configured.accessToken;
    if (!accessToken && !allowsInsecurePilot()) {
      const error = new Error('Your sign-in needs to be renewed.');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    return { ...configured, accessToken };
  }

  function authenticationError(error) {
    return ['AUTH_REQUIRED', 'ACCESS_DENIED'].includes(String(error?.code || ''))
      || error?.status === 401;
  }

  async function authenticatedRequest(operation) {
    let requestSession = await session();
    try {
      return await operation(requestSession);
    } catch (error) {
      if (!authenticationError(error) || allowsInsecurePilot()) throw error;
      requestSession = await session({ forceRefresh: true });
      return operation(requestSession);
    }
  }

  function normalizeIndex(value) {
    const overrides = Array.isArray(value?.overrides) ? value.overrides : [];
    return {
      schemaVersion: Number(value?.schema_version || 1),
      version: Number(value?.version || 0),
      updatedAt: value?.updated_at || null,
      overrides,
      byCue: new Map(overrides.filter((sound) => sound?.cue_id).map((sound) => [sound.cue_id, sound]))
    };
  }

  function releaseCueUrl(cueId) {
    const cached = cueUrls.get(cueId);
    if (cached?.url) URL.revokeObjectURL(cached.url);
    cueUrls.delete(cueId);
  }

  async function loadIndex({ force = false } = {}) {
    await Promise.resolve(globalThis.MXGENIUS_CONFIG?.ready);
    if (force) indexPromise = null;
    if (index && !force) return index;
    if (!indexPromise) {
      const client = globalThis.MXApplicationClient?.uiSounds;
      if (!client?.list) throw new Error('Sound storage client is unavailable');
      indexPromise = authenticatedRequest((requestSession) => client.list(requestSession))
        .then((value) => {
          index = normalizeIndex(value);
          return index;
        })
        .finally(() => { indexPromise = null; });
    }
    return indexPromise;
  }

  async function getCueUrl(cueId) {
    const current = await loadIndex();
    const override = current.byCue.get(cueId);
    if (!override) return null;
    const cached = cueUrls.get(cueId);
    if (cached?.hash === override.content_hash) return cached.url;
    releaseCueUrl(cueId);
    const blob = await authenticatedRequest((requestSession) => (
      globalThis.MXApplicationClient.uiSounds.getContent(cueId, requestSession)
    ));
    const url = URL.createObjectURL(blob);
    cueUrls.set(cueId, { hash: override.content_hash, url });
    return url;
  }

  async function saveIndex({ replacements = [], resets = [] } = {}) {
    const client = globalThis.MXApplicationClient?.uiSounds;
    if (!client?.put || !client?.delete) throw new Error('Sound storage client is unavailable');
    let current = await loadIndex({ force: true });
    try {
      for (const cueId of resets) {
        releaseCueUrl(cueId);
        current = normalizeIndex(await authenticatedRequest((requestSession) => client.delete(cueId, {
          expectedVersion: current.version,
          session: requestSession
        })));
        index = current;
        publishUpdate([cueId], current);
      }
      for (const replacement of replacements) {
        releaseCueUrl(replacement.cueId);
        current = normalizeIndex(await authenticatedRequest((requestSession) => client.put(replacement.cueId, replacement.file, {
          durationMs: Math.round(Number(replacement.duration || 0) * 1000),
          expectedVersion: current.version,
          session: requestSession
        })));
        index = current;
        publishUpdate([replacement.cueId], current);
      }
      return current;
    } catch (error) {
      index = null;
      indexPromise = null;
      throw error;
    }
  }

  globalThis.addEventListener?.('beforeunload', () => {
    cueUrls.forEach(({ url }) => URL.revokeObjectURL(url));
    cueUrls.clear();
  }, { once: true });

  globalThis.MXGeniusSoundStorage = Object.freeze({
    loadIndex,
    getCueUrl,
    saveIndex
  });
})();
