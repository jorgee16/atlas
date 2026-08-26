import { distanceMeters } from '../../utils.js';

const BINARY_SEARCH_RECORD_FIELDS = [
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

function readVarUint(view, state) {
  let value = 0;
  let shift = 0;

  while (state.offset < view.byteLength) {
    const byte = view.getUint8(state.offset++);
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return value >>> 0;
    shift += 7;
    if (shift > 28) throw new Error('Invalid search varint.');
  }

  throw new Error('Unexpected end of search varint.');
}

export function parseBinarySearchIndex(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 16) return null;

  const magic = String.fromCharCode(...new Uint8Array(arrayBuffer, 0, 4));
  if (magic !== 'ATSI') return null;

  const version = view.getUint16(4, true);
  const featureCount = view.getUint32(8, true);
  const tokenCount = view.getUint32(12, true);

  if (version === 2) {
    if (view.byteLength < 32) return null;

    const entriesOffset = view.getUint32(16, true);
    const tokensOffset = view.getUint32(20, true);
    const postingsOffset = view.getUint32(24, true);
    const entryBytes = tokenCount * 16;

    if (
      entriesOffset < 32 ||
      entriesOffset + entryBytes > view.byteLength ||
      tokensOffset < entriesOffset + entryBytes ||
      postingsOffset < tokensOffset ||
      postingsOffset > view.byteLength
    ) {
      throw new Error('Invalid Atlas binary search-index header.');
    }

    return {
      version: 2,
      kind: 'atlas-text-index-binary-lazy',
      featureCount,
      tokenCount,
      buffer: arrayBuffer,
      view,
      entriesOffset,
      tokensOffset,
      postingsOffset,
      decoder: new TextDecoder(),
      postingCache: new Map()
    };
  }

  if (version !== 1) return null;

  /*
   * Version 1 is retained for already-installed Phase 3 packages. It has
   * no token directory, so it must be decoded eagerly. Newly-built regions
   * use version 2 and never take this path.
   */
  const decoder = new TextDecoder();
  const tokens = Object.create(null);
  const state = { offset: 16 };

  for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex += 1) {
    if (state.offset + 2 > view.byteLength) throw new Error('Truncated search index.');
    const tokenBytes = view.getUint16(state.offset, true);
    state.offset += 2;
    if (state.offset + tokenBytes + 4 > view.byteLength) throw new Error('Truncated search token.');

    const token = decoder.decode(new Uint8Array(arrayBuffer, state.offset, tokenBytes));
    state.offset += tokenBytes;
    const postingCount = view.getUint32(state.offset, true);
    state.offset += 4;
    const postings = new Uint32Array(postingCount);
    let previous = 0;

    for (let index = 0; index < postingCount; index += 1) {
      previous += readVarUint(view, state);
      postings[index] = previous;
    }

    tokens[token] = postings;
  }

  return {
    version: 1,
    kind: 'atlas-text-index-binary',
    featureCount,
    tokenCount,
    tokens
  };
}

function binarySearchIndexEntry(searchIndex, token) {
  if (!searchIndex || searchIndex.version !== 2) return null;

  let low = 0;
  let high = searchIndex.tokenCount - 1;

  while (low <= high) {
    const middle = (low + high) >>> 1;
    const entryOffset = searchIndex.entriesOffset + middle * 16;
    const tokenOffset = searchIndex.view.getUint32(entryOffset, true);
    const tokenBytes = searchIndex.view.getUint16(entryOffset + 4, true);
    const current = searchIndex.decoder.decode(
      new Uint8Array(
        searchIndex.buffer,
        searchIndex.tokensOffset + tokenOffset,
        tokenBytes
      )
    );
    const comparison = current.localeCompare(token);

    if (comparison === 0) {
      return { middle, entryOffset };
    }

    if (comparison < 0) low = middle + 1;
    else high = middle - 1;
  }

  return null;
}

export function binarySearchIndexTokenCount(searchIndex, token) {
  if (!searchIndex) return null;
  if (searchIndex.version !== 2) {
    const postings = searchIndex?.tokens?.[token];
    return postings ? postings.length : null;
  }

  const entry = binarySearchIndexEntry(searchIndex, token);
  return entry
    ? searchIndex.view.getUint32(entry.entryOffset + 12, true)
    : null;
}

