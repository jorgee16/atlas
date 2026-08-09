import { distanceMeters } from '../../utils.js';

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

  return { index: featureIndex, fields };
}

function scoreSearchEntry(entry, normalizedQuery, queryTokens) {
  let score = 0;

  for (const token of queryTokens) {
    let tokenBest = Infinity;

    for (const field of entry.fields) {
      const match = tokenScore(token, field.words);
      if (!Number.isFinite(match)) continue;

      tokenBest = Math.min(
        tokenBest,
        match * 10 + SEARCH_FIELD_WEIGHTS[field.kind]
      );
    }

    if (!Number.isFinite(tokenBest)) return null;
    score += tokenBest;
  }

  const name = entry.fields.find(field => field.kind === 'name')?.text ?? '';
  if (name === normalizedQuery) score -= 40;
  else if (name.startsWith(normalizedQuery)) score -= 20;
  else if (name.includes(normalizedQuery)) score -= 8;

  return score;
}

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

    const dataset = await this.#loadRegion(region);
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

    const dataset = await this.#loadRegion(region);
    const queryTokens =
      normalizedQuery.split(/\s+/);

    dataset.searchEntries ??=
      dataset.features
        .map(searchEntry)
        .filter(entry => entry.fields.length);

    const matches = dataset.searchEntries
      .map(entry => {
        const matchScore = scoreSearchEntry(
          entry,
          normalizedQuery,
          queryTokens
        );

        if (matchScore === null) return null;

        const place = this.#toPlace(
          dataset.features[entry.index],
          anchor
        );

        if (!place) {
          return null;
        }

        return {
          ...place,
          regionId: region.id,
          matchScore
        };
      })
      .filter(Boolean)
      .sort((a, b) =>
        a.matchScore - b.matchScore ||
        a.distance - b.distance ||
        String(a.name).localeCompare(String(b.name))
      );

    const deduplicated = deduplicateSearchMatches(matches, limit);

    if (includeScore) return deduplicated;

    return deduplicated
      .map(({ matchScore, ...place }) => place);
  }

  async #loadRegion(region) {
    if (this.datasets.has(region.id)) {
      return this.datasets.get(region.id);
    }

    const poiUrl = this.#resolveRegionUrl(region.poiUrl);
    const indexUrl = this.#resolveRegionUrl(
      region.indexUrl ??
      region.poiUrl.replace(/pois\.geojson$/, 'poi-index.json')
    );

    const [poiResponse, indexResponse] =
      await Promise.all([
        this.#fetchRegionAsset(poiUrl),
        this.#fetchRegionAsset(indexUrl)
      ]);

    if (!poiResponse.ok) {
      throw new Error(
        `Unable to load ${region.name} POIs: HTTP ${poiResponse.status}`
      );
    }

    if (!indexResponse.ok) {
      throw new Error(
        `Unable to load ${region.name} spatial index: HTTP ${indexResponse.status}`
      );
    }

    const [poiDocument, index] = await Promise.all([
      poiResponse.json(),
      indexResponse.json()
    ]);

    const dataset = {
      features: poiDocument.features ?? [],
      index,
      searchEntries: null
    };

    if (
      index.kind !== 'uniform-grid' ||
      !Number.isFinite(index.cellSizeDegrees) ||
      !index.cells
    ) {
      throw new Error(
        `${region.name} has an unsupported spatial index.`
      );
    }

    this.datasets.set(region.id, dataset);
    return dataset;
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

  #resolveRegionUrl(url) {
    const relativeUrl = String(url).replace(/^\//, '');
    const baseUrl =
      import.meta.env?.BASE_URL ?? '/';

    return `${baseUrl}${relativeUrl}`;
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
