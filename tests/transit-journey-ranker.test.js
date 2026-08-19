import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateTransitJourneyScore,
  rankTransitJourneys,
  transitJourneyMetrics
} from '../src/transit/transit-journey-ranker.js';

function journey(id, durationMinutes, steps) {
  return {
    id,
    durationMinutes,
    sequence: steps.map(step => ({
      disruptions: [],
      ...step
    }))
  };
}

const walk = durationMinutes => ({
  kind: 'walk',
  mode: 'walking',
  durationMinutes
});

const ride = (durationMinutes, line) => ({
  kind: 'transit',
  mode: 'tube',
  line,
  durationMinutes
});

test('transit journey metrics expose walking, waiting, transit legs and changes', () => {
  const metrics = transitJourneyMetrics(
    journey('metrics', 32, [
      walk(5),
      ride(10, 'Central'),
      ride(8, 'Elizabeth'),
      walk(3)
    ])
  );

  assert.deepEqual(metrics, {
    durationMinutes: 32,
    walkingMinutes: 8,
    transitMinutes: 18,
    waitingMinutes: 6,
    transferCount: 1,
    transitLegCount: 2,
    walkingLegCount: 2,
    disruptionCount: 0
  });
});

test('score is lower for a simple journey when a faster alternative saves only a few minutes by adding changes', () => {
  const simple = transitJourneyMetrics(
    journey('simple', 35, [walk(7), ride(28, 'Elizabeth')])
  );

  const complex = transitJourneyMetrics(
    journey('complex', 31, [
      walk(4),
      ride(8, 'District'),
      ride(8, 'Central'),
      ride(7, 'Elizabeth'),
      walk(4)
    ])
  );

  assert.ok(
    calculateTransitJourneyScore(simple) <
    calculateTransitJourneyScore(complex)
  );
});

test('ranking ignores TfL provider order and marks recommended and fastest independently', () => {
  const fastestButComplex = journey('fastest-complex', 31, [
    walk(4),
    ride(8, 'District'),
    ride(8, 'Central'),
    ride(7, 'Elizabeth'),
    walk(4)
  ]);

  const simple = journey('simple', 35, [
    walk(7),
    ride(28, 'Elizabeth')
  ]);

  const slow = journey('slow', 44, [
    walk(12),
    ride(32, 'Bus')
  ]);

  const ranked = rankTransitJourneys([
    fastestButComplex,
    slow,
    simple
  ]);

  assert.equal(ranked[0].id, 'simple');
  assert.equal(ranked[0].isRecommended, true);
  assert.equal(ranked[0].isFastest, false);
  assert.equal(ranked[0].fastestDurationMinutes, 31);
  assert.equal(ranked[0].durationAboveFastestMinutes, 4);

  const fastest = ranked.find(item => item.id === 'fastest-complex');
  assert.equal(fastest.isFastest, true);
  assert.equal(fastest.isRecommended, false);
  assert.equal(fastest.providerIndex, 0);
});

test('a substantially faster journey can still win despite one extra change', () => {
  const direct = journey('direct', 50, [
    walk(5),
    ride(45, 'Bus')
  ]);

  const oneChange = journey('one-change', 34, [
    walk(4),
    ride(14, 'Central'),
    ride(16, 'Elizabeth')
  ]);

  const ranked = rankTransitJourneys([direct, oneChange]);
  assert.equal(ranked[0].id, 'one-change');
  assert.equal(ranked[0].isRecommended, true);
  assert.equal(ranked[0].isFastest, true);
});

test('earlier arrival wins when walking difference is only marginal', () => {
  const lessWalking = journey('less-walking', 30, [
    walk(23),
    ride(7, 'Central')
  ]);

  const oneMinuteFasterButMoreWalking = journey('more-walking', 29, [
    walk(24),
    ride(5, 'Elizabeth')
  ]);

  const ranked = rankTransitJourneys([
    oneMinuteFasterButMoreWalking,
    lessWalking
  ]);

  assert.equal(ranked[0].id, 'more-walking');
  assert.equal(ranked[0].isRecommended, true);
  assert.equal(ranked[0].isFastest, true);

  const slower = ranked.find(item => item.id === 'less-walking');
  assert.equal(slower.isRecommended, false);
  assert.equal(slower.isFastest, false);
});
