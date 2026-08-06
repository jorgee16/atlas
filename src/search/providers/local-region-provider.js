import { distanceMeters } from '../../utils.js';

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

    const features = await this.#loadFeatures(region);

    return features
      .map(feature => this.#toPlace(feature, anchor))
      .filter(place =>
        place !== null &&
        place.distance <= radiusMeters
      )
      .sort((a, b) => a.distance - b.distance);
  }

  async #loadFeatures(region) {
    if (this.datasets.has(region.id)) {
      return this.datasets.get(region.id);
    }

    const poiUrl = this.#resolvePoiUrl(region.poiUrl);

    const response = await this.fetchFn(poiUrl, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(
        `Unable to load ${region.name} POIs: HTTP ${response.status}`
      );
    }

    const document = await response.json();
    const features = document.features ?? [];

    this.datasets.set(region.id, features);
    return features;
  }

  #resolvePoiUrl(poiUrl) {
    const relativeUrl = String(poiUrl).replace(/^\//, '');
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
