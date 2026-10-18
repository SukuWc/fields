// Finish procedure (RRS definition 'Finish', rules 28, 44.2, 44.3).
//
// FinishLine: the segment between the anchors of two Marks (finish boat and
// finish pin), the last step of a course (Course option finish). Its normal
// points away from `from` (the last course element), so "forward" means
// crossing from the course side, the way a boat arrives from the last mark.
//
// A boat FINISHES when, with progress.courseComplete (valid start, every
// mark and gate of every lap in order; see course.js) and not finished yet,
// her BOW POINT crosses the segment forward (the same bow point start.js
// uses for the start). Crossing before the course is complete, backward, or
// outside the ends counts for nothing. A boat that has not started (or is
// OCS and has not returned) never has a complete course, so cannot finish.
// The crossing time is interpolated within the step.
//
// Time: race clock seconds. With a start sequence that is seq.clock (time
// since the gun); without one, the caller's sim time since the scenario
// started. elapsed = finish clock − 0 (the gun), not the boat's own start
// time, as in RRS scoring.
//
// Pending penalties (decision, documented in CLAUDE.md):
// - RRS 44.2: a penalty must be taken before finishing. A boat with a
//   pending penalty can still clear it (tack + gybe or Q/E circle) on the
//   course side before she crosses; finishing is the bow crossing, so a bow
//   that pokes over while turning before the course is done does not matter.
// - Crossing with UNSERVED penalties still records her as finished, but each
//   converts (game choice inspired by RRS 44.3, the Scoring Penalty):
//     UNSERVED_PENALTY_MODE 'time' (default): + FINISH_UNSERVED_PENALTY_S per
//       penalty to her corrected time; results are ordered by corrected time.
//     'dsq': she is listed below every boat that finished cleanly, as DSQ
//       with the rules.
//   The default 20 s is about twice what a tack + gybe penalty turn costs a
//   boat in this sim (≈ 8–10 s), so taking the turn is always better.
// - After finishing she is no longer racing: rules.finishBoatPenalties marks
//   her finished and chargePendingPenalty ignores her, so contacts or mark
//   touches after the finish (e.g. hitting the finish boat) add nothing.
//   Simplification: RRS says she stops racing once clear of the line and
//   marks; here it is the moment she finishes.

import { boatStartGeometry } from './start.js';
import { finishBoatPenalties, penaltyRuleName } from './rules.js';

export const FINISH_UNSERVED_PENALTY_S = 20;
export const UNSERVED_PENALTY_MODE = 'time';
// "Finished P1" label on the boat for this long (sim seconds).
export const FINISH_LABEL_S = 6;
export const FINISH_LINE_COLOR = 0xffffff;
export const FINISH_NEXT_COLOR = 0x7dff5a;

function anchorOf(mark) {
  return mark.anchor ? mark.anchor : { x: mark.x, y: mark.y };
}

export class FinishLine {
  // committee, pin: Mark instances (or {x, y} / {anchor}). from: a point on
  // the course side (the last mark); forward crossing goes away from it.
  constructor(committee, pin, from) {
    this.committee = committee;
    this.pin = pin;
    const a = this.a;
    const b = this.b;
    this.len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(this.len > 0)) throw new Error('Finish line needs two separate ends');
    this.tx = (b.x - a.x) / this.len;
    this.ty = (b.y - a.y) / this.len;
    let nx = -this.ty;
    let ny = this.tx;
    const mid = this.mid;
    if (from && nx * (mid.x - from.x) + ny * (mid.y - from.y) < 0) { nx = -nx; ny = -ny; }
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

  // Signed distance: < 0 on the course side, > 0 once across.
  side(p) {
    const a = this.a;
    return (p.x - a.x) * this.nx + (p.y - a.y) * this.ny;
  }

  along(p) {
    const a = this.a;
    return (p.x - a.x) * this.tx + (p.y - a.y) * this.ty;
  }
}

export function formatRaceTime(s) {
  if (!Number.isFinite(s)) return '–';
  const neg = s < 0;
  const t = Math.abs(s);
  const m = Math.floor(t / 60);
  const ss = (t - m * 60).toFixed(1).padStart(4, '0');
  return (neg ? '−' : '') + m + ':' + ss;
}

