// Ladder lines: straight lines square to the wind at the next course
// target, 10 m apart, across the whole map. No DOM. scene-state.js (local
// / worker) and main.js (remote clients, from the vector field) build the
// compact segments; scene-build.js turns them into guides.
//
// Anchor: the local player's next course target (ladderAnchorsForSim /
// ladderAnchorsFromState): the next mark or the mid of a gate, then the
// finish-line mid. Never sim.marks[0] when there is a course (that may be
// a start pin). Before the start the target is the start line and there
// are no lines at all (the anchors carry preStart; ladderDrawable is
// false). With a mark but no course (scenario 21) the mark is the anchor.
//
// Direction: the wind is sampled once, at the anchor, and only its
// direction is used (rounded to LADDER_DIR_STEP_DEG so the lines do not
// shimmer with every field update; speed does not matter). Wind anywhere
// else in the field, sail wakes included, has no effect.
//
// Lines: every line perpendicular to that direction at signed offsets
// k · LADDER_SPACING_M (10 m) from the anchor along the wind, k = …, −1, 0,
// 1, …, on both sides, for every k whose line crosses the map. Offset 0
// passes through the anchor itself (the mark's own line, the one a boat
// is on when she is level with the mark). Each line is clipped to the map
// rectangle, so it is one two-point segment from edge to edge.
//
// Rebuild: the result depends only on the anchor, the rounded direction
// and the map bounds, so callers memoise on those (createLadderCache with
// ladderAnchorKey + ladderWindKey), not on field updates.

export const LADDER_SPACING_M = 10;
// Direction rounding for the build and the cache key, degrees.
export const LADDER_DIR_STEP_DEG = 1;
// Without map bounds (tests, odd callers): a square this far from the anchor.
export const LADDER_DEFAULT_HALF_EXTENT_M = 200;

// Wind direction at the anchor, degrees (math angle of the downwind flow,
// atan2(vy, vx)), rounded to LADDER_DIR_STEP_DEG; null in calm or with no
// sample.
export function ladderWindDeg(getWind, ox, oy) {
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null;
  const w = getWind(ox, oy);
  if (!w || !Number.isFinite(w.vx) || !Number.isFinite(w.vy) || !(Math.hypot(w.vx, w.vy) > 1e-12)) return null;
  const deg = Math.atan2(w.vy, w.vx) * 180 / Math.PI;
  let r = Math.round(deg / LADDER_DIR_STEP_DEG) * LADDER_DIR_STEP_DEG;
  if (r <= -180) r += 360;
  if (r > 180) r -= 360;
  return r;
}

