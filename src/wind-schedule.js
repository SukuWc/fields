// Base-wind schedule: a slow, seeded, deterministic oscillation of the
// boundary wind (Boltzmann setBoundaries) and of ConstantWind in dev mode.
//
//   θ(t) = θ0 + Σ_{wind_dir terms} A_i (sin(2π f_i t + φ_i) − sin φ_i)
//   U(t) = U0 · (1 + Σ_{wind_speed terms} B_j (sin(2π f_j t + φ_j) − sin φ_j))
//
// Room config: two tables, [wind_dir] and [wind_speed], each with keys
// term0, term1, … (sampled in index order). Every term is
//   termN = [amp, amp_sd, freq, freq_sd]
// amp: degrees in [wind_dir], % of the base speed in [wind_speed]; freq in
// WIND_FREQ_UNIT (cycles per hour; the unit lives only in WIND_FREQ_PER_S /
// WIND_FREQ_UNIT). Each pair is a mean and sd drawn once per
// wind_schedule_seed from N(mean, sd²) (gusts.js sampleNormal), the gust
// convention. No noise term; a "trend" is a term with a low frequency.
//
// freq = 0 means no change: a constant term. Constant terms set the base
// instead of oscillating: in [wind_dir] their amplitudes (degrees, the
// wind_angle_deg convention) add up to θ0, in [wind_speed] (m/s) to U0. A
// table with no constant term keeps wind_angle_deg / wind_speed_mps as its
// base. The room config resolves this (room-config.js validateRoomConfig
// rewrites wind_angle_deg / wind_speed_mps to the sampled base), so the base
// stays one value (`wind` command, settings.wind) and the Sim only runs the
// oscillating terms. A constant term's amp_sd draws a random base per seed,
// which moves the start direction / speed itself; the oscillation still
// starts on that base. A constant term's freq_sd must be 0.
//
// Oscillating terms (freq mean > 0): amplitude clamped at 0 as gusts clamp
// their knobs; a freq draw is clamped to [WIND_MIN_FREQ_HZ, WIND_MAX_FREQ_HZ]
// (10 h .. 10 s periods), so a term whose mean is > 0 never becomes constant
// or negative. Clamping rather than resampling keeps a fixed number of random
// draws per term, so a clamp in one term never shifts any later term's draw
// for that seed (the gust samplers clamp too); a term pinned at the floor is
// a 10 h sine, i.e. a near-linear drift over a race.
// Streams, all from wind_schedule_seed: oscillating amplitudes / freqs
// mulberry32(seed ^ SAMPLE_SALT), amp then freq per term, [wind_dir] then
// [wind_speed]; phases mulberry32(seed), one uniform per oscillating term
// (always random: the 4-array has no phase slot); constant terms
// mulberry32(seed ^ BASE_SALT). Adding or editing a constant term therefore
// never changes the oscillation draws.
//
// Every oscillating term has its value at t = 0 subtracted, so the wind
// starts exactly on the base (offset 0°, factor 1) for any seed and switching
// the schedule on needs no catch-up. The phase still sets each term's starting
// slope and its derivative (so the rate limit) is unchanged. The cost: term
// i's mean moves by −A_i sin φ_i, so it ranges over [−A_i(1 + sin φ_i),
// A_i(1 − sin φ_i)], up to 2·A_i to one side.
//
// The field cannot follow an instant change cleanly: a step rings for 30-60 s
// (fixed-equilibrium edges, vortex sheets advected out at wind speed). So the
// turning rate Σ 2πA·f is limited to WIND_MAX_DEG_PER_S and the relative speed
// rate Σ 2πB·f to WIND_MAX_SPEED_FRAC_PER_S. The configured means must satisfy
// the limits (else the config is refused); a random draw that exceeds one has
// all amplitudes of that table scaled down to the limit (freqs and phases
// kept), see sampleWindSchedule. The applied wind also slews toward the target
// (windSlew) at the limits, which ramps the return to the base when the
// schedule is switched off (or re-seeded mid-run) and, with wind_ramp, manual
// changes.
// Seed: room config wind_schedule_seed = [mean, sd] (or a plain integer, sd
// 0). The room config draws the seed for a game from N(mean, sd²) with real
// randomness (drawWindSeed, Math.random: not a seeded stream), rounded to
// an integer, absolute value (|n|, not clamped at 0, so N(1, 100²) spreads
// over 0..~300 without piling up at 0), every time a config is applied (room start,
// Reset, Apply); sd 0 gives exactly the mean, so a game can be replayed by
// setting wind_schedule_seed = [<drawn seed>, 0]. The spec keeps both: `seed`
// is the drawn seed every stream above uses, `seedSpec` the configured
// [mean, sd] (round-trip, room settings).
// Defaults: the room config default (DEFAULT_WIND_SCHEDULE) is on with seed
// [1, 100]; a bare Sim with no room config (scenario checks, unit tests)
// starts with the schedule off (SIM_WIND_SCHEDULE), a steady wind.
// No DOM: runs in the Sim on the server, worker and tests.
import { mulberry32, sampleNormal } from './gusts.js';

