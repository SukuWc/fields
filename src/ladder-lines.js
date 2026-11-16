// Ladder lines and laylines at the next course target. No DOM.
// scene-state.js (local / worker) and main.js (remote clients, from the
// vector field) build the compact segments; scene-build.js turns them
// into guides.
//
// Anchor: the local player's next course target (ladderAnchorsForSim /
// ladderAnchorsFromState): the next mark or the mid of a gate, then the
// finish-line mid. Never sim.marks[0] when there is a course (that may be
// a start pin). Before the start the target is the start line and there
// is nothing at all (the anchors carry preStart; ladderDrawable is false).
// With a mark but no course (scenario 21) the mark is the anchor.
//
// Direction: the wind is sampled once, at the anchor, and only its
// direction is used (rounded to LADDER_DIR_STEP_DEG so nothing shimmers
// with every field update; speed does not matter). Wind anywhere else in
// the field, sail wakes included, has no effect.
//
// Upwind or downwind mark (ladderSide): the anchors carry `toward`, the
// previous point of the leg (previous mark or gate mid; the start on lap
// 1's first leg; the last mark on later laps and on the finish leg). With
// no previous point (scenario 21, no course) it is the local boat's
// position. If `toward` is downwind of the anchor (or level with it:
// dot(toward − anchor, downwind unit) ≥ 0) the boats come up to it: an
// upwind mark (side +1). If it is upwind, they run down to it: a downwind
// mark (side −1). With no `toward` at all (no boat yet) it counts as an
// upwind mark.
//
// Laylines (fixed angles, boat-draw.js best-VMG constants): two rays from
// the anchor on the approach side, to the map edge.
//   upwind mark:   ±BEST_VMG_UPWIND_DEG (50°) from dead downwind, i.e. the
//                  close-hauled courses into the mark, extending downwind;
//   downwind mark: ±(180° − BEST_VMG_DOWNWIND_DEG) (20°) from dead upwind,
//                  the running courses into the mark, extending upwind.
//
// Ladder lines: perpendicular to the wind at offsets k · LADDER_SPACING_M
// (10 m) from the anchor along the wind, k = 1, 2, … on the approach side
// only. Each is only the stretch between the two laylines (half-width
// k · 10 m · tan(half angle)), then clipped to the map. The offset-0 line
// would shrink to the anchor and is not drawn; nothing is drawn on the far
// side of the mark.
// How far they go (ladderMaxOffset): with a course, up to the previous
// point of the leg: only lines whose along-wind offset is no more than
// that of `toward` (previous mark, gate mid or start mid), so none sit
// past the start line or the gate (the default 135 m first beat gets 13,
// the last 5 m inside the start line; the 110 m gate leg 11, the last on
// the gate line). With no course (scenario 21), where `toward` is only the
// boat (anchors.towardIsBoat) or missing, every line that crosses the map.
//
// Rebuild: the result depends only on the anchor, the rounded direction,
// the side, the line count cap and the map bounds, so callers memoise on
// those (createLadderCache with ladderBuildKey), not on field updates or
// the boat's every move.

import { BEST_VMG_DOWNWIND_DEG, BEST_VMG_UPWIND_DEG } from './boat-draw.js';

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

// Clip p + t·d, t in [tmin, tmax], to the rectangle (Liang–Barsky).
// [t0, t1] or null.
function clipLine(px, py, dx, dy, b, tmin = -Infinity, tmax = Infinity) {
  let t0 = tmin, t1 = tmax;
  const edges = [[-dx, px - b.xmin], [dx, b.xmax - px], [-dy, py - b.ymin], [dy, b.ymax - py]];
  for (const [pp, q] of edges) {
    if (Math.abs(pp) < 1e-12) { if (q < 0) return null; continue; }
    const t = q / pp;
    if (pp < 0) { if (t > t0) t0 = t; } else if (t < t1) t1 = t;
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}

function boundsOr(bounds, ox, oy) {
  return bounds || {
    xmin: ox - LADDER_DEFAULT_HALF_EXTENT_M, xmax: ox + LADDER_DEFAULT_HALF_EXTENT_M,
    ymin: oy - LADDER_DEFAULT_HALF_EXTENT_M, ymax: oy + LADDER_DEFAULT_HALF_EXTENT_M,
  };
}

// Layline half angle, degrees: from dead downwind for an upwind mark
// (side +1), from dead upwind for a downwind mark (side −1).
export function laylineHalfAngleDeg(side) {
  return side < 0 ? 180 - BEST_VMG_DOWNWIND_DEG : BEST_VMG_UPWIND_DEG;
}

// Approach axis (unit, pointing away from the mark toward the boats),
// cross-axis and half angle for downwind direction dirDeg and side.
function frame(dirDeg, side) {
  const th = dirDeg * Math.PI / 180;
  const sgn = side < 0 ? -1 : 1;
  const ax = sgn * Math.cos(th), ay = sgn * Math.sin(th);
  return { ax, ay, nx: -ay, ny: ax, half: laylineHalfAngleDeg(side) * Math.PI / 180 };
}

// Upwind (+1) or downwind (−1) mark for these anchors and downwind
// direction dirDeg (see the header).
export function ladderSide(anchors, dirDeg) {
  const t = anchors && anchors.toward;
  const o = anchors && anchors.origin;
  if (!t || !o || !Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(dirDeg)) return 1;
  const th = dirDeg * Math.PI / 180;
  return (t.x - o.x) * Math.cos(th) + (t.y - o.y) * Math.sin(th) >= 0 ? 1 : -1;
}

// The two laylines from (ox, oy): [{ sign, pts: [[ox, oy], [x1, y1]] }, …]
// (sign −1 then +1 for the rotation from the approach axis), each ending
// on the map edge.
export function laylineLines(ox, oy, dirDeg, bounds = null, side = 1) {
  if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(dirDeg)) return [];
  const b = boundsOr(bounds, ox, oy);
  const f = frame(dirDeg, side);
  const out = [];
  for (const sign of [-1, 1]) {
    const c = Math.cos(f.half), sn = sign * Math.sin(f.half);
    const dx = f.ax * c - f.ay * sn, dy = f.ax * sn + f.ay * c;
    const t = clipLine(ox, oy, dx, dy, b, 0, Infinity);
    if (!t) continue;
    out.push({ sign, pts: [[ox + dx * t[0], oy + dy * t[0]], [ox + dx * t[1], oy + dy * t[1]]] });
  }
  return out;
}

