// Base-wind schedule (src/wind-schedule.js, Sim windSchedule): per-seed
// sampling of every sine component from [mean, sd] (gust convention),
// determinism, rate limits, start on the base at t = 0, base wind kept
// through the room config, and the lattice following the scheduled wind.
import './dom-stub.mjs';
const {
  DEFAULT_WIND_SCHEDULE, validateWindSchedule, realiseWindSchedule, sampleWindSchedule, windScheduleOffset,
  windScheduleRates, windSlew, angleDiffDeg, WIND_MAX_DEG_PER_S, WIND_MAX_SPEED_FRAC_PER_S,
  WIND_MAX_SPEED_AMP_SUM, WIND_MIN_PERIOD_S,
} = await import('../src/wind-schedule.js');
const { SimCore } = await import('../src/host.js');
const {
  ROOM_CONFIG_BASE, ROOM_CONFIG_DEFAULTS, validateRoomConfig, parseAndValidateRoomConfig,
  stringifyRoomConfig, configFromRoomState, commandsFromConfig, roomConfigErrorLine,
} = await import('../src/room-config.js');

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const mute = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
const spec = (o = {}) => {
  const v = validateWindSchedule({ ...DEFAULT_WIND_SCHEDULE, enabled: true, ...o });
  if (v.error) throw new Error(v.error);
  return v.schedule;
};
const offsetAt = (s, t) => { const r = realiseWindSchedule(s); return windScheduleOffset(r.terms, t, r.phases); };

// 1. Determinism per seed: sampled amplitudes / periods and phases.
{
  const series = (seed) => {
    const r = realiseWindSchedule(spec({ seed }));
    const out = [JSON.stringify(r.terms)];
    for (let t = 0; t <= 600; t += 7.3) { const o = windScheduleOffset(r.terms, t, r.phases); out.push(o.dirDeg, o.speedFactor); }
    return out;
  };
  const a = series(7), b = series(7), c = series(8);
  check('same seed → identical sampled terms and schedule', JSON.stringify(a) === JSON.stringify(b));
  check('different seed → different schedule', JSON.stringify(a) !== JSON.stringify(c));
  const t7 = sampleWindSchedule(spec({ seed: 7 })), t8 = sampleWindSchedule(spec({ seed: 8 }));
  check('seeds vary the periods and amplitudes', t7.dirOsc[0][0] !== t8.dirOsc[0][0] && t7.dirOsc[0][1] !== t8.dirOsc[0][1]
    && t7.speedTrend[1] !== t8.speedTrend[1], JSON.stringify(t7.dirOsc[0]) + ' vs ' + JSON.stringify(t8.dirOsc[0]));
  const zero = sampleWindSchedule(spec({ dirOsc: [{ amp_deg: [6, 0], period_s: [360, 0] }] }));
  check('sd 0 → the mean exactly (gust convention)', zero.dirOsc[0][0] === 6 && zero.dirOsc[0][1] === 360);
  // Phases do not depend on the spreads (separate stream).
  const p1 = realiseWindSchedule(spec({ seed: 9 })).phases;
  const p2 = realiseWindSchedule(spec({ seed: 9, dirTrend: { amp_deg: [10, 0], period_s: [3600, 0] } })).phases;
  check('phases independent of the spreads', JSON.stringify(p1) === JSON.stringify(p2));
  // Two Sims on the same seed apply the same wind tick for tick.
  const run = () => {
    const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
    core.command({ type: 'windSchedule', ...DEFAULT_WIND_SCHEDULE, enabled: true, seed: 3 });
    core.sim.command({ type: 'devMode', on: true }); // lattice frozen: wind path only, fast
    const w = [];
    for (let i = 0; i < 300; i++) { mute(() => core.tick({ dt: 1 / 30, held: [] })); w.push(core.map.wind_direction, core.map.wind_speed); }
    return w;
  };
  check('two Sims, same seed: same applied wind every tick', JSON.stringify(run()) === JSON.stringify(run()));
}

