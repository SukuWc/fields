// Distance-based ladder lines: level sets of path length along the local
// wind from the next course target, laid out toward the previous mark of
// the leg. No DOM. scene-state.js (local / worker) and main.js (remote
// clients, from the vector field) build compact polylines; scene-build.js
// turns them into guides.
//
// Origin: the local player's next course target (ladderAnchorsFromState /
// ladderAnchorsForSim): start-line mid before the gun, then the next mark
// or the mid of a gate, then the finish-line mid. Never sim.marks[0] when
// there is a course (that may be a start pin).
//
// Side: the lines go on the side of the target that faces the previous
// point of the leg (the previous mark or gate mid; the start-line mid on
// the first leg of lap 1; the last mark on later laps and on the finish
// leg). So on a run they sit windward of the leeward gate, on a beat
// leeward of the windward mark. The front still follows the local wind
// (sail wake bends it); ladderPlan picks the sign: downwind when the
// previous point is downwind of the target (dot(prev − target, wind) ≥ 0),
// else upwind (the front walks against the flow).
//
// Before the start the target is the start line and there is no previous
// mark: the lines go on the pre-start side, away from mark 1, for
// LADDER_PRESTART_LENGTH_M. With no previous point at all (e.g. a mark but
// no course, scenario 21) they go downwind for LADDER_DEFAULT_LENGTH_M.
//
// Count and spacing: one line every LADDER_SPACING_M (10 m) up to the leg
// length measured along the wind (|dot(prev − target, wind unit)|), i.e.
// ceil(length / 10) lines, at least one and at most LADDER_MAX_LINES (40,
// 400 m). The front width grows with the cross-wind offset of the previous
// point (LADDER_HALF_WIDTH_M … LADDER_MAX_HALF_WIDTH_M) and the front point
// spacing and advection step grow with the leg so one build costs at most
// about LADDER_FRONT_POINTS × LADDER_MAX_STEPS wind samples.
//
// Optional bounds clip the seed front and advection to the map so no
// point leaves the domain.
//
// Definition: a point lies on the X-metre ladder when the integrated
// distance along the streamline (with or against the wind) from the target
// reaches X. With uniform wind that is a straight line through
// (target ± X·û_downwind), perpendicular to the wind.
//
// Algorithm: seed a cross-wind front through the target, advect each point
// along ±wind by a fixed step while accumulating arc length, and snapshot
// the front when the mean distance of the points still moving crosses each
// target distance.

export const LADDER_SPACING_M = 10;
export const LADDER_MAX_LINES = 40;
export const LADDER_DEFAULT_LENGTH_M = 40;
export const LADDER_PRESTART_LENGTH_M = 60;
export const LADDER_HALF_WIDTH_M = 50;
export const LADDER_MAX_HALF_WIDTH_M = 200;
export const LADDER_CROSS_MARGIN_M = 30;
export const LADDER_FRONT_SPACING_M = 2;
export const LADDER_FRONT_POINTS = 100;
export const LADDER_STEP_M = 0.5;
export const LADDER_MAX_STEPS = 200;

function unit(vx, vy) {
  const m = Math.hypot(vx, vy);
  if (!(m > 1e-12)) return null;
  return [vx / m, vy / m];
}

function insideBounds(b, x, y) {
  return x >= b.xmin && x <= b.xmax && y >= b.ymin && y <= b.ymax;
}

function clampToBounds(b, x, y) {
  return [
    Math.min(b.xmax, Math.max(b.xmin, x)),
    Math.min(b.ymax, Math.max(b.ymin, y)),
  ];
}

// Distances 10, 20, … covering legLength (at least one, at most the cap).
export function ladderDistances(legLength, spacing = LADDER_SPACING_M, maxLines = LADDER_MAX_LINES) {
  const len = Number.isFinite(legLength) && legLength > 0 ? legLength : 0;
  const n = Math.min(maxLines, Math.max(1, Math.ceil(len / spacing - 1e-9)));
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = spacing * (i + 1);
  return out;
}

// How to build the ladder from (ox, oy) toward the previous point `toward`
// ({ x, y } or null): direction (+1 downwind, −1 upwind), distances, and
// front sizing. null when there is no wind at the origin.
export function ladderPlan(getWind, ox, oy, toward = null) {
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null;
  const w0 = getWind(ox, oy);
  const u0 = w0 && unit(w0.vx, w0.vy);
  if (!u0) return null;
  let direction = 1;
  let length = LADDER_DEFAULT_LENGTH_M;
  let cross = 0;
  if (toward && Number.isFinite(toward.x) && Number.isFinite(toward.y)) {
    const dx = toward.x - ox;
    const dy = toward.y - oy;
    const along = dx * u0[0] + dy * u0[1];
    direction = along < 0 ? -1 : 1;
    length = Math.abs(along);
    cross = Math.abs(-dx * u0[1] + dy * u0[0]);
  }
  const distances = ladderDistances(length);
  const halfWidth = Math.min(LADDER_MAX_HALF_WIDTH_M, Math.max(LADDER_HALF_WIDTH_M, cross + LADDER_CROSS_MARGIN_M));
  const spacing = Math.max(LADDER_FRONT_SPACING_M, (2 * halfWidth) / LADDER_FRONT_POINTS);
  const step = Math.max(LADDER_STEP_M, distances[distances.length - 1] / LADDER_MAX_STEPS);
  return { direction, distances, halfWidth, spacing, step, length };
}