// Ladder lines for anchor (ox, oy), downwind direction dirDeg and side:
// [{ k, d, pts: [[x0, y0], [x1, y1]] }, …] in ascending k ≥ 1, d = k ·
// spacing metres from the anchor along the approach axis. Each runs
// between the laylines, clipped to the map.
export function ladderLines(ox, oy, dirDeg, bounds = null, side = 1, spacing = LADDER_SPACING_M, maxOffset = Infinity) {
  if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(dirDeg) || !(spacing > 0)) return [];
  const b = boundsOr(bounds, ox, oy);
  const f = frame(dirDeg, side);
  let smax = -Infinity;
  for (const [x, y] of [[b.xmin, b.ymin], [b.xmax, b.ymin], [b.xmin, b.ymax], [b.xmax, b.ymax]]) {
    const sv = (x - ox) * f.ax + (y - oy) * f.ay;
    if (sv > smax) smax = sv;
  }
  const tan = Math.tan(f.half);
  const out = [];
  const reach = Math.min(smax, maxOffset);
  for (let k = 1; k <= Math.floor(reach / spacing + 1e-9); k++) {
    const d = k * spacing;
    const px = ox + f.ax * d, py = oy + f.ay * d;
    const w = d * tan;
    const t = clipLine(px, py, f.nx, f.ny, b, -w, w);
    if (!t) continue;
    out.push({ k, d, pts: [[px + f.nx * t[0], py + f.ny * t[0]], [px + f.nx * t[1], py + f.ny * t[1]]] });
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

// Next target and the previous point of the leg (toward) from the live
// sim (local / worker scene-state). Before the start (waitingForStart, or
// a start sequence with no boat yet): the start-line mid with preStart
// set; ladderDrawable() is false, so nothing is drawn before the start.
// After a valid start: the current rounding target (a mark, or the mid of
// a gate), toward the previous mark / gate mid, or the course start on the
// first rounding (the last mark on later laps). When the finish is next
// (courseComplete): the finish-line mid, toward the last mark. With no
// course but a mark (scenario 21): that mark, toward the boat.
export function ladderAnchorsForSim(sim, boat = null) {
  const course = sim && sim.course;
  if (!course && sim && sim.marks && sim.marks.length && !sim.startSequence) {
    const origin = ladderMarkCentre(sim.marks[0]);
    return origin ? { origin, toward: xyOf(boat), towardIsBoat: true } : null;
  }
  const p = boat && course ? course.progressFor(boat) : null;
  const marks = course && course.marks && course.marks.length ? course.marks : null;
  const waiting = p ? p.waitingForStart : !!(sim && sim.startSequence);
  if (waiting || !marks) {
    const origin = startMidForSim(sim);
    if (!origin) return null;
    return { origin, toward: null, preStart: true };
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
  return toward ? { origin, toward } : { origin, toward: xyOf(boat) || null, towardIsBoat: true };
}

export function ladderOriginForSim(sim, boat = null) {
  const a = ladderAnchorsForSim(sim, boat);
  return a ? a.origin : null;
}

// Same anchors from compact frame state, for the local player's boat.
// Reuses courseTextState (hud.own[id].co / hud.co): waiting (co.w) → start
// mid with preStart (nothing drawn); done → finish mid toward the last
// mark; otherwise course.c[i] / anchors (gate mid when the target is a
// gate) toward element i − 1 (the start on lap 1's first leg, the last
// element on later laps). With no previous point, toward is the local
// boat (state.boats entry with id ownId; px / py).
export function ladderAnchorsFromState(state, statics, { ownId } = {}) {
  const boats = (state && state.boats) || [];
  const own = boats.find((b) => b && ownId != null && b.id === ownId) || (ownId == null ? boats[0] : null);
  const boatAt = own && Number.isFinite(own.px) && Number.isFinite(own.py) ? { x: own.px, y: own.py } : null;
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
    const last = n ? elem(n - 1) : null;
    return origin ? (last ? { origin, toward: last } : { origin, toward: boatAt, towardIsBoat: true }) : null;
  }
  if (!co || co.w) {
    const start = startMidFromState(statics);
    if (start) return { origin: start, toward: null, preStart: true };
    if (co && co.w) return null;
  }
  const i = (co && Number.isInteger(co.i)) ? co.i : 0;
  const origin = elem(i);
  if (!origin) return null;
  let toward = null;
  if (i > 0) toward = elem(i - 1);
  else if (co && co.lap >= 2 && n) toward = elem(n - 1);
  else toward = xyOf(cs && cs.start) || startMidFromState(statics);
  return toward ? { origin, toward } : { origin, toward: boatAt, towardIsBoat: true };
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

// Compact frame payload for anchors { origin, toward }: { ladder, layline },
// each a list of flat [x0, y0, x1, y1] segments (ladder in ascending
// offset from the mark; layline the two rays from the mark). Wind sampled
// once at the anchor; opts.bounds is the map rectangle (mapBoundsFromLat).
export function ladderGeometry(getWind, anchors, { bounds = null } = {}) {
  const o = anchors && anchors.origin;
  const dir = o ? ladderWindDeg(getWind, o.x, o.y) : null;
  if (dir === null) return { ladder: [], layline: [] };
  const side = ladderSide(anchors, dir);
  const flat = (l) => [l.pts[0][0], l.pts[0][1], l.pts[1][0], l.pts[1][1]];
  return {
    ladder: ladderLines(o.x, o.y, dir, bounds, side, LADDER_SPACING_M, ladderMaxOffset(anchors, dir)).map(flat),
    layline: laylineLines(o.x, o.y, dir, bounds, side).map(flat),
  };
}

// Farthest ladder offset (m along the wind from the anchor) for anchors
// and direction dirDeg: the along-wind offset of the previous point of
// the leg when there is one, Infinity (the map edge) when `toward` is
// missing or only the boat (no course, towardIsBoat).
export function ladderMaxOffset(anchors, dirDeg) {
  const o = anchors && anchors.origin, t = anchors && anchors.toward;
  if (!o || !t || anchors.towardIsBoat || !Number.isFinite(dirDeg)) return Infinity;
  if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) return Infinity;
  const r = dirDeg * Math.PI / 180;
  return Math.abs((t.x - o.x) * Math.cos(r) + (t.y - o.y) * Math.sin(r));
}

// Ladder segments only, for an anchor point; opts.toward picks the side
// (absent: upwind mark).
export function ladderState(getWind, ox, oy, { bounds = null, toward = null } = {}) {
  return ladderGeometry(getWind, { origin: { x: ox, y: oy }, toward }, { bounds }).ladder;
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

// Full cache key: anchor (0.5 m), rounded wind direction (1°), side and
// line count cap (floor of ladderMaxOffset / spacing, null for the map
// edge). The boat moving does not rebuild unless it flips the side; a
// drifting previous mark only when it changes the count.
export function ladderBuildKey(getWind, anchors) {
  const dir = ladderWindKey(getWind, anchors);
  if (dir === null) return [...ladderAnchorKey(anchors), null, null, null];
  const cap = ladderMaxOffset(anchors, dir);
  return [...ladderAnchorKey(anchors), dir, ladderSide(anchors, dir), Number.isFinite(cap) ? Math.floor(cap / LADDER_SPACING_M + 1e-9) : null];
}

// Guides from state.ladder / state.layline (scene-build.js): one
// 'polyline' guide per segment (flat [x0, y0, x1, y1]), one draw call
// each. Ladder lines cyan, laylines amber (and slightly more opaque, so
// the zone edge reads apart from the rungs).
export const LADDER_GUIDE_COLOR = 0x33ddff;
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

export const LAYLINE_GUIDE_COLOR = 0xffcc33;
export const LAYLINE_GUIDE_OPACITY = 0.95;

export function laylineGuidesFromState(layline) {
  const guides = [];
  if (!layline || !layline.length) return guides;
  for (const flat of layline) {
    if (!flat || flat.length < 4) continue;
    guides.push({ color: LAYLINE_GUIDE_COLOR, opacity: LAYLINE_GUIDE_OPACITY, type: 'polyline', pts: flat });
  }
  return guides;
}
