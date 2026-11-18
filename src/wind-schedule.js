// Base-wind schedule: a slow, seeded, deterministic oscillation of the
// boundary wind (Boltzmann setBoundaries) and of ConstantWind in dev mode.
//
//   θ(t) = θ0 + Σ_i A_i (sin(2π t / T_i + φ_i) − sin φ_i) + A_tr (sin(2π t / T_tr + φ_tr) − sin φ_tr)
//   U(t) = U0 · (1 + Σ_j B_j (sin(2π t / P_j + ψ_j) − sin ψ_j) + B_tr (sin(2π t / P_tr + ψ_tr) − sin ψ_tr))
//
// θ0 / U0 are the configured base wind (room config wind_angle_deg /
// wind_speed_mps, the `wind` command). The "trend" is one more sine with a
// period much longer than a race (default 60 min), so over a 5-10 minute race
// it reads as a steady veer or back of up to ~1°/min. No noise term.
//
// Every component is configured as a mean and a spread, like the gust knobs
// (gusts.js / room config `gust_* = [mean, sd]`): amp_deg (direction) or
// amp_pct (speed, % of base) and period_s, each [mean, sd]. When the schedule
// is configured, each component draws its amplitude and period once from
// N(mean, sd²) (gusts.js sampleNormal, amplitude clamped at 0 as gusts clamp
// their knobs, period clamped to ≥ WIND_MIN_PERIOD_S) and its phase uniformly,
// all from wind_schedule_seed: one seed is one wind, on every host.
// Phases use mulberry32(seed); amplitudes and periods a second stream
// mulberry32(seed ^ SAMPLE_SALT), so phases do not depend on the spreads.
//
// Every term has its value at t = 0 subtracted, so the wind starts exactly on
// the base (offset 0°, factor 1) for any seed and switching the schedule on
// needs no catch-up. The seeded phase still sets each term's starting slope
// and its derivative (so the rate limit) is unchanged. The cost: term i's mean
// moves by −A_i sin φ_i, so it ranges over [−A_i(1 + sin φ_i), A_i(1 − sin φ_i)],
// up to 2·A_i to one side.
//
// The field cannot follow an instant change cleanly: a step rings for 30-60 s
// (fixed-equilibrium edges, vortex sheets advected out at wind speed). So the
// schedule's turning rate Σ 2πA/T is limited to WIND_MAX_DEG_PER_S and its
// relative speed rate Σ 2πB/P to WIND_MAX_SPEED_FRAC_PER_S. The configured
// means must satisfy the limits (else the config is refused); a random draw
// that exceeds one has all its amplitudes of that kind scaled down to the
// limit (periods and phases kept), see sampleWindSchedule. The applied wind
// also slews toward the target (windSlew) at the limits, which ramps the
// return to the base when the schedule is switched off (or re-seeded mid-run)
// and, with wind_ramp, manual changes.
// No DOM: runs in the Sim on the server, worker and tests.
import { mulberry32, sampleNormal } from './gusts.js';

// Max direction rate of the schedule and of the slew (°/s).
export const WIND_MAX_DEG_PER_S = 0.5;
// Max relative speed rate of the schedule (fraction of base per s): 0.5 %/s.
export const WIND_MAX_SPEED_FRAC_PER_S = 0.005;
// Slew rate for speed changes (manual `wind` speed, schedule on/off), m/s per s.
export const WIND_SLEW_SPEED_MPS_PER_S = 0.1;
// Sum of sampled speed amplitudes (fraction): a term can reach 2·B below the
// base (see above), so 2 · 0.4 keeps U ≥ 0.2 · U0. Draws over it are scaled.
export const WIND_MAX_SPEED_AMP_SUM = 0.4;
export const WIND_MAX_TERMS = 6;
export const WIND_MIN_PERIOD_S = 10;
const SAMPLE_SALT = 0x9E3779B9;

