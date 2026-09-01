import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const API_URL = 'https://3d-api.si.edu/api/v1.0/content/file/search?owning_unit=NASM&file_type=glb&rows=1000';
const OUTPUT_URL = new URL('../3d-viewer/smithsonian-models.json', import.meta.url);
const OPEN_ACCESS_URL = 'https://www.si.edu/openaccess';
const API_DOCS_URL = 'https://3d-api.si.edu/api-docs/';

function slugify(value) {
  return String(value || 'model')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function modelUuid(modelUrl) {
  return String(modelUrl || '').replace(/^3d_package:/, '');
}

function normalizedAssetUrl(row) {
  const modelUrl = row.content.model_url;
  const uri = String(row.content.uri || '');
  const fileName = decodeURIComponent(uri.split('/').at(-1));
  return `https://3d-api.si.edu/content/document/${modelUrl}/${encodeURIComponent(fileName)}`;
}

function variantName(title, assetUrl, duplicateTitleCount) {
  if (duplicateTitleCount <= 1) return title;
  const file = decodeURIComponent(new URL(assetUrl).pathname.split('/').at(-1)).toLowerCase();
  if (file.includes('interior')) return `${title} — Interior`;
  if (file.includes('exterior') || file.includes('multi-mesh')) return `${title} — Exterior`;
  if (file.includes('combined')) return `${title} — Combined`;
  return `${title} — ${duplicateTitleCount}`;
}

function weightClass(sizeBytes) {
  if (sizeBytes <= 2 * 1024 * 1024) return 'light';
  if (sizeBytes <= 8 * 1024 * 1024) return 'medium';
  if (sizeBytes <= 25 * 1024 * 1024) return 'heavy';
  return 'very_heavy';
}

const response = await fetch(API_URL, { headers: { Accept: 'application/json' } });
if (!response.ok) throw new Error(`Smithsonian catalog request failed (${response.status})`);
const payload = await response.json();
const candidates = (payload.rows || []).filter((row) => row.content?.quality === 'AR'
  && row.content?.usage === 'App3D'
  && row.content?.file_type === 'glb'
  && row.content?.model_url
  && row.content?.uri);

const selectedByModel = new Map();
for (const row of candidates) {
  const key = row.content.model_url;
  if (!selectedByModel.has(key)) selectedByModel.set(key, row);
}
if (!selectedByModel.size) throw new Error('Smithsonian API returned no NASM App3D GLB assets');

const titleCounts = new Map();
for (const row of selectedByModel.values()) {
  titleCounts.set(row.title, (titleCounts.get(row.title) || 0) + 1);
}

const models = [];
for (const row of selectedByModel.values()) {
  const assetUrl = normalizedAssetUrl(row);
  const assetResponse = await fetch(assetUrl, { method: 'HEAD' });
  if (!assetResponse.ok) throw new Error(`Smithsonian GLB check failed (${assetResponse.status}): ${assetUrl}`);
  const sizeBytes = Number(assetResponse.headers.get('content-length')) || 0;
  const uuid = modelUuid(row.content.model_url);
  const title = variantName(row.title, assetUrl, titleCounts.get(row.title));
  const fileName = decodeURIComponent(new URL(assetUrl).pathname.split('/').at(-1));
  const sourcePageUrl = `https://3d.si.edu/object/3d/${encodeURIComponent(`${slugify(row.title)}:${uuid}`)}`;
  models.push({
    id: `smithsonian:${uuid}`,
    name: title,
    collection: 'National Air and Space Museum',
    file: assetUrl,
    fileName,
    sourcePageUrl,
    sourceAuthority: 'Smithsonian Institution',
    sourceRevision: assetResponse.headers.get('etag')?.replaceAll('"', '') || uuid,
    format: 'glb',
    sizeBytes,
    weightClass: weightClass(sizeBytes),
    provider: 'smithsonian',
    type: /wright|bell x-1|orbiter|aircraft/i.test(row.title) ? 'aircraft_reference_model' : 'aerospace_reference_model',
    revision: 'Smithsonian 3D API 1.0',
    operationalStatus: 'reference_asset',
    mappingStatus: 'unmapped',
    quality: row.content.quality,
    usage: row.content.usage,
    dracoCompressed: Boolean(row.content.draco_compressed),
    rights: 'CC0'
  });
}
models.sort((left, right) => left.name.localeCompare(right.name));

const revision = createHash('sha256')
  .update(JSON.stringify(models.map(({ id, file, sourceRevision, sizeBytes }) => ({ id, file, sourceRevision, sizeBytes }))))
  .digest('hex');
const manifest = {
  schemaVersion: 1,
  source: {
    name: 'Smithsonian 3D — National Air and Space Museum',
    apiUrl: API_URL,
    apiDocsUrl: API_DOCS_URL,
    repositoryUrl: 'https://3d.si.edu/explore/museum/air-and-space-museum',
    usageUrl: OPEN_ACCESS_URL,
    apiVersion: '1.0',
    revision,
    notice: 'Smithsonian CC0 reference geometry. Not approved maintenance data and not mapped to an aircraft configuration.'
  },
  modelCount: models.length,
  models
};

await writeFile(OUTPUT_URL, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${models.length} Smithsonian NASM GLB records to ${OUTPUT_URL.pathname}`);
