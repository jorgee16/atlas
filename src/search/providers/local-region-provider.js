import { distanceMeters } from '../../utils.js';

const METERS_PER_LATITUDE_DEGREE = 111_320;

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
      .map(feature => this.#toPlace(feature, anchor))
      .filter(place =>
        place !== null &&
        place.distance <= radiusMeters
      )
      .sort((a, b) => a.distance - b.distance);
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
      index
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
    return `${import.meta.env.BASE_URL}${relativeUrl}`;
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
      name: properties.name,
      amenity: properties.amenity ?? 'place',
      type: properties.type ?? 'attraction',
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
