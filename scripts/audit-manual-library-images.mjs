import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

function option(name, fallback = '') {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function rootLibrary(manufacturer) {
  return manufacturer.startsWith('Textron/') ? 'Textron' : manufacturer;
}

function increment(summary, key, amount = 1) {
  summary[key] = (summary[key] || 0) + amount;
}

function sortedObject(map) {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function addAircraftSummary(targetMap, key, aircraftRecord) {
  const current = targetMap.get(key) || {
    aircraft: 0,
    manuals: 0,
    manualsWithImages: 0,
    manualsWithoutImages: 0,
    chapters: 0,
    chaptersWithImages: 0,
    imageReferences: 0,
    missingImageFiles: 0,
    emptyImageFiles: 0
  };
  current.aircraft += 1;
  current.manuals += aircraftRecord.manuals;
  current.manualsWithImages += aircraftRecord.manualsWithImages;
  current.manualsWithoutImages += aircraftRecord.manuals - aircraftRecord.manualsWithImages;
  current.chapters += aircraftRecord.chapters;
  current.chaptersWithImages += aircraftRecord.chaptersWithImages;
  current.imageReferences += aircraftRecord.imageReferences;
  current.missingImageFiles += aircraftRecord.missingImageFiles;
  current.emptyImageFiles += aircraftRecord.emptyImageFiles;
  targetMap.set(key, current);
}

const dataRoot = resolve(option('root', process.env.MXGENIUS_DATA_ROOT || 'D:\\Data\\mxgenius'));
const displayRoot = resolve(option('display-root', join(dataRoot, 'display_index')));
const ingestRoot = resolve(option('ingest-root', join(dataRoot, 'ingest_dumps')));
const outputPath = resolve(option('output', 'test-results/manual-library-image-audit.json'));

const catalog = JSON.parse(await readFile(join(displayRoot, 'catalog.json'), 'utf8'));
if (!Array.isArray(catalog)) throw new Error('The display catalog must be an array.');
const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
const files = (await readdir(displayRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'catalog.json')
  .map((entry) => entry.name)
  .sort();

const manuals = [];
const aircraft = [];
const missingImageReferences = new Map();
const emptyImageReferences = new Map();
const librarySummary = new Map();
const manufacturerSummary = new Map();
let totalChapters = 0;
let totalImageReferences = 0;

for (const file of files) {
  const id = file.slice(0, -'.json'.length);
  const payload = JSON.parse(await readFile(join(displayRoot, file), 'utf8'));
  const catalogEntry = catalogById.get(id);
  if (!catalogEntry) throw new Error(`Display index ${file} has no catalog entry.`);
  if (catalogEntry.manufacturer !== payload.manufacturer || catalogEntry.aircraft !== payload.aircraft) {
    throw new Error(`Display index ${file} does not match its catalog identity.`);
  }

  const aircraftRecord = {
    id,
    manufacturer: payload.manufacturer,
    aircraft: payload.aircraft,
    manuals: 0,
    manualsWithImages: 0,
    chapters: 0,
    chaptersWithImages: 0,
    imageReferences: 0,
    missingImageFiles: 0,
    emptyImageFiles: 0
  };

  for (const [manualName, chapterMap] of Object.entries(payload.manuals || {})) {
    const chapters = Object.values(chapterMap || {});
    const imageReferences = new Set();
    let chaptersWithImages = 0;
    for (const chapter of chapters) {
      const images = Array.isArray(chapter?.images) ? chapter.images.filter(Boolean) : [];
      if (images.length) chaptersWithImages += 1;
      for (const reference of images) imageReferences.add(String(reference));
    }

    let missingImageFiles = 0;
    let emptyImageFiles = 0;
    for (const reference of imageReferences) {
      const localPath = join(ingestRoot, ...reference.replaceAll('\\', '/').split('/'));
      if (!existsSync(localPath)) {
        missingImageFiles += 1;
        increment(missingImageReferences, reference);
      } else if (statSync(localPath).size === 0) {
        emptyImageFiles += 1;
        increment(emptyImageReferences, reference);
      }
    }

    const manual = {
      manufacturer: payload.manufacturer,
      library: rootLibrary(payload.manufacturer),
      aircraft: payload.aircraft,
      manual: manualName,
      chapters: chapters.length,
      chaptersWithImages,
      imageReferences: imageReferences.size,
      missingImageFiles,
      emptyImageFiles
    };
    manuals.push(manual);
    aircraftRecord.manuals += 1;
    aircraftRecord.manualsWithImages += imageReferences.size > 0 ? 1 : 0;
    aircraftRecord.chapters += chapters.length;
    aircraftRecord.chaptersWithImages += chaptersWithImages;
    aircraftRecord.imageReferences += imageReferences.size;
    aircraftRecord.missingImageFiles += missingImageFiles;
    aircraftRecord.emptyImageFiles += emptyImageFiles;
    totalChapters += chapters.length;
    totalImageReferences += imageReferences.size;
  }

  if (aircraftRecord.manuals !== catalogEntry.manuals
    || aircraftRecord.chapters !== catalogEntry.chapters) {
    throw new Error(
      `${file} reports ${aircraftRecord.manuals} manuals/${aircraftRecord.chapters} chapters; `
      + `catalog expects ${catalogEntry.manuals}/${catalogEntry.chapters}.`
    );
  }
  aircraft.push(aircraftRecord);

  addAircraftSummary(librarySummary, rootLibrary(payload.manufacturer), aircraftRecord);
  addAircraftSummary(manufacturerSummary, payload.manufacturer, aircraftRecord);
}

const manualsWithoutImages = manuals.filter((manual) => manual.imageReferences === 0);
const manualsWithBrokenImages = manuals.filter(
  (manual) => manual.missingImageFiles > 0 || manual.emptyImageFiles > 0
);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: { dataRoot, displayRoot, ingestRoot },
  totals: {
    aircraft: aircraft.length,
    manuals: manuals.length,
    manualsWithImages: manuals.length - manualsWithoutImages.length,
    manualsWithoutImages: manualsWithoutImages.length,
    chapters: totalChapters,
    imageReferences: totalImageReferences,
    missingImageFiles: missingImageReferences.size,
    emptyImageFiles: emptyImageReferences.size
  },
  libraries: sortedObject(librarySummary),
  manufacturers: sortedObject(manufacturerSummary),
  aircraft,
  manuals,
  gaps: {
    manualsWithoutImages,
    manualsWithBrokenImages,
    missingImageReferences: sortedObject(missingImageReferences),
    emptyImageReferences: sortedObject(emptyImageReferences)
  }
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Manual image audit: ${aircraft.length} aircraft, ${manuals.length} manuals, ${totalChapters} chapters`);
for (const [library, summary] of Object.entries(report.libraries)) {
  console.log(
    `${library}: ${summary.manualsWithImages}/${summary.manuals} manuals have images; `
    + `${summary.imageReferences} references; ${summary.missingImageFiles} missing files; `
    + `${summary.emptyImageFiles} empty files`
  );
}
console.log(
  `Gaps: ${manualsWithoutImages.length} manuals contain no image references; `
  + `${manualsWithBrokenImages.length} manuals contain broken image references.`
);
console.log(`Report: ${outputPath}`);

if (manualsWithBrokenImages.length) process.exitCode = 1;
