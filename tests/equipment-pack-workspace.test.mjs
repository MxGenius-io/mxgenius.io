import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../equipment-pack-workspace.js', import.meta.url), 'utf8');
const fullCatalog = JSON.parse(await readFile(new URL('../manual-catalog.json', import.meta.url), 'utf8'));

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
  const operationsCenter = await readFile(new URL('../operations-center.html', import.meta.url), 'utf8');
  assert.match(client, /function archiveEquipmentPack/);
  assert.match(client, /method: 'DELETE'/);
  assert.match(source, /window\.confirm\(`Remove \"\$\{pack\.name\}\" from Equipment Drives\?/);
  assert.match(source, /client\.archive\(pack\.id, session\)/);
  assert.match(operationsCenter, /id="settingsPackArchive"[^>]*disabled>Remove selected drive/);
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

test('aircraft library picker accepts the complete grouped catalog contract', () => {
  const payload = {
    schemaVersion: 1,
    aircraft: [
      { id: 'bombardier_cl350', manufacturer: 'Bombardier', aircraft: 'CL350', manualCount: 42, chapterCount: 770 },
      { id: 'dassault_falcon_7x', manufacturer: 'Dassault', aircraft: 'Falcon 7X', manualCount: 734, chapterCount: 5074 },
      { id: 'gulfstream_g650', manufacturer: 'Gulfstream', aircraft: 'G650', manualCount: 10, chapterCount: 5499 },
      { id: 'textron_beech_king_air_200_series', manufacturer: 'Textron/Beech', aircraft: 'KING AIR 200 SERIES', manualCount: 13, chapterCount: 243 },
    ],
  };

  assert.deepEqual(JSON.parse(JSON.stringify(workspace().aircraftCatalog(payload))), payload.aircraft);
  assert.throws(
    () => workspace().aircraftCatalog({ schemaVersion: 1, aircraft: [payload.aircraft[0], payload.aircraft[0]] }),
    /catalog is invalid/,
  );
});

test('aircraft library labels present four readable source libraries', () => {
  const equipmentPacks = workspace();
  assert.equal(equipmentPacks.aircraftLibraryLabel('Bombardier'), 'Bombardier');
  assert.equal(equipmentPacks.aircraftLibraryLabel('Dassault'), 'Dassault');
  assert.equal(equipmentPacks.aircraftLibraryLabel('Gulfstream'), 'Gulfstream');
  assert.equal(equipmentPacks.aircraftLibraryLabel('Textron/Beech'), 'Textron Aviation');
  assert.equal(equipmentPacks.aircraftLibraryLabel('Textron/Cessna'), 'Textron Aviation');
  assert.equal(equipmentPacks.aircraftLibraryLabel('Textron/Hawker'), 'Textron Aviation');
  assert.equal(equipmentPacks.aircraftOptionLabel({
    manufacturer: 'Textron/Cessna', aircraft: 'CE750 SN 0501-On'
  }), 'Cessna · CE750 SN 0501-On');
  assert.equal(equipmentPacks.aircraftOptionLabel({
    manufacturer: 'Dassault', aircraft: 'Falcon 8X'
  }), 'Falcon 8X');
});

test('drive labels suppress repeated aircraft scope without hiding useful scope', () => {
  const equipmentPacks = workspace();
  assert.equal(equipmentPacks.driveLabel({
    name: 'CL350 Manuals', equipmentFamily: 'Bombardier CL350'
  }), 'CL350 Manuals');
  assert.equal(equipmentPacks.driveLabel({
    name: 'Falcon 8X Manuals', equipmentFamily: 'Falcon 8X'
  }), 'Falcon 8X Manuals');
  assert.equal(equipmentPacks.driveLabel({
    name: 'Maintenance references', equipmentFamily: 'G650'
  }), 'Maintenance references · G650');
});

test('frozen aircraft library catalog carries every prepared display-index family', () => {
  const entries = workspace().aircraftCatalog(fullCatalog);
  assert.equal(entries.length, 91);
  assert.deepEqual([...new Set(entries.map((entry) => entry.manufacturer))], [
    'Bombardier',
    'Dassault',
    'Gulfstream',
    'Textron/Beech',
    'Textron/Cessna',
    'Textron/Hawker',
  ]);
  assert.equal(entries.reduce((total, entry) => total + entry.manualCount, 0), 10078);
  assert.equal(entries.reduce((total, entry) => total + entry.chapterCount, 0), 111930);
});
