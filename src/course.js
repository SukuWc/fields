// Race course: an ordered list of marks, each rounded to a required side,
// and a per-boat progress tracker that decides when a mark has been rounded.
//
// Rounding test. For each mark we integrate the bearing from the mark centre
// to the boat (the "check angle"), signed so that going round in the required
// direction is positive and going back unwinds. Port rounding = the boat goes
// anticlockwise round the mark (bearing increases); starboard = clockwise.
//
// The count is measured from the incoming ray: the half-line from the mark
// back toward the previous mark (or the course start for the first mark of
// lap 1). Two rays matter after it, both in the rounding direction:
//
//   outgoing ray  half-line toward the next mark, at
//                 nextLegDeg = 180° + the course's turn at that mark;
//   midpoint ray  the bisector between incoming and outgoing rays, at
//                 roundedDeg = nextLegDeg / 2.
//
// ROUNDED once the swept angle reaches the midpoint ray. That is what counts
// for course progress (and later scoring): a boat that has swept past the
// bisector has gone round the mark on the required side. A straight pass
// with the mark on the required side sweeps 180° (rounded at 90°); a 120°
// corner (every corner of an equilateral triangle) is rounded at 150° and
// its next leg starts at 300°. Leaving the mark on the wrong side never gets
// there.
//
// The highlight (NEXT on screen) is held on a rounded mark until the boat
// reaches the outgoing ray or leaves the zone, so it does not jump to the
// next mark while she is still turning round this one. See the order note.
//
// Zone. A mark's counter only moves while the boat is within
// COURSE_ACTIVATION_RADIUS_M of it. On the first entry it starts at her
// bearing relative to the incoming ray (wrapped to ±180°), so it does not
// matter where she enters. Outside the zone the count is held. On re-entry
// it moves by the short way (±180°) from the bearing where she left to the
// bearing where she came back, so a short excursion out of the zone neither
// loses nor gains angle. Holding it outside matters: rounding the wing mark
// takes the boat back across the extension of the previous leg, behind the
// previous mark's outgoing ray, and a far-away crossing must not unround it.
// Sailing back round the previous mark inside its zone does.
//
// Hysteresis. Rounded at swept ≥ roundedDeg; unrounded only below
// roundedDeg − ROUNDING_HYST_DEG, so a boat sitting on the midpoint ray does
// not flicker.
//
// Order and laps. Roundings are numbered k = lap·N + i (N marks).
//
//   progress.target / targetIndex    first rounding not rounded: the mark
//                                    course progress is waiting for.
//   progress.display / displayIndex  the mark highlighted as NEXT. It is the
//                                    oldest rounded-but-not-released rounding
//                                    if there is one, else the target. A
//                                    rounding is released when the swept
//                                    angle reaches nextLegDeg, or when the
//                                    boat is outside the zone after rounding
//                                    it (a boat that crosses the bisector and
//                                    sails off does not keep the highlight on
//                                    the old mark). Release is latched until
//                                    the mark is unrounded.
//
// Counters for the target and the COURSE_TRACK_BACK roundings before it keep
// running, so sailing back round the previous mark (inside its zone) below
// the midpoint unrounds it and moves the target back. Older roundings are
// frozen. After the last mark the course loops to mark 1 with a lap counter
// (no finish yet); lap ≥ 2 measures mark 1's incoming ray from the last mark.
//
// Gates. A course element can also be a Gate: two anchored marks the boat
// sails between (new Gate(markA, markB), or {gate: [markA, markB]}). A gate
// is one course step. Its position for the neighbouring legs (and the course
// line) is the midpoint of the two anchors. It has no rounding side and no
// angle counter; instead it counts crossings of the gate line, the segment
// between the two anchors (anchors, not the displaced buoys, like single
// marks):
//
//   forward   from the side facing the previous element (or the start) to
//             the far side, through the segment: crossings +1;
//   backward  the other way through the segment: crossings −1;
//   outside   crossing the line's extension beyond either mark: no change.
//
// PASSED when crossings ≥ 1 and the boat is at least GATE_PASS_HYST_M past
// the line; UNPASSED when crossings ≤ 0 and she is at least GATE_PASS_HYST_M
// back on the near side. In between the state holds, so a boat sitting on
// the line does not flicker. After passing she may round either gate mark
// (either way); the course does not care. A passed gate keeps the NEXT
// highlight until she is outside COURSE_ACTIVATION_RADIUS_M of both gate
// marks (the gate zone), the gate's equivalent of a single mark's release.
// Passing counts as "rounded" everywhere else (target, display, laps, ticks).
//
// Start. options.startSequence (start.js StartSequence) makes progress wait
// for a valid start: until seq.hasStarted(boat), update() does nothing, no
// mark is highlighted (the start line is the target, drawn by start.js) and
// the text reads "Course: start first". Courses without one start at once.