// 2. Sampled values within bounds, for many seeds; rate limits.
{
  let worstDir = 0, worstSpd = 0, worstAmp = 0, minPer = Infinity, negAmp = 0, scaledD = 0, scaledS = 0;
  // Wide spreads so draws hit the clamps and the scaling too.
  const wide = spec({
    dirOsc: [{ amp_deg: [12, 12], period_s: [300, 300] }, { amp_deg: [6, 6], period_s: [500, 300] }],
    speedOsc: [{ amp_pct: [12, 12], period_s: [300, 300] }],
  });
  for (let seed = 0; seed < 2000; seed++) {
    for (const s of [spec({ seed }), { ...wide, seed }]) {
      const r = sampleWindSchedule(s);
      const rate = windScheduleRates(r);
      worstDir = Math.max(worstDir, rate.dirDegPerS);
      worstSpd = Math.max(worstSpd, rate.speedFracPerS);
      worstAmp = Math.max(worstAmp, [...r.speedOsc, r.speedTrend].reduce((a, t) => a + t[0], 0));
      for (const t of [...r.dirOsc, r.dirTrend, ...r.speedOsc, r.speedTrend]) { minPer = Math.min(minPer, t[1]); if (!(t[0] >= 0)) negAmp++; }
      if (r.dirScale < 1) scaledD++;
      if (r.speedScale < 1) scaledS++;
    }
  }
  check('sampled direction rate ≤ 0.5°/s for every draw', worstDir <= WIND_MAX_DEG_PER_S + 1e-9, worstDir.toFixed(4));
  check('sampled speed rate ≤ 0.5 %/s for every draw', worstSpd <= WIND_MAX_SPEED_FRAC_PER_S + 1e-12, (100 * worstSpd).toFixed(4));
  check('sampled speed amplitudes sum ≤ 40 %', worstAmp <= WIND_MAX_SPEED_AMP_SUM + 1e-12, worstAmp.toFixed(4));
  check('sampled periods ≥ 10 s, amplitudes ≥ 0 (clamped)', minPer >= WIND_MIN_PERIOD_S && negAmp === 0, `min period ${minPer.toFixed(1)}`);
  check('wide spreads exercise the amplitude scaling', scaledD > 0 && scaledS > 0, `dir ${scaledD} speed ${scaledS}`);
  // Default draws: within the means ± a few sd for one seed.
  const d = sampleWindSchedule(spec({ seed: 1 }));
  check('default draw near the means', d.dirOsc.every((t, i) => Math.abs(t[1] - DEFAULT_WIND_SCHEDULE.dirOsc[i].period_s[0]) < 4 * DEFAULT_WIND_SCHEDULE.dirOsc[i].period_s[1]));
  // The analytic rate bounds the sampled slope.
  const r1 = realiseWindSchedule(spec({ seed: 1 }));
  const bound = windScheduleRates(r1.terms);
  let maxD = 0;
  for (let t = 0; t < 3600; t += 0.5) {
    const a = windScheduleOffset(r1.terms, t, r1.phases), b = windScheduleOffset(r1.terms, t + 0.5, r1.phases);
    maxD = Math.max(maxD, Math.abs(b.dirDeg - a.dirDeg) / 0.5);
  }
  check('numeric turning rate within Σ 2πA/T', maxD <= bound.dirDegPerS + 1e-9, `${maxD.toFixed(4)} ≤ ${bound.dirDegPerS.toFixed(4)}`);
  const m = DEFAULT_WIND_SCHEDULE.dirTrend;
  check('trend mean: slow sine (period ≥ 40 min, ≤ ~1°/min)', m.period_s[0] >= 2400 && 2 * Math.PI * m.amp_deg[0] / m.period_s[0] * 60 <= 1.1);
  const fast = validateWindSchedule({ enabled: true, dirOsc: [{ amp_deg: [20, 0], period_s: [60, 0] }] });
  check('over-rate means refused (°/s)', !!fast.error && /°\/s/.test(fast.error), fast.error);
  const fastU = validateWindSchedule({ enabled: true, speedOsc: [{ amp_pct: [20, 0], period_s: [60, 0] }] });
  check('over-rate means refused (%/s)', !!fastU.error && /%\/s/.test(fastU.error), fastU.error);
  const badKey = validateWindSchedule({ dirOsc: [{ amp_deg: 1, period_s: 100, phase: 2 }] });
  check('unknown component key refused', !!badKey.error && /phase/.test(badKey.error), badKey.error);
  const badSd = validateWindSchedule({ dirOsc: [{ amp_deg: [1, -1], period_s: 100 }] });
  check('negative sd refused', !!badSd.error, badSd.error);
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  const r2 = core.command({ type: 'windSchedule', enabled: true, dirOsc: [{ amp_deg: 20, period_s: 60 }] });
  check('Sim windSchedule command returns the error', r2 && !!r2.error && core.sim.windSchedule.enabled === false);
  const st = windSlew({ angle: 359, speed: 4 }, { angle: 10, speed: 6 }, 0.5, 0.1);
  check('slew steps 0.5° the short way through 0°', Math.abs(angleDiffDeg(359, st.angle) - 0.5) < 1e-9 && Math.abs(st.speed - 4.1) < 1e-9 && !st.done);
}

