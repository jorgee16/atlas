import test from 'node:test';
import assert from 'node:assert/strict';
import { TfLJourneyProvider } from '../src/transit/providers/tfl-journey-provider.js';
import { TransitJourneyBridge, geometryPoints } from '../src/transit/transit-journey-bridge.js';

test('TfL provider calls TfL Journey API directly and bridge creates an Atlas navigation sequence', async () => {
  let requestedUrl = '';
  const provider = new TfLJourneyProvider({
    baseUrl: 'http://localhost:5000',
    fetchImpl: async url => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          journeys: [
            {
              duration: 24,
              startDateTime: '2026-08-11T10:00:00',
              arrivalDateTime: '2026-08-11T10:24:00',
              legs: [
                {
                  mode: { id: 'walking' },
                  routeOptions: [],
                  departurePoint: {
                    commonName: 'Origin'
                  },
                  arrivalPoint: {
                    commonName: 'Stop A'
                  },
                  duration: 5,
                  path: {
                    lineString:
                      'LINESTRING (-0.10 51.50, -0.11 51.51)',
                    stopPoints: []
                  },
                  disruptions: []
                },
                {
                  mode: { id: 'tube' },
                  routeOptions: [
                    {
                      name: 'Piccadilly',
                      directions: ['Heathrow']
                    }
                  ],
                  departurePoint: {
                    commonName: 'Stop A',
                    naptanId: '940GZZLUSTA'
                  },
                  arrivalPoint: {
                    commonName: 'South Kensington',
                    naptanId: '940GZZLUSKS'
                  },
                  duration: 14,
                  path: {
                    lineString:
                      'LINESTRING (-0.11 51.51, -0.17 51.49)',
                    stopPoints: [
                      { name: 'Stop B' }
                    ]
                  },
                  disruptions: []
                },
                {
                  mode: { id: 'walking' },
                  routeOptions: [],
                  departurePoint: {
                    commonName: 'South Kensington'
                  },
                  arrivalPoint: {
                    commonName: 'Natural History Museum'
                  },
                  duration: 5,
                  path: {
                    lineString:
                      'LINESTRING (-0.17 51.49, -0.1764 51.4967)',
                    stopPoints: []
                  },
                  disruptions: []
                }
              ]
            }
          ]
        })
      };
    }
  });

  const bridge = new TransitJourneyBridge({ provider });
  const plans = await bridge.plan(
    { name: 'My location', lat: 51.5, lon: -0.1 },
    { name: 'Natural History Museum', lat: 51.4967, lon: -0.1764 }
  );

  assert.match(requestedUrl, /\/Journey\/JourneyResults\//);
  assert.match(requestedUrl, /\/Journey\/JourneyResults\/51\.5%2C-0\.1\/to\/51\.4967%2C-0\.1764/);
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
