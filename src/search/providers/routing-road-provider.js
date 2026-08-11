import { distanceMeters } from '../../utils.js';
import { RoutingRepository } from '../../routing/routing-repository.js';

const STREET_WORDS = new Set([
  'street', 'st', 'road', 'rd', 'avenue', 'ave', 'lane', 'ln',
  'drive', 'dr', 'way', 'place', 'pl', 'terrace', 'close',
  'crescent', 'gardens', 'square', 'court', 'parade', 'highway'
]);

const PORTUGUESE_STREET_PREFIXES = new Set([
  'rua',
  'avenida',
  'av',
  'travessa',
  'estrada',
  'caminho',
  'alameda',
  'largo',
  'praca',
  'rotunda',
  'calcada',
  'beco'
]);

function looksLikePortuguesePostcodeToken(value) {
  return /^\d{4}-?\d{3}$/.test(
    String(value ?? '').trim()
  );
}

const AIRPORT_WORDS = /\b(airport|terminal|heathrow|gatwick|stansted|luton)\b/i;

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(value) {
  return normalize(value).split(/\s+/).filter(Boolean);
}

function cleanDestinationSegment(value) {
  return String(value ?? '')
    .split('/')[0]
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function destinationSegments(value) {
  return String(value ?? '')
    .split(';')
    .map(cleanDestinationSegment)
    .filter(segment => segment && AIRPORT_WORDS.test(segment));
}

function pointInBounds(point, bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4) return true;
  const [west, south, east, north] = bounds;
  return point.lon >= west && point.lon <= east &&
    point.lat >= south && point.lat <= north;
}

function roadQuery(query, region) {
  const regionTokens = new Set([
    ...tokens(region?.name),
    ...tokens(region?.country)
  ]);

  const rawTokens = tokens(query)
    .filter(token => !regionTokens.has(token));

  const houseNumber =
    rawTokens.length &&
    /^\d+[a-z]?$/.test(rawTokens[0])
      ? rawTokens[0]
      : null;

  let queryTokens = rawTokens
    .filter((token, index) =>
      !(index === 0 && houseNumber) &&
      !looksLikePortuguesePostcodeToken(token)
    );

  /*
   * English street types are normally suffixes:
   *   Downing Street
   *
   * Portuguese street types are normally prefixes:
   *   Rua Professor Albuquerque de Matos
   *
   * Do not apply the English suffix truncation rule to Portuguese names.
   */
  const portuguesePrefix =
    PORTUGUESE_STREET_PREFIXES.has(
      queryTokens[0]
    );

  if (!portuguesePrefix) {
    const streetIndex =
      queryTokens.findIndex(
        token => STREET_WORDS.has(token)
      );

    if (streetIndex >= 0) {
      const start =
        Math.max(
          0,
          streetIndex - 4
        );

      queryTokens =
        queryTokens.slice(
          start,
          streetIndex + 1
        );
    }
  }

  return {
    text: queryTokens.join(' '),
    tokens: queryTokens,
    houseNumber
  };
}

function tokenMatchScore(token, words) {
  let best = Infinity;
  for (const word of words) {
    if (word === token) best = Math.min(best, 0);
    else if (word.startsWith(token)) best = Math.min(best, 2);
    else if (token.length >= 4 && word.includes(token)) best = Math.min(best, 5);
  }
  return best;
}

function scoreEntry(entry, query) {
  if (!query.tokens.length) return null;

  let score = entry.kind === 'airport-access' ? 20 : 10;
  const fieldWords = tokens(entry.searchText);

  for (const token of query.tokens) {
    const tokenScore = tokenMatchScore(token, fieldWords);
    if (!Number.isFinite(tokenScore)) return null;
    score += tokenScore;
  }

  const normalizedField = normalize(entry.searchText);
  if (normalizedField === query.text) score -= 45;
  else if (normalizedField.startsWith(query.text)) score -= 25;
  else if (normalizedField.includes(query.text)) score -= 10;

  return score;
}

function routingAssetsForAnchor(region, anchor) {
  const routing = region?.routing;
  if (!Array.isArray(routing?.partitions)) return routing;

  return routing.partitions.find(partition =>
    pointInBounds(anchor, partition.bounds)
  ) ?? null;
}

export class RoutingRoadProvider {
  constructor({
    regionRepository,
    routingRepository = new RoutingRepository({ regionRepository })
  } = {}) {
    if (!regionRepository) {
      throw new TypeError('RoutingRoadProvider requires a RegionRepository.');
    }

    this.regionRepository = regionRepository;
    this.routingRepository = routingRepository;
    this.indexes = new WeakMap();
  }

  async searchByName(query, anchor, { limit = 12 } = {}) {
    if (!Number.isFinite(anchor?.lat) || !Number.isFinite(anchor?.lon)) {
      throw new TypeError('Road search requires valid latitude and longitude.');
    }

    const region = await this.regionRepository.findByPosition(anchor);
    if (!region) return [];

    const parsedQuery = roadQuery(query, region);
    if (parsedQuery.text.length < 2 || !parsedQuery.tokens.length) return [];

    const routing = routingAssetsForAnchor(region, anchor);
    if (!routing) return [];

    let dataset;
    try {
      dataset = await this.routingRepository.load(region, routing);
    } catch {
      // Destination search must continue to work with POIs even if a region
      // has no routing asset installed yet.
      return [];
    }

    const index = this.#index(dataset.graph);
    const ranked = index.entries
      .map((entry, groupIndex) => ({
        groupIndex,
        entry,
        score: scoreEntry(entry, parsedQuery)
      }))
      .filter(match => match.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, Math.max(limit * 3, 24));

    if (!ranked.length) return [];

    const representatives = this.#nearestRepresentatives(
      dataset.graph,
      index.roadToGroup,
      new Set(ranked.map(match => match.groupIndex)),
      anchor,
      region.bounds
    );

