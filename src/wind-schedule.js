// Base-wind schedule: a slow, seeded, deterministic oscillation of the
// boundary wind (Boltzmann setBoundaries) and of ConstantWind in dev mode.
//
//   θ(t) = θ0 + Σ_i A_i sin(2π t / T_i + φ_i) + A_tr sin(2π t / T_tr + φ_tr)
//   U(t) = U0 · (1 + Σ_j B_j sin(2π t / P_j + ψ_j) + B_tr sin(2π t / P_tr + ψ_tr))
//
// θ0 / U0 are the configured base wind (room config wind_angle_deg /
// wind_speed_mps, the `wind` command). The "trend" is one more sine with a
// period much longer than a race (default 60 min), so over a 5-10 minute race
// it reads as a steady veer or back of up to ~1°/min. No noise term.
// Phases come from mulberry32(seed) (gusts.js), so one seed always gives the
// same wind on every host.
//
// The field cannot follow an instant change cleanly: a step rings for 30-60 s
// (fixed-equilibrium edges, vortex sheets advected out at wind speed). So the
// schedule's own turning rate Σ 2πA/T is limited to WIND_MAX_DEG_PER_S and its
// relative speed rate Σ 2πB/P to WIND_MAX_SPEED_FRAC_PER_S, and the applied wind
// slews toward the target (windSlew) at those limits, which also ramps the jump
// when the schedule is switched on or off and, with wind_ramp, manual changes.
// No DOM: runs in the Sim on the server, worker and tests.
import { mulberry32 } from './gusts.js';

// Max direction rate of the schedule and of the slew (°/s).
export const WIND_MAX_DEG_PER_S = 0.5;
// Max relative speed rate of the schedule (fraction of base per s): 0.5 %/s.
export const WIND_MAX_SPEED_FRAC_PER_S = 0.005;
// Slew rate for speed changes (manual `wind` speed, schedule on/off), m/s per s.
export const WIND_SLEW_SPEED_MPS_PER_S = 0.1;
// Sum of speed amplitudes stays well below 1 so U never reaches 0.
export const WIND_MAX_SPEED_AMP_SUM = 0.5;
export const WIND_MAX_TERMS = 6;
export const WIND_MIN_PERIOD_S = 10;

// Defaults (room config wind_*). Direction periods 6 / 9.5 / 14 min are
// incommensurate; amplitudes 6° / 3° / 2° give a ±11° oscillation envelope.
// Trend: 10° over a 60 min period, slope up to 2π·10/3600 = 0.017°/s = 1.05°/min,
// i.e. a monotonic-looking 0-10° drift over a 10 min race depending on phase.
// Speed: ±7 % (7 min) and ±4 % (11.5 min) plus a ±4 % 45 min trend: ±15 % max.
// Rates: direction 0.17°/s, speed 0.15 %/s, both under the limits above.
export const DEFAULT_WIND_SCHEDULE = Object.freeze({
  enabled: false,
  seed: 1,
  dirOsc: Object.freeze([Object.freeze([6, 360]), Object.freeze([3, 570]), Object.freeze([2, 840])]),
  dirTrend: Object.freeze([10, 3600]),
  speedOsc: Object.freeze([Object.freeze([0.07, 420]), Object.freeze([0.04, 690])]),
  speedTrend: Object.freeze([0.04, 2700]),
  ramp: false,
});

const TAU = 2 * Math.PI;

function termsRate(terms) {
  let r = 0;
  for (const [a, p] of terms) r += TAU * Math.abs(a) / p;
  return r;
}

/** Peak rates of a (validated) schedule: { dirDegPerS, speedFracPerS }. */
export function windScheduleRates(s) {
  return {
    dirDegPerS: termsRate([...s.dirOsc, s.dirTrend]),
    speedFracPerS: termsRate([...s.speedOsc, s.speedTrend]),
  };
}

