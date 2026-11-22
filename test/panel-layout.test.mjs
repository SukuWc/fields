// Instrument panel layout in the Dev TOML (readout_tiles / readout_columns /
// chart_strips / chart_columns): defaults are today's panel, unknown ids are
// dropped with a warning, bad types are refused, and setLayout only reorders
// the Readout and Chart grids.
import './dom-stub.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { READOUT_TILES } from '../src/instrument-readout.js';
import { CHART_STRIPS } from '../src/instrument-chart.js';
import {
  CHART_STRIP_IDS,
  DEV_CONFIG_DEFAULTS,
  DEV_CONFIG_KEY,
  PANEL_LAYOUT_FIELDS,
  READOUT_TILE_IDS,
  devClientEffects,
  parseAndValidateDevConfig,
  sameDevValue,
  stringifyDevConfig,
  validateDevConfig,
} from '../src/dev-config.js';
import {
  applyDevEffects,
  installDevPrefs,
} from '../src/dev-prefs.js';
import {
  arrangeGrid,
  setupInstrumentPanel,
} from '../src/instrument-panel.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const base = stringifyDevConfig(DEV_CONFIG_DEFAULTS);

test('defaults are every tile and strip in today\'s order, automatic columns', () => {
  assert.deepEqual(DEV_CONFIG_DEFAULTS.readout_tiles, READOUT_TILES.map((t) => t.key));
  assert.deepEqual(DEV_CONFIG_DEFAULTS.chart_strips, CHART_STRIPS.map((s) => s.key));
  assert.deepEqual([...READOUT_TILE_IDS], ['heading', 'bs', 'vmg', 'twa', 'twd', 'tws', 'rwd', 'rws', 'awa', 'aws', 'next', 'fin', 'heel', 'hike', 'sail', 'rudder']);
  assert.deepEqual([...CHART_STRIP_IDS], ['speed', 'twa', 'wind', 'rws', 'twd', 'rwd', 'heading']);
  assert.equal(DEV_CONFIG_DEFAULTS.readout_columns, 0);
  assert.equal(DEV_CONFIG_DEFAULTS.chart_columns, 0);
  assert.deepEqual(PANEL_LAYOUT_FIELDS.map((f) => f.key), ['readout_tiles', 'readout_columns', 'chart_strips', 'chart_columns']);
  assert.match(base, /^readout_tiles = \[ "heading", "bs",/m);
  assert.match(base, /^chart_strips = \[ "speed", "twa", "wind", "rws", "twd", "rwd", "heading" \]$/m);
  assert.match(base, /^readout_columns = 0$/m);
  const v = parseAndValidateDevConfig(base);
  assert.equal(v.error, undefined);
  assert.equal(v.warnings, undefined, 'the default document has no warnings');
});

test('unknown and repeated ids are dropped with a warning, the rest validates', () => {
  const text = base
    .replace('readout_tiles = [ "heading", "bs",', 'readout_tiles = [ "heading", "nope", "bs", "heading",')
    .replace('chart_strips = [ "speed",', 'chart_strips = [ "speed", "polar",');
  const v = parseAndValidateDevConfig(text);
  assert.equal(v.error, undefined);
  assert.deepEqual(v.config.readout_tiles, DEV_CONFIG_DEFAULTS.readout_tiles);
  assert.deepEqual(v.config.chart_strips, DEV_CONFIG_DEFAULTS.chart_strips);
  assert.deepEqual(v.warnings, [
    'readout_tiles: unknown id "nope" ignored',
    'readout_tiles: repeated id "heading" ignored',
    'chart_strips: unknown id "polar" ignored',
  ]);
  const few = parseAndValidateDevConfig(base.replace(/^chart_strips = .*$/m, 'chart_strips = [ "twd", "speed" ]').replace(/^readout_tiles = .*$/m, 'readout_tiles = []'));
  assert.deepEqual(few.config.chart_strips, ['twd', 'speed']);
  assert.deepEqual(few.config.readout_tiles, []);
});

test('wrong types and column counts are refused whole', () => {
  const cases = [
    [base.replace(/^readout_tiles = .*$/m, 'readout_tiles = "heading"'), /readout_tiles must be a list/],
    [base.replace(/^chart_strips = .*$/m, 'chart_strips = [ 1, 2 ]'), /chart_strips must be a list/],
    [base.replace('readout_columns = 0', 'readout_columns = 17'), /readout_columns/],
    [base.replace('chart_columns = 0', 'chart_columns = -1'), /chart_columns/],
    [base.replace('chart_columns = 0', 'chart_columns = 2.5'), /chart_columns/],
  ];
  for (const [text, re] of cases) {
    const r = parseAndValidateDevConfig(text);
    assert.match(r.error || '', re);
    assert.equal(r.config, undefined);
  }
  assert.equal(validateDevConfig({ ...DEV_CONFIG_DEFAULTS, readout_columns: 16, chart_columns: 7 }).error, undefined);
});

test('the layout rides on the client effects and applyDevEffects hands it over', () => {
  const cfg = { ...DEV_CONFIG_DEFAULTS, readout_tiles: ['bs', 'heading'], chart_columns: 2 };
  const fx = devClientEffects(cfg);
  assert.deepEqual(fx.panelLayout, { readoutTiles: ['bs', 'heading'], readoutColumns: 0, chartStrips: [...CHART_STRIP_IDS], chartColumns: 2 });
  fx.panelLayout.readoutTiles.push('x');
  assert.deepEqual(cfg.readout_tiles, ['bs', 'heading'], 'effects carry a copy');
  const got = [];
  applyDevEffects(fx, { setPanelLayout: (l) => got.push(l) });
  assert.equal(got.length, 1);
  assert.equal(got[0].chartColumns, 2);
  assert.ok(sameDevValue(['a', 'b'], ['a', 'b']));
  assert.ok(!sameDevValue(['a', 'b'], ['b', 'a']));
  assert.ok(sameDevValue(0, 0));
});

// Minimal DOM: elements with ordered children, so order and removal are visible.
function node(tag = 'div') {
  const classes = new Set();
  const listeners = {};
  const n = {
    tag, children: [], parentNode: null, dataset: {}, attrs: {}, hidden: false, textContent: '', title: '',
    _html: '', _kids: {},
    style: { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } },
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, on) => { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
    },
    set className(v) { for (const c of String(v).split(/\s+/).filter(Boolean)) classes.add(c); },
    set innerHTML(v) { n._html = v; },
    get innerHTML() { return n._html; },
    setAttribute(k, v) { n.attrs[k] = String(v); },
    getAttribute(k) { return n.attrs[k] ?? null; },
    appendChild(c) {
      if (c.parentNode) c.parentNode.removeChild(c);
      n.children.push(c); c.parentNode = n; return c;
    },
    append(...cs) { for (const c of cs) n.appendChild(c); },
    removeChild(c) { const i = n.children.indexOf(c); if (i >= 0) n.children.splice(i, 1); c.parentNode = null; return c; },
    querySelector(sel) { return (n._kids[sel] ||= node()); },
    querySelectorAll: () => [],
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  };
  return n;
}