export function binarySearchIndexToken(searchIndex, token) {
  if (!searchIndex || searchIndex.version !== 2) {
    return searchIndex?.tokens?.[token] ?? null;
  }

  const entry = binarySearchIndexEntry(searchIndex, token);
  if (!entry) return null;

  const { middle, entryOffset } = entry;

  const cached = searchIndex.postingCache.get(middle);
  if (cached) return cached;

  const postingOffset = searchIndex.view.getUint32(entryOffset + 8, true);
  const postingCount = searchIndex.view.getUint32(entryOffset + 12, true);
  const postings = new Uint32Array(postingCount);
  const state = {
    offset: searchIndex.postingsOffset + postingOffset
  };
  let previous = 0;

  for (let index = 0; index < postingCount; index += 1) {
    previous += readVarUint(searchIndex.view, state);
    postings[index] = previous;
  }

  if (searchIndex.postingCache.size >= 64) {
    const oldest = searchIndex.postingCache.keys().next().value;
    searchIndex.postingCache.delete(oldest);
  }
  searchIndex.postingCache.set(middle, postings);
  return postings;
}

export function intersectSortedPostings(left, right) {
  const output = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    const leftValue = left[leftIndex];
    const rightValue = right[rightIndex];

    if (leftValue === rightValue) {
      output.push(leftValue);
      leftIndex += 1;
      rightIndex += 1;
    } else if (leftValue < rightValue) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }

  return output;
}

export function unionSortedPostings(lists) {
  if (!lists.length) return [];
  if (lists.length === 1) return Array.from(lists[0]);

  let merged = Array.from(lists[0]);

  for (let listIndex = 1; listIndex < lists.length; listIndex += 1) {
    const right = lists[listIndex];
    const output = [];
    let leftIndex = 0;
    let rightIndex = 0;

    while (leftIndex < merged.length || rightIndex < right.length) {
      const leftValue = leftIndex < merged.length ? merged[leftIndex] : Infinity;
      const rightValue = rightIndex < right.length ? right[rightIndex] : Infinity;

      if (leftValue === rightValue) {
        output.push(leftValue);
        leftIndex += 1;
        rightIndex += 1;
      } else if (leftValue < rightValue) {
        output.push(leftValue);
        leftIndex += 1;
      } else {
        output.push(rightValue);
        rightIndex += 1;
      }
    }

    merged = output;
  }

  return merged;
}

function yieldToSearchUi() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export function parseBinarySearchRecords(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 32) return null;

  const magic = String.fromCharCode(...new Uint8Array(arrayBuffer, 0, 4));
  if (magic !== 'ATSR' || view.getUint16(4, true) !== 1) return null;

  const fieldCount = view.getUint16(6, true);
  const recordCount = view.getUint32(8, true);
  const stringCount = view.getUint32(12, true);
  const recordOffsetsOffset = view.getUint32(16, true);
  const recordsOffset = view.getUint32(20, true);
  const stringOffsetsOffset = view.getUint32(24, true);
  const stringsOffset = view.getUint32(28, true);

  if (
    fieldCount !== BINARY_SEARCH_RECORD_FIELDS.length ||
    recordOffsetsOffset + (recordCount + 1) * 4 > view.byteLength ||
    stringOffsetsOffset + (stringCount + 1) * 4 > view.byteLength ||
    stringsOffset > view.byteLength
  ) {
    throw new Error('Invalid Atlas binary search-records header.');
  }

  return {
    version: 1,
    kind: 'atlas-search-records-binary',
    buffer: arrayBuffer,
    view,
    recordCount,
    stringCount,
    recordOffsetsOffset,
    recordsOffset,
    stringOffsetsOffset,
    stringsOffset,
    decoder: new TextDecoder(),
    stringCache: new Map()
  };
}

function binarySearchString(records, id) {
  if (!id) return null;
  const cached = records.stringCache.get(id);
  if (cached !== undefined) return cached;

  const index = id - 1;
  if (index < 0 || index >= records.stringCount) return null;
  const start = records.view.getUint32(records.stringOffsetsOffset + index * 4, true);
  const end = records.view.getUint32(records.stringOffsetsOffset + (index + 1) * 4, true);
  const value = records.decoder.decode(
    new Uint8Array(records.buffer, records.stringsOffset + start, end - start)
  );

  if (records.stringCache.size >= 50_000) {
    const oldest = records.stringCache.keys().next().value;
    records.stringCache.delete(oldest);
  }
  records.stringCache.set(id, value);
  return value;
}

export function binarySearchFeature(records, index) {
  if (index < 0 || index >= records.recordCount) return null;

  const relative = records.view.getUint32(records.recordOffsetsOffset + index * 4, true);
  const endRelative = records.view.getUint32(records.recordOffsetsOffset + (index + 1) * 4, true);
  let offset = records.recordsOffset + relative;
  const end = records.recordsOffset + endRelative;

  if (offset + 16 > end) return null;
  const idRef = records.view.getUint32(offset, true); offset += 4;
  const lon = records.view.getInt32(offset, true) / 1_000_000; offset += 4;
  const lat = records.view.getInt32(offset, true) / 1_000_000; offset += 4;
  const presentMask = records.view.getUint32(offset, true); offset += 4;
  const properties = {};

  for (let fieldIndex = 0; fieldIndex < BINARY_SEARCH_RECORD_FIELDS.length; fieldIndex += 1) {
    if ((presentMask & ((1 << fieldIndex) >>> 0)) === 0) continue;
    if (offset + 4 > end) return null;
    const stringRef = records.view.getUint32(offset, true); offset += 4;
    const value = binarySearchString(records, stringRef);
    if (value !== null) {
      const key = BINARY_SEARCH_RECORD_FIELDS[fieldIndex];
      properties[key] = key === 'search_only' ? value === 'true' : value;
    }
  }

  return {
    type: 'Feature',
    id: binarySearchString(records, idRef) ?? `search:${index}`,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties
  };
}

