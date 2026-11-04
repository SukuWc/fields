import test from 'node:test';
import assert from 'node:assert/strict';
import { MINIMAP_COMPACT_QUERY } from '../src/minimap.js';
import { PHONE_QUERY, TABLET_QUERY } from '../src/touch-controls.js';

test('round map is phones only; tablets keep the desktop map', () => {
  assert.equal(MINIMAP_COMPACT_QUERY, PHONE_QUERY);
  assert.match(TABLET_QUERY, /min-width: 769px/);
  assert.match(TABLET_QUERY, /min-height: 600px/);
  assert.match(PHONE_QUERY, /max-height: 599px/);
});
