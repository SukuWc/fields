// Base-wind schedule (src/wind-schedule.js, Sim windSchedule): seeded
// determinism, rate limits, base wind kept through the room config, and the
// lattice following the scheduled boundary wind.
import './dom-stub.mjs';
const {
  DEFAULT_WIND_SCHEDULE, validateWindSchedule, windSchedulePhases, windScheduleOffset,
  windScheduleRates, windSlew, angleDiffDeg, WIND_MAX_DEG_PER_S, WIND_MAX_SPEED_FRAC_PER_S,
} = await import('../src/wind-schedule.js');
const { SimCore } = await import('../src/host.js');
const {
  ROOM_CONFIG_BASE, ROOM_CONFIG_DEFAULTS, validateRoomConfig, parseAndValidateRoomConfig,
  stringifyRoomConfig, configFromRoomState, commandsFromConfig,
} = await import('../src/room-config.js');

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const mute = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
const sched = (o = {}) => validateWindSchedule({ ...DEFAULT_WIND_SCHEDULE, enabled: true, ...o }).schedule;

// 1. Determinism per seed.
{
  const series = (seed) => {
    const s = sched({ seed });
    const ph = windSchedulePhases(s);
    const out = [];
    for (let t = 0; t <= 600; t += 7.3) { const o = windScheduleOffset(s, t, ph); out.push(o.dirDeg, o.speedFactor); }
    return out;
  };
  const a = series(7), b = series(7), c = series(8);
  check('same seed → identical schedule', JSON.stringify(a) === JSON.stringify(b));
  check('different seed → different schedule', JSON.stringify(a) !== JSON.stringify(c));
  const s = sched({ seed: 7 });
  check('phases from the seed alone (fresh call equal)', JSON.stringify(windSchedulePhases(s)) === JSON.stringify(windSchedulePhases(sched({ seed: 7 }))));
  // Two Sims on the same seed apply the same wind tick for tick.
  const run = () => {
    const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
    core.command({ type: 'windSchedule', ...DEFAULT_WIND_SCHEDULE, enabled: true, seed: 3 });
    core.sim.command({ type: 'devMode', on: true }); // lattice frozen: wind path only, fast
    const w = [];
    for (let i = 0; i < 300; i++) { mute(() => core.tick({ dt: 1 / 30, held: [] })); w.push(core.map.wind_direction, core.map.wind_speed); }
    return { w, cw: core.map.constantWind };
  };
  const r1 = run(), r2 = run();
  check('two Sims, same seed: same applied wind every tick', JSON.stringify(r1.w) === JSON.stringify(r2.w));
}

// 2. Rate limits.
{
  const d = sched();
  const r = windScheduleRates(d);
  check('default direction rate ≤ 0.5°/s', r.dirDegPerS <= WIND_MAX_DEG_PER_S, r.dirDegPerS.toFixed(4));
  check('default speed rate ≤ 0.5 %/s', r.speedFracPerS <= WIND_MAX_SPEED_FRAC_PER_S, (100 * r.speedFracPerS).toFixed(4));
  // Numeric slope of the default schedule never exceeds the analytic bound.
  const ph = windSchedulePhases(d);
  let maxD = 0, maxS = 0;
  for (let t = 0; t < 3600; t += 0.5) {
    const a = windScheduleOffset(d, t, ph), b = windScheduleOffset(d, t + 0.5, ph);
    maxD = Math.max(maxD, Math.abs(b.dirDeg - a.dirDeg) / 0.5);
    maxS = Math.max(maxS, Math.abs(b.speedFactor - a.speedFactor) / 0.5);
  }
  check('sampled turning rate within Σ 2πA/T', maxD <= r.dirDegPerS + 1e-9, `${maxD.toFixed(4)} ≤ ${r.dirDegPerS.toFixed(4)}`);
  check('sampled speed rate within Σ 2πB/P', maxS <= r.speedFracPerS + 1e-9);
  // Trend term reads as a trend: its own slope ≤ ~1°/min and period ≫ a race.
  check('trend: slow sine (period ≥ 40 min, ≤ ~1°/min)', d.dirTrend[1] >= 2400 && 2 * Math.PI * d.dirTrend[0] / d.dirTrend[1] * 60 <= 1.1);
  const fast = validateWindSchedule({ enabled: true, dirOsc: [[20, 60]] });
  check('direction rate over 0.5°/s rejected', !!fast.error && /°\/s/.test(fast.error), fast.error);
  const fastU = validateWindSchedule({ enabled: true, speedOsc: [[0.2, 60]] });
  check('speed rate over 0.5 %/s rejected', !!fastU.error && /%\/s/.test(fastU.error), fastU.error);
  const bad = validateWindSchedule({ dirOsc: [[1, 2]] });
  check('period below 10 s rejected', !!bad.error, bad.error);
  const cfg = validateRoomConfig({ ...ROOM_CONFIG_BASE, wind_schedule: true, wind_dir_osc: [[20, 60]] });
  check('room config rejects an over-rate schedule', !!cfg.error && /wind_dir_osc/.test(cfg.error), cfg.error);
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  const r2 = core.command({ type: 'windSchedule', enabled: true, dirOsc: [[20, 60]] });
  check('Sim windSchedule command returns the error', r2 && !!r2.error && core.sim.windSchedule.enabled === false);
  // Slew: never more than the limit per step, wraps through 0°.
  const st = windSlew({ angle: 359, speed: 4 }, { angle: 10, speed: 6 }, 0.5, 0.1);
  check('slew steps 0.5° the short way through 0°', Math.abs(angleDiffDeg(359, st.angle) - 0.5) < 1e-9 && Math.abs(st.speed - 4.1) < 1e-9 && !st.done);
}

