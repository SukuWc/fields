// Rudder force limit. No DOM.
//
// The helm, the heading autopilot and the penalty-turn autopilot each
// command a rudder angle. Before the blade force is applied, the boat
// checks the blade's hydrodynamic load at that angle in the current inflow
// (NACA 0012 finite wing, src/foil.js: lift and drag together, newtons).
// If it is over the limit the blade goes to the angle closest to the
// commanded one, within ±maxDeg (the rudder stop), whose load is within
// the limit. That can be less rudder (a hard-over tack start at speed) or
// more, even on the other side of 0: when the hull turns, the yaw rate
// swings the inflow at the stock, so on exiting a turn or late in a tack
// the blade loads up near the centreline and is eased by following the
// flow.
//
// The load is not monotonic in angle: it is least where the blade lines
// up with the inflow and rises either side, and a stalled blade can load
// less at a larger angle. So the search walks outward from the commanded
// angle in SCAN_STEP_DEG steps on both sides at once. The first step
// within the limit is refined by bisection against the step before it, so
// the result is on the limit. If both sides have one at the same step,
// the closer refined angle wins (less rudder on a tie). If no angle in
// range is within the limit, the least loaded scanned angle, refined
// between its neighbours, is used.

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
// maxDeg: the rudder stop, degrees each side (the search range).
// Returns { deg, limited, forceN, commandedForceN }: deg is the effective
// angle in [−maxDeg, maxDeg], forceN its load and commandedForceN the
// load the commanded angle would have had. limited is true when deg is
// not the commanded angle.
// forceAt (optional, tests): deg → newtons, replaces the foil model.
export function limitRudderAngle({ commandedDeg, vBodyX = 0, vBodyY = 0, maxForceN, maxDeg = 90, blade = RUDDER_BLADE, forceAt }) {
  const load = forceAt || ((a) => rudderForceN(a, vBodyX, vBodyY, blade));
  const cmd = Number.isFinite(commandedDeg) ? commandedDeg : 0;
  const fCmd = load(cmd);
  if (!(maxForceN > 0) || !Number.isFinite(maxForceN) || !(fCmd > maxForceN)) {
    return { deg: cmd, limited: false, forceN: fCmd, commandedForceN: fCmd };
  }
  const span = Number.isFinite(maxDeg) && maxDeg > 0 ? maxDeg : 90;
  const lo = Math.min(-span, cmd), hi = Math.max(span, cmd);
  const ok = (a) => load(a) <= maxForceN;
  // Between `good` (within) and `bad` (over), the within-limit angle
  // nearest `bad`.
  const edge = (good, bad) => {
    for (let k = 0; k < BISECT_ITERS; k++) {
      const mid = 0.5 * (good + bad);
      if (ok(mid)) good = mid; else bad = mid;
    }
    return good;
  };
  let bestA = cmd, bestF = fCmd;
  let prevDown = cmd, prevUp = cmd;
  for (let k = 1; ; k++) {
    const down = Math.max(lo, cmd - k * SCAN_STEP_DEG);
    const up = Math.min(hi, cmd + k * SCAN_STEP_DEG);
    const canDown = prevDown > lo, canUp = prevUp < hi;
    if (!canDown && !canUp) break;
    let hitDown = null, hitUp = null;
    if (canDown) {
      const f = load(down);
      if (f < bestF) { bestF = f; bestA = down; }
      if (f <= maxForceN) hitDown = edge(down, prevDown);
      prevDown = down;
    }
    if (canUp) {
      const f = load(up);
      if (f < bestF) { bestF = f; bestA = up; }
      if (f <= maxForceN) hitUp = edge(up, prevUp);
      prevUp = up;
    }
    if (hitDown !== null || hitUp !== null) {
      let deg;
      if (hitDown === null) deg = hitUp;
      else if (hitUp === null) deg = hitDown;
      else {
        const dd = cmd - hitDown, du = hitUp - cmd;
        deg = du < dd ? hitUp : dd < du ? hitDown : (Math.abs(hitUp) < Math.abs(hitDown) ? hitUp : hitDown);
      }
      return { deg, limited: true, forceN: load(deg), commandedForceN: fCmd };
    }
  }
  // Nothing in range is within the limit: least loaded, refined.
  let a = Math.max(lo, bestA - SCAN_STEP_DEG), b = Math.min(hi, bestA + SCAN_STEP_DEG);
  for (let k = 0; k < BISECT_ITERS; k++) {
    const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
    if (load(m1) <= load(m2)) b = m2; else a = m1;
  }
  const refined = 0.5 * (a + b);
  const fRefined = load(refined);
  if (fRefined < bestF) { bestF = fRefined; bestA = refined; }
  return { deg: bestA, limited: bestA !== cmd, forceN: bestF, commandedForceN: fCmd };
}
