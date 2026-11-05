import test from 'node:test';
import assert from 'node:assert/strict';
import { rankText, ownIndex } from '../src/rank-chip.js';

const rows = [{ position: 1, boat: 2 }, { position: 2, boat: 0 }, { position: 3, boat: 1 }];

test('rank is the own row position out of the fleet', () => {
  assert.equal(rankText(rows, 0), '2/3');
  assert.equal(rankText(rows, 2), '1/3');
  assert.equal(rankText(rows, 5), null);
  assert.equal(rankText([], 0), null);
  assert.equal(rankText(null, 0), null);
  assert.equal(rankText(rows, null), null);
});

test('own boat: by id in a room, boat 0 locally, none for a spectator', () => {
  const boats = [{ id: 'a' }, { id: 'b' }];
  assert.equal(ownIndex(boats, 'b', true), 1);
  assert.equal(ownIndex(boats, 'z', true), null);
  assert.equal(ownIndex(boats, null, true), null);
  assert.equal(ownIndex(boats, null, false), 0);
});
