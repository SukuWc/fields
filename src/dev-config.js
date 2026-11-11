// Dev preferences as one TOML document (the Dev tab). Same rules as the
// room document (src/room-config.js): parse the whole text, reject unknown
// keys, wrong types and out-of-range values, and only then is there a
// config to apply. A missing key is the default (the editor always shows
// every key). Nothing is applied until the whole document validates.
//
// Scope. Every key is this page only (settings-registry panel 'dev').
// Visual keys (flow tracers, forces, refinement border, perf overlay, plot,
// contrast, boat trails, ghost boat) and sticky autopilot change this
// client. They are not room commands and do not change another client's view.
//
// Autopilot PID (autopilot_kp / autopilot_ki / autopilot_kd). The sim owns
// the gains on each boat (boat.js). Defaults are AUTOPILOT_KP (2), integral
// 0 and AUTOPILOT_KD (~29.9), so an untouched document steers as before.
// Apply sends { type: 'autopilotGains', kp, ki, kd } with no boat index.
//   local / worker: the page owns the sim, so the gains become the sim
//     default and are written onto every current boat by boat id (spawn id
//     or scenario uid, never an array index). Boats created later (scenario
//     restart, spawn) get the same gains.
//   remote: the server writes them only onto boats that client owns, looked
//     up by those boats' ids. Another player's boat is left alone. A
//     spectator has no boat: the gains are remembered on that client and
//     applied when they spawn, and this page's visuals still apply. The
//     server rejects an out-of-range command without writing any boat.
// One document has one P, I and D. It cannot give two of your boats
// different gains.
//
// Max rudder (rudder_max_deg, default 60°, 10..90). The manual helm's
// hard-over each side, Boat.rudder_angle_max. It rides on the same
// autopilotGains command as optional `rudderMax`, so it reaches the same
// boats by the same rules as the PID above (local/worker: every boat and
// later ones; remote: this client's boats, remembered for spawns and
// reconnects). The autopilot saturates at this limit too; the
// penalty-turn limit (50°) stays, capped at this one. A command without rudderMax leaves each
// boat's limit alone.
//
// Persistence. Applied config is localStorage 'fields.devConfig'. Older
// saves (fields.playerPrefs keys for these settings, and
// fields.stickyAutopilot) are copied in once and then removed. A query
// key (?show_field, ?boat_trails, ?sticky_autopilot, ?autopilotKp, …)
// still wins over the saved value for that load. Invalid TOML is not
// written and does not change the applied config.
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import {
  AUTOPILOT_KD_DEFAULT,
  AUTOPILOT_KI_DEFAULT,
  AUTOPILOT_KP_DEFAULT,
  RUDDER_MAX_DEG_DEFAULT,
  setting,
} from './settings-registry.js';

// Registry id → TOML key. Order is the document order. Every dev-panel
// setting is here (test checks the inventory).
export const DEV_TOML_FIELDS = [
  { key: 'flow_tracers', id: 'show_field' },
  { key: 'tracer_count', id: 'tracers', zeroMeansAuto: true },
  { key: 'tracer_life_s', id: 'tracerLife' },
  { key: 'tracer_tail_s', id: 'tracerTail' },
  { key: 'show_forces', id: 'show_forces' },
  { key: 'show_refinement', id: 'show_refinement' },
  { key: 'perf_overlay', id: 'perf' },
  { key: 'plot', id: 'plotSelect', plot: true },
  { key: 'contrast', id: 'contrastSlider' },
  { key: 'boat_trails', id: 'boat_trails' },
  { key: 'trail_interval_s', id: 'trailInterval' },
  { key: 'trail_duration_s', id: 'trailDuration' },
  { key: 'trail_size_m', id: 'trailSize' },
  { key: 'ghost_boat', id: 'ghost' },
  { key: 'ghost_ahead_s', id: 'ghostAhead' },
  { key: 'sticky_autopilot', id: 'sticky_autopilot' },
  { key: 'autopilot_kp', id: 'autopilotKp' },
  { key: 'autopilot_ki', id: 'autopilotKi' },
  { key: 'autopilot_kd', id: 'autopilotKd' },
  { key: 'rudder_max_deg', id: 'rudderMax' },
];

