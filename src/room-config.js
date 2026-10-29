// Room / admin configuration as a single TOML document.
// Replaces the per-control Room settings panel (#admin_panel) and the old
// room URL query params (?simRes, ?amr, ?cellBudget, …).
//
// Semantics:
//   refine_max_level = 0  → mesh refinement / AMR off
//   sail_wake_gain = 0    → boat energy off
//   budget_target = -1    → unlimited cell budget (no tuning)
//   amr_auto              → amrMode auto|fixed
//   root_cell_m + steps_per_frame → simRes mode (metres for the root cell)
//   gusts = false         → rate spawner off (no inject / outlines from spawner)
//   gust_* = number | [mean, sd]  → per-column sample knobs (sd optional, default 0)
//   scenario = "custom" + [custom] → marks / start / course / finish /
//                           boundary from the TOML (custom-scenario.js)
//
// Browser and Node: smol-toml. Used by the admin textarea, the server's
// atomic `config` room command, and tests.
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { SIM_RES_MODES, DEFAULT_SIM_RES, MAX_WIND_MPS, DEFAULT_MAP_SIZE } from './settings-registry.js';
import { MAP_SIZES, parseMapSize, mapDimsError, scenarioExtent, WALL_INSET_M } from './map-size.js';
import {
  GUST_FORCE_GAIN, GUST_ALONG_SIGMA_M, GUST_CROSS_SIGMA_M, GUST_LIFE_S,
} from './gusts.js';
import { CUSTOM_SCENARIO, validateCustomLayout, customLayoutToToml } from './custom-scenario.js';

export const ROOM_CONFIG_KEYS = [
  'scenario',
  'map_width_m',
  'map_height_m',
  'wind_angle_deg',
  'wind_speed_mps',
  'dev_mode',
  'barrier',
  'ladder_lines',
  'amr_auto',
  'root_cell_m',
  'steps_per_frame',
  'sail_wake_gain',
  'field_skip',
  'refine_max_level',
  'boat_refine_radius_m',
  'budget_target',
  'gusts',
  'gust_rate_per_min',
  'gust_force_gain',
  'gust_along_sigma_m',
  'gust_cross_sigma_m',
  'gust_life_s',
  'gust_dir_deg',
  'gust_ramp_s',
  // Only with scenario = "custom": static layout table (custom-scenario.js).
  'custom',
];

export const ROOM_CONFIG_DEFAULTS = Object.freeze({
  // Remote/server Reset preset (matches live sailzone.app europe-1).
  // Local solo also seeds from this shared source on first Commit.
  scenario: 0,
  map_width_m: 100,
  map_height_m: 200,
  wind_angle_deg: 90,
  wind_speed_mps: 4.5,
  dev_mode: false,
  barrier: false,
  ladder_lines: false,
  amr_auto: true,
  root_cell_m: 2,
  steps_per_frame: 1,
  sail_wake_gain: 16,
  field_skip: 0,
  refine_max_level: 2,
  boat_refine_radius_m: 3,
  budget_target: 50000,
  gusts: true,
  gust_rate_per_min: 10,
  gust_force_gain: [0.0005, 0],
  gust_along_sigma_m: [10, 10],
  gust_cross_sigma_m: [10, 10],
  gust_life_s: [10, 5],
  gust_dir_deg: [0, 45],
  gust_ramp_s: 1.5,
});

function approxEq(a, b) {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Parse a mean[, sd] TOML value: number → {mean, sd:0}; [m] → sd 0; [m,s] → both.
 * Returns { mean, sd } or { error }.
 */
export function parseMeanSd(raw, name) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return { mean: raw, sd: 0 };
  if (Array.isArray(raw)) {
    if (raw.length !== 1 && raw.length !== 2) {
      return { error: name + ' must be a number or [mean] / [mean, sd]' };
    }
    const mean = raw[0], sd = raw.length === 2 ? raw[1] : 0;
    if (!Number.isFinite(mean)) return { error: name + ' mean must be a number' };
    if (!Number.isFinite(sd) || sd < 0) return { error: name + ' sd must be a number ≥ 0' };
    return { mean, sd };
  }
  return { error: name + ' must be a number or [mean, sd]' };
}

