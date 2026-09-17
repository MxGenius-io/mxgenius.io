import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../equipment-pack-workspace.js', import.meta.url), 'utf8');

function workspace() {
  const window = {};
  const context = {
    window,
    crypto,
    TextEncoder,
    Uint8Array,
    Uint32Array,
    ArrayBuffer,
    DataView,
    Blob,
    Date,
    Set,
    String,
    Error,
  };
  vm.runInNewContext(source, context);
  return window.MXEquipmentPacks;
}

function file(path, contents) {
  const value = new File([contents], path.split('/').at(-1), { lastModified: 1_800_000_000_000 });
  Object.defineProperty(value, 'webkitRelativePath', { value: path });
  return value;
}

test('browser Equipment Pack builder emits deterministic stored ZIP bytes and a matching manifest', async () => {
  const built = await workspace().buildStoredZip([
    file('manuals/checklist.txt', 'inspect'),
    file('manuals/reference.txt', 'verify'),
  ]);

  assert.equal(built.manifest.schemaVersion, 1);
  assert.deepEqual(Array.from(built.manifest.files, (entry) => entry.path), [
    'manuals/checklist.txt',
    'manuals/reference.txt',
  ]);
  assert.ok(built.manifest.files.every((entry) => /^sha256:[0-9a-f]{64}$/.test(entry.sha256)));
  assert.match(built.contentHash, /^sha256:[0-9a-f]{64}$/);
  const bytes = new Uint8Array(await built.archive.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual(Array.from(bytes.slice(-22, -18)), [0x50, 0x4b, 0x05, 0x06]);
});

test('browser Equipment Pack builder refuses paths that would be unsafe or collide on FAT', async () => {
  await assert.rejects(
    workspace().buildStoredZip([file('manuals/CON.txt', 'reserved')]),
    /Unsafe file path/,
  );
  await assert.rejects(
    workspace().buildStoredZip([file('manuals/Part.txt', 'one'), file('manuals/part.txt', 'two')]),
    /collide on a USB filesystem/,
  );
});

test('Equipment Drives expose a confirmed recoverable archive path', async () => {
  const client = await readFile(new URL('../application-client.js', import.meta.url), 'utf8');
  const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
  assert.match(client, /function archiveEquipmentPack/);
  assert.match(client, /method: 'DELETE'/);
  assert.match(source, /window\.confirm\(`Remove \"\$\{pack\.name\}\" from Equipment Drives\?/);
  assert.match(source, /client\.archive\(pack\.id, session\)/);
  assert.match(dashboard, /id="settingsPackArchive"[^>]*disabled>Remove selected drive/);
});

test('drive creation retains its form reference across the async request', () => {
  assert.match(source, /const form = event\.currentTarget;/);
  assert.match(source, /await run\([\s\S]*form\.reset\(\);/);
  assert.doesNotMatch(source, /event\.currentTarget\.reset\(\)/);
});

test('published manual drive versions expose their data-derived mixed-aircraft catalog', () => {
  const version = {
    manifest: {
      source: {
        manuals: [
          {
            id: 'falcon-7x-amm-a1b2c3',
            displayName: 'Falcon 7X Aircraft Maintenance Manual',
            manualType: 'Aircraft Maintenance Manual',
            aircraftModels: ['Falcon 7X']
          },
          {
            id: 'g650-ipc-d4e5f6',
            displayName: 'G650 Illustrated Parts Catalog',
            manualType: 'Illustrated Parts Catalog',
            aircraftModels: ['Gulfstream G650']
          }
        ]
      },
      files: []
    }
  };
  const displayed = workspace().manualsFromVersion(version);
  assert.deepEqual(
    JSON.parse(JSON.stringify(displayed.map((manual) => ({
      id: manual.id,
      name: manual.displayName,
      type: manual.manualType
    })))),
    [
      { id: 'falcon-7x-amm-a1b2c3', name: 'Falcon 7X Aircraft Maintenance Manual', type: 'Aircraft Maintenance Manual' },
      { id: 'g650-ipc-d4e5f6', name: 'G650 Illustrated Parts Catalog', type: 'Illustrated Parts Catalog' }
    ]
  );
});

test('manual picker uses human-readable manual names without repeating the aircraft model', () => {
  const labels = [
    { id: 'cl350-amm', displayName: 'cl350 amm', manualType: 'Manual' },
    { id: 'cl350-ipc', displayName: 'cl350 ipc', manualType: 'Manual' },
    { id: 'cl350-ndt', displayName: 'cl350 ndt', manualType: 'Manual' },
    { id: 'cl350-spm', displayName: 'cl350 spm', manualType: 'Manual' },
    { id: 'cl350-ssm', displayName: 'cl350 ssm', manualType: 'Manual' },
  ].map(workspace().manualLabel);

  assert.deepEqual(labels, [
    'Aircraft Maintenance Manual',
    'Illustrated Parts Catalog',
    'Nondestructive Testing Manual',
    'Standard Practices Manual',
    'System Schematic Manual',
  ]);
});
