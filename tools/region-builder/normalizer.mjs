import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

const DEFAULT_CELL_SIZE_DEGREES = 0.005;
const LEGACY_SEARCH_FILES = [
  'search-index.json',
  'search-records.json'
];
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


function normalizeSearchToken(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactPostcode(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .toLowerCase();
}


const SEARCH_RECORD_FIELDS = [
  'name',
  'type',
  'amenity',
  'place',
  'addr:housenumber',
  'addr:street',
  'addr:postcode',
  'addr:city',
  'alt_name',
  'short_name',
  'official_name',
  'loc_name',
  'old_name',
  'name:pt',
  'name:en',
  'ref',
  'municipality',
  'district',
  'tourism',
  'shop',
  'railway',
  'aeroway',
  'boundary',
  'search_only'
];

function coordinateE6(value) {
  return Number.isFinite(value)
    ? Math.round(value * 1_000_000)
    : 0;
}

function encodeVarUint(value) {
  const bytes = [];
  let remaining = Number(value) >>> 0;

  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);

  return Buffer.from(bytes);
}

class BufferedBinaryWriter {
  constructor(handle, flushBytes = 1024 * 1024) {
    this.handle = handle;
    this.flushBytes = flushBytes;
    this.parts = [];
    this.bytes = 0;
  }

  async write(buffer) {
    if (!buffer?.length) return;
    this.parts.push(buffer);
    this.bytes += buffer.length;
    if (this.bytes >= this.flushBytes) await this.flush();
  }

  async flush() {
    if (!this.parts.length) return;
    await this.handle.write(Buffer.concat(this.parts, this.bytes));
    this.parts = [];
    this.bytes = 0;
  }

  async close() {
    await this.flush();
    await this.handle.close();
  }
}

class BinarySearchRecordsWriter {
  constructor(filePath) {
    this.filePath = filePath;
    this.recordsPath = `${filePath}.records.partial`;
    this.outputPath = `${filePath}.partial`;
    this.handle = null;
    this.writer = null;
    this.recordOffsets = [0];
    this.recordBytes = 0;
    this.stringIds = new Map();
    this.strings = [];
  }

  async open() {
    this.handle = await fs.open(this.recordsPath, 'w');
    this.writer = new BufferedBinaryWriter(this.handle);
  }

  #stringId(value) {
    if (value === undefined || value === null || value === '') {
      return 0;
    }

    const text = String(value);
    let id = this.stringIds.get(text);

    if (id !== undefined) return id;

