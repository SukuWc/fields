// Rudder force limit. No DOM.
//
// The helm, the heading autopilot and the penalty-turn autopilot each
// command a rudder angle. Before the blade force is applied, the boat
// checks the blade's hydrodynamic load at that angle in the current inflow
// (NACA 0012 finite wing, src/foil.js: lift and drag together, newtons).
// If it is over the limit the angle is reduced toward 0, keeping its sign,
// until the load is at the limit. The angle is never increased.
//
// The load is not monotonic in angle. Past the lift peak (about 12° angle
// of attack) the blade stalls: lift drops before drag builds up, so a
// smaller angle can load the blade more than a larger one. The limiter
// therefore takes the largest angle not above the commanded one whose load
// is within the limit: it walks down from the commanded angle in
// SCAN_STEP_DEG steps, and the first step under the limit is refined by
// bisection against the step above it. If no angle between 0 and the
// commanded one is within the limit (the inflow alone, from leeway and yaw
// rate, already loads the centred blade past it), it takes the least
// loaded angle in that range, which can be the commanded one: late in a
// fast tack the yaw rate swings the inflow at the stock so far that a
// smaller angle loads the blade more. The limit only takes angle off; it
// never puts more on.

import { foilForceNewtons, RUDDER_BLADE } from './foil.js';

export const SCAN_STEP_DEG = 0.5;
const BISECT_ITERS = 24;

// Blade load magnitude, newtons, at `deg` in the inflow (vBodyX, vBodyY):
// body frame as foilForceNewtons, +X to the side, +Y aft.
export function rudderForceN(deg, vBodyX, vBodyY, blade = RUDDER_BLADE) {
  const r = foilForceNewtons({
    vBodyX, vBodyY,
    bladeRad: deg * Math.PI / 180,
    area: blade.area,
    aspectRatio: blade.effectiveAspect,
  });
  return Math.hypot(r.lift.x + r.drag.x, r.lift.y + r.drag.y);
}

// commandedDeg: the angle the helm or autopilot asks for. maxForceN: the
// limit in newtons; 0, a negative value or a non-finite one is no limit.
// Returns { deg, limited, forceN, commandedForceN }: deg is the effective
// angle (same sign as commandedDeg, |deg| ≤ |commandedDeg|), forceN its
// load and commandedForceN the load the commanded angle would have had.
// forceAt (optional, tests): deg → newtons, replaces the foil model.
export function limitRudderAngle({ commandedDeg, vBodyX = 0, vBodyY = 0, maxForceN, blade = RUDDER_BLADE, forceAt }) {
  const load = forceAt || ((a) => rudderForceN(a, vBodyX, vBodyY, blade));
  const cmd = Number.isFinite(commandedDeg) ? commandedDeg : 0;
  const fCmd = load(cmd);
  if (!(maxForceN > 0) || !Number.isFinite(maxForceN) || !(fCmd > maxForceN)) {
    return { deg: cmd, limited: false, forceN: fCmd, commandedForceN: fCmd };
  }
  const sign = cmd < 0 ? -1 : 1;
  const mag = Math.abs(cmd);
  let hi = mag;            // over the limit
  let bestMag = mag, bestF = fCmd;
  for (let m = mag - SCAN_STEP_DEG; ; m -= SCAN_STEP_DEG) {
    const a = Math.max(0, m);
    const f = load(sign * a);
    if (f < bestF) { bestF = f; bestMag = a; }
    if (f <= maxForceN) {
      // Largest angle in [a, hi] within the limit: lo stays within it.
      let lo = a;
      for (let k = 0; k < BISECT_ITERS; k++) {
        const mid = 0.5 * (lo + hi);
        if (load(sign * mid) <= maxForceN) lo = mid; else hi = mid;
      }
      const deg = sign * lo;
      return { deg, limited: true, forceN: load(deg), commandedForceN: fCmd };
    }
    if (a === 0) break;
    hi = a;
  }
  // limited is true only when the angle actually came down; if the
  // commanded angle is already the least loaded one it stays.
  // Refine the least loaded step to the minimum between its neighbours.
  let a = Math.max(0, bestMag - SCAN_STEP_DEG), b = Math.min(mag, bestMag + SCAN_STEP_DEG);
  for (let k = 0; k < BISECT_ITERS; k++) {
    const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
    if (load(sign * m1) <= load(sign * m2)) b = m2; else a = m1;
  }
  const refined = 0.5 * (a + b);
  const fRefined = load(sign * refined);
  if (fRefined < bestF) { bestF = fRefined; bestMag = refined; }
  const deg = sign * bestMag;
  return { deg, limited: bestMag < mag, forceN: bestF, commandedForceN: fCmd };
}
