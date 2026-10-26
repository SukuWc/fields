// Distance-based ladder lines: level sets of downwind path length from a
// mark, using the local wind at each point. No DOM. Host samples the live
// field (including sail wake) and puts compact polylines in the frame;
// scene-build.js turns them into guides.
//
// Definition: a point lies on the X-metre ladder when the integrated
// distance along the downwind streamline from the mark reaches X. With
// uniform wind that is a straight line through (mark + X·û_downwind),
// perpendicular to the wind. With wake or shifts the line bends.
//
// Algorithm: seed a cross-wind front through the mark, advect each point
// downwind by a fixed step while accumulating arc length, and snapshot the
// front when the mean distance crosses each target.

export const LADDER_DISTANCES_M = [20, 40];
export const LADDER_HALF_WIDTH_M = 50;
export const LADDER_SPACING_M = 2;
export const LADDER_STEP_M = 0.5;

function unit(vx, vy) {
  const m = Math.hypot(vx, vy);
  if (!(m > 1e-12)) return null;
  return [vx / m, vy / m];
}

// getWind(x, y) → { vx, vy } (downwind lattice flow). origin is the mark.
// distances: metres of downwind path length (default 20 and 40).
// Returns [{ d, pts: [[x, y], ...] }, ...] in ascending d, skipping any
// target the front never reaches.
export function ladderLines(getWind, ox, oy, distances = LADDER_DISTANCES_M, {
  halfWidth = LADDER_HALF_WIDTH_M,
  spacing = LADDER_SPACING_M,
  step = LADDER_STEP_M,
} = {}) {
  const targets = [...distances].filter((d) => Number.isFinite(d) && d > 0).sort((a, b) => a - b);
  if (!targets.length || !Number.isFinite(ox) || !Number.isFinite(oy)) return [];
  const w0 = getWind(ox, oy);
  if (!w0) return [];
  const u0 = unit(w0.vx, w0.vy);
  if (!u0) return [];
  const [cx, cy] = [-u0[1], u0[0]];

  const n = Math.max(1, Math.round((2 * halfWidth) / spacing));
  const pts = new Array(n + 1);
  const dist = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const s = -halfWidth + (2 * halfWidth) * (i / n);
    pts[i] = [ox + cx * s, oy + cy * s];
  }

  const snaps = new Map();
  let next = 0;
  const maxDist = targets[targets.length - 1];
  const maxSteps = Math.ceil(maxDist / step) + 3;

  for (let k = 0; k < maxSteps && next < targets.length; k++) {
    for (let i = 0; i <= n; i++) {
      const p = pts[i];
      const w = getWind(p[0], p[1]);
      if (!w) continue;
      const u = unit(w.vx, w.vy);
      if (!u) continue;
      p[0] += u[0] * step;
      p[1] += u[1] * step;
      dist[i] += step;
    }
    let mean = 0;
    for (let i = 0; i <= n; i++) mean += dist[i];
    mean /= n + 1;
    while (next < targets.length && mean + 1e-9 >= targets[next]) {
      const t = targets[next];
      const snap = new Array(n + 1);
      for (let i = 0; i <= n; i++) {
        const over = dist[i] - t;
        const p = pts[i];
        if (!(over > 0) || over > step + 1e-9) {
          snap[i] = [p[0], p[1]];
          continue;
        }
        const w = getWind(p[0], p[1]);
        const u = w && unit(w.vx, w.vy);
        snap[i] = u ? [p[0] - u[0] * over, p[1] - u[1] * over] : [p[0], p[1]];
      }
      snaps.set(t, snap);
      next++;
    }
  }
  return targets.filter((d) => snaps.has(d)).map((d) => ({ d, pts: snaps.get(d) }));
}

// Compact frame payload: one flat [x0,y0,x1,y1,…] polyline per distance, in
// LADDER_DISTANCES_M order (empty array when that distance was not reached).
export function ladderState(getWind, ox, oy, opts) {
  const lines = ladderLines(getWind, ox, oy, LADDER_DISTANCES_M, opts);
  const byD = new Map(lines.map((l) => [l.d, l.pts]));
  return LADDER_DISTANCES_M.map((d) => {
    const pts = byD.get(d);
    if (!pts || !pts.length) return [];
    const flat = new Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) {
      flat[i * 2] = pts[i][0];
      flat[i * 2 + 1] = pts[i][1];
    }
    return flat;
  });
}

// Guide segments from state.ladder (scene-build.js). Only the 20 m and 40 m
// lines; nothing else for this feature.
export const LADDER_GUIDE_COLOR = 0xffcc33;
export const LADDER_GUIDE_OPACITY = 0.9;

export function ladderGuidesFromState(ladder) {
  const guides = [];
  if (!ladder || !ladder.length) return guides;
  for (const flat of ladder) {
    if (!flat || flat.length < 4) continue;
    for (let i = 0; i + 3 < flat.length; i += 2) {
      guides.push({
        color: LADDER_GUIDE_COLOR,
        opacity: LADDER_GUIDE_OPACITY,
        type: 'guide',
        x1: flat[i], y1: flat[i + 1],
        x2: flat[i + 2], y2: flat[i + 3],
      });
    }
  }
  return guides;
}
