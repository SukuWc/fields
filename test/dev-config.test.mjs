// Dev TOML: full inventory, defaults, round-trip, invalid documents do not
// apply, revert / reset, and legacy player-prefs migration.
import './dom-stub.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS, setting } from '../src/settings-registry.js';
import { AUTOPILOT_KD, AUTOPILOT_KI, AUTOPILOT_KP } from '../src/boat.js';
import { PREFS_KEY } from '../src/player-prefs.js';
import { STICKY_AUTOPILOT_KEY } from '../src/controls.js';
import {
  DEV_CONFIG_DEFAULTS,
  DEV_CONFIG_KEY,
  DEV_CONFIG_KEYS,
  DEV_TOML_FIELDS,
  PLOT_LABELS,
  PLOT_TOKENS,
  autopilotGainsOf,
  coerceLegacy,
  configFromQuery,
  configFromStored,
  devClientEffects,
  devConfigErrorLine,
  legacyUrlValue,
  parseAndValidateDevConfig,
  stringifyDevConfig,
  validateAutopilotGains,
  validateDevConfig,
} from '../src/dev-config.js';
import { installDevPrefs } from '../src/dev-prefs.js';

const devSettings = SETTINGS.filter((s) => s.panel === 'dev');

test('TOML inventory covers every dev setting once', () => {
  assert.deepEqual(DEV_TOML_FIELDS.map((f) => f.id), devSettings.map((s) => s.id));
  assert.equal(new Set(DEV_CONFIG_KEYS).size, DEV_CONFIG_KEYS.length);
  assert.deepEqual(PLOT_LABELS, setting('plotSelect').values);
});

test('defaults match the registry and the boat PD controller', () => {
  assert.equal(DEV_CONFIG_DEFAULTS.autopilot_kp, AUTOPILOT_KP);
  assert.equal(DEV_CONFIG_DEFAULTS.autopilot_ki, AUTOPILOT_KI);
  assert.equal(DEV_CONFIG_DEFAULTS.autopilot_ki, 0);
  assert.equal(DEV_CONFIG_DEFAULTS.autopilot_kd, AUTOPILOT_KD);
  assert.equal(DEV_CONFIG_DEFAULTS.flow_tracers, true);
  assert.equal(DEV_CONFIG_DEFAULTS.tracer_count, 0);
  assert.equal(DEV_CONFIG_DEFAULTS.boat_trails, true);
  assert.equal(DEV_CONFIG_DEFAULTS.ghost_boat, false);
  assert.equal(DEV_CONFIG_DEFAULTS.sticky_autopilot, true);
  assert.equal(DEV_CONFIG_DEFAULTS.plot, 'speed');
  for (const field of DEV_TOML_FIELDS) {
    if (field.zeroMeansAuto) assert.equal(DEV_CONFIG_DEFAULTS[field.key], 0);
    else if (field.plot) assert.equal(DEV_CONFIG_DEFAULTS[field.key], 'speed');
    else assert.equal(DEV_CONFIG_DEFAULTS[field.key], setting(field.id).default);
  }
});

test('defaults round-trip through TOML', () => {
  const text = stringifyDevConfig(DEV_CONFIG_DEFAULTS);
  const p = parseAndValidateDevConfig(text);
  assert.equal(p.error, undefined);
  for (const key of DEV_CONFIG_KEYS) assert.equal(p.config[key], DEV_CONFIG_DEFAULTS[key], key);
  assert.equal(stringifyDevConfig(p.config), text);
  assert.match(text, /autopilot_ki = 0/);
  assert.match(text, /tracer_count = 0/);
});

