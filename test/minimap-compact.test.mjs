import test from 'node:test';
import assert from 'node:assert/strict';
import { MINIMAP_COMPACT_QUERY } from '../src/minimap.js';
import { TOUCH_DEFAULT_QUERY } from '../src/touch-controls.js';

test('round map uses the same phone query as the mobile layout', () => {
  assert.equal(MINIMAP_COMPACT_QUERY, TOUCH_DEFAULT_QUERY);
});
