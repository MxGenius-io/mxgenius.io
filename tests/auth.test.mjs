import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../auth.js', import.meta.url), 'utf8');

class InteractionRequiredAuthError extends Error {
  constructor(message = 'interaction required') {
    super(message);
    this.errorCode = 'interaction_required';
  }
}

async function runAuth({
  pathname,
  redirectResponse = null,
  cachedAccount = null,
  silentToken = null,
  silentError = null,
  profileStatus = 200,
  profileBody = { display_name: 'Rocky', email: 'rocky@gmail.com' },
  fetchError = null
}) {
  const calls = {
    acquireTokenRedirect: [],
    acquireTokenSilent: [],
    fetch: [],
    loginRedirect: [],
    logoutRedirect: [],
    locationReplace: []
  };
  const button = {
    disabled: true,
    addEventListener() {}
  };
  const elements = {
    landingAuthLink: {
      textContent: '',
      href: '',
      title: '',
      removeAttribute() {}
    },
    signedInAs: { hidden: true },
    signedInAsName: { textContent: '' }
  };

  class PublicClientApplication {
    async handleRedirectPromise() {
      return redirectResponse;
    }

    getActiveAccount() {
      return null;
    }

    getAllAccounts() {
      return cachedAccount ? [cachedAccount] : [];
    }

    setActiveAccount() {}

    async acquireTokenSilent(request) {
      calls.acquireTokenSilent.push(request);
      if (silentError) throw silentError;
      return { accessToken: silentToken || '' };
    }

    async acquireTokenRedirect(request) {
      calls.acquireTokenRedirect.push(request);
    }

    async loginRedirect(request) {
      calls.loginRedirect.push(request);
    }

    async logoutRedirect(request) {
      calls.logoutRedirect.push(request);
    }
  }

  const context = {
    URLSearchParams,
    console,
    document: {
      getElementById() {
        return elements[arguments[0]] || null;
      },
      querySelector(selector) {
        if (selector === '[data-entra-signin]') return button;
        if (selector === '[data-auth-state]') {
          return { dataset: { authState: 'initializing' } };
        }
        return null;
      }
    },
    fetch: async (url, options) => {
      calls.fetch.push({ url, options });
      if (fetchError) throw fetchError;
      return {
        ok: profileStatus >= 200 && profileStatus < 300,
        status: profileStatus,
        async json() {
          return profileBody;
        }
      };
    },
    localStorage: {
      setItem() {}
    },
    location: {
      href: `https://mxgenius.io${pathname}`,
      origin: 'https://mxgenius.io',
      pathname,
      search: '',
      replace(url) {
        calls.locationReplace.push(url);
      }
    },
    msal: {
      InteractionRequiredAuthError,
      PublicClientApplication
    },
    MXGENIUS_CONFIG: {
      entraClientId: 'client-id',
      entraTenantId: 'tenant-id',
      entraApiScope: 'api://client-id/access_as_user',
      entraRedirectUri: 'https://mxgenius.io/dashboard.html',
      mcpBase: 'https://mxg-core.example'
    }
  };
  context.globalThis = context;

  vm.runInNewContext(source, context);
  await context.MXGENIUS_CONFIG.ready;
  await new Promise((resolve) => setImmediate(resolve));
  return { button, calls, context, elements };
}

test('dashboard consumes the access token returned by the Microsoft redirect', async () => {
  const account = { username: 'pilot@example.com' };
  const { calls } = await runAuth({
    pathname: '/dashboard.html',
    redirectResponse: { account, accessToken: 'redirect-access-token' }
  });

  assert.equal(calls.acquireTokenSilent.length, 0);
  assert.equal(calls.acquireTokenRedirect.length, 0);
  assert.equal(calls.locationReplace.length, 0);
  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.fetch[0].options.headers.Authorization, 'Bearer redirect-access-token');
});