// Clip the line p + t·d to the rectangle (Liang–Barsky). [t0, t1] or null.
function clipLine(px, py, dx, dy, b) {
  let t0 = -Infinity, t1 = Infinity;
  const edges = [[-dx, px - b.xmin], [dx, b.xmax - px], [-dy, py - b.ymin], [dy, b.ymax - py]];
  for (const [pp, q] of edges) {
    if (Math.abs(pp) < 1e-12) { if (q < 0) return null; continue; }
    const t = q / pp;
    if (pp < 0) { if (t > t0) t0 = t; } else if (t < t1) t1 = t;
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}

// Lines for anchor (ox, oy) and downwind direction dirDeg (math degrees):
// [{ k, d, pts: [[x0, y0], [x1, y1]] }, …] in ascending k, d = k · spacing
// metres downwind of the anchor (negative upwind).
export function ladderLines(ox, oy, dirDeg, bounds = null, spacing = LADDER_SPACING_M) {
  if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(dirDeg) || !(spacing > 0)) return [];
  const b = bounds || {
    xmin: ox - LADDER_DEFAULT_HALF_EXTENT_M, xmax: ox + LADDER_DEFAULT_HALF_EXTENT_M,
    ymin: oy - LADDER_DEFAULT_HALF_EXTENT_M, ymax: oy + LADDER_DEFAULT_HALF_EXTENT_M,
  };
  const th = dirDeg * Math.PI / 180;
  const ux = Math.cos(th), uy = Math.sin(th);
  const nx = -uy, ny = ux;
  let smin = Infinity, smax = -Infinity;
  for (const [x, y] of [[b.xmin, b.ymin], [b.xmax, b.ymin], [b.xmin, b.ymax], [b.xmax, b.ymax]]) {
    const sv = (x - ox) * ux + (y - oy) * uy;
    if (sv < smin) smin = sv;
    if (sv > smax) smax = sv;
  }
  const out = [];
  for (let k = Math.ceil(smin / spacing - 1e-9); k <= Math.floor(smax / spacing + 1e-9); k++) {
    const d = k * spacing;
    const px = ox + ux * d, py = oy + uy * d;
    const t = clipLine(px, py, nx, ny, b);
    if (!t) continue;
    out.push({ k, d, pts: [[px + nx * t[0], py + ny * t[0]], [px + nx * t[1], py + ny * t[1]]] });
  }
  return out;
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

// Next target from the live sim (local / worker scene-state). Before the
// start (waitingForStart, or a start sequence with no boat yet): the
// start-line mid with preStart set; ladderDrawable() is false, so no lines
// are drawn before the start. After a valid start: the current rounding
// target (a mark, or the mid of a gate). When the finish is next
// (courseComplete): the finish-line mid. With no course but a mark
// (scenario 21): that mark.
export function ladderAnchorsForSim(sim, boat = null) {
  const course = sim && sim.course;
  if (!course && sim && sim.marks && sim.marks.length && !sim.startSequence) {
    const origin = ladderMarkCentre(sim.marks[0]);
    return origin ? { origin } : null;
  }
  const p = boat && course ? course.progressFor(boat) : null;
  const marks = course && course.marks && course.marks.length ? course.marks : null;
  const waiting = p ? p.waitingForStart : !!(sim && sim.startSequence);
  if (waiting || !marks) {
    const origin = startMidForSim(sim);
    if (!origin) return null;
    return { origin, preStart: true };
  }
  const n = marks.length;
  if (p && p.courseComplete) {
    const origin = finishMidForSim(sim);
    return origin ? { origin } : null;
  }
  const k = p && Number.isFinite(p.target) ? p.target : (p ? p.targetIndex : 0);
  const i = ((k % n) + n) % n;
  const origin = ladderMarkCentre(marks[i]);
  return origin ? { origin } : null;
}

export function ladderOriginForSim(sim, boat = null) {
  const a = ladderAnchorsForSim(sim, boat);
  return a ? a.origin : null;
}

// Same anchor from compact frame state, for the local player's boat.
// Reuses courseTextState (hud.own[id].co / hud.co): waiting (co.w) → start
// mid with preStart (nothing drawn); done → finish mid; otherwise
// course.c[i] / anchors (gate mid when the target is a gate).
export function ladderAnchorsFromState(state, statics, { ownId } = {}) {
  const h = state && state.hud;
  const mine = ownId != null && h && h.own && h.own[ownId];
  const co = (mine && mine.co) || (h && h.co) || null;
  const cg = state && state.course;
  const cs = statics && statics.course;
  const elem = (j) => ladderMarkCentre(cg && cg.c && cg.c[j])
    || ladderMarkCentre(cs && cs.anchors && cs.anchors[j])
    || ladderMarkCentre(cs && cs.gates && cs.gates[j]);
  if (co && co.done) {
    const origin = finishMidFromState(statics);
    return origin ? { origin } : null;
  }
  if (!co || co.w) {
    const start = startMidFromState(statics);
    if (start) return { origin: start, preStart: true };
    if (co && co.w) return null;
  }
  const i = (co && Number.isInteger(co.i)) ? co.i : 0;
  const origin = elem(i);
  return origin ? { origin } : null;
}

// Whether to draw ladder lines for these anchors: never before the start
// (target is the start line).
export function ladderDrawable(anchors) {
  return !!(anchors && anchors.origin && !anchors.preStart);
}

export function ladderOriginFromState(state, statics, opts) {
  const a = ladderAnchorsFromState(state, statics, opts);
  return a ? a.origin : null;
}

// Compact frame payload: one flat [x0, y0, x1, y1] segment per ladder
// line, in ascending offset (upwind-most first). Wind sampled once at the
// anchor; opts.bounds is the map rectangle (mapBoundsFromLat).
export function ladderState(getWind, ox, oy, { bounds = null } = {}) {
  const dir = ladderWindDeg(getWind, ox, oy);
  if (dir === null) return [];
  return ladderLines(ox, oy, dir, bounds).map((l) => [l.pts[0][0], l.pts[0][1], l.pts[1][0], l.pts[1][1]]);
}

// One-entry memo for ladderState: callers pass a key array (rounded
// anchor, rounded wind direction, bounds…) and only rebuild when an entry
// changes.
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
  if (!anchors || !anchors.origin) return [null, null];
  const r = (v) => (Number.isFinite(v) ? Math.round(v * 2) : null);
  return [r(anchors.origin.x), r(anchors.origin.y)];
}

// Cache-key entry for the wind at the anchor: the rounded direction the
// build uses (ladderWindDeg), or null in calm.
export function ladderWindKey(getWind, anchors) {
  if (!anchors || !anchors.origin) return null;
  return ladderWindDeg(getWind, anchors.origin.x, anchors.origin.y);
}

// Guides from state.ladder (scene-build.js): one 'polyline' guide per
// ladder line (flat [x0, y0, x1, y1]), one draw call each.
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
