// Base-wind schedule (src/wind-schedule.js, Sim windSchedule): per-seed
// sampling of every [[wind_osc]] entry from [mean, sd] (gust convention),
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
const D = (amp, period_s, extra = {}) => ({ target: 'direction', amp, period_s, ...extra });
const S = (amp, period_s, extra = {}) => ({ target: 'speed', amp, period_s, ...extra });
const ofTarget = (terms, target) => terms.filter((t) => t.target === target);
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
  const t7 = sampleWindSchedule(spec({ seed: 7 })).osc, t8 = sampleWindSchedule(spec({ seed: 8 })).osc;
  check('seeds vary the periods and amplitudes', t7[0].amp !== t8[0].amp && t7[0].period_s !== t8[0].period_s
    && t7[6].period_s !== t8[6].period_s, JSON.stringify(t7[0]) + ' vs ' + JSON.stringify(t8[0]));
  const zero = sampleWindSchedule(spec({ osc: [D([6, 0], [360, 0]), S([5, 0], [400, 0])] })).osc;
  check('sd 0 → the mean exactly (gust convention), speed amp % → fraction', zero[0].amp === 6 && zero[0].period_s === 360
    && zero[1].amp === 0.05 && zero[1].target === 'speed', JSON.stringify(zero));
  // Phases do not depend on the spreads (separate stream).
  const p1 = realiseWindSchedule(spec({ seed: 9 })).phases;
  const osc0 = DEFAULT_WIND_SCHEDULE.osc.map((c) => ({ ...c, amp: [c.amp[0], 0], period_s: [c.period_s[0], 0] }));
  const p2 = realiseWindSchedule(spec({ seed: 9, osc: osc0 })).phases;
  check('phases independent of the spreads', JSON.stringify(p1) === JSON.stringify(p2));
  // Defaults: 4 direction + 3 speed entries, the trends are long-period entries.
  const dd = DEFAULT_WIND_SCHEDULE.osc;
  check('defaults: 4 direction and 3 speed entries', ofTarget(dd, 'direction').length === 4 && ofTarget(dd, 'speed').length === 3);
  // Order is the sampling order: the defaults as one list draw what the old
  // per-kind keys drew (direction terms, direction trend, speed, speed trend).
  const s1 = sampleWindSchedule(spec({ seed: 1 })).osc;
  check('seed 1 draws unchanged from the per-kind layout', Math.abs(s1[0].amp - 4.643941324309804) < 1e-15 && Math.abs(s1[6].period_s - 2371.0202521891324) < 1e-9,
    JSON.stringify(s1[0]));
  // Optional phase_deg: fixed, or [mean, sd]; other entries' phases unchanged.
  const pinned = realiseWindSchedule(spec({ seed: 9, osc: osc0.map((c, i) => (i === 1 ? { ...c, phase_deg: 90 } : c)) })).phases;
  check('phase_deg fixes that entry only', Math.abs(pinned[1] - Math.PI / 2) < 1e-15 && pinned.every((ph, i) => i === 1 || ph === p2[i]));
  const drawn = (seed) => realiseWindSchedule(spec({ seed, osc: [D(1, 100, { phase_deg: [90, 20] }), D(1, 200)] })).phases;
  const dA = drawn(4), dB = drawn(4), dC = drawn(5);
  check('phase_deg [mean, sd]: drawn per seed, deterministic', dA[0] === dB[0] && dA[0] !== dC[0] && Math.abs(dA[0] * 180 / Math.PI - 90) < 100);
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
  const wide = spec({ osc: [D([12, 12], [300, 300]), D([6, 6], [500, 300]), D([10, 3], [3600, 720]),
    S([12, 12], [300, 300]), S([4, 1.2], [2700, 540])] });
  for (let seed = 0; seed < 2000; seed++) {
    for (const s of [spec({ seed }), { ...wide, seed }]) {
      const r = sampleWindSchedule(s);
      const rate = windScheduleRates(r.osc);
      worstDir = Math.max(worstDir, rate.dirDegPerS);
      worstSpd = Math.max(worstSpd, rate.speedFracPerS);
      worstAmp = Math.max(worstAmp, ofTarget(r.osc, 'speed').reduce((a, t) => a + t.amp, 0));
      for (const t of r.osc) { minPer = Math.min(minPer, t.period_s); if (!(t.amp >= 0)) negAmp++; }
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
  const d = sampleWindSchedule(spec({ seed: 1 })).osc;
  check('default draw near the means', d.every((t, i) => Math.abs(t.period_s - DEFAULT_WIND_SCHEDULE.osc[i].period_s[0]) < 4 * DEFAULT_WIND_SCHEDULE.osc[i].period_s[1]));
  // The analytic rate bounds the sampled slope.
  const r1 = realiseWindSchedule(spec({ seed: 1 }));
  const bound = windScheduleRates(r1.terms);
  let maxD = 0;
  for (let t = 0; t < 3600; t += 0.5) {
    const a = windScheduleOffset(r1.terms, t, r1.phases), b = windScheduleOffset(r1.terms, t + 0.5, r1.phases);
    maxD = Math.max(maxD, Math.abs(b.dirDeg - a.dirDeg) / 0.5);
  }
  check('numeric turning rate within Σ 2πA/T', maxD <= bound.dirDegPerS + 1e-9, `${maxD.toFixed(4)} ≤ ${bound.dirDegPerS.toFixed(4)}`);
  const m = DEFAULT_WIND_SCHEDULE.osc[3];
  check('direction trend entry: slow sine (period ≥ 40 min, ≤ ~1°/min)', m.target === 'direction' && m.period_s[0] >= 2400 && 2 * Math.PI * m.amp[0] / m.period_s[0] * 60 <= 1.1);
  const fast = validateWindSchedule({ enabled: true, osc: [D(1, 600), D([20, 0], [60, 0])] });
  check('over-rate means refused (°/s), naming the largest entry', !!fast.error && /°\/s/.test(fast.error) && /wind_osc\[1\]/.test(fast.error), fast.error);
  const fastU = validateWindSchedule({ enabled: true, osc: [S([20, 0], [60, 0])] });
  check('over-rate means refused (%/s)', !!fastU.error && /%\/s/.test(fastU.error), fastU.error);
  // Rate limits are per target: 20° at 600 s is 0.21°/s, legal; as speed it is 0.21 %/s, legal too, but 50 % sums over 40 %.
  check('limits per target', !validateWindSchedule({ osc: [D(20, 600), S(20, 3000)] }).error && /sum/.test(validateWindSchedule({ osc: [S(25, 3000), S(25, 3000)] }).error));
  const badKey = validateWindSchedule({ osc: [D(1, 100, { phase: 2 })] });
  check('unknown entry key refused', !!badKey.error && /phase/.test(badKey.error) && /wind_osc\[0\]/.test(badKey.error), badKey.error);
  const badTarget = validateWindSchedule({ osc: [{ target: 'angle', amp: 1, period_s: 100 }] });
  check('target must be direction or speed', !!badTarget.error && /target/.test(badTarget.error), badTarget.error);
  const noTarget = validateWindSchedule({ osc: [{ amp: 1, period_s: 100 }] });
  check('target is required', !!noTarget.error && /target/.test(noTarget.error), noTarget.error);
  const badSd = validateWindSchedule({ osc: [D([1, -1], 100)] });
  check('negative sd refused, unit named', !!badSd.error && /amp \(°\)/.test(badSd.error), badSd.error);
  const badPh = validateWindSchedule({ osc: [D(1, 100, { phase_deg: 'x' })] });
  check('bad phase_deg refused', !!badPh.error && /phase_deg/.test(badPh.error), badPh.error);
  check('empty list allowed (no oscillation)', !validateWindSchedule({ osc: [] }).error && offsetAt(spec({ osc: [] }), 100).dirDeg === 0);
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  const r2 = core.command({ type: 'windSchedule', enabled: true, osc: [D(20, 60)] });
  check('Sim windSchedule command returns the error', r2 && !!r2.error && core.sim.windSchedule.enabled === false);
  const st = windSlew({ angle: 359, speed: 4 }, { angle: 10, speed: 6 }, 0.5, 0.1);
  check('slew steps 0.5° the short way through 0°', Math.abs(angleDiffDeg(359, st.angle) - 0.5) < 1e-9 && Math.abs(st.speed - 4.1) < 1e-9 && !st.done);
}

// 3. Starts exactly on the base at t = 0 for every seed and draw.
{
  let bad = 0, moved = 0;
  const custom = { osc: [D([5, 2], [100, 30]), S([10, 3], [400, 80]), D(1, 333, { phase_deg: [90, 40] })] };
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

[[wind_osc]]
target = "direction"
amp = [6, 1.8]
period_s = [360, 72]

[[wind_osc]]
target = "direction"
amp = 3
period_s = [570]
phase_deg = 45

[[wind_osc]]          # trend
target = "direction"
amp = [10, 3]
period_s = [3600, 720]

[[wind_osc]]
target = "speed"
amp = [7, 2.1]
period_s = [420, 84]

[[wind_osc]]
target = "speed"
amp = [4, 1.2]
period_s = [2700, 540]
`;
  const v = parseAndValidateRoomConfig(toml);
  check('array-of-tables TOML validates', !v.error, v.error);
  check('number / [mean] forms normalise to [mean, sd]', !v.error && JSON.stringify(v.config.wind_osc[1]) === '{"target":"direction","amp":[3,0],"period_s":[570,0],"phase_deg":[45,0]}'
    && v.config.wind_osc.length === 5, JSON.stringify(v.config.wind_osc && v.config.wind_osc[1]));
  const text = stringifyRoomConfig(v.config);
  const back = parseAndValidateRoomConfig(text);
  check('stringify → parse round-trips every wind key', !back.error && ['wind_schedule', 'wind_schedule_seed', 'wind_osc', 'wind_ramp']
    .every((k) => JSON.stringify(back.config[k]) === JSON.stringify(v.config[k])), back.error);
  check('stringify is stable', stringifyRoomConfig(back.config) === text);
  const badText = 'wind_schedule = true\n\n[[wind_osc]]\ntarget = "direction"\namp = 1\nperiod_s = 600\n\n[[wind_osc]]\ntarget = "direction"\namp = [40, 1]\nperiod_s = 60\n';
  const bad = parseAndValidateRoomConfig(badText);
  check('over-rate: error line points at the largest [[wind_osc]] entry', !!bad.error && roomConfigErrorLine(badText, bad) === 8, bad.error);
  const badT = badText.replace('target = "direction"\namp = [40', 'target = "dir"\namp = [40');
  const bt = parseAndValidateRoomConfig(badT);
  check('bad target: error line points at that entry\'s target =', !!bt.error && roomConfigErrorLine(badT, bt) === 9, bt.error);
  const badU = badText.replace('period_s = 600', 'period_s = 600\nperiod = 5');
  const bu = parseAndValidateRoomConfig(badU);
  check('unknown entry key: error line points at it', !!bu.error && roomConfigErrorLine(badU, bu) === 7, bu.error);
  const old = parseAndValidateRoomConfig('[wind_dir_trend]\namp_deg = 1\nperiod_s = 600\n');
  check('old per-kind keys are unknown (never merged, no back-compat)', !!old.error && /wind_dir_trend/.test(old.error), old.error);

  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  const r = mute(() => core.command({ type: 'config', config: v.config }));
  check('config with schedule applies', !(r && r.error), JSON.stringify(r));
  for (let i = 0; i < 30 * 60; i++) mute(() => core.tick({ dt: 1 / 30, held: [] }));
  check('applied wind moved off the base', Math.abs(angleDiffDeg(80, core.map.wind_direction)) > 0.5, core.map.wind_direction.toFixed(2));
  check('settings.wind is the base', core.settings.wind.angle === 80 && core.settings.wind.speed === 4.5, JSON.stringify(core.settings.wind));
  const room = configFromRoomState(core.roomState(), { mapW: 100, mapH: 200 });
  check('configFromRoomState: base wind and every component', room.wind_angle_deg === 80 && room.wind_speed_mps === 4.5 && room.wind_schedule_seed === 42
    && JSON.stringify(room.wind_osc) === JSON.stringify(v.config.wind_osc));
  const p = parseAndValidateRoomConfig(stringifyRoomConfig(room));
  check('room TOML round-trip keeps schedule and base', !p.error && p.config.wind_angle_deg === 80
    && JSON.stringify(p.config.wind_osc) === JSON.stringify(v.config.wind_osc), p.error);
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
    && JSON.stringify(def.config.wind_osc) === JSON.stringify(ROOM_CONFIG_DEFAULTS.wind_osc));
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
  const over = validateRoomConfig({ ...ROOM_CONFIG_BASE, wind_schedule: true, wind_osc: [D(20, 60)] });
  check('room config refuses over-rate means', !!over.error && /wind_osc/.test(over.error), over.error);
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
