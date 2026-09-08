import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../capability-workbench.js', import.meta.url), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function element(value = '') {
  return {
    value,
    textContent: '',
    innerHTML: '',
    hidden: false,
    dataset: {},
    addEventListener() {},
    querySelectorAll() { return []; }
  };
}

function harness({ ready = Promise.resolve(), list, online = true } = {}) {
  const elements = new Map([
    ['capabilityStatus', element()],
    ['capabilityCatalog', element()],
    ['capabilitySearch', element('')]
  ]);
  const tokenCalls = [];
  const listCalls = [];
  const disconnectCalls = [];
  const timers = [];
  const context = vm.createContext({
    console,
    crypto: { randomUUID: () => 'correlation-id' },
    document: {
      addEventListener() {},
      createElement: () => element(),
      getElementById: (id) => elements.get(id) || null
    },
    addEventListener() {},
    clearTimeout() {},
    navigator: { onLine: online },
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    MXGENIUS_CONFIG: {
      ready,
      getSession: () => ({ accessToken: 'cached-token', organizationId: 'org-1' })
    },
    MXGENIUS_AUTH: {
      async getToken(options) {
        tokenCalls.push(options);
        return options.forceRefresh ? 'refreshed-token' : 'cached-token';
      }
    },
    MXApplicationClient: {
      capabilities: {
        async list(requestSession) {
          listCalls.push(requestSession);
          return list(requestSession, listCalls.length);
        },
        disconnect(requestSession) { disconnectCalls.push(requestSession); }
      }
    }
  });
  context.globalThis = context;
  vm.runInContext(source, context);
  return { context, disconnectCalls, elements, listCalls, timers, tokenCalls };
}

test('capability catalog waits for Entra readiness before connecting', async () => {
  const authReady = deferred();
  const runtime = harness({ ready: authReady.promise, list: () => ({ tools: [] }) });
  const loading = vm.runInContext('MXCapabilityWorkbench.reload()', runtime.context);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.listCalls.length, 0);

  authReady.resolve();
  await loading;
  assert.equal(runtime.listCalls.length, 1);
  assert.equal(runtime.listCalls[0].accessToken, 'cached-token');
});

test('capability catalog refreshes the token and retries once after AUTH_REQUIRED', async () => {
  const runtime = harness({
    list: (_requestSession, attempt) => {
      if (attempt === 1) {
        const error = new Error('Authentication required');
        error.code = 'AUTH_REQUIRED';
        throw error;
      }
      return { tools: [] };
    }
  });

  await vm.runInContext('MXCapabilityWorkbench.reload()', runtime.context);

  assert.equal(runtime.listCalls.length, 2);
  assert.equal(runtime.listCalls[0].accessToken, 'cached-token');
  assert.equal(runtime.listCalls[1].accessToken, 'refreshed-token');
  assert.deepEqual(runtime.tokenCalls.map(({ forceRefresh }) => forceRefresh), [false, true]);
  assert.equal(runtime.disconnectCalls.length, 1);
});

test('capability catalog schedules bounded recovery after a transport interruption', async () => {
  const runtime = harness({
    list: () => {
      const error = new Error('Network unavailable');
      error.code = 'MCP_TRANSPORT_FAILED';
      throw error;
    }
  });

  await vm.runInContext('MXCapabilityWorkbench.reload()', runtime.context);

  assert.equal(runtime.timers.length, 1);
  assert.equal(runtime.timers[0].delay, 1_500);
  assert.match(runtime.elements.get('capabilityStatus').textContent, /retrying/);

  const exhausted = harness({
    list: () => {
      const error = new Error('Network unavailable');
      error.code = 'MCP_TRANSPORT_FAILED';
      throw error;
    }
  });
  await vm.runInContext('MXCapabilityWorkbench.reload({ attempt: 3 })', exhausted.context);
  assert.equal(exhausted.timers.length, 0);
  assert.match(exhausted.elements.get('capabilityStatus').textContent, /temporarily unavailable/);
});

test('capability catalog waits for the browser online event instead of polling offline', async () => {
  const runtime = harness({
    online: false,
    list: () => {
      const error = new Error('Network unavailable');
      error.code = 'MCP_TRANSPORT_FAILED';
      throw error;
    }
  });

  await vm.runInContext('MXCapabilityWorkbench.reload()', runtime.context);

  assert.equal(runtime.timers.length, 0);
  assert.match(runtime.elements.get('capabilityStatus').textContent, /waiting for network/);
});