// Defaults (room config wind_*), each [mean, sd]. Direction periods 6 / 9.5 /
// 14 min are incommensurate; amplitudes 6° / 3° / 2°. Trend: 10° over 60 min,
// slope up to 2π·10/3600 = 0.017°/s = 1.05°/min, a monotonic-looking 0-10°
// drift over a 10 min race depending on phase. Speed: 7 % (7 min), 4 % (11.5 min)
// and a 4 % 45 min trend. Spreads: amplitude sd 30 % of the mean (seeds differ
// visibly; a draw below 0 is 3.3 sd away, ~0.05 %, and clamps to 0), period sd
// 20 % (1 sd keeps the 6 / 9.5 / 14 min terms in order and distinct, and the
// trend period above ~36 min at 2 sd so it still reads as a trend).
// Rates at the means: direction 0.17°/s, speed 0.15 %/s; a draw rarely reaches
// the limits (both need several 3-sd draws at once), see sampleWindSchedule.
const comp = (ampKey, a, p) => Object.freeze({
  [ampKey]: Object.freeze([a, +(0.3 * a).toFixed(6)]),
  period_s: Object.freeze([p, +(0.2 * p).toFixed(6)]),
});
export const DEFAULT_WIND_SCHEDULE = Object.freeze({
  enabled: false,
  seed: 1,
  dirOsc: Object.freeze([comp('amp_deg', 6, 360), comp('amp_deg', 3, 570), comp('amp_deg', 2, 840)]),
  dirTrend: comp('amp_deg', 10, 3600),
  speedOsc: Object.freeze([comp('amp_pct', 7, 420), comp('amp_pct', 4, 690)]),
  speedTrend: comp('amp_pct', 4, 2700),
  ramp: false,
});

const TAU = 2 * Math.PI;

function termsRate(terms) {
  let r = 0;
  for (const [a, p] of terms) r += TAU * Math.abs(a) / p;
  return r;
}

/**
 * Peak rates of realised terms ({ dirOsc: [[A°, T]], dirTrend, speedOsc:
 * [[B, P]], speedTrend }, e.g. sampleWindSchedule): { dirDegPerS, speedFracPerS }.
 */
export function windScheduleRates(r) {
  return {
    dirDegPerS: termsRate([...r.dirOsc, r.dirTrend]),
    speedFracPerS: termsRate([...r.speedOsc, r.speedTrend]),
  };
}

// number | [mean] | [mean, sd] → [mean, sd] (the gust convention, room-config parseMeanSd).
function meanSd(raw, name) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return [raw, 0];
  if (Array.isArray(raw) && (raw.length === 1 || raw.length === 2)) {
    const m = raw[0], sd = raw.length === 2 ? raw[1] : 0;
    if (!Number.isFinite(m)) throw name + ' mean must be a number';
    if (!Number.isFinite(sd) || sd < 0) throw name + ' sd must be a number ≥ 0';
    return [m, sd];
  }
  throw name + ' must be a number or [mean, sd]';
}

function checkComp(c, ampKey, name) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw name + ' must be a table { ' + ampKey + ' = [mean, sd], period_s = [mean, sd] }';
  const extra = Object.keys(c).filter((k) => k !== ampKey && k !== 'period_s');
  if (extra.length) throw 'unknown key(s) in ' + name + ': ' + extra.join(', ');
  if (c[ampKey] === undefined || c.period_s === undefined) throw name + ' needs ' + ampKey + ' and period_s';
  const amp = meanSd(c[ampKey], name + '.' + ampKey);
  const per = meanSd(c.period_s, name + '.period_s');
  if (amp[0] < 0) throw name + '.' + ampKey + ' mean must be ≥ 0';
  if (per[0] < WIND_MIN_PERIOD_S) throw name + '.period_s mean must be ≥ ' + WIND_MIN_PERIOD_S + ' s';
  return { [ampKey]: amp, period_s: per };
}

function checkComps(list, ampKey, name) {
  if (!Array.isArray(list)) throw name + ' must be a list of { ' + ampKey + ', period_s } tables';
  if (list.length > WIND_MAX_TERMS) throw name + ' has more than ' + WIND_MAX_TERMS + ' terms';
  return list.map((c, i) => checkComp(c, ampKey, name + '[' + i + ']'));
}

