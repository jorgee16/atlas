import assert from 'node:assert/strict';
import test from 'node:test';
import { TransitJourneyExecution } from '../src/transit/transit-journey-execution.js';

const journey = {
  id: 'demo',
  sequence: [
    { kind: 'walk', fromName: 'Origin', toName: 'Westminster', points: [{lat:1,lon:1},{lat:2,lon:2}] },
    { kind: 'transit', line: 'District', direction: 'Upminster', fromName: 'Westminster', toName: 'Tower Hill', points: [{lat:2,lon:2},{lat:3,lon:3}] },
    { kind: 'walk', fromName: 'Tower Hill', toName: 'Tower of London', points: [{lat:3,lon:3},{lat:4,lon:4}] }
  ]
};

test('explicit V3 transitions execute every journey leg in order', () => {
  let now = 10;
  const execution = new TransitJourneyExecution(journey, { now: () => now++ });
  assert.equal(execution.getState().phase, 'walking');
  assert.equal(execution.transition('boarded'), false);
  assert.equal(execution.transition('arrived'), true);
  assert.equal(execution.getState().phase, 'ready_to_board');
  assert.equal(execution.transition('boarded'), true);
  assert.equal(execution.getState().phase, 'riding');
  assert.equal(execution.transition('get_off'), true);
  assert.equal(execution.getState().phase, 'walking');
  assert.equal(execution.transition('arrived'), true);
  assert.equal(execution.getState().completed, true);
  assert.deepEqual(execution.getState().history.map(item => item.type),
    ['journey-started','arrived','leg-started','boarded','alighted','leg-started','arrived','journey-complete']);
});
