#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

const londonPbf =
  process.env.ATLAS_LONDON_PBF ||
  'data/osm/greater-london-latest.osm.pbf';

const portugalPbf =
  process.env.ATLAS_PORTUGAL_PBF ||
  'packager/data/portugal-latest.osm.pbf';

await requireFile(londonPbf, 'London PBF');
await requireFile(portugalPbf, 'Portugal PBF');

await run('node', [
  'tools/region-builder/cli.mjs',
  'build',
  '--config',
  'tools/region-builder/config/london.json',
  '--input',
  londonPbf
]);

await run('node', [
  'tools/region-builder/cli.mjs',
  'build',
  '--config',
  'tools/region-builder/config/portugal.json',
  '--input',
  portugalPbf
]);

const catalogPath = path.join(root, 'public/regions/catalog.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const updatedAt = new Date().toISOString().slice(0, 10);

for (const id of ['london', 'portugal']) {
  const region = catalog.regions?.find(candidate => candidate.id === id);
  if (!region) throw new Error(`Region missing from catalogue: ${id}`);

  const poiUrl = region.assets?.pois;

  if (typeof poiUrl !== 'string') {
    throw new Error(`${region.name} catalogue entry is missing assets.pois.`);
  }

  region.assets.search = poiUrl.replace(
    /pois\.geojson(?:\?.*)?$/,
    'search-index.bin'
  );
  region.assets.searchRecords = poiUrl.replace(
    /pois\.geojson(?:\?.*)?$/,
    'search-records.bin'
  );

  // Search package bytes changed, so publish a genuinely newer package
  // version. RegionManager then offers an atomic update containing the
  // compact destination-search assets.
  region.version = Math.max(Number(region.version) || 0, 6) + 1;
  region.updatedAt = updatedAt;
  delete region.package;
  delete region.sizeBytes;
}

await writeFile(
  catalogPath,
  `${JSON.stringify(catalog, null, 2)}\n`,
  'utf8'
);

await run('node', [
  'tools/region-builder/package-manifest.mjs',
  '--region',
  'london'
]);

await run('node', [
  'tools/region-builder/package-manifest.mjs',
  '--region',
  'portugal'
]);

console.log('');
console.log('Rich region rebuild complete.');
console.log(`London source:   ${londonPbf}`);
console.log(`Portugal source: ${portugalPbf}`);
console.log('Catalogue versions/manifests refreshed.');

async function requireFile(relativePath, label) {
  try {
    await access(path.resolve(root, relativePath));
  } catch {
    throw new Error(
      `${label} not found: ${relativePath}\n` +
      `Override with ${label.startsWith('London')
        ? 'ATLAS_LONDON_PBF'
        : 'ATLAS_PORTUGAL_PBF'}=/path/to/file.osm.pbf`
    );
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      shell: false
    });

    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(
        `${command} ${args.join(' ')} exited with code ${code}`
      ));
    });
  });
}