    id = this.strings.length + 1;
    this.stringIds.set(text, id);
    this.strings.push(text);
    return id;
  }

  async write(feature) {
    const properties = feature?.properties ?? {};
    const coordinates = feature?.geometry?.coordinates ?? [];
    let presentMask = 0;
    const fieldRefs = [];

    for (let index = 0; index < SEARCH_RECORD_FIELDS.length; index += 1) {
      const value = properties[SEARCH_RECORD_FIELDS[index]];
      if (value === undefined || value === null || value === '') continue;

      presentMask |= (1 << index) >>> 0;
      fieldRefs.push(this.#stringId(value));
    }

    const buffer = Buffer.allocUnsafe(16 + fieldRefs.length * 4);
    buffer.writeUInt32LE(this.#stringId(feature?.id ?? ''), 0);
    buffer.writeInt32LE(coordinateE6(coordinates[0]), 4);
    buffer.writeInt32LE(coordinateE6(coordinates[1]), 8);
    buffer.writeUInt32LE(presentMask >>> 0, 12);

    for (let index = 0; index < fieldRefs.length; index += 1) {
      buffer.writeUInt32LE(fieldRefs[index], 16 + index * 4);
    }

    await this.writer.write(buffer);
    this.recordBytes += buffer.length;
    this.recordOffsets.push(this.recordBytes);
  }

  async close() {
    await this.writer.close();

    const stringOffsets = new Uint32Array(this.strings.length + 1);
    let stringBytes = 0;

    for (let index = 0; index < this.strings.length; index += 1) {
      stringOffsets[index] = stringBytes;
      stringBytes += Buffer.byteLength(this.strings[index]);
    }
    stringOffsets[this.strings.length] = stringBytes;

    const headerBytes = 32;
    const recordOffsetBytes = this.recordOffsets.length * 4;
    const recordsOffset = headerBytes + recordOffsetBytes;
    const stringOffsetsOffset = recordsOffset + this.recordBytes;
    const stringsOffset = stringOffsetsOffset + stringOffsets.byteLength;

    const output = await fs.open(this.outputPath, 'w');
    try {
      const header = Buffer.alloc(headerBytes);
      header.write('ATSR', 0, 'ascii');
      header.writeUInt16LE(1, 4);
      header.writeUInt16LE(SEARCH_RECORD_FIELDS.length, 6);
      header.writeUInt32LE(this.recordOffsets.length - 1, 8);
      header.writeUInt32LE(this.strings.length, 12);
      header.writeUInt32LE(headerBytes, 16);
      header.writeUInt32LE(recordsOffset, 20);
      header.writeUInt32LE(stringOffsetsOffset, 24);
      header.writeUInt32LE(stringsOffset, 28);
      await output.write(header);

      const offsets = Buffer.allocUnsafe(recordOffsetBytes);
      this.recordOffsets.forEach((value, index) => offsets.writeUInt32LE(value, index * 4));
      await output.write(offsets);

      const source = await fs.open(this.recordsPath, 'r');
      try {
        const chunk = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        while (position < this.recordBytes) {
          const { bytesRead } = await source.read(chunk, 0, Math.min(chunk.length, this.recordBytes - position), position);
          if (!bytesRead) break;
          await output.write(chunk.subarray(0, bytesRead));
          position += bytesRead;
        }
      } finally {
        await source.close();
      }

      await output.write(Buffer.from(stringOffsets.buffer, stringOffsets.byteOffset, stringOffsets.byteLength));
      const stringWriter = new BufferedBinaryWriter(output);
      for (const value of this.strings) {
        await stringWriter.write(Buffer.from(value, 'utf8'));
      }
      await stringWriter.close();
      await fs.rename(this.outputPath, this.filePath);
      await fs.rm(this.recordsPath, { force: true });
    } catch (error) {
      await output.close().catch(() => {});
      await fs.rm(this.outputPath, { force: true });
      await fs.rm(this.recordsPath, { force: true });
      throw error;
    }
  }

  async abort() {
    await this.writer?.close().catch(() => {});
    await fs.rm(this.outputPath, { force: true });
    await fs.rm(this.recordsPath, { force: true });
  }
}

function searchTokensForProperties(properties) {
  const values = [
    properties.name,
    properties.alt_name,
    properties.short_name,
    properties.official_name,
    properties.loc_name,
    properties.old_name,
    properties['name:en'],
    properties.ref,
    properties['addr:housenumber'],
    properties['addr:street'],
    properties['addr:postcode'],
    properties['addr:city'],
    properties.municipality,
    properties.district,
    properties.place,
    properties.amenity,
    properties.tourism,
    properties.shop,
    properties.railway,
    properties.aeroway
  ];

  const tokens = new Set();

  for (const value of values) {
    const normalized =
      normalizeSearchToken(value);

    for (const token of normalized.split(/\s+/)) {
      if (token.length >= 2) {
        tokens.add(token);
      }
    }
  }

  const postcode =
    compactPostcode(properties['addr:postcode']);

  if (postcode.length >= 3) {
    tokens.add(postcode);
  }

  return tokens;
}



function addPostingTokens(postings, properties, featureIndex) {
  for (const token of searchTokensForProperties(properties)) {
    let posting = postings.get(token);
    if (!posting) {
      posting = [];
      postings.set(token, posting);
    }
    posting.push(featureIndex);
  }
}

function addressSearchFeature(feature) {
  const tags = feature?.properties ?? {};
  const coordinates = representativePoint(feature?.geometry);
  if (!coordinates) return null;

  if (tags['addr:housenumber'] && tags['addr:street']) {
    return {
      type: 'Feature',
      id: String(feature.id ?? `address:${tags['addr:housenumber']}:${tags['addr:street']}:${coordinates.join(':')}`),
      geometry: { type: 'Point', coordinates },
      properties: {
        name: `${tags['addr:housenumber']} ${tags['addr:street']}`,
        type: 'address',
        amenity: 'address',
        search_only: true,
        'addr:housenumber': tags['addr:housenumber'],
        'addr:street': tags['addr:street'],
        ...(tags['addr:postcode'] ? { 'addr:postcode': tags['addr:postcode'] } : {}),
        ...(tags['addr:city'] ? { 'addr:city': tags['addr:city'] } : {}),
        ...(tags.municipality ? { municipality: tags.municipality } : {}),
        ...(tags.district ? { district: tags.district } : {})
      }
    };
  }

  if (tags.highway && tags.name) {
    return {
      type: 'Feature',
      id: String(feature.id ?? `street:${tags.name}:${coordinates.join(':')}`),
      geometry: { type: 'Point', coordinates },
      properties: {
        name: tags.name,
        type: 'street',
        amenity: 'street',
        search_only: true,
        'addr:street': tags.name,
        ...(tags['addr:postcode'] ? { 'addr:postcode': tags['addr:postcode'] } : {}),
        ...(tags['addr:city'] ? { 'addr:city': tags['addr:city'] } : {}),
        ...(tags.municipality ? { municipality: tags.municipality } : {}),
        ...(tags.district ? { district: tags.district } : {})
      }
    };
  }

  return null;
}

function streetGroupKey(feature) {
  const [lon, lat] = feature.geometry.coordinates;
  const properties = feature.properties;
  const locality = normalizeSearchToken(
    properties['addr:city'] ?? properties.municipality ?? properties.district ?? ''
  );
  // Named OSM roads are frequently split into many ways. Group nearby
  // fragments into one searchable street representative without merging
  // same-name streets from distant towns.
  const x = Math.floor(lon / 0.05);
  const y = Math.floor(lat / 0.05);
  return `${normalizeSearchToken(properties.name)}|${locality}|${x}:${y}`;
}

async function writeSearchIndex({
  filePath,
  postings,
  featureCount
}) {
  const tempPath = `${filePath}.partial`;
  const postingsPath = `${filePath}.postings.partial`;
  const entries = [...postings.entries()]
    .sort(([left], [right]) => left.localeCompare(right));
  const postingHandle = await fs.open(postingsPath, 'w');
  const postingWriter = new BufferedBinaryWriter(postingHandle);
  const directory = [];
  let postingBytes = 0;
  let tokenBytesTotal = 0;

  try {
    for (const [token, featureIndexes] of entries) {
      const tokenBytes = Buffer.from(token, 'utf8');
      if (tokenBytes.length > 0xffff) {
        throw new Error(`Search token is too long for binary index: ${token}`);
      }

      const postingOffset = postingBytes;
      let previous = 0;

      for (const featureIndex of featureIndexes) {
        const encoded = encodeVarUint(featureIndex - previous);
        await postingWriter.write(encoded);
        postingBytes += encoded.length;
        previous = featureIndex;
      }

      directory.push({
        tokenBytes,
        tokenOffset: tokenBytesTotal,
        postingOffset,
        postingCount: featureIndexes.length
      });
      tokenBytesTotal += tokenBytes.length;
    }

    await postingWriter.close();

    const headerBytes = 32;
    const directoryBytes = directory.length * 16;
    const entriesOffset = headerBytes;
    const tokensOffset = entriesOffset + directoryBytes;
    const postingsOffset = tokensOffset + tokenBytesTotal;
    const output = await fs.open(tempPath, 'w');

    try {
      const writer = new BufferedBinaryWriter(output);
      const header = Buffer.alloc(headerBytes);
      header.write('ATSI', 0, 'ascii');
      header.writeUInt16LE(2, 4);
      header.writeUInt16LE(0, 6);
      header.writeUInt32LE(featureCount, 8);
      header.writeUInt32LE(directory.length, 12);
      header.writeUInt32LE(entriesOffset, 16);
      header.writeUInt32LE(tokensOffset, 20);
      header.writeUInt32LE(postingsOffset, 24);
      header.writeUInt32LE(0, 28);
      await writer.write(header);

      for (const entry of directory) {
        const record = Buffer.allocUnsafe(16);
        record.writeUInt32LE(entry.tokenOffset, 0);
        record.writeUInt16LE(entry.tokenBytes.length, 4);
        record.writeUInt16LE(0, 6);
        record.writeUInt32LE(entry.postingOffset, 8);
        record.writeUInt32LE(entry.postingCount, 12);
        await writer.write(record);
      }

      for (const entry of directory) {
        await writer.write(entry.tokenBytes);
      }
      await writer.flush();

      const source = await fs.open(postingsPath, 'r');
      try {
        const chunk = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        while (position < postingBytes) {
          const { bytesRead } = await source.read(
            chunk,
            0,
            Math.min(chunk.length, postingBytes - position),
            position
          );
          if (!bytesRead) break;
          await output.write(chunk.subarray(0, bytesRead));
          position += bytesRead;
        }
      } finally {
        await source.close();
      }

      await writer.close();
      await fs.rename(tempPath, filePath);
      await fs.rm(postingsPath, { force: true });
    } catch (error) {
      await output.close().catch(() => {});
      throw error;
    }
  } catch (error) {
    await postingWriter.close().catch(() => {});
    await fs.rm(tempPath, { force: true });
    await fs.rm(postingsPath, { force: true });
    throw error;
  }
}


async function extraSearchFeatures(config) {
  const configuredPath =
    config.searchEnrichment?.geojson;

  if (!configuredPath) {
    return [];
  }

  const filePath = path.resolve(
    configuredPath
  );

  try {
    const document = JSON.parse(
      await fs.readFile(
        filePath,
        'utf8'
      )
    );

    return Array.isArray(document.features)
      ? document.features
      : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(
        `  Search enrichment not found: ${configuredPath}; continuing without it.`
      );

      return [];
    }

    throw error;
  }
}

