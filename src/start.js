// Start procedure: RRS 26 signals, a start line between two anchored marks,
// individual recall (RRS 29.1) and each boat's start time.
//
// Clock. StartSequence is driven by simulated time (step(dt) once per world
// step). seq.clock is seconds relative to the starting signal: negative
// before the gun, positive after. The RRS 26 signals are at
//
//   warning      −timings.warning      class flag up
//   preparatory  −timings.prep         P flag up
//   one-minute   −timings.oneMinute    P flag down
//   start         0                    class flag down
//
// RRS_START_TIMINGS (5, 4, 1, 0 minutes) is the default. Scenario 14 uses
// COMPRESSED_START_TIMINGS, the same sequence at 1/5 scale (60, 48, 12 s),
// so a start comes round in about a minute. The sequence begins `lead`
// seconds before the warning signal.
//
// Line. The start line runs between the anchors of two Marks (anchors, not
// the displaced buoys): the committee (starboard) end and the pin (port)
// end. The course side is the side holding options.courseSide (e.g. the
// first mark); the other side is the pre-start side.
//
// Early start (RRS 29.1). At the starting signal a boat is OCS ("on the
// course side") when any point of her hull is on the course side of the
// line's infinite extension AND laterally within the line plus
// START_OCS_EXT_M (one boat length) beyond either end. The lateral limit
// keeps a boat far up the course beyond the ends from being called OCS; one
// boat length of slack catches a boat that is over just outside a mark. The
// X flag goes up when any boat is OCS and comes down when every OCS boat
// has returned, or timings.xFlag after the start (RRS 29.1: 4 minutes),
// whichever is first; an OCS boat still has to return after that.
//
// Return. An OCS boat has returned once her whole hull is on the pre-start
// side (of the line or its extensions, anywhere). Then she starts like
// anyone else.
//
// Proper start. The first time after the signal, and not OCS, that the
// boat's bow point crosses the line segment between the anchors from the
// pre-start side to the course side. Crossing the other way never counts.
// The start time is interpolated within the step and recorded as seconds
// after the signal. A boat that has not started after the gun shows as not
// started. Once started she stays started (no general recall yet).

import { BOAT_LENGTH_M, hullVerticesWorld } from './rules.js';

export const RRS_START_TIMINGS = Object.freeze({ warning: 300, prep: 240, oneMinute: 60, xFlag: 240 });
export const COMPRESSED_START_TIMINGS = Object.freeze({ warning: 60, prep: 48, oneMinute: 12, xFlag: 48 });

// Lateral slack beyond each line end for the OCS test (metres).
export const START_OCS_EXT_M = BOAT_LENGTH_M;

// Seconds of sim time the HUD flashes after each signal.
export const START_FLASH_S = 0.8;

// Seconds the "STARTED" label stays on the boat.
export const START_LABEL_S = 5;

export const START_LINE_COLOR = 0xffd27a;
export const START_NEXT_COLOR = 0x7dff5a;
export const START_OCS_COLOR = 0xff5a5a;
export const START_DONE_COLOR = 0x8a96a3;

function anchorOf(mark) {
  return mark.anchor ? mark.anchor : { x: mark.x, y: mark.y };
}

export class StartLine {
  // committee, pin: Mark instances (or {x, y} / {anchor}). courseSide: a
  // point on the course side.
  constructor(committee, pin, courseSide) {
    this.committee = committee;
    this.pin = pin;
    const a = anchorOf(pin);
    const b = anchorOf(committee);
    this.len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(this.len > 0)) throw new Error('Start line needs two separate ends');
    this.tx = (b.x - a.x) / this.len;
    this.ty = (b.y - a.y) / this.len;
    let nx = -this.ty;
    let ny = this.tx;
    const mid = this.mid;
    if (courseSide && nx * (courseSide.x - mid.x) + ny * (courseSide.y - mid.y) < 0) { nx = -nx; ny = -ny; }
    this.nx = nx;
    this.ny = ny;
  }

  get a() { return anchorOf(this.pin); }
  get b() { return anchorOf(this.committee); }
  get mid() {
    const a = this.a;
    const b = this.b;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  // Signed distance: > 0 on the course side.
  side(p) {
    const a = this.a;
    return (p.x - a.x) * this.nx + (p.y - a.y) * this.ny;
  }

  // Position along the line from the pin end (0) to the committee end (len).
  along(p) {
    const a = this.a;
    return (p.x - a.x) * this.tx + (p.y - a.y) * this.ty;
  }
}

// Hull polygon and bow point of a boat. Plain test objects can pass
// {hull: [{x, y}...], bow: {x, y}}; a Boat uses its planck hull and the
// vertex furthest forward.
export function boatStartGeometry(boat) {
  const hull = Array.isArray(boat.hull) ? boat.hull : hullVerticesWorld(boat);
  let bow = boat.bow || null;
  if (!bow && hull.length) {
    const h = boat.hull_angle || 0;
    const fx = Math.sin(h);
    const fy = -Math.cos(h);
    let best = -Infinity;
    for (const p of hull) {
      const d = p.x * fx + p.y * fy;
      if (d > best) { best = d; bow = p; }
    }
  }
  if (!bow) bow = { x: boat.x, y: boat.y };
  return { hull: hull.length ? hull : [bow], bow };
}

