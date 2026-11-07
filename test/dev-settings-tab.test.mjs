// Dev settings tab: the field and debug preferences that used to sit behind
// dev view are a normal third tab. ?dev and backtick still only reveal the
// physics readout, fps counter and scenario prose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SETTINGS, settingDefault } from '../src/settings-registry.js';
import { playerPrefIds } from '../src/player-prefs.js';
import { SETTINGS_TABS, setupSettingsTabs } from '../src/settings-tabs.js';
import { devViewFromQuery, setupDevView } from '../src/dev-view.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const DEV_IDS = ['show_field', 'tracers', 'tracerLife', 'tracerTail', 'show_forces', 'show_refinement', 'perf', 'plotSelect', 'contrastSlider'];
const DEV_LABELS = ['Flow tracers', 'Toggle Forces', 'Show refinement region border', 'Perf overlay', 'Plot density', 'Plot x velocity', 'Plot y velocity', 'Plot speed', 'Plot curl', 'Contrast'];

function slice(id) {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start > 0, id);
  const open = html.lastIndexOf('<div', start);
  let depth = 0;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = open;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(open, re.lastIndex);
  }
  throw new Error('unclosed ' + id);
}

test('?dev still means dev view, and only the overlays use it', () => {
  assert.equal(devViewFromQuery('?dev=1'), true);
  assert.equal(devViewFromQuery('?dev=true'), true);
  assert.equal(devViewFromQuery('?dev=0'), false);
  assert.equal(devViewFromQuery('?foo=1'), false);
  assert.match(html, /body:not\(\.dev-view\) \.dev-only \{ display: none !important; \}/);
  assert.match(html, /id="info" class="dev-only"/);
  assert.match(html, /id="fps" class="dev-only"/);
  assert.match(html, /id="scenario_card_body" class="dev-only"/);
});

test('backtick still toggles dev view and ignores typing in a field', () => {
  const classes = new Set();
  const body = { classList: {
    toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); return on; },
    contains: (c) => classes.has(c),
  } };
  const listeners = [];
  let resized = 0;
  const win = {
    location: { search: '' },
    addEventListener: (type, fn) => { if (type === 'keydown') listeners.push(fn); },
    dispatchEvent: () => { resized++; },
  };
  const api = setupDevView({ body }, win);
  assert.equal(api.get(), false);
  listeners[0]({ code: 'Backquote', key: '`', preventDefault() {}, stopPropagation() {} });
  assert.equal(api.get(), true);
  assert.equal(resized, 1);
  listeners[0]({ code: 'Backquote', key: '`', target: { tagName: 'INPUT', type: 'text' }, preventDefault() {}, stopPropagation() {} });
  assert.equal(api.get(), true);
  listeners[0]({ code: 'Backquote', key: '`', target: { tagName: 'INPUT', type: 'checkbox' }, preventDefault() {}, stopPropagation() {} });
  assert.equal(api.get(), false);
});

test('Dev tab is a normal settings tab and holds the moved preferences', () => {
  assert.deepEqual(SETTINGS_TABS, ['player', 'dev', 'room']);
  assert.match(html, /id="settings_tabs" class="sz-tabs"/);
  assert.match(html, /id="settings_tab_dev" class="settings-tab sz-tab" role="tab" data-tab="dev" aria-controls="dev_panel"/);
  assert.equal((html.match(/class="settings-tab sz-tab"/g) || []).length, 3);
  const dev = slice('dev_panel');
  const player = slice('player_panel');
  const room = slice('admin_panel');
  assert.doesNotMatch(dev, /dev-only/);
  assert.doesNotMatch(dev, /hidden/);
  for (const id of DEV_IDS) {
    assert.match(dev, new RegExp(`id="${id}"`));
    assert.doesNotMatch(player, new RegExp(`id="${id}"`));
    assert.doesNotMatch(room, new RegExp(`id="${id}"`));
  }
  for (const label of DEV_LABELS) assert.ok(dev.includes(label), label);
  assert.match(player, /Boat trails/);
  assert.match(player, /Sticky autopilot/);
  assert.match(room, /id="room_config"/);
  assert.doesNotMatch(dev, /id="touch_layout"|Classic|devmode|windSpeed|simRes|room_config/);
  for (const id of DEV_IDS) {
    const s = SETTINGS.find((x) => x.id === id);
    assert.equal(s.scope, 'player');
    assert.equal(s.panel, 'dev');
  }
  assert.equal(settingDefault('show_field'), true);
  assert.equal(settingDefault('tracers'), null);
  assert.equal(settingDefault('tracerLife'), 6);
  assert.equal(settingDefault('tracerTail'), 1.5);
  assert.equal(settingDefault('show_forces'), false);
  assert.equal(settingDefault('show_refinement'), false);
  assert.equal(settingDefault('perf'), false);
  assert.equal(settingDefault('plotSelect'), 'Plot speed');
  assert.equal(settingDefault('contrastSlider'), 0);
  const prefs = playerPrefIds();
  for (const id of DEV_IDS) assert.ok(prefs.includes(id), id);
  assert.ok(prefs.includes('boat_trails'));
  assert.ok(!prefs.includes('windAngle'));
  assert.ok(!prefs.includes('sticky_autopilot'));
});

test('arrow keys and clicks move Player, Dev and Room without dev view', () => {
  const store = new Map();
  const prev = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    store.set('fields.settingsTab', 'dev');
    const buttons = ['player', 'dev', 'room'].map((tab) => {
      const listeners = {};
      return {
        dataset: { tab },
        tabIndex: 0,
        attrs: {},
        focused: false,
        setAttribute(k, v) { this.attrs[k] = v; },
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
        click() { for (const fn of listeners.click || []) fn(); },
        focus() { this.focused = true; },
      };
    });
    const barListeners = {};
    const root = { dataset: {} };
    const doc = {
      getElementById(id) {
        if (id === 'settings') return root;
        if (id === 'settings_tabs') return {
          querySelectorAll: () => buttons,
          addEventListener: (type, fn) => { (barListeners[type] ||= []).push(fn); },
        };
        return null;
      },
    };
    setupSettingsTabs(doc);
    assert.equal(root.dataset.tab, 'dev');
    assert.equal(buttons[1].attrs['aria-selected'], 'true');
    assert.equal(buttons[0].tabIndex, -1);
    buttons[0].click();
    assert.equal(root.dataset.tab, 'player');
    assert.equal(store.get('fields.settingsTab'), 'player');
    const key = (k) => {
      let prevented = false;
      for (const fn of barListeners.keydown) fn({ key: k, preventDefault() { prevented = true; }, stopPropagation() {} });
      assert.equal(prevented, true);
    };
    key('ArrowRight');
    assert.equal(root.dataset.tab, 'dev');
    assert.equal(buttons[1].focused, true);
    key('ArrowRight');
    assert.equal(root.dataset.tab, 'room');
    key('ArrowRight');
    assert.equal(root.dataset.tab, 'player');
    key('ArrowLeft');
    assert.equal(root.dataset.tab, 'room');
  } finally {
    if (prev === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prev;
  }
});
