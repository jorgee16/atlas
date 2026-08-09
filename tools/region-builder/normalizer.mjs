import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

const DEFAULT_CELL_SIZE_DEGREES = 0.005;
const GEOGRAPHIC_PLACE_TYPES = new Set([
  'city',
  'town',
  'village',
  'hamlet',
  'suburb',
  'quarter',
  'neighbourhood',
  'locality',
  'municipality',
  'borough',
  'island'
]);

function flattenCoordinates(value, output = []) {
  if (!Array.isArray(value)) return output;

  if (
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    output.push(value);
    return output;
  }

  for (const child of value) {
    flattenCoordinates(child, output);
  }

  return output;
}

function representativePoint(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates;

  const points = flattenCoordinates(geometry.coordinates);
  if (!points.length) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const [lon, lat] of points) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }

  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}

function matchesRule(tags, rule) {
  const value = tags[rule.key];
  if (!value) return false;
  return rule.values.includes('*') || rule.values.includes(value);
}

function categoryFor(tags, categories) {
  if (tags['addr:housenumber'] && tags['addr:street']) {
    return 'address';
  }

  if (GEOGRAPHIC_PLACE_TYPES.has(tags.place)) {
    return 'locality';
  }

  for (const [category, rules] of Object.entries(categories)) {
    if (rules.some(rule => matchesRule(tags, rule))) {
      return category;
    }
  }
  return null;
}

function compactProperties(tags, category) {
  const output = {
    name: tags.name ?? (category === 'address'
      ? `${tags['addr:housenumber']} ${tags['addr:street']}`
      : undefined),
    type: category,
    amenity:
      category === 'address'
        ? 'address'
        : tags.amenity ??
          tags.tourism ??
          tags.leisure ??
          tags.historic ??
          'place'
  };

  if (category === 'locality') {
    output.place = tags.place;
    output.search_only = true;
  }

  if (category === 'address') {
    output.search_only = true;
  }

  for (const key of [
    'opening_hours',
    'website',
    'contact:website',
    'phone',
    'contact:phone',
    'wheelchair',
    'addr:housenumber',
    'addr:street',
    'addr:city',
    'addr:postcode',
    'alt_name',
    'short_name',
    'official_name',
    'ref',
    'name:pt',
    'name:en',
    'loc_name',
    'old_name',
    'municipality',
    'district',
    'postal_code',
    'population',
    'wikidata'
  ]) {
    if (tags[key]) output[key] = tags[key];
  }

  return output;
}

function gridCell(value, cellSize) {
  return Math.floor(value / cellSize);
}

function gridKey(lon, lat, cellSize) {
  return `${gridCell(lon, cellSize)}:${gridCell(lat, cellSize)}`;
}

function addSpatialIndexFeature(cells, featureIndex, coordinates, cellSize) {
  const [lon, lat] = coordinates;
  const key = gridKey(lon, lat, cellSize);

  if (!cells[key]) cells[key] = [];
  cells[key].push(featureIndex);
}

async function* readGeoJsonSequence(filePath) {
  const input = createReadStream(filePath, {
    encoding: 'utf8',
    highWaterMark: 1024 * 1024
  });

  let buffer = '';

  for await (const chunk of input) {
    buffer += chunk;

    // RFC 8142 uses ASCII Record Separator (0x1E) between JSON texts.
    // Do not split on newlines: osmium may format one JSON feature across
    // multiple physical lines.
    const records = buffer.split('\x1e');
    buffer = records.pop() ?? '';

    for (const record of records) {
      const json = record.trim();
      if (!json) continue;
      yield JSON.parse(json);
    }
  }

  const tail = buffer.trim();
  if (tail) {
    yield JSON.parse(tail);
  }
}

async function* readLegacyGeoJson(filePath) {
  // Kept for small fixtures/backward compatibility. Large production builds
  // use GeoJSON Sequence so they never create one giant JavaScript string.
  const source = JSON.parse(await fs.readFile(filePath, 'utf8'));
  for (const feature of source.features ?? []) {
    yield feature;
  }
}

function inputFeatures(filePath) {
  return filePath.endsWith('.geojsonseq')
    ? readGeoJsonSequence(filePath)
    : readLegacyGeoJson(filePath);
}

class BufferedFileWriter {
  constructor(handle, flushBytes = 1024 * 1024) {
    this.handle = handle;
    this.flushBytes = flushBytes;
    this.parts = [];
    this.bytes = 0;
  }

  async write(value) {
    const chunk = String(value);
    this.parts.push(chunk);
    this.bytes += Buffer.byteLength(chunk);

    if (this.bytes >= this.flushBytes) {
      await this.flush();
    }
  }

