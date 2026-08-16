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
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
const reconciliation = await readFile(reconciliationUrl, 'utf8');
const coreDockerfile = await readFile(coreDockerfileUrl, 'utf8');
const manualAdapter = await readFile(manualAdapterUrl, 'utf8');
const coreMain = await readFile(coreMainUrl, 'utf8');
const coreHttp = await readFile(coreHttpUrl, 'utf8');
const sha256 = /^sha256:[a-f0-9]{64}$/;

test('authoritative manual pack freezes exactly five classified CL350 manuals', () => {
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

test('the core image includes the frozen manifest in its Rust build context', () => {
  assert.match(coreDockerfile, /^COPY config \.\/config$/m);
});

test('production mounts v2 and MiniLM as one fail-closed runtime contract', () => {
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
  assert.doesNotMatch(manualAdapter, /std::env::var\("OPENAI_API_KEY"\)/);
  assert.match(manualAdapter, /pub async fn validate_contract/);
  assert.match(coreMain, /adapter\s*\.validate_contract\(\)\s*\.await/);
  assert.match(coreHttp, /manual\.health != AdapterHealth::Healthy/);
});