const METERS_PER_LATITUDE_DEGREE = 111_320;

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();
}

const SEARCH_FIELD_WEIGHTS = {
  name: 0,
  alternateName: 1,
  locality: 2,
  address: 3,
  category: 4
};

const CATEGORY_ALIASES = {
  cafe: 'cafe coffee espresso',
  restaurant: 'restaurant food eat dinner lunch',
  pub: 'pub bar drinks nightlife',
  hotel: 'hotel accommodation lodging stay',
  museum: 'museum culture attraction',
  hospital: 'hospital health emergency',
  pharmacy: 'pharmacy chemist medicine',
  fuel: 'fuel petrol gas station',
  parking: 'parking car park',
  viewpoint: 'viewpoint miradouro vista attraction'
};

const GEOGRAPHIC_TYPES = new Set([
  'administrative',
  'borough',
  'city',
  'district',
  'hamlet',
  'locality',
  'municipality',
  'neighbourhood',
  'parish',
  'quarter',
  'region',
  'suburb',
  'town',
  'village'
]);

function isNearbyFeature(feature) {
  const properties = feature?.properties ?? {};
  const type = normalizeSearchText(properties.type);
  const place = normalizeSearchText(properties.place);
  const boundary = normalizeSearchText(properties.boundary);

  return properties.search_only !== true &&
    !GEOGRAPHIC_TYPES.has(type) &&
    !GEOGRAPHIC_TYPES.has(place) &&
    boundary !== 'administrative';
}

function isGeographicPlace(place) {
  return GEOGRAPHIC_TYPES.has(
    normalizeSearchText(place?.type)
  ) || GEOGRAPHIC_TYPES.has(
    normalizeSearchText(place?.place)
  );
}

function sameSearchLocation(left, right) {
  if (
    normalizeSearchText(left.name) !==
    normalizeSearchText(right.name)
  ) {
    return false;
  }

  if (String(left.id) === String(right.id)) {
    return true;
  }

  const leftIsGeographic = isGeographicPlace(left);
  const rightIsGeographic = isGeographicPlace(right);

  if (leftIsGeographic !== rightIsGeographic) {
    return false;
  }

  const separation = distanceMeters(
    left.lat,
    left.lon,
    right.lat,
    right.lon
  );

  if (leftIsGeographic) {
    const leftContext = normalizeSearchText(left.city);
    const rightContext = normalizeSearchText(right.city);

    if (
      leftContext &&
      rightContext &&
      leftContext !== rightContext
    ) {
      return false;
    }

    // A settlement node, its area way and its administrative relation can
    // use different representative points. Keep the radius wide enough to
    // merge those records, while context prevents same-name places in
    // different municipalities from being collapsed.
    return separation <= 3_000;
  }

  const leftKind = normalizeSearchText(
    left.amenity || left.type
  );
  const rightKind = normalizeSearchText(
    right.amenity || right.type
  );

  if (leftKind && rightKind && leftKind !== rightKind) {
    return false;
  }

  const leftAddress = normalizeSearchText(left.address);
  const rightAddress = normalizeSearchText(right.address);

  if (
    leftAddress &&
    rightAddress &&
    leftAddress !== rightAddress
  ) {
    return false;
  }

  // OSM commonly represents one venue as both a node and a building/area.
  return separation <= 40;
}

function representativeQuality(place) {
  if (!isGeographicPlace(place)) {
    return place.address ? -1 : 0;
  }

  const placeKind = normalizeSearchText(place.place);
  const type = normalizeSearchText(place.type);
  let score = 0;

  // Prefer the actual place node/way over the broader administrative
  // relation when both describe the same named destination.
  if (!GEOGRAPHIC_TYPES.has(placeKind)) score += 10;
  if (
    type === 'administrative' ||
    type === 'district' ||
    type === 'municipality' ||
    type === 'parish' ||
    type === 'region'
  ) score += 5;

  return score;
}

