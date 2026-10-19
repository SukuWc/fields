// Live leaderboard: distance only (no time or penalty estimates).
//
// Distance to go on a leg from P to target T, with w the upwind unit vector
// (race wind; from `windFromDeg`, w = (cos, sin) of it, so wind from 90° is
// +Y): d = |T − P|, u = (T − P)·w.
//   beat (u > 0):      L = max(u / cos BEAT_ANGLE_DEG, d). Inside the
//                      laylines every tack combination sails u / cos 50°;
//                      outside them (overstood) the straight line is longer.
//   run / reach:       L = d.
// BEAT_ANGLE_DEG = 50 is the measured VMG-optimal upwind TWA of the sim in
// dev mode (VMG 1.41 m/s vs 1.21 at 40°); running dead downwind is fastest,
// so downwind has no layline.
//
// Targets: a mark's anchor, a gate's midpoint (Gate.anchor), the finish
// line midpoint; before a valid start, the start line midpoint.
// Leg = progress.target (first rounding not done, not the held highlight).
// Distance to finish = current leg + every remaining full leg by the same
// rule, anchor to anchor, incl. remaining laps and the leg to the finish.
//
// Ranking: finished (RaceResults order: corrected time, DSQ last) >
// racing (legs done desc, distance to finish asc; on a looping course
// without a finish: legs done, then current leg distance) > not started /
// OCS (distance to the line). Two neighbours swap only after the better one
// has been ahead for LEADERBOARD_SWAP_S of sim time; a change of group or of
// legs done swaps at once.

import { penaltyNameText, unservedCodes } from './rule-text.js';

export const BEAT_ANGLE_DEG = 50;
export const LEADERBOARD_SWAP_S = 1;
const COS_BEAT = Math.cos(BEAT_ANGLE_DEG * Math.PI / 180);

function anchorOf(m) {
  return m.anchor ? m.anchor : { x: m.x, y: m.y };
}

export function upwindVector(windFromDeg) {
  const a = windFromDeg * Math.PI / 180;
  return { x: Math.cos(a), y: Math.sin(a) };
}

// { dist, kind: 'beat' | 'run' | 'reach' }.
export function legDistance(p, t, w) {
  const dx = t.x - p.x;
  const dy = t.y - p.y;
  const d = Math.hypot(dx, dy);
  const u = dx * w.x + dy * w.y;
  const off = d > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, u / d))) * 180 / Math.PI : 0;
  const kind = off < 60 ? 'beat' : off > 120 ? 'run' : 'reach';
  return { dist: u > 0 ? Math.max(u / COS_BEAT, d) : d, kind };
}

export const KIND_ARROW = { beat: '↑', run: '↓', reach: '→' };

function elementTarget(course, k) {
  return anchorOf(course.marks[((k % course.length) + course.length) % course.length]);
}

// Per-boat state. status: 'finished' | 'racing' | 'prestart' | 'ocs' |
// 'notStarted'. legsDone = progress.target; leg = legsDone + 1 of legs
// (roundings + 1 for the finish leg; Infinity when the course loops).
export function legState(course, seq, results, boat, w) {
  const p = course.progressFor(boat);
  const entry = results ? results.entryFor(boat) : null;
  const total = course.totalRoundings;
  const hasFinish = !!course.finish && Number.isFinite(total);
  const legs = hasFinish ? total + 1 : Number.isFinite(total) ? total : Infinity;
  const pos = { x: boat.x, y: boat.y };
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return { boat, status: 'notStarted', legsDone: -1, leg: 0, legs, legM: Infinity, toFinishM: Infinity, kind: 'reach', label: '–' };
  if (entry) return { boat, status: 'finished', legsDone: legs, leg: legs, legs, legM: 0, toFinishM: 0, kind: 'run', label: 'Fin', entry };
  if (p.waitingForStart) {
    const st = seq ? seq.statusOf(boat) : 'notStarted';
    const T = seq ? seq.line.mid : course.start;
    const l = legDistance(pos, T, w);
    return { boat, status: st === 'ocs' ? 'ocs' : st === 'prestart' ? 'prestart' : 'notStarted', legsDone: -1, leg: 0, legs, legM: l.dist, toFinishM: Infinity, kind: l.kind, label: st === 'ocs' ? 'OCS' : 'Start' };
  }
  const k = p.target;
  const T = k < total ? elementTarget(course, k) : course.finish.mid;
  const l = legDistance(pos, T, w);
  let toFinish = Infinity;
  if (hasFinish) {
    toFinish = l.dist;
    let prev = T;
    for (let j = k + 1; j < total; j++) {
      const nt = elementTarget(course, j);
      toFinish += legDistance(prev, nt, w).dist;
      prev = nt;
    }
    if (k < total) toFinish += legDistance(prev, course.finish.mid, w).dist;
  }
  const leg = k + 1;
  const label = k >= total ? 'Finish' : 'Leg ' + leg + (Number.isFinite(legs) ? '/' + legs : '');
  return { boat, status: 'racing', legsDone: k, leg, legs, legM: l.dist, toFinishM: toFinish, kind: l.kind, label };
}