export class StartSequence {
  // line: StartLine. options.timings (default RRS_START_TIMINGS),
  // options.lead: seconds before the warning signal the clock starts.
  constructor(line, options = {}) {
    this.line = line;
    this.timings = { ...RRS_START_TIMINGS, ...(options.timings || {}) };
    this.lead = options.lead || 0;
    this.clock = -(this.timings.warning + this.lead);
    this.prevClock = this.clock;
    this.states = new Map();
    this.signalClock = -Infinity;
    this.lastSignalId = this.signalAt(this.clock).id;
  }

  // Advance the clock by dt seconds of sim time.
  step(dt) {
    if (!(dt > 0) || !Number.isFinite(dt)) return this;
    this.prevClock = this.clock;
    this.clock += dt;
    const id = this.signal.id;
    if (id !== this.lastSignalId) {
      this.lastSignalId = id;
      this.signalClock = this.clock;
    }
    return this;
  }

  // Racing (RRS definitions) from the preparatory signal.
  get racing() {
    return this.clock >= -this.timings.prep;
  }

  get started() {
    return this.clock >= 0;
  }

  signalAt(clock) {
    const T = this.timings;
    if (clock < -T.warning) return { id: 'none', text: 'Sequence starting', flags: [] };
    if (clock < -T.prep) return { id: 'warning', text: 'Warning · class flag up', flags: ['class'] };
    if (clock < -T.oneMinute) return { id: 'prep', text: 'Preparatory · P flag up', flags: ['class', 'P'] };
    if (clock < 0) return { id: 'oneMinute', text: 'One minute · P flag down', flags: ['class'] };
    return { id: 'start', text: 'START · class flag down', flags: [] };
  }

  get signal() {
    return this.signalAt(this.clock);
  }

  // X flag (individual recall): up while any boat is OCS, at most
  // timings.xFlag after the start.
  get xFlag() {
    if (this.clock < 0 || this.clock > this.timings.xFlag) return false;
    for (const s of this.states.values()) if (s.ocs) return true;
    return false;
  }

  // True during the HUD flash after a signal.
  get flashing() {
    return this.clock - this.signalClock < START_FLASH_S;
  }

  stateFor(boat) {
    let s = this.states.get(boat);
    if (!s) {
      s = { gunChecked: false, ocs: false, wasOcs: false, started: false, startTime: null, lastBowSide: null, lastBow: null, lastClock: null };
      this.states.set(boat, s);
    }
    return s;
  }

  hasStarted(boat) {
    const s = this.states.get(boat);
    return !!(s && s.started);
  }

  // Evaluate the boats after step(dt). Call once per world step.
  update(boats) {
    for (const b of boats) this.updateBoat(b);
    return this;
  }

  updateBoat(boat) {
    const s = this.stateFor(boat);
    const L = this.line;
    const { hull, bow } = boatStartGeometry(boat);
    if (!Number.isFinite(bow.x) || !Number.isFinite(bow.y)) return s;
    const bowSide = L.side(bow);
    if (this.clock >= 0 && !s.started) {
      if (!s.gunChecked) {
        s.gunChecked = true;
        s.ocs = hull.some((p) => {
          const u = L.along(p);
          return L.side(p) > 0 && u >= -START_OCS_EXT_M && u <= L.len + START_OCS_EXT_M;
        });
        s.wasOcs = s.ocs;
      } else if (s.ocs) {
        if (hull.every((p) => L.side(p) <= 0)) s.ocs = false;
      } else if (s.lastBowSide !== null && s.lastBowSide < 0 && bowSide >= 0) {
        const f = s.lastBowSide / (s.lastBowSide - bowSide);
        const px = s.lastBow.x + (bow.x - s.lastBow.x) * f;
        const py = s.lastBow.y + (bow.y - s.lastBow.y) * f;
        const u = L.along({ x: px, y: py });
        if (u >= 0 && u <= L.len) {
          s.started = true;
          const c0 = s.lastClock === null ? this.clock : s.lastClock;
          s.startTime = Math.max(0, c0 + (this.clock - c0) * f);
        }
      }
    }
    s.lastBowSide = bowSide;
    s.lastBow = { x: bow.x, y: bow.y };
    s.lastClock = this.clock;
    return s;
  }

  // 'prestart' | 'ocs' | 'started' | 'notStarted'
  statusOf(boat) {
    const s = this.states.get(boat);
    if (s && s.started) return 'started';
    if (this.clock < 0) return 'prestart';
    if (s && s.ocs) return 'ocs';
    return 'notStarted';
  }
}

// "−0:45" before the signal, "+1:05" after.
export function formatStartClock(clock) {
  const neg = clock < 0;
  const secs = neg ? Math.ceil(-clock - 1e-9) : Math.floor(clock + 1e-9);
  const m = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, '0');
  return (neg ? '−' : '+') + m + ':' + ss;
}

