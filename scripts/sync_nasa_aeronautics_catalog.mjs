import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const SOURCE_PAGE_URL = 'https://www.nasa.gov/raven/';
const OUTPUT_URL = new URL('../3d-viewer/nasa-aeronautics-models.json', import.meta.url);
const SOURCE_MODELS = [
  {
    id: 'raven-v01-003',
    name: 'NASA RAVEN Full-Scale eVTOL',
    file: 'https://www.nasa.gov/wp-content/uploads/2026/06/raven-v01-003-release.glb',
    published: '2026-06-04',
    description: 'Full-scale Research Aircraft for eVTOL Enabling Technologies reference geometry.'
  },
  {
    id: 'raven-swft',
    name: 'NASA RAVEN-SWFT',
    file: 'https://www.nasa.gov/wp-content/uploads/2026/03/swft.glb',
    published: '2026-03-13',
    description: 'Subscale wind-tunnel and flight-test research aircraft reference geometry.'
  },
  {
    id: 'bede-bd-6-v03-004',
    name: 'Bede BD-6 Experimental Aircraft',
    file: 'https://www.nasa.gov/wp-content/uploads/2026/03/bd-6-v03-004.glb',
    published: '2026-03-06',
    description: 'NASA-published approximate BD-6 geometry used as the basis for RAVEN research.'
  }
];

function weightClass(sizeBytes) {
  if (sizeBytes <= 2 * 1024 * 1024) return 'light';
  if (sizeBytes <= 8 * 1024 * 1024) return 'medium';
  if (sizeBytes <= 25 * 1024 * 1024) return 'heavy';
  return 'very_heavy';
}

const models = [];
for (const definition of SOURCE_MODELS) {
  const response = await fetch(definition.file, { method: 'HEAD' });
  if (!response.ok) throw new Error(`NASA aeronautics GLB check failed (${response.status}): ${definition.file}`);
  const sizeBytes = Number(response.headers.get('content-length')) || 0;
  if (sizeBytes <= 20 || sizeBytes > 100 * 1024 * 1024) {
    throw new Error(`NASA aeronautics GLB is outside the viewer size boundary: ${definition.file}`);
  }
  models.push({
    id: `nasa-aeronautics:${definition.id}`,
    name: definition.name,
    collection: 'NASA Research Aircraft',
    file: definition.file,
    fileName: new URL(definition.file).pathname.split('/').at(-1),
    sourcePageUrl: SOURCE_PAGE_URL,
    sourceAuthority: 'NASA Aeronautics',
    sourceRevision: response.headers.get('etag')?.replaceAll('"', '') || definition.published,
    format: 'glb',
    sizeBytes,
    weightClass: weightClass(sizeBytes),
    provider: 'nasa-aeronautics',
    sourceFamilies: ['nasa'],
    type: 'aircraft_reference_model',
    revision: definition.published,
    operationalStatus: 'reference_asset',
    mappingStatus: 'unmapped',
    rights: 'NASA public-use reference geometry; source terms apply',
    description: definition.description
  });
}

const revision = createHash('sha256')
  .update(JSON.stringify(models.map(({ id, file, sourceRevision, sizeBytes }) => ({ id, file, sourceRevision, sizeBytes }))))
  .digest('hex');
const manifest = {
  schemaVersion: 1,
  source: {
    name: 'NASA Research Aircraft for eVTOL Enabling Technologies',
    pageUrl: SOURCE_PAGE_URL,
    revision,
    notice: 'NASA aeronautics reference geometry. Not approved maintenance data and not mapped to an aircraft configuration.'
  },
  modelCount: models.length,
  models
};

await writeFile(OUTPUT_URL, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${models.length} NASA aeronautics GLB records to ${OUTPUT_URL.pathname}`);
