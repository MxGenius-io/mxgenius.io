import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifestUrl = new URL(
  '../services/mcp/config/authoritative-manual-pack-v1.json',
  import.meta.url
);
const reconciliationUrl = new URL(
  '../services/mcp/scripts/reconcile_authoritative_manual_pack.py',
  import.meta.url
);
const ingestionUrl = new URL(
  '../services/mcp/scripts/ingest_minilm_manual_corpus.py',
  import.meta.url
);
const coreDockerfileUrl = new URL('../services/mcp/Dockerfile', import.meta.url);
const manualAdapterUrl = new URL(
  '../services/mcp/server/src/adapters/manual.rs',
  import.meta.url
);
const coreMainUrl = new URL('../services/mcp/server/src/main.rs', import.meta.url);
const coreHttpUrl = new URL(
  '../services/mcp/server/src/transport/http.rs',
  import.meta.url
);
const manualLibraryUrl = new URL(
  '../services/mcp/server/src/application/manual_library.rs',
  import.meta.url
);
const releaseCompilerUrl = new URL(
  '../services/mcp/server/src/application/corpus_release.rs',
  import.meta.url
);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
const reconciliation = await readFile(reconciliationUrl, 'utf8');
const ingestion = await readFile(ingestionUrl, 'utf8');
const coreDockerfile = await readFile(coreDockerfileUrl, 'utf8');
const manualAdapter = await readFile(manualAdapterUrl, 'utf8');
const coreMain = await readFile(coreMainUrl, 'utf8');
const coreHttp = await readFile(coreHttpUrl, 'utf8');
const manualLibrary = await readFile(manualLibraryUrl, 'utf8');
const releaseCompiler = await readFile(releaseCompilerUrl, 'utf8');
const sha256 = /^sha256:[a-f0-9]{64}$/;

test('the retired pilot manifest remains an auditable five-manual CL350 fixture', () => {
  assert.equal(manifest.release_state, 'frozen');
  assert.equal(manifest.integrity.logical_manual_count, 5);
  assert.deepEqual(
    manifest.manuals.map((manual) => manual.manual_type),
    ['AMM', 'IPC', 'SPM', 'NDT', 'SSM']
  );
  assert.ok(manifest.manuals.every((manual) => (
    manual.aircraft_models.length === 1 && manual.aircraft_models[0] === 'CL350'
  )));
  assert.equal(
    manifest.manuals.reduce((total, manual) => total + manual.chunk_count, 0),
    manifest.integrity.chunk_count
  );
  assert.equal(
    new Set(manifest.manuals.flatMap((manual) => manual.document_ids)).size,
    manifest.integrity.search_document_count
  );
  assert.match(manifest.integrity.content_set_hash, sha256);
  assert.ok(manifest.manuals.every((manual) => sha256.test(manual.content_set_hash)));
});

test('manual currency remains explicitly unverified until source metadata exists', () => {
  assert.equal(manifest.currency_policy.state, 'unverified');
  assert.ok(manifest.manuals.every((manual) => manual.revision === null));
  assert.ok(manifest.manuals.every((manual) => manual.effective_date === null));
  assert.ok(manifest.manuals.every((manual) => manual.currency_state === 'unverified'));
});

test('manual image references are content-addressed and remain inside the controlled prefix', () => {
  const controlledPrefix = 'azure-blob://documents/manual-assets/legacy-rag/v2/';
  const expectedAssetCount = manifest.manuals.reduce(
    (total, manual) => total + manual.asset_reference_count,
    0
  );
  assert.equal(manifest.assets.length, expectedAssetCount);
  manifest.assets.forEach((asset) => {
    assert.equal(asset.media_type, 'image/png');
    assert.match(asset.content_hash, sha256);
    assert.ok(asset.source_reference.startsWith(controlledPrefix));
    const filenameHash = asset.source_reference.slice(controlledPrefix.length, -'.png'.length);
    assert.equal(asset.content_hash, `sha256:${filenameHash}`);
  });
});

test('the pilot figures retain their audit register while production lookup is catalog-driven', () => {
  assert.equal(manifest.assets.length, 5);
  assert.equal(new Set(manifest.assets.map((asset) => asset.register_id)).size, 5);
  assert.equal(new Set(manifest.assets.map((asset) => asset.source_reference)).size, 5);
  assert.ok(manifest.assets.every((asset) => (
    asset.record_id
    && asset.document_id
    && asset.title
    && asset.ata
    && Number.isInteger(asset.page)
    && asset.asset_id
    && asset.caption
    && asset.description
    && Array.isArray(asset.task_numbers)
    && Array.isArray(asset.keywords)
    && asset.keywords.length > 0
  )));
  const fdrRemoval = manifest.assets.find((asset) => (
    asset.task_numbers.includes('31-31-01-000-801')
  ));
  assert.equal(fdrRemoval?.register_id, 'IMG-CL350-AMM-31-FDR-REMOVAL');
  assert.match(coreHttp, /lookup_registered_image/);
  assert.match(coreHttp, /"catalog_image_register"/);
  assert.match(coreHttp, /"vector_search_skipped": registered_image\.is_some\(\)/);
  assert.match(coreHttp, /"semantic_requests_made": if registered_image\.is_some\(\) \{ 0 \} else \{ 1 \}/);
});