    return ranked
      .map(match => {
        const point = representatives.get(match.groupIndex);
        if (!point) return null;

        const airportAlias = parsedQuery.tokens.some(token => AIRPORT_WORDS.test(token))
          ? match.entry.airportAliases?.find(alias =>
              parsedQuery.tokens.every(token =>
                tokens(alias).some(word => word === token || word.includes(token))
              )
            )
          : null;
        const resultKind = airportAlias ? 'airport-access' : match.entry.kind;

        return {
          id: `road:${region.id}:${match.entry.key}`,
          lat: point.lat,
          lon: point.lon,
          name:
            airportAlias ??
            (
              parsedQuery.houseNumber
                ? `${parsedQuery.houseNumber} ${match.entry.name}`
                : match.entry.name
            ),
          amenity: resultKind === 'airport-access'
            ? 'airport'
            : 'street',
          type: resultKind,
          place: '',
          address:
            resultKind === 'airport-access'
              ? ''
              : parsedQuery.houseNumber
                ? `${parsedQuery.houseNumber} ${match.entry.name}`
                : match.entry.name,
          city: region.name,
          subtitle: resultKind === 'airport-access'
            ? 'Airport access · offline road data'
            : parsedQuery.houseNumber
              ? 'Approximate address · matched to street'
              : 'Street · offline road data',
          distance: point.distance,
          regionId: region.id,
          matchScore: match.score
        };
      })
      .filter(Boolean)
      .sort((a, b) =>
        a.matchScore - b.matchScore ||
        a.distance - b.distance
      )
      .slice(0, limit);
  }

  #index(graph) {
    if (this.indexes.has(graph)) return this.indexes.get(graph);

    const entries = [];
    const groupByKey = new Map();
    const roadToGroup = new Int32Array(graph.roadCount);
    roadToGroup.fill(-1);

    const addEntry = ({ key, name, searchText, kind, roadIndex }) => {
      const normalizedKey = `${kind}:${normalize(key)}`;
      let groupIndex = groupByKey.get(normalizedKey);

      if (groupIndex === undefined) {
        groupIndex = entries.length;
        groupByKey.set(normalizedKey, groupIndex);
        entries.push({
          key: normalize(key),
          name,
          searchText,
          kind
        });
      }

      roadToGroup[roadIndex] = groupIndex;
    };

    for (let roadIndex = 0; roadIndex < graph.roadCount; roadIndex += 1) {
      const road = graph.road(roadIndex);
      const name = String(road.name ?? '').trim();

      if (name) {
        const airportAliases = destinationSegments(road.destination);
        addEntry({
          key: name,
          name,
          searchText: [name, road.ref, ...airportAliases]
            .filter(Boolean)
            .join(' '),
          kind: /\bairport\b/i.test(name) ? 'airport-access' : 'street',
          roadIndex
        });
        const groupedEntry = entries[roadToGroup[roadIndex]];
        groupedEntry.airportAliases ??= [];
        for (const alias of airportAliases) {
          if (!groupedEntry.airportAliases.includes(alias)) {
            groupedEntry.airportAliases.push(alias);
            groupedEntry.searchText += ` ${alias}`;
          }
        }
        continue;
      }

      // Unnamed motorway links often contain useful airport destinations.
      // Keep only airport-like sign destinations to avoid polluting general
      // destination search with every directional sign in the road graph.
      const airportSegment = destinationSegments(road.destination)[0];
      if (airportSegment) {
        addEntry({
          key: airportSegment,
          name: airportSegment,
          searchText: airportSegment,
          kind: 'airport-access',
          roadIndex
        });
      }
    }

    const index = { entries, roadToGroup };
    this.indexes.set(graph, index);
    return index;
  }

  #nearestRepresentatives(graph, roadToGroup, targetGroups, anchor, bounds) {
    const result = new Map();

    for (let nodeIndex = 0; nodeIndex < graph.nodeCount; nodeIndex += 1) {
      const from = graph.edgeOffset(nodeIndex);
      const to = graph.edgeOffset(nodeIndex + 1);
      if (from === to) continue;

      let point = null;

      for (let edgeIndex = from; edgeIndex < to; edgeIndex += 1) {
        const roadIndex = graph.edgeRoad(edgeIndex);
        const groupIndex = roadToGroup[roadIndex];
        if (groupIndex < 0 || !targetGroups.has(groupIndex)) continue;

        point ??= graph.node(nodeIndex);
        if (!pointInBounds(point, bounds)) continue;

        const distance = distanceMeters(
          anchor.lat,
          anchor.lon,
          point.lat,
          point.lon
        );

        const current = result.get(groupIndex);
        if (!current || distance < current.distance) {
          result.set(groupIndex, {
            lat: point.lat,
            lon: point.lon,
            distance
          });
        }
      }
    }

    return result;
  }
}