// Mean terms of a validated spec, in realised units (°, fraction).
function meanTerms(s) {
  return {
    dirOsc: s.dirOsc.map((c) => [c.amp_deg[0], c.period_s[0]]),
    dirTrend: [s.dirTrend.amp_deg[0], s.dirTrend.period_s[0]],
    speedOsc: s.speedOsc.map((c) => [c.amp_pct[0] / 100, c.period_s[0]]),
    speedTrend: [s.speedTrend.amp_pct[0] / 100, s.speedTrend.period_s[0]],
  };
}

/**
 * Validate and normalise schedule settings (missing fields take the defaults).
 * Returns { schedule } or { error }. The configured means must keep the rate
 * and speed-amplitude limits (else refused); spreads only need to be ≥ 0.
 */
export function validateWindSchedule(raw = {}) {
  const d = DEFAULT_WIND_SCHEDULE;
  const pick = (k) => (raw && raw[k] !== undefined ? raw[k] : d[k]);
  try {
    const enabled = pick('enabled');
    if (typeof enabled !== 'boolean') throw 'wind_schedule must be true or false';
    const ramp = pick('ramp');
    if (typeof ramp !== 'boolean') throw 'wind_ramp must be true or false';
    const seed = pick('seed');
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) throw 'wind_schedule_seed must be an integer 0..4294967295';
    const s = {
      enabled, seed, ramp,
      dirOsc: checkComps(pick('dirOsc'), 'amp_deg', 'wind_dir_osc'),
      dirTrend: checkComp(pick('dirTrend'), 'amp_deg', 'wind_dir_trend'),
      speedOsc: checkComps(pick('speedOsc'), 'amp_pct', 'wind_speed_osc'),
      speedTrend: checkComp(pick('speedTrend'), 'amp_pct', 'wind_speed_trend'),
    };
    const m = meanTerms(s);
    const ampSum = [...m.speedOsc, m.speedTrend].reduce((a, t) => a + t[0], 0);
    if (ampSum > WIND_MAX_SPEED_AMP_SUM + 1e-12) throw 'wind_speed_osc + wind_speed_trend amp_pct means must sum to ≤ ' + 100 * WIND_MAX_SPEED_AMP_SUM;
    const r = windScheduleRates(m);
    if (r.dirDegPerS > WIND_MAX_DEG_PER_S + 1e-12) {
      throw 'wind_dir_osc + wind_dir_trend means turn at up to ' + r.dirDegPerS.toFixed(3) + '°/s (Σ 2πA/T); max ' + WIND_MAX_DEG_PER_S + '°/s';
    }
    if (r.speedFracPerS > WIND_MAX_SPEED_FRAC_PER_S + 1e-12) {
      throw 'wind_speed_osc + wind_speed_trend means change speed at up to ' + (100 * r.speedFracPerS).toFixed(3) + ' %/s (Σ 2πB/P); max ' + (100 * WIND_MAX_SPEED_FRAC_PER_S) + ' %/s';
    }
    return { schedule: s };
  } catch (msg) {
    return { error: typeof msg === 'string' ? msg : String(msg) };
  }
}

/**
 * Realised terms of a validated spec for its seed: { dirOsc: [[A°, T s]],
 * dirTrend, speedOsc: [[B, P s]] (B a fraction of base), speedTrend, dirScale,
 * speedScale }. Draws are sampled in order dirOsc…, dirTrend, speedOsc…,
 * speedTrend, amplitude then period. If the draw exceeds a rate limit (or the
 * speed amplitude sum), every amplitude of that kind is multiplied by
 * dirScale / speedScale (< 1) to sit exactly on the limit. Scaling amplitudes
 * keeps the sampled periods and the phases, so the shape of the series and
 * which terms are fast or slow stay as drawn, and it is the smallest change
 * that meets a bound on Σ 2πA/T; clamping a period up instead would change
 * the frequency mix and could make two terms coincide.
 */