test('invalid TOML, unknown keys, types and ranges are refused whole', () => {
  const base = stringifyDevConfig(DEV_CONFIG_DEFAULTS);
  const cases = [
    ['not toml {', /TOML/],
    ['foo = 1\n' + base, /unknown key/],
    [base.replace('flow_tracers = true', 'flow_tracers = 1'), /flow_tracers/],
    [base.replace('autopilot_kp = 2', 'autopilot_kp = "2"'), /autopilot_kp/],
    [base.replace('autopilot_ki = 0', 'autopilot_ki = -0.1'), /autopilot_ki/],
    [base.replace('autopilot_kd = ' + AUTOPILOT_KD, 'autopilot_kd = 500'), /autopilot_kd/],
    [base.replace('tracer_count = 0', 'tracer_count = 3'), /tracer_count/],
    [base.replace('plot = "speed"', 'plot = "nope"'), /plot/],
    [base.replace('contrast = 0', 'contrast = 11'), /contrast/],
    [base.replace('ghost_ahead_s = 2', 'ghost_ahead_s = 40'), /ghost_ahead_s/],
  ];
  for (const [text, re] of cases) {
    const r = parseAndValidateDevConfig(text);
    assert.ok(r.error, text.slice(0, 40));
    assert.match(r.error, re);
    assert.equal(r.config, undefined);
  }
  const bad = parseAndValidateDevConfig(base.replace('autopilot_kp = 2', 'autopilot_kp = 4\nfoo = 1'));
  assert.match(bad.error, /unknown key/);
  const line = devConfigErrorLine(base.replace('flow_tracers = true', 'flow_tracers = "yes"'), parseAndValidateDevConfig(base.replace('flow_tracers = true', 'flow_tracers = "yes"')));
  assert.ok(line > 0);
});

test('legacy prefs and the query string move into the document', () => {
  const stored = configFromStored(null, {
    show_forces: true,
    ghost: true,
    ghostAhead: '4',
    trailInterval: '2.5',
    plotSelect: 'Plot curl',
    tracers: '80',
    vibrate: false,
  }, '0');
  assert.equal(stored.migrated, true);
  assert.equal(stored.config.show_forces, true);
  assert.equal(stored.config.ghost_boat, true);
  assert.equal(stored.config.ghost_ahead_s, 4);
  assert.equal(stored.config.trail_interval_s, 2.5);
  assert.equal(stored.config.plot, 'curl');
  assert.equal(stored.config.tracer_count, 80);
  assert.equal(stored.config.sticky_autopilot, false);
  assert.equal(stored.config.flow_tracers, true);
  const over = configFromQuery(stored.config, new URLSearchParams('show_field=0&sticky_autopilot=1&autopilotKp=4'));
  assert.equal(over.flow_tracers, false);
  assert.equal(over.sticky_autopilot, true);
  assert.equal(over.autopilot_kp, 4);
  assert.equal(over.show_forces, true);
  assert.equal(legacyUrlValue('show_field', false), '0');
  assert.equal(legacyUrlValue('show_field', true), null);
  assert.equal(legacyUrlValue('plotSelect', 'curl'), 'Plot curl');
  assert.equal(coerceLegacy('tracers', ''), 0);
  const kept = configFromStored({ ...DEV_CONFIG_DEFAULTS, show_forces: false, autopilot_kp: 3 }, { show_forces: true }, '0');
  assert.equal(kept.migrated, false);
  assert.equal(kept.config.show_forces, false);
  assert.equal(kept.config.autopilot_kp, 3);
  assert.equal(kept.config.sticky_autopilot, true);
});

test('gain validation rejects a bad command before any boat is named', () => {
  assert.deepEqual(validateAutopilotGains({ kp: 2, ki: 0, kd: AUTOPILOT_KD }), { kp: 2, ki: 0, kd: AUTOPILOT_KD });
  assert.match(validateAutopilotGains({ kp: 2, ki: '0', kd: 1 }).error, /autopilot_ki/);
  assert.match(validateAutopilotGains({ kp: 99, ki: 0, kd: 1 }).error, /autopilot_kp/);
  const fx = devClientEffects({ ...DEV_CONFIG_DEFAULTS, tracer_count: 0, plot: 'curl' });
  assert.equal(fx.tracerCount, null);
  assert.equal(fx.plotType, PLOT_TOKENS.indexOf('curl'));
  assert.deepEqual(autopilotGainsOf(DEV_CONFIG_DEFAULTS), { kp: AUTOPILOT_KP, ki: 0, kd: AUTOPILOT_KD });
});

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

function el(id) {
  const box = {
    id,
    value: '',
    textContent: '',
    hidden: true,
    disabled: false,
    dataset: {},
    scrollTop: 0,
    selection: null,
    bad: false,
    _on: {},
    classList: { toggle(name, on) { if (name === 'bad') box.bad = !!on; } },
    addEventListener(type, fn) { (box._on[type] ||= []).push(fn); },
    focus() { box.focused = true; },
    setSelectionRange(a, b) { box.selection = [a, b]; },
    fire(type) { for (const fn of box._on[type] || []) fn(); },
  };
  return box;
}

