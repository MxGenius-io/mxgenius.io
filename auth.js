// Entra authorization-code + PKCE boundary for the static shell.
// The API receives an access token; no client secret or provider key is stored here.
(() => {
  const config = globalThis.MXGENIUS_CONFIG || {};
  const isDashboard = /(?:^|\/)(dashboard|progress|patent-workspace)\.html$/i.test(location.pathname);
  const isLogin = /(?:^|\/)login\.html$/i.test(location.pathname);
  const isLanding = /(?:^|\/)(?:index\.html)?$/i.test(location.pathname);
  const clientId = String(config.entraClientId || '').trim();
  const tenantId = String(config.entraTenantId || '').trim();
  const redirectUri = config.entraRedirectUri || `${location.origin}/dashboard.html`;
  const authority = tenantId ? `https://login.microsoftonline.com/${tenantId}` : '';
  const apiScope = config.entraApiScope || `api://${clientId}/access_as_user`;
  let account = null;
  let accessToken = '';
  let accessState = 'initializing';
  const protectedReturnKey = 'mx_auth_protected_return';

  function rememberProtectedReturn() {
    if (!isDashboard || /(?:^|\/)dashboard\.html$/i.test(location.pathname)) return;
    globalThis.sessionStorage?.setItem(
      protectedReturnKey,
      `${location.origin}${location.pathname}${location.search}`
    );
  }

  function protectedReturnUrl() {
    const pending = globalThis.sessionStorage?.getItem(protectedReturnKey);
    if (!pending) return null;
    try {
      const target = new URL(pending, location.origin);
      if (target.origin !== location.origin) return null;
      if (!/(?:^|\/)(progress|patent-workspace)\.html$/i.test(target.pathname)) return null;
      return target.href;
    } catch {
      return null;
    }
  }

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

  function identityLabel(identity) {
    return identity?.display_name
      || identity?.name
      || identity?.email
      || identity?.username
      || identity?.homeAccountId
      || '';
  }

  function publishIdentity(identity) {
    const chip = document.getElementById('signedInAs');
    const name = document.getElementById('signedInAsName');
    const label = identityLabel(identity);
    const gate = document.getElementById('auth-gate');
    if (gate) gate.remove();
    if (!chip || !name || !label) return;
    name.textContent = label;
    chip.hidden = false;
  }

  function publishLandingState(state, identity, detail = '') {
    if (!isLanding) return;
    accessState = state;
    const root = document.querySelector('[data-auth-state]');
    const link = document.getElementById('landingAuthLink');
    const chip = document.getElementById('signedInAs');
    const name = document.getElementById('signedInAsName');
    if (root) root.dataset.authState = state;
    if (chip) chip.hidden = state !== 'authenticated';
    if (name) name.textContent = identityLabel(identity);
    if (!link) return;
    link.removeAttribute('aria-disabled');
    link.title = detail;
    if (state === 'authenticated') {
      link.textContent = 'Open Dashboard';
      link.href = 'dashboard.html';
    } else if (state === 'unauthorized') {
      link.textContent = 'Access Not Approved';
      link.href = 'login.html?rejected=beta';
    } else if (state === 'service-unavailable') {
      link.textContent = 'Service Temporarily Unavailable';
      link.href = 'login.html?error=service-unavailable';
    } else {
      link.textContent = 'Sign In';
      link.href = 'login.html';
    }
  }

  function publishDashboardUnavailable(message) {
    if (!isDashboard) return;
    document.getElementById('auth-gate')?.remove();
    let panel = document.getElementById('auth-state-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'auth-state-panel';
      panel.setAttribute('role', 'alert');
      panel.style.cssText = 'position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:2rem;background:#070b14;color:#e5edf9;text-align:center;';
      document.body.appendChild(panel);
    }
    panel.textContent = message;
  }

  async function verifyApplicationAccess() {
    const response = await fetch(`${config.mcpBase}/api/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'include'
    });
    let profile = null;
    if (response.ok) {
      try {
        profile = await response.json();
      } catch {
        profile = null;
      }
    }
    return { response, profile };
  }

  const ready = (async () => {
    if (!clientId || !authority || !globalThis.msal) {
      if (isDashboard) location.replace(`login.html?returnUrl=${encodeURIComponent(location.href)}`);
      publishLandingState('service-unavailable', null, 'Secure sign-in is not configured.');
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
    if (isDashboard) publishIdentity(account);
    globalThis.MXGENIUS_AUTH = {
      instance,
      account: () => account,
      accessState: () => accessState,
      signIn: () => instance.loginRedirect({
        ...tokenRequest(),
        ...(isLogin ? { prompt: 'select_account' } : {})
      }),
      signOut: () => instance.logoutRedirect(),
      getToken: async () => {
        if (!account) return '';
        try {
          const token = await instance.acquireTokenSilent({ account, scopes: [apiScope] });
          accessToken = token.accessToken || '';
          return accessToken;
        } catch (error) {
          if (isDashboard && interactionRequired(error)) {
            rememberProtectedReturn();
            await instance.acquireTokenRedirect(tokenRequest());
            return '';
          }
          throw error;
        }
      }
    };
    if (isDashboard && !account) {
      rememberProtectedReturn();
      await instance.loginRedirect(tokenRequest());
      return null;
    }
    if (!account) {
      publishLandingState('anonymous');
      accessState = 'anonymous';
      return null;
    }
    if (account) {
      try {
        if (!accessToken) await globalThis.MXGENIUS_AUTH.getToken();
        if (!accessToken) {
          publishLandingState('interaction-required', account);
          accessState = 'interaction-required';
          return account;
        }
        if (isDashboard || isLogin || isLanding) {
          const { response: accessResponse, profile } = await verifyApplicationAccess();
          if (accessResponse.status === 401) {
            accessState = 'unauthenticated';
            publishLandingState('anonymous');
            if (isDashboard) {
              await instance.logoutRedirect({
                postLogoutRedirectUri: `${location.origin}/login.html?returnUrl=${encodeURIComponent(location.href)}`
              });
            }
            return null;
          }
          if (accessResponse.status === 403) {
            const rejectedEmail = (account.username || '').toLowerCase().trim();
            localStorage.setItem('mx_beta_rejected', rejectedEmail);
            accessState = 'unauthorized';
            publishLandingState('unauthorized', account, 'This identity is valid but has not been approved for the beta.');
            if (isDashboard) {
              location.replace(`${location.origin}/login.html?rejected=beta&returnUrl=${encodeURIComponent(location.href)}`);
            }
            return account;
          }
          if (!accessResponse.ok) {
            accessState = 'service-unavailable';
            publishLandingState('service-unavailable', account, `Access verification returned ${accessResponse.status}.`);
            publishDashboardUnavailable('MXGenius is temporarily unavailable. Your Microsoft session is still signed in; retry shortly.');
            return account;
          }
          accessState = 'authenticated';
          publishIdentity(profile || account);
          publishLandingState('authenticated', profile || account);
          const returnUrl = response && /(?:^|\/)dashboard\.html$/i.test(location.pathname)
            ? protectedReturnUrl()
            : null;
          if (returnUrl) {
            globalThis.sessionStorage?.removeItem(protectedReturnKey);
            location.replace(returnUrl);
            return account;
          }
        }
      } catch (error) {
        if ((isLogin || isLanding) && interactionRequired(error)) {
          accessState = 'interaction-required';
          publishLandingState('interaction-required', account);
          return account;
        }
        if (isDashboard && interactionRequired(error)) return account;
        accessState = 'service-unavailable';
        publishLandingState('service-unavailable', account, error?.message || String(error));
        publishDashboardUnavailable('MXGenius is temporarily unavailable. Your Microsoft session is still signed in; retry shortly.');
        console.warn('Entra token or MXGenius access verification failed', error);
        return account;
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
    if (account && accessToken && accessState === 'authenticated') {
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