/** TOML form: always [mean, sd] (sd defaults to 0). */
export function meanSdToToml(mean, sd) {
  return [mean, sd > 0 ? sd : 0];
}

/** Flat gust spawner snapshot from a validated room config. */
export function gustSpawnerFromConfig(cfg) {
  const fg = parseMeanSd(cfg.gust_force_gain, 'gust_force_gain');
  const al = parseMeanSd(cfg.gust_along_sigma_m, 'gust_along_sigma_m');
  const cr = parseMeanSd(cfg.gust_cross_sigma_m, 'gust_cross_sigma_m');
  const life = parseMeanSd(cfg.gust_life_s, 'gust_life_s');
  const dir = parseMeanSd(cfg.gust_dir_deg, 'gust_dir_deg');
  return {
    enabled: !!cfg.gusts,
    ratePerMin: cfg.gust_rate_per_min,
    forceGain: fg.mean, forceGainSd: fg.sd,
    alongSigmaM: al.mean, alongSigmaMSd: al.sd,
    crossSigmaM: cr.mean, crossSigmaMSd: cr.sd,
    lifeS: life.mean, lifeSSd: life.sd,
    dirDeg: dir.mean, dirDegSd: dir.sd,
    rampS: cfg.gust_ramp_s,
  };
}

/** Root cell (m) and steps/frame for a known simRes mode. */
export function rootFromSimRes(mode) {
  const m = SIM_RES_MODES[mode] || SIM_RES_MODES[DEFAULT_SIM_RES];
  return {
    root_cell_m: 1 / m.resolution,
    steps_per_frame: m.stepsPerFrame ?? m.resolution,
  };
}

/** Known simRes mode for root_cell_m + steps_per_frame, or null. */
export function simResForRoot(root_cell_m, steps_per_frame) {
  for (const [key, m] of Object.entries(SIM_RES_MODES)) {
    const root = 1 / m.resolution;
    const steps = m.stepsPerFrame ?? m.resolution;
    if (approxEq(root, root_cell_m) && approxEq(steps, steps_per_frame)) return key;
  }
  return null;
}

export function allowedSimResPairs() {
  return Object.entries(SIM_RES_MODES).map(([key, m]) => ({
    mode: key,
    root_cell_m: 1 / m.resolution,
    steps_per_frame: m.stepsPerFrame ?? m.resolution,
  }));
}

export function mapKeyFromDims(w, h) {
  return parseMapSize(String(w) + 'x' + String(h));
}

export function defaultsConfig(overrides = {}) {
  return { ...ROOM_CONFIG_DEFAULTS, ...overrides };
}

