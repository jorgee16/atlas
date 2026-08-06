#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OsmiumAdapter } from './adapters/osmium-adapter.mjs';
import { TilemakerAdapter } from './adapters/tilemaker-adapter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const values = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    values[key] = value;
    index += 1;
  }

  return values;
}

function relativeProjectPath(value) {
  return path.relative(projectRoot, value);
}

async function loadConfig(configPath) {
  const absolutePath = path.resolve(projectRoot, configPath);
  const config = JSON.parse(
    await fs.readFile(absolutePath, 'utf8')
  );

  for (const key of [
    'id',
    'name',
    'country',
    'bbox',
    'output'
  ]) {
    if (config[key] == null) {
      throw new Error(`Region config is missing "${key}".`);
    }
  }

  if (
    !Array.isArray(config.bbox) ||
    config.bbox.length !== 4 ||
    config.bbox.some(value => !Number.isFinite(value))
  ) {
    throw new Error(
      'Region bbox must be [left, bottom, right, top].'
    );
  }

  return config;
}

async function updateMetadata({
  outputDirectory,
  config,
  mapSizeBytes
}) {
  const metadataPath = path.join(
    outputDirectory,
    'metadata.json'
  );

  let metadata = {
    id: config.id,
    name: config.name,
    country: config.country,
    bounds: config.bbox,
    attribution: '© OpenStreetMap contributors',
    dataLicense: 'ODbL-1.0'
  };

  try {
    metadata = {
      ...metadata,
      ...JSON.parse(
        await fs.readFile(metadataPath, 'utf8')
      )
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  metadata.map = {
    url: `/regions/${config.id}/map.pmtiles`,
    format: 'pmtiles',
    tileType: 'vector',
    sizeBytes: mapSizeBytes,
    generatedAt: new Date().toISOString()
  };

  await fs.writeFile(
    metadataPath,
    JSON.stringify(metadata, null, 2),
    'utf8'
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.config || !args.input) {
    throw new Error(
      'Usage: node tools/region-builder/map-cli.mjs ' +
      '--config <region.json> --input <source.osm.pbf>'
    );
  }

  const config = await loadConfig(args.config);
  const inputPbf = path.resolve(projectRoot, args.input);
  const outputDirectory = path.resolve(
    projectRoot,
    config.output
  );

  const workDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), `roam-map-${config.id}-`)
  );

  const extractedPbf = path.join(
    workDirectory,
    'region.osm.pbf'
  );

  const temporaryStore = path.join(
    workDirectory,
    'tilemaker-store'
  );

  const outputPmtiles = path.join(
    outputDirectory,
    'map.pmtiles'
  );

  const osmium = new OsmiumAdapter();
  const tilemaker = new TilemakerAdapter();

  try {
    console.log('[1/4] Verifying osmium...');
    await osmium.verify();

    console.log('[2/4] Verifying tilemaker...');
    await tilemaker.verify();

    console.log(`[3/4] Extracting ${config.name} map data...`);
    await osmium.extractRegion({
      input: inputPbf,
      bbox: config.bbox,
      output: extractedPbf
    });

    console.log('[4/4] Building PMTiles map...');
    const result = await tilemaker.createPmtiles({
      inputPbf: extractedPbf,
      outputPmtiles,
      configPath: args["tile-config"]
        ? path.resolve(args["tile-config"])
        : null,
      processPath: args["tile-process"]
        ? path.resolve(args["tile-process"])
        : null,
      temporaryStore,
      bbox: config.bbox
    });

    await updateMetadata({
      outputDirectory,
      config,
      mapSizeBytes: result.sizeBytes
    });

    console.log('');
    console.log(`Built ${config.name} offline map.`);
    console.log(
      `Output: ${relativeProjectPath(result.path)}`
    );
    console.log(
      `Size: ${(result.sizeBytes / 1024 / 1024).toFixed(1)} MiB`
    );
  } finally {
    await fs.rm(workDirectory, {
      recursive: true,
      force: true
    });
  }
}

main().catch(error => {
  console.error(`Map builder failed: ${error.message}`);
  process.exit(1);
});
