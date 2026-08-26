import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RegionInstallStore
} from '../src/regions/region-install-store.js';

import {
  RegionDownloader
} from '../src/regions/region-downloader.js';

import {
  RegionManager
} from '../src/regions/region-manager.js';

import {
  formatBytes,
  RegionsFeature
} from '../src/features/regions/regions-feature.js';

test(
  'install records migrate, retain measured storage, and require the current package version',
  () => {
    const values = new Map([
      [
        'roam.installedRegions.v1',
        JSON.stringify([
          {
            id: 'london',
            name: 'London',
            installedAt:
              '2026-08-01T10:00:00.000Z'
          }
        ])
      ]
    ]);

    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) =>
        values.set(key, value)
    };

    const store = new RegionInstallStore({
      storage,
      now: () =>
        new Date('2026-08-07T12:00:00.000Z')
    });

    assert.equal(
      store.isInstalled('london'),
      true
    );

    assert.equal(
      store.isInstalled('london', 3),
      false
    );

    const record = store.install(
      {
        id: 'london',
        name: 'London',
        country: 'United Kingdom',
        version: 3
      },
      {
        sizeBytes: 84_000_000,
        fileCount: 11,
        cacheName: 'region-cache',
        verifiedFiles: 11
      }
    );

    assert.equal(record.version, 3);
    assert.equal(record.sizeBytes, 84_000_000);
    assert.equal(record.fileCount, 11);
    assert.equal(
      record.installedAt,
      '2026-08-01T10:00:00.000Z'
    );
    assert.equal(
      store.isInstalled('london', 3),
      true
    );
  }
);

test(
  'download plans include only asset URLs and classify package components',
  () => {
    const downloader = new RegionDownloader({
      fetchFn: async () => {},
      cacheStorage: {},
      origin: 'https://atlas.test'
    });

    const files = downloader.createPlan({
      id: 'portugal',
      assets: {
        pois: '/portugal/pois.geojson',
        index: '/portugal/poi-index.json',
        routing: {
          partitions: [
            {
              id: 'mainland',
              bounds: [-9.7, 36.8, -6, 42.3],
              nodes: '/portugal/mainland/nodes.bin'
            }
          ]
        }
      }
    });

    assert.deepEqual(
      files.map(file => ({
        url: file.url,
        group: file.group
      })),
      [
        {
          url: 'https://atlas.test/portugal/pois.geojson',
          group: 'places'
        },
        {
          url: 'https://atlas.test/portugal/poi-index.json',
          group: 'places'
        },
        {
          url: 'https://atlas.test/portugal/mainland/nodes.bin',
          group: 'navigation'
        }
      ]
    );
  }
);

test(
  'a region download is promoted atomically and reports byte progress',
  async () => {
    const cacheStorage = new FakeCacheStorage();

    await cacheStorage.open(
      'roam-region-v2-london-v2-old'
    );

    const progress = [];

    const downloader = new RegionDownloader({
      fetchFn: async url =>
        new Response(
          url.endsWith('.bin')
            ? new Uint8Array([1, 2, 3, 4])
            : new Uint8Array([5, 6, 7]),
          {
            status: 200
          }
        ),
      cacheStorage,
      origin: 'https://atlas.test'
    });

    const result = await downloader.download(
      {
        id: 'london',
        name: 'London',
        version: 3,
        assets: {
          pois: '/london/pois.geojson',
          routing: {
            nodes: '/london/nodes.bin'
          }
        }
      },
      {
        onProgress: value =>
          progress.push(value)
      }
    );

    assert.equal(result.sizeBytes, 7);
    assert.equal(result.fileCount, 2);
    assert.equal(
      cacheStorage.caches.has(
        'roam-region-v2-london-v2-old'
      ),
      false
    );
    assert.equal(
      cacheStorage.caches.has(
        result.cacheName
      ),
      true
    );
    assert.equal(
      progress.at(-1).phase,
      'complete'
    );
    assert.equal(
      progress.at(-1).downloadedBytes,
      7
    );
  }
);

