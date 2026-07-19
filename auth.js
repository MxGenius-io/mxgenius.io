// Runtime identity seam. The authenticated application host may define
// MXGENIUS_CONFIG before this file loads; this module only adds a safe
// compatibility-session exchange when an endpoint is explicitly configured.
(() => {
  const config = globalThis.MXGENIUS_CONFIG || {};

  async function getCompatibilitySession(options = {}) {
    const endpoint = config.compatibilitySessionEndpoint;
    if (!endpoint) throw new Error('Fleet compatibility session is not configured');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      credentials: 'include',
      signal: options.signal
    });
    const payload = await response.json();
    if (!response.ok || !payload?.bearerToken || !payload?.apiToken) {
      throw new Error(payload?.error?.message || `Fleet compatibility session failed (${response.status})`);
    }
    return payload;
  }

  globalThis.MXGENIUS_CONFIG = Object.freeze({
    ...config,
    getCompatibilitySession: config.getCompatibilitySession || getCompatibilitySession
  });
})();
