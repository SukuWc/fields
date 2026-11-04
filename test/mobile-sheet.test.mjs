import test from 'node:test';
import assert from 'node:assert/strict';
import { SHEET_QUERY, QUICK_MESSAGES, setupMobileSheet } from '../src/mobile-sheet.js';
import { TOUCH_DEFAULT_QUERY } from '../src/touch-controls.js';

test('sheet uses the same phone query as the mobile layout', () => {
  assert.equal(SHEET_QUERY, TOUCH_DEFAULT_QUERY);
});

test('quick messages are short and unique', () => {
  assert.equal(new Set(QUICK_MESSAGES).size, QUICK_MESSAGES.length);
  for (const m of QUICK_MESSAGES) assert.ok(m.length > 0 && m.length <= 20);
});

test('setup is a no-op when the sheet markup is missing', () => {
  assert.equal(setupMobileSheet({ getElementById: () => null }), null);
});