function checkTerm(t, name) {
  if (!Array.isArray(t) || t.length !== 2 || !Number.isFinite(t[0]) || !Number.isFinite(t[1])) {
    throw name + ' must be [amplitude, period_s]';
  }
  if (t[0] < 0) throw name + ' amplitude must be ≥ 0';
  if (t[1] < WIND_MIN_PERIOD_S) throw name + ' period must be ≥ ' + WIND_MIN_PERIOD_S + ' s';
  return [t[0], t[1]];
}

function checkTerms(list, name) {
  if (!Array.isArray(list)) throw name + ' must be a list of [amplitude, period_s]';
  if (list.length > WIND_MAX_TERMS) throw name + ' has more than ' + WIND_MAX_TERMS + ' terms';
  return list.map((t, i) => checkTerm(t, name + '[' + i + ']'));
}

/**
 * Validate and normalise schedule settings (missing fields take the defaults).
 * Returns { schedule } or { error }. A schedule whose peak direction or speed
 * rate exceeds the limits is rejected, not clamped.
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
      dirOsc: checkTerms(pick('dirOsc'), 'wind_dir_osc'),
      dirTrend: checkTerm(pick('dirTrend'), 'wind_dir_trend'),
      speedOsc: checkTerms(pick('speedOsc'), 'wind_speed_osc'),
      speedTrend: checkTerm(pick('speedTrend'), 'wind_speed_trend'),
    };
    const ampSum = [...s.speedOsc, s.speedTrend].reduce((a, t) => a + t[0], 0);
    if (ampSum > WIND_MAX_SPEED_AMP_SUM) throw 'wind_speed_osc + wind_speed_trend amplitudes must sum to ≤ ' + WIND_MAX_SPEED_AMP_SUM;
    const r = windScheduleRates(s);
    if (r.dirDegPerS > WIND_MAX_DEG_PER_S + 1e-12) {
      throw 'wind_dir_osc + wind_dir_trend turn at up to ' + r.dirDegPerS.toFixed(3) + '°/s (Σ 2πA/T); max ' + WIND_MAX_DEG_PER_S + '°/s';
    }
    if (r.speedFracPerS > WIND_MAX_SPEED_FRAC_PER_S + 1e-12) {
      throw 'wind_speed_osc + wind_speed_trend change speed at up to ' + (100 * r.speedFracPerS).toFixed(3) + ' %/s (Σ 2πB/P); max ' + (100 * WIND_MAX_SPEED_FRAC_PER_S) + ' %/s';
    }
    return { schedule: s };
  } catch (msg) {
    return { error: typeof msg === 'string' ? msg : String(msg) };
  }
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

// Offset of a validated schedule at time t (s): { dirDeg, speedFactor }.
// dirDeg adds to the base angle, speedFactor multiplies the base speed.
export function windScheduleOffset(s, t, phases = windSchedulePhases(s)) {
  let dir = 0;
  s.dirOsc.forEach(([a, p], i) => { dir += a * Math.sin(TAU * t / p + phases.dirOsc[i]); });
  dir += s.dirTrend[0] * Math.sin(TAU * t / s.dirTrend[1] + phases.dirTrend);
  let f = 1;
  s.speedOsc.forEach(([b, p], i) => { f += b * Math.sin(TAU * t / p + phases.speedOsc[i]); });
  f += s.speedTrend[0] * Math.sin(TAU * t / s.speedTrend[1] + phases.speedTrend);
  return { dirDeg: dir, speedFactor: f };
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

/** Plain-data copy of validated settings (SimCore.settings.windSchedule). */
export function windScheduleSettings(s) {
  return {
    enabled: s.enabled, seed: s.seed, ramp: s.ramp,
    dirOsc: s.dirOsc.map((t) => [...t]), dirTrend: [...s.dirTrend],
    speedOsc: s.speedOsc.map((t) => [...t]), speedTrend: [...s.speedTrend],
  };
}

export function defaultWindScheduleSettings() {
  return windScheduleSettings(DEFAULT_WIND_SCHEDULE);
}