// Records finishes for one course. options.mode ('time' | 'dsq'),
// options.penaltyS (seconds per unserved penalty).
export class RaceResults {
  constructor(course, options = {}) {
    this.course = course;
    this.mode = options.mode || UNSERVED_PENALTY_MODE;
    this.penaltyS = Number.isFinite(options.penaltyS) ? options.penaltyS : FINISH_UNSERVED_PENALTY_S;
    this.entries = [];
    this.states = new Map();
  }

  // Race clock without a start sequence: sim time since the first call
  // (the scenario start).
  relClock(simTime) {
    if (this.origin === undefined) this.origin = simTime;
    return simTime - this.origin;
  }

  isFinished(boat) {
    return this.entries.some((e) => e.boat === boat);
  }

  entryFor(boat) {
    return this.entries.find((e) => e.boat === boat) || null;
  }

  // Call once per world step after course progress. clock: race clock now
  // (see the header). boats: in player order (their index is the boat no).
  update(boats, clock) {
    const line = this.course.finish;
    if (!line || !Number.isFinite(clock)) return [];
    const done = [];
    boats.forEach((boat, i) => {
      if (this.isFinished(boat)) return;
      let s = this.states.get(boat);
      if (!s) { s = { lastSide: null, lastBow: null, lastClock: null }; this.states.set(boat, s); }
      const { bow } = boatStartGeometry(boat);
      if (!Number.isFinite(bow.x) || !Number.isFinite(bow.y)) return;
      const side = line.side(bow);
      const progress = this.course.progressFor(boat);
      if (s.lastSide !== null && s.lastSide < 0 && side >= 0 && progress.courseComplete) {
        const f = s.lastSide / (s.lastSide - side);
        const u = line.along({ x: s.lastBow.x + (bow.x - s.lastBow.x) * f, y: s.lastBow.y + (bow.y - s.lastBow.y) * f });
        if (u >= 0 && u <= line.len) {
          const t = s.lastClock + (clock - s.lastClock) * f;
          done.push(this.record(boat, i, t));
        }
      }
      s.lastSide = side;
      s.lastBow = { x: bow.x, y: bow.y };
      s.lastClock = clock;
    });
    return done;
  }

  // Record a finish at race clock t (also usable directly by tests).
  record(boat, index, t) {
    const unserved = finishBoatPenalties(boat).map((q) => penaltyRuleName(q.incident));
    const n = unserved.length;
    const dsq = n > 0 && this.mode === 'dsq';
    const added = !dsq && n > 0 ? n * this.penaltyS : 0;
    const e = {
      boat,
      index,
      finishTime: t,
      elapsed: t,
      unserved,
      penaltyS: added,
      corrected: dsq ? Infinity : t + added,
      dsq,
      order: this.entries.length + 1,
    };
    this.entries.push(e);
    this.sort();
    return e;
  }

  sort() {
    this.entries.sort((a, b) => (a.dsq - b.dsq) || (a.corrected - b.corrected) || (a.finishTime - b.finishTime));
    let p = 0;
    for (const e of this.entries) e.position = e.dsq ? null : ++p;
  }

  // Plain data for scoring: [{ position, boat (index), finishTime, elapsed,
  // unserved: ['Rule 31'], penaltyS, corrected, dsq, order }].
  toData() {
    return this.entries.map((e) => ({ position: e.position, boat: e.index, finishTime: e.finishTime, elapsed: e.elapsed, unserved: e.unserved.slice(), penaltyS: e.penaltyS, corrected: Number.isFinite(e.corrected) ? e.corrected : null, dsq: e.dsq, order: e.order }));
  }
}

export function penaltyNote(e) {
  if (!e.unserved.length) return '';
  const rules = e.unserved.join(', ');
  return e.dsq ? 'DSQ (' + rules + ')' : '+' + e.penaltyS + ' s (' + rules + ')';
}

// Results panel HTML: position, boat, elapsed, penalty note, corrected.
export function resultsHtml(results) {
  const rows = results.entries.map((e) => {
    const pos = e.dsq ? 'DSQ' : 'P' + e.position;
    const note = penaltyNote(e);
    const corr = e.penaltyS ? ' → ' + formatRaceTime(e.corrected) : '';
    return '<div class="finish-row' + (note ? ' pen' : '') + '">' + pos + ' · boat ' + e.index + ' · ' + formatRaceTime(e.elapsed) + (note ? ' · ' + note + corr : '') + '</div>';
  });
  return '<div class="finish-title">Results</div>' + (rows.length ? rows.join('') : '<div class="finish-row">no finishers yet</div>');
}