// Frequency unit of the TOML terms: cycles per hour. Change it here only.
export const WIND_FREQ_PER_S = 1 / 3600;
export const WIND_FREQ_UNIT = 'cycles/hour';
// Oscillating frequency range (Hz): 10 h .. 10 s periods.
export const WIND_MIN_FREQ_HZ = 1 / 36000;
export const WIND_MAX_FREQ_HZ = 0.1;
// Max direction rate of the schedule and of the slew (°/s).
export const WIND_MAX_DEG_PER_S = 0.5;
// Max relative speed rate of the schedule (fraction of base per s): 0.5 %/s.
export const WIND_MAX_SPEED_FRAC_PER_S = 0.005;
// Slew rate for speed changes (manual `wind` speed, schedule on/off), m/s per s.
export const WIND_SLEW_SPEED_MPS_PER_S = 0.1;
// Sum of sampled speed amplitudes (fraction): a term can reach 2·B below the
// base (see above), so 2 · 0.4 keeps U ≥ 0.2 · U0. Draws over it are scaled.
export const WIND_MAX_SPEED_AMP_SUM = 0.4;
// Max terms per table.
export const WIND_MAX_TERMS = 12;
const SAMPLE_SALT = 0x9E3779B9;
const BASE_SALT = 0xC2B2AE35;
const TABLES = Object.freeze({ dir: 'wind_dir', speed: 'wind_speed' });

// Defaults: the earlier 6 / 9.5 / 14 min direction terms and 60 min trend
// as frequencies (10, 6.316, 4.286, 1 cph), amplitudes 6° / 3° / 2° / 10°;
// speed 7 min, 11.5 min, 45 min (8.571, 5.217, 1.333 cph) at 7 % / 4 % / 4 %.
// No constant terms, so the base stays wind_angle_deg / wind_speed_mps.
// Spreads: amplitude sd 30 % of the mean (seeds differ visibly; a draw below
// 0 is 3.3 sd away, ~0.05 %, and clamps to 0), freq sd 20 % (1 sd keeps the
// direction terms in order and distinct, and the trend under ~1.4 cph at
// 2 sd so it still reads as a trend). The trend: 10° at 1 cph, slope up to
// 2π·10/3600 = 0.017°/s ≈ 1°/min, a monotonic-looking 0-10° drift over a
// 10 min race depending on phase. Rates at the means: direction 0.17°/s,
// speed 0.15 %/s; a draw rarely reaches the limits, see sampleWindSchedule.
const r3 = (x) => +x.toFixed(3);
const t4 = (a, f) => Object.freeze([a, r3(0.3 * a), f, r3(0.2 * f)]);
export const DEFAULT_WIND_SCHEDULE = Object.freeze({
  enabled: true,
  seed: 1,
  seedSpec: Object.freeze([1, 100]),
  dir: Object.freeze({ term0: t4(6, 10), term1: t4(3, 6.316), term2: t4(2, 4.286), term3: t4(10, 1) }),
  speed: Object.freeze({ term0: t4(7, 8.571), term1: t4(4, 5.217), term2: t4(4, 1.333) }),
  ramp: false,
});