// 3. Starts exactly on the base at t = 0 for every seed and draw.
{
  let bad = 0, moved = 0;
  const custom = { dirOsc: [{ amp_deg: [5, 2], period_s: [100, 30] }, { amp_deg: 1, period_s: 333 }], speedOsc: [{ amp_pct: [10, 3], period_s: [400, 80] }] };
  for (let seed = 0; seed < 500; seed++) {
    for (const extra of [{}, custom]) {
      const s = spec({ seed, ...extra });
      const o = offsetAt(s, 0);
      if (o.dirDeg !== 0 || o.speedFactor !== 1) bad++;
      const o1 = offsetAt(s, 60);
      if (Math.abs(o1.dirDeg) > 1e-6 && Math.abs(o1.speedFactor - 1) > 1e-6) moved++;
    }
  }
  check('t = 0: offset exactly 0° and factor exactly 1 for 500 seeds × 2 specs', bad === 0, `${bad} off`);
  check('and every one has moved off the base after 60 s', moved === 1000, `${moved}/1000`);
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  core.command({ type: 'windSchedule', ...DEFAULT_WIND_SCHEDULE, enabled: true, seed: 5 });
  core.sim.command({ type: 'devMode', on: true });
  let lag = 0;
  for (let i = 0; i < 30 * 60; i++) {
    mute(() => core.tick({ dt: 1 / 30, held: [] }));
    const tg = core.sim.windTarget();
    lag = Math.max(lag, Math.abs(angleDiffDeg(tg.angle, core.map.wind_direction)), Math.abs(tg.speed - core.map.wind_speed));
  }
  check('switch-on: applied wind equals the target from the first tick (no ramp)', lag < 1e-9, String(lag));
}

