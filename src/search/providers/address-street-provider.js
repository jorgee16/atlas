import { distanceMeters } from '../../utils.js';
import { resolveRegionAssetUrl } from '../../regions/region-asset-url.js';
import {
  parseBinarySearchIndex,
  binarySearchIndexToken,
  binarySearchIndexTokenCount,
  intersectSortedPostings,
  parseBinarySearchRecords,
  binarySearchFeature
} from './local-region-provider.js';

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizePostcode(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .toLowerCase();
}

const ADDRESS_INDEX_STOP_WORDS = new Set([
  'a', 'as', 'da', 'das', 'de', 'do', 'dos', 'e',
  'of', 'the'
]);

const ADDRESS_INDEX_DESIGNATORS = new Set([
  'alameda', 'avenida', 'av', 'beco', 'boulevard', 'blvd',
  'calcada', 'close', 'court', 'ct', 'drive', 'dr', 'estrada',
  'lane', 'ln', 'largo', 'place', 'pl', 'praca', 'praceta',
  'road', 'rd', 'rua', 'street', 'st', 'travessa', 'way'
]);

function candidateQueryTokens(parsed) {
  const significant = parsed.tokens.filter(token =>
    /^\d/.test(token) ||
    (!ADDRESS_INDEX_STOP_WORDS.has(token) &&
      !ADDRESS_INDEX_DESIGNATORS.has(token) &&
      token.length >= 3)
  );

  // A query made only from a generic road designator (for example "Rua")
  // is not selective enough to search a million-address region safely.
  return [...new Set(significant)];
}

function queryParts(value) {
  const text = normalize(value);
  const raw = text.split(/\s+/).filter(Boolean);
  const houseNumber = raw.find(token => /^\d+[a-z]?(?:[-/]\d+[a-z]?)?$/.test(token)) ?? null;
  const postcode = raw.find(token => /^\d{4}-?\d{0,3}$/.test(token)) ?? null;
  const compactUk = normalizePostcode(value);
  const ukPostcode = /^[a-z]{1,2}\d[a-z\d]?\d[a-z]{2}$/.test(compactUk)
    ? compactUk
    : null;
  const tokens = raw.filter(token => token !== houseNumber && token !== postcode);

  if (houseNumber) tokens.unshift(houseNumber);
  if (postcode) tokens.push(normalizePostcode(postcode));
  if (ukPostcode) tokens.push(ukPostcode);

  return {
    text,
    houseNumber,
    postcode: postcode ? normalizePostcode(postcode) : ukPostcode,
    tokens: [...new Set(tokens.filter(token => token.length >= 2 || /^\d/.test(token)))]
  };
}

function featureAddress(feature) {
  const properties = feature?.properties ?? {};
  return [
    properties['addr:housenumber'],
    properties['addr:street'] ?? properties.name,
    properties['addr:postcode'],
    properties['addr:city']
  ].filter(Boolean).join(', ');
}

function scoreFeature(feature, parsed, anchor) {
  const properties = feature?.properties ?? {};
  const kind = normalize(properties.type || properties.amenity);
  const name = normalize(properties.name);
  const street = normalize(properties['addr:street'] || properties.name);
  const house = normalize(properties['addr:housenumber']);
  const postcode = normalizePostcode(properties['addr:postcode']);
  const city = normalize(properties['addr:city'] || properties.municipality || properties.district);
  const haystack = `${name} ${street} ${house} ${postcode} ${city}`.trim();

  if (!parsed.tokens.every(token => haystack.includes(token))) return null;

  let score = kind === 'address' ? 0 : 18;

  if (parsed.houseNumber) {
    if (house === normalize(parsed.houseNumber)) score -= 45;
    else if (kind === 'address') score += 30;
  }

  if (parsed.postcode) {
    if (postcode === parsed.postcode) score -= 35;
    else if (postcode) score += 20;
  }

  const streetQuery = parsed.tokens
    .filter(token => token !== normalize(parsed.houseNumber) && token !== parsed.postcode)
    .join(' ');

  if (streetQuery) {
    if (street === streetQuery || name === streetQuery) score -= 30;
    else if (street.startsWith(streetQuery) || name.startsWith(streetQuery)) score -= 18;
    else if (street.includes(streetQuery) || name.includes(streetQuery)) score -= 8;
  }

  const [lon, lat] = feature?.geometry?.coordinates ?? [];
  const distance = Number.isFinite(lat) && Number.isFinite(lon)
    ? distanceMeters(anchor.lat, anchor.lon, lat, lon)
    : Infinity;

  // Distance is a tie-breaker, not the main relevance signal.
  score += Math.min(distance / 50_000, 8);

  return { score, distance };
}

function mergePostingLists(index, tokens) {
  if (!tokens.length) return [];

  const entries = tokens
    .map(token => ({
      token,
      count: binarySearchIndexTokenCount(index, token)
    }));

  // Missing distinctive terms mean this dedicated index has no faithful
  // match. Return nothing and let queryDestinations use the routing-road
  // compatibility fallback instead of silently dropping words.
  if (entries.some(entry => !Number.isFinite(entry.count))) return [];

  entries.sort((left, right) => left.count - right.count);

  // The rarest few terms are enough to generate candidates; scoreFeature()
  // still verifies the complete query against each decoded record. Avoid
  // decoding generic posting lists that can contain hundreds of thousands of
  // IDs on the main thread.
  const usefulEntries = entries.slice(0, 4);
  const lists = usefulEntries
    .map(entry => binarySearchIndexToken(index, entry.token))
    .filter(Boolean);

  if (!lists.length) return [];

  let candidates = Array.from(lists[0]);
  for (let i = 1; i < lists.length; i += 1) {
    candidates = intersectSortedPostings(candidates, lists[i]);
    if (!candidates.length) break;
  }

  // Do not union an empty intersection. That was the source of both weak
  // partial address matches and intermittent UI freezes on common words.
  return candidates;
}