// A Sim with no room config: schedule off, fixed seed (steady wind, deterministic).
export const SIM_WIND_SCHEDULE = Object.freeze({ ...DEFAULT_WIND_SCHEDULE, enabled: false, seedSpec: Object.freeze([1, 0]) });

const MAX_SEED = 0xFFFFFFFF;
const SEED_MSG = 'wind_schedule_seed must be an integer 0..' + MAX_SEED + ' or [mean, sd]';

/**
 * wind_schedule_seed → [mean, sd]: an integer (sd 0), [mean] or [mean, sd];
 * mean an integer 0..4294967295, sd a number ≥ 0. Throws a message naming
 * the setting.
 */
export function parseWindSeed(raw) {
  const intOk = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_SEED;
  if (typeof raw === 'number') {
    if (!intOk(raw)) throw SEED_MSG;
    return [raw, 0];
  }
  if (Array.isArray(raw) && (raw.length === 1 || raw.length === 2)) {
    const [m, sd = 0] = raw;
    if (!intOk(m)) throw 'wind_schedule_seed mean must be an integer 0..' + MAX_SEED;
    if (typeof sd !== 'number' || !Number.isFinite(sd) || sd < 0) throw 'wind_schedule_seed sd must be a number ≥ 0';
    return [m, sd];
  }
  throw SEED_MSG;
}

/**
 * Seed for one game from [mean, sd]: N(mean, sd²) from `rand` (default
 * Math.random, real randomness, not a seeded stream): Math.abs(Math.round(draw)),
 * the absolute value, not a clamp at 0 (no pile-up at 0), capped at 4294967295. sd 0: exactly the mean.
 */
export function drawWindSeed([mean, sd], rand = Math.random) {
  if (!(sd > 0)) return mean;
  const u = 1 - rand(), v = rand(); // u in (0, 1]
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(MAX_SEED, Math.abs(Math.round(mean + sd * z)));
}

const TAU = 2 * Math.PI;
const fmtFreq = (hz) => r3(hz / WIND_FREQ_PER_S);

/**
 * Peak rates of realised terms ([{ target: 'dir' | 'speed', amp, freq_hz }],
 * amp in ° or a fraction of base, e.g. sampleWindSchedule(s).osc):
 * { dirDegPerS, speedFracPerS }.
 */
export function windScheduleRates(terms) {
  const r = { dirDegPerS: 0, speedFracPerS: 0 };
  for (const t of terms) r[t.target === 'speed' ? 'speedFracPerS' : 'dirDegPerS'] += TAU * Math.abs(t.amp) * t.freq_hz;
  return r;
}

const termIndex = (k) => { const m = /^term(\d+)$/.exec(k); return m ? Number(m[1]) : -1; };

