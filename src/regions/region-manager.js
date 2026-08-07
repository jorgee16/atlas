import {
  RegionCatalog
} from './region-catalog.js';

import {
  RegionInstallStore
} from './region-install-store.js';

import {
  RegionDownloader
} from './region-downloader.js';

export class RegionManager {
  constructor({
    catalog = new RegionCatalog(),
    store = new RegionInstallStore(),
    downloader = new RegionDownloader(),
    status = () => {},
    onDownloadRequired = null
  } = {}) {
    this.catalog = catalog;
    this.store = store;
    this.downloader = downloader;

    this.status = status;

    this.onDownloadRequired =
      onDownloadRequired;

    this.pendingRegion = null;
    this.currentRegion = null;
  }

  async ensureForPosition(position) {
    const region =
      await this.catalog
        .findByPosition(position);

    if (!region) {
      this.currentRegion = null;
      this.pendingRegion = null;

      this.status(
        'Region unavailable',
        'Roam does not currently provide an offline package for this area.'
      );

      return null;
    }

    this.currentRegion = region;

    if (
      region.bundled === true ||
      this.store.isInstalled(region.id)
    ) {
      this.pendingRegion = null;
      return region;
    }

    this.pendingRegion = region;

    this.status(
      'Offline region available',
      `${region.name}, ${region.country}`
    );

    this.onDownloadRequired?.(region);

    return null;
  }

  async downloadPending({
    onProgress = () => {}
  } = {}) {
    const region =
      this.pendingRegion;

    if (!region) {
      return null;
    }

    this.status(
      `Downloading ${region.name}`,
      'Preparing offline map and nearby places.'
    );

    await this.downloader.download(
      region,
      {
        onProgress
      }
    );

    this.store.install(region);

    this.pendingRegion = null;
    this.currentRegion = region;

    this.status(
      `${region.name} installed`,
      'Offline map and nearby places are ready.'
    );

    return region;
  }

  async listRegions() {
    const regions =
      await this.catalog.list();

    return regions.map(region => ({
      ...region,
      installed:
        region.bundled === true ||
        this.store.isInstalled(region.id)
    }));
  }

  async downloadRegion(
    region,
    {
      onProgress = () => {}
    } = {}
  ) {
    if (!region) {
      throw new TypeError(
        'downloadRegion requires a region.'
      );
    }

    if (region.bundled === true) {
      this.currentRegion = region;
      return region;
    }

    await this.downloader.download(
      region,
      { onProgress }
    );

    this.store.install(region);

    if (
      this.pendingRegion?.id === region.id
    ) {
      this.pendingRegion = null;
    }

    this.currentRegion = region;

    return region;
  }

  getCurrentRegion() {
    return this.currentRegion;
  }

  getPendingRegion() {
    return this.pendingRegion;
  }
}
