// Room TOML config (src/room-config.js): defaults round-trip, semantics,
// validation, and atomic apply through SimCore / Room.
import { SimCore } from '../src/host.js';
import { Room, validateRoomCommand } from '../apps/server/room.js';
import {
  ROOM_CONFIG_DEFAULTS, ROOM_CONFIG_BASE, ROOM_CONFIG_KEYS, stringifyRoomConfig, parseRoomConfigToml,
  parseAndValidateRoomConfig, validateRoomConfig, configFromRoomState,
  commandsFromConfig, simResForRoot, rootFromSimRes, roomConfigCommit,
  defaultRoomConfig, parseMeanSd, meanSdToToml, gustSpawnerFromConfig,
} from '../src/room-config.js';
import { DEFAULT_SIM_RES } from '../src/sim-modes.js';
import { parseServerMessage } from '../src/wire-codec.js';

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed++;
};

// 1. Defaults round-trip through serialize → parse → validate.
{
  const text = stringifyRoomConfig(ROOM_CONFIG_DEFAULTS);
  const p = parseAndValidateRoomConfig(text);
  check('defaults TOML parses and validates', !p.error, p.error);
  for (const k of ROOM_CONFIG_KEYS) {
    check(`default ${k} round-trips`, JSON.stringify(p.config[k]) === JSON.stringify(ROOM_CONFIG_DEFAULTS[k]),
      `${k}: got ${JSON.stringify(p.config[k])} want ${JSON.stringify(ROOM_CONFIG_DEFAULTS[k])}`);
  }
  check('defaults map to simRes 2f', p.config._simRes === DEFAULT_SIM_RES, p.config._simRes);
  check('stringify is stable', stringifyRoomConfig(p.config) === text);
}

// 2. Semantics: refine 0 / sail 0 / budget -1 / amr_auto / root+steps.
{
  const off = parseAndValidateRoomConfig(`
scenario = 0
map_width_m = 100
map_height_m = 200
wind_angle_deg = 90
wind_speed_mps = 4.5
dev_mode = false
barrier = false
ladder_lines = false
amr_auto = false
root_cell_m = 4.0
steps_per_frame = 1
sail_wake_gain = 0
field_skip = 2
refine_max_level = 0
boat_refine_radius_m = 3.0
budget_target = -1
`).config;
  const cmds = commandsFromConfig(off);
  const opt = cmds.find((c) => c.type === 'options');
  check('refine_max_level 0 → amr false', opt && opt.amr === false, JSON.stringify(opt));
  check('sail_wake_gain 0 → boatEnergy false', opt && opt.boatEnergy === false, JSON.stringify(opt));
  check('amr_auto false → amrMode fixed', cmds.some((c) => c.type === 'amrMode' && c.mode === 'fixed'));
  check('4 m × 1 step → 4f', off._simRes === '4f', off._simRes);
  check('budget -1 → cellBudget tune false', cmds.some((c) => c.type === 'cellBudget' && c.tune === false && c.target === null));
  check('no refine command when AMR off', !cmds.some((c) => c.type === 'refine'));
}

{
  const on = parseAndValidateRoomConfig(stringifyRoomConfig({
    ...ROOM_CONFIG_BASE, refine_max_level: 2, sail_wake_gain: 8, budget_target: 50000,
  })).config;
  const cmds = commandsFromConfig(on);
  check('refine > 0 → amr true + refine command',
    cmds.some((c) => c.type === 'options' && c.amr === true)
    && cmds.some((c) => c.type === 'refine' && c.maxLevel === 2));
  check('sail_wake_gain > 0 → boatEnergy true', cmds.some((c) => c.type === 'options' && c.boatEnergy === true));
  check('budget 50000 → tune true + target', cmds.some((c) => c.type === 'cellBudget' && c.tune === true && c.target === 50000));
}