import { BOAT_LENGTH_M } from './rules.js';

// Zone in which a mark's counter starts: three boat lengths (12 m), the same
// distance as the RRS zone.
export const COURSE_ACTIVATION_RADIUS_M = 3 * BOAT_LENGTH_M;

// Degrees below the threshold a rounded mark must drop to count as unrounded.
export const ROUNDING_HYST_DEG = 5;

// Rounded marks behind the target whose counters keep running.
export const COURSE_TRACK_BACK = 2;

// Metres past the gate line (either way) needed to change a gate's state.
export const GATE_PASS_HYST_M = 0.75;

// Rounding direction: +1 port (anticlockwise round the mark), −1 starboard.
export const PORT = 1;
export const STARBOARD = -1;

const DEG = 180 / Math.PI;

export function wrap180(deg) {
  let x = (deg + 180) % 360;
  if (x < 0) x += 360;
  return x - 180;
}

export function wrap360(deg) {
  let x = deg % 360;
  if (x < 0) x += 360;
  return x;
}

export function bearingDeg(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x) * DEG;
}

// Rays and thresholds at one mark. prev/at/next are {x, y}; side is PORT or
// STARBOARD. Ray angles are world degrees (0 = +X, anticlockwise);
// roundedDeg and nextLegDeg are swept angles from the incoming ray in the
// rounding direction. midDeg is the world angle of the midpoint ray.
export function roundingGeometry(prev, at, next, side) {
  const inDeg = bearingDeg(at, prev);
  const outDeg = bearingDeg(at, next);
  let nextLeg = side === PORT ? wrap360(outDeg - inDeg) : wrap360(inDeg - outDeg);
  if (nextLeg === 0) nextLeg = 360;
  const rounded = nextLeg / 2;
  return { inDeg, outDeg, midDeg: inDeg + side * rounded, roundedDeg: rounded, nextLegDeg: nextLeg, turnDeg: nextLeg - 180 };
}

function anchorOf(mark) {
  return mark.anchor ? mark.anchor : { x: mark.x, y: mark.y };
}

function centreOf(mark) {
  const body = mark.physics_model;
  if (body) {
    const p = body.getPosition();
    return { x: p.x, y: p.y };
  }
  return anchorOf(mark);
}

// A gate: two marks (Mark instances, or {x, y} / {anchor}) the boat sails
// between, used as one course element. anchor is the midpoint of the two
// anchors, so neighbouring legs and the course line use it.
export class Gate {
  constructor(a, b) {
    if (!a || !b) throw new Error('Gate needs two marks');
    this.gate = [a, b];
  }

  get anchor() {
    const a = anchorOf(this.gate[0]);
    const b = anchorOf(this.gate[1]);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}

export function isGate(element) {
  return element instanceof Gate;
}

function toElement(e) {
  if (e instanceof Gate) return e;
  if (e && Array.isArray(e.gate) && !e.physics_model) return new Gate(e.gate[0], e.gate[1]);
  return e;
}

export class Course {
  // marks: course elements in order: Mark instances (or {x, y} / {anchor}),
  // and gates (Gate, or {gate: [markA, markB]}).
  // options.sides: per-mark PORT/STARBOARD (default all PORT, a CCW course).
  // options.start: {x, y} the first leg comes from (boat start / start line).
  constructor(marks, options = {}) {
    if (!marks || marks.length < 2) throw new Error('Course needs at least two marks');
    this.marks = marks.map(toElement);
    this.sides = marks.map((_, i) => (options.sides && options.sides[i]) || PORT);
    this.start = options.start || anchorOf(marks[marks.length - 1]);
    this.startSequence = options.startSequence || null;
    this.progress = new WeakMap();
  }

