// Base-wind schedule (src/wind-schedule.js, Sim windSchedule): [wind_dir] /
// [wind_speed] termN = [amp, amp_sd, freq, freq_sd] sampled per seed (gust
// convention), freq 0 = constant base term, determinism, rate limits, start
// on the base at t = 0, base wind kept through the room config, and the
// lattice following the scheduled wind.
import './dom-stub.mjs';
const {
  DEFAULT_WIND_SCHEDULE, validateWindSchedule, realiseWindSchedule, sampleWindSchedule, windScheduleOffset,
  windScheduleRates, windScheduleBase, windSlew, angleDiffDeg, WIND_MAX_DEG_PER_S, WIND_MAX_SPEED_FRAC_PER_S,
  WIND_MAX_SPEED_AMP_SUM, WIND_MIN_FREQ_HZ, WIND_MAX_FREQ_HZ, WIND_FREQ_PER_S,
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
const ofTarget = (terms, target) => terms.filter((t) => t.target === target);
const offsetAt = (s, t) => { const r = realiseWindSchedule(s); return windScheduleOffset(r.terms, t, r.phases); };
const tbl = (...terms) => Object.fromEntries(terms.map((t, i) => ['term' + i, t]));

// 1. Determinism per seed: sampled amplitudes / freqs, phases, base.
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
  check('seeds vary the freqs and amplitudes', t7[0].amp !== t8[0].amp && t7[0].freq_hz !== t8[0].freq_hz
    && t7[6].freq_hz !== t8[6].freq_hz, JSON.stringify(t7[0]) + ' vs ' + JSON.stringify(t8[0]));
  const zero = sampleWindSchedule(spec({ dir: tbl([6, 0, 10, 0]), speed: tbl([5, 0, 6, 0]) })).osc;
  check('sd 0 → the mean exactly; freq cycles/hour → Hz; speed amp % → fraction', zero[0].amp === 6 && zero[0].freq_hz === 10 / 3600
    && zero[1].amp === 0.05 && zero[1].target === 'speed', JSON.stringify(zero));
  // Phases do not depend on the spreads (separate stream).
  const p1 = realiseWindSchedule(spec({ seed: 9 })).phases;
  const noSd = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, [v[0], 0, v[2], 0]]));
  const p2 = realiseWindSchedule(spec({ seed: 9, dir: noSd(DEFAULT_WIND_SCHEDULE.dir), speed: noSd(DEFAULT_WIND_SCHEDULE.speed) })).phases;
  check('phases independent of the spreads', JSON.stringify(p1) === JSON.stringify(p2));
  const dd = DEFAULT_WIND_SCHEDULE;
  check('defaults: 4 direction and 3 speed terms, no constant term', Object.keys(dd.dir).length === 4 && Object.keys(dd.speed).length === 3
    && [...Object.values(dd.dir), ...Object.values(dd.speed)].every((t) => t[2] > 0));
  // Same random streams as the earlier per-kind layout: amplitudes and phases
  // of seed 1 unchanged (the freq draws differ: N(f, sd) is not 1/N(T, sd)).
  const s1 = realiseWindSchedule(spec({ seed: 1 }));
  check('seed 1 amplitudes and phases unchanged from the period layout', Math.abs(s1.terms[0].amp - 4.643941324309804) < 1e-15
    && Math.abs(s1.phases[0] - 3.94002177001874) < 1e-15 && Math.abs(s1.terms[6].amp - 0.03433658686496265) < 1e-15, JSON.stringify(s1.terms[0]));
  // Constant terms: base per seed from their own stream; do not move the oscillation.
  const withBase = spec({ seed: 9, dir: { ...dd.dir, term9: [90, 10, 0, 0] } });
  const rb = realiseWindSchedule(withBase), r0 = realiseWindSchedule(spec({ seed: 9 }));
  check('a constant term does not change the oscillation draws or phases', JSON.stringify(rb) === JSON.stringify(r0));
  const bA = windScheduleBase(withBase), bB = windScheduleBase(withBase), bC = windScheduleBase({ ...withBase, seed: 10 });
  check('constant term amp_sd: random base per seed, deterministic', bA.angle === bB.angle && bA.angle !== bC.angle && Math.abs(bA.angle - 90) < 60 && bA.speed === null,
    JSON.stringify(bA));
  const sumB = windScheduleBase(spec({ dir: tbl([90, 0, 0, 0], [-100, 0, 0, 0], [4, 2, 2, 0.5]), speed: tbl([3, 0, 0, 0], [1.5, 0, 0, 0]) }));
  check('constant terms add up (angle wrapped, speed m/s)', sumB.angle === 350 && sumB.speed === 4.5, JSON.stringify(sumB));
  check('no constant term → base null (wind_angle_deg / wind_speed_mps stay)', JSON.stringify(windScheduleBase(spec())) === '{"angle":null,"speed":null}');
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
  let worstDir = 0, worstSpd = 0, worstAmp = 0, minF = Infinity, maxF = 0, negAmp = 0, scaledD = 0, scaledS = 0;
  // Wide spreads so draws hit the clamps (freq ≤ 0, amp < 0) and the scaling too.
  const wide = spec({ dir: tbl([12, 12, 12, 12], [6, 6, 7, 4], [10, 3, 1, 0.2], [2, 1, 0.5, 1]),
    speed: tbl([12, 12, 12, 12], [4, 1.2, 1.333, 0.267]) });
  for (let seed = 0; seed < 2000; seed++) {
    for (const s of [spec({ seed }), { ...wide, seed }]) {
      const r = sampleWindSchedule(s);
      const rate = windScheduleRates(r.osc);
      worstDir = Math.max(worstDir, rate.dirDegPerS);
      worstSpd = Math.max(worstSpd, rate.speedFracPerS);
      worstAmp = Math.max(worstAmp, ofTarget(r.osc, 'speed').reduce((a, t) => a + t.amp, 0));
      for (const t of r.osc) { minF = Math.min(minF, t.freq_hz); maxF = Math.max(maxF, t.freq_hz); if (!(t.amp >= 0)) negAmp++; }
      if (r.dirScale < 1) scaledD++;
      if (r.speedScale < 1) scaledS++;
    }
  }
  check('sampled direction rate ≤ 0.5°/s for every draw', worstDir <= WIND_MAX_DEG_PER_S + 1e-9, worstDir.toFixed(4));
  check('sampled speed rate ≤ 0.5 %/s for every draw', worstSpd <= WIND_MAX_SPEED_FRAC_PER_S + 1e-12, (100 * worstSpd).toFixed(4));
  check('sampled speed amplitudes sum ≤ 40 %', worstAmp <= WIND_MAX_SPEED_AMP_SUM + 1e-12, worstAmp.toFixed(4));
  check('freq draws ≤ 0 clamp to the floor (never constant or negative), amplitudes ≥ 0', minF === WIND_MIN_FREQ_HZ && maxF <= WIND_MAX_FREQ_HZ && negAmp === 0,
    `min ${(minF / WIND_FREQ_PER_S).toFixed(3)} cph`);
  check('wide spreads exercise the amplitude scaling', scaledD > 0 && scaledS > 0, `dir ${scaledD} speed ${scaledS}`);
  const d = sampleWindSchedule(spec({ seed: 1 })).osc;
  const means = [...Object.values(DEFAULT_WIND_SCHEDULE.dir), ...Object.values(DEFAULT_WIND_SCHEDULE.speed)];
  check('default draw near the means', d.every((t, i) => Math.abs(t.freq_hz / WIND_FREQ_PER_S - means[i][2]) < 4 * means[i][3]));
  // The analytic rate bounds the sampled slope.
  const r1 = realiseWindSchedule(spec({ seed: 1 }));
  const bound = windScheduleRates(r1.terms);
  let maxD = 0;
  for (let t = 0; t < 3600; t += 0.5) {
    const a = windScheduleOffset(r1.terms, t, r1.phases), b = windScheduleOffset(r1.terms, t + 0.5, r1.phases);
    maxD = Math.max(maxD, Math.abs(b.dirDeg - a.dirDeg) / 0.5);
  }
  check('numeric turning rate within Σ 2πA·f', maxD <= bound.dirDegPerS + 1e-9, `${maxD.toFixed(4)} ≤ ${bound.dirDegPerS.toFixed(4)}`);
  const m = DEFAULT_WIND_SCHEDULE.dir.term3;
  check('direction trend term: slow sine (≤ 1.5 cph, ≤ ~1°/min)', m[2] <= 1.5 && 2 * Math.PI * m[0] * m[2] / 3600 * 60 <= 1.1);
  const fast = validateWindSchedule({ enabled: true, dir: tbl([1, 0, 6, 0], [20, 0, 60, 0]) });
  check('over-rate means refused (°/s), naming the largest term', !!fast.error && /°\/s/.test(fast.error) && /wind_dir\.term1/.test(fast.error), fast.error);
  const fastU = validateWindSchedule({ enabled: true, speed: tbl([20, 0, 60, 0]) });
  check('over-rate means refused (%/s)', !!fastU.error && /%\/s/.test(fastU.error) && /wind_speed\.term0/.test(fastU.error), fastU.error);
  check('limits per table', !validateWindSchedule({ dir: tbl([20, 0, 6, 0]), speed: tbl([20, 0, 1.2, 0]) }).error
    && /sum/.test(validateWindSchedule({ speed: tbl([25, 0, 1.2, 0], [25, 0, 1.2, 0]) }).error));
  const err = (o) => validateWindSchedule(o).error || '';
  check('unknown table key refused', /wind_dir\.foo: unknown key/.test(err({ dir: { foo: [1, 0, 1, 0] } })), err({ dir: { foo: [1, 0, 1, 0] } }));
  check('term must be 4 numbers', /wind_dir\.term0 must be \[amp, amp_sd, freq, freq_sd\]/.test(err({ dir: tbl([1, 0, 1]) })), err({ dir: tbl([1, 0, 1]) }));
  check('negative sd refused', /sds must be ≥ 0/.test(err({ dir: tbl([1, -1, 1, 0]) })));
  check('constant term with freq_sd refused', /freq_sd must be 0/.test(err({ dir: tbl([90, 0, 0, 1]) })));
  check('negative freq or below the floor refused', /freq must be 0 \(constant\) or 0\.1\.\.360/.test(err({ dir: tbl([1, 0, -1, 0]) }))
    && !!err({ dir: tbl([1, 0, 0.05, 0]) }), err({ dir: tbl([1, 0, -1, 0]) }));
  check('negative oscillating amp refused, constant may be negative', /amp must be ≥ 0/.test(err({ dir: tbl([-1, 0, 1, 0]) })) && !err({ dir: tbl([-20, 0, 0, 0]) }));
  check('empty tables allowed (no oscillation)', !err({ dir: {}, speed: {} }) && offsetAt(spec({ dir: {}, speed: {} }), 100).dirDeg === 0);
  const ord = spec({ dir: { term10: [1, 0, 1, 0], term2: [2, 0, 2, 0] } });
  check('terms ordered by index (term2 before term10)', Object.keys(ord.dir).join() === 'term2,term10');
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  const r2 = core.command({ type: 'windSchedule', enabled: true, dir: tbl([20, 0, 60, 0]) });
  check('Sim windSchedule command returns the error', r2 && !!r2.error && core.sim.windSchedule.enabled === false);
  const st = windSlew({ angle: 359, speed: 4 }, { angle: 10, speed: 6 }, 0.5, 0.1);
  check('slew steps 0.5° the short way through 0°', Math.abs(angleDiffDeg(359, st.angle) - 0.5) < 1e-9 && Math.abs(st.speed - 4.1) < 1e-9 && !st.done);
}

