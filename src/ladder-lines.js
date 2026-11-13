// Distance-based ladder lines: level sets of downwind path length from a
// mark, using the local wind at each point. No DOM. Host samples the live
// field (including sail wake) and puts compact polylines in the frame;
// scene-build.js turns them into guides.
//
// The origin is the local player's next course target
// (ladderOriginFromState / ladderOriginForSim): start-line mid before the
// gun, then the next mark or the mid of a gate, then the finish-line mid.
// Never sim.marks[0] (that may be a start pin).
// Optional bounds clip the seed front and advection to the map so no
// point leaves the domain.
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
function insideBounds(b, x, y) {
  return x >= b.xmin && x <= b.xmax && y >= b.ymin && y <= b.ymax;
}

function clampToBounds(b, x, y) {
  return [
    Math.min(b.xmax, Math.max(b.xmin, x)),
    Math.min(b.ymax, Math.max(b.ymin, y)),
  ];
}

export function ladderLines(getWind, ox, oy, distances = LADDER_DISTANCES_M, {
  halfWidth = LADDER_HALF_WIDTH_M,
  spacing = LADDER_SPACING_M,
  step = LADDER_STEP_M,
  bounds = null,
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
  const stuck = new Uint8Array(n + 1);
  let live = 0;
  for (let i = 0; i <= n; i++) {
    const s = -halfWidth + (2 * halfWidth) * (i / n);
    const x = ox + cx * s;
    const y = oy + cy * s;
    if (bounds && !insideBounds(bounds, x, y)) {
      pts[i] = null;
      stuck[i] = 1;
      continue;
    }
    pts[i] = [x, y];
    live++;
  }
  if (!live) return [];

  const snaps = new Map();
  let next = 0;
  const maxDist = targets[targets.length - 1];
  const maxSteps = Math.ceil(maxDist / step) + 3;

  for (let k = 0; k < maxSteps && next < targets.length; k++) {
    for (let i = 0; i <= n; i++) {
      const p = pts[i];
      if (!p || stuck[i]) continue;
      const w = getWind(p[0], p[1]);
      if (!w) continue;
      const u = unit(w.vx, w.vy);
      if (!u) continue;
      p[0] += u[0] * step;
      p[1] += u[1] * step;
      dist[i] += step;
      if (bounds && !insideBounds(bounds, p[0], p[1])) {
        const c = clampToBounds(bounds, p[0], p[1]);
        p[0] = c[0];
        p[1] = c[1];
        stuck[i] = 1;
      }
    }
    let mean = 0;
    let count = 0;
    for (let i = 0; i <= n; i++) {
      if (!pts[i]) continue;
      mean += dist[i];
      count++;
    }
    if (!count) break;
    mean /= count;
    while (next < targets.length && mean + 1e-9 >= targets[next]) {
      const t = targets[next];
      const snap = [];
      for (let i = 0; i <= n; i++) {
        const p = pts[i];
        if (!p) continue;
        const over = dist[i] - t;
        let q;
        if (!(over > 0) || over > step + 1e-9 || stuck[i]) {
          q = [p[0], p[1]];
        } else {
          const w = getWind(p[0], p[1]);
          const u = w && unit(w.vx, w.vy);
          q = u ? [p[0] - u[0] * over, p[1] - u[1] * over] : [p[0], p[1]];
        }
        if (bounds) {
          if (!insideBounds(bounds, q[0], q[1])) q = clampToBounds(bounds, q[0], q[1]);
        }
        snap.push(q);
      }
      snaps.set(t, snap);
      next++;
    }
  }
  return targets.filter((d) => snaps.has(d)).map((d) => ({ d, pts: snaps.get(d) }));
}



// World-metre axis-aligned bounds of a lattice ({ w, h, res } from
// scene statics), or of a map with width/height in metres.
export function mapBoundsFromLat(lat) {
  if (!lat) return null;
  if (Number.isFinite(lat.width) && Number.isFinite(lat.height) && lat.width > 0 && lat.height > 0) {
    return { xmin: -lat.width / 2, xmax: lat.width / 2, ymin: -lat.height / 2, ymax: lat.height / 2 };
  }
  if (Number.isFinite(lat.w) && Number.isFinite(lat.h) && Number.isFinite(lat.res) && lat.res > 0) {
    const width = lat.w / lat.res;
    const height = lat.h / lat.res;
    return { xmin: -width / 2, xmax: width / 2, ymin: -height / 2, ymax: height / 2 };
  }
  return null;
}

function xyOf(p) {
  if (!p) return null;
  if (Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
  if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
    return { x: p[0], y: p[1] };
  }
  if (p.physics_model && typeof p.physics_model.getPosition === 'function') {
    return xyOf(p.physics_model.getPosition());
  }
  if (p.anchor) return xyOf(p.anchor);
  return null;
}

// Midpoint of a course element: a mark, a gate ([a, b] or { gate: [a, b] }),
// or a compact frame centre (course.c[i] / anchors[i]).
export function ladderMarkCentre(el) {
  if (!el) return null;
  if (el.gate) return ladderMarkCentre(el.gate);
  if (Array.isArray(el) && el.length === 2 && (typeof el[0] === 'object' || Array.isArray(el[0]))) {
    const a = xyOf(el[0]);
    const b = xyOf(el[1]);
    if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return xyOf(el);
}

function lineMid(line) {
  if (!line) return null;
  return xyOf(line.mid) || ladderMarkCentre([line.a, line.b]) || ladderMarkCentre([line.pin, line.committee]);
}

function startMidForSim(sim) {
  const line = sim && sim.startSequence && sim.startSequence.line;
  return lineMid(line) || xyOf(sim && sim.course && sim.course.start);
}

function finishMidForSim(sim) {
  return lineMid(sim && sim.course && sim.course.finish);
}

function startMidFromState(statics) {
  const st = statics && statics.start;
  const cs = statics && statics.course;
  return lineMid(st) || xyOf(cs && cs.start);
}

function finishMidFromState(statics) {
  const fin = statics && statics.finish;
  const cs = statics && statics.course;
  return lineMid(fin) || xyOf(cs && cs.fin);
}

// Next-target origin from the live sim (local / worker scene-state).
// Before the start (waitingForStart, or a start sequence with no boat yet):
// the start-line mid (pin and committee). After a valid start: the current
// rounding target — a mark, or the mid of a gate. When the finish is next
// (courseComplete): the finish-line mid.
export function ladderOriginForSim(sim, boat = null) {
  const course = sim && sim.course;
  const p = boat && course ? course.progressFor(boat) : null;
  const waiting = p ? p.waitingForStart : !!(sim && sim.startSequence);
  if (waiting) return startMidForSim(sim);
  if (p && p.courseComplete) return finishMidForSim(sim);
  if (!course || !course.marks || !course.marks.length) return startMidForSim(sim);
  const i = p ? p.targetIndex : 0;
  const el = course.marks[i] || course.marks[0];
  return ladderMarkCentre(el);
}

// Same origin from compact frame state, for the local player's boat.
// Reuses courseTextState (hud.own[id].co / hud.co): waiting (co.w) → start
// mid; done → finish mid; otherwise course.c[i] / anchors (gate mid when
// the target is a gate).
export function ladderOriginFromState(state, statics, { ownId } = {}) {
  const h = state && state.hud;
  const mine = ownId != null && h && h.own && h.own[ownId];
  const co = (mine && mine.co) || (h && h.co) || null;
  if (co && co.done) return finishMidFromState(statics);
  if (!co || co.w) {
    const start = startMidFromState(statics);
    if (start) return start;
    if (co && co.w) return null;
  }
  const i = (co && Number.isInteger(co.i)) ? co.i : 0;
  const cg = state && state.course;
  const cs = statics && statics.course;
  return ladderMarkCentre(cg && cg.c && cg.c[i])
    || ladderMarkCentre(cs && cs.anchors && cs.anchors[i])
    || ladderMarkCentre(cs && cs.gates && cs.gates[i]);
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