  get length() {
    return this.marks.length;
  }

  // Rounding k (k = lap·N + i): which mark, its side, rays and threshold.
  // Geometry uses the anchors, so a buoy knocked off station does not move
  // the course.
  rounding(k) {
    const n = this.marks.length;
    const i = ((k % n) + n) % n;
    const mark = this.marks[i];
    const at = anchorOf(mark);
    const prev = k === 0 ? this.start : anchorOf(this.marks[(i + n - 1) % n]);
    const next = anchorOf(this.marks[(i + 1) % n]);
    if (isGate(mark)) {
      const a = anchorOf(mark.gate[0]);
      const b = anchorOf(mark.gate[1]);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const tx = (b.x - a.x) / len;
      const ty = (b.y - a.y) / len;
      // Normal pointing to the far side (away from prev).
      let nx = -ty;
      let ny = tx;
      if (nx * (at.x - prev.x) + ny * (at.y - prev.y) < 0) { nx = -nx; ny = -ny; }
      return { k, index: i, lap: Math.floor(k / n) + 1, mark, gate: true, at, prev, next, side: 0, a, b, len, tx, ty, nx, ny };
    }
    const side = this.sides[i];
    return { k, index: i, lap: Math.floor(k / n) + 1, mark, at, prev, next, side, ...roundingGeometry(prev, at, next, side) };
  }

  progressFor(boat) {
    let p = this.progress.get(boat);
    if (!p) {
      p = new CourseProgress(this, boat);
      this.progress.set(boat, p);
    }
    return p;
  }
}

export class CourseProgress {
  constructor(course, boat = null) {
    this.course = course;
    this.boat = boat;
    this.target = 0;
    // Highlighted rounding (see the header): target, or an older rounded
    // one the boat has not yet sailed clear of.
    this.display = 0;
    // Lowest rounding still counted. Never moves back, so a frozen rounding
    // is not revived with a stale bearing.
    this.floor = 0;
    this.trackers = new Map();
  }

  // True while the course has a start sequence and this boat has not made a
  // valid start yet.
  get waitingForStart() {
    const seq = this.course.startSequence;
    return !!seq && !(this.boat && seq.hasStarted(this.boat));
  }

  get lap() {
    return Math.floor(this.target / this.course.length) + 1;
  }

  get lapsCompleted() {
    return Math.floor(this.target / this.course.length);
  }

  // Mark index (0-based) course progress is waiting for: first unrounded.
  get targetIndex() {
    return this.target % this.course.length;
  }

  // Mark index (0-based) highlighted as NEXT.
  get displayIndex() {
    return this.display % this.course.length;
  }

  tracker(k) {
    let t = this.trackers.get(k);
    if (!t) {
      t = { k, entered: false, inside: false, swept: 0, lastBearing: null, rounded: false, released: false, distance: Infinity, bearing: null, crossings: 0, lastSigned: null };
      this.trackers.set(k, t);
    }
    return t;
  }

  // True if rounding k is done (frozen ones below the floor are).
  isRounded(k) {
    if (k < this.floor) return true;
    const t = this.trackers.get(k);
    return !!(t && t.rounded);
  }

