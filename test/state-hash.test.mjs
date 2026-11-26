// The penalty CLEARED flash is part of the race hash (sim.last.boats.justCleared).
// It must follow simulation time, not the wall clock, so a 30 Hz recording
// and a fast-forward seek agree. The stamp lives on the boat (non-enumerable)
// so a snapshot/restore still sees it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { penaltyJustCleared } from '../src/rules.js';
import { PENALTY_CLEARED_MS } from '../src/rules.js';

test('the CLEARED flash follows the sim clock, not wall time', () => {
  const boat = {};
  Object.defineProperty(boat, '_penaltyClearedAtMs', {
    value: 10000, writable: true, configurable: true, enumerable: false,
  });
  assert.equal(Object.keys(boat).includes('_penaltyClearedAtMs'), false, 'not hashed as a boat field');
  assert.equal(penaltyJustCleared(boat, 10200), true);
  assert.equal(penaltyJustCleared(boat, 10000 + PENALTY_CLEARED_MS), true);
  assert.equal(penaltyJustCleared(boat, 10000 + PENALTY_CLEARED_MS + 1), false);
});