  async flush() {
    if (!this.parts.length) return;
    const chunk = this.parts.join('');
    this.parts = [];
    this.bytes = 0;
    await this.handle.write(chunk);
  }

  async close() {
    await this.flush();
    await this.handle.close();
  }
}

async function writeSpatialIndex({
  filePath,
  cells,
  cellSizeDegrees,
  featureCount
}) {
  const tempPath = `${filePath}.partial`;
  const handle = await fs.open(tempPath, 'w');
  const writer = new BufferedFileWriter(handle);

  try {
    const entries = Object.entries(cells);

    await writer.write(
      '{"version":1,"kind":"uniform-grid",' +
      `"cellSizeDegrees":${JSON.stringify(cellSizeDegrees)},` +
      `"featureCount":${featureCount},` +
      `"cellCount":${entries.length},"cells":{`
    );

    for (let index = 0; index < entries.length; index += 1) {
      const [key, featureIndexes] = entries[index];

      if (index > 0) await writer.write(',');

      await writer.write(
        `${JSON.stringify(key)}:${JSON.stringify(featureIndexes)}`
      );
    }

    await writer.write('}}');
    await writer.close();
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

export async function normalizeRegion({
  rawGeoJson,
  config,
  outputDir
}) {
  await fs.mkdir(outputDir, { recursive: true });

  const cellSizeDegrees =
    config.spatialIndex?.cellSizeDegrees ??
    DEFAULT_CELL_SIZE_DEGREES;

  const seen = new Set();
  const cells = {};
  let featureCount = 0;

  const poiPath = path.join(outputDir, 'pois.geojson');
  const poiTempPath = `${poiPath}.partial`;
  const poiHandle = await fs.open(poiTempPath, 'w');
  const poiWriter = new BufferedFileWriter(poiHandle);

  await poiWriter.write(
    '{"type":"FeatureCollection","metadata":' +
      JSON.stringify({
        source: 'OpenStreetMap',
        license: 'ODbL-1.0',
        attribution: '© OpenStreetMap contributors'
      }) +
      ',"features":['
  );

  let first = true;

  try {
    for await (const feature of inputFeatures(rawGeoJson)) {
      const tags = feature.properties ?? {};
      const category = categoryFor(tags, config.categories);
      const coordinates = representativePoint(feature.geometry);

      const searchableAddress = category === 'address';
      if (
        (!tags.name && !searchableAddress) ||
        !category ||
        !coordinates
      ) {
        continue;
      }

      const id = String(
        feature.id ??
        `${tags.name ?? `${tags['addr:housenumber']} ${tags['addr:street']}`}:${coordinates[0]}:${coordinates[1]}`
      );

      if (seen.has(id)) continue;
      seen.add(id);

      const normalized = {
        type: 'Feature',
        id,
        geometry: {
          type: 'Point',
          coordinates
        },
        properties: {
          ...compactProperties(tags, category),
          osm_id: id
        }
      };

      addSpatialIndexFeature(
        cells,
        featureCount,
        coordinates,
        cellSizeDegrees
      );

      if (!first) {
        await poiWriter.write(',');
      }

      await poiWriter.write(
        JSON.stringify(normalized)
      );

      first = false;
      featureCount += 1;

      if (featureCount % 100_000 === 0) {
        console.log(
          `  normalized ${featureCount.toLocaleString()} records...`
        );
      }
    }

    await poiWriter.write(']}');
    await poiWriter.close();
    await fs.rename(poiTempPath, poiPath);
  } catch (error) {
    await poiHandle.close().catch(() => {});
    await fs.rm(poiTempPath, { force: true });
    throw error;
  }

  const indexPath = path.join(outputDir, 'poi-index.json');

  // Stream the index too. Portugal can contain enough exact-address records
  // that JSON.stringify(spatialIndex) itself can exceed V8's string limit.
  await writeSpatialIndex({
    filePath: indexPath,
    cells,
    cellSizeDegrees,
    featureCount
  });

  const cellCount = Object.keys(cells).length;

  const metadata = {
    id: config.id,
    name: config.name,
    country: config.country,
    bounds: config.bbox,
    poiUrl: `/regions/${config.id}/pois.geojson`,
    indexUrl: `/regions/${config.id}/poi-index.json`,
    poiCount: featureCount,
    spatialIndex: {
      kind: 'uniform-grid',
      version: 1,
      cellSizeDegrees,
      cellCount
    },
    generatedAt: new Date().toISOString(),
    attribution: '© OpenStreetMap contributors',
    dataLicense: 'ODbL-1.0'
  };

  await fs.writeFile(
    path.join(outputDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf8'
  );

  return metadata;
}
