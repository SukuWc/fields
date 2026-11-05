import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT_CLASSES, layoutClasses, TOUCH_UI_QUERY, TABLET_QUERY, PHONE_QUERY, DESKTOP_QUERY, WIDE_QUERY } from '../src/layout.js';
import { TOUCH_DEFAULT_QUERY, TABLET_QUERY as TQ, PHONE_QUERY as PQ } from '../src/touch-controls.js';
import { SHEET_QUERY } from '../src/mobile-sheet.js';
import { readFileSync } from 'node:fs';

test('modules share the layout queries', () => {
  assert.equal(TOUCH_DEFAULT_QUERY, TOUCH_UI_QUERY);
  assert.equal(SHEET_QUERY, TOUCH_UI_QUERY);
  assert.equal(TQ, TABLET_QUERY);
  assert.equal(PQ, PHONE_QUERY);
  assert.ok(WIDE_QUERY.includes(DESKTOP_QUERY) && WIDE_QUERY.includes(TABLET_QUERY));
});

test('layoutClasses maps matching queries to classes', () => {
  const on = new Set([TOUCH_UI_QUERY, PHONE_QUERY]);
  assert.deepEqual(layoutClasses((q) => on.has(q)).sort(), ['bp-phone', 'bp-touch']);
  assert.deepEqual(layoutClasses(() => false), []);
  for (const c of Object.keys(LAYOUT_CLASSES)) assert.match(c, /^bp-/);
});

test('index.html styles by class, not by repeated queries; brand colours via tokens', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/@media/g) || []).length, 0);
  assert.equal((html.match(/Courier/g) || []).length, 1); // only the mono token fallback
  assert.ok(!/#d32f2f|#2e7d32/i.test(html));
  assert.match(html, /--sz-port: #e1182b/);
  assert.match(html, /--sz-stbd: #18a15e/);
  for (const c of new Set(html.match(/\.bp-[a-z-]+/g))) assert.ok(c.slice(1) in LAYOUT_CLASSES || c === '.bp-ready', c);
});