function editorDoc() {
  const ids = ['dev_config', 'dev_config_check', 'dev_config_status', 'dev_config_mode', 'dev_config_commit', 'dev_config_revert', 'dev_config_reset'];
  const els = Object.fromEntries(ids.map((id) => [id, el(id)]));
  return { getElementById: (id) => els[id] || null, els };
}

test('Apply, Revert and Reset match the room editor and invalid text does not apply', async () => {
  const doc = editorDoc();
  const storage = memoryStorage({
    [PREFS_KEY]: JSON.stringify({ show_forces: true, boat_name: 'Ann', ghost: false }),
    [STICKY_AUTOPILOT_KEY]: '0',
  });
  const commands = [];
  const visuals = [];
  const host = {
    kind: 'local',
    commandSync(c) { commands.push(c); return { ok: true, boats: ['s1'] }; },
    command(c) { commands.push(c); return Promise.resolve({ ok: true, boats: ['s1'] }); },
    on() {},
  };
  const api = installDevPrefs(doc, {
    host,
    storage,
    applyLocal: (fx) => visuals.push(fx),
  });
  const started = await api.ready;
  assert.equal(started.error, undefined);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, 'autopilotGains');
  assert.equal(commands[0].kp, AUTOPILOT_KP);
  assert.equal(commands[0].rudderMax, 60);
  assert.equal(visuals.at(-1).showForces, true);
  assert.equal(visuals.at(-1).stickyAutopilot, false);
  assert.equal(storage.getItem(STICKY_AUTOPILOT_KEY), null);
  const prefs = JSON.parse(storage.getItem(PREFS_KEY));
  assert.equal(prefs.boat_name, 'Ann');
  assert.equal(prefs.show_forces, undefined);
  assert.match(storage.getItem(DEV_CONFIG_KEY), /show_forces/);
  const ta = doc.els.dev_config;
  assert.match(ta.value, /show_forces = true/);
  assert.match(ta.value, /sticky_autopilot = false/);
  assert.equal(doc.els.dev_config_commit.disabled, true);
  assert.equal(doc.els.dev_config_revert.disabled, true);

  const applied = ta.value;
  ta.value = applied.replace('show_forces = true', 'show_forces = true\nnope = 1');
  ta.fire('input');
  assert.equal(ta.bad, true);
  assert.match(doc.els.dev_config_check.textContent, /Line \d+: unknown key/);
  assert.equal(doc.els.dev_config_commit.disabled, true);
  doc.els.dev_config_check.fire('click');
  assert.ok(ta.focused);
  assert.ok(ta.selection);
  doc.els.dev_config_commit.fire('click');
  assert.equal(commands.length, 1);
  assert.equal(visuals.length, 1);

  ta.value = applied.replace('autopilot_kp = 2', 'autopilot_kp = 4');
  ta.fire('input');
  assert.equal(doc.els.dev_config_check.textContent, 'Valid · not applied yet');
  assert.equal(doc.els.dev_config_commit.disabled, false);
  assert.equal(doc.els.dev_config_revert.disabled, false);
  doc.els.dev_config_revert.fire('click');
  assert.equal(ta.value, applied);
  assert.equal(commands.length, 1);
  assert.equal(doc.els.dev_config_commit.disabled, true);

  doc.els.dev_config_reset.fire('click');
  assert.match(ta.value, /show_forces = false/);
  assert.match(ta.value, /sticky_autopilot = true/);
  assert.equal(commands.length, 1, 'Reset does not apply');
  assert.equal(visuals.at(-1).showForces, true);
  doc.els.dev_config_revert.fire('click');
  assert.equal(ta.value, applied);

  ta.value = applied.replace('autopilot_kp = 2', 'autopilot_kp = 4').replace('flow_tracers = true', 'flow_tracers = false');
  ta.fire('input');
  doc.els.dev_config_commit.fire('click');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(commands.length, 2);
  assert.equal(commands[1].kp, 4);
  assert.equal(commands[1].boat, undefined);
  assert.equal(visuals.at(-1).flowTracers, false);
  assert.match(ta.value, /autopilot_kp = 4/);
  assert.match(storage.getItem(DEV_CONFIG_KEY), /"autopilot_kp":4/);

  const good = ta.value;
  ta.value = good.replace('autopilot_ki = 0', 'autopilot_ki = 9');
  ta.fire('input');
  doc.els.dev_config_commit.fire('click');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(commands.length, 2, 'out of range does not apply');
  assert.equal(visuals.at(-1).flowTracers, false);
  assert.match(doc.els.dev_config_check.textContent, /autopilot_ki/);
});
