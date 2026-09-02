import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../3d-viewer/nasa-models.json', import.meta.url), 'utf8'));
const nasaAeronauticsManifest = JSON.parse(await readFile(new URL('../3d-viewer/nasa-aeronautics-models.json', import.meta.url), 'utf8'));
const smithsonianManifest = JSON.parse(await readFile(new URL('../3d-viewer/smithsonian-models.json', import.meta.url), 'utf8'));
const flightGearManifest = JSON.parse(await readFile(new URL('../3d-viewer/flightgear-models.json', import.meta.url), 'utf8'));
const openVspManifest = JSON.parse(await readFile(new URL('../3d-viewer/openvsp-models.json', import.meta.url), 'utf8'));
const viewer = await readFile(new URL('../3d-viewer/index.html', import.meta.url), 'utf8');
const syncScript = await readFile(new URL('../scripts/sync_nasa_3d_catalog.mjs', import.meta.url), 'utf8');
const nasaAeronauticsSyncScript = await readFile(new URL('../scripts/sync_nasa_aeronautics_catalog.mjs', import.meta.url), 'utf8');
const smithsonianSyncScript = await readFile(new URL('../scripts/sync_smithsonian_3d_catalog.mjs', import.meta.url), 'utf8');
const flightGearSyncScript = await readFile(new URL('../scripts/sync_flightgear_catalog.mjs', import.meta.url), 'utf8');
const openVspSyncScript = await readFile(new URL('../scripts/sync_openvsp_airshow_catalog.mjs', import.meta.url), 'utf8');

test('NASA catalog is pinned, bounded, unique, and reference-only', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.source.repository, 'nasa/NASA-3D-Resources');
  assert.match(manifest.source.revision, /^[0-9a-f]{40}$/);
  assert.equal(manifest.modelCount, manifest.models.length);
  assert.ok(manifest.models.length >= 250);

  const ids = new Set();
  for (const model of manifest.models) {
    assert.match(model.id, /^nasa:[0-9a-f]{40}$/);
    assert.equal(ids.has(model.id), false, `duplicate catalog id ${model.id}`);
    ids.add(model.id);
    assert.equal(model.provider, 'nasa');
    assert.equal(model.format, 'glb');
    assert.equal(model.operationalStatus, 'reference_asset');
    assert.equal(model.mappingStatus, 'unmapped');
    assert.ok(model.sizeBytes > 20 && model.sizeBytes <= 100 * 1024 * 1024);
    const assetUrl = new URL(model.file);
    assert.equal(assetUrl.protocol, 'https:');
    assert.equal(assetUrl.hostname, 'raw.githubusercontent.com');
    assert.match(assetUrl.pathname, /^\/nasa\/NASA-3D-Resources\/master\/3D%20Models\//);
    const sourceUrl = new URL(model.sourcePageUrl);
    assert.equal(sourceUrl.hostname, 'github.com');
    assert.match(sourceUrl.pathname, /^\/nasa\/NASA-3D-Resources\/blob\/master\/3D%20Models\//);
  }
});

test('NASA aeronautics catalog exposes direct bounded research-aircraft GLBs', () => {
  assert.equal(nasaAeronauticsManifest.schemaVersion, 1);
  assert.equal(nasaAeronauticsManifest.source.pageUrl, 'https://www.nasa.gov/raven/');
  assert.match(nasaAeronauticsManifest.source.revision, /^[0-9a-f]{64}$/);
  assert.equal(nasaAeronauticsManifest.modelCount, 3);
  assert.equal(nasaAeronauticsManifest.models.length, 3);

  const names = [];
  for (const model of nasaAeronauticsManifest.models) {
    names.push(model.name);
    assert.match(model.id, /^nasa-aeronautics:[a-z0-9-]+$/);
    assert.equal(model.provider, 'nasa-aeronautics');
    assert.deepEqual(model.sourceFamilies, ['nasa']);
    assert.equal(model.type, 'aircraft_reference_model');
    assert.equal(model.format, 'glb');
    assert.equal(model.operationalStatus, 'reference_asset');
    assert.equal(model.mappingStatus, 'unmapped');
    assert.ok(model.sizeBytes > 20 && model.sizeBytes <= 100 * 1024 * 1024);
    assert.equal(new URL(model.file).hostname, 'www.nasa.gov');
    assert.equal(model.sourcePageUrl, 'https://www.nasa.gov/raven/');
  }
  assert.deepEqual(names, [
    'NASA RAVEN Full-Scale eVTOL',
    'NASA RAVEN-SWFT',
    'Bede BD-6 Experimental Aircraft'
  ]);
});

