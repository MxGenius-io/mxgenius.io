// MXGenius browser identity boundary.
// The dashboard is a static SPA, so Entra authorization-code + PKCE is handled
// by MSAL in the browser. No client credential or provider key belongs here.
(() => {
  const config = globalThis.MXGENIUS_CONFIG || {};
  const isDashboard = /(?:^|\/)dashboard\.html$/i.test(location.pathname);
  const isLogin = /(?:^|\/)login\.html$/i.test(location.pathname);
  const clientId = String(config.entraClientId || '').trim();
  const tenantId = String(config.entraTenantId || '').trim();
  const redirectUri = config.entraRedirectUri || `${location.origin}/dashboard.html`;
  const authority = tenantId ? `https://login.microsoftonline.com/${tenantId}` : '';
  let account = null;
  let idToken = '';

  const ready = (async () => {
    if (!clientId || !authority || !globalThis.msal) {
      if (isDashboard) {
        location.replace(`login.html?returnUrl=${encodeURIComponent(location.href)}`);
      }
      return null;
    }

    const instance = new msal.PublicClientApplication({
      auth: { clientId, authority, redirectUri, postLogoutRedirectUri: `${location.origin}/index.html` },
      cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false }
    });
    await instance.initialize();
    const response = await instance.handleRedirectPromise();
    account = response?.account || instance.getActiveAccount() || instance.getAllAccounts()[0] || null;
    if (response?.idToken) idToken = response.idToken;
    if (account) instance.setActiveAccount(account);
    if (account && !idToken) {
      try {
        const token = await instance.acquireTokenSilent({ account, scopes: ['openid', 'profile', 'email'] });
        idToken = token.idToken || '';
      } catch (error) {
        console.warn('Silent Entra token refresh unavailable; interactive sign-in may be required', error);
      }
    }

    globalThis.MXGENIUS_AUTH = {
      instance,
      account: () => account,
      signIn: () => instance.loginRedirect({ scopes: ['openid', 'profile', 'email'] }),
      signOut: () => instance.logoutRedirect(),
      getToken: async () => {
        if (!account) return '';
        try {
          const token = await instance.acquireTokenSilent({ account, scopes: ['openid', 'profile', 'email'] });
          return token.idToken || idToken;
        } catch {
          return idToken;
        }
      }
    };

    if (isDashboard && !account) {
      await instance.loginRedirect({ scopes: ['openid', 'profile', 'email'] });
      return null;
    }
    return account;
  })().catch((error) => {
    console.error('Entra sign-in failed', error);
    if (isDashboard) location.replace(`login.html?error=signin&returnUrl=${encodeURIComponent(location.href)}`);
    return null;
  });

  globalThis.MXGENIUS_CONFIG = Object.freeze({
    ...config,
    ready,
    getSession: () => ({
      organizationId: config.organizationId || null,
      accessToken: idToken,
      account: globalThis.MXGENIUS_AUTH?.account?.() || account
    }),
    getCompatibilitySession: config.getCompatibilitySession || (async () => {
      const endpoint = config.compatibilitySessionEndpoint;
      if (!endpoint) throw new Error('Fleet compatibility session is not configured');
      const response = await fetch(endpoint, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok || !payload?.bearerToken || !payload?.apiToken) throw new Error(payload?.error?.message || `Fleet session failed (${response.status})`);
      return payload;
    })
  });

  if (isLogin) {
    ready.then(() => {
      const button = document.querySelector('[data-entra-signin]');
      if (!button || !globalThis.MXGENIUS_AUTH || globalThis.MXGENIUS_AUTH.account()) return;
      button.disabled = false;
      button.addEventListener('click', () => globalThis.MXGENIUS_AUTH.signIn(), { once: true });
    });
  }
})();