// Validate one table { termN: [amp, amp_sd, freq, freq_sd] } → same, keys in index order.
function checkTable(raw, target) {
  const name = TABLES[target];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw name + ' must be a table of termN = [amp, amp_sd, freq, freq_sd]';
  const keys = Object.keys(raw);
  for (const k of keys) if (termIndex(k) < 0) throw name + '.' + k + ': unknown key (expected term0, term1, …)';
  if (keys.length > WIND_MAX_TERMS) throw name + ' has more than ' + WIND_MAX_TERMS + ' terms';
  keys.sort((a, b) => termIndex(a) - termIndex(b));
  const unit = target === 'speed' ? '% of base, or m/s when freq = 0' : '°';
  const out = {};
  for (const k of keys) {
    const n = name + '.' + k;
    const v = raw[k];
    if (!Array.isArray(v) || v.length !== 4 || !v.every(Number.isFinite)) {
      throw n + ' must be [amp, amp_sd, freq, freq_sd] (amp ' + unit + ', freq ' + WIND_FREQ_UNIT + ')';
    }
    const [a, asd, f, fsd] = v;
    if (asd < 0 || fsd < 0) throw n + ' sds must be ≥ 0';
    if (f === 0) {
      if (fsd !== 0) throw n + ': freq 0 is a constant term (no change), so freq_sd must be 0';
    } else {
      const hz = f * WIND_FREQ_PER_S;
      if (hz < WIND_MIN_FREQ_HZ || hz > WIND_MAX_FREQ_HZ) {
        throw n + ' freq must be 0 (constant) or ' + fmtFreq(WIND_MIN_FREQ_HZ) + '..' + fmtFreq(WIND_MAX_FREQ_HZ) + ' ' + WIND_FREQ_UNIT;
      }
      if (a < 0) throw n + ' amp must be ≥ 0 (' + unit + ')';
    }
    out[k] = [a, asd, f, fsd];
  }
  return out;
}

const constantKeys = (t) => Object.keys(t).filter((k) => t[k][2] === 0);
const oscKeys = (t) => Object.keys(t).filter((k) => t[k][2] !== 0);

// Rate check of the means of one table: throws naming the largest term.
function checkRate(tbl, target, scale, limit, fmt) {
  let sum = 0, big = null, bigR = -1;
  for (const k of oscKeys(tbl)) {
    const r = TAU * tbl[k][0] * scale * tbl[k][2] * WIND_FREQ_PER_S;
    sum += r;
    if (r > bigR) { bigR = r; big = k; }
  }
  if (sum > limit + 1e-12) throw TABLES[target] + '.' + big + ': ' + fmt(sum) + ' (largest term)';
}

/**
 * Validate and normalise schedule settings (missing fields take the defaults;
 * `dir` / `speed` replace the default tables as a whole). Returns
 * { schedule } or { error }. The configured means must keep the rate and
 * speed-amplitude limits (else refused); spreads only need to be ≥ 0.
 */
export function validateWindSchedule(raw = {}) {
  const d = DEFAULT_WIND_SCHEDULE;
  const pick = (k) => (raw && raw[k] !== undefined ? raw[k] : d[k]);
  try {
    const enabled = pick('enabled');
    if (typeof enabled !== 'boolean') throw 'wind_schedule must be true or false';
    const ramp = pick('ramp');
    if (typeof ramp !== 'boolean') throw 'wind_ramp must be true or false';
    // seedSpec: the configured [mean, sd]; seed: the drawn seed (default the mean).
    const hasSeed = raw && raw.seed !== undefined, hasSpec = raw && raw.seedSpec !== undefined;
    const seedSpec = parseWindSeed(hasSpec ? raw.seedSpec : hasSeed ? raw.seed : d.seedSpec);
    const seed = hasSeed ? raw.seed : hasSpec ? seedSpec[0] : d.seed;
    if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw 'wind schedule seed must be an integer 0..' + MAX_SEED;
    const s = { enabled, seed, seedSpec, ramp, dir: checkTable(pick('dir'), 'dir'), speed: checkTable(pick('speed'), 'speed') };
    let ampSum = 0, big = null;
    for (const k of oscKeys(s.speed)) { ampSum += s.speed[k][0] / 100; if (!big || s.speed[k][0] > s.speed[big][0]) big = k; }
    if (ampSum > WIND_MAX_SPEED_AMP_SUM + 1e-12) throw 'wind_speed.' + big + ': oscillating amp means must sum to ≤ ' + 100 * WIND_MAX_SPEED_AMP_SUM + ' % (largest term)';
    checkRate(s.dir, 'dir', 1, WIND_MAX_DEG_PER_S,
      (r) => 'wind_dir means turn at up to ' + r.toFixed(3) + '°/s (Σ 2πA·f); max ' + WIND_MAX_DEG_PER_S + '°/s');
    checkRate(s.speed, 'speed', 0.01, WIND_MAX_SPEED_FRAC_PER_S,
      (r) => 'wind_speed means change speed at up to ' + (100 * r).toFixed(3) + ' %/s (Σ 2πB·f); max ' + (100 * WIND_MAX_SPEED_FRAC_PER_S) + ' %/s');
    const cs = constantKeys(s.speed);
    if (cs.length) {
      const m = cs.reduce((a, k) => a + s.speed[k][0], 0);
      if (!(m >= 0)) throw 'wind_speed.' + cs[0] + ': constant terms (freq 0, m/s) must sum to ≥ 0';
    }
    return { schedule: s };
  } catch (msg) {
    return { error: typeof msg === 'string' ? msg : String(msg) };
  }
}