test('FlightGear catalog exposes a small pinned simulation-only aircraft set', () => {
  assert.equal(flightGearManifest.schemaVersion, 1);
  assert.equal(flightGearManifest.source.repository, 'fgx/fgx-aircraft');
  assert.match(flightGearManifest.source.revision, /^[0-9a-f]{40}$/);
  assert.equal(flightGearManifest.modelCount, 5);
  assert.equal(flightGearManifest.models.length, 5);

  const ids = new Set();
  for (const model of flightGearManifest.models) {
    assert.match(model.id, /^flightgear:[a-z0-9-]+$/);
    assert.equal(ids.has(model.id), false, `duplicate catalog id ${model.id}`);
    ids.add(model.id);
    assert.equal(model.provider, 'flightgear');
    assert.equal(model.format, 'three-json-3.1');
    assert.equal(model.type, 'aircraft_simulation_model');
    assert.equal(model.operationalStatus, 'reference_asset');
    assert.equal(model.mappingStatus, 'unmapped');
    assert.ok(model.sizeBytes > 20 && model.sizeBytes <= 10 * 1024 * 1024);
    const assetUrl = new URL(model.file);
    assert.equal(assetUrl.protocol, 'https:');
    assert.equal(assetUrl.hostname, 'raw.githubusercontent.com');
    assert.match(assetUrl.pathname, new RegExp(`^/fgx/fgx-aircraft/${flightGearManifest.source.revision}/data/`));
  }
});

test('OpenVSP catalog exposes the real bounded Airshow community collection', () => {
  assert.equal(openVspManifest.schemaVersion, 1);
  assert.equal(openVspManifest.source.pageUrl, 'https://airshow.openvsp.org/');
  assert.equal(openVspManifest.source.projectId, 'openvas-0');
  assert.match(openVspManifest.manifestRevision, /^[0-9a-f]{64}$/);
  assert.equal(openVspManifest.modelCount, openVspManifest.models.length);
  assert.ok(openVspManifest.models.length >= 400 && openVspManifest.models.length <= 1000);

  const ids = new Set();
  for (const model of openVspManifest.models) {
    assert.match(model.id, /^openvsp:[A-Za-z0-9]+$/);
    assert.equal(ids.has(model.id), false, `duplicate catalog id ${model.id}`);
    ids.add(model.id);
    assert.equal(model.provider, 'openvsp');
    assert.deepEqual(model.sourceFamilies, ['openvsp']);
    assert.equal(model.format, 'x3d');
    assert.equal(model.type, 'aircraft_simulation_model');
    assert.equal(model.operationalStatus, 'reference_asset');
    assert.equal(model.mappingStatus, 'unmapped');
    assert.ok(model.sizeBytes > 0 && model.sizeBytes <= 100 * 1024 * 1024);
    assert.ok(['storage.googleapis.com', 'firebasestorage.googleapis.com'].includes(new URL(model.file).hostname));
    assert.match(model.sourcePageUrl, /^https:\/\/airshow\.openvsp\.org\/vsp\/[A-Za-z0-9]+$/);
    assert.match(model.rights, /verify terms before redistribution/);
  }
  assert.match(openVspManifest.models.map((model) => model.name).join(' '), /A-10 Thunderbolt II/);
  assert.match(openVspManifest.models.map((model) => model.name).join(' '), /Airbus Beluga XL/);
});

test('Smithsonian catalog exposes bounded Air and Space GLBs as CC0 reference geometry', () => {
  assert.equal(smithsonianManifest.schemaVersion, 1);
  assert.match(smithsonianManifest.source.apiUrl, /^https:\/\/3d-api\.si\.edu\/api\/v1\.0\/content\/file\/search/);
  assert.equal(smithsonianManifest.source.apiVersion, '1.0');
  assert.match(smithsonianManifest.source.revision, /^[0-9a-f]{64}$/);
  assert.equal(smithsonianManifest.modelCount, smithsonianManifest.models.length);
  assert.equal(smithsonianManifest.models.length, 7);

  const ids = new Set();
  for (const model of smithsonianManifest.models) {
    assert.match(model.id, /^smithsonian:[0-9a-f-]{36}$/);
    assert.equal(ids.has(model.id), false, `duplicate catalog id ${model.id}`);
    ids.add(model.id);
    assert.equal(model.provider, 'smithsonian');
    assert.equal(model.format, 'glb');
    assert.equal(model.operationalStatus, 'reference_asset');
    assert.equal(model.mappingStatus, 'unmapped');
    assert.equal(model.rights, 'CC0');
    assert.ok(model.sizeBytes > 20 && model.sizeBytes <= 100 * 1024 * 1024);
    assert.equal(new URL(model.file).hostname, '3d-api.si.edu');
    assert.equal(new URL(model.sourcePageUrl).hostname, '3d.si.edu');
  }

  const names = smithsonianManifest.models.map((model) => model.name).join(' ');
  assert.match(names, /1903 Wright Flyer/);
  assert.match(names, /Bell X-1/);
  assert.match(names, /Orbiter, Space Shuttle, OV-103, Discovery/);
});

