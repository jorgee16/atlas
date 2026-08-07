import fs from 'node:fs/promises';

const file = 'src/app.js';
let source = await fs.readFile(file, 'utf8');

const oldBlock = `const mapAdapter = new LeafletMapAdapter({
    elementId: 'map'
  });`;

const newBlock = `const mapAdapter = new LeafletMapAdapter({
    elementId: 'map',
    offlineMapUrl:
      \`\${import.meta.env.BASE_URL}regions/london/map.pmtiles\`,
    preferOffline: true
  });`;

if (source.includes(newBlock)) {
  console.log('PMTiles app configuration is already applied.');
  process.exit(0);
}

if (!source.includes(oldBlock)) {
  throw new Error(
    'Could not find the LeafletMapAdapter construction block in src/app.js.'
  );
}

source = source.replace(oldBlock, newBlock);
await fs.writeFile(file, source, 'utf8');

console.log('Updated src/app.js with the offline PMTiles URL.');