export class AddressStreetProvider {
  constructor({ regionRepository, fetchFn = null } = {}) {
    if (!regionRepository) {
      throw new TypeError('AddressStreetProvider requires a RegionRepository.');
    }
    this.regionRepository = regionRepository;
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
    this.indexes = new Map();
    this.indexPromises = new Map();
    this.records = new Map();
    this.recordPromises = new Map();
  }

  async search(query, anchor, { limit = 12 } = {}) {
    if (!Number.isFinite(anchor?.lat) || !Number.isFinite(anchor?.lon)) {
      throw new TypeError('Address search requires valid latitude and longitude.');
    }

    const parsed = queryParts(query);
    if (!parsed.text || parsed.tokens.length === 0) return [];

    const region = await this.regionRepository.findByPosition(anchor);
    if (!region) return [];

    const index = await this.#loadIndex(region);
    if (!index) return [];

    const candidateTokens = candidateQueryTokens(parsed);
    const candidateIndexes = mergePostingLists(index, candidateTokens);
    if (!candidateIndexes.length) return [];

    const records = await this.#loadRecords(region);
    if (!records) return [];

    const matches = [];
    const seen = new Set();

    for (let position = 0; position < candidateIndexes.length; position += 1) {
      const feature = binarySearchFeature(records, candidateIndexes[position]);
      if (!feature) continue;
      const scored = scoreFeature(feature, parsed, anchor);
      if (!scored) continue;

      const properties = feature.properties ?? {};
      const [lon, lat] = feature.geometry.coordinates;
      const name = properties.type === 'address'
        ? properties.name || [properties['addr:housenumber'], properties['addr:street']].filter(Boolean).join(' ')
        : properties.name || properties['addr:street'];
      const dedupeKey = `${normalize(name)}|${normalize(properties['addr:city'])}|${Math.round(lat * 1000)}|${Math.round(lon * 1000)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      matches.push({
        id: `address:${region.id}:${feature.id}`,
        lat,
        lon,
        name,
        amenity: properties.type === 'address' ? 'address' : 'street',
        type: properties.type || 'street',
        place: '',
        address: featureAddress(feature),
        city: properties['addr:city'] || properties.municipality || '',
        postcode: properties['addr:postcode'] || '',
        regionId: region.id,
        distance: scored.distance,
        matchScore: scored.score
      });

      if ((position + 1) % 512 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    return matches
      .sort((a, b) => a.matchScore - b.matchScore || a.distance - b.distance)
      .slice(0, Math.max(1, limit));
  }

  #assetUrls(region) {
    const poiUrl = String(region.poiUrl ?? region.assets?.pois ?? '');
    return {
      indexUrl: resolveRegionAssetUrl(
        region.addressSearchUrl ??
          region.assets?.addressSearch ??
          poiUrl.replace(/pois\.geojson(?:\?.*)?$/, 'address-index.bin')
      ),
      recordsUrl: resolveRegionAssetUrl(
        region.addressRecordsUrl ??
          region.assets?.addressRecords ??
          poiUrl.replace(/pois\.geojson(?:\?.*)?$/, 'address-records.bin')
      )
    };
  }

  async #loadIndex(region) {
    if (this.indexes.has(region.id)) return this.indexes.get(region.id);
    if (this.indexPromises.has(region.id)) return this.indexPromises.get(region.id);

    const promise = (async () => {
      const { indexUrl } = this.#assetUrls(region);
      if (!indexUrl) return null;
      const response = await this.#fetch(indexUrl).catch(() => null);
      if (!response?.ok) return null;
      const index = parseBinarySearchIndex(await response.arrayBuffer());
      return index ?? null;
    })();

    this.indexPromises.set(region.id, promise);
    try {
      const index = await promise;
      this.indexes.set(region.id, index);
      return index;
    } finally {
      this.indexPromises.delete(region.id);
    }
  }

  async #loadRecords(region) {
    if (this.records.has(region.id)) return this.records.get(region.id);
    if (this.recordPromises.has(region.id)) return this.recordPromises.get(region.id);

    const promise = (async () => {
      const { recordsUrl } = this.#assetUrls(region);
      if (!recordsUrl) return null;
      const response = await this.#fetch(recordsUrl).catch(() => null);
      if (!response?.ok) return null;
      const records = parseBinarySearchRecords(await response.arrayBuffer());
      return records ?? null;
    })();

    this.recordPromises.set(region.id, promise);
    try {
      const records = await promise;
      this.records.set(region.id, records);
      return records;
    } finally {
      this.recordPromises.delete(region.id);
    }
  }

  async #fetch(url) {
    if ('caches' in globalThis) {
      const cached = await caches.match(url);
      if (cached) return cached;
    }
    return this.fetchFn(url, { cache: 'no-store' });
  }
}