export async function normalizeRegion({
  rawGeoJson,
  config,
  outputDir
}) {
  await fs.mkdir(outputDir, { recursive: true });

  // New region packages use the binary destination-search format. Remove
  // stale JSON artifacts left by older builders so they cannot be copied
  // into dist/Android assets or accidentally published alongside the
  // binary files. Runtime fallback support for already-installed legacy
  // packages remains in LocalRegionProvider.
  await Promise.all(
    LEGACY_SEARCH_FILES.map(fileName =>
      fs.rm(path.join(outputDir, fileName), { force: true })
    )
  );

  const cellSizeDegrees =
    config.spatialIndex?.cellSizeDegrees ??
    DEFAULT_CELL_SIZE_DEGREES;

  const seen = new Set();
  const cells = {};

  // Token -> feature indexes.
  // Generated once during packaging instead of on the phone.
  const searchPostings = new Map();

  // Dedicated address/street search assets are kept separate from the POI
  // index so ordinary destination searches never pay for address data.
  const addressPostings = new Map();
  const streetGroups = new Map();
  let addressFeatureCount = 0;

  let featureCount = 0;

  const poiPath = path.join(outputDir, 'pois.geojson');
  const poiTempPath = `${poiPath}.partial`;
  const poiHandle = await fs.open(poiTempPath, 'w');
  const poiWriter = new BufferedFileWriter(poiHandle);

  const searchRecordsPath = path.join(outputDir, 'search-records.bin');
  const searchRecordsWriter = new BinarySearchRecordsWriter(searchRecordsPath);
  await searchRecordsWriter.open();

  const addressRecordsPath = path.join(outputDir, 'address-records.bin');
  const addressRecordsWriter = new BinarySearchRecordsWriter(addressRecordsPath);
  await addressRecordsWriter.open();

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
      const addressFeature = addressSearchFeature(feature);

      if (addressFeature?.properties?.type === 'address') {
        addPostingTokens(addressPostings, addressFeature.properties, addressFeatureCount);
        await addressRecordsWriter.write(addressFeature);
        addressFeatureCount += 1;
      } else if (addressFeature?.properties?.type === 'street') {
        const key = streetGroupKey(addressFeature);
        const existing = streetGroups.get(key);
        if (!existing) {
          streetGroups.set(key, {
            feature: addressFeature,
            count: 1,
            lonTotal: addressFeature.geometry.coordinates[0],
            latTotal: addressFeature.geometry.coordinates[1]
          });
        } else {
          existing.count += 1;
          existing.lonTotal += addressFeature.geometry.coordinates[0];
          existing.latTotal += addressFeature.geometry.coordinates[1];
        }
      }

      const category = categoryFor(tags, config.categories);
      const coordinates = representativePoint(feature.geometry);

      if (
        !tags.name ||
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

      addPostingTokens(searchPostings, normalized.properties, featureCount);

      if (!first) {
        await poiWriter.write(',');

      }

      await poiWriter.write(
        JSON.stringify(normalized)
      );
      await searchRecordsWriter.write(normalized);

      first = false;
      featureCount += 1;

      if (featureCount % 100_000 === 0) {
        console.log(
          `  normalized ${featureCount.toLocaleString()} records...`
        );
      }
    }

    /*
     * Portugal search enrichment.
     *
     * GISCO postcode points are search-only destinations. They participate
     * in destination lookup and spatial indexing but remain hidden from
     * Nearby because properties.search_only === true.
     */
    const extraFeatures =
      await extraSearchFeatures(config);

    if (extraFeatures.length) {
      console.log(
        `  merging ${extraFeatures.length.toLocaleString()} Portugal postcode records...`
      );
    }

    for (const feature of extraFeatures) {
      const coordinates =
        feature?.geometry?.coordinates;

      if (
        feature?.geometry?.type !== 'Point' ||
        !Array.isArray(coordinates) ||
        coordinates.length < 2 ||
        !Number.isFinite(coordinates[0]) ||
        !Number.isFinite(coordinates[1])
      ) {
        continue;
      }

      const id =
        String(
          feature.id ??
          `extra:${featureCount}`
        );

      if (seen.has(id)) {
        continue;
      }

      seen.add(id);

      const normalized = {
        type: 'Feature',
        id,
        geometry: {
          type: 'Point',
          coordinates: [
            coordinates[0],
            coordinates[1]
          ]
        },
        properties: {
          ...(feature.properties ?? {}),
          search_only: true
        }
      };

      addSpatialIndexFeature(
        cells,
        featureCount,
        coordinates,
        cellSizeDegrees
      );

      addPostingTokens(searchPostings, normalized.properties, featureCount);

      if (!first) {
        await poiWriter.write(',');

      }

      await poiWriter.write(
        JSON.stringify(normalized)
      );
      await searchRecordsWriter.write(normalized);

      first = false;
      featureCount += 1;
    }

    for (const group of streetGroups.values()) {
      const streetFeature = {
        ...group.feature,
        geometry: {
          type: 'Point',
          coordinates: [
            group.lonTotal / group.count,
            group.latTotal / group.count
          ]
        }
      };
      addPostingTokens(addressPostings, streetFeature.properties, addressFeatureCount);
      await addressRecordsWriter.write(streetFeature);
      addressFeatureCount += 1;
    }

    await poiWriter.write(']}');
    await poiWriter.close();
    await searchRecordsWriter.close();
    await addressRecordsWriter.close();
    await fs.rename(poiTempPath, poiPath);
  } catch (error) {
    await poiHandle.close().catch(() => {});
    await searchRecordsWriter.abort();
    await addressRecordsWriter.abort();
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

  const searchIndexPath =
    path.join(
      outputDir,
      'search-index.bin'
    );

  console.log(
    `  writing ${searchPostings.size.toLocaleString()} search tokens...`
  );

  await writeSearchIndex({
    filePath: searchIndexPath,
    postings: searchPostings,
    featureCount
  });

  const addressIndexPath = path.join(outputDir, 'address-index.bin');
  console.log(
    `  writing ${addressPostings.size.toLocaleString()} address/street tokens for ${addressFeatureCount.toLocaleString()} records...`
  );
  await writeSearchIndex({
    filePath: addressIndexPath,
    postings: addressPostings,
    featureCount: addressFeatureCount
  });

  const cellCount = Object.keys(cells).length;

  const metadata = {
    id: config.id,
    name: config.name,
    country: config.country,
    bounds: config.bbox,
    poiUrl: `/regions/${config.id}/pois.geojson`,
    indexUrl: `/regions/${config.id}/poi-index.json`,
    searchUrl: `/regions/${config.id}/search-index.bin`,
    searchRecordsUrl: `/regions/${config.id}/search-records.bin`,
    addressSearchUrl: `/regions/${config.id}/address-index.bin`,
    addressRecordsUrl: `/regions/${config.id}/address-records.bin`,
    poiCount: featureCount,
    addressRecordCount: addressFeatureCount,
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
