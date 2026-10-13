// Scripted race controller for dev-mode test races (scenario 17). It does
// not steer: it only sets the EXISTING heading/TWA autopilot target
// (boat.autopilot_heading_target = −TWA, positive TWA = port tack) and lets
// boat.js steer, tack and bear away.
//
// Phases per boat:
//   wait   reach in (TWA toward the point) along a column below the line to
//          the common turn-up point, so the boats start one after another
//          on the same track (about 3–4 s apart);
//   beat   close-hauled (BEAT_TWA) on port, then one tack (target sign flip,
//          like Enter) onto starboard once the mark bears LAY_DEG or more
//          from the wind on the starboard side (the starboard layline plus
//          a small per-boat overstand margin); a fallback tack happens at the
//          east wall corridor;
//   run    once the mark is abaft her beam (rounded to port, approached on
//          starboard): bear away and steer for the finish line midpoint on
//          starboard (TWA clamped to RUN_MAX_TWA so she never gybes);
//   done   after she finishes: sail to the parking spot for her finish
//          place (layout parkSpots, well apart) and keep station there
//          (head to wind at or above it, else sail toward it).
// Keep clear: if another boat is within KEEP_CLEAR_M in front of her bow, a
// beating boat pinches (PINCH_TWA, slower) and does not tack yet, and a
// boat on the run bears away 15°.
// If the user takes the helm (rudder keys turn the autopilot off, or the
// target is changed), the bot stops for that boat.

import { trueWindAngleDeg } from './rules.js';
import { Boat } from './boat.js';
import { Mark, markMassForBoat } from './mark.js';
import { Course } from './course.js';
import { StartLine, StartSequence, COMPRESSED_START_TIMINGS } from './start.js';
import { FinishLine, RaceResults } from './finish.js';
import { Leaderboard } from './leaderboard.js';

export const BEAT_TWA = 50;
export const WAIT_TWA = 28;
export const LAY_DEG = 51;
export const PINCH_TWA = 38;
export const RUN_MAX_TWA = 178;
export const KEEP_CLEAR_M = 8;
export const PARK_TWA = 35;
export const PARK_R_M = 2.5;

function anchorOf(m) {
  return m.anchor ? m.anchor : { x: m.x, y: m.y };
}

function wrap180(d) {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

// Signed TWA of sailing from p toward t (positive = port tack).
function twaToward(p, t, windFromDeg) {
  const h = Math.atan2(t.x - p.x, -(t.y - p.y));
  return trueWindAngleDeg(h, windFromDeg);
}

export class RaceBot {
  // opts: { mark, finish (FinishLine), startAt (race clock s), margin (deg) }
  constructor(boat, opts) {
    this.boat = boat;
    this.mark = opts.mark;
    this.finish = opts.finish;
    this.turnUp = opts.turnUp || null;
    this.parkSpots = opts.parkSpots || null;
    this.margin = opts.margin || 0;
    this.phase = 'wait';
    this.stopped = false;
    this.target = null;
    this.tacks = 0;
  }

  set(twa) {
    const b = this.boat;
    this.target = -twa;
    b.autopilot_heading_target = this.target;
    b.autopilot_enabled = true;
  }

  // User took over: autopilot off (rudder keys) or target changed by hand.
  checkUser() {
    const b = this.boat;
    if (this.target === null) return false;
    if (!b.autopilot_enabled || b.penalty_turn || Math.abs(b.autopilot_heading_target - this.target) > 1e-6) {
      this.stopped = true;
      this.phase = 'user';
    }
    return this.stopped;
  }

  // Another boat within KEEP_CLEAR_M in front of her (±60° of her bow).
  boatAhead(others) {
    const b = this.boat;
    const fx = Math.sin(b.hull_angle);
    const fy = -Math.cos(b.hull_angle);
    for (const o of others) {
      if (o === b) continue;
      const dx = o.x - b.x;
      const dy = o.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d < KEEP_CLEAR_M && (dx * fx + dy * fy) / (d || 1) > 0.5) return o;
    }
    return null;
  }

  // One control step. clock: race clock (s since the gun); windFromDeg;
  // boats: all boats; finished: has this boat finished.
  step(clock, windFromDeg, boats, finished, place = 1) {
    if (this.stopped || this.checkUser()) return;
    const b = this.boat;
    const p = { x: b.x, y: b.y };
    const m = anchorOf(this.mark);
    if (finished && this.phase !== 'done') this.phase = 'done';
    if (this.phase === 'wait') {
      // Reach in along the start column to the turn-up point, then beat.
      const w = this.turnUp;
      if (!w || p.x >= w.x) this.phase = 'beat';
      else return this.set(twaToward(p, w, windFromDeg));
    }
    if (this.phase === 'beat') {
      const port = (this.target === null ? 1 : -this.target) > 0;
      // Bearing of the mark from the wind: + east of upwind (port side of
      // the course seen from below), − west.
      const brg = wrap180(Math.atan2(m.x - p.x, m.y - p.y) * 180 / Math.PI - (90 - windFromDeg));
      const ahead = this.boatAhead(boats);
      if (port) {
        if (brg <= -(LAY_DEG + this.margin) && !ahead) this.tacks++, this.set(-BEAT_TWA);
        else this.set(ahead ? PINCH_TWA : BEAT_TWA);
      } else {
        // Abaft the beam on starboard: rounded to port, bear away.
        const fx = Math.sin(b.hull_angle);
        const fy = -Math.cos(b.hull_angle);
        if ((m.x - p.x) * fx + (m.y - p.y) * fy < 0 && p.y > m.y) this.phase = 'run';
        else this.set(ahead ? -PINCH_TWA : -BEAT_TWA);
      }
    }
    if (this.phase === 'run' && finished) this.phase = 'done';
    if (this.phase === 'run') {
      const f = this.finish.mid;
      let twa = twaToward(p, f, windFromDeg);
      // Stay on starboard (no gybe): TWA negative, |TWA| ≤ RUN_MAX_TWA.
      twa = twa < 0 ? Math.max(twa, -RUN_MAX_TWA) : -RUN_MAX_TWA;
      if (Math.abs(twa) < 60) twa = -60;
      if (this.boatAhead(boats)) twa = Math.max(-RUN_MAX_TWA, twa - 15);
      this.set(twa);
    }
    // Finished: sail to her parking spot (by finish place, well apart) and
    // keep station there: head to wind when at or above it, else sail
    // toward it (at least PARK_TWA off the wind).
    if (this.phase === 'done') {
      if (this.donePlace === undefined) this.donePlace = place;
      const spots = this.parkSpots || [];
      const spot = spots[(this.donePlace - 1) % Math.max(1, spots.length)];
      if (!spot) return this.set(-PARK_TWA);
      const dx = spot.x - p.x;
      const dy = spot.y - p.y;
      if (Math.hypot(dx, dy) < PARK_R_M || dy < 0) return this.set(0);
      let twa = twaToward(p, spot, windFromDeg);
      if (Math.abs(twa) < PARK_TWA) twa = (dx < 0 ? -1 : 1) * PARK_TWA;
      this.set(twa);
    }
  }
}