export function sampleWindSchedule(s) {
  const rng = mulberry32((s.seed ^ SAMPLE_SALT) >>> 0);
  const draw = (c, ampKey, unit) => {
    const a = sampleNormal(c[ampKey][0], c[ampKey][1], rng);
    const p = sampleNormal(c.period_s[0], c.period_s[1], rng);
    return [(Number.isFinite(a) && a > 0 ? a : 0) * unit, Number.isFinite(p) ? Math.max(WIND_MIN_PERIOD_S, p) : WIND_MIN_PERIOD_S];
  };
  const r = {
    dirOsc: s.dirOsc.map((c) => draw(c, 'amp_deg', 1)),
    dirTrend: draw(s.dirTrend, 'amp_deg', 1),
    speedOsc: s.speedOsc.map((c) => draw(c, 'amp_pct', 0.01)),
    speedTrend: draw(s.speedTrend, 'amp_pct', 0.01),
    dirScale: 1, speedScale: 1,
  };
  const rates = windScheduleRates(r);
  if (rates.dirDegPerS > WIND_MAX_DEG_PER_S) r.dirScale = WIND_MAX_DEG_PER_S / rates.dirDegPerS;
  const ampSum = [...r.speedOsc, r.speedTrend].reduce((a, t) => a + t[0], 0);
  r.speedScale = Math.min(1,
    rates.speedFracPerS > WIND_MAX_SPEED_FRAC_PER_S ? WIND_MAX_SPEED_FRAC_PER_S / rates.speedFracPerS : 1,
    ampSum > WIND_MAX_SPEED_AMP_SUM ? WIND_MAX_SPEED_AMP_SUM / ampSum : 1);
  if (r.dirScale < 1) { for (const t of [...r.dirOsc, r.dirTrend]) t[0] *= r.dirScale; }
  if (r.speedScale < 1) { for (const t of [...r.speedOsc, r.speedTrend]) t[0] *= r.speedScale; }
  return r;
}

/** Seeded phases (radians) in term order: dirOsc, dirTrend, speedOsc, speedTrend. */
export function windSchedulePhases(s) {
  const rng = mulberry32(s.seed);
  const ph = () => TAU * rng();
  return {
    dirOsc: s.dirOsc.map(ph),
    dirTrend: ph(),
    speedOsc: s.speedOsc.map(ph),
    speedTrend: ph(),
  };
}

// One term A (sin(2πt/T + φ) − sin φ): exactly 0 at t = 0.
const term = (a, p, ph, t) => a * (Math.sin(TAU * t / p + ph) - Math.sin(ph));

// Offset of realised terms r (sampleWindSchedule) at time t (s): { dirDeg,
// speedFactor }. dirDeg adds to the base angle, speedFactor multiplies the
// base speed. At t = 0: dirDeg 0, speedFactor 1, for every seed.
export function windScheduleOffset(r, t, phases) {
  let dir = 0;
  r.dirOsc.forEach(([a, p], i) => { dir += term(a, p, phases.dirOsc[i], t); });
  dir += term(r.dirTrend[0], r.dirTrend[1], phases.dirTrend, t);
  let f = 1;
  r.speedOsc.forEach(([b, p], i) => { f += term(b, p, phases.speedOsc[i], t); });
  f += term(r.speedTrend[0], r.speedTrend[1], phases.speedTrend, t);
  return { dirDeg: dir, speedFactor: f };
}

/** Realised terms and phases of a validated spec: { terms, phases }. */
export function realiseWindSchedule(s) {
  return { terms: sampleWindSchedule(s), phases: windSchedulePhases(s) };
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

const copyComp = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, [...v]]));

/** Plain-data copy of a validated spec (SimCore.settings.windSchedule, TOML shape per component). */
export function windScheduleSettings(s) {
  return {
    enabled: s.enabled, seed: s.seed, ramp: s.ramp,
    dirOsc: s.dirOsc.map(copyComp), dirTrend: copyComp(s.dirTrend),
    speedOsc: s.speedOsc.map(copyComp), speedTrend: copyComp(s.speedTrend),
  };
}

export function defaultWindScheduleSettings() {
  return windScheduleSettings(DEFAULT_WIND_SCHEDULE);
}