/**
 * Base wind from the constant (freq 0) terms of a validated spec for its
 * seed: { angle, speed }, each null when its table has no constant term
 * (then wind_angle_deg / wind_speed_mps stay the base). Terms add up; one
 * standard-normal draw per constant term (mulberry32(seed ^ BASE_SALT),
 * [wind_dir] then [wind_speed]), so an sd 0 term does not shift the others.
 * Angle wrapped to [0, 360); speed clamped at ≥ 0 (the room config also
 * applies its MAX_WIND_MPS ceiling).
 */
export function windScheduleBase(s) {
  const rng = mulberry32((s.seed ^ BASE_SALT) >>> 0);
  const sum = (tbl) => {
    const ks = constantKeys(tbl);
    if (!ks.length) return null;
    let v = 0;
    for (const k of ks) v += tbl[k][0] + tbl[k][1] * sampleNormal(0, 1, rng);
    return v;
  };
  const a = sum(s.dir), u = sum(s.speed);
  return { angle: a === null ? null : ((a % 360) + 360) % 360, speed: u === null ? null : Math.max(0, u) };
}

/**
 * Realised oscillating terms of a validated spec for its seed: { osc:
 * [{ target: 'dir' | 'speed', key, amp, freq_hz }] (amp in ° for dir, a
 * fraction of base for speed), dirScale, speedScale }. Constant terms are
 * not here (windScheduleBase). Draws are sampled [wind_dir] then
 * [wind_speed], terms in index order, amplitude then freq. If the draw
 * exceeds a rate limit (or the speed amplitude sum), every amplitude of that
 * table is multiplied by dirScale / speedScale (< 1) to sit exactly on the
 * limit. Scaling amplitudes keeps the sampled freqs and the phases, so the
 * shape of the series and which terms are fast or slow stay as drawn, and it
 * is the smallest change that meets a bound on Σ 2πA·f; clamping a freq down
 * instead would change the frequency mix and could make two terms coincide.
 */
export function sampleWindSchedule(s) {
  const rng = mulberry32((s.seed ^ SAMPLE_SALT) >>> 0);
  const osc = [];
  for (const target of ['dir', 'speed']) {
    const tbl = s[target];
    for (const k of oscKeys(tbl)) {
      const [am, asd, fm, fsd] = tbl[k];
      const a = sampleNormal(am, asd, rng);
      const f = sampleNormal(fm, fsd, rng) * WIND_FREQ_PER_S;
      osc.push({
        target, key: k,
        amp: (Number.isFinite(a) && a > 0 ? a : 0) * (target === 'speed' ? 0.01 : 1),
        freq_hz: Number.isFinite(f) ? Math.min(WIND_MAX_FREQ_HZ, Math.max(WIND_MIN_FREQ_HZ, f)) : WIND_MIN_FREQ_HZ,
      });
    }
  }
  const r = { osc, dirScale: 1, speedScale: 1 };
  const rates = windScheduleRates(osc);
  if (rates.dirDegPerS > WIND_MAX_DEG_PER_S) r.dirScale = WIND_MAX_DEG_PER_S / rates.dirDegPerS;
  const ampSum = osc.reduce((a, t) => a + (t.target === 'speed' ? t.amp : 0), 0);
  r.speedScale = Math.min(1,
    rates.speedFracPerS > WIND_MAX_SPEED_FRAC_PER_S ? WIND_MAX_SPEED_FRAC_PER_S / rates.speedFracPerS : 1,
    ampSum > WIND_MAX_SPEED_AMP_SUM ? WIND_MAX_SPEED_AMP_SUM / ampSum : 1);
  for (const t of osc) t.amp *= t.target === 'speed' ? r.speedScale : r.dirScale;
  return r;
}