/** Room-config gust keys from SimCore.settings.gusts (spawner snapshot). */
export function gustConfigFromSettings(g) {
  if (!g || typeof g !== 'object') {
    return {
      gusts: ROOM_CONFIG_DEFAULTS.gusts,
      gust_rate_per_min: ROOM_CONFIG_DEFAULTS.gust_rate_per_min,
      gust_force_gain: ROOM_CONFIG_DEFAULTS.gust_force_gain,
      gust_along_sigma_m: ROOM_CONFIG_DEFAULTS.gust_along_sigma_m,
      gust_cross_sigma_m: ROOM_CONFIG_DEFAULTS.gust_cross_sigma_m,
      gust_life_s: ROOM_CONFIG_DEFAULTS.gust_life_s,
      gust_dir_deg: ROOM_CONFIG_DEFAULTS.gust_dir_deg,
      gust_ramp_s: ROOM_CONFIG_DEFAULTS.gust_ramp_s,
    };
  }
  return {
    gusts: !!g.enabled,
    gust_rate_per_min: Number.isFinite(g.ratePerMin) ? g.ratePerMin : ROOM_CONFIG_DEFAULTS.gust_rate_per_min,
    gust_force_gain: meanSdToToml(
      Number.isFinite(g.forceGain) ? g.forceGain : GUST_FORCE_GAIN,
      Number.isFinite(g.forceGainSd) ? g.forceGainSd : 0),
    gust_along_sigma_m: meanSdToToml(
      Number.isFinite(g.alongSigmaM) ? g.alongSigmaM : GUST_ALONG_SIGMA_M,
      Number.isFinite(g.alongSigmaMSd) ? g.alongSigmaMSd : 0),
    gust_cross_sigma_m: meanSdToToml(
      Number.isFinite(g.crossSigmaM) ? g.crossSigmaM : GUST_CROSS_SIGMA_M,
      Number.isFinite(g.crossSigmaMSd) ? g.crossSigmaMSd : 0),
    gust_life_s: meanSdToToml(
      Number.isFinite(g.lifeS) ? g.lifeS : GUST_LIFE_S,
      Number.isFinite(g.lifeSSd) ? g.lifeSSd : 0),
    gust_dir_deg: meanSdToToml(
      Number.isFinite(g.dirDeg) ? g.dirDeg : 0,
      Number.isFinite(g.dirDegSd) ? g.dirDegSd : 0),
    gust_ramp_s: Number.isFinite(g.rampS) ? g.rampS : ROOM_CONFIG_DEFAULTS.gust_ramp_s,
  };
}

/** Build a config object from SimCore.settings + scenario index + map size. */
export function configFromRoomState(roomOrSettings, { scenarioIndex = 0, mapW, mapH } = {}) {
  const settings = roomOrSettings && roomOrSettings.settings ? roomOrSettings.settings : roomOrSettings;
  const idx = roomOrSettings && roomOrSettings.scenario ? roomOrSettings.scenario.index : undefined;
  const st = settings || {};
  const isCustom = idx === CUSTOM_SCENARIO && st.custom && typeof st.custom === 'object';
  const sc = Number.isInteger(idx) ? idx : scenarioIndex;
  const wind = st.wind || {};
  const refine = st.refine || {};
  const budget = st.cellBudget || {};
  const root = rootFromSimRes(st.simRes || DEFAULT_SIM_RES);
  const amrOn = st.amr !== false;
  const boatEnergyOn = st.boatEnergy !== false;
  let budget_target = -1;
  if (budget.tune && Number.isFinite(budget.target) && budget.target > 0) budget_target = budget.target;
  else if (budget.tune && (budget.target === null || budget.target === undefined)) {
    // Tuned to grid default: keep -1 only when unlimited was the intent.
    // Old default was tune:true + null target (= grid default). New TOML
    // default is unlimited (-1). Round-trip of a live room with tune+null
    // shows -1 (unlimited) only when tune is false; when tune is true with
    // null we still emit -1 and treat Commit of -1 as unlimited (tune off).
    budget_target = -1;
  }
  return defaultsConfig({
    scenario: isCustom ? CUSTOM_SCENARIO : Number.isInteger(sc) ? sc : 0,
    map_width_m: mapW ?? ROOM_CONFIG_DEFAULTS.map_width_m,
    map_height_m: mapH ?? ROOM_CONFIG_DEFAULTS.map_height_m,
    wind_angle_deg: Number.isFinite(wind.angle) ? wind.angle : ROOM_CONFIG_DEFAULTS.wind_angle_deg,
    wind_speed_mps: Number.isFinite(wind.speed) ? wind.speed : ROOM_CONFIG_DEFAULTS.wind_speed_mps,
    dev_mode: !!st.devMode,
    barrier: !!st.barrier,
    ladder_lines: !!st.ladder,
    amr_auto: (st.amrMode || 'auto') === 'auto',
    root_cell_m: root.root_cell_m,
    steps_per_frame: root.steps_per_frame,
    sail_wake_gain: boatEnergyOn
      ? (Number.isFinite(st.sailWakeGain) ? st.sailWakeGain : ROOM_CONFIG_DEFAULTS.sail_wake_gain)
      : 0,
    field_skip: Number.isInteger(st.fieldSkip) ? st.fieldSkip : ROOM_CONFIG_DEFAULTS.field_skip,
    refine_max_level: amrOn
      ? (Number.isInteger(refine.maxLevel) ? refine.maxLevel : ROOM_CONFIG_DEFAULTS.refine_max_level)
      : 0,
    boat_refine_radius_m: Number.isFinite(refine.boatRefineRadius)
      ? refine.boatRefineRadius
      : ROOM_CONFIG_DEFAULTS.boat_refine_radius_m,
    budget_target,
    ...gustConfigFromSettings(st.gusts),
    ...(isCustom ? { custom: JSON.parse(JSON.stringify(st.custom)) } : {}),
  });
}