test('supporting families are explicitly excluded instead of silently entering the starter pack', () => {
  assert.equal(manifest.excluded_sources.policy, 'excluded_from_starter_pack');
  assert.equal(
    manifest.excluded_sources.families.reduce((total, family) => total + family.chunk_count, 0),
    manifest.excluded_sources.chunk_count
  );
  assert.ok(manifest.excluded_sources.families.every((family) => family.name && family.chunk_count > 0));
});

test('the reconciliation utility is read-only against Azure', () => {
  assert.match(reconciliation, /Compare the frozen manual pack with Azure AI Search without mutating Azure/);
  assert.doesNotMatch(reconciliation, /mergeOrUpload|storage["',\s]+blob["',\s]+upload/);
  assert.match(reconciliation, /"POST"[\s\S]*\/docs\/search/);
  assert.match(reconciliation, /"GET"[\s\S]*\/indexes\//);
});

test('the core image retains migration configuration for reconciliation tools', () => {
  assert.match(coreDockerfile, /^COPY config \.\/config$/m);
});

test('production manual retrieval is runtime-configured without embedding a pilot aircraft list', () => {
  for (const requiredSetting of [
    'AZURE_SEARCH_INDEX',
    'MXGENIUS_MANUAL_PACK_ID',
    'MXGENIUS_EMBEDDINGS_ENDPOINT',
    'MXGENIUS_EMBEDDINGS_MODEL',
    'MXGENIUS_EMBEDDINGS_AUTH',
    'MXGENIUS_EMBEDDINGS_API_KEY'
  ]) {
    assert.match(manualAdapter, new RegExp(`required_env\\("${requiredSetting}"\\)`));
  }
  assert.match(manualAdapter, /optional_positive_usize\(\s*"MXGENIUS_EMBEDDINGS_DIMENSIONS"/);
  assert.doesNotMatch(manualAdapter, /std::env::var\("OPENAI_API_KEY"\)/);
  assert.doesNotMatch(manualAdapter, /authoritative-manual-pack-v1\.json/);
  assert.doesNotMatch(manualLibrary, /MANUAL_PACK_MANIFEST|ManualPackManifest/);
  assert.match(manualLibrary, /facets": \["aircraft_model,count:1000"\]/);
  assert.match(manualLibrary, /release_manual_catalog\(&hits\)/);
  assert.match(coreHttp, /export_drive_for_aircraft\(&pack\.equipment_family\)/);
  assert.match(releaseCompiler, /EDGE_DRIVE_PROFILE/);
  assert.match(releaseCompiler, /MODEL_CONTEXT_PROFILE/);
  assert.match(coreHttp, /compile_release_manifest\(/);
  assert.match(manualAdapter, /pub async fn validate_contract/);
  assert.match(coreMain, /adapter\s*\.validate_contract\(\)\s*\.await/);
  assert.match(coreHttp, /manual\.health != AdapterHealth::Healthy/);
});

test('v3 promotion deduplicates linked images and never copies source PDFs', () => {
  assert.match(ingestion, /default="manuals-catalog-v3"/);
  assert.match(ingestion, /def build_asset_catalog\(/);
  assert.match(ingestion, /ThreadPoolExecutor/);
  assert.match(ingestion, /manual-assets\/legacy-rag\/v3\//);
  assert.doesNotMatch(ingestion, /\.pdf["']/i);
});

test('large diagram registers stay retrievable without entering the Search term index', () => {
  assert.match(ingestion, /"searchable": False,[\s\S]*"filterable": False,[\s\S]*"retrievable": True,[\s\S]*"sortable": False,[\s\S]*"facetable": False/);
  assert.match(ingestion, /field\("assets_json", "Edm\.String"\)/);
  assert.doesNotMatch(
    ingestion,
    /field\("assets_json", "Edm\.String",[^\n]*(?:searchable|filterable|sortable|facetable)=True/
  );
  assert.match(ingestion, /retrievable=False,[\s\S]*dimensions=VECTOR_DIMENSIONS/);
});

test('canonical source chunk collisions receive stable shard-scoped Search keys', () => {
  assert.match(ingestion, /def build_chunk_id_counts\(/);
  assert.match(ingestion, /record_id for record_id, count in chunk_id_counts\.items\(\) if count > 1/);
  assert.match(ingestion, /def search_record_id\(/);
  assert.match(ingestion, /sha256_bytes\(shard_id\.encode\(\)\)/);
  assert.match(ingestion, /--repair-collisions/);
  assert.match(ingestion, /"@search\.action": "delete"/);
});
