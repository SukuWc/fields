// Ghost boat (client side, no DOM, no three.js): each boat's predicted pose
// GHOST_AHEAD_S ahead, drawn by renderer.js as the hull outline (boat colour,
// semi-transparent). Prediction is a constant turn-rate arc from the frame's
// body velocity (vx, vy) and angular velocity w (Boat.renderState): the
// velocity vector rotates with the heading, heading(t) = a0 + w t, so
//   p(t) = p0 + ∫0..t R(w s) v ds
// which is a straight line when w ≈ 0.
//
// The hull comes from statics.hulls keyed by boat id (state.boats[i].id),
// sent once per statics change; never matched by position or player index.
// UI / URL: Ghost boat box, a player setting, off by default (?ghost=1 on),
// lookahead s (?ghostAhead=s).
import { buildBodies } from './scene-build.js';

export const GHOST_AHEAD_S = 2;
export const GHOST_OPACITY = 0.45;
export const GHOST_MAX_AHEAD_S = 30;

// Displacement and heading change after t seconds.
export function predictPose(vx, vy, w, t) {
  vx = vx || 0; vy = vy || 0; w = w || 0;
  const a = w * t;
  if (Math.abs(a) < 1e-6) return { dx: vx * t, dy: vy * t, da: a };
  const s = Math.sin(a), c1 = 1 - Math.cos(a);
  return { dx: (vx * s - vy * c1) / w, dy: (vy * s + vx * c1) / w, da: a };
}

// World outline of the ghost: hull { v, com } (body local) for boat b
// ({ id, px, py, pa, vx, vy, w }) t seconds ahead. Planck's velocity is the
// centre of mass's, so the arc moves the world centre c = p + R(pa) com; the
// outline is built with the same formula as the drawn hull (buildBodies).
export function ghostOutline(hull, b, t) {
  const c = Math.cos(b.pa), s = Math.sin(b.pa);
  const cx = b.px + hull.com[0] * c - hull.com[1] * s;
  const cy = b.py + hull.com[0] * s + hull.com[1] * c;
  const pose = predictPose(b.vx, b.vy, b.w, t);
  return buildBodies([{ id: 0, kind: 'polygon', v: hull.v, com: hull.com, at: [b.pa + pose.da, cx + pose.dx, cy + pose.dy] }])[0].pts;
}

// [{ i, id, pts }] for every boat with a hull in statics (by id) and a velocity.
export function ghostOutlines(boats, hulls, t) {
  const out = [];
  if (!boats || !hulls) return out;
  for (let i = 0; i < boats.length; i++) {
    const b = boats[i];
    const hull = b && b.id != null ? hulls[b.id] : null;
    if (!hull || !Number.isFinite(b.vx)) continue;
    out.push({ i, id: b.id, pts: ghostOutline(hull, b, t) });
  }
  return out;
}
