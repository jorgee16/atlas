#!/usr/bin/env node

import {
  createHash
} from 'node:crypto';

import {
  createReadStream
} from 'node:fs';

import {
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';

import path from 'node:path';
import {
  fileURLToPath
} from 'node:url';

const scriptDirectory = path.dirname(
  fileURLToPath(import.meta.url)
);

const projectRoot = path.resolve(
  scriptDirectory,
  '../..'
);

const publicRoot = path.join(
  projectRoot,
  'public'
);

const cataloguePath = path.join(
  publicRoot,
  'regions/catalog.json'
);

const regionId = argumentValue(
  process.argv.slice(2),
  '--region'
);

if (!regionId) {
  fail(
    'Usage: node tools/region-builder/package-manifest.mjs --region <region-id>'
  );
}

const catalogue = JSON.parse(
  await readFile(cataloguePath, 'utf8')
);

const region = catalogue.regions?.find(
  candidate => candidate.id === regionId
);

if (!region) {
  fail(`Unknown region: ${regionId}`);
}

await prepareBinarySearchAssets(region);
await prepareRoutingTollAssets(region);

const assets = collectAssets(
  region.assets ?? {}
);

if (!assets.length) {
  fail(`${region.name} has no assets in the catalogue.`);
}

const files = [];

for (const asset of assets) {
  const localPath = localAssetPath(asset.url);

  let info;

  try {
    info = await stat(localPath);
  } catch {
    fail(
      `Missing ${asset.url}. Generate or copy every package asset before creating the manifest.`
    );
  }

  if (!info.isFile()) {
    fail(`Region asset is not a file: ${asset.url}`);
  }

  files.push({
    url: asset.url,
    label: path.basename(localPath),
    group: asset.group,
    sizeBytes: info.size,
    sha256: await hashFile(localPath)
  });
}

region.sizeBytes = files.reduce(
  (total, file) => total + file.sizeBytes,
  0
);

region.package = {
  schemaVersion: 1,
  files
};

await writeFile(
  cataloguePath,
  `${JSON.stringify(catalogue, null, 2)}\n`,
  'utf8'
);

console.log(
  `${region.name}: ${files.length} files, ${formatBytes(region.sizeBytes)}, SHA-256 manifest written to public/regions/catalog.json`
);


async function prepareBinarySearchAssets(region) {
  const poiUrl = region.assets?.pois;

  if (typeof poiUrl !== 'string') {
    return;
  }

  const binarySearchUrl = poiUrl.replace(
    /pois\.geojson(?:\?.*)?$/,
    'search-index.bin'
  );
  const binarySearchRecordsUrl = poiUrl.replace(
    /pois\.geojson(?:\?.*)?$/,
    'search-records.bin'
  );
  const addressSearchUrl = poiUrl.replace(
    /pois\.geojson(?:\?.*)?$/,
    'address-index.bin'
  );
  const addressRecordsUrl = poiUrl.replace(
    /pois\.geojson(?:\?.*)?$/,
    'address-records.bin'
  );

  if (binarySearchUrl === poiUrl) {
    return;
  }

  region.assets.search = binarySearchUrl;
  region.assets.searchRecords = binarySearchRecordsUrl;
  region.assets.addressSearch = addressSearchUrl;
  region.assets.addressRecords = addressRecordsUrl;

  const legacyUrls = [
    poiUrl.replace(
      /pois\.geojson(?:\?.*)?$/,
      'search-index.json'
    ),
    poiUrl.replace(
      /pois\.geojson(?:\?.*)?$/,
      'search-records.json'
    )
  ];

  await Promise.all(
    legacyUrls.map(url =>
      rm(localAssetPath(url), { force: true })
    )
  );
}

async function prepareRoutingTollAssets(region) {
  const partitions = region.assets?.routing?.partitions;

  if (!Array.isArray(partitions)) {
    return;
  }

  for (const partition of partitions) {
    if (typeof partition?.metadata !== 'string') {
      continue;
    }

    const tollEventsUrl = partition.metadata.replace(
      /metadata\.json(?:\?.*)?$/,
      'toll-events.json'
    );

    if (tollEventsUrl === partition.metadata) {
      continue;
    }

    try {
      const info = await stat(localAssetPath(tollEventsUrl));
      if (info.isFile()) {
        partition.tollEvents = tollEventsUrl;
      }
    } catch {
      // Toll events are optional for regions/partitions that do not have them.
    }
  }
}

function collectAssets(root) {
  const found = [];

  const visit = (value, keys = []) => {
    if (typeof value === 'string') {
      if (isAssetUrl(value)) {
        found.push({
          url: value,
          group: groupForPath(keys)
        });
      }

      return;
    }

    if (!value || typeof value !== 'object') {
      return;
    }

    Object.entries(value).forEach(
      ([key, child]) => {
        if (key === 'id' || key === 'bounds') {
          return;
        }

        visit(child, [...keys, key]);
      }
    );
  };

  visit(root);

  return [
    ...new Map(
      found.map(asset => [asset.url, asset])
    ).values()
  ];
}

function localAssetPath(url) {
  if (/^https?:\/\//i.test(url)) {
    fail(
      `Cannot hash a remote asset. Copy it beneath public/ first: ${url}`
    );
  }

  const relativePath = String(url)
    .split('?')[0]
    .replace(/^\/+/, '');

  const resolved = path.resolve(
    publicRoot,
    relativePath
  );

  if (
    resolved !== publicRoot &&
    !resolved.startsWith(`${publicRoot}${path.sep}`)
  ) {
    fail(`Asset escapes the public directory: ${url}`);
  }

  return resolved;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', chunk =>
      hash.update(chunk)
    );
    stream.on('error', reject);
    stream.on('end', () =>
      resolve(hash.digest('hex'))
    );
  });
}

function isAssetUrl(value) {
  return /^https?:\/\//i.test(value) ||
    value.startsWith('/') ||
    /\.(?:bin|json|geojson|pmtiles)(?:\?.*)?$/i
      .test(value);
}

function groupForPath(keys) {
  if (keys[0] === 'map') {
    return 'map';
  }

  if (
    keys[0] === 'pois' ||
    keys[0] === 'index' ||
    keys[0] === 'search' ||
    keys[0] === 'searchRecords' ||
    keys[0] === 'addressSearch' ||
    keys[0] === 'addressRecords'
  ) {
    return 'places';
  }

  if (keys[0] === 'routing') {
    return 'navigation';
  }

  return 'data';
}

function argumentValue(args, name) {
  const index = args.indexOf(name);

  return index >= 0
    ? args[index + 1] ?? null
    : null;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
