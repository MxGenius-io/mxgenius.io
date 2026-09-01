import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const REPOSITORY = 'fgx/fgx-aircraft';
const BRANCH = 'gh-pages';
const OUTPUT_URL = new URL('../3d-viewer/flightgear-models.json', import.meta.url);
const SOURCE_MODELS = [
  { id: 'c172p', name: 'Cessna 172P Skyhawk', path: 'data/c172p/c172p.js' },
  { id: 'c182s', name: 'Cessna 182S Skylane', path: 'data/c182/c182s.js' },
  { id: 'beechcraft-staggerwing', name: 'Beechcraft Model 17 Staggerwing', path: 'data/Beechcraft-Staggerwing/model17.js' },
  { id: 'boeing-737-100', name: 'Boeing 737-100', path: 'data/737-100/737-100.js' },
  { id: 'boeing-777-200', name: 'Boeing 777-200', path: 'data/777/777-200.js' }
];

function weightClass(sizeBytes) {
  if (sizeBytes <= 2 * 1024 * 1024) return 'light';
  if (sizeBytes <= 8 * 1024 * 1024) return 'medium';
  if (sizeBytes <= 25 * 1024 * 1024) return 'heavy';
  return 'very_heavy';
}

const branchResponse = await fetch(`https://api.github.com/repos/${REPOSITORY}/branches/${BRANCH}`, {
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MXGenius-catalog-sync' }
});
if (!branchResponse.ok) throw new Error(`FlightGear catalog revision request failed (${branchResponse.status})`);
const branch = await branchResponse.json();
const revision = branch.commit?.sha;
if (!/^[0-9a-f]{40}$/.test(revision || '')) throw new Error('FlightGear catalog revision is invalid');

const models = [];
for (const definition of SOURCE_MODELS) {
  const encodedPath = definition.path.split('/').map(encodeURIComponent).join('/');
  const file = `https://raw.githubusercontent.com/${REPOSITORY}/${revision}/${encodedPath}`;
  const response = await fetch(file, { method: 'HEAD' });
  if (!response.ok) throw new Error(`FlightGear model check failed (${response.status}): ${definition.path}`);
  const sizeBytes = Number(response.headers.get('content-length')) || 0;
  if (sizeBytes <= 20 || sizeBytes > 25 * 1024 * 1024) {
    throw new Error(`FlightGear model is outside the simulation size boundary: ${definition.path}`);
  }
  models.push({
    id: `flightgear:${definition.id}`,
    name: definition.name,
    collection: 'FlightGear simulation aircraft',
    file,
    fileName: definition.path.split('/').at(-1),
    sourcePageUrl: `https://github.com/${REPOSITORY}/blob/${revision}/${encodedPath}`,
    sourceAuthority: 'FGx / FlightGear community',
    sourceRevision: revision,
    format: 'three-json-3.1',
    sizeBytes,
    weightClass: weightClass(sizeBytes),
    provider: 'flightgear',
    sourceFamilies: ['flightgear'],
    type: 'aircraft_simulation_model',
    revision: revision.slice(0, 12),
    operationalStatus: 'reference_asset',
    mappingStatus: 'unmapped',
    rights: 'GPL-2.0 collection; retain and review each aircraft notice before redistribution'
  });
}

const manifest = {
  schemaVersion: 1,
  source: {
    name: 'FGx FlightGear aircraft conversions',
    repository: REPOSITORY,
    repositoryUrl: `https://github.com/${REPOSITORY}`,
    branch: BRANCH,
    revision,
    notice: 'Legacy Three.js simulation geometry. Scale, completeness, and per-aircraft licensing vary; not approved maintenance data.'
  },
  manifestRevision: createHash('sha256')
    .update(JSON.stringify(models.map(({ id, file, sizeBytes }) => ({ id, file, sizeBytes }))))
    .digest('hex'),
  modelCount: models.length,
  models
};

await writeFile(OUTPUT_URL, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${models.length} FlightGear simulation records to ${OUTPUT_URL.pathname}`);