  // Advance every live counter by the boat's position, then move the target.
  // Call once per physics step.
  update(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return this;
    if (this.waitingForStart) return this;
    const boat = { x, y };
    for (let k = this.floor; k <= this.target; k++) {
      const r = this.course.rounding(k);
      const t = this.tracker(k);
      if (r.gate) {
        updateGate(r, t, x, y);
        continue;
      }
      const c = centreOf(r.mark);
      const b = bearingDeg(c, boat);
      t.distance = Math.hypot(x - c.x, y - c.y);
      t.bearing = b;
      t.inside = t.distance <= COURSE_ACTIVATION_RADIUS_M;
      if (t.inside) {
        if (!t.entered) {
          t.entered = true;
          t.swept = r.side * wrap180(b - r.inDeg);
        } else {
          // lastBearing is the last bearing seen inside the zone.
          t.swept += r.side * wrap180(b - t.lastBearing);
        }
        t.lastBearing = b;
      }
      if (t.entered) {
        if (!t.rounded && t.swept >= r.roundedDeg) t.rounded = true;
        else if (t.rounded && t.swept < r.roundedDeg - ROUNDING_HYST_DEG) t.rounded = false;
        if (!t.rounded) t.released = false;
        else if (t.swept >= r.nextLegDeg || !t.inside) t.released = true;
      }
    }
    // Target = first live rounding not done.
    let target = this.target;
    for (let k = this.floor; k <= this.target; k++) {
      if (!this.isRounded(k)) { target = k; break; }
      if (k === this.target) target = k + 1;
    }
    if (target < this.target) {
      // Moved back: forget counters past the new target; they start afresh.
      for (const k of [...this.trackers.keys()]) if (k > target) this.trackers.delete(k);
    }
    this.target = target;
    const floor = Math.max(this.floor, this.target - COURSE_TRACK_BACK);
    for (const k of [...this.trackers.keys()]) if (k < floor) this.trackers.delete(k);
    this.floor = floor;
    // Highlight: oldest live rounding that is rounded but not released.
    // Frozen ones (below the floor) count as released.
    let display = this.target;
    for (let k = this.floor; k < this.target; k++) {
      const t = this.trackers.get(k);
      if (t && t.rounded && !t.released) { display = k; break; }
    }
    this.display = display;
    return this;
  }

  // Rounding k (default: the highlighted one) with its live counter, for
  // drawing and text. rounded: swept past the midpoint ray.
  view(k = this.display) {
    const r = this.course.rounding(k);
    const t = this.trackers.get(k) || this.tracker(k);
    return { ...r, swept: t.swept, crossings: t.crossings, entered: t.entered, distance: t.distance, rounded: this.isRounded(k), lap: this.lap, lapsCompleted: this.lapsCompleted };
  }

  // Mark indices rounded in the current lap (the target's lap). A new lap
  // starts the moment the last mark is rounded, so mark 1 loses its lap-1
  // tick then, even while the last mark is still highlighted (that one shows
  // its own tick through the highlight).
  roundedMarks() {
    const n = this.course.length;
    const out = new Set();
    for (let k = this.target - (this.target % n); k < this.target; k++) out.add(k % n);
    return out;
  }

}

// One step of a gate tracker (see the header). t.rounded means passed.
function updateGate(r, t, x, y) {
  const s = (x - r.at.x) * r.nx + (y - r.at.y) * r.ny;
  if (t.lastSigned !== null && t.lastPos) {
    const s0 = t.lastSigned;
    const fwd = s0 < 0 && s >= 0;
    const back = s0 >= 0 && s < 0;
    if (fwd || back) {
      const f = s0 / (s0 - s);
      const px = t.lastPos.x + (x - t.lastPos.x) * f;
      const py = t.lastPos.y + (y - t.lastPos.y) * f;
      const u = (px - r.a.x) * r.tx + (py - r.a.y) * r.ty;
      if (u >= 0 && u <= r.len) t.crossings += fwd ? 1 : -1;
    }
  }
  t.lastSigned = s;
  t.lastPos = { x, y };
  t.signed = s;
  t.distance = Math.min(Math.hypot(x - r.a.x, y - r.a.y), Math.hypot(x - r.b.x, y - r.b.y));
  t.inside = t.distance <= COURSE_ACTIVATION_RADIUS_M;
  t.entered = t.entered || t.inside;
  if (!t.rounded && t.crossings >= 1 && s >= GATE_PASS_HYST_M) t.rounded = true;
  else if (t.rounded && t.crossings <= 0 && s <= -GATE_PASS_HYST_M) t.rounded = false;
  if (!t.rounded) t.released = false;
  else if (!t.inside) t.released = true;
}

// ---- Drawing ----

export const COURSE_LINE_COLOR = 0x6f8fb3;
export const COURSE_NEXT_COLOR = 0x7dff5a;
export const COURSE_ROUNDED_COLOR = 0x8a96a3;
export const COURSE_MID_COLOR = 0xffd27a;
export const COURSE_ZONE_COLOR = 0x7dff5a;

function circleSegments(cx, cy, r, color, opacity, steps = 48, dashed = false) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    if (dashed && i % 2) continue;
    const a0 = (i / steps) * 2 * Math.PI;
    const a1 = ((i + 1) / steps) * 2 * Math.PI;
    out.push({ type: 'guide', color, opacity, x1: cx + r * Math.cos(a0), y1: cy + r * Math.sin(a0), x2: cx + r * Math.cos(a1), y2: cy + r * Math.sin(a1) });
  }
  return out;
}