function panelDoc() {
  const grid = node();
  const charts = node();
  const root = node();
  root.querySelector = (sel) => (sel === '.instr-tiles' ? grid : sel === '.instr-charts' ? charts : sel === '.instr-note' ? node() : null);
  const doc = {
    getElementById: (id) => (id === 'instrument_panel' ? root : null),
    createElement: () => node(),
    createElementNS: () => node('svg'),
  };
  return { doc, root, grid, charts };
}

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

test('setLayout orders and hides tiles and strips; defaults keep today\'s panel', () => {
  const { doc, grid, charts } = panelDoc();
  const p = setupInstrumentPanel({ remote: false }, doc);
  const tileKeys = () => grid.children.map((c) => c.dataset.key);
  const stripKeys = () => charts.children.map((c) => c.dataset.key);
  assert.deepEqual(tileKeys(), [...READOUT_TILE_IDS]);
  assert.deepEqual(stripKeys(), [...CHART_STRIP_IDS]);

  p.setLayout(devClientEffects(DEV_CONFIG_DEFAULTS).panelLayout);
  assert.deepEqual(tileKeys(), [...READOUT_TILE_IDS], 'default layout = today\'s order');
  assert.deepEqual(stripKeys(), [...CHART_STRIP_IDS]);
  assert.equal(grid.dataset.cols, undefined);
  assert.equal(charts.dataset.cols, undefined);

  p.setLayout({ readoutTiles: ['twd', 'heading', 'bs'], readoutColumns: 3, chartStrips: ['heading', 'speed'], chartColumns: 2 });
  assert.deepEqual(tileKeys(), ['twd', 'heading', 'bs']);
  assert.deepEqual(stripKeys(), ['heading', 'speed']);
  assert.equal(grid.dataset.cols, '3');
  assert.equal(grid.style.props['--instr-cols'], '3');
  assert.equal(charts.dataset.cols, '2');

  // values keep updating for hidden tiles, and they come back in place
  p.onFrame({ ts: 1, boats: [{ id: 'b0', heading_deg: 10 }] });
  p.setLayout(devClientEffects(DEV_CONFIG_DEFAULTS).panelLayout);
  assert.deepEqual(tileKeys(), [...READOUT_TILE_IDS]);
  assert.deepEqual(stripKeys(), [...CHART_STRIP_IDS]);
  assert.equal(grid.dataset.cols, undefined);
  assert.equal(grid.style.props['--instr-cols'], undefined);
  p.setLayout(null);
});