// 3. Base wind kept through room config, settings and a config round-trip.
{
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  const cfg = { ...ROOM_CONFIG_DEFAULTS, gusts: false, wind_schedule: true, wind_schedule_seed: 42, wind_angle_deg: 80 };
  const r = mute(() => core.command({ type: 'config', config: cfg }));
  check('config with schedule applies', !(r && r.error), JSON.stringify(r));
  for (let i = 0; i < 30 * 20; i++) mute(() => core.tick({ dt: 1 / 30, held: [] }));
  const applied = core.map.wind_direction;
  check('applied wind moved off the base', Math.abs(angleDiffDeg(80, applied)) > 0.5, `applied ${applied.toFixed(2)}`);
  check('settings.wind is the base', core.settings.wind.angle === 80 && core.settings.wind.speed === 4.5, JSON.stringify(core.settings.wind));
  const back = configFromRoomState(core.roomState(), { mapW: 100, mapH: 200 });
  check('configFromRoomState: base angle / speed, schedule keys',
    back.wind_angle_deg === 80 && back.wind_speed_mps === 4.5 && back.wind_schedule === true && back.wind_schedule_seed === 42
    && JSON.stringify(back.wind_dir_osc) === JSON.stringify(ROOM_CONFIG_DEFAULTS.wind_dir_osc), JSON.stringify(back.wind_dir_trend));
  const text = stringifyRoomConfig(back);
  const p = parseAndValidateRoomConfig(text);
  check('TOML round-trip keeps schedule and base', !p.error && p.config.wind_angle_deg === 80 && p.config.wind_schedule_seed === 42
    && JSON.stringify(p.config.wind_speed_osc) === JSON.stringify(ROOM_CONFIG_DEFAULTS.wind_speed_osc), p.error);
  // Re-committing the same config keeps the schedule clock (no jump).
  const clock = core.sim.windClock;
  mute(() => core.command({ type: 'config', config: p.config }));
  check('re-commit of the same schedule keeps its clock', core.sim.windClock === clock && core.sim.windBase.angle === 80);
  check('commandsFromConfig skips an unchanged schedule', !commandsFromConfig(p.config, p.config).some((c) => c.type === 'windSchedule'));
  // A manual wind change with the schedule on moves the base, not the applied wind at once.
  const before = core.map.wind_direction;
  core.command({ type: 'wind', angle: 120 });
  check('wind command with schedule on: base set, applied unchanged this tick', core.sim.windBase.angle === 120 && core.map.wind_direction === before && core.settings.wind.angle === 120);
  mute(() => core.tick({ dt: 1 / 30, held: [] }));
  check('then slews ≤ 0.5°/s', Math.abs(angleDiffDeg(before, core.map.wind_direction)) <= 0.5 / 30 + 1e-9);
  // Defaults off: a steady room keeps instant wind changes.
  const plain = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  plain.command({ type: 'wind', angle: 45, speed: 5 });
  check('schedule off: wind command is instant (unchanged behaviour)', plain.map.wind_direction === 45 && plain.map.wind_speed === 5 && plain.bm.direction === 225);
  check('schedule off by default', ROOM_CONFIG_DEFAULTS.wind_schedule === false && plain.sim.windSchedule.enabled === false);
  // wind_ramp: manual changes slew even without the schedule.
  plain.command({ type: 'windSchedule', ...DEFAULT_WIND_SCHEDULE, ramp: true });
  plain.command({ type: 'wind', angle: 75 });
  for (let i = 0; i < 30; i++) mute(() => plain.tick({ dt: 1 / 30, held: [] }));
  check('wind_ramp: 30° change after 1 s has turned 0.5°', Math.abs(plain.map.wind_direction - 45.5) < 1e-6, plain.map.wind_direction.toFixed(4));
  // Switching off settles back to the base by slewing, then stops.
  plain.command({ type: 'windSchedule', ...DEFAULT_WIND_SCHEDULE, ramp: false });
  for (let i = 0; i < 30 * 70; i++) mute(() => plain.tick({ dt: 1 / 30, held: [] }));
  check('ramp off: settles on the base and stops slewing', Math.abs(plain.map.wind_direction - 75) < 1e-6 && plain.sim._windSettling === false);
}

// 4. The field follows the scheduled boundary wind (headless, 2f, no boats, gusts off).
{
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  core.command({ type: 'windSchedule', ...DEFAULT_WIND_SCHEDULE, enabled: true, seed: 5 });
  let maxDirErr = 0, maxSpdErr = 0, maxApplied = 0;
  for (let i = 0; i < 30 * 150; i++) {
    mute(() => core.tick({ dt: 1 / 30, held: [] }));
    const t = (i + 1) / 30;
    const tgt = core.sim.windTarget();
    if (t < 60) continue; // switch-on slew from the base, then the field catches up
    maxApplied = Math.max(maxApplied, Math.abs(angleDiffDeg(tgt.angle, core.map.wind_direction)));
    const w = core.map.get_wind(0, 0);
    maxDirErr = Math.max(maxDirErr, Math.abs(angleDiffDeg(core.map.wind_direction, w.direction)));
    maxSpdErr = Math.max(maxSpdErr, Math.abs(w.speed / core.map.wind_speed - 1));
  }
  check('applied wind on the schedule after the switch-on slew', maxApplied < 1e-6, maxApplied.toFixed(6));
  check('field direction at the centre within 1.5° of the schedule', maxDirErr <= 1.5, maxDirErr.toFixed(3) + '°');
  check('field speed at the centre within 3 % of the schedule', maxSpdErr <= 0.03, (100 * maxSpdErr).toFixed(2) + ' %');
}

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all wind schedule checks passed');
