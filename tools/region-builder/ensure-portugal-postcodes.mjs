#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(
  fileURLToPath(import.meta.url)
);

const root = path.resolve(here, '../..');

const output = path.join(
  root,
  'data/postcodes/portugal-postcodes.geojson'
);

const url =
  'https://pub-75539028275a4826aa383fdb89292ed7.r2.dev/' +
  'source-data/portugal/portugal-postcodes.geojson';

try {
  await fs.access(output);
  console.log('Portugal postcode enrichment already present.');
  process.exit(0);
} catch {}

await fs.mkdir(
  path.dirname(output),
  { recursive: true }
);

console.log('Downloading Portugal postcode enrichment...');

const response = await fetch(url);

if (!response.ok) {
  throw new Error(
    `Unable to download Portugal postcode enrichment: HTTP ${response.status}`
  );
}

const temp = `${output}.partial`;

await fs.writeFile(
  temp,
  Buffer.from(
    await response.arrayBuffer()
  )
);

await fs.rename(temp, output);

const stat = await fs.stat(output);

console.log(
  `Portugal postcode enrichment ready: ${(stat.size / 1024 / 1024).toFixed(1)} MB`
);