function deduplicateSearchMatches(matches, limit) {
  const resultLimit = Math.max(1, limit);
  const unique = [];
  const indexesByName = new Map();

  for (const candidate of matches) {
    const nameKey = normalizeSearchText(candidate.name);
    const sameNameIndexes = indexesByName.get(nameKey);

    // Matches are already ranked. Once the requested number of distinct
    // names is present, a later new name cannot enter the visible result
    // window. We still inspect later records for selected names so a better
    // node/way representative can replace an administrative duplicate.
    if (!sameNameIndexes && unique.length >= resultLimit) {
      continue;
    }

    const duplicateIndex = sameNameIndexes?.find(index =>
      sameSearchLocation(unique[index], candidate)
    ) ?? -1;

    if (duplicateIndex === -1) {
      if (unique.length >= resultLimit) {
        continue;
      }

      const index = unique.length;
      unique.push(candidate);

      if (sameNameIndexes) {
        sameNameIndexes.push(index);
      } else {
        indexesByName.set(nameKey, [index]);
      }

      continue;
    }

    const existing = unique[duplicateIndex];

    if (
      representativeQuality(candidate) <
      representativeQuality(existing)
    ) {
      unique[duplicateIndex] = {
        ...candidate,
        matchScore: Math.min(
          existing.matchScore,
          candidate.matchScore
        )
      };
    }
  }

  return unique;
}

function words(value) {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean);
}

function normalizePostcode(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function looksLikeUkPostcode(value) {
  const compact = normalizePostcode(value);

  return /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(compact) ||
    /^[A-Z]{1,2}\d[A-Z\d]?$/.test(compact);
}

function looksLikePortuguesePostcode(value) {
  return /^\d{4}(?:-?\d{0,3})?$/.test(
    String(value ?? '').trim()
  );
}

function parsedAddressQuery(value) {
  const normalized = normalizeSearchText(value);

  const match =
    normalized.match(/^([0-9]+[a-z]?(?:[-/][0-9]+[a-z]?)?)\s+(.+)$/);

  if (!match) {
    return null;
  }

  return {
    houseNumber: match[1],
    street: match[2]
  };
}

function editDistanceAtMostOne(left, right) {
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left === right) return true;

  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) return false;

    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }

  return true;
}

function tokenScore(token, fieldWords) {
  let best = Infinity;

  for (const word of fieldWords) {
    if (word === token) best = Math.min(best, 0);
    else if (word.startsWith(token)) best = Math.min(best, 1);
    else if (word.includes(token)) best = Math.min(best, 2);
    else if (
      token.length >= 4 &&
      editDistanceAtMostOne(token, word)
    ) best = Math.min(best, 3);
  }

  return best;
}

function searchEntry(feature, featureIndex) {
  const properties = feature?.properties ?? {};

  const houseNumber =
    normalizeSearchText(properties['addr:housenumber']);

  const street =
    normalizeSearchText(properties['addr:street']);

  const postcode =
    normalizePostcode(properties['addr:postcode']);

  const address = [
    properties['addr:housenumber'],
    properties['addr:street'],
    properties['addr:postcode'],
    properties['addr:city']
  ].filter(Boolean).join(' ');

  const category = [
    properties.amenity,
    properties.type,
    properties.place,
    CATEGORY_ALIASES[properties.amenity],
    CATEGORY_ALIASES[properties.type]
  ].filter(Boolean).join(' ');

  const fields = [
    ['name', properties.name],
    [
      'alternateName',
      [
        properties.alt_name,
        properties.short_name,
        properties.official_name,
        properties.loc_name,
        properties.old_name,
        properties['name:pt'],
        properties['name:en'],
        properties.ref
      ].filter(Boolean).join(' ')
    ],
    [
      'locality',
      [
        properties.place,
        properties['addr:city'],
        properties.municipality,
        properties.district
      ].filter(Boolean).join(' ')
    ],
    ['address', address],
    ['category', category]
  ].map(([kind, value]) => ({
    kind,
    text: normalizeSearchText(value),
    words: words(value)
  })).filter(field => field.text);

  return {
    index: featureIndex,
    fields,
    houseNumber,
    street,
    postcode
  };
}