test('dashboard resolves an interaction-required token through Microsoft without detouring through login', async () => {
  const { calls } = await runAuth({
    pathname: '/dashboard.html',
    cachedAccount: { username: 'pilot@example.com' },
    silentError: new InteractionRequiredAuthError()
  });

  assert.equal(calls.acquireTokenSilent.length, 1);
  assert.equal(calls.acquireTokenRedirect.length, 1);
  assert.equal(calls.locationReplace.length, 0);
  assert.equal(calls.fetch.length, 0);
});

test('login does not return to dashboard merely because an unusable account is cached', async () => {
  const { button, calls } = await runAuth({
    pathname: '/login.html',
    cachedAccount: { username: 'pilot@example.com' },
    silentError: new InteractionRequiredAuthError()
  });

  assert.equal(calls.locationReplace.length, 0);
  assert.equal(calls.acquireTokenRedirect.length, 0);
  assert.equal(button.disabled, false);
});

test('landing page recognizes an authorized cached session without redirecting', async () => {
  const { calls, context, elements } = await runAuth({
    pathname: '/index.html',
    cachedAccount: { username: 'rocky@gmail.com', name: 'Rocky' },
    silentToken: 'cached-access-token'
  });

  assert.equal(calls.acquireTokenSilent.length, 1);
  assert.equal(calls.loginRedirect.length, 0);
  assert.equal(calls.acquireTokenRedirect.length, 0);
  assert.equal(calls.locationReplace.length, 0);
  assert.equal(calls.fetch.length, 1);
  assert.equal(context.MXGENIUS_AUTH.accessState(), 'authenticated');
  assert.equal(elements.landingAuthLink.textContent, 'Open Dashboard');
  assert.equal(elements.signedInAs.hidden, false);
  assert.equal(elements.signedInAsName.textContent, 'Rocky');
});

test('authenticated callers can force a silent token renewal after an API rejection', async () => {
  const { calls, context } = await runAuth({
    pathname: '/dashboard.html',
    cachedAccount: { username: 'pilot@example.com' },
    silentToken: 'renewed-access-token'
  });

  await context.MXGENIUS_AUTH.getToken({ forceRefresh: true });

  assert.equal(calls.acquireTokenSilent.length, 2);
  assert.equal(calls.acquireTokenSilent[1].forceRefresh, true);
});

test('landing page distinguishes a whitelisting denial without logging out', async () => {
  const { calls, context, elements } = await runAuth({
    pathname: '/index.html',
    cachedAccount: { username: 'rocky@gmail.com' },
    silentToken: 'valid-but-unapproved-token',
    profileStatus: 403,
    profileBody: { error: { code: 'MEMBERSHIP_NOT_FOUND' } }
  });

  assert.equal(calls.logoutRedirect.length, 0);
  assert.equal(calls.locationReplace.length, 0);
  assert.equal(context.MXGENIUS_AUTH.accessState(), 'unauthorized');
  assert.equal(elements.landingAuthLink.textContent, 'Access Not Approved');
});

test('landing page preserves the Microsoft session during an API outage', async () => {
  const { calls, context, elements } = await runAuth({
    pathname: '/',
    cachedAccount: { username: 'rocky@gmail.com' },
    silentToken: 'valid-token',
    profileStatus: 503,
    profileBody: { error: { code: 'SERVICE_UNAVAILABLE' } }
  });

  assert.equal(calls.logoutRedirect.length, 0);
  assert.equal(calls.locationReplace.length, 0);
  assert.equal(context.MXGENIUS_AUTH.accessState(), 'service-unavailable');
  assert.equal(elements.landingAuthLink.textContent, 'Service Temporarily Unavailable');
});

test('landing page never forces interaction for a cached account that needs it', async () => {
  const { calls, context, elements } = await runAuth({
    pathname: '/',
    cachedAccount: { username: 'rocky@gmail.com' },
    silentError: new InteractionRequiredAuthError()
  });

  assert.equal(calls.loginRedirect.length, 0);
  assert.equal(calls.acquireTokenRedirect.length, 0);
  assert.equal(calls.locationReplace.length, 0);
  assert.equal(context.MXGENIUS_AUTH.accessState(), 'interaction-required');
  assert.equal(elements.landingAuthLink.textContent, 'Sign In');
});