// 3. Validation refusals (no partial apply).
{
  const bad = [
    ['not toml {', 'TOML'],
    ['scenario = -1\nmap_width_m=100\nmap_height_m=200\nwind_angle_deg=90\nwind_speed_mps=4.5\ndev_mode=false\nbarrier=false\nladder_lines=false\namr_auto=true\nroot_cell_m=2\nsteps_per_frame=1\nsail_wake_gain=16\nfield_skip=0\nrefine_max_level=3\nboat_refine_radius_m=3\nbudget_target=-1\n', 'scenario'],
    [stringifyRoomConfig({ ...ROOM_CONFIG_BASE, root_cell_m: 3, steps_per_frame: 1 }), 'root_cell'],
    [stringifyRoomConfig({ ...ROOM_CONFIG_BASE, budget_target: 10 }), 'budget'],
    [stringifyRoomConfig({ ...ROOM_CONFIG_BASE, refine_max_level: 9 }), 'refine'],
    [stringifyRoomConfig({ ...ROOM_CONFIG_BASE, map_width_m: 99, map_height_m: 200 }), 'map'],
    ['bogus_key = 1\n' + stringifyRoomConfig(ROOM_CONFIG_BASE), 'unknown'],
  ];
  for (const [text, tip] of bad) {
    const r = parseAndValidateRoomConfig(text);
    check(`refuse bad config (${tip})`, !!r.error && new RegExp(tip, 'i').test(r.error), r.error || 'no error');
  }
}

// 4. configFromRoomState + SimCore apply.
{
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  const from = configFromRoomState(core.roomState(), { mapW: 100, mapH: 200 });
  check('fresh SimCore → config has defaults (2f, amr on, budget -1)',
    from.root_cell_m === 2 && from.steps_per_frame === 1 && from.refine_max_level === 3 && from.budget_target === -1,
    JSON.stringify(from));

  const edited = { ...from, wind_speed_mps: 6, ladder_lines: true, amr_auto: false, sail_wake_gain: 0, refine_max_level: 0 };
  const v = validateRoomConfig(edited, { core });
  check('edited config validates', !v.error, v.error);
  const r = core.command({ type: 'config', config: v.config });
  check('SimCore config apply has no error', !(r && r.error), JSON.stringify(r));
  const st = core.settings;
  check('applied: wind 6, ladder on, amrMode fixed, amr off, boatEnergy off',
    st.wind.speed === 6 && st.ladder === true && st.amrMode === 'fixed' && st.amr === false && st.boatEnergy === false,
    JSON.stringify(st));
}

// 5. Server Room atomic config + refusal.
{
  const sent = [];
  const client = { send: (s) => sent.push(parseServerMessage(s)) };
  const room = new Room('toml', { lockstep: true, graceMs: 0 });
  room.join(client);
  room.message(client, { type: 'init', opts: { mapW: 100, mapH: 200, simRes: '2f', scenario: 0 } });
  sent.length = 0;
  const okText = stringifyRoomConfig({ ...ROOM_CONFIG_BASE, wind_speed_mps: 5, ladder_lines: true });
  const okCfg = parseAndValidateRoomConfig(okText, { mapW: 100, mapH: 200 }).config;
  room.message(client, { type: 'command', id: 1, c: { type: 'config', config: okCfg } });
  const result = sent.find((m) => m.type === 'result' && m.id === 1);
  const ev = sent.find((m) => m.type === 'event' && m.ev && m.ev.type === 'room');
  check('Room accepts config command', result && !(result.r && result.r.error), JSON.stringify(result));
  check('Room broadcasts room state after config', !!ev, JSON.stringify(sent.map((m) => m.type)));
  check('Room state reflects config', ev && ev.ev.room.settings.wind.speed === 5 && ev.ev.room.settings.ladder === true);

  sent.length = 0;
  const badCfg = { ...okCfg, map_width_m: 50, map_height_m: 100, _mapKey: '50x100' };
  room.message(client, { type: 'command', id: 2, c: { type: 'config', config: badCfg } });
  const bad = sent.find((m) => m.type === 'result' && m.id === 2);
  check('Room resizes live on a map-size change via config (Room._resize)', bad && !(bad.r && bad.r.error) && room.core.map.width === 50 && room.core.map.height === 100 && sent.some((m) => m.type === 'info' && m.info.mapW === 50), JSON.stringify(bad && bad.r && bad.r.error));

  const vCmd = validateRoomCommand({ type: 'config', config: okCfg }, room.core);
  check('validateRoomCommand accepts config', !vCmd.error && vCmd.c.type === 'config');
  room.leave(client);
}

