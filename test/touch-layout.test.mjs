import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTouchLayout, TOUCH_LAYOUTS } from '../src/touch-controls.js';
import { SETTINGS } from '../src/settings-registry.js';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('touch layout: Overlay only; Classic setting gone', () => {
  assert.deepEqual(TOUCH_LAYOUTS, ['overlay']);
  assert.equal(normalizeTouchLayout('overlay'), 'overlay');
  assert.equal(normalizeTouchLayout('classic'), 'overlay');
  assert.equal(normalizeTouchLayout('x'), 'overlay');
  assert.equal(normalizeTouchLayout(undefined), 'overlay');
  assert.equal(SETTINGS.find((x) => x.id === 'touch_layout'), undefined);
  assert.ok(!html.includes('id="touch_layout"'));
  assert.ok(!html.includes('option value="classic"'));
});