// 3. Starts exactly on the base at t = 0 for every seed and draw.
{
  let bad = 0, moved = 0;
  const custom = { dir: tbl([90, 20, 0, 0], [5, 2, 36, 10], [1, 0, 10.8, 0]), speed: tbl([10, 3, 9, 1.8]) };
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

[wind_dir]                   # termN = [amp, amp_sd, freq, freq_sd]
term0 = [6, 1.8, 10, 2]      # degrees, cycles per hour
term1 = [3, 0, 6.316, 0]
term3 = [10, 3, 1, 0.2]      # trend (gap in the numbering is fine)

[wind_speed]
term0 = [7, 2.1, 8.571, 1.714]   # % of the base speed
term1 = [4, 1.2, 1.333, 0.267]
`;
  const v = parseAndValidateRoomConfig(toml);
  check('[wind_dir] / [wind_speed] TOML with # comments validates', !v.error, v.error);
  check('terms kept as 4-arrays, no constant → wind_angle_deg stays the base', !v.error && JSON.stringify(v.config.wind_dir.term1) === '[3,0,6.316,0]'
    && Object.keys(v.config.wind_speed).length === 2 && v.config.wind_angle_deg === 80, JSON.stringify(v.config && v.config.wind_dir));
  const text = stringifyRoomConfig(v.config);
  const back = parseAndValidateRoomConfig(text);
  check('stringify → parse round-trips every wind key', !back.error && ['wind_schedule', 'wind_schedule_seed', 'wind_dir', 'wind_speed', 'wind_ramp']
    .every((k) => JSON.stringify(back.config[k]) === JSON.stringify(v.config[k])), back.error);
  check('stringify is stable', stringifyRoomConfig(back.config) === text);
  const badText = 'wind_schedule = true\n\n[wind_dir]\nterm0 = [1, 0, 6, 0]\nterm1 = [40, 1, 60, 0]\n\n[wind_speed]\nterm0 = [1, 0, 6, 0]\n';
  const bad = parseAndValidateRoomConfig(badText);
  check('over-rate: error line points at the largest term key', !!bad.error && roomConfigErrorLine(badText, bad) === 5, bad.error);
  const badS = badText.replace('[wind_speed]\nterm0 = [1, 0, 6, 0]', '[wind_speed]\nterm0 = [1, 0, 6]').replace('[40, 1, 60, 0]', '[4, 1, 6, 0]');
  const bs = parseAndValidateRoomConfig(badS);
  check('bad term in [wind_speed]: error line points at its term0 =, not [wind_dir]\'s', !!bs.error && roomConfigErrorLine(badS, bs) === 8, bs.error);
  const badU = badText.replace('term1 = [40, 1, 60, 0]', 'trem1 = [4, 1, 6, 0]');
  const bu = parseAndValidateRoomConfig(badU);
  check('unknown key in a table: error line points at it', !!bu.error && roomConfigErrorLine(badU, bu) === 5, bu.error);
  const slash = parseAndValidateRoomConfig('[wind_dir]\nterm0 = [90,0,0,0] // degrees\n');
  check('// is not TOML: a parse error with its line', !!slash.error && roomConfigErrorLine('', slash) === 2, slash.error);
  const oldOsc = parseAndValidateRoomConfig('[[wind_osc]]\ntarget = "direction"\namp = 1\nperiod_s = 600\n');
  check('[[wind_osc]] refused as unknown (never merged, no back-compat)', !!oldOsc.error && /wind_osc/.test(oldOsc.error), oldOsc.error);
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
    && JSON.stringify(room.wind_dir) === JSON.stringify(v.config.wind_dir) && JSON.stringify(room.wind_speed) === JSON.stringify(v.config.wind_speed));
  const p = parseAndValidateRoomConfig(stringifyRoomConfig(room));
  check('room TOML round-trip keeps schedule and base', !p.error && p.config.wind_angle_deg === 80
    && JSON.stringify(p.config.wind_dir) === JSON.stringify(v.config.wind_dir), p.error);
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
    && JSON.stringify(def.config.wind_dir) === JSON.stringify(ROOM_CONFIG_DEFAULTS.wind_dir) && JSON.stringify(def.config.wind_speed) === JSON.stringify(ROOM_CONFIG_DEFAULTS.wind_speed));
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
  const over = validateRoomConfig({ ...ROOM_CONFIG_BASE, wind_schedule: true, wind_dir: tbl([20, 0, 60, 0]) });
  check('room config refuses over-rate means', !!over.error && /wind_dir\.term0/.test(over.error), over.error);
}

// 4b. Constant (freq 0) terms are the base: they replace wind_angle_deg / wind_speed_mps.
{
  const toml = `
scenario = 0
wind_angle_deg = 10
wind_speed_mps = 3
gusts = false
wind_schedule = true
wind_schedule_seed = 3

[wind_dir]
term0 = [90, 0, 0, 0]   # base direction, sd 0
term1 = [4, 2, 2, 0.5]

[wind_speed]
term0 = [5, 0, 0, 0]    # base speed, m/s
term1 = [7, 2.1, 8.571, 1.714]
`;
  const v = parseAndValidateRoomConfig(toml);
  check('constant terms validate and set the base', !v.error && v.config.wind_angle_deg === 90 && v.config.wind_speed_mps === 5, v.error || JSON.stringify([v.config.wind_angle_deg, v.config.wind_speed_mps]));
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  mute(() => core.command({ type: 'config', config: v.config }));
  check('room starts on the constant-term base', core.sim.windBase.angle === 90 && core.map.wind_direction === 90 && core.map.wind_speed === 5,
    JSON.stringify(core.sim.windBase));
  check('the Sim oscillates only the freq > 0 terms', core.sim.windRealised.terms.length === 2);
  const back = parseAndValidateRoomConfig(stringifyRoomConfig(configFromRoomState(core.roomState(), { mapW: 100, mapH: 200 })));
  check('round-trip through room state keeps base and terms', !back.error && back.config.wind_angle_deg === 90 && back.config.wind_speed_mps === 5
    && JSON.stringify(back.config.wind_dir) === JSON.stringify(v.config.wind_dir), back.error);
  const rnd = parseAndValidateRoomConfig(toml.replace('term0 = [90, 0, 0, 0]', 'term0 = [90, 15, 0, 0]'));
  const rnd2 = parseAndValidateRoomConfig(toml.replace('term0 = [90, 0, 0, 0]', 'term0 = [90, 15, 0, 0]').replace('seed = 3', 'seed = 4'));
  check('constant amp_sd: random base per seed', rnd.config.wind_angle_deg !== 90 && rnd.config.wind_angle_deg !== rnd2.config.wind_angle_deg
    && Math.abs(angleDiffDeg(90, rnd.config.wind_angle_deg)) < 60, `${rnd.config.wind_angle_deg.toFixed(2)} / ${rnd2.config.wind_angle_deg.toFixed(2)}`);
  const off = parseAndValidateRoomConfig(toml.replace('wind_schedule = true', 'wind_schedule = false'));
  check('wind_schedule = false: tables off, wind_angle_deg / wind_speed_mps are the base', off.config.wind_angle_deg === 10 && off.config.wind_speed_mps === 3);
  const clock = core.sim.windClock;
  for (let i = 0; i < 30; i++) mute(() => core.tick({ dt: 1 / 30, held: [] }));
  const moved = parseAndValidateRoomConfig(toml.replace('term0 = [90, 0, 0, 0]', 'term0 = [80, 0, 0, 0]'));
  const cmds = commandsFromConfig(moved.config, v.config);
  mute(() => core.command({ type: 'config', config: moved.config }));
  check('changing only a constant term: wind command, clock kept, base slews', cmds.some((c) => c.type === 'wind' && c.angle === 80)
    && core.sim.windClock > clock && core.sim.windBase.angle === 80 && Math.abs(angleDiffDeg(90, core.map.wind_direction)) < 2);
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