// 6. simRes mapping helpers.
{
  check('2f ↔ root 2 / steps 1', simResForRoot(2, 1) === '2f' && rootFromSimRes('2f').root_cell_m === 2);
  check('4f ↔ root 4 / steps 1', simResForRoot(4, 1) === '4f');
  check('1 ↔ root 1 / steps 1', simResForRoot(1, 1) === '1');
  check('unknown pair → null', simResForRoot(3, 1) === null);
}

check('roomConfigCommit returns commands', !roomConfigCommit(stringifyRoomConfig(ROOM_CONFIG_DEFAULTS)).error);

// 7. Reset preset: defaults with the live room map size kept.
{
  const d = defaultRoomConfig(50, 100);
  check('defaultRoomConfig keeps map size', d.map_width_m === 50 && d.map_height_m === 100);
  check('defaultRoomConfig on another map size drops the course (scenario 0)',
    d.scenario === 0 && d.custom === undefined);
  check('defaultRoomConfig other fields are ROOM_CONFIG_DEFAULTS',
    true
    && d.wind_speed_mps === ROOM_CONFIG_DEFAULTS.wind_speed_mps
    && d.sail_wake_gain === ROOM_CONFIG_DEFAULTS.sail_wake_gain
    && d.refine_max_level === ROOM_CONFIG_DEFAULTS.refine_max_level
    && d.budget_target === ROOM_CONFIG_DEFAULTS.budget_target
    && d.amr_auto === ROOM_CONFIG_DEFAULTS.amr_auto);
  const plain = defaultRoomConfig();
  check('defaultRoomConfig without map = full defaults',
    plain.map_width_m === ROOM_CONFIG_DEFAULTS.map_width_m
    && plain.map_height_m === ROOM_CONFIG_DEFAULTS.map_height_m);
  check('default preset is the live custom race course',
    plain.scenario === 'custom' && plain.custom && plain.custom.title === 'Race course'
    && JSON.stringify(plain.custom.marks.w) === '[0,65]' && plain.custom.course.legs.length === 3);
  const text = stringifyRoomConfig(defaultRoomConfig(100, 200));
  check('Reset preset TOML validates', !parseAndValidateRoomConfig(text).error);
}

// 8. Gust mean[,sd] parse + config round-trip + commands.
{
  check('parseMeanSd number → sd 0', (() => {
    const p = parseMeanSd(0.003, 'g');
    return !p.error && p.mean === 0.003 && p.sd === 0;
  })());
  check('parseMeanSd [mean] → sd 0', (() => {
    const p = parseMeanSd([0.003], 'g');
    return !p.error && p.mean === 0.003 && p.sd === 0;
  })());
  check('parseMeanSd [mean, sd]', (() => {
    const p = parseMeanSd([0.003, 0.0005], 'g');
    return !p.error && p.mean === 0.003 && p.sd === 0.0005;
  })());
  check('parseMeanSd rejects length 3', !!parseMeanSd([1, 2, 3], 'g').error);
  check('parseMeanSd rejects negative sd', !!parseMeanSd([1, -0.1], 'g').error);
  check('meanSdToToml sd0 → [mean, 0]', JSON.stringify(meanSdToToml(0.003, 0)) === '[0.003,0]');
  check('parseMeanSd scalar → sd 0', parseMeanSd(0.003, 'x').sd === 0 && parseMeanSd(0.003, 'x').mean === 0.003);
  check('meanSdToToml with sd → array', Array.isArray(meanSdToToml(0.003, 0.0005))
    && meanSdToToml(0.003, 0.0005)[0] === 0.003 && meanSdToToml(0.003, 0.0005)[1] === 0.0005);

  const text = `
scenario = 0
map_width_m = 100
map_height_m = 200
wind_angle_deg = 90
wind_speed_mps = 4.5
dev_mode = false
barrier = false
ladder_lines = false
amr_auto = true
root_cell_m = 2.0
steps_per_frame = 1
sail_wake_gain = 16
field_skip = 0
refine_max_level = 3
boat_refine_radius_m = 3.0
budget_target = -1
gusts = true
gust_rate_per_min = 6
gust_force_gain = [0.003, 0.0005]
gust_along_sigma_m = [2.5, 0.4]
gust_cross_sigma_m = [12.5, 2.0]
gust_life_s = [10, 2]
gust_dir_deg = [0, 5]
gust_ramp_s = 1.5
`;
  const v = parseAndValidateRoomConfig(text);
  check('gust TOML validates', !v.error, v.error);
  check('gust arrays preserved when sd>0', Array.isArray(v.config.gust_force_gain)
    && v.config.gust_force_gain[0] === 0.003 && v.config.gust_force_gain[1] === 0.0005);
  const cmds = commandsFromConfig(v.config);
  const g = cmds.find((c) => c.type === 'gusts');
  check('commandsFromConfig emits gusts', !!g && g.enabled === true && g.ratePerMin === 6
    && g.forceGain === 0.003 && g.forceGainSd === 0.0005 && g.dirDegSd === 5,
    JSON.stringify(g));
  const sp = gustSpawnerFromConfig(v.config);
  check('gustSpawnerFromConfig flat snapshot', sp.enabled && sp.alongSigmaM === 2.5 && sp.alongSigmaMSd === 0.4);

  const badLen = parseAndValidateRoomConfig(stringifyRoomConfig({
    ...ROOM_CONFIG_BASE, gust_force_gain: [0.003, 0.0005, 1],
  }));
  check('refuse gust array length 3', !!badLen.error && /gust_force_gain/i.test(badLen.error), badLen.error);

  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  const r = core.command({ type: 'config', config: v.config });
  check('SimCore config applies gusts', !(r && r.error), JSON.stringify(r));
  check('settings.gusts.enabled after config', core.settings.gusts && core.settings.gusts.enabled === true
    && core.settings.gusts.ratePerMin === 6, JSON.stringify(core.settings.gusts));
  check('GustField spawner enabled', core.sim.gusts.spawner.enabled === true && core.sim.gusts.spawner.ratePerMin === 6);

  // Off → no inject activity from spawner (explicitly disable; defaults now enable gusts).
  const off = validateRoomConfig({ ...ROOM_CONFIG_BASE, gusts: false, gust_rate_per_min: 0 }, { core }).config;
  core.command({ type: 'config', config: off });
  check('gusts=false disables spawner', core.sim.gusts.spawner.enabled === false);
}