function scoreSearchEntry(
  entry,
  normalizedQuery,
  queryTokens
) {
  const postcodeQuery =
    (
      looksLikeUkPostcode(normalizedQuery) ||
      looksLikePortuguesePostcode(normalizedQuery)
    )
      ? normalizePostcode(normalizedQuery)
      : null;

  const exactPostcode =
    postcodeQuery &&
    entry.postcode === postcodeQuery;

  const prefixPostcode =
    postcodeQuery &&
    entry.postcode &&
    entry.postcode.startsWith(postcodeQuery);

  const addressQuery =
    parsedAddressQuery(normalizedQuery);

  let exactAddress = false;
  let prefixAddress = false;
  let partialAddress = false;

  if (addressQuery) {
    const queryHouse =
      normalizeSearchText(
        addressQuery.houseNumber
      );

    const queryStreet =
      normalizeSearchText(
        addressQuery.street
      );

    exactAddress =
      entry.houseNumber === queryHouse &&
      entry.street === queryStreet;

    prefixAddress =
      entry.houseNumber === queryHouse &&
      entry.street.startsWith(queryStreet);

    partialAddress =
      entry.houseNumber === queryHouse &&
      entry.street.includes(queryStreet);
  }

  let score = 0;

  for (const token of queryTokens) {
    let tokenBest = Infinity;

    for (const field of entry.fields) {
      const match =
        tokenScore(token, field.words);

      if (!Number.isFinite(match)) {
        continue;
      }

      tokenBest = Math.min(
        tokenBest,
        match * 10 +
          SEARCH_FIELD_WEIGHTS[field.kind]
      );
    }

    if (!Number.isFinite(tokenBest)) {
      if (
        exactPostcode ||
        prefixPostcode ||
        exactAddress ||
        prefixAddress ||
        partialAddress
      ) {
        continue;
      }

      return null;
    }

    score += tokenBest;
  }

  const name =
    entry.fields.find(
      field => field.kind === 'name'
    )?.text ?? '';

  if (name === normalizedQuery) {
    score -= 40;
  } else if (name.startsWith(normalizedQuery)) {
    score -= 20;
  } else if (name.includes(normalizedQuery)) {
    score -= 8;
  }

  if (exactPostcode) {
    score -= 120;
  } else if (prefixPostcode) {
    score -= 70;
  }

  if (exactAddress) {
    score -= 140;
  } else if (prefixAddress) {
    score -= 110;
  } else if (partialAddress) {
    score -= 80;
  }

  return score;
}

import {
  resolveRegionAssetUrl
} from '../../regions/region-asset-url.js';

export class LocalRegionProvider {
  constructor({
    regionRepository,
    fetchFn = globalThis.fetch.bind(globalThis)
  } = {}) {
    if (!regionRepository) {
      throw new TypeError(
        'LocalRegionProvider requires a RegionRepository.'
      );
    }

    this.regionRepository = regionRepository;
    this.fetchFn = fetchFn;
    this.datasets = new Map();
    this.datasetPromises = new Map();
    this.poiFeaturePromises = new Map();
    this.spatialIndexPromises = new Map();
  }

