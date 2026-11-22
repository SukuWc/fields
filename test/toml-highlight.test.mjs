// Non-default TOML highlighting: path diff, HTML paint, dual-layer wrap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEV_CONFIG_DEFAULTS,
  parseAndValidateDevConfig,
  stringifyDevConfig,
} from '../src/dev-config.js';
import {
  ROOM_CONFIG_DEFAULTS,
  defaultRoomConfig,
  parseAndValidateRoomConfig,
  stringifyRoomConfig,
} from '../src/room-config.js';
import {
  collectNonDefaultPaths,
  highlightTomlHtml,
  installTomlHighlight,
  tomlValuesEqual,
} from '../src/toml-highlight.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('tomlValuesEqual handles numbers, arrays and objects', () => {
  assert.equal(tomlValuesEqual(1, 1), true);
  assert.equal(tomlValuesEqual(1, 1.0000000001), true);
  assert.equal(tomlValuesEqual(1, 2), false);
  assert.equal(tomlValuesEqual([1, 2], [1, 2]), true);
  assert.equal(tomlValuesEqual([1, 2], [1, 3]), false);
  assert.equal(tomlValuesEqual({ a: 1, b: [2] }, { b: [2], a: 1 }), true);
  assert.equal(tomlValuesEqual({ a: 1 }, { a: 2 }), false);
});

test('collectNonDefaultPaths finds leaf overrides only', () => {
  const cfg = { ...DEV_CONFIG_DEFAULTS, autopilot_kp: 4, flow_tracers: false };
  const paths = collectNonDefaultPaths(cfg, DEV_CONFIG_DEFAULTS);
  assert.deepEqual([...paths].sort(), ['autopilot_kp', 'flow_tracers']);
});

test('collectNonDefaultPaths walks nested room tables', () => {
  const base = defaultRoomConfig(100, 200);
  const cfg = JSON.parse(JSON.stringify(base));
  cfg.wind_speed_mps = 9;
  cfg.wind_dir.term0 = [7, 1.8, 10, 2];
  cfg.custom.marks.w = [0, 70];
  const paths = collectNonDefaultPaths(cfg, base);
  assert.ok(paths.has('wind_speed_mps'));
  assert.ok(paths.has('wind_dir.term0'));
  assert.ok(paths.has('custom.marks.w'));
  assert.equal(paths.has('custom.marks'), false);
  assert.equal(paths.has('wind_dir'), false);
});

test('collectNonDefaultPaths ignores keys absent from defaults', () => {
  const base = { a: 1 };
  const paths = collectNonDefaultPaths({ a: 1, ladder_lines: true }, base);
  assert.equal(paths.size, 0);
});

test('defaults stringify with no non-default spans', () => {
  const text = stringifyDevConfig(DEV_CONFIG_DEFAULTS);
  const parsed = parseAndValidateDevConfig(text);
  assert.equal(parsed.error, undefined);
  const painted = highlightTomlHtml(text, DEV_CONFIG_DEFAULTS, parsed.config);
  assert.doesNotMatch(painted, /toml-nondefault/);
  assert.match(painted, /flow_tracers = true/);
});

test('changed Dev keys are wrapped in toml-nondefault', () => {
  const text = stringifyDevConfig({ ...DEV_CONFIG_DEFAULTS, autopilot_kp: 3, ghost_boat: true });
  const parsed = parseAndValidateDevConfig(text);
  const painted = highlightTomlHtml(text, DEV_CONFIG_DEFAULTS, parsed.config);
  assert.match(painted, /<span class="toml-nondefault">autopilot_kp = 3<\/span>/);
  assert.match(painted, /<span class="toml-nondefault">ghost_boat = true<\/span>/);
  assert.doesNotMatch(painted, /toml-nondefault">flow_tracers/);
  assert.doesNotMatch(painted, /toml-nondefault">#/);
});

test('changed Room nested and multi-line legs highlight', () => {
  const base = defaultRoomConfig(100, 200);
  const cfg = JSON.parse(JSON.stringify(base));
  cfg.gust_rate_per_min = 20;
  cfg.custom.course.legs = [
    { mark: 'w', round: 'port' },
    { gate: ['g_l', 'g_r'] },
  ];
  const text = stringifyRoomConfig(cfg);
  const parsed = parseAndValidateRoomConfig(text);
  assert.equal(parsed.error, undefined, parsed.error);
  const painted = highlightTomlHtml(text, base, parsed.config);
  assert.match(painted, /toml-nondefault">gust_rate_per_min = 20/);
  assert.match(painted, /toml-nondefault">legs = \[/);
  assert.match(painted, /toml-nondefault">\s*{ mark = &quot;w&quot;/);
  assert.doesNotMatch(painted, /toml-nondefault">scenario =/);
  assert.doesNotMatch(painted, /toml-nondefault">\[custom\]/);
});

test('line-by-line fallback highlights without a full config', () => {
  const text = 'autopilot_kp = 9\nflow_tracers = true\n';
  const painted = highlightTomlHtml(text, DEV_CONFIG_DEFAULTS, null);
  assert.match(painted, /toml-nondefault">autopilot_kp = 9/);
  assert.doesNotMatch(painted, /toml-nondefault">flow_tracers/);
});

test('index.html wraps both editors in toml-editor', () => {
  assert.match(html, /class="toml-editor"/);
  assert.match(html, /class="toml-highlight"/);
  assert.match(html, /id="dev_config"[^>]*class="[^"]*toml-box-overlay/);
  assert.match(html, /id="room_config"[^>]*class="[^"]*toml-box-overlay/);
  assert.match(html, /\.toml-nondefault\s*\{\s*color:\s*#ff6b6b/);
  assert.match(html, /toml-box-overlay/);
});

test('installTomlHighlight paints into the backdrop pre', () => {
  const calls = [];
  const pre = {
    className: '',
    setAttribute() {},
    innerHTML: '',
    scrollTop: 0,
    scrollLeft: 0,
  };
  const ta = {
    value: stringifyDevConfig({ ...DEV_CONFIG_DEFAULTS, contrast: 2 }),
    classList: { contains: () => false, add() {} },
    parentNode: {
      insertBefore(node, ref) { calls.push(['insert', node, ref]); },
      querySelector: () => null,
    },
    closest: () => null,
    addEventListener(type, fn) { calls.push(['on', type, fn]); },
    removeEventListener() {},
    scrollTop: 0,
    scrollLeft: 0,
  };
  // Minimal document.createElement stub.
  const created = [];
  const prev = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      const el = tag === 'pre' ? pre : { className: '', appendChild(c) { this.child = c; }, querySelector: () => pre, insertBefore() {} };
      created.push([tag, el]);
      return el;
    },
  };
  try {
    const api = installTomlHighlight(ta, {
      getDefaults: () => DEV_CONFIG_DEFAULTS,
      getConfig: (text) => {
        const v = parseAndValidateDevConfig(text);
        return v.error ? null : v.config;
      },
    });
    assert.ok(api.refresh);
    assert.match(pre.innerHTML, /toml-nondefault">contrast = 2/);
    assert.ok(calls.some((c) => c[0] === 'on' && c[1] === 'input'));
    assert.ok(calls.some((c) => c[0] === 'on' && c[1] === 'scroll'));
  } finally {
    globalThis.document = prev;
  }
});