// TOML value for the hand-written [custom] tables (smol-toml's writer would
// expand the course legs into [[custom.course.legs]] blocks).
function tomlValue(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return '[' + v.map(tomlValue).join(', ') + ']';
  if (v && typeof v === 'object') return '{ ' + Object.entries(v).map(([k, x]) => k + ' = ' + tomlValue(x)).join(', ') + ' }';
  throw new Error('no TOML form for ' + v);
}

/** [custom] block in a fixed order: scalars, then marks/start/course/finish/boundary. */
export function stringifyCustomToml(t) {
  const lines = ['[custom]'];
  for (const k of ['title', 'description']) if (t[k] !== undefined) lines.push(k + ' = ' + tomlValue(t[k]));
  const table = (name, obj) => {
    if (!obj) return;
    lines.push('', '[custom.' + name + ']');
    for (const [k, v] of Object.entries(obj)) {
      if (name === 'course' && k === 'legs') {
        lines.push('legs = [');
        for (const leg of v) lines.push('  ' + tomlValue(leg) + ',');
        lines.push(']');
      } else lines.push(k + ' = ' + tomlValue(v));
    }
  };
  table('marks', t.marks);
  table('start', t.start);
  table('course', t.course);
  table('finish', t.finish);
  table('boundary', t.boundary);
  return lines.join('\n') + '\n';
}

/** Stable TOML for the textarea (key order fixed, bools/numbers plain). */
export function stringifyRoomConfig(cfg) {
  const ordered = {};
  for (const k of ROOM_CONFIG_KEYS) {
    if (cfg[k] === undefined || k === 'custom') continue;
    ordered[k] = cfg[k];
  }
  const head = stringifyToml(ordered).trim() + '\n';
  return cfg.custom && cfg.scenario === CUSTOM_SCENARIO ? head + '\n' + stringifyCustomToml(cfg.custom) : head;
}

/**
 * Default room TOML for Reset: ROOM_CONFIG_DEFAULTS, with map dims overridden
 * to the live room size (a remote size change rebuilds the server core; local keeps the
 * page's current map so Reset does not imply a reload). Local-only fill —
 * does not send a room command.
 */
export function defaultRoomConfig(mapW, mapH) {
  const cfg = { ...ROOM_CONFIG_DEFAULTS };
  if (Number.isFinite(mapW) && mapW > 0) cfg.map_width_m = mapW;
  if (Number.isFinite(mapH) && mapH > 0) cfg.map_height_m = mapH;
  return cfg;
}

/**
 * Parse TOML text into a plain object (only known keys kept).
 * Returns { config } or { error }.
 */
export function parseRoomConfigToml(text) {
  let raw;
  try {
    raw = parseToml(String(text ?? ''));
  } catch (e) {
    return { error: 'TOML: ' + (e && e.message ? e.message : String(e)) };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'TOML must be a table of keys' };
  }
  const unknown = Object.keys(raw).filter((k) => !ROOM_CONFIG_KEYS.includes(k));
  if (unknown.length) return { error: 'unknown key(s): ' + unknown.join(', ') };
  const config = { ...ROOM_CONFIG_DEFAULTS };
  for (const k of ROOM_CONFIG_KEYS) {
    if (k in raw) config[k] = raw[k];
  }
  return { config };
}

