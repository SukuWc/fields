// Base-wind schedule: a slow, seeded, deterministic oscillation of the
// boundary wind (Boltzmann setBoundaries) and of ConstantWind in dev mode.
//
//   θ(t) = θ0 + Σ_{direction entries} A_i (sin(2π t / T_i + φ_i) − sin φ_i)
//   U(t) = U0 · (1 + Σ_{speed entries} B_j (sin(2π t / P_j + φ_j) − sin φ_j))
//
// θ0 / U0 are the configured base wind (room config wind_angle_deg /
// wind_speed_mps, the `wind` command). No noise term.
//
// The components are one list (room config [[wind_osc]]): one entry is one
// sine with all of its parameters and their distribution:
//   target   = "direction" | "speed"
//   amp      = [mean, sd]  degrees for direction, % of the base speed for speed
//   period_s = [mean, sd]  seconds
//   phase_deg = [mean, sd] optional; absent → uniform 0..360° from the seed
// Values take the gust convention (gusts.js / room config gust_*): a number,
// [mean] or [mean, sd], sd ≥ 0. One `amp` key whose unit follows `target`
// keeps every entry the same shape (switching target is a one-word edit, and
// there is no amp_deg-on-a-speed-entry error to explain). A "trend" is not
// special: it is an entry with a period much longer than a race (default 60
// min, which reads as a steady veer or back of up to ~1°/min over 5-10 min).
// Positive direction offsets increase the sim wind angle (compass: backing).
//
// When the schedule is configured, each entry draws, in list order, its
// amplitude then its period once from N(mean, sd²) (gusts.js sampleNormal;
// amplitude clamped at 0 as gusts clamp their knobs, period at ≥
// WIND_MIN_PERIOD_S) from mulberry32(seed ^ SAMPLE_SALT). Phases come from a
// separate stream, mulberry32(seed): one uniform per entry in list order,
// drawn even when the entry sets phase_deg, so pinning one phase does not
// move the others. A phase_deg with sd > 0 draws from a third stream,
// mulberry32(seed ^ PHASE_SALT). One seed is one wind, on every host.
//
// Every term has its value at t = 0 subtracted, so the wind starts exactly on
// the base (offset 0°, factor 1) for any seed and switching the schedule on
// needs no catch-up. The phase still sets each term's starting slope
// (phase_deg 0: rising at its steepest; 90: at its crest, so it only falls)
// and its derivative (so the rate limit) is unchanged. The cost: term i's mean
// moves by −A_i sin φ_i, so it ranges over [−A_i(1 + sin φ_i), A_i(1 − sin φ_i)],
// up to 2·A_i to one side.
//
// The field cannot follow an instant change cleanly: a step rings for 30-60 s
// (fixed-equilibrium edges, vortex sheets advected out at wind speed). So per
// target the turning rate Σ 2πA/T is limited to WIND_MAX_DEG_PER_S and the
// relative speed rate Σ 2πB/P to WIND_MAX_SPEED_FRAC_PER_S. The configured
// means must satisfy the limits (else the config is refused); a random draw
// that exceeds one has all amplitudes of that target scaled down to the limit
// (periods and phases kept), see sampleWindSchedule. The applied wind also
// slews toward the target (windSlew) at the limits, which ramps the return to
// the base when the schedule is switched off (or re-seeded mid-run) and, with
// wind_ramp, manual changes.
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
// Max [[wind_osc]] entries (both targets together).
export const WIND_MAX_TERMS = 12;
export const WIND_MIN_PERIOD_S = 10;
export const WIND_TARGETS = Object.freeze(['direction', 'speed']);
const SAMPLE_SALT = 0x9E3779B9;
const PHASE_SALT = 0x85EBCA6B;
const ENTRY_KEYS = ['target', 'amp', 'period_s', 'phase_deg'];