const GROUP = { finished: 0, racing: 1, prestart: 2, ocs: 2, notStarted: 2 };

// < 0 if a ranks ahead of b. strict: the difference is by group, finish
// order or legs (swaps at once).
function compare(a, b, results) {
  const ga = GROUP[a.status];
  const gb = GROUP[b.status];
  if (ga !== gb) return { c: ga - gb, strict: true };
  if (ga === 0) return { c: results.entries.indexOf(a.entry) - results.entries.indexOf(b.entry), strict: true };
  if (ga === 1) {
    if (a.legsDone !== b.legsDone) return { c: b.legsDone - a.legsDone, strict: true };
    const fa = Number.isFinite(a.toFinishM) ? a.toFinishM : a.legM;
    const fb = Number.isFinite(b.toFinishM) ? b.toFinishM : b.legM;
    return { c: fa - fb, strict: false };
  }
  return { c: a.legM - b.legM, strict: false };
}

export class Leaderboard {
  constructor(course, options = {}) {
    this.course = course;
    this.seq = options.startSequence || course.startSequence || null;
    this.results = options.results || null;
    this.order = [];
    this.states = new Map();
    this.pending = new Map();
    this.time = 0;
  }

  // boats in player order; simTime in seconds; windFromDeg the race wind.
  update(boats, simTime, windFromDeg) {
    this.time = simTime;
    const w = upwindVector(windFromDeg);
    this.boats = boats;
    for (const b of boats) this.states.set(b, legState(this.course, this.seq, this.results, b, w));
    this.order = this.order.filter((b) => boats.includes(b));
    const added = boats.some((b) => !this.order.includes(b));
    for (const b of boats) if (!this.order.includes(b)) this.order.push(b);
    // Strict differences sort at once (stable), then hysteresis passes. A
    // new boat (or the first update) gets a full sort with no hysteresis.
    const st = (b) => this.states.get(b);
    this.order.sort((a, b) => {
      const r = compare(st(a), st(b), this.results);
      return r.strict || added ? r.c : 0;
    });
    const wanted = new Set();
    for (let i = 0; i + 1 < this.order.length; i++) {
      const a = this.order[i];
      const b = this.order[i + 1];
      const r = compare(st(b), st(a), this.results);
      if (r.c < 0 && !r.strict) {
        const key = this.keyOf(b, a);
        wanted.add(key);
        if (!this.pending.has(key)) this.pending.set(key, simTime);
        if (simTime - this.pending.get(key) >= LEADERBOARD_SWAP_S) {
          this.order[i] = b;
          this.order[i + 1] = a;
          this.pending.delete(key);
          wanted.delete(key);
        }
      }
    }
    for (const key of [...this.pending.keys()]) if (!wanted.has(key)) this.pending.delete(key);
    return this;
  }

  keyOf(a, b) {
    const boats = this.boats || [];
    return boats.indexOf(a) + '>' + boats.indexOf(b);
  }