export const DEV_CONFIG_KEYS = DEV_TOML_FIELDS.map((f) => f.key);
const FIELD_BY_KEY = new Map(DEV_TOML_FIELDS.map((f) => [f.key, f]));
const FIELD_BY_ID = new Map(DEV_TOML_FIELDS.map((f) => [f.id, f]));

// Plot tokens in the TOML, in #plotSelect index order. The URL keeps the
// old option text ("Plot speed") so existing links still work.
export const PLOT_TOKENS = ['density', 'x_velocity', 'y_velocity', 'speed', 'curl'];
export const PLOT_LABELS = ['Plot density', 'Plot x velocity', 'Plot y velocity', 'Plot speed', 'Plot curl'];

const HEADER = [
  '# This page only. Apply sends the autopilot gains to boats this page may control.',
  '# A tracer count of 0 is automatic. An integral gain of 0 keeps the previous PD controller.',
  '# rudder_max_deg: manual helm hard-over each side, 10..90 degrees (default 60). The autopilot uses the same limit; penalty turns stay at 50 or less.',
  '',
].join('\n');

function defaultValue(field) {
  if (field.zeroMeansAuto) return 0;
  if (field.plot) return 'speed';
  return setting(field.id).default;
}

export const DEV_CONFIG_DEFAULTS = Object.freeze(Object.fromEntries(
  DEV_TOML_FIELDS.map((f) => [f.key, defaultValue(f)]),
));

export const DEV_CONFIG_KEY = 'fields.devConfig';

const CHECKED = new Set(['1', 'true', 'on', 'yes']);
const UNCHECKED = new Set(['0', 'false', 'off', 'no']);

function rangeText(s) {
  if (s.min != null && s.max != null) return s.min + '..' + s.max;
  if (s.min != null) return '≥ ' + s.min;
  if (s.max != null) return '≤ ' + s.max;
  return 'a number';
}

function inRange(s, v) {
  if (s.min != null && v < s.min) return false;
  if (s.max != null && v > s.max) return false;
  return true;
}

/**
 * One legacy / URL value (registry id) → TOML value, or undefined to skip.
 * Accepts the types player-prefs and the query string actually stored:
 * booleans, numeric strings, "Plot speed", and tracers "" / null for auto.
 */
export function coerceLegacy(id, raw) {
  const field = FIELD_BY_ID.get(id);
  if (!field) return undefined;
  const s = setting(id);
  if (field.zeroMeansAuto) {
    if (raw === null || raw === undefined || raw === '') return 0;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (n === 0) return 0;
    if (Number.isInteger(n) && inRange(s, n)) return n;
    return undefined;
  }
  if (field.plot) {
    const text = String(raw);
    const byLabel = PLOT_LABELS.indexOf(text);
    if (byLabel >= 0) return PLOT_TOKENS[byLabel];
    if (PLOT_TOKENS.includes(text)) return text;
    return undefined;
  }
  if (s.type === 'bool') {
    if (typeof raw === 'boolean') return raw;
    const t = String(raw).trim().toLowerCase();
    if (CHECKED.has(t)) return true;
    if (UNCHECKED.has(t)) return false;
    return undefined;
  }
  if (s.type === 'number' || s.type === 'int') {
    if (raw === null || raw === undefined || raw === '') return undefined;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n) || !inRange(s, n)) return undefined;
    return n;
  }
  return undefined;
}

/** Query string for one TOML value, or null when it is the default (omit). */
export function legacyUrlValue(id, tomlValue) {
  const field = FIELD_BY_ID.get(id);
  if (!field) return null;
  const s = setting(id);
  if (field.zeroMeansAuto) return tomlValue ? String(tomlValue) : null;
  if (field.plot) {
    const label = PLOT_LABELS[PLOT_TOKENS.indexOf(tomlValue)];
    return label && label !== s.default ? label : null;
  }
  if (s.type === 'bool') {
    if (!!tomlValue === !!s.default) return null;
    return tomlValue ? '1' : '0';
  }
  if (tomlValue === s.default) return null;
  return String(tomlValue);
}

export function stringifyDevConfig(cfg) {
  const ordered = {};
  for (const key of DEV_CONFIG_KEYS) ordered[key] = cfg[key];
  return HEADER + stringifyToml(ordered).trim() + '\n';
}

