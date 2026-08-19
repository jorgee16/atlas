import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TfLJourneyProvider
} from '../src/transit/providers/tfl-journey-provider.js';

function response(data) {
  return {
    ok: true,
    status: 200,
    async json() {
      return data;
    }
  };
}

test(
  'TfL arrivals fall back to sibling metro StopPoints when the journey stop has no matching line',
  async () => {
    const requested = [];

    const provider =
      new TfLJourneyProvider({
        fetchImpl:
          async url => {
            const value =
              String(url);

            requested.push(value);

            if (
              value.includes(
                '/StopPoint/940GZZLUPAC/Arrivals'
              )
            ) {
              /*
               * Original station identity has other lines,
               * but no Bakerloo predictions.
               */
              return response([
                {
                  lineId: 'circle',
                  lineName: 'Circle',
                  platformName:
                    'Inner Rail - Platform 1'
                }
              ]);
            }

            if (
              value.includes(
                '/StopPoint/940GZZLUPAC?'
              )
            ) {
              return response({
                stopType:
                  'TransportInterchange',

                children: [
                  {
                    id:
                      '940GZZLUPAC',
                    stopType:
                      'NaptanMetroStation'
                  },
                  {
                    id:
                      '940GZZLUPAH',
                    stopType:
                      'NaptanMetroStation'
                  },
                  {
                    id:
                      '490G000450',
                    stopType:
                      'NaptanOnstreetBusCoachStopPair'
                  }
                ]
              });
            }

            if (
              value.includes(
                '/StopPoint/940GZZLUPAH/Arrivals'
              )
            ) {
              return response([
                {
                  lineId:
                    'bakerloo',

                  lineName:
                    'Bakerloo',

                  platformName:
                    'Southbound - Platform 4',

                  towards:
                    'Elephant & Castle',

                  destinationName:
                    'Elephant & Castle Underground Station',

                  expectedArrival:
                    '2026-08-17T22:24:00Z'
                }
              ]);
            }

            throw new Error(
              `Unexpected TfL request: ${value}`
            );
          }
      });

    const arrivals =
      await provider.arrivals(
        '940GZZLUPAC',
        {
          line: 'Bakerloo'
        }
      );

    assert.equal(
      arrivals.length,
      1
    );

    assert.equal(
      arrivals[0].lineId,
      'bakerloo'
    );

    assert.equal(
      arrivals[0].platformName,
      'Southbound - Platform 4'
    );

    assert.equal(
      arrivals[0].atlasArrivalStopId,
      '940GZZLUPAH'
    );

    assert.ok(
      requested.some(url =>
        url.includes(
          '/StopPoint/940GZZLUPAH/Arrivals'
        )
      )
    );
  }
);