test(
  'a failed update deletes its partial cache and preserves the installed version',
  async () => {
    const cacheStorage = new FakeCacheStorage();
    const oldCache =
      'roam-region-v2-portugal-v2-installed';

    await cacheStorage.open(oldCache);

    let request = 0;

    const downloader = new RegionDownloader({
      fetchFn: async () => {
        request += 1;

        return request === 1
          ? new Response(
              new Uint8Array([1, 2]),
              { status: 200 }
            )
          : new Response('', {
              status: 503
            });
      },
      cacheStorage,
      origin: 'https://atlas.test'
    });

    await assert.rejects(
      downloader.download({
        id: 'portugal',
        name: 'Portugal',
        version: 3,
        assets: {
          pois: '/portugal/pois.geojson',
          index: '/portugal/poi-index.json'
        }
      }),
      /HTTP 503/
    );

    assert.deepEqual(
      await cacheStorage.keys(),
      [oldCache]
    );
  }
);

test(
  'declared SHA-256 values are verified before installation',
  async () => {
    const downloader = new RegionDownloader({
      fetchFn: async () =>
        new Response(
          new Uint8Array([1, 2, 3]),
          { status: 200 }
        ),
      cacheStorage:
        new FakeCacheStorage(),
      origin: 'https://atlas.test'
    });

    const result = await downloader.download({
      id: 'london',
      name: 'London',
      version: 3,
      package: {
        files: [
          {
            url: '/london/pois.geojson',
            sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
          }
        ]
      }
    });

    assert.equal(result.verifiedFiles, 1);
    assert.equal(result.sizeBytes, 3);
  }
);


test(
  'verified downloads stream into cache without buffering the source response',
  async () => {
    const bytes = new Uint8Array(
      Array.from({ length: 256 * 1024 }, (_, i) => i & 0xff)
    );

    const response = new Response(bytes, { status: 200 });
    response.arrayBuffer = async () => {
      throw new Error('source response was buffered');
    };

    const downloader = new RegionDownloader({
      fetchFn: async () => response,
      cacheStorage: new FakeCacheStorage(),
      origin: 'https://atlas.test'
    });

    const result = await downloader.download({
      id: 'streamed',
      name: 'Streamed',
      version: 1,
      package: {
        files: [
          {
            url: '/streamed/data.bin',
            sizeBytes: bytes.byteLength,
            sha256: '2312394bd99545d9de131c24efb781e765ac1aec243f2ed9347597a793a415e9'
          }
        ]
      }
    });

    assert.equal(result.verifiedFiles, 1);
    assert.equal(result.sizeBytes, bytes.byteLength);
  }
);

test(
  'network failures name the exact region asset that failed',
  async () => {
    const downloader = new RegionDownloader({
      fetchFn: async () => {
        throw new TypeError('Failed to fetch');
      },
      cacheStorage: new FakeCacheStorage(),
      origin: 'https://atlas.test'
    });

    await assert.rejects(
      downloader.download({
        id: 'portugal',
        name: 'Portugal',
        version: 1,
        package: {
          files: [
            {
              url: '/portugal/edges.bin',
              label: 'edges.bin',
              sizeBytes: 158_516_804
            }
          ]
        }
      }),
      /Unable to download Portugal: edges\.bin \(151\.2 MB\): Failed to fetch/
    );
  }
);