export function parseDevConfigToml(text) {
  let raw;
  try {
    raw = parseToml(String(text ?? ''));
  } catch (e) {
    const msg = e && e.message ? String(e.message).split('\n')[0] : String(e);
    return { error: 'TOML: ' + msg, line: e && Number.isInteger(e.line) ? e.line : null };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'TOML must be a table of keys' };
  }
  const unknown = Object.keys(raw).filter((k) => !FIELD_BY_KEY.has(k));
  if (unknown.length) return { error: 'unknown key(s): ' + unknown.join(', ') };
  const config = { ...DEV_CONFIG_DEFAULTS };
  for (const key of DEV_CONFIG_KEYS) if (key in raw) config[key] = raw[key];
  return { config };
}

/**
 * Validate a full config object. Returns { config } or { error }.
 * Does not read the sim and does not apply anything.
 */
export function validateDevConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { error: 'config must be an object' };
  const unknown = Object.keys(cfg).filter((k) => !FIELD_BY_KEY.has(k) && !k.startsWith('_'));
  if (unknown.length) return { error: 'unknown key(s): ' + unknown.join(', ') };
  const out = {};
  try {
    for (const field of DEV_TOML_FIELDS) {
      const v = cfg[field.key];
      const s = setting(field.id);
      if (field.zeroMeansAuto) {
        if (!Number.isInteger(v) || (v !== 0 && !inRange(s, v))) {
          throw field.key + ' must be 0 (auto) or an integer ' + s.min + '..' + s.max;
        }
        out[field.key] = v;
        continue;
      }
      if (field.plot) {
        if (!PLOT_TOKENS.includes(v)) throw field.key + ' must be ' + PLOT_TOKENS.join(', ');
        out[field.key] = v;
        continue;
      }
      if (s.type === 'bool') {
        if (typeof v !== 'boolean') throw field.key + ' must be true or false';
        out[field.key] = v;
        continue;
      }
      if (s.type === 'number' || s.type === 'int') {
        if (typeof v !== 'number' || !Number.isFinite(v) || !inRange(s, v)) {
          throw field.key + ' must be ' + rangeText(s);
        }
        out[field.key] = v;
        continue;
      }
      throw field.key + ' is not a dev setting';
    }
  } catch (msg) {
    return { error: typeof msg === 'string' ? msg : String(msg) };
  }
  return { config: out };
}

export function parseAndValidateDevConfig(text) {
  const p = parseDevConfigToml(text);
  if (p.error) return p;
  return validateDevConfig(p.config);
}

/**
 * { kp, ki, kd[, rudderMax] } or { error }. Used by the sim and the server
 * before any boat is written. rudderMax is optional (absent: boats keep
 * their limit) and is returned only when the command carries it.
 */
export function validateAutopilotGains(c) {
  if (!c || typeof c !== 'object') return { error: 'autopilotGains needs kp, ki, kd' };
  const hasRudder = c.rudderMax !== undefined;
  const v = validateDevConfig({
    ...DEV_CONFIG_DEFAULTS,
    autopilot_kp: c.kp,
    autopilot_ki: c.ki,
    autopilot_kd: c.kd,
    ...(hasRudder ? { rudder_max_deg: c.rudderMax } : {}),
  });
  if (v.error) {
    if (/autopilot_k[pid]|rudder_max_deg/.test(v.error)) return { error: v.error };
    return { error: 'autopilotGains needs kp, ki, kd' };
  }
  const g = { kp: v.config.autopilot_kp, ki: v.config.autopilot_ki, kd: v.config.autopilot_kd };
  if (hasRudder) g.rudderMax = v.config.rudder_max_deg;
  return g;
}

export function autopilotGainsOf(cfg) {
  return { kp: cfg.autopilot_kp, ki: cfg.autopilot_ki, kd: cfg.autopilot_kd };
}

/** The boat command a dev Apply sends: the PID plus the manual rudder limit. */
export function devBoatCommand(cfg) {
  return { type: 'autopilotGains', ...autopilotGainsOf(cfg), rudderMax: cfg.rudder_max_deg };
}