/**
 * Validate and normalise a config object.
 * checks: { core } for scenario fit, or { mapW, mapH, scenarios }.
 * Returns { config } or { error }.
 */
export function validateRoomConfig(cfg, checks = {}) {
  if (!cfg || typeof cfg !== 'object') return { error: 'config must be an object' };
  const out = {};
  const need = (cond, msg) => { if (!cond) throw msg; };

  try {
    // scenario
    {
      const v = cfg.scenario;
      need((Number.isInteger(v) && v >= 0) || v === CUSTOM_SCENARIO, 'scenario must be an integer ≥ 0 or "custom"');
      out.scenario = v;
      if (v !== CUSTOM_SCENARIO) need(cfg.custom === undefined, '[custom] needs scenario = "custom"');
      else need(cfg.custom !== undefined, 'scenario = "custom" needs a [custom] table');
    }
    // map
    {
      const w = cfg.map_width_m, h = cfg.map_height_m;
      const err = mapDimsError(w, h);
      need(!err, err);
      out.map_width_m = w;
      out.map_height_m = h;
      out._mapKey = w + 'x' + h;
    }
    // wind
    {
      const a = cfg.wind_angle_deg, s = cfg.wind_speed_mps;
      need(Number.isFinite(a), 'wind_angle_deg must be a number');
      need(Number.isFinite(s) && s >= 0 && s <= MAX_WIND_MPS, 'wind_speed_mps must be 0..' + MAX_WIND_MPS);
      out.wind_angle_deg = ((a % 360) + 360) % 360;
      out.wind_speed_mps = s;
    }
    // bools
    for (const k of ['dev_mode', 'barrier', 'ladder_lines', 'amr_auto']) {
      need(typeof cfg[k] === 'boolean', k + ' must be true or false');
      out[k] = cfg[k];
    }
    // sim resolution
    {
      const root = cfg.root_cell_m, steps = cfg.steps_per_frame;
      need(Number.isFinite(root) && root > 0, 'root_cell_m must be a positive number');
      need(Number.isFinite(steps) && steps > 0, 'steps_per_frame must be a positive number');
      const mode = simResForRoot(root, steps);
      need(!!mode, 'root_cell_m / steps_per_frame must match a known mode (' +
        allowedSimResPairs().map((p) => p.root_cell_m + ' m × ' + p.steps_per_frame + ' → ' + p.mode).join('; ') + ')');
      out.root_cell_m = rootFromSimRes(mode).root_cell_m;
      out.steps_per_frame = rootFromSimRes(mode).steps_per_frame;
      out._simRes = mode;
    }
    // sail wake / boat energy
    {
      const g = cfg.sail_wake_gain;
      need(Number.isFinite(g) && g >= 0 && g <= 64, 'sail_wake_gain must be 0..64 (0 = boat energy off)');
      out.sail_wake_gain = g;
    }
    // field skip
    {
      const n = cfg.field_skip;
      need(Number.isInteger(n) && n >= 0 && n <= 29, 'field_skip must be an integer 0..29');
      out.field_skip = n;
    }
    // refine
    {
      const ml = cfg.refine_max_level;
      need(Number.isInteger(ml) && ml >= 0 && ml <= 5, 'refine_max_level must be an integer 0..5 (0 = mesh refinement off)');
      out.refine_max_level = ml;
      const r = cfg.boat_refine_radius_m;
      need(Number.isFinite(r) && r >= 0.5 && r <= 16, 'boat_refine_radius_m must be 0.5..16');
      out.boat_refine_radius_m = r;
    }
    // budget
    {
      const t = cfg.budget_target;
      need(Number.isFinite(t), 'budget_target must be a number');
      if (t === -1) out.budget_target = -1;
      else need(t >= 1000 && t <= 1e8, 'budget_target must be -1 (unlimited) or 1000..1e8');
      if (t !== -1) out.budget_target = t;
    }
    // gust rate spawner
    {
      need(typeof cfg.gusts === 'boolean', 'gusts must be true or false');
      out.gusts = cfg.gusts;
      const rate = cfg.gust_rate_per_min;
      need(Number.isFinite(rate) && rate >= 0 && rate <= 120, 'gust_rate_per_min must be 0..120');
      out.gust_rate_per_min = rate;
      const ramp = cfg.gust_ramp_s;
      need(Number.isFinite(ramp) && ramp >= 0 && ramp <= 60, 'gust_ramp_s must be 0..60');
      out.gust_ramp_s = ramp;

      const meanSdKeys = [
        ['gust_force_gain', 0, 1],
        ['gust_along_sigma_m', 0, 100],
        ['gust_cross_sigma_m', 0, 200],
        ['gust_life_s', 0, 120],
        ['gust_dir_deg', null, null],
      ];
      for (const [key, lo, hi] of meanSdKeys) {
        const p = parseMeanSd(cfg[key], key);
        need(!p.error, p.error || key);
        if (lo !== null) need(p.mean >= lo && p.mean <= hi, key + ' mean must be ' + lo + '..' + hi);
        else need(Number.isFinite(p.mean), key + ' mean must be a number');
        out[key] = meanSdToToml(p.mean, p.sd);
      }
    }

    // Custom layout: checked against the map it will run on (the live room
    // map when there is a core and no map change, else the config's map).
    const core = checks.core;
    if (out.scenario === CUSTOM_SCENARIO) {
      const w = out.map_width_m, h = out.map_height_m;
      const layout = validateCustomLayout(cfg.custom, w, h);
      out.custom = customLayoutToToml(layout);
      out._custom = layout;
      return { config: out };
    }
    // Scenario exists / fits (when a core or map is provided).
    const mapW = core ? core.map.width : checks.mapW;
    const mapH = core ? core.map.height : (checks.mapH ?? out.map_height_m);
    const mapWUse = checks.mapW ?? out.map_width_m;
    const mapHUse = checks.mapH ?? out.map_height_m;
    const scenarios = core ? core.sim.scenarios : checks.scenarios;
    if (scenarios) {
      if (out.scenario >= scenarios.length || !scenarios[out.scenario]) {
        return { error: 'no scenario ' + out.scenario };
      }
    }
    if (mapWUse && mapHUse) {
      const e = scenarioExtent(out.scenario);
      if (e.x > mapWUse / 2 - WALL_INSET_M || e.y > mapHUse / 2 - WALL_INSET_M) {
        return { error: 'scenario ' + out.scenario + ' does not fit this ' + mapWUse + ' x ' + mapHUse + ' m room' };
      }
    }
    // Prefer the room's live map for fit when committing without a map change
    // that will reload; map dims in the config are still validated as a known size.
    if (core && (out.map_width_m !== core.map.width || out.map_height_m !== core.map.height)) {
      // Map change rebuilds the core (server) or reloads (local); still check scenario against the NEW size.
      const e = scenarioExtent(out.scenario);
      if (e.x > out.map_width_m / 2 - WALL_INSET_M || e.y > out.map_height_m / 2 - WALL_INSET_M) {
        return { error: 'scenario ' + out.scenario + ' does not fit this ' + out.map_width_m + ' x ' + out.map_height_m + ' m room' };
      }
    }

    return { config: out };
  } catch (msg) {
    return { error: typeof msg === 'string' ? msg : String(msg) };
  }
}