test('viewer exposes one filtered model library without presenting reference geometry as an imported twin', () => {
  assert.match(viewer, /id="model-library-button"/);
  assert.match(viewer, /id="viewer-tools-menu"/);
  assert.match(viewer, /<summary>View tools<\/summary>/);
  assert.match(viewer, /id="model-library-provider"/);
  assert.match(viewer, /fetch\(definition\.url\)/);
  assert.match(viewer, /url: '\.\/nasa-aeronautics-models\.json'/);
  assert.match(viewer, /url: '\.\/nasa-models\.json'/);
  assert.match(viewer, /url: '\.\/smithsonian-models\.json'/);
  assert.match(viewer, /url: '\.\/flightgear-models\.json'/);
  assert.match(viewer, /url: '\.\/openvsp-models\.json'/);
  assert.match(viewer, /<option value="nasa">NASA<\/option>/);
  assert.match(viewer, /<option value="openvsp">OpenVSP<\/option>/);
  assert.match(viewer, /<option value="flightgear">FlightGear Simulation<\/option>/);
  assert.match(viewer, /function matchesReferenceProvider\(entry, provider\)/);
  assert.match(viewer, /format === 'three-json-3\.1'/);
  assert.match(viewer, /function legacyThreeJsonToObject\(payload/);
  assert.match(viewer, /function loadLegacyThreeJson\(url, entry\)/);
  assert.match(viewer, /format === 'x3d'/);
  assert.match(viewer, /function x3dToObject\(xmlText/);
  assert.match(viewer, /function loadX3D\(url, entry\)/);
  assert.match(viewer, /viewerToolsMenu\.open = false/);
  assert.match(viewer, /data-part-selected="true"/);
  assert.match(viewer, /reference_asset/);
  assert.match(viewer, /entry\.sourceAuthority \|\| 'Public source'/);
  assert.match(viewer, /it does not import it into the tenant catalog/);
  assert.match(viewer, /function viewerSession\(\)/);
  assert.match(viewer, /globalThis\.parent\.MXGENIUS_CONFIG\?\.getSession/);
  assert.doesNotMatch(viewer, /digitalTwin\.uploadModel\(\{[\s\S]{0,300}provider:\s*['"](?:nasa|smithsonian)/);
});

test('NASA aeronautics synchronizer is restricted to the curated official GLBs', () => {
  assert.match(nasaAeronauticsSyncScript, /const SOURCE_PAGE_URL = 'https:\/\/www\.nasa\.gov\/raven\/'/);
  assert.match(nasaAeronauticsSyncScript, /https:\/\/www\.nasa\.gov\/wp-content\/uploads\/2026\/06\/raven-v01-003-release\.glb/);
  assert.match(nasaAeronauticsSyncScript, /type: 'aircraft_reference_model'/);
  assert.match(nasaAeronauticsSyncScript, /operationalStatus: 'reference_asset'/);
  assert.doesNotMatch(nasaAeronauticsSyncScript, /process\.argv|sourceUrl|importUrl/);
});

test('NASA catalog synchronizer uses one official repository and emits no arbitrary import endpoint', () => {
  assert.match(syncScript, /const REPOSITORY = 'nasa\/NASA-3D-Resources'/);
  assert.match(syncScript, /entry\.path\.startsWith\('3D Models\/'\)/);
  assert.match(syncScript, /operationalStatus: 'reference_asset'/);
  assert.doesNotMatch(syncScript, /process\.argv|sourceUrl|importUrl/);
});

test('Smithsonian synchronizer is restricted to official NASM App3D GLBs', () => {
  assert.match(smithsonianSyncScript, /owning_unit=NASM&file_type=glb&rows=1000/);
  assert.match(smithsonianSyncScript, /row\.content\?\.quality === 'AR'/);
  assert.match(smithsonianSyncScript, /row\.content\?\.usage === 'App3D'/);
  assert.match(smithsonianSyncScript, /operationalStatus: 'reference_asset'/);
  assert.match(smithsonianSyncScript, /rights: 'CC0'/);
  assert.doesNotMatch(smithsonianSyncScript, /process\.argv|sourceUrl|importUrl/);
});

test('FlightGear synchronizer is restricted to its curated pinned aircraft set', () => {
  assert.match(flightGearSyncScript, /const REPOSITORY = 'fgx\/fgx-aircraft'/);
  assert.match(flightGearSyncScript, /const SOURCE_MODELS = \[/);
  assert.match(flightGearSyncScript, /format: 'three-json-3\.1'/);
  assert.match(flightGearSyncScript, /operationalStatus: 'reference_asset'/);
  assert.match(flightGearSyncScript, /mappingStatus: 'unmapped'/);
  assert.doesNotMatch(flightGearSyncScript, /process\.argv|sourceUrl|importUrl/);
});

test('OpenVSP synchronizer reads only the public bounded Airshow catalog and trusted asset hosts', () => {
  assert.match(openVspSyncScript, /const PROJECT_ID = 'openvas-0'/);
  assert.match(openVspSyncScript, /documents\/models/);
  assert.match(openVspSyncScript, /const MAX_MODELS = 1000/);
  assert.match(openVspSyncScript, /storage\.googleapis\.com/);
  assert.match(openVspSyncScript, /firebasestorage\.googleapis\.com/);
  assert.match(openVspSyncScript, /format: 'x3d'/);
  assert.match(openVspSyncScript, /operationalStatus: 'reference_asset'/);
  assert.doesNotMatch(openVspSyncScript, /process\.argv|sourceUrl|importUrl/);
});