// Defaults (room config [[wind_osc]]), each [mean, sd]. Direction periods 6 /
// 9.5 / 14 min are incommensurate; amplitudes 6° / 3° / 2°, plus the trend:
// 10° over 60 min, slope up to 2π·10/3600 = 0.017°/s = 1.05°/min, a
// monotonic-looking 0-10° drift over a 10 min race depending on phase. Speed:
// 7 % (7 min), 4 % (11.5 min) and a 4 % 45 min trend. Spreads: amplitude sd
// 30 % of the mean (seeds differ visibly; a draw below 0 is 3.3 sd away,
// ~0.05 %, and clamps to 0), period sd 20 % (1 sd keeps the 6 / 9.5 / 14 min
// terms in order and distinct, and the trend period above ~36 min at 2 sd so
// it still reads as a trend). Phases uniform from the seed.
// Rates at the means: direction 0.17°/s, speed 0.15 %/s; a draw rarely reaches
// the limits (both need several 3-sd draws at once), see sampleWindSchedule.
const osc = (target, a, p) => Object.freeze({
  target,
  amp: Object.freeze([a, +(0.3 * a).toFixed(6)]),
  period_s: Object.freeze([p, +(0.2 * p).toFixed(6)]),
});
export const DEFAULT_WIND_SCHEDULE = Object.freeze({
  enabled: false,
  seed: 1,
  osc: Object.freeze([
    osc('direction', 6, 360), osc('direction', 3, 570), osc('direction', 2, 840),
    osc('direction', 10, 3600), // trend
    osc('speed', 7, 420), osc('speed', 4, 690),
    osc('speed', 4, 2700), // trend
  ]),
  ramp: false,
});

const TAU = 2 * Math.PI;
const unitOf = (target) => (target === 'speed' ? 0.01 : 1); // amp → realised (°, fraction)

/**
 * Peak rates of realised terms ([{ target, amp, period_s }], amp in ° or a
 * fraction of base, e.g. sampleWindSchedule(s).osc): { dirDegPerS, speedFracPerS }.
 */
export function windScheduleRates(terms) {
  const r = { dirDegPerS: 0, speedFracPerS: 0 };
  for (const t of terms) r[t.target === 'speed' ? 'speedFracPerS' : 'dirDegPerS'] += TAU * Math.abs(t.amp) / t.period_s;
  return r;
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

function checkEntry(c, name) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw name + ' must be a table { target, amp = [mean, sd], period_s = [mean, sd] }';
  const extra = Object.keys(c).filter((k) => !ENTRY_KEYS.includes(k));
  if (extra.length) throw 'unknown key(s) in ' + name + ': ' + extra.join(', ') + ' (allowed: ' + ENTRY_KEYS.join(', ') + ')';
  if (!WIND_TARGETS.includes(c.target)) throw name + '.target must be "direction" or "speed"';
  if (c.amp === undefined || c.period_s === undefined) throw name + ' needs amp and period_s';
  const unit = c.target === 'speed' ? '% of base speed' : '°';
  const amp = meanSd(c.amp, name + '.amp (' + unit + ')');
  const per = meanSd(c.period_s, name + '.period_s');
  if (amp[0] < 0) throw name + '.amp (' + unit + ') mean must be ≥ 0';
  if (per[0] < WIND_MIN_PERIOD_S) throw name + '.period_s mean must be ≥ ' + WIND_MIN_PERIOD_S + ' s';
  const out = { target: c.target, amp, period_s: per };
  if (c.phase_deg !== undefined) out.phase_deg = meanSd(c.phase_deg, name + '.phase_deg');
  return out;
}

// Rate check of the means of one target: throws naming the largest contributor.
function checkRate(s, target, limit, fmt) {
  let sum = 0, big = -1, bigR = -1;
  s.osc.forEach((c, i) => {
    if (c.target !== target) return;
    const r = TAU * c.amp[0] * unitOf(target) / c.period_s[0];
    sum += r;
    if (r > bigR) { bigR = r; big = i; }
  });
  if (sum > limit + 1e-12) throw fmt(sum) + ', largest wind_osc[' + big + ']';
}

