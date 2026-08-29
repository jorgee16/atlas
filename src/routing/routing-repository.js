import {
  RegionRepository
} from '../search/region-repository.js';

import {
  RoutingGraph
} from './routing-graph.js';

import {
  TollEventIndex
} from './toll-event-index.js';

import {
  defaultRegionAssetOrigin,
  resolveRegionAssetUrl
} from '../regions/region-asset-url.js';

export class RoutingRepository {
  constructor({
    regionRepository =
      new RegionRepository(),
    fetchFn = globalThis.fetch.bind(
      globalThis
    ),
    baseUrl =
      import.meta.env?.BASE_URL ?? '/',
    origin =
      defaultRegionAssetOrigin()
  } = {}) {
    this.regionRepository =
      regionRepository;

    this.fetchFn = fetchFn;
    this.baseUrl = baseUrl;
    this.origin = origin;
    this.datasets = new Map();
  }

  async loadForEndpoints(
    origin,
    destination
  ) {
    const [originRegion, destinationRegion] =
      await Promise.all([
        this.regionRepository
          .findByPosition(origin),
        this.regionRepository
          .findByPosition(destination)
      ]);

    if (!originRegion) {
      throw new Error(
        'No installed routing region covers the starting point.'
      );
    }

    if (!destinationRegion) {
      throw new Error(
        'No installed routing region covers the destination.'
      );
    }

    if (
      originRegion.id !==
      destinationRegion.id
    ) {
      throw new Error(
        'The endpoints are in different offline routing regions.'
      );
    }

    const routing =
      this.#routingForEndpoints(
        originRegion.routing,
        origin,
        destination
      );

    return this.load(
      originRegion,
      routing
    );
  }

  async load(
    region,
    routing = region?.routing
  ) {
    if (!region?.id) {
      throw new TypeError(
        'RoutingRepository.load requires a region.'
      );
    }

    const cacheKey = [
      region.id,
      routing?.id ?? 'default'
    ].join(':');

    if (this.datasets.has(cacheKey)) {
      return this.datasets.get(cacheKey);
    }

    const loading =
      this.#loadRegion(
        region,
        routing
      );

    this.datasets.set(cacheKey, loading);

    try {
      return await loading;
    } catch (error) {
      this.datasets.delete(cacheKey);
      throw error;
    }
  }

  async #loadRegion(region, assets) {
    if (
      !assets?.metadata ||
      !assets?.nodes ||
      !assets?.edges ||
      !assets?.geometry ||
      !assets?.roads ||
      !assets?.strings ||
      !assets?.restrictions ||
      !assets?.spatialIndex
    ) {
      throw new Error(
        `${region.name} does not include an offline car-routing graph yet.`
      );
    }

    const urls = {
      metadata:
        this.#resolveRegionUrl(
          assets.metadata
        ),
      nodes:
        this.#resolveRegionUrl(
          assets.nodes
        ),
      edges:
        this.#resolveRegionUrl(
          assets.edges
        ),
      geometry:
        this.#resolveRegionUrl(
          assets.geometry
        ),
      roads:
        this.#resolveRegionUrl(
          assets.roads
        ),
      strings:
        this.#resolveRegionUrl(
          assets.strings
        ),
      restrictions:
        this.#resolveRegionUrl(
          assets.restrictions
        ),
      spatialIndex:
        this.#resolveRegionUrl(
          assets.spatialIndex
        )
    };

    const responses =
      await Promise.all(
        Object.entries(urls).map(
          async ([name, url]) => [
            name,
            await this.#fetchRegionAsset(url)
          ]
        )
      );

    for (const [name, response] of responses) {
      if (!response.ok) {
        throw new Error(
          `Unable to load ${region.name} routing ${name}: HTTP ${response.status}`
        );
      }
    }

    const responseMap =
      Object.fromEntries(responses);

    const [
      metadata,
      nodes,
      edges,
      geometry,
      roads,
      strings,
      restrictions,
      spatialIndex,
      tollEventsDocument
    ] = await Promise.all([
      responseMap.metadata.json(),
      responseMap.nodes.arrayBuffer(),
      responseMap.edges.arrayBuffer(),
      responseMap.geometry.arrayBuffer(),
      responseMap.roads.arrayBuffer(),
      responseMap.strings.arrayBuffer(),
      responseMap.restrictions.arrayBuffer(),
      responseMap.spatialIndex.arrayBuffer(),
      this.#loadOptionalTollEvents(assets)
    ]);

    const graph = new RoutingGraph({
      nodes,
      edges,
      geometry,
      roads,
      strings,
      restrictions,
      spatialIndex,
      metadata
    });

    const profiles =
      Array.isArray(metadata.profiles)
        ? metadata.profiles
        : [];

    const validProfiles =
      metadata.version === 6 &&
      profiles.includes('drive') &&
      profiles.includes('walk');

    if (
      !validProfiles ||
      metadata.nodeCount !==
        graph.nodeCount ||
      metadata.directedEdgeCount !==
        graph.edgeCount ||
      metadata.geometryArcCount !==
        graph.geometryArcCount ||
      metadata.geometryPointCount !==
        graph.geometryPointCount ||
      metadata.roadCount !==
        graph.roadCount ||
      metadata.turnRestrictionCount !==
        graph.restrictionCount
    ) {
      throw new Error(
        `${region.name} routing metadata does not match its binary graph.`
      );
    }

    return {
      region,
      partitionId: assets.id ?? null,
      metadata,
      graph,
      tollEvents: new TollEventIndex(
        tollEventsDocument
      )
    };
  }

  async #loadOptionalTollEvents(assets) {
    const explicit = assets?.tollEvents;
    const sibling = explicit || this.#siblingAsset(
      assets?.metadata,
      'toll-events.json'
    );

    if (!sibling) return null;

    try {
      const response = await this.#fetchRegionAsset(
        this.#resolveRegionUrl(sibling)
      );

      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  #siblingAsset(asset, filename) {
    const value = String(asset ?? '');
    const slash = value.lastIndexOf('/');
    if (slash < 0) return null;
    return `${value.slice(0, slash + 1)}${filename}`;
  }

  #routingForEndpoints(
    routing,
    origin,
    destination
  ) {
    const partitions =
      routing?.partitions;

    if (!Array.isArray(partitions)) {
      return routing;
    }

    const originPartition =
      partitions.find(partition =>
        this.#positionInBounds(
          origin,
          partition.bounds
        )
      );

    const destinationPartition =
      partitions.find(partition =>
        this.#positionInBounds(
          destination,
          partition.bounds
        )
      );

    if (!originPartition) {
      throw new Error(
        'No routing partition covers the starting point.'
      );
    }

    if (!destinationPartition) {
      throw new Error(
        'No routing partition covers the destination.'
      );
    }

    if (
      originPartition.id !==
      destinationPartition.id
    ) {
      throw new Error(
        'The endpoints are in disconnected routing partitions.'
      );
    }

    return originPartition;
  }

  #positionInBounds(position, bounds) {
    if (
      !Array.isArray(bounds) ||
      bounds.length !== 4 ||
      !bounds.every(Number.isFinite)
    ) {
      return false;
    }

    const [
      left,
      bottom,
      right,
      top
    ] = bounds;

    return (
      position.lon >= left &&
      position.lon <= right &&
      position.lat >= bottom &&
      position.lat <= top
    );
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

  #resolveRegionUrl(url) {
    return resolveRegionAssetUrl(
      url,
      {
        baseUrl: this.baseUrl,
        origin: this.origin
      }
    );
  }
}
