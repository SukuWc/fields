import test from "node:test";
import assert from 'node:assert/strict';
import { rowOutlineColors, ROW_RED, ROW_GREEN, ROW_YELLOW } from '../src/row-outline.js';

test('player keeps clear: opponent red; player right of way: green', () => {
  const m = rowOutlineColors('me', [{ k: 'o', a: 'x', b: 'me' }, { k: 'o', a: 'me', b: 'y' }]);
  assert.equal(m.get('x'), ROW_RED);
  assert.equal(m.get('y'), ROW_GREEN);
});
test('Rule 15 window and both-tacking are yellow', () => {
  const m = rowOutlineColors('me', [{ k: '15', a: 'me', b: 'x' }, { k: 'b', a: 'y', b: 'me' }]);
  assert.equal(m.get('x'), ROW_YELLOW);
  assert.equal(m.get('y'), ROW_YELLOW);
});
test('room owed between the pair turns it yellow', () => {
  const m = rowOutlineColors('me', [{ k: 'o', a: 'x', b: 'me' }], [['me', 'x']]);
  assert.equal(m.get('x'), ROW_YELLOW);
});
test('pairs without the player, outside the gate, or no player: none', () => {
  assert.equal(rowOutlineColors('me', [{ k: 'o', a: 'x', b: 'y' }]).size, 0);
  assert.equal(rowOutlineColors('me', undefined, [['me', 'z']]).size, 0);
  assert.equal(rowOutlineColors(null, [{ k: 'o', a: 'me', b: 'x' }]).size, 0);
});

import { rowPovId } from '../src/row-outline.js';
test('POV: own boat in multiplayer, boat 0 by id otherwise', () => {
  const boats = [{ id: 's7' }, { id: 0 }, { id: 'p1' }];
  assert.equal(rowPovId('p1', boats), 'p1');
  assert.equal(rowPovId(null, boats), 0);
  assert.equal(rowPovId(null, [{ id: 's3' }, { id: 's4' }]), 's3');
  assert.equal(rowPovId(null, []), null);
  const m = rowOutlineColors(rowPovId(null, boats), [{ k: 'o', a: 0, b: 's7' }]);
  assert.equal(m.get('s7'), ROW_GREEN);
});