export function startStatusText(seq, boat) {
  const st = seq.statusOf(boat);
  if (st === 'started') return 'Started +' + seq.stateFor(boat).startTime.toFixed(1) + ' s';
  if (st === 'ocs') return 'OCS — return below the line';
  if (st === 'notStarted') return 'Not started';
  return 'Pre-start';
}

const FLAG_HTML = {
  class: '<span class="flag flag-class" title="Class flag">C</span>',
  P: '<span class="flag flag-p" title="P flag"></span>',
  X: '<span class="flag flag-x" title="X flag: individual recall"></span>',
};

// HTML for the start HUD: big clock, signal and flags, boat status.
export function startHudHtml(seq, boat) {
  const sig = seq.signal;
  const flags = sig.flags.slice();
  let text = sig.text;
  if (seq.xFlag) {
    flags.push('X');
    text = 'X flag: individual recall';
  }
  const st = boat ? seq.statusOf(boat) : 'prestart';
  const cls = st === 'ocs' ? 'ocs' : st === 'started' ? 'ok' : '';
  return '<div class="start-clock">' + formatStartClock(seq.clock) + '</div>' +
    '<div class="start-signal">' + flags.map((f) => FLAG_HTML[f]).join('') + ' ' + text + '</div>' +
    (boat ? '<div class="start-boat ' + cls + '">' + startStatusText(seq, boat) + '</div>' : '');
}

function dashed(a, b, color, opacity, dash = 1.2, gap = 0.8) {
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

// Start line overlay for one boat: dashed line between the anchors, short
// faint ticks on the pre-start side, small RC / PIN end labels, one line
// label, and a label on the boat while OCS (red) or just started (green).
// Line colour: amber before the gun, pulsing green while it is the boat's
// next target, red while she is OCS, grey once she has started.
export function startGuides(seq, boat, nowMs = 0) {
  const g = [];
  const L = seq.line;
  const a = L.a;
  const b = L.b;
  const st = boat ? seq.statusOf(boat) : 'prestart';
  let color = START_LINE_COLOR;
  let opacity = 0.85;
  let text = 'START LINE';
  let role = 'markno';
  if (st === 'notStarted') {
    color = START_NEXT_COLOR;
    opacity = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(nowMs / 250));
    text = 'NEXT START';
    role = 'next';
  } else if (st === 'ocs') {
    color = START_OCS_COLOR;
    text = 'START LINE';
    role = 'badge';
  } else if (st === 'started') {
    color = START_DONE_COLOR;
    opacity = 0.5;
    text = '✓ START';
    role = 'rounded';
  }
  g.push(...dashed(a, b, color, opacity, 1.6, 0.8));
  for (let s = 1; s < L.len; s += 2) {
    const x = a.x + L.tx * s;
    const y = a.y + L.ty * s;
    g.push({ type: 'guide', color, opacity: 0.45, x1: x, y1: y, x2: x - L.nx * 1, y2: y - L.ny * 1 });
  }
  const mid = L.mid;
  g.push({ type: 'label', badge: true, x: mid.x - L.nx * 3.6, y: mid.y - L.ny * 3.6, lines: [{ text, role, id: 'start' }] });
  g.push({ type: 'label', badge: true, x: b.x + L.tx * 2.8, y: b.y + L.ty * 2.8 - 0.6, lines: [{ text: 'RC', role: 'markno', id: 'rc' }] });
  g.push({ type: 'label', badge: true, x: a.x - L.tx * 3.2, y: a.y - L.ty * 3.2 - 0.6, lines: [{ text: 'PIN', role: 'markno', id: 'pin' }] });
  if (boat && st === 'ocs') {
    g.push({ type: 'label', badge: true, x: boat.x, y: boat.y + 3.2, lines: [{ text: 'OCS — return', role: 'badge', id: 'ocs' }] });
  } else if (boat && st === 'started') {
    const s = seq.stateFor(boat);
    if (seq.clock - s.startTime < START_LABEL_S) {
      g.push({ type: 'label', badge: true, x: boat.x, y: boat.y + 3.2, lines: [{ text: 'STARTED +' + s.startTime.toFixed(1) + ' s', role: 'cleared', id: 'started' }] });
    }
  }
  return g;
}

// Scenario 14 layout (wind from +Y): start line square to the wind near the
// bottom, a leeward gate 14 m above it, a windward mark near the top, all at
// x ≈ 22, east of the loose map.js circles at (0, 14.5) and (0, 20). The
// committee (starboard) end is east, the pin west. The boat starts well
// below and west of the line on a port beam reach.
export const START_COURSE_LAYOUT = {
  committee: { x: 30, y: -20 },
  pin: { x: 14, y: -20 },
  windward: { x: 22, y: 27 },
  gate: [{ x: 16, y: -6 }, { x: 28, y: -6 }],
  boat: { x: -22, y: -28 },
  boatHeading: Math.PI / 2,
  timings: COMPRESSED_START_TIMINGS,
  lead: 2,
};
