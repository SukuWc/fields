// Ghost boat (client side, no DOM, no three.js): each boat's predicted pose
// GHOST_AHEAD_S ahead, drawn by renderer.js as the hull outline (boat colour,
// semi-transparent). Prediction is a constant turn-rate arc from the frame's
// body velocity (vx, vy) and angular velocity w (Boat.renderState): the
// velocity vector rotates with the heading, heading(t) = a0 + w t, so
//   p(t) = p0 + ∫0..t R(w s) v ds
// which is a straight line when w ≈ 0. UI / URL: Ghost boat box, off by default (?ghost=1 on, ?ghost=0 off),
// lookahead s (?ghostAhead=s).
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

// Outline pts [x0, y0, ...] moved rigidly: rotated by da about the body
// origin (ox, oy) and shifted by (dx, dy). Writes into out (array or typed).
export function moveOutline(pts, ox, oy, pose, out = new Array(pts.length)) {
  const c = Math.cos(pose.da), s = Math.sin(pose.da);
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const rx = pts[i] - ox, ry = pts[i + 1] - oy;
    out[i] = ox + pose.dx + rx * c - ry * s;
    out[i + 1] = oy + pose.dy + rx * s + ry * c;
  }
  return out;
}

// Which boat each polygon body belongs to: the nearest boat body origin
// within maxDist (outline centroid). Returns boat index or -1 per body.
export function assignBodies(bodies, boats, maxDist = 6) {
  return bodies.map((b) => {
    if (b.kind !== 'polygon') return -1;
    let cx = 0, cy = 0; const n = b.pts.length / 2;
    for (let i = 0; i < b.pts.length; i += 2) { cx += b.pts[i]; cy += b.pts[i + 1]; }
    cx /= n; cy /= n;
    let best = -1, bd = maxDist * maxDist;
    boats.forEach((bt, i) => { const d = (bt.px - cx) ** 2 + (bt.py - cy) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  });
}
