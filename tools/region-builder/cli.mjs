#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OsmiumAdapter } from './adapters/osmium-adapter.mjs';
import { normalizeRegion } from './normalizer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = { command };

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = rest[index + 1];

    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    values[key] = value;
    index += 1;
  }

  return values;
}

function usage() {
  console.log(`
Roam Region Builder

Build:
  node tools/region-builder/cli.mjs build \
    --config tools/region-builder/config/london.json \
    --input data/osm/greater-london-latest.osm.pbf

Validate configuration:
  node tools/region-builder/cli.mjs validate \
    --config tools/region-builder/config/london.json
  `.trim());
}

async function loadConfig(configPath) {
  const absolutePath = path.resolve(projectRoot, configPath);
  const config = JSON.parse(await fs.readFile(absolutePath, 'utf8'));

  for (const key of ['id', 'name', 'country', 'bbox', 'output', 'categories']) {
    if (config[key] == null) {
      throw new Error(`Region config is missing "${key}".`);
    }
  }

  if (
    !Array.isArray(config.bbox) ||
    config.bbox.length !== 4 ||
    config.bbox.some(value => !Number.isFinite(value))
  ) {
    throw new Error('Region bbox must be [left, bottom, right, top].');
  }

  return config;
}

async function validate(args) {
  const config = await loadConfig(args.config);
  console.log(`Valid region: ${config.name} (${config.id})`);
}

async function build(args) {
  if (!args.config || !args.input) {
    throw new Error('build requires --config and --input.');
  }

  const config = await loadConfig(args.config);
  const input = path.resolve(projectRoot, args.input);
  const outputDir = path.resolve(projectRoot, config.output);
  const workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `roam-${config.id}-`)
  );

  const adapter = new OsmiumAdapter();

  try {
    console.log(`[1/3] Verifying osmium...`);
    await adapter.verify();

    console.log(`[2/3] Extracting ${config.name} POIs...`);
    const rawGeoJson = await adapter.buildIntermediate({
      input,
      bbox: config.bbox,
      categories: config.categories,
      workDir
    });

    if (config.id === 'portugal') {
      const ensureScript =
        path.resolve(
          projectRoot,
          'tools/region-builder/ensure-portugal-postcodes.mjs'
        );

      await new Promise((resolve, reject) => {
        import('node:child_process')
          .then(({ spawn }) => {
            const child = spawn(
              process.execPath,
              [ensureScript],
              {
                cwd: projectRoot,
                stdio: 'inherit'
              }
            );

            child.once('error', reject);

            child.once('exit', code => {
              if (code === 0) resolve();
              else reject(
                new Error(
                  `Portugal postcode preparation failed with code ${code}`
                )
              );
            });
          })
          .catch(reject);
      });
    }

    console.log(`[3/3] Normalizing local database...`);
    const metadata = await normalizeRegion({
      rawGeoJson,
      config,
      outputDir
    });

    console.log('');
    console.log(`Built ${metadata.name}: ${metadata.poiCount} POIs`);
    console.log(`Output: ${path.relative(projectRoot, outputDir)}`);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

try {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || ['help', '--help', '-h'].includes(args.command)) {
    usage();
    process.exit(0);
  }

  if (args.command === 'validate') {
    await validate(args);
  } else if (args.command === 'build') {
    await build(args);
  } else {
    throw new Error(`Unknown command: ${args.command}`);
  }
} catch (error) {
  console.error(`Region builder failed: ${error.message}`);
  process.exit(1);
}