// PR A: arbitrary room sizes (map-size.js mapDimsError limits).
{
  const base = { ...ROOM_CONFIG_BASE };
  const v = (w, h) => validateRoomConfig({ ...base, map_width_m: w, map_height_m: h });
  const ok = v(60, 120);
  check('arbitrary 60x120 accepted', !ok.error && ok.config.map_width_m === 60 && ok.config.map_height_m === 120 && ok.config._mapKey === '60x120', ok.error);
  check('non-preset 300x500 accepted (area 150k)', !v(300, 500).error, v(300, 500).error);
  check('presets still accepted (incl. legacy 75x75)', !v(50, 100).error && !v(200, 400).error && !v(75, 75).error);
  check('off-step 62x120 rejected', /multiple of 4/.test(v(62, 120).error || ''), v(62, 120).error);
  check('fractional 60.5x120 rejected', !!v(60.5, 120).error);
  check('too small 16x100 rejected', /at least 20/.test(v(16, 100).error || ''), v(16, 100).error);
  check('too long 100x516 rejected', /at most 512/.test(v(100, 516).error || ''), v(100, 516).error);
  check('area 400x404 rejected', /area/.test(v(400, 404).error || ''), v(400, 404).error);
  check('non-positive rejected', !!v(0, 100).error && !!v(-4, 100).error);
  // Scenario fit still applies to arbitrary sizes.
  const fit = validateRoomConfig({ ...base, scenario: 18, map_width_m: 60, map_height_m: 120 }, { scenarioFit: true });
  check('scenario fit checked on arbitrary size', !!fit.error, fit.error);
  // Server room create path: allowed arbitrary size kept, bad size falls back.
  const mk = (opts) => { const r = new Room('size-' + Math.random(), { lockstep: true, graceMs: 0 }); const c = { send() {} }; r.join(c); r.message(c, { type: 'init', opts: { simRes: '2f', scenario: 0, ...opts } }); const d = [r.core.map.width, r.core.map.height]; r.leave(c); return d; };
  check('room create keeps arbitrary 60x120', mk({ mapW: 60, mapH: 120 }).join() === '60,120', mk({ mapW: 60, mapH: 120 }).join());
  check('room create rejects 2000x2000 → default', mk({ mapW: 2000, mapH: 2000 }).join() === '100,200');
}

if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all room-config checks passed');
process.exit(0);