test('arrangeGrid leaves foreign children alone', () => {
  const box = node();
  const other = node();
  const a = node(); const b = node(); const c = node();
  box.append(other, a, b, c);
  arrangeGrid(box, [c, a], [a, b, c], 0);
  assert.deepEqual(box.children, [other, c, a]);
});

test('index.html: column override off phones only; the panel shell is untouched', () => {
  assert.match(html, /:root:not\(\.bp-phone\) #instrument_panel \.instr-tiles\[data-cols\],\n\s*:root:not\(\.bp-phone\) #instrument_panel\[data-mode="chart"\] \.instr-charts\[data-cols\] \{ grid-template-columns: repeat\(var\(--instr-cols\), minmax\(0, 1fr\)\) !important; \}/);
  assert.ok(!/bp-phone[^{]*\[data-cols\]/.test(html.replace(/:root:not\(\.bp-phone\)/g, '')), 'no phone rule reads data-cols');
});

test('the Dev editor shows the ignored ids and Apply writes the cleaned lists', async () => {
  const els = {};
  const el = (id) => (els[id] ||= {
    id, value: '', textContent: '', hidden: true, disabled: false, dataset: {}, _on: {},
    classList: { toggle() {} },
    addEventListener(type, fn) { (this._on[type] ||= []).push(fn); },
    fire(type) { for (const fn of this._on[type] || []) fn(); },
  });
  for (const id of ['dev_config', 'dev_config_check', 'dev_config_status', 'dev_config_mode', 'dev_config_commit', 'dev_config_revert', 'dev_config_reset']) el(id);
  const doc = { getElementById: (id) => els[id] || null };
  const data = new Map();
  const storage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
  const layouts = [];
  const host = { kind: 'local', commandSync: () => ({ ok: true, boats: [] }), command: () => Promise.resolve({ ok: true }), on() {} };
  const api = installDevPrefs(doc, { host, storage, applyLocal: (fx) => applyDevEffects(fx, { setPanelLayout: (l) => layouts.push(l) }) });
  await api.ready;
  assert.deepEqual(layouts.at(-1).readoutTiles, [...READOUT_TILE_IDS], 'startup applies the default layout');
  assert.equal(data.has(DEV_CONFIG_KEY), false, 'the default layout is not saved');
  const ta = els.dev_config;
  ta.value = ta.value.replace(/^chart_strips = .*$/m, 'chart_strips = [ "twd", "nope" ]');
  ta.fire('input');
  assert.match(els.dev_config_check.textContent, /^Valid · not applied yet · chart_strips: unknown id "nope" ignored$/);
  assert.equal(els.dev_config_commit.disabled, false);
  els.dev_config_commit.fire('click');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(layouts.at(-1).chartStrips, ['twd']);
  assert.match(ta.value, /^chart_strips = \[ "twd" \]$/m);
  assert.equal(els.dev_config_check.textContent, 'Valid · matches this page');
  assert.deepEqual(JSON.parse(data.get(DEV_CONFIG_KEY)).chart_strips, ['twd']);
});