// getWind(x, y) → { vx, vy } (downwind lattice flow). origin is the target.
// distances: metres of path length. direction: +1 with the wind, −1
// against it. Returns [{ d, pts: [[x, y], ...] }, ...] in ascending d,
// skipping any distance the front never reaches.
export function ladderLines(getWind, ox, oy, distances = [LADDER_SPACING_M], {
  halfWidth = LADDER_HALF_WIDTH_M,
  spacing = LADDER_FRONT_SPACING_M,
  step = LADDER_STEP_M,
  bounds = null,
  direction = 1,
} = {}) {
  const targets = [...distances].filter((d) => Number.isFinite(d) && d > 0).sort((a, b) => a - b);
  if (!targets.length || !Number.isFinite(ox) || !Number.isFinite(oy)) return [];
  const sgn = direction < 0 ? -1 : 1;
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
      p[0] += sgn * u[0] * step;
      p[1] += sgn * u[1] * step;
      dist[i] += step;
      if (bounds && !insideBounds(bounds, p[0], p[1])) {
        const c = clampToBounds(bounds, p[0], p[1]);
        p[0] = c[0];
        p[1] = c[1];
        stuck[i] = 1;
      }
    }
    // Mean over the points still moving: ends that hit a wall stop
    // counting, so a long leg still reaches its far lines.
    let mean = 0;
    let count = 0;
    for (let i = 0; i <= n; i++) {
      if (!pts[i] || stuck[i]) continue;
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
          q = u ? [p[0] - sgn * u[0] * over, p[1] - sgn * u[1] * over] : [p[0], p[1]];
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

// Pre-start: a point LADDER_PRESTART_LENGTH_M from the start-line mid,
// away from mark 1, so the lines fill the pre-start side.
function preStartToward(startMid, firstMark) {
  if (!startMid) return null;
  if (!firstMark) return null;
  const u = unit(startMid.x - firstMark.x, startMid.y - firstMark.y);
  if (!u) return null;
  return { x: startMid.x + u[0] * LADDER_PRESTART_LENGTH_M, y: startMid.y + u[1] * LADDER_PRESTART_LENGTH_M };
}

// Next target (origin) and the previous point of the leg (toward) from the
// live sim (local / worker scene-state). Before the start
// (waitingForStart, or a start sequence with no boat yet): origin is the
// start-line mid and toward is the pre-start side. After a valid start:
// origin is the current rounding target (a mark, or the mid of a gate) and
// toward is the previous mark / gate mid, or the course start on the first
// rounding (the last mark on later laps). When the finish is next
// (courseComplete): the finish-line mid, toward the last mark. With no
// course but a mark (scenario 21): that mark, toward null (downwind).
export function ladderAnchorsForSim(sim, boat = null) {
  const course = sim && sim.course;
  if (!course && sim && sim.marks && sim.marks.length && !sim.startSequence) {
    const origin = ladderMarkCentre(sim.marks[0]);
    return origin ? { origin, toward: null } : null;
  }
  const p = boat && course ? course.progressFor(boat) : null;
  const marks = course && course.marks && course.marks.length ? course.marks : null;
  const waiting = p ? p.waitingForStart : !!(sim && sim.startSequence);
  if (waiting || !marks) {
    const origin = startMidForSim(sim);
    if (!origin) return null;
    return { origin, toward: preStartToward(origin, marks && ladderMarkCentre(marks[0])) };
  }
  const n = marks.length;
  if (p && p.courseComplete) {
    const origin = finishMidForSim(sim);
    return origin ? { origin, toward: ladderMarkCentre(marks[n - 1]) } : null;
  }
  const k = p && Number.isFinite(p.target) ? p.target : (p ? p.targetIndex : 0);
  const i = ((k % n) + n) % n;
  const origin = ladderMarkCentre(marks[i]);
  if (!origin) return null;
  let toward;
  if (i > 0) toward = ladderMarkCentre(marks[i - 1]);
  else if (k >= n) toward = ladderMarkCentre(marks[n - 1]);
  else toward = xyOf(course.start) || startMidForSim(sim);
  return { origin, toward: toward || null };
}

export function ladderOriginForSim(sim, boat = null) {
  const a = ladderAnchorsForSim(sim, boat);
  return a ? a.origin : null;
}

// Same anchors from compact frame state, for the local player's boat.
// Reuses courseTextState (hud.own[id].co / hud.co): waiting (co.w) → start
// mid toward the pre-start side; done → finish mid toward the last mark;
// otherwise course.c[i] / anchors (gate mid when the target is a gate)
// toward element i − 1 (the start on lap 1's first leg, the last element
// on later laps).
export function ladderAnchorsFromState(state, statics, { ownId } = {}) {
  const h = state && state.hud;
  const mine = ownId != null && h && h.own && h.own[ownId];
  const co = (mine && mine.co) || (h && h.co) || null;
  const cg = state && state.course;
  const cs = statics && statics.course;
  const elem = (j) => ladderMarkCentre(cg && cg.c && cg.c[j])
    || ladderMarkCentre(cs && cs.anchors && cs.anchors[j])
    || ladderMarkCentre(cs && cs.gates && cs.gates[j]);
  const n = (cg && cg.c && cg.c.length) || (cs && cs.anchors && cs.anchors.length) || (cs && Number.isInteger(cs.n) ? cs.n : 0);
  if (co && co.done) {
    const origin = finishMidFromState(statics);
    return origin ? { origin, toward: n ? elem(n - 1) : null } : null;
  }
  if (!co || co.w) {
    const start = startMidFromState(statics);
    if (start) return { origin: start, toward: preStartToward(start, n ? elem(0) : null) };
    if (co && co.w) return null;
  }
  const i = (co && Number.isInteger(co.i)) ? co.i : 0;
  const origin = elem(i);
  if (!origin) return null;
  let toward = null;
  if (i > 0) toward = elem(i - 1);
  else if (co && co.lap >= 2 && n) toward = elem(n - 1);
  else toward = xyOf(cs && cs.start) || startMidFromState(statics);
  return { origin, toward: toward || null };
}

export function ladderOriginFromState(state, statics, opts) {
  const a = ladderAnchorsFromState(state, statics, opts);
  return a ? a.origin : null;
}

// Compact frame payload: one flat [x0,y0,x1,y1,…] polyline per ladder line
// (10 m, 20 m, … in order; lines the front never reached are dropped).
// opts.toward is the previous point of the leg (ladderPlan); opts.bounds
// clips to the map.
export function ladderState(getWind, ox, oy, { toward = null, bounds = null } = {}) {
  const plan = ladderPlan(getWind, ox, oy, toward);
  if (!plan) return [];
  const lines = ladderLines(getWind, ox, oy, plan.distances, {
    halfWidth: plan.halfWidth,
    spacing: plan.spacing,
    step: plan.step,
    direction: plan.direction,
    bounds,
  });
  const out = [];
  for (const l of lines) {
    const pts = l.pts;
    if (!pts || pts.length < 2) continue;
    const flat = new Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) {
      flat[i * 2] = pts[i][0];
      flat[i * 2 + 1] = pts[i][1];
    }
    out.push(flat);
  }
  return out;
}

