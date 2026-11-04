import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTouchLayout, TOUCH_LAYOUTS } from '../src/touch-controls.js';
import { SETTINGS } from '../src/settings-registry.js';

test('touch layout: classic default, overlay allowed, junk falls back', () => {
  assert.deepEqual(TOUCH_LAYOUTS, ['classic', 'overlay']);
  assert.equal(normalizeTouchLayout('overlay'), 'overlay');
  assert.equal(normalizeTouchLayout('classic'), 'classic');
  assert.equal(normalizeTouchLayout('x'), 'classic');
  assert.equal(normalizeTouchLayout(undefined), 'classic');
  const s = SETTINGS.find((x) => x.id === 'touch_layout');
  assert.equal(s.default, 'classic');
  assert.deepEqual(s.values, TOUCH_LAYOUTS);
  assert.equal(s.scope, 'player');
});