function dashedLine(a, b, color, opacity, dash = 2, gap = 2) {
  const out = [];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-6) return out;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  for (let s = 0; s < len; s += dash + gap) {
    const e = Math.min(len, s + dash);
    out.push({ type: 'guide', color, opacity, x1: a.x + ux * s, y1: a.y + uy * s, x2: a.x + ux * e, y2: a.y + uy * e });
  }
  return out;
}

function ray(c, deg, len) {
  return { x: c.x + Math.cos(deg / DEG) * len, y: c.y + Math.sin(deg / DEG) * len };
}

// Course overlay for one boat's progress. Deliberately minimal:
// - dashed course line between the marks (and start → mark 1 until mark 1
//   is rounded);
// - the highlighted mark (progress.display): pulsing green ring, faint 12 m
//   zone circle, label "NEXT 1 · port", or "✓ 1" once rounded while still
//   highlighted, and one short dashed amber line along the midpoint ray
//   (from the ring to the zone edge) showing where the rounding counts;
// - marks rounded this lap (roundedMarks): grey ring and "✓ n";
// - other marks: their number.
export function courseGuides(course, progress, nowMs = 0) {
  const g = [];
  const n = course.length;
  const anchors = course.marks.map(anchorOf);
  const waiting = progress.waitingForStart;
  const view = waiting ? { index: -1 } : progress.view();

  for (let i = 0; i < n; i++) g.push(...dashedLine(anchors[i], anchors[(i + 1) % n], COURSE_LINE_COLOR, 0.45));
  if (progress.display === 0 && !waiting) g.push(...dashedLine(course.start, anchors[0], COURSE_LINE_COLOR, 0.3, 1, 2));

  const rounded = progress.roundedMarks();
  for (let i = 0; i < n; i++) {
    const el = course.marks[i];
    if (isGate(el)) {
      g.push(...gateGuides(el, i, i === view.index ? view : null, rounded.has(i), nowMs));
      continue;
    }
    const c = centreOf(el);
    if (i === view.index) {
      const side = course.sides[i] === PORT ? 'port' : 'stbd';
      const pulse = 0.5 + 0.5 * Math.sin(nowMs / 250);
      g.push(...circleSegments(c.x, c.y, 1.1 + 0.6 * pulse, COURSE_NEXT_COLOR, 0.6 + 0.4 * pulse, 32));
      g.push(...circleSegments(c.x, c.y, COURSE_ACTIVATION_RADIUS_M, COURSE_ZONE_COLOR, 0.25, 72, true));
      const from = ray(c, view.midDeg, 2);
      g.push(...dashedLine(from, ray(c, view.midDeg, COURSE_ACTIVATION_RADIUS_M), COURSE_MID_COLOR, 0.9, 1.2, 0.8));
      const text = view.rounded ? '✓ ' + (i + 1) : 'NEXT ' + (i + 1) + ' · ' + side;
      g.push({ type: 'label', badge: true, x: c.x, y: c.y + 2.2, lines: [{ text, role: 'next', id: 'mark' }] });
    } else if (rounded.has(i)) {
      g.push(...circleSegments(c.x, c.y, 1.3, COURSE_ROUNDED_COLOR, 0.7, 24));
      g.push({ type: 'label', badge: true, x: c.x, y: c.y + 1.6, lines: [{ text: '✓ ' + (i + 1), role: 'rounded', id: 'mark' }] });
    } else {
      g.push({ type: 'label', badge: true, x: c.x, y: c.y + 1.6, lines: [{ text: String(i + 1), role: 'markno', id: 'mark' }] });
    }
  }
  return g;
}