  async search(anchor, radiusMeters = 900) {
    this.#validateAnchor(anchor);

    const region =
      await this.regionRepository.findByPosition(anchor);

    if (!region) {
      throw new Error(
        'No local Roam region is installed for this location.'
      );
    }

    const dataset = await this.#loadRegion(region, {
      includeSpatialIndex: true
    });
    const candidateIndexes = this.#candidateIndexes(
      dataset.index,
      anchor,
      radiusMeters
    );

    console.log(
      '[Nearby debug]',
      {
        anchor,
        region: region.id,
        features: dataset.features.length,
        candidates: candidateIndexes.length,
        radiusMeters
      }
    );

    if (candidateIndexes.length) {
      const firstFeature =
        dataset.features[candidateIndexes[0]];

      console.log(
        '[Nearby first candidate]',
        firstFeature
      );
    }

    return candidateIndexes
      .map(index => dataset.features[index])
      .filter(isNearbyFeature)
      .map(feature => this.#toPlace(feature, anchor))
      .filter(place =>
        place !== null &&
        place.distance <= radiusMeters
      )
      .sort((a, b) => a.distance - b.distance);
  }

  async searchByName(
    query,
    anchor,
    { limit = 12, includeScore = false } = {}
  ) {
    this.#validateAnchor(anchor);

    const normalizedQuery =
      normalizeSearchText(query);

    if (normalizedQuery.length < 2) {
      return [];
    }

    const region =
      await this.regionRepository
        .findByPosition(anchor);

    if (!region) {
      throw new Error(
        'No installed offline region covers the selected start point.'
      );
    }

    const dataset = await this.#loadRegion(region, {
      includeSpatialIndex: false
    });

    const compactPostcode =
      normalizePostcode(normalizedQuery)
        .toLowerCase();

    const isPostcodeQuery =
      looksLikeUkPostcode(normalizedQuery) ||
      looksLikePortuguesePostcode(normalizedQuery);

    const queryTokens =
      isPostcodeQuery && compactPostcode
        ? [compactPostcode]
        : normalizedQuery.split(/\s+/);

    let candidateIndexes = null;

    if (dataset.searchIndex) {
      const tokens =
        [...queryTokens];

      if (
        isPostcodeQuery &&
        compactPostcode
      ) {
        tokens.push(compactPostcode);
      }

      const tokenEntries =
        [...new Set(tokens)]
          .map(token => ({
            token,
            count: binarySearchIndexTokenCount(dataset.searchIndex, token)
          }))
          .filter(entry => Number.isFinite(entry.count))
          .sort((left, right) => left.count - right.count);

      /*
       * Inspect posting counts before decoding them. This avoids expanding
       * huge lists for generic terms on the browser UI thread when a much
       * more selective query token is already available.
       */
      let postingLists = [];
      if (tokenEntries.length) {
        const smallest = tokenEntries[0].count;
        const usefulLimit = Math.max(100_000, smallest * 100);
        const usefulEntries = [
          tokenEntries[0],
          ...tokenEntries
            .slice(1)
            .filter(entry => entry.count <= usefulLimit)
        ].slice(0, 4);

        postingLists = usefulEntries
          .map(entry => binarySearchIndexToken(dataset.searchIndex, entry.token))
          .filter(Boolean);
      }

      if (postingLists.length) {
        /*
         * Posting lists are already sorted. Merge them directly instead of
         * allocating one or more very large Sets on the browser UI thread.
         */
        let candidates = Array.from(postingLists[0]);

        for (
          let listIndex = 1;
          listIndex < postingLists.length;
          listIndex += 1
        ) {
          candidates = intersectSortedPostings(
            candidates,
            postingLists[listIndex]
          );

          if (!candidates.length) break;
        }

        /*
         * Never broaden an empty multi-token intersection into the union of
         * all terms. Generic words can make that union enormous and stall the
         * UI while still producing weak partial matches.
         */
        candidateIndexes = candidates;
      } else {
        candidateIndexes = [];
      }
    }

    /*
     * Older packages without search-index.json retain
     * the legacy search path.
     */
    let entries;

    if (candidateIndexes === null) {
      entries = (
        dataset.searchEntries ??=
          dataset.features
            .map(searchEntry)
            .filter(entry => entry.fields.length)
      );
    } else {
      entries = [];

      for (let position = 0; position < candidateIndexes.length; position += 1) {
        const index = candidateIndexes[position];
        let entry = dataset.searchEntryCache.get(index);

        if (!entry) {
          entry = searchEntry(
            this.#searchFeatureAt(dataset, index),
            index
          );

          if (dataset.searchEntryCache.size >= 25_000) {
            const oldest = dataset.searchEntryCache.keys().next().value;
            dataset.searchEntryCache.delete(oldest);
          }

          dataset.searchEntryCache.set(index, entry);
        }

        if (entry.fields.length) entries.push(entry);

        /*
         * Very broad tokens can match tens of thousands of POIs. Yield every
         * few hundred records so typing, animation and request cancellation
         * can continue instead of presenting as an application freeze.
         */
        if ((position + 1) % 512 === 0) {
          await yieldToSearchUi();
        }
      }
    }

    const matches = [];

    for (let position = 0; position < entries.length; position += 1) {
      const entry = entries[position];
      const matchScore = scoreSearchEntry(
        entry,
        normalizedQuery,
        queryTokens
      );

      if (matchScore !== null) {
        const place = this.#toPlace(
          this.#searchFeatureAt(dataset, entry.index),
          anchor
        );

        if (place) {
          matches.push({
            ...place,
            regionId: region.id,
            matchScore
          });
        }
      }

      if ((position + 1) % 512 === 0) {
        await yieldToSearchUi();
      }
    }

    matches.sort((a, b) =>
      a.matchScore - b.matchScore ||
      a.distance - b.distance ||
      String(a.name).localeCompare(String(b.name))
    );

    const deduplicated = deduplicateSearchMatches(matches, limit);

    if (includeScore) return deduplicated;

    return deduplicated
      .map(({ matchScore, ...place }) => place);
  }

  async #loadRegion(region, { includeSpatialIndex = true } = {}) {
    let dataset = this.datasets.get(region.id);

    if (!dataset) {
      let datasetPromise = this.datasetPromises.get(region.id);

      if (!datasetPromise) {
        datasetPromise = this.#loadSearchDataset(region);
        this.datasetPromises.set(region.id, datasetPromise);
      }

      try {
        dataset = await datasetPromise;
        this.datasets.set(region.id, dataset);
      } finally {
        this.datasetPromises.delete(region.id);
      }
    }

    if (includeSpatialIndex) {
      await this.#ensurePoiFeatures(region, dataset);

      if (!dataset.index) {
        await this.#ensureSpatialIndex(region, dataset);
      }
    }

    return dataset;
  }

  async #loadSearchDataset(region) {
    const poiUrl = this.#resolveRegionUrl(region.poiUrl);
    const configuredSearch = region.searchUrl ?? region.assets?.search;
    const configuredRecords = region.searchRecordsUrl ?? region.assets?.searchRecords;

    const binarySearchUrl = this.#resolveRegionUrl(
      configuredSearch?.endsWith('.bin')
        ? configuredSearch
        : poiUrl.replace(/pois\.geojson$/, 'search-index.bin')
    );
    const binaryRecordsUrl = this.#resolveRegionUrl(
      configuredRecords?.endsWith('.bin')
        ? configuredRecords
        : poiUrl.replace(/pois\.geojson$/, 'search-records.bin')
    );

    const [binaryIndexResponse, binaryRecordsResponse] = await Promise.all([
      this.#fetchRegionAsset(binarySearchUrl).catch(() => null),
      this.#fetchRegionAsset(binaryRecordsUrl).catch(() => null)
    ]);

    if (binaryIndexResponse?.ok && binaryRecordsResponse?.ok) {
      try {
        const [indexBuffer, recordsBuffer] = await Promise.all([
          binaryIndexResponse.arrayBuffer(),
          binaryRecordsResponse.arrayBuffer()
        ]);
        const searchIndex = parseBinarySearchIndex(indexBuffer);
        const binarySearchRecords = parseBinarySearchRecords(recordsBuffer);

        if (searchIndex && binarySearchRecords) {
          return {
            features: null,
            index: null,
            searchIndex,
            binarySearchRecords,
            searchRecords: null,
            searchRecordFields: null,
            searchEntries: null,
            searchEntryCache: new Map()
          };
        }
      } catch (error) {
        console.warn(`Unable to read binary search assets for ${region.name}; falling back to JSON.`, error);
      }
    }

    const searchUrl = this.#resolveRegionUrl(
      configuredSearch && !configuredSearch.endsWith('.bin')
        ? configuredSearch
        : poiUrl.replace(/pois\.geojson$/, 'search-index.json')
    );
    const searchRecordsUrl = this.#resolveRegionUrl(
      configuredRecords && !configuredRecords.endsWith('.bin')
        ? configuredRecords
        : poiUrl.replace(/pois\.geojson$/, 'search-records.json')
    );

    const [searchResponse, recordsResponse] = await Promise.all([
      this.#fetchRegionAsset(searchUrl).catch(() => null),
      this.#fetchRegionAsset(searchRecordsUrl).catch(() => null)
    ]);

    const [searchIndex, recordsDocument] = await Promise.all([
      searchResponse?.ok ? searchResponse.json() : Promise.resolve(null),
      recordsResponse?.ok ? recordsResponse.json() : Promise.resolve(null)
    ]);

    const validSearchIndex = searchIndex?.kind === 'atlas-text-index' ? searchIndex : null;
    const searchRecords = recordsDocument?.kind === 'atlas-search-records' && Array.isArray(recordsDocument.records)
      ? recordsDocument.records
      : null;
    const searchRecordFields = recordsDocument?.version >= 2 && Array.isArray(recordsDocument.fields)
      ? recordsDocument.fields
      : null;

    if (validSearchIndex && searchRecords) {
      return {
        features: null,
        index: null,
        searchIndex: validSearchIndex,
        binarySearchRecords: null,
        searchRecords,
        searchRecordFields,
        searchEntries: null,
        searchEntryCache: new Map()
      };
    }

    const poiResponse = await this.#fetchRegionAsset(poiUrl);
    if (!poiResponse.ok) {
      throw new Error(`Unable to load ${region.name} POIs: HTTP ${poiResponse.status}`);
    }
    const poiDocument = await poiResponse.json();

    return {
      features: poiDocument.features ?? [],
      index: null,
      searchIndex: validSearchIndex,
      binarySearchRecords: null,
      searchRecords: null,
      searchRecordFields: null,
      searchEntries: null,
      searchEntryCache: new Map()
    };
  }

  async #ensurePoiFeatures(region, dataset) {
    if (dataset.features) return;

    let poiPromise = this.poiFeaturePromises.get(region.id);

    if (!poiPromise) {
      poiPromise = (async () => {
        const poiUrl = this.#resolveRegionUrl(region.poiUrl);
        const poiResponse = await this.#fetchRegionAsset(poiUrl);

        if (!poiResponse.ok) {
          throw new Error(
            `Unable to load ${region.name} POIs: HTTP ${poiResponse.status}`
          );
        }

        const poiDocument = await poiResponse.json();
        dataset.features = poiDocument.features ?? [];
      })();

      this.poiFeaturePromises.set(region.id, poiPromise);
    }

    try {
      await poiPromise;
    } finally {
      this.poiFeaturePromises.delete(region.id);
    }
  }

  async #ensureSpatialIndex(region, dataset) {
    if (dataset.index) return;

    let indexPromise = this.spatialIndexPromises.get(region.id);

    if (!indexPromise) {
      indexPromise = (async () => {
        const poiUrl = this.#resolveRegionUrl(region.poiUrl);
        const indexUrl = this.#resolveRegionUrl(
          region.indexUrl ??
          region.poiUrl.replace(/pois\.geojson$/, 'poi-index.json')
        );
        const indexResponse = await this.#fetchRegionAsset(indexUrl);

        if (!indexResponse.ok) {
          throw new Error(
            `Unable to load ${region.name} spatial index: HTTP ${indexResponse.status}`
          );
        }

        const index = await indexResponse.json();

        if (
          index.kind !== 'uniform-grid' ||
          !Number.isFinite(index.cellSizeDegrees) ||
          !index.cells
        ) {
          throw new Error(
            `${region.name} has an unsupported spatial index.`
          );
        }

        dataset.index = index;
      })();

      this.spatialIndexPromises.set(region.id, indexPromise);
    }

    try {
      await indexPromise;
    } finally {
      this.spatialIndexPromises.delete(region.id);
    }
  }

  async #fetchRegionAsset(url) {
    if ('caches' in globalThis) {
      const cached =
        await caches.match(url);

      if (cached) {
        return cached;
      }
    }

    return this.fetchFn(
      url,
      {
        cache: 'no-store'
      }
    );
  }

  #candidateIndexes(index, anchor, radiusMeters) {
    const cellSize = index.cellSizeDegrees;
    const latitudeRadians = anchor.lat * Math.PI / 180;

    const latitudeDegrees = radiusMeters /
      METERS_PER_LATITUDE_DEGREE;

    const longitudeMetersPerDegree =
      METERS_PER_LATITUDE_DEGREE *
      Math.max(Math.cos(latitudeRadians), 0.01);

    const longitudeDegrees = radiusMeters /
      longitudeMetersPerDegree;

    const latitudeCellRadius =
      Math.ceil(latitudeDegrees / cellSize) + 1;

    const longitudeCellRadius =
      Math.ceil(longitudeDegrees / cellSize) + 1;

    const centerX = Math.floor(anchor.lon / cellSize);
    const centerY = Math.floor(anchor.lat / cellSize);
    const candidates = new Set();

    for (
      let x = centerX - longitudeCellRadius;
      x <= centerX + longitudeCellRadius;
      x += 1
    ) {
      for (
        let y = centerY - latitudeCellRadius;
        y <= centerY + latitudeCellRadius;
        y += 1
      ) {
        const cell = index.cells[`${x}:${y}`] ?? [];

        for (const featureIndex of cell) {
          candidates.add(featureIndex);
        }
      }
    }

    return [...candidates];
  }

  #searchFeatureAt(dataset, index) {
    if (dataset.binarySearchRecords) {
      return binarySearchFeature(dataset.binarySearchRecords, index);
    }

    if (dataset.searchRecords) {
      const record = dataset.searchRecords[index];

      if (!Array.isArray(record) || record.length < 3) {
        return null;
      }

      const [id, lon, lat] = record;
      let properties = {};

      if (dataset.searchRecordFields) {
        for (
          let fieldIndex = 0;
          fieldIndex < dataset.searchRecordFields.length;
          fieldIndex += 1
        ) {
          const value = record[fieldIndex + 3];

          if (value !== undefined && value !== null && value !== '') {
            properties[dataset.searchRecordFields[fieldIndex]] = value;
          }
        }
      } else {
        // Version 1 compatibility: [id, lon, lat, properties].
        properties = record[3] ?? {};
      }

      return {
        type: 'Feature',
        id,
        geometry: {
          type: 'Point',
          coordinates: [lon, lat]
        },
        properties
      };
    }

    return dataset.features?.[index] ?? null;
  }

  #resolveRegionUrl(url) {
    return resolveRegionAssetUrl(url);
  }

  #toPlace(feature, anchor) {
    if (
      feature?.geometry?.type !== 'Point' ||
      !Array.isArray(feature.geometry.coordinates)
    ) {
      return null;
    }

    const [lon, lat] = feature.geometry.coordinates;
    const properties = feature.properties ?? {};

    if (
      !properties.name ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      return null;
    }

    return {
      id:
        feature.id ??
        properties.osm_id ??
        `${properties.name}:${lat}:${lon}`,
      lat,
      lon,
      name: String(properties.name),
      amenity: properties.amenity ?? 'place',
      type: properties.type ?? 'attraction',
      place: properties.place ?? '',
      address: [
        properties['addr:housenumber'],
        properties['addr:street']
      ].filter(Boolean).join(' '),
      city:
        properties['addr:city'] ??
        properties.municipality ??
        properties.district ?? '',
      distance: distanceMeters(
        anchor.lat,
        anchor.lon,
        lat,
        lon
      )
    };
  }

  #validateAnchor(anchor) {
    if (
      !Number.isFinite(anchor?.lat) ||
      !Number.isFinite(anchor?.lon)
    ) {
      throw new TypeError(
        'Nearby search requires valid latitude and longitude.'
      );
    }
  }
}
