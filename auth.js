// Entra authorization-code + PKCE boundary for the static shell.
// The API receives an access token; no client secret or provider key is stored here.
(() => {
  const config = globalThis.MXGENIUS_CONFIG || {};
  const isDashboard = /(?:^|\/)dashboard\.html$/i.test(location.pathname);
  const isLogin = /(?:^|\/)login\.html$/i.test(location.pathname);
  const clientId = String(config.entraClientId || '').trim();
  const tenantId = String(config.entraTenantId || '').trim();
  const redirectUri = config.entraRedirectUri || `${location.origin}/dashboard.html`;
  const authority = tenantId ? `https://login.microsoftonline.com/${tenantId}` : '';
  const apiScope = config.entraApiScope || `api://${clientId}/access_as_user`;
  let account = null;
  let accessToken = '';

  function publishIdentity(identity) {
    const chip = document.getElementById('signedInAs');
    const name = document.getElementById('signedInAsName');
    const label = identity?.name || identity?.username || identity?.homeAccountId;
    if (!chip || !name || !label) return;
    name.textContent = label;
    chip.hidden = false;
  }

  const ready = (async () => {
    if (!clientId || !authority || !globalThis.msal) {
      if (isDashboard) location.replace(`login.html?returnUrl=${encodeURIComponent(location.href)}`);
      return null;
    }
    const instance = new msal.PublicClientApplication({
      auth: { clientId, authority, redirectUri, postLogoutRedirectUri: `${location.origin}/index.html` },
      cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false }
    });
    const response = await instance.handleRedirectPromise();
    account = response?.account || instance.getActiveAccount() || instance.getAllAccounts()[0] || null;
    if (account) instance.setActiveAccount(account);
    publishIdentity(account);
    globalThis.MXGENIUS_AUTH = {
      instance,
      account: () => account,
      signIn: () => instance.loginRedirect({ scopes: ['openid', 'profile', apiScope] }),
      signOut: () => instance.logoutRedirect(),
      getToken: async () => {
        if (!account) return '';
        const token = await instance.acquireTokenSilent({ account, scopes: [apiScope] });
        accessToken = token.accessToken || '';
        return accessToken;
      }
    };
    if (isDashboard && !account) {
      await instance.loginRedirect({ scopes: ['openid', 'profile', apiScope] });
      return null;
    }
    if (account && !accessToken) {
      try { await globalThis.MXGENIUS_AUTH.getToken(); } catch (error) { console.warn('Entra token acquisition pending interactive sign-in', error); }
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
    getSession: () => ({ organizationId: config.organizationId || null, accessToken, account }),
    getCompatibilitySession: config.getCompatibilitySession
  });

  if (isLogin) ready.then(() => {
    const button = document.querySelector('[data-entra-signin]');
    if (button && globalThis.MXGENIUS_AUTH && !account) {
      button.disabled = false;
      button.addEventListener('click', () => globalThis.MXGENIUS_AUTH.signIn(), { once: true });
    }
  });
})();
