import test from 'node:test';
import assert from 'node:assert/strict';
import { TfLJourneyProvider } from '../src/transit/providers/tfl-journey-provider.js';
import { TransitJourneyBridge, geometryPoints } from '../src/transit/transit-journey-bridge.js';

test('TfL provider calls atlas_transit and bridge creates an Atlas navigation sequence', async () => {
  let requestedUrl = '';
  const provider = new TfLJourneyProvider({
    baseUrl: 'http://localhost:5000',
    fetchImpl: async url => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => [{
          duration_minutes: 24,
          start_time: '2026-08-11T10:00:00',
          arrival_time: '2026-08-11T10:24:00',
          legs: [
            { mode: 'walking', from_name: 'Origin', to_name: 'Stop A', duration_minutes: 5, geometry: 'LINESTRING (-0.10 51.50, -0.11 51.51)' },
            { mode: 'tube', line: 'Piccadilly', from_name: 'Stop A', to_name: 'South Kensington', duration_minutes: 14, direction: 'Heathrow', intermediate_stops: ['Stop B'], geometry: 'LINESTRING (-0.11 51.51, -0.17 51.49)' },
            { mode: 'walking', from_name: 'South Kensington', to_name: 'Natural History Museum', duration_minutes: 5, geometry: 'LINESTRING (-0.17 51.49, -0.1764 51.4967)' }
          ]
        }]
      };
    }
  });

  const bridge = new TransitJourneyBridge({ provider });
  const plans = await bridge.plan(
    { name: 'My location', lat: 51.5, lon: -0.1 },
    { name: 'Natural History Museum', lat: 51.4967, lon: -0.1764 }
  );

  assert.match(requestedUrl, /\/api\/v2\/journeys\?/);
  assert.match(requestedUrl, /from=51.5%2C-0.1/);
  assert.equal(plans[0].sequence.length, 3);
  assert.equal(plans[0].sequence[0].navigation, 'atlas-offline');
  assert.equal(plans[0].sequence[1].navigation, 'provider-guidance');
  assert.equal(plans[0].sequence[1].line, 'Piccadilly');
  assert.equal(plans[0].sequence[2].end.lat, 51.4967);
});

test('geometryPoints parses TfL WKT LINESTRING geometry', () => {
  assert.deepEqual(geometryPoints('LINESTRING (-0.1 51.5, -0.2 51.6)'), [
    { lat: 51.5, lon: -0.1 },
    { lat: 51.6, lon: -0.2 }
  ]);
});