// Scenario 17 layout (wind from +Y, dev mode). Start line y = −22 from the
// pin (−18, −22) to the committee boat (2, −22), windward mark (14, 16) to
// port, finish line y = −18 from (5, −18) to (21, −18), downwind of the
// mark and east of the beat. The boats come in line astern on a port beam
// reach along y = −28, 10 m apart, and head up at the turn-up point
// (−8, −28) a few seconds before the gun, so they sail the same beat in
// sequence (one tack onto the starboard layline) instead of meeting at the
// tacks. Everything stays inside the walls and clear of the map.js
// circles at (0, 14.5) and (0, 20).
export const TEST_RACE_LAYOUT = {
  committee: { x: 16, y: -22 },
  pin: { x: -14, y: -22 },
  turnUp: { x: -8, y: -28 },
  mark: { x: 8, y: 10 },
  finishBoat: { x: 4, y: -14 },
  finishPin: { x: -24, y: -14 },
  clock: -3.5,
  // After finishing, P1 / P2 / P3 park here (west of the finish, 10+ m apart).
  parkSpots: [{ x: -25, y: 10 }, { x: -27, y: -3 }, { x: -15, y: 3 }],
  boats: [
    { x: -11.8, y: -26.6, margin: 2 },
    { x: -23.1, y: -22.5, margin: 2 },
    { x: -34.4, y: -18.4, margin: 2 },
  ],
};

// Build the test race on a map: boats, marks, start sequence (clock just
// before the gun), course [mark] with one lap and the finish, results,
// leaderboard and one RaceBot per boat. Used by scenario 17 and the check.
export function setupTestRace(map, L = TEST_RACE_LAYOUT) {
  const boats = L.boats.map((q) => {
    // Port broad reach (TWA 110) toward the turn-up point.
    const h = 70 * Math.PI / 180;
    const b = new Boat(map, q.x, q.y, h);
    b.physics_model.setLinearVelocity({ x: Math.sin(h) * 2.4, y: -Math.cos(h) * 2.4 });
    return b;
  });
  const mass = markMassForBoat(boats[0].physics_model);
  const mk = (q) => new Mark(map, q.x, q.y, { mass });
  const rc = mk(L.committee);
  const pin = mk(L.pin);
  const mark = mk(L.mark);
  const fb = mk(L.finishBoat);
  const fp = mk(L.finishPin);
  const line = new StartLine(rc, pin, L.mark);
  const seq = new StartSequence(line, { timings: COMPRESSED_START_TIMINGS, clock: L.clock });
  const finish = new FinishLine(fb, fp, L.mark);
  const course = new Course([mark], { start: line.mid, startSequence: seq, laps: 1, finish });
  const results = new RaceResults(course);
  const leaderboard = new Leaderboard(course, { startSequence: seq, results });
  const bots = boats.map((b, i) => new RaceBot(b, { mark, finish, turnUp: L.turnUp, parkSpots: L.parkSpots, margin: L.boats[i].margin }));
  return { boats, marks: [rc, pin, mark, fb, fp], seq, course, results, leaderboard, bots };
}
