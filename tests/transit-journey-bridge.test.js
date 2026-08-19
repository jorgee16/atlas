import test from 'node:test';
import assert from 'node:assert/strict';
import { TfLJourneyProvider } from '../src/transit/providers/tfl-journey-provider.js';
import { TransitJourneyBridge, geometryPoints } from '../src/transit/transit-journey-bridge.js';

test('TfL provider calls TfL Journey API directly and bridge creates an Atlas navigation sequence', async () => {
  const requestedUrls = [];
  const provider = new TfLJourneyProvider({
    baseUrl: 'http://localhost:5000',
    fetchImpl: async url => {
      requestedUrls.push(String(url));
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

  assert.equal(requestedUrls.length, 4);
  assert.ok(
    requestedUrls.every(url =>
      /\/Journey\/JourneyResults\//.test(url)
    )
  );
  assert.ok(
    requestedUrls.every(url =>
      /walkingSpeed=fast/.test(url)
    )
  );
  assert.ok(
    requestedUrls.some(url =>
      /[?&]mode=bus%2Ctube%2Cdlr%2Coverground%2Ctram%2Celizabeth-line(?:&|$)/.test(url)
    )
  );
  assert.ok(
    requestedUrls.some(url =>
      /[?&]mode=tube(?:&|$)/.test(url)
    )
  );
  assert.ok(
    requestedUrls.some(url =>
      /[?&]mode=elizabeth-line(?:&|$)/.test(url)
    )
  );

  assert.ok(
    requestedUrls.some(url =>
      /[?&]mode=tube(?:&|$)/.test(url) &&
      /[?&]journeyPreference=leastinterchange(?:&|$)/.test(url)
    )
  );
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


test('TfL provider keeps an explicit mode filter when a caller requests one', async () => {
  let requestedUrl = '';

  const provider = new TfLJourneyProvider({
    baseUrl: 'http://localhost:5000',
    fetchImpl: async url => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({ journeys: [] })
      };
    }
  });

  await provider.journeys(
    { name: 'Origin', lat: 51.5, lon: -0.1 },
    { name: 'Destination', lat: 51.51, lon: -0.12 },
    { mode: 'tube,bus' }
  );

  assert.match(requestedUrl, /[?&]mode=tube%2Cbus(?:&|$)/);
});


test('TfL provider keeps Elizabeth line and maps train to national rail', async () => {
  let requestedUrl = '';

  const provider = new TfLJourneyProvider({
    baseUrl: 'http://localhost:5000',
    fetchImpl: async url => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({ journeys: [] })
      };
    }
  });

  await provider.journeys(
    { name: 'Origin', lat: 51.5, lon: -0.1 },
    { name: 'Destination', lat: 51.51, lon: -0.12 },
    { mode: 'tube,elizabeth-line,train' }
  );

  assert.match(
    requestedUrl,
    /[?&]mode=tube%2Celizabeth-line%2Cnational-rail(?:&|$)/
  );
});


test('bridge merges focused TfL candidate pools and deduplicates repeated route families', async () => {
  const lineJourney = (id, line, mode, durationMinutes) => ({
    id,
    durationMinutes,
    startTime: '2026-08-13T21:00:00',
    arrivalTime: '2026-08-13T21:30:00',
    legs: [
      {
        mode: 'walking',
        line: null,
        fromName: 'Origin',
        toName: `${line} start`,
        durationMinutes: 8,
        geometry: 'LINESTRING (-0.10 51.50, -0.11 51.51)',
        disruptions: []
      },
      {
        mode,
        line,
        fromName: `${line} start`,
        toName: `${line} end`,
        durationMinutes: Math.max(1, durationMinutes - 16),
        geometry: 'LINESTRING (-0.11 51.51, -0.12 51.50)',
        disruptions: []
      },
      {
        mode: 'walking',
        line: null,
        fromName: `${line} end`,
        toName: 'Destination',
        durationMinutes: 8,
        geometry: 'LINESTRING (-0.12 51.50, -0.13 51.49)',
        disruptions: []
      }
    ]
  });

  const calls = [];
  const provider = {
    async journeys(origin, destination, options) {
      calls.push(options.mode);

      if (options.mode === 'tube') {
        return [
          lineJourney('central-2', 'Central', 'tube', 28),
          lineJourney('bakerloo', 'Bakerloo', 'tube', 29)
        ];
      }

      if (options.mode === 'elizabeth-line') {
        return [
          lineJourney('elizabeth', 'Elizabeth line', 'elizabeth-line', 25)
        ];
      }

      if (
        options.mode ===
        'bus,tube,dlr,overground,tram,elizabeth-line,national-rail'
      ) {
        return [
          lineJourney('central-1', 'Central', 'tube', 28),
          lineJourney('central-3', 'Central', 'tube', 28)
        ];
      }

      return [];
    }
  };

  const bridge = new TransitJourneyBridge({ provider });
  const plans = await bridge.plan(
    { name: 'Origin', lat: 51.5, lon: -0.1 },
    { name: 'Destination', lat: 51.49, lon: -0.13 }
  );

  assert.equal(calls.length, 4);

  const lines = plans.map(plan =>
    plan.sequence.find(step => step.kind === 'transit')?.line
  );

  assert.deepEqual(
    new Set(lines),
    new Set(['Central', 'Bakerloo', 'Elizabeth line'])
  );
  assert.equal(lines.filter(line => line === 'Central').length, 1);
});