/**
 * Parse + validate a TOML string. Returns { config } or { error }.
 */
export function parseAndValidateRoomConfig(text, checks = {}) {
  const p = parseRoomConfigToml(text);
  if (p.error) return p;
  return validateRoomConfig(p.config, checks);
}

/**
 * Expand a validated config into ordered room commands (registry types).
 * Does not include map-size reload (caller handles that).
 * `prev` optional previous config for skipping unchanged fields — when
 * omitted every field is applied.
 */
export function commandsFromConfig(cfg, prev = null) {
  const changed = (k) => !prev || prev[k] !== cfg[k];
  const cmds = [];

  if (changed('dev_mode')) cmds.push({ type: 'devMode', on: !!cfg.dev_mode });
  if (changed('barrier')) cmds.push({ type: 'barrier', on: !!cfg.barrier });

  if (changed('wind_angle_deg') || changed('wind_speed_mps')) {
    const wind = { type: 'wind' };
    if (changed('wind_angle_deg') || !prev) wind.angle = cfg.wind_angle_deg;
    if (changed('wind_speed_mps') || !prev) wind.speed = cfg.wind_speed_mps;
    cmds.push(wind);
  }

  const amr = cfg.refine_max_level > 0;
  const boatEnergy = cfg.sail_wake_gain > 0;
  if (!prev || prev.refine_max_level > 0 !== amr || prev.sail_wake_gain > 0 !== boatEnergy || prev.ladder_lines !== cfg.ladder_lines) {
    cmds.push({ type: 'options', amr, boatEnergy, ladder: !!cfg.ladder_lines });
  }

  if (changed('amr_auto')) cmds.push({ type: 'amrMode', mode: cfg.amr_auto ? 'auto' : 'fixed' });

  const mode = cfg._simRes || simResForRoot(cfg.root_cell_m, cfg.steps_per_frame);
  if (!prev || prev.root_cell_m !== cfg.root_cell_m || prev.steps_per_frame !== cfg.steps_per_frame) {
    cmds.push({ type: 'simRes', mode });
  }

  if (changed('sail_wake_gain')) cmds.push({ type: 'sailWake', gain: cfg.sail_wake_gain });

  if (amr && (!prev || prev.refine_max_level !== cfg.refine_max_level || prev.boat_refine_radius_m !== cfg.boat_refine_radius_m || prev.refine_max_level === 0)) {
    cmds.push({ type: 'refine', maxLevel: cfg.refine_max_level, boatRefineRadius: cfg.boat_refine_radius_m });
  }

  if (changed('budget_target')) {
    if (cfg.budget_target === -1) cmds.push({ type: 'cellBudget', tune: false, target: null });
    else cmds.push({ type: 'cellBudget', tune: true, target: cfg.budget_target });
  }

  if (changed('field_skip')) cmds.push({ type: 'fieldSkip', n: cfg.field_skip });

  const gustKeys = [
    'gusts', 'gust_rate_per_min', 'gust_force_gain', 'gust_along_sigma_m',
    'gust_cross_sigma_m', 'gust_life_s', 'gust_dir_deg', 'gust_ramp_s',
  ];
  if (!prev || gustKeys.some((k) => {
    const a = prev[k], b = cfg[k];
    if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) !== JSON.stringify(b);
    return a !== b;
  })) {
    const sp = gustSpawnerFromConfig(cfg);
    cmds.push({ type: 'gusts', ...sp });
  }

  // Scenario restart last (also triggered by lattice rebuild on the server).
  if (cfg.scenario === CUSTOM_SCENARIO) {
    const layout = cfg._custom || validateCustomLayout(cfg.custom, cfg.map_width_m, cfg.map_height_m);
    cmds.push({ type: 'restart', scenario: CUSTOM_SCENARIO, layout });
  } else if (changed('scenario')) cmds.push({ type: 'restart', scenario: cfg.scenario });

  return cmds;
}

/** Parse TOML → validate → commands. { commands, config } or { error }. */
export function roomConfigCommit(text, checks = {}, prev = null) {
  const v = parseAndValidateRoomConfig(text, checks);
  if (v.error) return v;
  return { config: v.config, commands: commandsFromConfig(v.config, prev) };
}

export { DEFAULT_MAP_SIZE, MAP_SIZES };
