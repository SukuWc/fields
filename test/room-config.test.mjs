// Room TOML config (src/room-config.js): defaults round-trip, semantics,
// validation, and atomic apply through SimCore / Room.
import { SimCore } from '../src/host.js';
import { Room, validateRoomCommand } from '../apps/server/room.js';
import {
  ROOM_CONFIG_DEFAULTS, ROOM_CONFIG_KEYS, stringifyRoomConfig, parseRoomConfigToml,
  parseAndValidateRoomConfig, validateRoomConfig, configFromRoomState,
  commandsFromConfig, simResForRoot, rootFromSimRes, roomConfigCommit,
} from '../src/room-config.js';
import { DEFAULT_SIM_RES } from '../src/sim-modes.js';

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
    check(`default ${k} round-trips`, p.config[k] === ROOM_CONFIG_DEFAULTS[k],
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
    ...ROOM_CONFIG_DEFAULTS, refine_max_level: 2, sail_wake_gain: 8, budget_target: 50000,
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
    [stringifyRoomConfig({ ...ROOM_CONFIG_DEFAULTS, root_cell_m: 3, steps_per_frame: 1 }), 'root_cell'],
    [stringifyRoomConfig({ ...ROOM_CONFIG_DEFAULTS, budget_target: 10 }), 'budget'],
    [stringifyRoomConfig({ ...ROOM_CONFIG_DEFAULTS, refine_max_level: 9 }), 'refine'],
    [stringifyRoomConfig({ ...ROOM_CONFIG_DEFAULTS, map_width_m: 99, map_height_m: 200 }), 'map'],
    ['bogus_key = 1\n' + stringifyRoomConfig(ROOM_CONFIG_DEFAULTS), 'unknown'],
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
  const client = { send: (s) => sent.push(JSON.parse(s)) };
  const room = new Room('toml', { lockstep: true, graceMs: 0 });
  room.join(client);
  room.message(client, { type: 'init', opts: { mapW: 100, mapH: 200, simRes: '2f', scenario: 0 } });
  sent.length = 0;
  const okText = stringifyRoomConfig({ ...ROOM_CONFIG_DEFAULTS, wind_speed_mps: 5, ladder_lines: true });
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
  check('Room refuses map-size change via config', bad && bad.r && /map size/i.test(bad.r.error), JSON.stringify(bad));

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

if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all room-config checks passed');
process.exit(0);