  // [{ position, boat (index), status, label, leg, legs, kind, legM,
  //    toFinishM, gapM, entry }]
  rows() {
    const boats = this.boats || [];
    const leader = this.order.map((b) => this.states.get(b)).find((s) => s.status === 'racing');
    return this.order.map((b, i) => {
      const s = this.states.get(b);
      let gapM = null;
      if (s.status === 'racing' && leader) {
        const ref = Number.isFinite(leader.toFinishM) ? leader.toFinishM - s.toFinishM : (leader.legsDone === s.legsDone ? leader.legM - s.legM : null);
        gapM = ref === null ? null : -ref;
      }
      return { position: i + 1, boat: boats.indexOf(b), status: s.status, label: s.label, leg: s.leg, legs: s.legs, kind: s.kind, legM: s.legM, toFinishM: s.toFinishM, gapM, entry: s.entry || null };
    });
  }

  toData() {
    return this.rows().map(({ entry, ...r }) => r);
  }
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0');
}

// One row per boat: "1  boat 0  Leg 2/3 ↑  42 m  +0 m"; finished rows
// keep the results text: "1  boat 0  Fin 3:08.4 (+20 s Rule 31)".
export function leaderboardRowText(r) {
  const head = r.position + '  boat ' + r.boat + '  ';
  if (r.status === 'finished' && r.entry) {
    const e = r.entry;
    const note = e.unserved.length ? (e.dsq ? ' DSQ (' + e.unserved.join(', ') + ')' : ' (+' + e.penaltyS + ' s ' + e.unserved.join(', ') + ')') : '';
    return head + 'Fin ' + fmtTime(e.elapsed) + note;
  }
  const m = Number.isFinite(r.legM) ? Math.round(r.legM) + ' m' : '–';
  const gap = r.gapM === null || !Number.isFinite(r.gapM) ? '' : '  +' + Math.max(0, Math.round(r.gapM)) + ' m';
  return head + r.label + ' ' + (KIND_ARROW[r.kind] || '') + '  ' + m + gap;
}

export function leaderboardHtml(lb, highlightBoat = 0) {
  return leaderboardHtmlOf(leaderboardState(lb), highlightBoat);
}

const LABEL_CODE = { '–': '-', Fin: 'F', Start: 'S', OCS: 'O', Finish: 'E' };
const LABEL_TEXT = { '-': '–', F: 'Fin', S: 'Start', O: 'OCS', E: 'Finish' };

// The rows as data (hud.js): rows() with the label as a code ('L' = "Leg
// n/m" from leg and legs) and the finish entry reduced to what is shown
// (unserved: penalty codes, rule-text.js penaltyNameText).
export function leaderboardState(lb) {
  return lb.rows().map((r) => ({
    position: r.position, boat: r.boat, status: r.status,
    label: r.label in LABEL_CODE ? LABEL_CODE[r.label] : (r.label === legLabel(r.leg, r.legs) ? 'L' : r.label),
    leg: r.leg, legs: Number.isFinite(r.legs) ? r.legs : null, kind: r.kind, legM: Number.isFinite(r.legM) ? r.legM : null,
    gapM: r.gapM === null || !Number.isFinite(r.gapM) ? null : r.gapM,
    entry: r.entry ? { elapsed: r.entry.elapsed, unserved: unservedCodes(r.entry), dsq: r.entry.dsq ? 1 : 0, penaltyS: r.entry.penaltyS } : null,
  }));
}

function legLabel(leg, legs) {
  return 'Leg ' + leg + (Number.isFinite(legs) ? '/' + legs : '');
}

export function leaderboardHtmlOf(rowsState, highlightBoat = 0) {
  const rows = rowsState.map((r) => ({
    ...r,
    entry: r.entry ? { ...r.entry, unserved: r.entry.unserved.map(penaltyNameText) } : r.entry,
    label: r.label === 'L' ? legLabel(r.leg, r.legs) : (r.label in LABEL_TEXT ? LABEL_TEXT[r.label] : r.label),
    legM: r.legM === null ? Infinity : r.legM,
  }));
  const out = rows.map((r) => {
    const cls = 'finish-row' + (r.boat === highlightBoat ? ' me' : '') + (r.entry && r.entry.unserved.length ? ' pen' : '') + (r.status === 'finished' ? ' fin' : '');
    return '<div class="' + cls + '">' + leaderboardRowText(r) + '</div>';
  });
  return '<div class="finish-title">Leaderboard</div>' + (out.length ? out.join('') : '<div class="finish-row">no boats</div>');
}