/** What the client applies locally from a validated config. PID is separate (the sim command). */
export function devClientEffects(cfg) {
  return {
    flowTracers: cfg.flow_tracers,
    tracerCount: cfg.tracer_count === 0 ? null : cfg.tracer_count,
    tracerLife: cfg.tracer_life_s,
    tracerTail: cfg.tracer_tail_s,
    showForces: cfg.show_forces,
    showRefinement: cfg.show_refinement,
    perf: cfg.perf_overlay,
    plotType: PLOT_TOKENS.indexOf(cfg.plot),
    contrastExp: cfg.contrast,
    boatTrails: cfg.boat_trails,
    trailInterval: cfg.trail_interval_s,
    trailDuration: cfg.trail_duration_s,
    trailSize: cfg.trail_size_m,
    ghost: cfg.ghost_boat,
    ghostAhead: cfg.ghost_ahead_s,
    stickyAutopilot: cfg.sticky_autopilot,
  };
}

/**
 * Line (1-based) a validation or parse error points at, or null.
 * Same idea as roomConfigErrorLine: the parse error's own line, else the
 * key named in the message.
 */
export function devConfigErrorLine(text, err) {
  if (!err) return null;
  if (Number.isInteger(err.line)) return err.line;
  const msg = String(err.error || err);
  const lines = String(text ?? '').split('\n');
  const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const findKey = (k) => {
    const re = new RegExp('^\\s*' + esc(k) + '\\s*=');
    const i = lines.findIndex((l) => re.test(l));
    return i < 0 ? null : i + 1;
  };
  const unk = /unknown key\(s\): ([\w-]+)/.exec(msg);
  if (unk) return findKey(unk[1]);
  const keys = [...DEV_CONFIG_KEYS].sort((a, b) => b.length - a.length);
  for (const k of keys) if (new RegExp('\\b' + esc(k) + '\\b').test(msg)) { const l = findKey(k); if (l) return l; }
  return null;
}

/** Overlay query keys onto a validated config. Bad keys are skipped, not applied. */
export function configFromQuery(cfg, params) {
  const next = { ...cfg };
  let any = false;
  for (const field of DEV_TOML_FIELDS) {
    if (!params || !params.has(field.id)) continue;
    const v = coerceLegacy(field.id, params.get(field.id));
    if (v === undefined) continue;
    next[field.key] = v;
    any = true;
  }
  if (!any) return cfg;
  const v = validateDevConfig(next);
  return v.error ? cfg : v.config;
}

/**
 * Build a config from saved dev JSON plus leftover player-prefs / sticky
 * values. `saved` wins when it validates (the new store). Otherwise the
 * legacy values fill the defaults. Returns { config, migrated }.
 * `stickyRaw` is the old fields.stickyAutopilot value ('0' / '1' / null).
 */
export function configFromStored(saved, legacyPrefs, stickyRaw) {
  if (saved && typeof saved === 'object') {
    const known = {};
    for (const key of DEV_CONFIG_KEYS) if (key in saved) known[key] = saved[key];
    const v = validateDevConfig({ ...DEV_CONFIG_DEFAULTS, ...known });
    if (!v.error) return { config: v.config, migrated: false };
  }
  const next = { ...DEV_CONFIG_DEFAULTS };
  let migrated = false;
  if (legacyPrefs && typeof legacyPrefs === 'object') {
    for (const [id, raw] of Object.entries(legacyPrefs)) {
      const field = FIELD_BY_ID.get(id);
      if (!field) continue;
      const v = coerceLegacy(id, raw);
      if (v === undefined) continue;
      next[field.key] = v;
      migrated = true;
    }
  }
  if (stickyRaw != null && stickyRaw !== '') {
    const v = coerceLegacy('sticky_autopilot', stickyRaw);
    if (v !== undefined && v !== setting('sticky_autopilot').default) {
      next.sticky_autopilot = v;
      migrated = true;
    } else if (v !== undefined) migrated = true;
  }
  const out = validateDevConfig(next);
  return { config: out.error ? { ...DEV_CONFIG_DEFAULTS } : out.config, migrated };
}

export function devConfigIds() {
  return DEV_TOML_FIELDS.map((f) => f.id);
}

export { AUTOPILOT_KP_DEFAULT, AUTOPILOT_KI_DEFAULT, AUTOPILOT_KD_DEFAULT, RUDDER_MAX_DEG_DEFAULT };
