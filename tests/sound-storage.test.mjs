import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../sound-storage.js', import.meta.url), 'utf8');

function createStorage({ getToken, list }) {
  const context = {
    MXGENIUS_CONFIG: {
      ready: Promise.resolve(),
      getSession: () => ({ accessToken: 'page-load-token', organizationId: 'org-1' })
    },
    MXGENIUS_AUTH: { getToken },
    MXApplicationClient: {
      uiSounds: {
        list,
        getContent: async () => new Blob(['audio']),
        put: async () => ({}),
        delete: async () => ({})
      }
    },
    URL: {
      createObjectURL: () => 'blob:ui-sound',
      revokeObjectURL: () => {}
    }
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.MXGeniusSoundStorage;
}

test('sound storage asks the shared auth core for a current token', async () => {
  const sessions = [];
  const storage = createStorage({
    getToken: async ({ forceRefresh }) => {
      assert.equal(forceRefresh, false);
      return 'fresh-token';
    },
    list: async (session) => {
      sessions.push(session);
      return { schema_version: 1, version: 0, overrides: [] };
    }
  });

  await storage.loadIndex();

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].accessToken, 'fresh-token');
  assert.equal(sessions[0].organizationId, 'org-1');
});

test('sound storage silently refreshes once after an expired application token', async () => {
  const refreshes = [];
  const sessions = [];
  const storage = createStorage({
    getToken: async ({ forceRefresh }) => {
      refreshes.push(forceRefresh);
      return forceRefresh ? 'renewed-token' : 'expired-token';
    },
    list: async (session) => {
      sessions.push(session.accessToken);
      if (session.accessToken === 'expired-token') {
        const error = new Error('expired');
        error.status = 401;
        throw error;
      }
      return { schema_version: 1, version: 2, overrides: [] };
    }
  });

  const result = await storage.loadIndex();

  assert.deepEqual(refreshes, [false, true]);
  assert.deepEqual(sessions, ['expired-token', 'renewed-token']);
  assert.equal(result.version, 2);
});