/** Phases (radians), one uniform per oscillating term ([wind_dir] then [wind_speed]) from mulberry32(seed). */
export function windSchedulePhases(s) {
  const rng = mulberry32(s.seed);
  return [...oscKeys(s.dir), ...oscKeys(s.speed)].map(() => TAU * rng());
}

// One term A (sin(2π f t + φ) − sin φ): exactly 0 at t = 0.
const term = (a, f, ph, t) => a * (Math.sin(TAU * f * t + ph) - Math.sin(ph));

// Offset of realised terms (sampleWindSchedule(s).osc) at time t (s): { dirDeg,
// speedFactor }. dirDeg adds to the base angle, speedFactor multiplies the
// base speed. At t = 0: dirDeg 0, speedFactor 1, for every seed.
export function windScheduleOffset(terms, t, phases) {
  let dir = 0, f = 1;
  terms.forEach((c, i) => {
    const v = term(c.amp, c.freq_hz, phases[i], t);
    if (c.target === 'speed') f += v; else dir += v;
  });
  return { dirDeg: dir, speedFactor: f };
}

/** Realised oscillating terms and phases of a validated spec: { terms, phases, dirScale, speedScale }. */
export function realiseWindSchedule(s) {
  const r = sampleWindSchedule(s);
  return { terms: r.osc, phases: windSchedulePhases(s), dirScale: r.dirScale, speedScale: r.speedScale };
}

/** Spec without its constant terms (what the Sim runs; the base is separate). */
export function windScheduleOscillation(s) {
  const only = (t) => Object.fromEntries(oscKeys(t).map((k) => [k, t[k]]));
  return { ...s, dir: only(s.dir), speed: only(s.speed) };
}

/** Shortest signed angle a → b in degrees, in (-180, 180]. */
export function angleDiffDeg(a, b) {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

/**
 * One slew step of the applied wind toward the target: direction at most
 * maxDeg, speed at most maxMps. Returns { angle, speed, done } with angle in
 * [0, 360).
 */
export function windSlew(cur, target, maxDeg, maxMps) {
  const dd = angleDiffDeg(cur.angle, target.angle);
  const ds = target.speed - cur.speed;
  const stepD = Math.max(-maxDeg, Math.min(maxDeg, dd));
  const stepS = Math.max(-maxMps, Math.min(maxMps, ds));
  const angle = (((cur.angle + stepD) % 360) + 360) % 360;
  return { angle, speed: cur.speed + stepS, done: Math.abs(dd - stepD) < 1e-9 && Math.abs(ds - stepS) < 1e-9 };
}

const copyTable = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, [...v]]));

/** Plain-data copy of a validated spec (SimCore.settings.windSchedule, TOML shape per table). */
export function windScheduleSettings(s) {
  return { enabled: s.enabled, seed: s.seed, seedSpec: [...s.seedSpec], ramp: s.ramp, dir: copyTable(s.dir), speed: copyTable(s.speed) };
}

export function defaultWindScheduleSettings() {
  return windScheduleSettings(DEFAULT_WIND_SCHEDULE);
}
