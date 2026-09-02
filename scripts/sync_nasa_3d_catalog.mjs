import { writeFile } from 'node:fs/promises';

const REPOSITORY = 'nasa/NASA-3D-Resources';
const BRANCH = 'master';
const TREE_URL = `https://api.github.com/repos/${REPOSITORY}/git/trees/${BRANCH}?recursive=1`;
const OUTPUT_URL = new URL('../3d-viewer/nasa-models.json', import.meta.url);
const USAGE_URL = 'https://www.nasa.gov/nasa-brand-center/images-and-media/';

function encodedPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function weightClass(sizeBytes) {
  if (sizeBytes <= 2 * 1024 * 1024) return 'light';
  if (sizeBytes <= 8 * 1024 * 1024) return 'medium';
  if (sizeBytes <= 25 * 1024 * 1024) return 'heavy';
  return 'very_heavy';
}

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'mxgenius-nasa-catalog-sync',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {})
};
const response = await fetch(TREE_URL, { headers });
if (!response.ok) throw new Error(`NASA catalog request failed (${response.status})`);
const tree = await response.json();
if (tree.truncated) throw new Error('NASA catalog response was truncated');

const models = tree.tree
  .filter((entry) => entry.type === 'blob'
    && entry.path.startsWith('3D Models/')
    && entry.path.toLowerCase().endsWith('.glb'))
  .map((entry) => {
    const pathParts = entry.path.split('/');
    const fileName = pathParts.at(-1);
    const collection = pathParts.at(-2);
    const name = fileName.replace(/\.glb$/i, '');
    const path = encodedPath(entry.path);
    return {
      id: `nasa:${entry.sha}`,
      name,
      collection,
      file: `https://raw.githubusercontent.com/${REPOSITORY}/${BRANCH}/${path}`,
      sourcePageUrl: `https://github.com/${REPOSITORY}/blob/${BRANCH}/${path}`,
      sourceAuthority: 'NASA',
      sourceRevision: entry.sha,
      format: 'glb',
      sizeBytes: Number(entry.size) || 0,
      weightClass: weightClass(Number(entry.size) || 0),
      provider: 'nasa',
      type: 'open_reference_model',
      revision: entry.sha.slice(0, 12),
      operationalStatus: 'reference_asset',
      mappingStatus: 'unmapped'
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name));

const manifest = {
  schemaVersion: 1,
  source: {
    name: 'NASA 3D Resources',
    repository: REPOSITORY,
    repositoryUrl: `https://github.com/${REPOSITORY}`,
    branch: BRANCH,
    revision: tree.sha,
    usageUrl: USAGE_URL,
    notice: 'NASA reference geometry. Not approved maintenance data and not mapped to an aircraft configuration.'
  },
  modelCount: models.length,
  models
};

await writeFile(OUTPUT_URL, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${models.length} NASA GLB records to ${OUTPUT_URL.pathname}`);