// One-entry memo for ladderState: callers pass a key array (field
// identity, rounded anchors, time bucket…) and only rebuild when an entry
// changes, so a per-frame caller costs one build per field update.
export function createLadderCache() {
  let key = null;
  let value = null;
  return (k, compute) => {
    if (key && key.length === k.length && key.every((v, i) => v === k[i])) return value;
    key = k;
    value = compute();
    return value;
  };
}

// Anchor coordinates rounded to 0.5 m for cache keys (a drifting buoy or
// rounding noise should not force a rebuild every frame).
export function ladderAnchorKey(anchors) {
  if (!anchors || !anchors.origin) return [null, null, null, null];
  const r = (v) => (Number.isFinite(v) ? Math.round(v * 2) : null);
  const t = anchors.toward;
  return [r(anchors.origin.x), r(anchors.origin.y), t ? r(t.x) : null, t ? r(t.y) : null];
}

// Guides from state.ladder (scene-build.js): one 'polyline' guide per
// ladder line (flat pts), so the renderer draws each line as a single fat
// line (one draw call) instead of one per segment — a long leg can have
// up to LADDER_MAX_LINES lines of ~100 points.
export const LADDER_GUIDE_COLOR = 0xffcc33;
export const LADDER_GUIDE_OPACITY = 0.9;

export function ladderGuidesFromState(ladder) {
  const guides = [];
  if (!ladder || !ladder.length) return guides;
  for (const flat of ladder) {
    if (!flat || flat.length < 4) continue;
    guides.push({
      color: LADDER_GUIDE_COLOR,
      opacity: LADDER_GUIDE_OPACITY,
      type: 'polyline',
      pts: flat,
    });
  }
  return guides;
}