// One gate: dashed gate line between the anchors (amber while highlighted),
// and, while highlighted, pulsing green rings on both marks with faint zones
// and one label "NEXT GATE n" ("✓ n" once passed); passed this lap: grey
// rings and "✓ n"; otherwise "GATE n".
function gateGuides(gate, i, view, passed, nowMs) {
  const g = [];
  const a = anchorOf(gate.gate[0]);
  const b = anchorOf(gate.gate[1]);
  const ca = centreOf(gate.gate[0]);
  const cb = centreOf(gate.gate[1]);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const no = String(i + 1);
  let text;
  let role;
  if (view) {
    const pulse = 0.5 + 0.5 * Math.sin(nowMs / 250);
    g.push(...dashedLine(a, b, COURSE_MID_COLOR, 0.9, 1.2, 0.8));
    for (const c of [ca, cb]) {
      g.push(...circleSegments(c.x, c.y, 1.1 + 0.6 * pulse, COURSE_NEXT_COLOR, 0.6 + 0.4 * pulse, 32));
      g.push(...circleSegments(c.x, c.y, COURSE_ACTIVATION_RADIUS_M, COURSE_ZONE_COLOR, 0.18, 72, true));
    }
    text = view.rounded ? '✓ ' + no : 'NEXT GATE ' + no;
    role = 'next';
  } else if (passed) {
    g.push(...dashedLine(a, b, COURSE_ROUNDED_COLOR, 0.5, 1.2, 0.8));
    for (const c of [ca, cb]) g.push(...circleSegments(c.x, c.y, 1.3, COURSE_ROUNDED_COLOR, 0.7, 24));
    text = '✓ ' + no;
    role = 'rounded';
  } else {
    g.push(...dashedLine(a, b, COURSE_LINE_COLOR, 0.45, 1.2, 0.8));
    text = 'GATE ' + no;
    role = 'markno';
  }
  g.push({ type: 'label', badge: true, x: mid.x, y: mid.y + 1.6, lines: [{ text, role, id: 'gate' + i }] });
  return g;
}

// One line for the info panel: the mark (or gate) course progress is
// waiting for, and the lap.
export function courseText(progress) {
  if (progress.waitingForStart) return 'Course: start first, then mark 1';
  const i = progress.targetIndex;
  if (isGate(progress.course.marks[i])) return 'Course: next gate ' + (i + 1) + ' · lap ' + progress.lap;
  const side = progress.course.sides[i] === PORT ? 'port' : 'starboard';
  return 'Course: next mark ' + (i + 1) + ' (' + side + ') · lap ' + progress.lap;
}

// Scenario 13 layout (wind from +Y): windward-leeward. Element 1 is a
// windward mark rounded to port, element 2 a leeward gate of two marks 12 m
// (3 boat lengths) apart, square to the wind. Both sit at x = 22, east of the
// loose map.js circles at (0, 14.5) and (0, 20), with room to round inside
// the walls (±35.5). The boat starts starboard close-hauled just above the
// gate: beat to 1, run back through the gate, round either gate mark, repeat.
export const WINDWARD_LEEWARD_LAYOUT = {
  windward: { x: 22, y: 26 },
  gate: [{ x: 16, y: -24 }, { x: 28, y: -24 }],
  start: { x: 26, y: -17 },
  startHeading: 5 * Math.PI / 4,
};

// Scenario 12 layout (wind from +Y). Equilateral triangle, 45 m legs, the
// largest that fits the 75 m map with room to round inside the walls (±35.5)
// and keeps leg 1→2 clear of the two loose circles map.js adds at (0, 14.5)
// and (0, 20). Anticlockwise: 1 windward, 2 wing (to the left looking
// upwind), 3 leeward. Leg 3→1 is the beat, 1→2 and 2→3 are broad reaches.
// The boat starts starboard close-hauled east of mark 3: one tack onto port
// at about 36 m fetches mark 1.
export const TRIANGLE_COURSE_LAYOUT = {
  marks: [
    { x: 20, y: 21 },
    { x: 20 - 45 * Math.sqrt(3) / 2, y: -1.5 },
    { x: 20, y: -24 },
  ],
  start: { x: 26, y: -20 },
  startHeading: 5 * Math.PI / 4,
};
