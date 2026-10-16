#!/usr/bin/env node
// Rebuild Portugal map metadata without changing any existing routing/search files.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
function value(flag) {
  const at = args.indexOf(flag);
  if (at < 0 || !args[at + 1]) throw new Error('Missing ' + flag);
  return args[at + 1];
}
const path = value('--map');
const target = value('--output');
const sourceCatalog = value('--source');
const [buffer, source, android] = await Promise.all([
  fs.readFile(path),
  fs.readFile(sourceCatalog, 'utf8'),
  fs.readFile('android/native-app/src/main/assets/regions.json', 'utf8')
]);
const catalog = JSON.parse(source);
const embedded = JSON.parse(android);
const region = catalog.regions.find(x => x.id === 'portugal');
const embeddedRegion = embedded.regions.find(x => x.id === 'portugal');
if (!region || !embeddedRegion || region.version !== 8 ||
    embeddedRegion.version !== 8 || region.assets.map || embeddedRegion.assets.map) {
  throw new Error('Unexpected Portugal catalog version or existing map declaration');
}
if (buffer.length < 1024 * 1024 ||
    buffer.subarray(0, 7).toString() !== 'PMTiles' || buffer[7] !== 3) {
  throw new Error('Invalid PMTiles v3 archive');
}
const oldBytes = region.package.files.reduce((sum, entry) => sum + entry.sizeBytes, 0);
if (oldBytes !== region.sizeBytes) {
  throw new Error('Existing Portugal package manifest size mismatch');
}
const mapPath = '/region-packages/portugal/map.pmtiles';
region.version = 9;
region.updatedAt = new Date().toISOString().slice(0, 10);
region.assets.map = mapPath;
region.package.files.unshift({
  url: mapPath,
  label: 'map.pmtiles',
  group: 'map',
  sizeBytes: buffer.length,
  sha256: crypto.createHash('sha256').update(buffer).digest('hex')
});
region.sizeBytes = oldBytes + buffer.length;
const updated = JSON.stringify(catalog, null, 2) + '\n';
await fs.writeFile(target, updated, 'utf8');
console.log('Prepared Portugal v9; PMTiles bytes:', buffer.length,
  'combined package bytes:', region.sizeBytes);