// 4. TOML: shape, round-trip, base wind kept through settings and a rebuild.
{
  const toml = `
scenario = 0
wind_angle_deg = 80
gusts = false
wind_schedule = true
wind_schedule_seed = 42

[[wind_dir_osc]]
amp_deg = [6, 1.8]
period_s = [360, 72]

[[wind_dir_osc]]
amp_deg = 3
period_s = [570]

[wind_dir_trend]
amp_deg = [10, 3]
period_s = [3600, 720]

[[wind_speed_osc]]
amp_pct = [7, 2.1]
period_s = [420, 84]

[wind_speed_trend]
amp_pct = [4, 1.2]
period_s = [2700, 540]
`;
  const v = parseAndValidateRoomConfig(toml);
  check('array-of-tables TOML validates', !v.error, v.error);
  check('number / [mean] forms normalise to [mean, sd]', !v.error && JSON.stringify(v.config.wind_dir_osc[1]) === '{"amp_deg":[3,0],"period_s":[570,0]}'
    && v.config.wind_speed_osc.length === 1, JSON.stringify(v.config.wind_dir_osc));
  const text = stringifyRoomConfig(v.config);
  const back = parseAndValidateRoomConfig(text);
  check('stringify → parse round-trips every wind key', !back.error && ['wind_schedule', 'wind_schedule_seed', 'wind_dir_osc', 'wind_dir_trend', 'wind_speed_osc', 'wind_speed_trend', 'wind_ramp']
    .every((k) => JSON.stringify(back.config[k]) === JSON.stringify(v.config[k])), back.error);
  check('stringify is stable', stringifyRoomConfig(back.config) === text);
  const badText = 'wind_schedule = true\n\n[[wind_dir_osc]]\namp_deg = [40, 1]\nperiod_s = 60\n';
  const bad = parseAndValidateRoomConfig(badText);
  check('error line points at the [[wind_dir_osc]] table', !!bad.error && roomConfigErrorLine(badText, bad) === 3, bad.error);

  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  const r = mute(() => core.command({ type: 'config', config: v.config }));
  check('config with schedule applies', !(r && r.error), JSON.stringify(r));
  for (let i = 0; i < 30 * 60; i++) mute(() => core.tick({ dt: 1 / 30, held: [] }));
  check('applied wind moved off the base', Math.abs(angleDiffDeg(80, core.map.wind_direction)) > 0.5, core.map.wind_direction.toFixed(2));
  check('settings.wind is the base', core.settings.wind.angle === 80 && core.settings.wind.speed === 4.5, JSON.stringify(core.settings.wind));
  const room = configFromRoomState(core.roomState(), { mapW: 100, mapH: 200 });
  check('configFromRoomState: base wind and every component', room.wind_angle_deg === 80 && room.wind_speed_mps === 4.5 && room.wind_schedule_seed === 42
    && JSON.stringify(room.wind_dir_osc) === JSON.stringify(v.config.wind_dir_osc) && JSON.stringify(room.wind_speed_trend) === JSON.stringify(v.config.wind_speed_trend));
  const p = parseAndValidateRoomConfig(stringifyRoomConfig(room));
  check('room TOML round-trip keeps schedule and base', !p.error && p.config.wind_angle_deg === 80
    && JSON.stringify(p.config.wind_dir_trend) === JSON.stringify(v.config.wind_dir_trend), p.error);
  const clock = core.sim.windClock;
  mute(() => core.command({ type: 'config', config: p.config }));
  check('re-commit of the same schedule keeps its clock', core.sim.windClock === clock && core.sim.windBase.angle === 80);
  check('commandsFromConfig skips an unchanged schedule', !commandsFromConfig(p.config, p.config).some((c) => c.type === 'windSchedule'));
  const before = core.map.wind_direction;
  core.command({ type: 'wind', angle: 120 });
  check('wind command with schedule on: base set, applied unchanged this tick', core.sim.windBase.angle === 120 && core.map.wind_direction === before && core.settings.wind.angle === 120);
  mute(() => core.tick({ dt: 1 / 30, held: [] }));
  check('then slews ≤ 0.5°/s', Math.abs(angleDiffDeg(before, core.map.wind_direction)) <= 0.5 / 30 + 1e-9);
  const def = parseAndValidateRoomConfig(stringifyRoomConfig(ROOM_CONFIG_DEFAULTS));
  check('defaults: schedule off, components round-trip', !def.error && def.config.wind_schedule === false
    && JSON.stringify(def.config.wind_dir_osc) === JSON.stringify(ROOM_CONFIG_DEFAULTS.wind_dir_osc));
  const plain = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  plain.command({ type: 'wind', angle: 45, speed: 5 });
  check('schedule off: wind command is instant (unchanged behaviour)', plain.map.wind_direction === 45 && plain.map.wind_speed === 5 && plain.bm.direction === 225);
  plain.command({ type: 'windSchedule', ...DEFAULT_WIND_SCHEDULE, ramp: true });
  plain.command({ type: 'wind', angle: 75 });
  for (let i = 0; i < 30; i++) mute(() => plain.tick({ dt: 1 / 30, held: [] }));
  check('wind_ramp: 30° change after 1 s has turned 0.5°', Math.abs(plain.map.wind_direction - 45.5) < 1e-6, plain.map.wind_direction.toFixed(4));
  plain.command({ type: 'windSchedule', ...DEFAULT_WIND_SCHEDULE, ramp: false });
  for (let i = 0; i < 30 * 70; i++) mute(() => plain.tick({ dt: 1 / 30, held: [] }));
  check('ramp off: settles on the base and stops slewing', Math.abs(plain.map.wind_direction - 75) < 1e-6 && plain.sim._windSettling === false);
  const over = validateRoomConfig({ ...ROOM_CONFIG_BASE, wind_schedule: true, wind_dir_osc: [{ amp_deg: 20, period_s: 60 }] });
  check('room config refuses over-rate means', !!over.error && /wind_dir_osc/.test(over.error), over.error);
}

// 5. The field follows the scheduled boundary wind (headless, 2f, no boats, gusts off).
{
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  core.command({ type: 'windSchedule', ...DEFAULT_WIND_SCHEDULE, enabled: true, seed: 5 });
  let maxDirErr = 0, maxSpdErr = 0, maxApplied = 0;
  for (let i = 0; i < 30 * 150; i++) {
    mute(() => core.tick({ dt: 1 / 30, held: [] }));
    const tgt = core.sim.windTarget();
    maxApplied = Math.max(maxApplied, Math.abs(angleDiffDeg(tgt.angle, core.map.wind_direction)));
    const w = core.map.get_wind(0, 0);
    maxDirErr = Math.max(maxDirErr, Math.abs(angleDiffDeg(core.map.wind_direction, w.direction)));
    maxSpdErr = Math.max(maxSpdErr, Math.abs(w.speed / core.map.wind_speed - 1));
  }
  check('applied wind on the schedule throughout', maxApplied < 1e-6, maxApplied.toFixed(6));
  check('field direction at the centre within 1.5° of the schedule from the start', maxDirErr <= 1.5, maxDirErr.toFixed(3) + '°');
  check('field speed at the centre within 3 % of the schedule', maxSpdErr <= 0.03, (100 * maxSpdErr).toFixed(2) + ' %');
}

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all wind schedule checks passed');
