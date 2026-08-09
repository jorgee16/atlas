import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRegionAssetUrl
} from '../src/regions/region-asset-url.js';

test(
  'region asset URLs resolve consistently against a supplied native origin',
  () => {
    const origin =
      'https://pub-75539028275a4826aa383fdb89292ed7.r2.dev';

    assert.equal(
      resolveRegionAssetUrl(
        '/region-packages/portugal/pois.geojson',
        {
          origin,
          baseUrl: '/'
        }
      ),
      `${origin}/region-packages/portugal/pois.geojson`
    );

    assert.equal(
      resolveRegionAssetUrl(
        '/region-packages/portugal/routing/mainland/nodes.bin',
        {
          origin,
          baseUrl: '/'
        }
      ),
      `${origin}/region-packages/portugal/routing/mainland/nodes.bin`
    );

    assert.equal(
      resolveRegionAssetUrl(
        '/regions/london/poi-index.json',
        {
          origin,
          baseUrl: '/'
        }
      ),
      `${origin}/regions/london/poi-index.json`
    );
  }
);

test(
  'absolute region asset URLs are preserved',
  () => {
    const url =
      'https://example.com/regions/london/pois.geojson';

    assert.equal(
      resolveRegionAssetUrl(url, {
        origin: 'https://ignored.example'
      }),
      url
    );
  }
);
