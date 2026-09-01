import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const PROJECT_ID = 'openvas-0';
const COLLECTION_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/models`;
const SOURCE_URL = 'https://airshow.openvsp.org/';
const OUTPUT_URL = new URL('../3d-viewer/openvsp-models.json', import.meta.url);
const PAGE_SIZE = 300;
const MAX_MODELS = 1000;

function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

function boundedText(value, fallback, maxLength) {
  const text = String(value || '').trim();
  return (text || fallback).slice(0, maxLength);
}

function catalogLabel(value, fallback, maxLength) {
  const text = boundedText(value, fallback, maxLength)
    .replace(/[*_`#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const meaningfulCharacters = text.match(/[\p{L}\p{N}]/gu) || [];
  return meaningfulCharacters.length >= 2 ? text : fallback;
}

function weightClass(sizeBytes) {
  if (sizeBytes <= 2 * 1024 * 1024) return 'light';
  if (sizeBytes <= 8 * 1024 * 1024) return 'medium';
  if (sizeBytes <= 25 * 1024 * 1024) return 'heavy';
  return 'very_heavy';
}

const documents = [];
let pageToken = '';
do {
  const url = new URL(COLLECTION_URL);
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`OpenVSP Airshow catalog request failed (${response.status})`);
  const page = await response.json();
  documents.push(...(page.documents || []));
  pageToken = page.nextPageToken || '';
  if (documents.length > MAX_MODELS) throw new Error('OpenVSP Airshow catalog exceeded the bounded model limit');
} while (pageToken);

const models = documents.flatMap((document) => {
  const record = decodeFields(document.fields);
  const id = document.name?.split('/').at(-1);
  const file = record.newX3dUrl || record.x3dUrl;
  if (!id || !file) return [];
  const assetUrl = new URL(file);
  if (!['storage.googleapis.com', 'firebasestorage.googleapis.com'].includes(assetUrl.hostname)) return [];
  const sizeBytes = Math.max(1, Number(record.fileSize) || 1);
  const name = catalogLabel(record.name || record.displayName, `OpenVSP model ${id.slice(0, 8)}`, 160);
  const manufacturer = catalogLabel(record.manufacturer, 'Community aircraft', 100);
  const uploadedBy = catalogLabel(record.uploadedBy, 'Airshow contributor', 100);
  return [{
    id: `openvsp:${id}`,
    name,
    collection: `OpenVSP Airshow · ${manufacturer}`,
    file,
    fileName: `${id}.x3d`,
    sourcePageUrl: `${SOURCE_URL}vsp/${id}`,
    sourceAuthority: `OpenVSP Airshow · ${uploadedBy}`,
    sourceRevision: document.updateTime || document.createTime || record.date || 'unknown',
    format: 'x3d',
    sizeBytes,
    weightClass: weightClass(sizeBytes),
    provider: 'openvsp',
    sourceFamilies: ['openvsp'],
    type: 'aircraft_simulation_model',
    revision: document.updateTime || document.createTime || record.date || 'unknown',
    operationalStatus: 'reference_asset',
    mappingStatus: 'unmapped',
    rights: `Community-contributed model; Airshow license code ${record.license ?? 'unspecified'}; verify terms before redistribution`,
    sourceModelUrl: record.newVspUrl || record.vspUrl || null,
    sourceDescription: boundedText(record.description, 'No contributor description supplied', 500)
  }];
}).sort((left, right) => left.name.localeCompare(right.name));

const manifestRevision = createHash('sha256')
  .update(JSON.stringify(models.map(({ id, file, sourceRevision }) => ({ id, file, sourceRevision }))))
  .digest('hex');

const manifest = {
  schemaVersion: 1,
  source: {
    name: 'OpenVSP Airshow',
    pageUrl: SOURCE_URL,
    catalogUrl: COLLECTION_URL,
    projectId: PROJECT_ID,
    snapshotTime: new Date().toISOString(),
    notice: 'Community-contributed OpenVSP simulation geometry. Model quality, scale, applicability, and licensing vary.'
  },
  manifestRevision,
  modelCount: models.length,
  models
};

await writeFile(OUTPUT_URL, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${models.length} OpenVSP Airshow records to ${OUTPUT_URL.pathname}`);
