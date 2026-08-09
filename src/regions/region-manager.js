import {
  RegionCatalog
} from './region-catalog.js';

import {
  RegionInstallStore,
  versionsMatch
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
    onDownloadRequired = null,
    storageEstimate =
      globalThis.navigator?.storage
        ?.estimate?.bind(
          globalThis.navigator.storage
        ) ?? null
  } = {}) {
    this.catalog = catalog;
    this.store = store;
    this.downloader = downloader;
    this.status = status;
    this.onDownloadRequired =
      onDownloadRequired;
    this.storageEstimate = storageEstimate;

    this.pendingRegion = null;
    this.currentRegion = null;
    this.listeners = new Set();
    this.operations = new Set();
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
        'Atlas does not currently provide an offline package for this area.'
      );

      this.#emit({
        type: 'location',
        region: null,
        installed: false
      });

      return null;
    }

    const locationChanged =
      this.currentRegion?.id !== region.id;

    this.currentRegion = region;

    if (this.#isCurrent(region)) {
      this.pendingRegion = null;

      if (locationChanged) {
        this.#emit({
          type: 'location',
          region,
          installed: true
        });
      }

      return region;
    }

    this.pendingRegion = region;

    if (locationChanged) {
      const installed =
        this.store.get(region.id);

      this.status(
        installed
          ? 'Offline region update available'
          : 'Offline region available',
        `${region.name}, ${region.country}`
      );

      this.onDownloadRequired?.(region);

      this.#emit({
        type: 'location',
        region,
        installed: false
      });
    }

    return null;
  }

  async downloadPending(options = {}) {
    const region = this.pendingRegion;

    if (!region) {
      return null;
    }

    return this.downloadRegion(
      region,
      options
    );
  }

  async listRegions() {
    const regions =
      await this.catalog.list();

    return regions.map(region =>
      this.#regionState(region)
    );
  }

  async downloadRegion(
    region,
    {
      onProgress = () => {},
      signal = undefined
    } = {}
  ) {
    if (!region?.id) {
      throw new TypeError(
        'downloadRegion requires a region.'
      );
    }

    if (region.bundled === true) {
      this.currentRegion = region;
      return region;
    }

    if (this.operations.has(region.id)) {
      throw new Error(
        `${region.name} already has an active storage operation.`
      );
    }

    this.operations.add(region.id);

    const previous =
      this.store.get(region.id);

    this.status(
      previous
        ? `Updating ${region.name}`
        : `Downloading ${region.name}`,
      'Keeping this screen open is not required.'
    );

    this.#emit({
      type: 'download-started',
      region
    });

    try {
      const details =
        await this.downloader.download(
          region,
          {
            onProgress,
            signal
          }
        );

      const record =
        this.store.install(
          region,
          details
        );

      if (
        this.pendingRegion?.id === region.id
      ) {
        this.pendingRegion = null;
      }

      if (
        this.currentRegion?.id === region.id
      ) {
        this.currentRegion = region;
      }

      this.status(
        `${region.name} ready offline`,
        'Places and navigation data are installed.'
      );

      this.#emit({
        type: previous
          ? 'updated'
          : 'installed',
        region,
        record
      });

      return this.#regionState(region);
    } finally {
      this.operations.delete(region.id);
    }
  }

  async removeRegion(regionOrId) {
    const region =
      typeof regionOrId === 'string'
        ? await this.catalog.findById(
            regionOrId
          )
        : regionOrId;

    if (!region?.id) {
      throw new TypeError(
        'removeRegion requires a known region.'
      );
    }

    if (region.bundled === true) {
      throw new Error(
        `${region.name} is included with Atlas and cannot be removed.`
      );
    }

    if (this.operations.has(region.id)) {
      throw new Error(
        `${region.name} already has an active storage operation.`
      );
    }

    const record = this.store.get(region.id);

    if (!record) {
      return false;
    }

    this.operations.add(region.id);

    try {
      await this.downloader.remove(
        region,
        record
      );

      this.store.remove(region.id);

      if (
        this.currentRegion?.id === region.id
      ) {
        this.pendingRegion = region;
      }

      this.status(
        `${region.name} removed`,
        'The downloaded offline data was deleted.'
      );

      this.#emit({
        type: 'removed',
        region,
        record
      });

      return true;
    } finally {
      this.operations.delete(region.id);
    }
  }

  async getStorageSummary() {
    const records = this.store.load();
    const downloadedBytes = records.reduce(
      (total, region) =>
        total + (region.sizeBytes ?? 0),
      0
    );

    let quota = null;
    let usage = null;

    if (this.storageEstimate) {
      try {
        const estimate =
          await this.storageEstimate();

        quota = finiteOrNull(
          estimate?.quota
        );
        usage = finiteOrNull(
          estimate?.usage
        );
      } catch {
        // Region totals remain available when the browser
        // does not expose a storage estimate.
      }
    }

    return {
      installedCount: records.length,
      downloadedBytes,
      quota,
      usage,
      availableBytes:
        quota !== null && usage !== null
          ? Math.max(0, quota - usage)
          : null
    };
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(
        'RegionManager.subscribe requires a function.'
      );
    }

    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  getCurrentRegion() {
    return this.currentRegion;
  }

  getPendingRegion() {
    return this.pendingRegion;
  }

  #regionState(region) {
    const record = this.store.get(region.id);
    const included =
      region.bundled === true;
    const installed = included || Boolean(record);
    const updateAvailable =
      Boolean(record) &&
      !versionsMatch(
        record.version,
        region.version ?? 1
      );

    return {
      ...region,
      included,
      installed,
      updateAvailable,
      ready:
        included ||
        (installed && !updateAvailable),
      installedRecord: record,
      installedSizeBytes:
        record?.sizeBytes ??
        (included
          ? region.sizeBytes ?? 0
          : 0),
      nearCurrentLocation:
        this.currentRegion?.id === region.id,
      operationActive:
        this.operations.has(region.id)
    };
  }

  #isCurrent(region) {
    return region.bundled === true ||
      this.store.isInstalled(
        region.id,
        region.version ?? 1
      );
  }

  #emit(event) {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error(
          'Region manager listener failed:',
          error
        );
      }
    });
  }
}

function finiteOrNull(value) {
  return Number.isFinite(value) && value >= 0
    ? value
    : null;
}