/**
 * Validate and normalise schedule settings (missing fields take the defaults;
 * `osc` replaces the default list as a whole). Returns { schedule } or
 * { error }. The configured means must keep the rate and speed-amplitude
 * limits (else refused); spreads only need to be ≥ 0.
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
    const list = pick('osc');
    if (!Array.isArray(list)) throw 'wind_osc must be a list of [[wind_osc]] tables';
    if (list.length > WIND_MAX_TERMS) throw 'wind_osc has more than ' + WIND_MAX_TERMS + ' entries';
    const s = { enabled, seed, ramp, osc: list.map((c, i) => checkEntry(c, 'wind_osc[' + i + ']')) };
    let ampSum = 0, big = -1;
    s.osc.forEach((c, i) => { if (c.target === 'speed') { ampSum += c.amp[0] / 100; if (big < 0 || c.amp[0] > s.osc[big].amp[0]) big = i; } });
    if (ampSum > WIND_MAX_SPEED_AMP_SUM + 1e-12) throw 'wind_osc speed amp means must sum to ≤ ' + 100 * WIND_MAX_SPEED_AMP_SUM + ' %, largest wind_osc[' + big + ']';
    checkRate(s, 'direction', WIND_MAX_DEG_PER_S,
      (r) => 'wind_osc direction means turn at up to ' + r.toFixed(3) + '°/s (Σ 2πA/T); max ' + WIND_MAX_DEG_PER_S + '°/s');
    checkRate(s, 'speed', WIND_MAX_SPEED_FRAC_PER_S,
      (r) => 'wind_osc speed means change speed at up to ' + (100 * r).toFixed(3) + ' %/s (Σ 2πB/P); max ' + (100 * WIND_MAX_SPEED_FRAC_PER_S) + ' %/s');
    return { schedule: s };
  } catch (msg) {
    return { error: typeof msg === 'string' ? msg : String(msg) };
  }
}

/**
 * Realised terms of a validated spec for its seed: { osc: [{ target, amp,
 * period_s }] (amp in ° for direction, a fraction of base for speed),
 * dirScale, speedScale }. Draws are sampled in list order, amplitude then
 * period. If the draw exceeds a target's rate limit (or the speed amplitude
 * sum), every amplitude of that target is multiplied by dirScale / speedScale
 * (< 1) to sit exactly on the limit. Scaling amplitudes keeps the sampled
 * periods and the phases, so the shape of the series and which terms are
 * fast or slow stay as drawn, and it is the smallest change that meets a
 * bound on Σ 2πA/T; clamping a period up instead would change the frequency
 * mix and could make two terms coincide.
 */
export function sampleWindSchedule(s) {
  const rng = mulberry32((s.seed ^ SAMPLE_SALT) >>> 0);
  const osc = s.osc.map((c) => {
    const a = sampleNormal(c.amp[0], c.amp[1], rng);
    const p = sampleNormal(c.period_s[0], c.period_s[1], rng);
    return {
      target: c.target,
      amp: (Number.isFinite(a) && a > 0 ? a : 0) * unitOf(c.target),
      period_s: Number.isFinite(p) ? Math.max(WIND_MIN_PERIOD_S, p) : WIND_MIN_PERIOD_S,
    };
  });
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

/**
 * Phases (radians), one per entry in list order. mulberry32(seed) gives one
 * uniform per entry, always drawn; an entry with phase_deg uses it instead
 * (sd > 0: N(mean, sd²) from mulberry32(seed ^ PHASE_SALT)).
 */
export function windSchedulePhases(s) {
  const rng = mulberry32(s.seed);
  const prng = mulberry32((s.seed ^ PHASE_SALT) >>> 0);
  return s.osc.map((c) => {
    const u = TAU * rng();
    if (!c.phase_deg) return u;
    const [m, sd] = c.phase_deg;
    const deg = sd > 0 ? sampleNormal(m, sd, prng) : m;
    return (Number.isFinite(deg) ? deg : m) * Math.PI / 180;
  });
}

// One term A (sin(2πt/T + φ) − sin φ): exactly 0 at t = 0.
const term = (a, p, ph, t) => a * (Math.sin(TAU * t / p + ph) - Math.sin(ph));

// Offset of realised terms (sampleWindSchedule(s).osc) at time t (s): { dirDeg,
// speedFactor }. dirDeg adds to the base angle, speedFactor multiplies the
// base speed. At t = 0: dirDeg 0, speedFactor 1, for every seed.
export function windScheduleOffset(terms, t, phases) {
  let dir = 0, f = 1;
  terms.forEach((c, i) => {
    const v = term(c.amp, c.period_s, phases[i], t);
    if (c.target === 'speed') f += v; else dir += v;
  });
  return { dirDeg: dir, speedFactor: f };
}

/** Realised terms and phases of a validated spec: { terms, phases, dirScale, speedScale }. */
export function realiseWindSchedule(s) {
  const r = sampleWindSchedule(s);
  return { terms: r.osc, phases: windSchedulePhases(s), dirScale: r.dirScale, speedScale: r.speedScale };
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

const copyEntry = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));

/** Plain-data copy of a validated spec (SimCore.settings.windSchedule, TOML shape per entry). */
export function windScheduleSettings(s) {
  return { enabled: s.enabled, seed: s.seed, ramp: s.ramp, osc: s.osc.map(copyEntry) };
}

export function defaultWindScheduleSettings() {
  return windScheduleSettings(DEFAULT_WIND_SCHEDULE);
}
