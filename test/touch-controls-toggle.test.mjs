// Touch controls: the checkbox hides the on-screen buttons (overlay CSS used
// to ignore [hidden]), an explicit off survives a resize, and a page with no
// choice follows the device media query.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PREFS_KEY } from '../src/player-prefs.js';
import { setupTouchControls, touchChoiceIsExplicit, TOUCH_DEFAULT_QUERY } from '../src/touch-controls.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function harness({ matches = false, search = '', prefs = null } = {}) {
  const mqListeners = [];
  const mq = {
    matches,
    addEventListener(type, fn) { if (type === 'change') mqListeners.push(fn); },
  };
  const store = new Map();
  if (prefs) store.set(PREFS_KEY, JSON.stringify(prefs));
  const bodyClasses = new Set();
  const body = { classList: {
    contains: (c) => bodyClasses.has(c),
    add: (c) => bodyClasses.add(c),
    toggle: (c, on) => { if (on) bodyClasses.add(c); else bodyClasses.delete(c); },
  } };
  function el(id) {
    const listeners = {};
    return {
      id,
      hidden: id === 'touch_controls',
      checked: false,
      defaultChecked: false,
      dataset: {},
      classList: { add() {}, remove() {}, contains: () => false },
      querySelectorAll: () => [],
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      dispatch(type, extra) { for (const fn of listeners[type] || []) fn({ type, ...extra }); },
      setPointerCapture() {},
    };
  }
  const touch = el('touch');
  const panel = el('touch_controls');
  const doc = {
    body,
    getElementById: (id) => (id === 'touch' ? touch : id === 'touch_controls' ? panel : null),
  };
  const win = {
    location: { search },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null) },
    matchMedia: (q) => (q === TOUCH_DEFAULT_QUERY ? mq : { matches: false, addEventListener() {} }),
    addEventListener() {},
    dispatchEvent() {},
  };
  return { doc, win, touch, panel, bodyClasses, mq, fireMedia() { for (const fn of mqListeners) fn(); } };
}

test('overlay CSS hides the panel when Touch controls is off', () => {
  const overlay = html.indexOf('body.tc-overlay #touch_controls {');
  const hidden = html.indexOf('body.tc-overlay #touch_controls[hidden]');
  assert.ok(overlay > 0 && hidden > overlay);
  assert.match(html, /body\.tc-overlay #touch_controls\[hidden\] \{ display: none; \}/);
  assert.match(html, /\.bp-desktop body\.touch-on\.tc-overlay \.tc-btn\[data-short\] \{ bottom: 180px; \}/);
  assert.match(html, /\.bp-wide body\.touch-on #chat_panel \{ bottom: 276px; \}/);
  assert.ok(!html.includes('id="touch_layout"'));
});

test('desktop default is off, and unchecking hides the panel', () => {
  const h = harness({ matches: false });
  setupTouchControls(h.doc, h.win);
  assert.equal(h.touch.checked, false);
  assert.equal(h.panel.hidden, true);
  assert.equal(h.bodyClasses.has('touch-on'), false);
  assert.equal(h.bodyClasses.has('tc-overlay'), true);
  h.touch.checked = true;
  h.touch.dispatch('change', { isTrusted: true });
  assert.equal(h.panel.hidden, false);
  assert.equal(h.bodyClasses.has('touch-on'), true);
  h.touch.checked = false;
  h.touch.dispatch('change', { isTrusted: true });
  assert.equal(h.panel.hidden, true);
  assert.equal(h.bodyClasses.has('touch-on'), false);
});

test('phone default is on', () => {
  const h = harness({ matches: true });
  setupTouchControls(h.doc, h.win);
  assert.equal(h.touch.checked, true);
  assert.equal(h.panel.hidden, false);
  assert.equal(h.bodyClasses.has('touch-on'), true);
});

test('an explicit off is not replaced when the media query flips', () => {
  assert.equal(touchChoiceIsExplicit({ location: { search: '?touch=0' }, localStorage: { getItem: () => null } }), true);
  assert.equal(touchChoiceIsExplicit({ location: { search: '' }, localStorage: { getItem: () => JSON.stringify({ touch: false }) } }), true);
  assert.equal(touchChoiceIsExplicit({ location: { search: '' }, localStorage: { getItem: () => '{}' } }), false);

  const saved = harness({ matches: true, prefs: { touch: false } });
  setupTouchControls(saved.doc, saved.win);
  saved.touch.checked = false;
  saved.touch.dispatch('change', { isTrusted: false });
  saved.mq.matches = false;
  saved.fireMedia();
  assert.equal(saved.touch.checked, false);
  assert.equal(saved.panel.hidden, true);
  saved.mq.matches = true;
  saved.fireMedia();
  assert.equal(saved.touch.checked, false);

  const clicked = harness({ matches: true });
  setupTouchControls(clicked.doc, clicked.win);
  clicked.touch.checked = false;
  clicked.touch.dispatch('change', { isTrusted: true });
  clicked.mq.matches = false;
  clicked.fireMedia();
  clicked.mq.matches = true;
  clicked.fireMedia();
  assert.equal(clicked.touch.checked, false);
  assert.equal(clicked.panel.hidden, true);
});

test('with no explicit choice, resize follows the device', () => {
  const h = harness({ matches: false });
  setupTouchControls(h.doc, h.win);
  h.mq.matches = true;
  h.fireMedia();
  assert.equal(h.touch.checked, true);
  assert.equal(h.panel.hidden, false);
  h.mq.matches = false;
  h.fireMedia();
  assert.equal(h.touch.checked, false);
  assert.equal(h.panel.hidden, true);
});
