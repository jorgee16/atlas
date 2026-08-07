import {
  RegionCatalog,
  positionInRegion
} from '../regions/region-catalog.js';

import {
  RegionInstallStore
} from '../regions/region-install-store.js';

export class RegionRepository {
  constructor({
    catalog = new RegionCatalog(),
    installStore = new RegionInstallStore()
  } = {}) {
    this.catalog = catalog;
    this.installStore = installStore;
  }

  async list() {
    const installedIds =
      new Set(
        this.installStore
          .load()
          .map(region => region.id)
      );

    const catalogueRegions =
      await this.catalog.list();

    return catalogueRegions
      .filter(region =>
        region.bundled === true ||
        installedIds.has(region.id)
      )
      .map(region =>
        this.#normalizeCatalogueRegion(region)
      );
  }

  async findByPosition(position) {
    this.#validatePosition(position);

    const regions =
      await this.list();

    return (
      regions.find(region =>
        positionInRegion(
          region,
          position
        )
      ) ?? null
    );
  }

  #normalizeCatalogueRegion(region) {
    return {
      id: region.id,
      name: region.name,
      country: region.country,
      bounds: region.bounds,
      areas: region.areas,
      bundled: region.bundled === true,

      poiUrl:
        region.poiUrl ??
        region.assets?.pois,

      indexUrl:
        region.indexUrl ??
        region.assets?.index,

      mapUrl:
        region.mapUrl ??
        region.assets?.map
    };
  }

  #validatePosition(position) {
    if (
      !Number.isFinite(position?.lat) ||
      !Number.isFinite(position?.lon)
    ) {
      throw new TypeError(
        'Region lookup requires valid latitude and longitude.'
      );
    }
  }
}
