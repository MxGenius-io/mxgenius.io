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
  silentError = null
}) {
  const calls = {
    acquireTokenRedirect: [],
    acquireTokenSilent: [],
    fetch: [],
    loginRedirect: [],
    locationReplace: []
  };
  const button = {
    disabled: true,
    addEventListener() {}
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

    async logoutRedirect() {}
  }

  const context = {
    URLSearchParams,
    console,
    document: {
      getElementById() {
        return null;
      },
      querySelector(selector) {
        return selector === '[data-entra-signin]' ? button : null;
      }
    },
    fetch: async (url, options) => {
      calls.fetch.push({ url, options });
      return { ok: true, status: 200 };
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
  return { button, calls, context };
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