// Finish line overlay: dashed line between the ends (green while it is
// boat 0's next step), "FINISH" / "NEXT FINISH" label, and a "Finished P1"
// badge on each boat for FINISH_LABEL_S after she finishes.
export function finishGuides(course, progress, results, boats, clock, nowMs = 0) {
  const line = course && course.finish;
  if (!line) return [];
  return finishGuidesFromState(finishLineState(line), finishGuideState(course, progress, results, boats, clock), nowMs);
}

// The finish line as plain data.
export function finishLineState(line) {
  return { a: line.a, b: line.b, len: line.len, tx: line.tx, ty: line.ty, mid: line.mid };
}

// What finishGuides needs this tick (scene-state.js): whether the finish is
// next, and the "Finished" badges with their boat positions.
export function finishGuideState(course, progress, results, boats, clock) {
  const next = !!progress && progress.finishNext && !(results && results.isFinished(progress.boat));
  const labels = [];
  if (results) {
    for (const e of results.entries) {
      if (!(clock - e.finishTime <= FINISH_LABEL_S)) continue;
      const boat = boats ? boats[e.index] : e.boat;
      if (!boat) continue;
      // The result as data; finishGuidesFromState writes the text.
      labels.push({ x: boat.x, y: boat.y, dsq: e.dsq ? 1 : 0, position: e.position, unserved: e.unserved.slice(), penaltyS: e.penaltyS });
    }
  }
  return { next, labels };
}

export function finishGuidesFromState(line, s, nowMs = 0) {
  const g = [];
  const next = s.next;
  const a = line.a;
  const len = line.len;
  const pulse = 0.5 + 0.5 * Math.sin(nowMs / 250);
  const color = next ? FINISH_NEXT_COLOR : FINISH_LINE_COLOR;
  for (let k = 0; k < len; k += 2) {
    const e = Math.min(len, k + 1.2);
    g.push({ type: 'guide', color, opacity: next ? 0.6 + 0.4 * pulse : 0.55, x1: a.x + line.tx * k, y1: a.y + line.ty * k, x2: a.x + line.tx * e, y2: a.y + line.ty * e });
  }
  const m = line.mid;
  g.push({ type: 'label', badge: true, x: m.x, y: m.y + 1.6, lines: [{ text: next ? 'NEXT FINISH' : 'FINISH', role: next ? 'next' : 'markno', id: 'finish' }] });
  for (const l of s.labels) {
    const text = (l.dsq ? 'Finished · DSQ' : 'Finished P' + l.position) + (l.unserved.length ? ' · ' + penaltyNote(l) : '');
    g.push({ type: 'label', badge: true, x: l.x, y: l.y + 3.3, lines: [{ text, role: l.unserved.length ? 'turn' : 'cleared', id: 'fin' }] });
  }
  return g;
}

// Scenario 16 layout (wind from +Y): scenario 14's start line (y = −20),
// leeward gate (y = −6) and windward mark (22, 27), one lap, then a finish
// line upwind of the gate: finish boat (east) at (32, 10), pin at (8, 10),
// 24 m wide, crossed northward on the beat from the gate. It sits 12.8 m
// from the map.js circle at (0, 20) and inside the walls. Both boats start
// already started (clock +3:00) with the course complete, on starboard
// close-hauled just above the gate: boat 1 ahead and to leeward, boat 0
// about 12 m behind to windward.
export const FINISH_COURSE_LAYOUT = {
  committee: { x: 30, y: -20 },
  pin: { x: 14, y: -20 },
  windward: { x: 22, y: 27 },
  gate: [{ x: 16, y: -6 }, { x: 28, y: -6 }],
  finishBoat: { x: 32, y: 10 },
  finishPin: { x: 8, y: 10 },
  laps: 1,
  clock: 180,
  boats: [
    { x: 31, y: -5, heading: 5 * Math.PI / 4 },
    { x: 20, y: 1, heading: 5 * Math.PI / 4 },
  ],
};