test(
  'the manager exposes available, downloaded, update, and removed states',
  async () => {
    const storage = memoryStorage();
    const store = new RegionInstallStore({
      storage,
      now: () =>
        new Date('2026-08-07T12:00:00.000Z')
    });

    const region = {
      id: 'portugal',
      name: 'Portugal',
      country: 'Portugal',
      version: 3,
      bundled: false,
      bounds: [-9.7, 36.8, -6, 42.3],
      assets: {
        pois: '/portugal/pois.geojson'
      }
    };

    const events = [];
    let removedRecord = null;

    const manager = new RegionManager({
      catalog: {
        list: async () => [region],
        findById: async id =>
          id === region.id ? region : null,
        findByPosition: async position =>
          position.lat > 36
            ? region
            : null
      },
      store,
      downloader: {
        download: async () => ({
          cacheName: 'portugal-cache',
          sizeBytes: 1234,
          fileCount: 1,
          verifiedFiles: 0
        }),
        remove: async (_region, record) => {
          removedRecord = record;
        }
      },
      storageEstimate: async () => ({
        quota: 10_000,
        usage: 2_000
      })
    });

    manager.subscribe(event =>
      events.push(event.type)
    );

    assert.equal(
      (await manager.listRegions())[0].ready,
      false
    );

    assert.equal(
      await manager.ensureForPosition({
        lat: 40,
        lon: -8
      }),
      null
    );

    await manager.downloadRegion(region);

    const installed =
      (await manager.listRegions())[0];

    assert.equal(installed.ready, true);
    assert.equal(installed.installedSizeBytes, 1234);
    assert.equal(
      (await manager.getStorageSummary())
        .availableBytes,
      8_000
    );

    await manager.removeRegion('portugal');

    assert.equal(removedRecord.cacheName, 'portugal-cache');
    assert.equal(
      (await manager.listRegions())[0].installed,
      false
    );
    assert.deepEqual(
      events,
      [
        'location',
        'download-started',
        'installed',
        'removed'
      ]
    );
  }
);

test(
  'region storage sizes use compact mobile-friendly units',
  () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1_048_576), '1.00 MB');
    assert.equal(formatBytes(107 * 1_048_576), '107 MB');
  }
);

test(
  'the regions view renders storage, components, state, and the primary download action',
  async () => {
    const element = fakeElement();

    const feature = new RegionsFeature({
      manager: {
        subscribe: () => () => {},
        listRegions: async () => [
          {
            id: 'portugal',
            name: 'Portugal',
            country: 'Portugal',
            version: 3,
            installed: false,
            included: false,
            updateAvailable: false,
            nearCurrentLocation: true,
            assets: {
              pois: '/portugal/pois.geojson',
              routing: {
                nodes: '/portugal/nodes.bin'
              }
            }
          }
        ],
        getStorageSummary: async () => ({
          installedCount: 0,
          downloadedBytes: 0,
          availableBytes: 2_000_000_000
        })
      },
      panelController: {},
      listElement: element,
      documentRef: {}
    });

    await feature.render();

    assert.match(
      element.innerHTML,
      /Offline storage/
    );
    assert.match(
      element.innerHTML,
      /Portugal/
    );
    assert.match(
      element.innerHTML,
      /Near you/
    );
    assert.match(
      element.innerHTML,
      /Places/
    );
    assert.match(
      element.innerHTML,
      /Navigation/
    );
    assert.match(
      element.innerHTML,
      /data-region-action="download"/
    );

    feature.destroy();
  }
);

class FakeCacheStorage {
  constructor() {
    this.caches = new Map();
  }

  async open(name) {
    if (!this.caches.has(name)) {
      this.caches.set(
        name,
        new FakeCache()
      );
    }

    return this.caches.get(name);
  }

  async delete(name) {
    return this.caches.delete(name);
  }

  async keys() {
    return [...this.caches.keys()];
  }
}

class FakeCache {
  constructor() {
    this.responses = new Map();
  }

  async put(url, response) {
    const bytes = await response.arrayBuffer();

    this.responses.set(
      String(url),
      new Response(bytes, {
        status: response.status,
        headers: response.headers
      })
    );
  }

  async delete(url) {
    return this.responses.delete(
      String(url)
    );
  }
}

function memoryStorage() {
  const values = new Map();

  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) =>
      values.set(key, value)
  };
}

function fakeElement() {
  return {
    innerHTML: '',
    attributes: new Map(),
    addEventListener() {},
    removeEventListener() {},
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    closest() {
      return {
        hidden: false
      };
    }
  };
}
