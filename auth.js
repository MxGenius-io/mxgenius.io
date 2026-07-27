// Entra authorization-code + PKCE boundary for the static shell.
// The API receives an access token; no client secret or provider key is stored here.
(() => {
  const config = globalThis.MXGENIUS_CONFIG || {};
  const isDashboard = /(?:^|\/)(dashboard|progress)\.html$/i.test(location.pathname);
  const isLogin = /(?:^|\/)login\.html$/i.test(location.pathname);
  const clientId = String(config.entraClientId || '').trim();
  const tenantId = String(config.entraTenantId || '').trim();
  const redirectUri = config.entraRedirectUri || `${location.origin}/dashboard.html`;
  const authority = tenantId ? `https://login.microsoftonline.com/${tenantId}` : '';
  const apiScope = config.entraApiScope || `api://${clientId}/access_as_user`;
  let account = null;
  let accessToken = '';

  function tokenRequest() {
    return {
      account: account || undefined,
      scopes: ['openid', 'profile', apiScope]
    };
  }

  function interactionRequired(error) {
    return error instanceof globalThis.msal.InteractionRequiredAuthError
      || ['interaction_required', 'consent_required', 'login_required'].includes(String(error?.errorCode || ''));
  }

  function publishIdentity(identity) {
    const chip = document.getElementById('signedInAs');
    const name = document.getElementById('signedInAsName');
    const label = identity?.name || identity?.username || identity?.homeAccountId;
    const gate = document.getElementById('auth-gate');
    if (gate) gate.remove();
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
      auth: { clientId, authority, redirectUri, postLogoutRedirectUri: `${location.origin}/index.html`, navigateToLoginRequestUrl: false },
      cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: true }
    });
    const response = await instance.handleRedirectPromise();
    account = response?.account || instance.getActiveAccount() || instance.getAllAccounts()[0] || null;
    accessToken = response?.accessToken || '';

    if (account) instance.setActiveAccount(account);
    publishIdentity(account);
    globalThis.MXGENIUS_AUTH = {
      instance,
      account: () => account,
      signIn: () => instance.loginRedirect(tokenRequest()),
      signOut: () => instance.logoutRedirect(),
      getToken: async () => {
        if (!account) return '';
        try {
          const token = await instance.acquireTokenSilent({ account, scopes: [apiScope] });
          accessToken = token.accessToken || '';
          return accessToken;
        } catch (error) {
          if (isDashboard && interactionRequired(error)) {
            await instance.acquireTokenRedirect(tokenRequest());
            return '';
          }
          throw error;
        }
      }
    };
    if (isDashboard && !account) {
      await instance.loginRedirect(tokenRequest());
      return null;
    }
    if (account) {
      try {
        if (!accessToken) await globalThis.MXGENIUS_AUTH.getToken();
        if (!accessToken) return null;
        if (isDashboard) {
          const accessResponse = await fetch(`${config.mcpBase}/api/profile`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            credentials: 'include'
          });
          if (accessResponse.status === 401 || accessResponse.status === 403) {
            const rejectedEmail = (account.username || '').toLowerCase().trim();
            account = null;
            accessToken = '';
            localStorage.setItem('mx_beta_rejected', rejectedEmail);
            await instance.logoutRedirect({
              postLogoutRedirectUri: `${location.origin}/login.html?rejected=beta`
            });
            return null;
          }
          if (!accessResponse.ok) throw new Error(`MXGenius access verification failed (${accessResponse.status})`);
        }
      } catch (error) {
        if (isLogin && interactionRequired(error)) return account;
        console.warn('Entra token or MXGenius access verification failed', error);
        throw error;
      }
    }
    return account;
  })().catch((error) => {
    console.error('Entra sign-in failed', error);
    if (isDashboard) location.replace(`login.html?error=signin&message=${encodeURIComponent(error?.message || String(error))}&returnUrl=${encodeURIComponent(location.href)}`);
    return null;
  });

  globalThis.MXGENIUS_CONFIG = Object.freeze({
    ...config,
    ready,
    getSession: () => ({ organizationId: config.organizationId || null, accessToken, account }),
    getCompatibilitySession: config.getCompatibilitySession
  });

  if (isLogin) ready.then(() => {
    if (account && accessToken) {
      const params = new URLSearchParams(location.search);
      location.replace(params.get('returnUrl') || 'dashboard.html');
      return;
    }
    const button = document.querySelector('[data-entra-signin]');
    if (button && globalThis.MXGENIUS_AUTH) {
      button.disabled = false;
      button.addEventListener('click', () => globalThis.MXGENIUS_AUTH.signIn(), { once: true });
    }
  });
})();
