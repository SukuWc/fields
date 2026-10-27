// Racing Rules of Sailing.
//
// Implemented: the 12 m interest gate, Rule 10 (opposite tacks), Rule 11
// (same tack, overlapped), Rule 12 (same tack, clear astern), Rule 13
// (while tacking), and Rule 15 (acquiring right of way).
//
// Registry. Each rule is an evaluator in `ruleRegistry`: an id, a layer
// (`sectionA` or `timedInhibitor`), what it inhibits, and an evaluate
// function. An evaluator only checks its own conditions. It may keep state
// on the boat (Rule 13's tacking flag) or on the pair (Rule 15's timer);
// the resolver only reads the current outputs. Adding a later rule (16, 17,
// mark room, Rule 14) is a new entry plus its evaluate function.
//
// Resolver. For one pair it reports every rule whose conditions hold, which
// of those are inhibited and by which id, the single final rule, the
// right-of-way and keep-clear boats, and who would be at fault on contact.
// Section A is mutually exclusive: Rule 13 inhibits 10, 11, and 12, and
// exactly one Section A rule is left. Rule 15 is a timed inhibitor. While
// its window is open the rule it blocks does not decide right of way or
// fault, and contact is charged to the new right-of-way boat. The debug
// overlay still draws only that final rule, so the picture matches the
// old single-label dispatcher.
//
// Pairs. Every physics step evaluates each unordered pair inside the 12 m
// gate, n(n−1)/2, under a stable key. Pair state lives in one map. A pair
// that leaves the gate, or a boat that is gone, drops its state.
//
// Distance. 1 world unit = 1 m. The hull in boat.js runs from local y = -2.25
// (bow) to y = 1.75 (stern), so boat length is 4 m. Section A is considered
// only when the closest distance between the two hull polygons is
// <= 3 × 4 m = 12 m. Vertices are the fixture's body-local points transformed
// by the physics body (getWorldPoint), which is the same hull the Planck
// fixture collides with. The debug line is drawn between body origins
// (boat.x / boat.y), near the geometric center of that hull. If a boat has
// no hull polygon, the gate falls back to center-to-center distance, and
// Rules 11 and 12 do not apply (overlap is defined on the hull polygons).
//
// Wind and tack. getWind(x, y) is Map.get_wind, so dev mode (ConstantWind) and
// the lattice (FluidWind) share one path. `direction` is degrees, where the
// wind comes from: atan2(vy, vx) * 180/π + 180. 0 = from +X, 90 = from +Y.
// Heading is boat.hull_angle, which the sim copies from the Planck body angle
// each step. Local bow is −Y, so forward (her course) is (sin θ, −cos θ).
// True-wind angle matches Boat.physics_model_step:
//   twa = wrap180(windFromDeg − headingDeg + 90)
//   twa = 0 is head to wind. Positive twa is wind on the port side.
//   twa > 0 and < 180 → port tack. twa < 0 and > −180 → starboard tack.
//   Head to wind (0) and dead downwind (±180) are not a tack.
//
// Clear astern and overlap (RRS definitions, pairwise). A boat is clear
// astern of another when every hull vertex is strictly behind a line through
// the other's aftermost hull vertex, perpendicular to the other's course.
// The other boat is clear ahead. They are overlapped when neither is clear
// astern. The hull is convex, so vertices are enough: if they are all behind
// the line, the polygon is too. The three-boat "a boat between them overlaps
// both" extension is not applied. If each boat is clear astern of the other
// (courses pointing apart), there is no single clear-ahead boat, so Rule 12
// does not draw.
//
// Rule 10: on opposite tacks, the port-tack boat keeps clear of the
// starboard-tack boat. Starboard is right-of-way (green half), port is
// give-way (red half).
//
// Rule 11: same tack and overlapped. The windward boat keeps clear of the
// leeward boat. Windward is the boat farther toward the wind source, measured
// by projecting body origins onto the unit vector (cos φ, sin φ), where φ is
// the wind-from angle (the circular mean of the two samples). Leeward is
// right-of-way (green); windward is give-way (red). A tie draws nothing.
//
// Rule 12: same tack and not overlapped. The clear-astern boat keeps clear
// of the clear-ahead boat. Clear ahead is right-of-way (green); clear astern
// is give-way (red).
//
// Rule 13: after a boat passes head to wind, and until she is on a
// close-hauled course, she keeps clear of the other boat. She has no right
// of way under Rules 10–12 during that window. Close-hauled here is
// |TWA| >= CLOSE_HAULED_TWA_DEG (40°). The window starts when true-wind
// angle changes sign through the eye of the wind (the short way across 0°,
// not a gybe through dead downwind). It ends when |TWA| reaches 40° on the
// tack she just entered. A reverse crossing before that restarts the window
// on the side she returned to; if that sample is already close-hauled, the
// flag clears immediately (she aborted back onto a close-hauled course).
// Luffing toward head to wind without passing it is not Rule 13.
//
// One boat tacking: she is give-way (red), the other is right-of-way (green),
// label "Rule 13". Both tacking: each must keep clear of the other, so
// neither is green. Both halves are red and the label is "Rule 13 both".
// Rule 13 does not draw the stern mark. Pairs in which neither boat is
// tacking still use Rules 10–12, including other boats racing each other
// while a third boat is tacking.
//
// Rule 15: when a boat acquires right of way she must at first give the
// other boat room to keep clear, unless she acquires it because of the other
// boat's actions. For each pair inside the 12 m gate the overlay remembers
// the previous physics step's dispatcher result (which boat has right of
// way, and under which rule). A new right-of-way boat — including a change
// out of Rule 13, or from clear astern into an overlap — can start Rule 15.
//
// Cause, on that same step. The dispatcher is run twice more: boat A in her
// new state with boat B still in last step's state, then the other way
// round. States are position, heading, hull polygon, tack, and the Rule 13
// flag, so the existing overlap and tacking predicates do the work. If only
// the new right-of-way boat's change produces her as right of way, she
// caused it and Rule 15 applies to her. If only the other boat's change
// does, the exception applies and Rule 15 does not. If both changes would
// do it, or neither would, the fallback is: a tack change first (port /
// starboard classification, or entering or leaving the Rule 13 window), and
// if that is not exactly one boat, whichever boat closed more of the gap
// (her move toward where the other boat was). A tie within 1 mm, or a tie
// on tack changes with equal closing, stays ambiguous and Rule 15 does not
// start.
//
// Distance. Rule 15 only starts, and only keeps drawing, while hull
// clearance is strictly under RULE15_RANGE_M (2 × 4 m = 8 m). Separating
// to 8 m or more ends the window early. The 12 m gate is unchanged for
// Rules 10–13.
//
// Time. The window lasts RULE15_ROOM_S (1 s) of simulation time, then the
// blocked rule shows on its own. Simulation time is the sum of fixed
// world steps (1/30 s each, see loop.js). The extra sim passes in a tick
// (main.js SIM_PASSES_PER_TICK) do not advance the clock. Pausing stops the runner, so the clock
// stops. The label's bar starts full and shrinks with the time that is left.
//
// While the window is open the label reads "Rule 15 (blocks Rule 10)" (or
// 11, 12, or 13): the rule she just acquired right of way under. Green still
// ends on that boat and red on the boat that must keep clear. An amber
// centerline on the green half, and an amber label, mark that she owes room.
// Stern marks still follow the blocked rule.
//
// Stern mark. While Rule 11 or Rule 12 is showing, a short cyan dashed
// segment is drawn through the aftermost hull point, perpendicular to that
// boat's course — the same abeam line the clear-astern test uses, so the
// mark is where 11 and 12 swap. Rule 12 draws it on the clear-ahead boat
// only (her stern is the line the trailer must stay behind). Rule 11 draws
// it on both boats. Rule 10 does not draw it. The segment is 4 m long,
// centered on the aftermost station, a bit wider than the 1.5 m beam.

// Rule 18 (mark-room, Section C). Evaluated per pair after Section A, from
// a mark provider passed to evaluateAllPairs (opts.markFor(boat) →
// { key, at: {x, y}, done } or null; main.js builds it from course.js
// markRoomTarget). `key` identifies the mark she is rounding or passing:
// a single course mark, or for a gate the gate mark nearest to her (each
// gate mark is its own mark). `done` means she has rounded it (midpoint ray)
// or passed the gate.
//
// 18.1: applies while both boats are leaving the same mark (same key, so the
// same side) and at least one of them is in the zone: some hull vertex
// within RULE18_ZONE_M (3 boat lengths, 12 m) of the mark's anchor. Not
// between boats on opposite tacks on a beat (18.1(a)): both |TWA| < 90°.
//
// 18.2(a)/(b): frozen when the first of the two reaches the zone (the first
// step either is in the zone with 18 applying). Overlapped then (the RRS
// overlap definition, the same clear-astern test as Rules 11/12, used for
// any tacks): the inside boat is entitled: further toward the mark
// across the pair's mean course: on the side the mark is to be left on
// (provider `side`, else the side it lies on), the mark's offset from her
// course line is smaller and the outside boat owes her mark-room. One boat
// clear ahead then: the clear-astern boat owes the clear-ahead boat
// mark-room. Later changes of overlap do not change it. Mutual clear astern
// at that moment: no entitlement.
//
// 18.2(c): the entitlement ends when the entitled boat has rounded / passed
// the mark (done, or her target has moved on), leaves the zone after being
// in it, or passes head to wind (Rule 13 tacking flag). Once both boats are
// out of the zone (or not leaving the same mark) the pair resets, so the
// next rounding freezes afresh.
//
// Effect. Rule 18 does not change right of way. Approximation of "sailing
// within the mark-room she is entitled to": while the entitlement is live
// (she is in the zone, has not rounded), any contact is charged to the boat
// that owes mark-room, and the entitled boat is exonerated (RRS 21) for a
// Section A breach. In the resolver this is the `sectionC` layer: when the
// entitled boat is the Section A keep-clear boat (or there is no single
// Section A decision), Rule 18 is decisive: it inhibits that Section A rule
// (struck through in the label stack) and becomes the final rule, so fault
// goes to the boat owing room. When Section A already favours the entitled
// boat, 18 is shown but not decisive. isMarkRoomEntitled(boat) also lets
// mark-touch.js exonerate her rule 31 touches while entitled.
//
// Approximations: the freeze happens on the first step the pair is inside
// the 12 m pair gate with one boat in the zone (pairs further apart are not
// evaluated); "rounding" a gate mark ends at the gate line.

import { RULE_TEXT, ruleCode, ruleText, ROLE_CODE, roleText, incidentCode, incidentReason, incidentLabel, penaltyNameText } from './rule-text.js';
import { boatTrueWind } from './wind.js';

export const BOAT_LENGTH_M = 4;
export const RULE18_ZONE_M = 3 * BOAT_LENGTH_M;
// 18.1(a): both boats are beating when |TWA| is below this.
export const RULE18_BEAT_TWA_DEG = 90;
// Shared Section A gate. The name is historical; Rules 10, 11, 12, and 13 all use it.
export const RULE10_INTEREST_RANGE_M = 3 * BOAT_LENGTH_M;
// Rule 13 ends once |true wind angle| reaches this on the tack she just
// entered. 40° is close-hauled for this sim. Tune this without touching
// the state machine.
export const CLOSE_HAULED_TWA_DEG = 40;
// Rule 15 only while the hulls are strictly closer than two boat lengths.
export const RULE15_RANGE_M = 2 * BOAT_LENGTH_M;
// How long the new right-of-way boat must give room, in simulation seconds.
export const RULE15_ROOM_S = 1;
// The fixed-step loop (loop.js) ticks at 30 Hz, and world.step receives 1/30.
// Rule 15 advances only when a step actually runs, not on wall-clock time.
export const SIM_STEP_S = 1 / 30;

// A vertex this close to the abeam line, or on the ahead side of it, is not
// "behind" that line. 1e-6 m is float dust, not a real overlap.
const CLEAR_ASTERN_EPS_M = 1e-6;
// Neither boat is windward when their upwind projections match this closely.
const WINDWARD_TIE_M = 1e-4;
// Half-length of the dashed stern mark. 4 m end to end, wider than the beam.
const STERN_MARK_HALF_M = 2;
const STERN_MARK_COLOR = 0x66eeff;

const RIGHT_OF_WAY_COLOR = 0x00ff00;
const GIVE_WAY_COLOR = 0xff0000;
// Right of way, but she owes room under Rule 15. Amber sits on the green half.
const ROOM_OWED_COLOR = 0xffc240;
const ROOM_OWED_STROKE_M = 0.22;
// Fallback: neither boat "closed the gap" unless she beat the other by this much.
const GAP_CLOSING_EPS_M = 1e-3;

// Match Boat.physics_model_step, which folds with `> 180` / `< -180`
// and therefore keeps both +180 and -180.
export function wrap180(deg) {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

export function trueWindAngleDeg(headingRad, windFromDeg) {
  const headingDeg = headingRad / Math.PI * 180;
  return wrap180(windFromDeg - headingDeg + 90);
}

// 'port' | 'starboard' | null
export function classifyTack(headingRad, windFromDeg) {
  if (!Number.isFinite(headingRad) || !Number.isFinite(windFromDeg)) return null;
  const twa = trueWindAngleDeg(headingRad, windFromDeg);
  if (twa > 0 && twa < 180) return 'port';
  if (twa < 0 && twa > -180) return 'starboard';
  return null;
}

function windFromDeg(sample) {
  const direction = sample && typeof sample === 'object' ? sample.direction : sample;
  if (typeof direction !== 'number' || !Number.isFinite(direction)) return null;
  return direction;
}

export function hullVerticesWorld(boat) {
  // Snapshots captured for the Rule 15 what-if already store world vertices.
  if (boat && Array.isArray(boat._ruleHull)) return boat._ruleHull;
  const shape = boat && boat.hull_shape;
  const body = boat && boat.physics_model;
  const verts = shape && shape.m_vertices;
  if (!body || !verts || typeof body.getWorldPoint !== 'function') return [];

  const count = shape.m_count > 0 ? shape.m_count : verts.length;
  const pts = [];
  for (let i = 0; i < count; i++) {
    const v = verts[i];
    if (!v) break;
    const p = body.getWorldPoint(v);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (pts.length > 0) {
      const q = pts[pts.length - 1];
      if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 < 1e-12) continue;
    }
    pts.push({ x: p.x, y: p.y });
  }
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < 1e-12) pts.pop();
  }
  return pts;
}

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a, b, p) {
  return p.x <= Math.max(a.x, b.x) + 1e-9 && p.x >= Math.min(a.x, b.x) - 1e-9
    && p.y <= Math.max(a.y, b.y) + 1e-9 && p.y >= Math.min(a.y, b.y) - 1e-9;
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  const eps = 1e-9;
  if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps))
    && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) return true;
  if (Math.abs(o1) <= eps && onSegment(a, b, c)) return true;
  if (Math.abs(o2) <= eps && onSegment(a, b, d)) return true;
  if (Math.abs(o3) <= eps && onSegment(c, d, a)) return true;
  if (Math.abs(o4) <= eps && onSegment(c, d, b)) return true;
  return false;
}

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const crosses = (a.y > p.y) !== (b.y > p.y);
    if (!crosses) continue;
    const xCross = (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x;
    if (p.x < xCross) inside = !inside;
  }
  return inside;
}

function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function polygonsOverlap(polyA, polyB) {
  if (polyA.length >= 3) {
    for (let i = 0; i < polyB.length; i++) {
      if (pointInPolygon(polyB[i], polyA)) return true;
    }
  }
  if (polyB.length >= 3) {
    for (let i = 0; i < polyA.length; i++) {
      if (pointInPolygon(polyA[i], polyB)) return true;
    }
  }
  if (polyA.length < 2 || polyB.length < 2) return false;
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

// Closest distance between two polygons, in the same units as the vertices.
// Overlap and touching edges are 0. Vertex-to-edge covers the separated case
// for any simple polygon (the closest pair is a vertex and an edge).
export function polygonClearance(polyA, polyB) {
  if (!polyA.length || !polyB.length) return Infinity;
  if (polyA.length === 1 && polyB.length === 1) {
    return Math.hypot(polyA[0].x - polyB[0].x, polyA[0].y - polyB[0].y);
  }
  if (polygonsOverlap(polyA, polyB)) return 0;

  let min = Infinity;
  const consider = (p, poly) => {
    const n = poly.length;
    if (n === 1) {
      min = Math.min(min, Math.hypot(p.x - poly[0].x, p.y - poly[0].y));
      return;
    }
    for (let i = 0; i < n; i++) {
      min = Math.min(min, pointSegmentDistance(p, poly[i], poly[(i + 1) % n]));
    }
  };
  for (let i = 0; i < polyA.length; i++) consider(polyA[i], polyB);
  for (let i = 0; i < polyB.length; i++) consider(polyB[i], polyA);
  return min;
}

function centerDistance(boatA, boatB) {
  return Math.hypot(boatA.x - boatB.x, boatA.y - boatB.y);
}

// Unit course vector. Local bow is −Y, so forward is (sin θ, −cos θ).
export function headingForward(headingRad) {
  if (!Number.isFinite(headingRad)) return null;
  return { x: Math.sin(headingRad), y: -Math.cos(headingRad) };
}

// True when every vertex of asternPoly is strictly behind the line through
// aheadPoly's aftermost vertex, perpendicular to aheadForward (her course).
export function isClearAstern(asternPoly, aheadPoly, aheadForward) {
  if (!aheadForward || !Number.isFinite(aheadForward.x) || !Number.isFinite(aheadForward.y)) return false;
  if (!asternPoly || !aheadPoly || asternPoly.length < 1 || aheadPoly.length < 1) return false;
  const fx = aheadForward.x;
  const fy = aheadForward.y;

  let aftermost = Infinity;
  for (let i = 0; i < aheadPoly.length; i++) {
    const p = aheadPoly[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    const d = p.x * fx + p.y * fy;
    if (d < aftermost) aftermost = d;
  }
  if (!Number.isFinite(aftermost)) return false;

  for (let i = 0; i < asternPoly.length; i++) {
    const p = asternPoly[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    const d = p.x * fx + p.y * fy;
    if (!(d < aftermost - CLEAR_ASTERN_EPS_M)) return false;
  }
  return true;
}

// Pairwise clear-astern / overlap. Null if either hull or heading is missing.
// mutualClearAstern: each is clear astern of the other, so Rule 12 has no
// single clear-ahead boat.
export function sameTackGeometry(boatA, boatB) {
  if (!boatA || !boatB) return null;
  const polyA = hullVerticesWorld(boatA);
  const polyB = hullVerticesWorld(boatB);
  const forwardA = headingForward(boatA.hull_angle);
  const forwardB = headingForward(boatB.hull_angle);
  if (polyA.length < 3 || polyB.length < 3 || !forwardA || !forwardB) return null;

  const aAsternOfB = isClearAstern(polyA, polyB, forwardB);
  const bAsternOfA = isClearAstern(polyB, polyA, forwardA);
  if (aAsternOfB && bAsternOfA) {
    return { overlapped: false, clearAhead: null, clearAstern: null, mutualClearAstern: true };
  }
  if (aAsternOfB) {
    return { overlapped: false, clearAhead: boatB, clearAstern: boatA, mutualClearAstern: false };
  }
  if (bAsternOfA) {
    return { overlapped: false, clearAhead: boatA, clearAstern: boatB, mutualClearAstern: false };
  }
  return { overlapped: true, clearAhead: null, clearAstern: null, mutualClearAstern: false };
}

// Unit vector toward the wind source. φ is the circular mean of the two
// wind-from angles, so a sample pair near 0°/360° still points at +X.
function windSourceUnit(fromA, fromB) {
  const ar = fromA * Math.PI / 180;
  const br = fromB * Math.PI / 180;
  let x = Math.cos(ar) + Math.cos(br);
  let y = Math.sin(ar) + Math.sin(br);
  const m = Math.hypot(x, y);
  if (m < 1e-9) return { x: Math.cos(ar), y: Math.sin(ar) };
  return { x: x / m, y: y / m };
}

// The boat whose body origin is farther along the wind-from direction.
// Null on a tie (neither is windward).
function windwardBoat(boatA, boatB, fromA, fromB) {
  const u = windSourceUnit(fromA, fromB);
  const scoreA = boatA.x * u.x + boatA.y * u.y;
  const scoreB = boatB.x * u.x + boatB.y * u.y;
  const delta = scoreA - scoreB;
  if (!Number.isFinite(delta) || Math.abs(delta) <= WINDWARD_TIE_M) return null;
  return delta > 0 ? boatA : boatB;
}

export function boatClearance(boatA, boatB) {
  const polyA = hullVerticesWorld(boatA);
  const polyB = hullVerticesWorld(boatB);
  if (polyA.length >= 3 && polyB.length >= 3) return polygonClearance(polyA, polyB);
  return centerDistance(boatA, boatB);
}

// Last TWA that was actually on a tack (not head to wind, not dead downwind).
// Samples of exactly 0° or ±180° leave this alone so the next signed sample
// can still see a crossing.
function rememberTwa(boat, twa) {
  boat._rule13PrevTwa = twa;
}

function tackSign(twa) {
  if (twa > 0 && twa < 180) return 1;
  if (twa < 0 && twa > -180) return -1;
  return 0;
}

// True when the short arc from prevTwa to twa crosses head to wind (0°),
// rather than dead downwind (±180°). Both samples must be on a tack.
function passedHeadToWind(prevTwa, twa) {
  const prevSign = tackSign(prevTwa);
  const sign = tackSign(twa);
  if (prevSign === 0 || sign === 0 || prevSign === sign) return false;
  const throughZero = Math.abs(prevTwa) + Math.abs(twa);
  const throughDead = (180 - Math.abs(prevTwa)) + (180 - Math.abs(twa));
  return throughZero < throughDead;
}

function clearTacking(boat) {
  boat.tacking = false;
  boat.tackingOnto = null;
}

function beginTacking(boat, onto) {
  boat.tacking = true;
  boat.tackingOnto = onto;
}

// The boat's true-wind sample: 1 m ring mean with own-sail-force correction
// (wind.js boatTrueWind). Falls back to plain get_wind when needed.
function boatWind(boat) {
  const w = boatTrueWind(boat);
  if (w) return w;
  const m = boat.map;
  return typeof m.get_wind_ring === 'function' ? m.get_wind_ring(boat.x, boat.y) : m.get_wind(boat.x, boat.y);
}

// Per-boat Rule 13 state. Call once per physics step, after hull_angle is
// current. Reads Map.get_wind so dev mode and the lattice share one path.
// `boat.tacking` is the flag Section A reads. `boat.tackingOnto` is the tack
// she must reach close-hauled on ('port' | 'starboard').
export function updateTackingState(boat) {
  if (!boat || !boat.map || typeof boat.map.get_wind !== 'function') return;
  if (!Number.isFinite(boat.hull_angle) || !Number.isFinite(boat.x) || !Number.isFinite(boat.y)) return;
  const from = windFromDeg(boatWind(boat));
  if (from === null) return;
  const twa = trueWindAngleDeg(boat.hull_angle, from);
  if (!Number.isFinite(twa)) return;

  const sign = tackSign(twa);
  if (sign === 0) {
    // Dead downwind is outside the head-to-wind → close-hauled window.
    if (boat.tacking && Math.abs(twa) > 90) clearTacking(boat);
    return;
  }

  const onto = sign > 0 ? 'port' : 'starboard';
  const prev = boat._rule13PrevTwa;
  if (typeof prev === 'number' && Number.isFinite(prev)) {
    if (passedHeadToWind(prev, twa)) {
      // Already on a close-hauled course on the new tack: the window opened
      // and closed inside one step. A reverse crossing that lands past 40°
      // is the same thing — she fell back onto close-hauled, so clear it.
      if (Math.abs(twa) >= CLOSE_HAULED_TWA_DEG) clearTacking(boat);
      else beginTacking(boat, onto);
    } else if (boat.tacking) {
      if (onto === boat.tackingOnto) {
        if (Math.abs(twa) >= CLOSE_HAULED_TWA_DEG) clearTacking(boat);
      } else {
        // Other side, but not through head to wind (a gybe, or a bad jump).
        // Drop the stale target instead of keeping her give-way forever.
        clearTacking(boat);
      }
    }
  }

  rememberTwa(boat, twa);
}

export function isTacking(boat) {
  return !!(boat && boat.tacking);
}

// Wind and tack for one evaluation. Cached on the context so the Section A
// evaluators share the samples without depending on each other's answers.
function windSample(ctx, boat) {
  if (!ctx._wind) ctx._wind = new Map();
  let sample = ctx._wind.get(boat);
  if (sample) return sample;
  const from = windFromDeg(ctx.getWind(boat.x, boat.y));
  sample = {
    from,
    tack: from === null ? null : classifyTack(boat.hull_angle, from),
  };
  ctx._wind.set(boat, sample);
  return sample;
}

function pairGeometry(ctx) {
  if (Object.prototype.hasOwnProperty.call(ctx, '_geometry')) return ctx._geometry;
  ctx._geometry = sameTackGeometry(ctx.boatA, ctx.boatB);
  return ctx._geometry;
}

// Rule 10: opposite tacks. Does not look at tacking or overlap.
function evaluateRule10(ctx) {
  const tackA = windSample(ctx, ctx.boatA).tack;
  const tackB = windSample(ctx, ctx.boatB).tack;
  if (!tackA || !tackB || tackA === tackB) return null;
  const rightOfWay = tackA === 'starboard' ? ctx.boatA : ctx.boatB;
  const giveWay = tackA === 'port' ? ctx.boatA : ctx.boatB;
  return { id: '10', rule: 'Rule 10', applies: true, rightOfWay, giveWay };
}

// Rule 11: same tack and overlapped. A windward tie does not apply.
function evaluateRule11(ctx) {
  const sampleA = windSample(ctx, ctx.boatA);
  const sampleB = windSample(ctx, ctx.boatB);
  if (!sampleA.tack || !sampleB.tack || sampleA.tack !== sampleB.tack) return null;
  if (sampleA.from === null || sampleB.from === null) return null;
  const geometry = pairGeometry(ctx);
  if (!geometry || !geometry.overlapped) return null;
  const windward = windwardBoat(ctx.boatA, ctx.boatB, sampleA.from, sampleB.from);
  if (!windward) return null;
  const leeward = windward === ctx.boatA ? ctx.boatB : ctx.boatA;
  return { id: '11', rule: 'Rule 11', applies: true, rightOfWay: leeward, giveWay: windward };
}

// Rule 12: same tack, one boat clear ahead. Mutual clear astern does not apply.
function evaluateRule12(ctx) {
  const sampleA = windSample(ctx, ctx.boatA);
  const sampleB = windSample(ctx, ctx.boatB);
  if (!sampleA.tack || !sampleB.tack || sampleA.tack !== sampleB.tack) return null;
  const geometry = pairGeometry(ctx);
  if (!geometry || !geometry.clearAhead || !geometry.clearAstern) return null;
  return {
    id: '12',
    rule: 'Rule 12',
    applies: true,
    rightOfWay: geometry.clearAhead,
    giveWay: geometry.clearAstern,
  };
}

// Rule 13: a tacking boat keeps clear. She is not given Rules 10–12 rights.
// Both tacking: each keeps clear of the other (no right-of-way boat).
// The tacking flag itself lives on the boat (`updateTackingState`).
function evaluateRule13(ctx) {
  const aTacking = isTacking(ctx.boatA);
  const bTacking = isTacking(ctx.boatB);
  if (!aTacking && !bTacking) return null;
  if (aTacking && bTacking) {
    return {
      id: '13',
      rule: 'Rule 13 both',
      applies: true,
      bothGiveWay: true,
      boats: [ctx.boatA, ctx.boatB],
      rightOfWay: null,
      giveWay: null,
    };
  }
  const giveWay = aTacking ? ctx.boatA : ctx.boatB;
  const rightOfWay = aTacking ? ctx.boatB : ctx.boatA;
  return { id: '13', rule: 'Rule 13', applies: true, rightOfWay, giveWay };
}

// Short segment through the aftermost hull station, perpendicular to course.
// Null if the hull or heading is missing.
export function sternAbeamSegment(boat) {
  const p = sternAbeamPoint(boat);
  return p ? sternSegmentFromState(p) : null;
}

// The aftermost hull station's centre and the heading: [cx, cy, hullAngle]
// (pair overlay state), or null.
export function sternAbeamPoint(boat) {
  return sternFromHull(hullVerticesWorld(boat), boat && boat.hull_angle);
}

// The same from a boat's scene state (boat-draw.js renderState: px, py body
// position, pa body angle, ha hull angle) and her local hull vertices
// (statics.hulls[id].v, flat): the client's stern marks (scene-build.js),
// computed as planck's getWorldPoint does.
export function sternAbeamPointOf(bs, hv) {
  if (!bs || !Array.isArray(hv)) return null;
  const c = Math.cos(bs.pa), s = Math.sin(bs.pa);
  const pts = [];
  for (let i = 0; i + 1 < hv.length; i += 2) {
    const vx = hv[i], vy = hv[i + 1];
    const p = { x: (c * vx - s * vy) + bs.px, y: (s * vx + c * vy) + bs.py };
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (pts.length > 0) {
      const q = pts[pts.length - 1];
      if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 < 1e-12) continue;
    }
    pts.push(p);
  }
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < 1e-12) pts.pop();
  }
  return sternFromHull(pts, bs.ha);
}

function sternFromHull(poly, hullAngle) {
  const forward = headingForward(hullAngle);
  if (poly.length < 3 || !forward) return null;

  let aftermost = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = poly[i].x * forward.x + poly[i].y * forward.y;
    if (d < aftermost) aftermost = d;
  }
  let cx = 0;
  let cy = 0;
  let n = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const d = p.x * forward.x + p.y * forward.y;
    if (d <= aftermost + 1e-4) {
      cx += p.x;
      cy += p.y;
      n++;
    }
  }
  if (n === 0) return null;
  cx /= n;
  cy /= n;
  return [cx, cy, hullAngle];
}

// The stern mark from sternAbeamPoint's [cx, cy, hullAngle].
export function sternSegmentFromState(p) {
  const cx = p[0], cy = p[1];
  const forward = headingForward(p[2]);
  const px = -forward.y;
  const py = forward.x;
  return {
    type: 'abeam',
    color: STERN_MARK_COLOR,
    x1: cx - px * STERN_MARK_HALF_M,
    y1: cy - py * STERN_MARK_HALF_M,
    x2: cx + px * STERN_MARK_HALF_M,
    y2: cy + py * STERN_MARK_HALF_M,
    z: 0.25,
  };
}

function sternMarks(obligation) {
  return sternPoints(obligation).map(sternSegmentFromState);
}

// Boats that get a stern mark: the right-of-way boat for Rule 12, both
// (leeward, then windward) for Rule 11.
function sternBoats(obligation) {
  if (!obligation) return [];
  if (obligation.rule === 'Rule 12') return [obligation.rightOfWay];
  if (obligation.rule === 'Rule 11') return [obligation.rightOfWay, obligation.giveWay];
  return [];
}

// Stern mark states ([cx, cy, hullAngle]) for Rules 11 and 12.
function sternPoints(obligation) {
  const marks = [];
  for (const b of sternBoats(obligation)) {
    const m = sternAbeamPoint(b);
    if (m) marks.push(m);
  }
  return marks;
}

function bothGiveWayOverlay(obligation) {
  const boats = obligation.boats;
  if (!boats || boats.length < 2) return [];
  const a = boats[0];
  const b = boats[1];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return [
    { type: 'rule', color: GIVE_WAY_COLOR, x1: mx, y1: my, x2: a.x, y2: a.y, z: 0.2 },
    { type: 'rule', color: GIVE_WAY_COLOR, x1: mx, y1: my, x2: b.x, y2: b.y, z: 0.2 },
    { type: 'label', text: obligation.rule, x: mx, y: my },
  ];
}

// Guide records for one dispatcher result. Empty when Section A does not apply.
// Green runs from the midpoint to the right-of-way boat; red to the give-way boat.
// A cyan dashed stern mark is appended for Rules 11 and 12.
// Rule 13 with both boats tacking draws two red halves and no stern mark.
function obligationOverlay(obligation) {
  if (!obligation) return [];
  if (obligation.bothGiveWay) return bothGiveWayOverlay(obligation);

  const row = obligation.rightOfWay;
  const give = obligation.giveWay;
  const mx = (row.x + give.x) / 2;
  const my = (row.y + give.y) / 2;
  return [
    { type: 'rule', color: RIGHT_OF_WAY_COLOR, x1: mx, y1: my, x2: row.x, y2: row.y, z: 0.2 },
    { type: 'rule', color: GIVE_WAY_COLOR, x1: mx, y1: my, x2: give.x, y2: give.y, z: 0.2 },
    { type: 'label', text: obligation.rule, x: mx, y: my },
    ...sternMarks(obligation),
  ];
}

// Per-simulation rules state. Every container the rules engine keeps between
// steps lives here, so two Sim instances (sim.js) never share pair memory,
// contacts or penalties. The functions below read the active state R; a Sim
// makes its own state active with useRulesState() before it steps or is read.
export function createRulesState() {
  return {
    // Identity for pair memory. Live boats are keyed in a WeakMap. A what-if
    // snapshot carries the same number on `id` plus `_ruleHull`, and does not
    // keep the boat object alive.
    boatIds: new WeakMap(),
    nextBoatId: 1,
    pairMemory: new Map(),
    markRoomEntitled: new Set(),
    contactLatch: new Map(),
    incidents: [],
    contactFlashes: [],
    pendingPenalties: new Map(),
    penaltyManeuvers: new Map(),
    // Boats that have finished (finish.js). chargePendingPenalty ignores them.
    finishedBoats: new Set(),
    penaltyCleared: [],
    // Rule 31 mark touches (mark-touch.js): boat -> Map(mark -> true), the
    // recorded touches, and the red flashes { mark, startedAtMs }.
    markTouch: { latch: new Map(), touches: [], flashes: [] },
  };
}
let R = createRulesState();
// Make `state` the active rules state; returns the previous one.
export function useRulesState(state) {
  const prev = R;
  R = state;
  return prev;
}
export function activeRulesState() {
  return R;
}


// The boat's id as state.boats carries it (Boat.boatId); stand-ins without
// one (test/script mocks) get the resolver's per-object id instead.
export function stateId(boat) {
  if (!boat) return null;
  return boat.boatId != null ? boat.boatId : '#' + boatId(boat);
}

function boatId(boat) {
  if (!boat) return 0;
  if (Number.isInteger(boat.id) && Array.isArray(boat._ruleHull)) return boat.id;
  let id = R.boatIds.get(boat);
  if (!id) {
    id = R.nextBoatId++;
    R.boatIds.set(boat, id);
  }
  return id;
}

function pairKey(boatA, boatB) {
  const ia = boatId(boatA);
  const ib = boatId(boatB);
  return ia < ib ? ia + ':' + ib : ib + ':' + ia;
}

function rowId(obligation) {
  if (!obligation || obligation.bothGiveWay || !obligation.rightOfWay) return null;
  return boatId(obligation.rightOfWay);
}

function captureBoat(boat, getWind) {
  const from = windFromDeg(getWind(boat.x, boat.y));
  return {
    id: boatId(boat),
    x: boat.x,
    y: boat.y,
    hull_angle: boat.hull_angle,
    tacking: !!boat.tacking,
    tack: from === null ? null : classifyTack(boat.hull_angle, from),
    _ruleHull: hullVerticesWorld(boat),
  };
}

function snapFor(snaps, boat) {
  if (!snaps) return null;
  const id = boatId(boat);
  for (let i = 0; i < snaps.length; i++) {
    if (snaps[i].id === id) return snaps[i];
  }
  return null;
}

function tackState(boat, getWind) {
  if (boat && Array.isArray(boat._ruleHull) && Object.prototype.hasOwnProperty.call(boat, 'tack')) {
    return { tack: boat.tack, tacking: !!boat.tacking };
  }
  const from = windFromDeg(getWind(boat.x, boat.y));
  return {
    tack: from === null ? null : classifyTack(boat.hull_angle, from),
    tacking: !!boat.tacking,
  };
}

function tackChanged(before, after, getWind) {
  const a = tackState(before, getWind);
  const b = tackState(after, getWind);
  return a.tack !== b.tack || a.tacking !== b.tacking;
}

// Positive when `after` is closer to where the other boat was than `before` was.
function closingAmount(before, after, otherBefore) {
  const then = Math.hypot(before.x - otherBefore.x, before.y - otherBefore.y);
  const now = Math.hypot(after.x - otherBefore.x, after.y - otherBefore.y);
  return then - now;
}

// Which current boat's own change produced nextRowId. Returns that boat, or
// null when the cause stays ambiguous. See the Rule 15 header comment.
export function acquisitionCause(boatA, boatB, prevA, prevB, prevRowId, nextRowId, getWind) {
  if (!boatA || !boatB || !prevA || !prevB || !nextRowId || typeof getWind !== 'function') return null;
  const onlyA = evaluateSectionA(boatA, prevB, getWind);
  const onlyB = evaluateSectionA(prevA, boatB, getWind);
  const rowA = rowId(onlyA);
  const rowB = rowId(onlyB);
  const aFlips = rowA === nextRowId && rowA !== prevRowId;
  const bFlips = rowB === nextRowId && rowB !== prevRowId;
  if (aFlips && !bFlips) return boatA;
  if (bFlips && !aFlips) return boatB;

  const aTack = tackChanged(prevA, boatA, getWind);
  const bTack = tackChanged(prevB, boatB, getWind);
  if (aTack !== bTack) return aTack ? boatA : boatB;
  const aClose = closingAmount(prevA, boatA, prevB);
  const bClose = closingAmount(prevB, boatB, prevA);
  if (aClose > bClose + GAP_CLOSING_EPS_M) return boatA;
  if (bClose > aClose + GAP_CLOSING_EPS_M) return boatB;
  return null;
}

// Rule 15 keeps its own per-pair state: the previous step's right-of-way
// boat, snapshots for the what-if, and the open timer. `state` is that
// object; the resolver never writes it.
function evaluateRule15(ctx, state) {
  const simTime = ctx.simTime;
  if (typeof simTime !== 'number' || !Number.isFinite(simTime)) return null;

  const boatA = ctx.boatA;
  const boatB = ctx.boatB;
  const getWind = ctx.getWind;
  const clearance = ctx.clearance;
  const sectionFinal = ctx.sectionA && ctx.sectionA.final;
  const obligation = sectionFinal ? {
    rule: sectionFinal.rule,
    id: sectionFinal.id,
    bothGiveWay: sectionFinal.bothGiveWay,
    rightOfWay: sectionFinal.rightOfWay,
    giveWay: sectionFinal.giveWay,
  } : null;
  const inRange = Number.isFinite(clearance) && clearance <= RULE10_INTEREST_RANGE_M;

  let active = state.active || null;
  if (active) {
    const elapsed = simTime - active.startedAt;
    const timedOut = elapsed + 1e-6 >= RULE15_ROOM_S;
    const separated = !(clearance < RULE15_RANGE_M);
    const owesNow = rowId(obligation) === active.owesId;
    if (timedOut || separated || !owesNow) active = null;
  }

  const prevTime = state.simTime;
  const consecutive = typeof prevTime === 'number'
    && Math.abs((simTime - prevTime) - SIM_STEP_S) <= 1e-6;
  const nextRowId = rowId(obligation);
  if (consecutive && state.inRange && nextRowId && nextRowId !== state.rowId && clearance < RULE15_RANGE_M) {
    const prevA = snapFor(state.snaps, boatA);
    const prevB = snapFor(state.snaps, boatB);
    const cause = acquisitionCause(boatA, boatB, prevA, prevB, state.rowId, nextRowId, getWind);
    if (cause && boatId(cause) === nextRowId && obligation) {
      active = {
        owesId: nextRowId,
        blockedRule: obligation.rule,
        blockedId: obligation.id,
        blockedBoth: !!obligation.bothGiveWay,
        startedAt: simTime,
      };
    }
  }

  // A second callback at the same simulation time is a redraw between physics
  // steps. Keep last step's snapshots so the next real step can still what-if.
  if (prevTime !== simTime) {
    state.simTime = simTime;
    state.inRange = inRange;
    state.rowId = nextRowId;
    state.snaps = [captureBoat(boatA, getWind), captureBoat(boatB, getWind)];
  }
  state.active = active;

  if (!(active && obligation && rowId(obligation) === active.owesId && clearance < RULE15_RANGE_M)) return null;
  const elapsed = simTime - active.startedAt;
  const progress = Math.max(0, Math.min(1, (RULE15_ROOM_S - elapsed) / RULE15_ROOM_S));
  return {
    id: '15',
    rule: 'Rule 15',
    applies: true,
    rightOfWay: obligation.rightOfWay,
    giveWay: obligation.giveWay,
    blockedId: active.blockedId,
    blockedRule: active.blockedRule,
    blockedBoth: !!active.blockedBoth,
    progress,
    label: 'Rule 15 (blocks ' + active.blockedRule + ')',
  };
}

function hullDistanceTo(boat, p) {
  const hull = hullVerticesWorld(boat);
  if (!hull.length) return Math.hypot(boat.x - p.x, boat.y - p.y);
  let d = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    d = Math.min(d, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
  }
  return d;
}


// True while `boat` holds a live Rule 18.2 entitlement in some pair (updated
// by evaluateAllPairs). mark-touch.js exonerates her rule 31 touches then.
export function isMarkRoomEntitled(boat) {
  return R.markRoomEntitled.has(boat);
}

// Rule 18 for one pair; state is the pair's '18' slot. See the header.
function evaluateRule18(ctx, state) {
  const markFor = ctx.markFor;
  const A = ctx.boatA;
  const B = ctx.boatB;
  if (typeof markFor !== 'function') return null;
  const mA = markFor(A);
  const mB = markFor(B);
  const same = !!(mA && mB && mA.key === mB.key);
  let applies = same;
  if (applies) {
    const sA = windSample(ctx, A);
    const sB = windSample(ctx, B);
    if (sA.tack && sB.tack && sA.tack !== sB.tack && sA.from !== null && sB.from !== null) {
      const twaA = Math.abs(trueWindAngleDeg(A.hull_angle, sA.from));
      const twaB = Math.abs(trueWindAngleDeg(B.hull_angle, sB.from));
      if (twaA < RULE18_BEAT_TWA_DEG && twaB < RULE18_BEAT_TWA_DEG) applies = false;
    }
  }
  const at = same ? mA.at : null;
  const inA = same && hullDistanceTo(A, at) <= RULE18_ZONE_M;
  const inB = same && hullDistanceTo(B, at) <= RULE18_ZONE_M;
  if (!applies || (!inA && !inB)) {
    // Out of the zone or not the same mark: forget, so the next rounding
    // freezes afresh.
    for (const k of Object.keys(state)) delete state[k];
    return null;
  }
  if (!state.frozen) {
    state.frozen = true;
    state.markKey = mA.key;
    const geo = pairGeometry(ctx);
    if (!geo || geo.mutualClearAstern) {
      state.entitled = null;
    } else if (geo.overlapped) {
      // Inside: further toward the mark across their course. f is the mean
      // course; off = signed offset of the mark from each boat's course line
      // (left positive). On the side the mark is to be left on, the boat
      // with the smaller offset is inside.
      const fa = headingForward(A.hull_angle) || { x: 0, y: 1 };
      const fb = headingForward(B.hull_angle) || fa;
      let fx = fa.x + fb.x;
      let fy = fa.y + fb.y;
      const fl = Math.hypot(fx, fy);
      if (fl < 1e-9) { fx = fa.x; fy = fa.y; } else { fx /= fl; fy /= fl; }
      const off = (b) => fx * (at.y - b.y) - fy * (at.x - b.x);
      // Required side when the provider gives it (+1: mark to port, on
      // her left), else the side the mark is on from the pair.
      const side = mA.side === 1 || mA.side === -1 ? mA.side : (Math.sign(off(A) + off(B)) || 1);
      state.entitled = off(A) * side <= off(B) * side ? A : B;
      state.owes = state.entitled === A ? B : A;
      state.basis = 'overlapped';
    } else {
      state.entitled = geo.clearAhead;
      state.owes = geo.clearAstern;
      state.basis = 'clear ahead';
    }
    state.entitledEntered = false;
    state.ended = !state.entitled;
  }
  if (state.ended || !state.entitled) return null;
  const ent = state.entitled;
  const entMark = ent === A ? mA : mB;
  const entIn = ent === A ? inA : inB;
  if (entIn) state.entitledEntered = true;
  if (!entMark || entMark.key !== state.markKey || entMark.done || (state.entitledEntered && !entIn) || isTacking(ent)) {
    state.ended = true;
    return null;
  }
  const secA = ctx.sectionA && ctx.sectionA.final;
  const decisive = !secA || !!secA.bothGiveWay || secA.giveWay === ent;
  return {
    id: '18',
    rule: 'Rule 18.2 mark-room',
    applies: true,
    rightOfWay: ent,
    giveWay: state.owes,
    decisive,
    basis: state.basis,
    blockedId: decisive && secA ? secA.id : null,
    label: 'Rule 18.2 mark-room',
  };
}

// Boundary room (game rule, SailGP style; boundary.js). ctx.boundary is the
// scenario's Boundary or null. The boat closer to a side's boundary line,
// once she is in that side's zone, is entitled to room to tack or gybe away
// from it; the other boat gives that room whatever Section A says. Frozen
// at the start (side, entitled boat, her tack); it freezes only once one
// boat is BOUNDARY_TIE_M closer, so near-equal distances do not flip it.
// Ends when she has completed a tack or gybe (her tack changed and the
// Rule 13 window is closed) or is BOUNDARY_EXIT_HYST_M beyond the zone; it
// then stays ended until neither boat is in that zone. Decisive (inhibits
// the Section A rule, and Rule 15) only when Section A would make her keep
// clear; otherwise shown as a supporting line. Near a mark Rule 18 (rank 2)
// is below this (rank 3): boundary room wins if both apply.
const BR_TIE_M = 1;
const BR_EXIT_HYST_M = 1;
// After the entitled boat completes her tack or gybe away, the room still
// covers sailing clear: it lasts until the pair is more than BR_CLEAR_M apart
// or BR_AFTER_TACK_S has passed, whichever comes first.
export const BR_CLEAR_M = 8;
export const BR_AFTER_TACK_S = 3;
function evaluateBoundaryRoom(ctx, state) {
  const bd = ctx.boundary;
  const A = ctx.boatA;
  const B = ctx.boatB;
  if (!bd) return null;
  const reset = () => { for (const k of Object.keys(state)) delete state[k]; };
  if (!state.frozen) {
    const nA = bd.distanceOf(A);
    const nB = bd.distanceOf(B);
    const side = nA.dist <= nB.dist ? nA.side : nB.side;
    const dA = bd.sideDistance(A, side);
    const dB = bd.sideDistance(B, side);
    const closer = dA <= dB ? A : B;
    if (Math.min(dA, dB) > bd.zone) return null;
    if (Math.abs(dA - dB) < BR_TIE_M) return null;
    state.frozen = true;
    state.side = side;
    state.entitled = closer;
    state.owes = closer === A ? B : A;
    state.tack0 = windSample(ctx, closer).tack;
    state.ended = false;
  }
  const side = state.side;
  const ent = state.entitled;
  if (state.ended) {
    if (bd.sideDistance(A, side) > bd.zone + BR_EXIT_HYST_M && bd.sideDistance(B, side) > bd.zone + BR_EXIT_HYST_M) reset();
    return null;
  }
  const tackNow = windSample(ctx, ent).tack;
  const tackDone = !!(tackNow && state.tack0 && tackNow !== state.tack0 && !isTacking(ent));
  if (tackDone && state.doneAt === undefined) state.doneAt = ctx.simTime ?? 0;
  if (!tackDone) delete state.doneAt;
  const afterTackOver = tackDone && (!(ctx.clearance <= BR_CLEAR_M) || (ctx.simTime ?? 0) - state.doneAt >= BR_AFTER_TACK_S);
  if (bd.sideDistance(ent, side) > bd.zone + BR_EXIT_HYST_M || afterTackOver) {
    state.ended = true;
    state.endedAt = ctx.simTime;
    return null;
  }
  const secA = ctx.sectionA && ctx.sectionA.final;
  const r15 = ctx.rule15;
  const decisive = !secA || !!secA.bothGiveWay || secA.giveWay === ent || !!(r15 && r15.giveWay === ent);
  const blockedIds = [];
  if (decisive && secA) blockedIds.push(secA.id);
  if (decisive && r15) blockedIds.push('15');
  return {
    id: 'BR',
    rule: 'Boundary room',
    applies: true,
    rightOfWay: ent,
    giveWay: state.owes,
    decisive,
    basis: side > 0 ? 'east boundary' : 'west boundary',
    blockedId: blockedIds[0] || null,
    blockedIds,
    label: 'Boundary room',
  };
}

// `rank` is the hierarchy: a higher rank can be the final rule while a lower
// one stays applicable but inhibited. Section A shares rank 0. Registry order
// is the tie-break inside a rank (earlier wins) and the order of `applicable`.
export const ruleRegistry = [
  {
    id: '10',
    layer: 'sectionA',
    rank: 0,
    inhibits: [],
    evaluate: evaluateRule10,
  },
  {
    id: '11',
    layer: 'sectionA',
    rank: 0,
    inhibits: [],
    evaluate: evaluateRule11,
  },
  {
    id: '12',
    layer: 'sectionA',
    rank: 0,
    inhibits: [],
    evaluate: evaluateRule12,
  },
  {
    id: '13',
    layer: 'sectionA',
    rank: 0,
    inhibits: ['10', '11', '12'],
    evaluate: evaluateRule13,
  },
  {
    id: '15',
    layer: 'timedInhibitor',
    rank: 1,
    // The rule she acquired right of way under. Chosen when the window opens.
    inhibits(result) {
      return result.blockedId ? [result.blockedId] : [];
    },
    evaluate: evaluateRule15,
  },
  {
    id: '18',
    layer: 'sectionC',
    rank: 2,
    // Decisive only: the Section A rule that would make the entitled boat
    // keep clear does not decide fault while she has mark-room.
    inhibits(result) {
      return result.decisive && result.blockedId ? [result.blockedId] : [];
    },
    evaluate: evaluateRule18,
  },
  {
    id: 'BR',
    layer: 'sectionC',
    rank: 3,
    // Decisive only: Section A's rule (and Rule 15) do not decide fault
    // while the boat nearer the boundary has room to tack or gybe away.
    inhibits(result) {
      return result.decisive ? (result.blockedIds || []) : [];
    },
    evaluate: evaluateBoundaryRoom,
  },
];

function registryIndex(id) {
  for (let i = 0; i < ruleRegistry.length; i++) {
    if (ruleRegistry[i].id === id) return i;
  }
  return -1;
}

function inhibitsOf(entry, result) {
  if (typeof entry.inhibits === 'function') return entry.inhibits(result) || [];
  return entry.inhibits || [];
}

// Turn raw evaluator outputs into one decision for the pair.
// `applicable` keeps every rule whose conditions hold, in registry order.
// `inhibited` is the subset that must not decide right of way or fault.
// `final` is the one rule that does. Fault is the keep-clear boat, or the
// new right-of-way boat while Rule 15 is the rule doing the inhibiting.
export function resolveRuleOutputs(results) {
  const byId = new Map();
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (!result || result.applies === false || !result.id) continue;
    byId.set(result.id, result);
  }

  const inhibitedBy = new Map();
  for (let i = 0; i < ruleRegistry.length; i++) {
    const entry = ruleRegistry[i];
    const result = byId.get(entry.id);
    if (!result) continue;
    const targets = inhibitsOf(entry, result);
    for (let t = 0; t < targets.length; t++) {
      const targetId = targets[t];
      if (!byId.has(targetId) || inhibitedBy.has(targetId)) continue;
      inhibitedBy.set(targetId, entry.id);
    }
  }

  // Section A is mutually exclusive. Declared inhibition (Rule 13) usually
  // leaves one. If two still apply, the earlier registry entry wins and the
  // other is recorded as inhibited by it.
  let sectionWinner = null;
  let sectionWinnerIndex = Infinity;
  for (let i = 0; i < ruleRegistry.length; i++) {
    const entry = ruleRegistry[i];
    if (entry.layer !== 'sectionA') continue;
    if (!byId.has(entry.id) || inhibitedBy.has(entry.id)) continue;
    if (i < sectionWinnerIndex) {
      sectionWinner = entry;
      sectionWinnerIndex = i;
    }
  }
  if (sectionWinner) {
    for (let i = 0; i < ruleRegistry.length; i++) {
      const entry = ruleRegistry[i];
      if (entry.layer !== 'sectionA' || entry.id === sectionWinner.id) continue;
      if (byId.has(entry.id) && !inhibitedBy.has(entry.id)) inhibitedBy.set(entry.id, sectionWinner.id);
    }
  }

  const applicable = [];
  for (let i = 0; i < ruleRegistry.length; i++) {
    const entry = ruleRegistry[i];
    const result = byId.get(entry.id);
    if (!result) continue;
    applicable.push({
      id: result.id,
      rule: result.rule,
      layer: entry.layer,
      rank: entry.rank || 0,
      rightOfWay: result.rightOfWay || null,
      giveWay: result.giveWay || null,
      bothGiveWay: !!result.bothGiveWay,
      boats: result.boats || null,
      blockedId: result.blockedId || null,
      blockedRule: result.blockedRule || null,
      blockedBoth: !!result.blockedBoth,
      decisive: result.decisive !== false,
      basis: result.basis || null,
      progress: result.progress,
      label: result.label || result.rule,
      inhibited: inhibitedBy.has(result.id),
      inhibitedBy: inhibitedBy.get(result.id) || null,
    });
  }

  let final = null;
  let bestRank = -1;
  let bestIndex = Infinity;
  for (let i = 0; i < applicable.length; i++) {
    const item = applicable[i];
    if (item.inhibited) continue;
    // A Section C rule that Section A already agrees with is shown, not final.
    if (item.layer === 'sectionC' && !item.decisive) continue;
    const index = registryIndex(item.id);
    if (item.rank > bestRank || (item.rank === bestRank && index < bestIndex)) {
      final = item;
      bestRank = item.rank;
      bestIndex = index;
    }
  }

  const inhibited = [];
  for (let i = 0; i < applicable.length; i++) {
    if (applicable[i].inhibited) inhibited.push(applicable[i]);
  }

  let rightOfWay = null;
  let keepClear = null;
  let faultBoat = null;
  if (final && !final.bothGiveWay) {
    rightOfWay = final.rightOfWay;
    keepClear = final.giveWay;
    // Rule 15 owes room: the new right-of-way boat is at fault on contact.
    if (final.id === '15') faultBoat = final.rightOfWay || null;
    else faultBoat = final.giveWay || null;
  }

  return { applicable, inhibited, final, rightOfWay, keepClear, faultBoat };
}

function sectionAOutputs(ctx) {
  const outputs = [];
  for (let i = 0; i < ruleRegistry.length; i++) {
    const entry = ruleRegistry[i];
    if (entry.layer !== 'sectionA') continue;
    const result = entry.evaluate(ctx);
    if (result) outputs.push(result);
  }
  return outputs;
}

// Section A between two racing boats. Null means no overlay. Stateless:
// Rule 15's timer is not consulted and not updated.
export function evaluateSectionA(boatA, boatB, getWind) {
  if (!boatA || !boatB || typeof getWind !== 'function') return null;
  if (!Number.isFinite(boatA.x) || !Number.isFinite(boatA.y)) return null;
  if (!Number.isFinite(boatB.x) || !Number.isFinite(boatB.y)) return null;

  const clearance = boatClearance(boatA, boatB);
  if (!(clearance <= RULE10_INTEREST_RANGE_M)) return null;

  const ctx = { boatA, boatB, getWind, clearance, simTime: undefined, sectionA: null };
  const resolved = resolveRuleOutputs(sectionAOutputs(ctx));
  const final = resolved.final;
  if (!final) return null;
  if (final.bothGiveWay) {
    return { rule: final.rule, bothGiveWay: true, boats: final.boats, clearance };
  }
  return {
    rule: final.rule,
    rightOfWay: final.rightOfWay,
    giveWay: final.giveWay,
    clearance,
  };
}

// Rule names as short codes in the pair overlay state (rule-text.js).
export { RULE_TEXT, ruleCode, ruleText };

// Label stack, highest layer first, so an inhibitor sits above the rule it
// blocks: [[rule code, role code, id]].
// Rule code of a resolver output: its registry id, '13b' for Rule 13 with
// both boats tacking (rule-text.js RULE_TEXT).
function ruleIdCode(o) {
  if (!o) return '';
  if (o.id === '13' && o.bothGiveWay) return '13b';
  return o.id != null ? String(o.id) : ruleCode(o.rule);
}

function labelLinesState(resolution) {
  const lines = [];
  const items = resolution.applicable || [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const isFinal = !!(resolution.final && item.id === resolution.final.id && !item.inhibited);
    lines.push([ruleIdCode(item), ROLE_CODE[item.inhibited ? 'inhibited' : (isFinal ? 'final' : 'other')], item.id]);
  }
  return lines;
}

// Overlay data of one pair, or null:
//   { k: 'b' (Rule 13, both tacking) | '15' | 'o' (one boat keeps clear),
//     a, b: the boats (right-of-way, give-way; both boats for 'b'),
//     r: rule code (label), bl, pr: blocked rule code and progress (15),
//     sm: boats with a stern mark, ln: label stack lines }.
// scene-state.js sends it with boat ids (pairStateFor); the client takes
// positions and stern marks from the boats' own state (pairGuidesFromState).
export function pairGuideState(resolution) {
  const final = resolution.final;
  if (!final) return null;
  let p;
  if (final.bothGiveWay) {
    const boats = final.boats;
    if (!boats || boats.length < 2) return null;
    p = { k: 'b', a: boats[0], b: boats[1], r: ruleIdCode(final) };
  } else if (final.id === '15') {
    const current = resolution.sectionA && resolution.sectionA.final;
    if (!current || !final.rightOfWay || !final.giveWay) return null;
    // Stern marks follow the rule she is sailing under now. The label names
    // the rule she acquired right of way under, which is the blocked one.
    p = { k: '15', a: final.rightOfWay, b: final.giveWay, bl: final.blockedId == null ? ruleCode(final.blockedRule) : (final.blockedBoth && final.blockedId === '13' ? '13b' : String(final.blockedId)), pr: final.progress,
      sm: sternBoats({ rule: current.rule, rightOfWay: final.rightOfWay, giveWay: final.giveWay }) };
  } else {
    p = { k: 'o', a: final.rightOfWay, b: final.giveWay, r: ruleIdCode(final),
      sm: sternBoats({ rule: final.rule, rightOfWay: final.rightOfWay, giveWay: final.giveWay }) };
  }
  p.ln = labelLinesState(resolution);
  return p;
}

// pairGuideState with the boats as indices into `boats` (state.pair entry,
// host-protocol.js), or null when a boat is not in the list.
export function pairStateFor(p, boats) {
  if (!boats.includes(p.a) || !boats.includes(p.b)) return null;
  const out = { k: p.k, a: stateId(p.a), b: stateId(p.b) };
  if (p.r !== undefined) out.r = p.r;
  if (p.bl !== undefined) { out.bl = p.bl; out.pr = p.pr; }
  if (p.sm) {
    out.sm = [];
    for (const m of p.sm) if (boats.includes(m)) out.sm.push(stateId(m));
  }
  out.ln = p.ln;
  return out;
}

// Where pairGuidesFromState reads the boats: on the host the boat objects
// (resolution.guides, the headless checks), on the client the boat ids,
// looked up in state.boats (by id) with the hull outlines from
// statics.hulls[id]. pos is null for a boat that is not there (stale id).
const LIVE_BOATS = { pos: (b) => (b ? [b.x, b.y] : null), stern: sternAbeamPoint };
export function boatsById(boats) {
  const m = new Map();
  for (const b of boats || []) if (b && b.id != null) m.set(b.id, b);
  return m;
}
export function pairBoatsFromState(boats, hulls) {
  const byId = boatsById(boats);
  return {
    pos: (id) => { const b = byId.get(id); return b && Number.isFinite(b.x) && Number.isFinite(b.y) ? [b.x, b.y] : null; },
    stern: (id) => { const b = byId.get(id), h = hulls && hulls[id]; return b && h ? sternAbeamPointOf(b, h.v) : null; },
  };
}

// Guides of one pair overlay (scene-build.js with pairBoatsFromState; the
// host with the boats themselves). Green runs from the midpoint to the
// right-of-way boat; red to the give-way boat; Rule 15 adds the amber
// room-owed bar; cyan stern marks for Rules 11 and 12; Rule 13 with both
// boats tacking draws two red halves.
export function pairGuidesFromState(p, at = LIVE_BOATS) {
  const pa = at.pos(p.a), pb = at.pos(p.b);
  // A boat that is not in this frame (stale id): no overlay.
  if (!pa || !pb) return [];
  const [ax, ay] = pa, [bx, by] = pb;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const sterns = () => {
    const out = [];
    for (const i of p.sm || []) { const m = at.stern(i); if (m) out.push(sternSegmentFromState(m)); }
    return out;
  };
  let guides;
  if (p.k === 'b') {
    guides = [
      { type: 'rule', color: GIVE_WAY_COLOR, x1: mx, y1: my, x2: ax, y2: ay, z: 0.2 },
      { type: 'rule', color: GIVE_WAY_COLOR, x1: mx, y1: my, x2: bx, y2: by, z: 0.2 },
      { type: 'label', text: ruleText(p.r), x: mx, y: my },
    ];
  } else if (p.k === '15') {
    guides = [
      { type: 'rule', color: RIGHT_OF_WAY_COLOR, x1: mx, y1: my, x2: ax, y2: ay, z: 0.2 },
      { type: 'rule', color: ROOM_OWED_COLOR, stroke: ROOM_OWED_STROKE_M, x1: mx, y1: my, x2: ax, y2: ay, z: 0.22 },
      { type: 'rule', color: GIVE_WAY_COLOR, x1: mx, y1: my, x2: bx, y2: by, z: 0.2 },
      { type: 'label', text: 'Rule 15 (blocks ' + ruleText(p.bl) + ')', x: mx, y: my, rule15: true, progress: p.pr },
      ...sterns(),
    ];
  } else {
    guides = [
      { type: 'rule', color: RIGHT_OF_WAY_COLOR, x1: mx, y1: my, x2: ax, y2: ay, z: 0.2 },
      { type: 'rule', color: GIVE_WAY_COLOR, x1: mx, y1: my, x2: bx, y2: by, z: 0.2 },
      { type: 'label', text: ruleText(p.r), x: mx, y: my },
      ...sterns(),
    ];
  }
  const lines = p.ln.map(([r, o, id]) => ({ text: ruleText(r), role: roleText(o), id }));
  for (let i = 0; i < guides.length; i++) {
    if (guides[i].type !== 'label') continue;
    guides[i].lines = lines;
    break;
  }
  return guides;
}

function pairSlot(key) {
  let slot = R.pairMemory.get(key);
  if (!slot) {
    slot = { states: {} };
    R.pairMemory.set(key, slot);
  }
  if (!slot.states) slot.states = {};
  return slot;
}

function ruleState(slot, id) {
  let state = slot.states[id];
  if (!state) {
    state = {};
    slot.states[id] = state;
  }
  return state;
}

// One pair. Section A runs first so Rule 15 can read that decision. Rule 15
// still updates its state when the pair is outside the gate: a direct
// overlay call (the headless checks) keeps the same memory as before. The
// all-pairs step does not call this for pairs outside the gate; it drops
// their state instead.
function evaluatePair(boatA, boatB, getWind, clearance, simTime, slot, markFor, boundary) {
  const inRange = Number.isFinite(clearance) && clearance <= RULE10_INTEREST_RANGE_M;
  const ctx = { boatA, boatB, getWind, clearance, simTime, sectionA: null, markFor, boundary: boundary || null };
  const outputs = inRange ? sectionAOutputs(ctx) : [];
  ctx.sectionA = resolveRuleOutputs(outputs);
  const rule15 = evaluateRule15(ctx, ruleState(slot, '15'));
  if (rule15) outputs.push(rule15);
  if (inRange) {
    const rule18 = evaluateRule18(ctx, ruleState(slot, '18'));
    if (rule18) outputs.push(rule18);
    ctx.rule15 = rule15 || null;
    const br = evaluateBoundaryRoom(ctx, ruleState(slot, 'BR'));
    if (br) outputs.push(br);
  }
  const resolution = resolveRuleOutputs(outputs);
  resolution.clearance = clearance;
  resolution.boatA = boatA;
  resolution.boatB = boatB;
  resolution.sectionA = ctx.sectionA;
  // Overlay: compact state for the client (scene-state.js) and the guides
  // built from it (the headless checks read those).
  resolution.pairState = inRange ? pairGuideState(resolution) : null;
  resolution.guides = resolution.pairState ? pairGuidesFromState(resolution.pairState) : [];
  return resolution;
}

function rule15Clock(slot) {
  const state = slot && slot.states && slot.states['15'];
  return state && typeof state.simTime === 'number' ? state.simTime : null;
}

// Drop pairs that missed the previous physics step (scenario restart, a boat
// leaving). Called once per rules update, before the pair loop.
export function beginRule15Step(simTime) {
  if (typeof simTime !== 'number' || !Number.isFinite(simTime)) return;
  for (const [key, slot] of R.pairMemory) {
    const seenAt = rule15Clock(slot);
    if (seenAt === null) continue;
    if (simTime - seenAt > SIM_STEP_S + 1e-4) R.pairMemory.delete(key);
  }
}

export function resetRule15Memory() {
  R.pairMemory.clear();
}

// How many pairs still hold state. Headless checks use this for leaks.
export function pairStateCount() {
  return R.pairMemory.size;
}

// The evaluator state object for one pair, or null when that pair has none.
// Reading it does not create a slot.
export function pairRuleState(boatA, boatB, ruleId) {
  if (!boatA || !boatB) return null;
  const slot = R.pairMemory.get(pairKey(boatA, boatB));
  if (!slot || !slot.states) return null;
  return slot.states[ruleId] || null;
}

// Every unordered pair inside the 12 m gate. Pair state for a pair that is
// outside the gate, or that names a boat not in `boats`, is deleted.
// opts.markFor: Rule 18 mark provider (see the Rule 18 header).
// opts.boundary: the scenario's Boundary (boundary.js) for boundary room.
export function evaluateAllPairs(boats, getWind, simTime, opts) {
  const list = boats || [];
  const markFor = opts && typeof opts.markFor === 'function' ? opts.markFor : null;
  const boundary = opts && opts.boundary ? opts.boundary : null;
  R.markRoomEntitled.clear();
  const live = new Set();
  for (let i = 0; i < list.length; i++) {
    if (list[i]) live.add(boatId(list[i]));
  }

  const seen = new Set();
  const resolutions = [];
  for (let i = 0; i < list.length; i++) {
    const boatA = list[i];
    if (!boatA || !Number.isFinite(boatA.x) || !Number.isFinite(boatA.y)) continue;
    for (let j = i + 1; j < list.length; j++) {
      const boatB = list[j];
      if (!boatB || !Number.isFinite(boatB.x) || !Number.isFinite(boatB.y)) continue;
      const clearance = boatClearance(boatA, boatB);
      if (!(Number.isFinite(clearance) && clearance <= RULE10_INTEREST_RANGE_M)) continue;
      const key = pairKey(boatA, boatB);
      seen.add(key);
      const resolution = evaluatePair(boatA, boatB, getWind, clearance, simTime, pairSlot(key), markFor, boundary);
      resolution.pairKey = key;
      resolution.boundaryRoom = resolution.applicable.find((r) => r.id === 'BR') || null;
      resolution.markRoom = resolution.applicable.find((r) => r.id === '18') || null;
      if (resolution.markRoom) R.markRoomEntitled.add(resolution.markRoom.rightOfWay);
      resolutions.push(resolution);
    }
  }

  for (const [key] of R.pairMemory) {
    const parts = key.split(':');
    const ia = Number(parts[0]);
    const ib = Number(parts[1]);
    if (!live.has(ia) || !live.has(ib) || !seen.has(key)) R.pairMemory.delete(key);
  }
  return resolutions;
}

// Guide records for the debug overlay. Pass simTime (seconds, advanced only
// on physics steps) to apply Rule 15. Omit it for the stateless Rules 10–13
// overlay used by the headless checks.
export function sectionAOverlay(boatA, boatB, getWind, simTime) {
  if (typeof simTime !== 'number' || !Number.isFinite(simTime)) {
    return obligationOverlay(evaluateSectionA(boatA, boatB, getWind));
  }
  if (!boatA || !boatB || typeof getWind !== 'function') return [];
  if (!Number.isFinite(boatA.x) || !Number.isFinite(boatA.y)) return [];
  if (!Number.isFinite(boatB.x) || !Number.isFinite(boatB.y)) return [];
  const clearance = boatClearance(boatA, boatB);
  const resolution = evaluatePair(boatA, boatB, getWind, clearance, simTime, pairSlot(pairKey(boatA, boatB)));
  return resolution.guides;
}

// One contact episode per closure. Hull overlap counts, and so does a Planck
// contact that is still touching after the solver has pushed the hulls apart.
// The latch stays shut until the hulls are clearly apart, so a bounce does
// not open a second incident.
const CONTACT_TOUCH_M = 0.02;
const CONTACT_REARM_M = 0.25;
const CONTACT_FLASH_MS = 700;


function segmentHit(a, b, c, d) {
  const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
  const u = ((a.x - c.x) * (a.y - b.y) - (a.y - c.y) * (a.x - b.x)) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

export function hullContactPoint(boatA, boatB) {
  const polyA = hullVerticesWorld(boatA);
  const polyB = hullVerticesWorld(boatB);
  const mid = {
    x: (boatA.x + boatB.x) / 2,
    y: (boatA.y + boatB.y) / 2,
  };
  if (polyA.length < 2 || polyB.length < 2) return mid;
  const pts = [];
  if (polyA.length >= 3) {
    for (let i = 0; i < polyB.length; i++) {
      if (pointInPolygon(polyB[i], polyA)) pts.push(polyB[i]);
    }
  }
  if (polyB.length >= 3) {
    for (let i = 0; i < polyA.length; i++) {
      if (pointInPolygon(polyA[i], polyB)) pts.push(polyA[i]);
    }
  }
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const hit = segmentHit(a1, a2, polyB[j], polyB[(j + 1) % polyB.length]);
      if (hit) pts.push(hit);
    }
  }
  if (!pts.length) return mid;
  let x = 0;
  let y = 0;
  for (let i = 0; i < pts.length; i++) {
    x += pts[i].x;
    y += pts[i].y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

function planckTouching(boatA, boatB) {
  const bodyA = boatA && boatA.physics_model;
  const bodyB = boatB && boatB.physics_model;
  if (!bodyA || !bodyB || typeof bodyA.getContactList !== 'function') return null;
  for (let edge = bodyA.getContactList(); edge; edge = edge.next) {
    if (edge.other !== bodyB || !edge.contact || !edge.contact.isTouching()) continue;
    let point = null;
    if (typeof edge.contact.getWorldManifold === 'function') {
      const manifold = edge.contact.getWorldManifold();
      const pts = manifold && manifold.points;
      if (pts && pts.length) {
        let x = 0;
        let y = 0;
        let n = 0;
        for (let i = 0; i < pts.length; i++) {
          if (!pts[i] || !Number.isFinite(pts[i].x) || !Number.isFinite(pts[i].y)) continue;
          x += pts[i].x;
          y += pts[i].y;
          n++;
        }
        if (n) point = { x: x / n, y: y / n };
      }
    }
    return point || hullContactPoint(boatA, boatB);
  }
  return null;
}

function boatsTouching(boatA, boatB, clearance) {
  if (Number.isFinite(clearance) && clearance <= CONTACT_TOUCH_M) return hullContactPoint(boatA, boatB);
  return planckTouching(boatA, boatB);
}

export function getIncidents() {
  return R.incidents;
}

export function resetContacts() {
  R.contactLatch.clear();
  R.incidents.length = 0;
  R.contactFlashes.length = 0;
  R.pendingPenalties.clear();
  R.penaltyManeuvers.clear();
  R.penaltyCleared.length = 0;
  R.finishedBoats.clear();
}

function pruneContactVisuals(boats, now) {
  for (let i = R.contactFlashes.length - 1; i >= 0; i--) {
    if (now - R.contactFlashes[i].startedAtMs > CONTACT_FLASH_MS) R.contactFlashes.splice(i, 1);
  }
}

// Charge the resolver's fault boat when a latched contact begins. No incident
// when fault is not a single boat (both tacking). `simTime` is the simulation
// clock stored on the incident. The contact flash uses wall time. A charged
// fault also pushes one pending penalty; the FAULT badge stays until a tack
// and a gybe in a row clear it.
export function recordContacts(resolutions, simTime, boats) {
  const now = performance.now();
  const seen = new Set();
  const list = resolutions || [];
  for (let i = 0; i < list.length; i++) {
    const resolution = list[i];
    if (!resolution || !resolution.pairKey) continue;
    seen.add(resolution.pairKey);
    const point = boatsTouching(resolution.boatA, resolution.boatB, resolution.clearance);
    const touching = !!point;
    const latched = R.contactLatch.get(resolution.pairKey) === true;
    if (touching && !latched) {
      R.contactLatch.set(resolution.pairKey, true);
      if (resolution.faultBoat && resolution.final) {
        const inhibited = [];
        const blocked = resolution.inhibited || [];
        for (let k = 0; k < blocked.length; k++) inhibited.push(blocked[k].rule);
        const incident = {
          time: simTime,
          boats: [resolution.boatA, resolution.boatB],
          pairKey: resolution.pairKey,
          finalRule: resolution.final.rule,
          finalId: resolution.final.id,
          inhibited,
          faultBoat: resolution.faultBoat,
          x: point.x,
          y: point.y,
        };
        // Rule 18.2 decided it: the boat owing mark-room is at fault, the
        // entitled boat is exonerated (RRS 21) for her Section A breach.
        if (resolution.final.id === '18') {
          incident.exonerated = [resolution.final.rightOfWay];
          incident.ic = incidentCode.markRoom();
        }
        // Boundary room decided it: the giving boat is at fault, the boat
        // nearer the boundary is exonerated.
        if (resolution.final.id === 'BR') {
          incident.exonerated = [resolution.final.rightOfWay];
          incident.ic = incidentCode.boundaryRoom();
        }
        if (incident.ic) {
          incident.reason = incidentReason(incident.ic);
          incident.label = incidentLabel(incident.ic);
        }
        R.incidents.push(incident);
        R.contactFlashes.push({ x: point.x, y: point.y, startedAtMs: now });
        chargePendingPenalty(resolution.faultBoat, incident);
      }
    } else if (!touching && resolution.clearance > CONTACT_REARM_M) {
      R.contactLatch.set(resolution.pairKey, false);
    } else if (touching) {
      R.contactLatch.set(resolution.pairKey, true);
    }
  }
  const stale = [];
  for (const key of R.contactLatch.keys()) {
    if (!seen.has(key)) stale.push(key);
  }
  for (let i = 0; i < stale.length; i++) R.contactLatch.delete(stale[i]);
  pruneContactVisuals(boats, now);
}

export function contactGuides(nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : performance.now();
  return contactGuidesFromState(contactFlashState(now));
}

// Live contact flashes as [{ x, y, age }] (age in ms at nowMs).
export function contactFlashState(nowMs) {
  const out = [];
  for (let i = 0; i < R.contactFlashes.length; i++) {
    const flash = R.contactFlashes[i];
    const age = nowMs - flash.startedAtMs;
    if (age < 0 || age > CONTACT_FLASH_MS) continue;
    out.push({ x: flash.x, y: flash.y, age });
  }
  return out;
}

export function contactGuidesFromState(flashes) {
  const guides = [];
  for (const flash of flashes) {
    const t = flash.age / CONTACT_FLASH_MS;
    guides.push({
      type: 'contact',
      x: flash.x,
      y: flash.y,
      radius: 0.45 + t * 2.6,
      opacity: (1 - t) * 0.95,
    });
  }
  return guides;
}

// A contact fault charges one pending penalty. Penalties stack, one per
// incident, and each completed penalty clears the oldest (FIFO).
//
// A penalty is a tack immediately followed by a gybe, or a gybe immediately
// followed by a tack (RRS 44.2: one turn, one tack and one gybe). Tack and
// gybe come from the true wind angle (Map.get_wind, the same seam Rule 13
// reads): a tack is a TWA sign change through 0° (head to wind), a gybe is a
// sign change through ±180° (dead downwind). Heading itself is not
// integrated, so a turn of any size that does both counts.
//
// Hysteresis. A side (port +, starboard −) is only settled while
// PENALTY_MANEUVER_HYST_DEG < |TWA| < 180 − PENALTY_MANEUVER_HYST_DEG.
// Samples inside the band around 0° or 180° leave the settled side alone, so
// a wobble across head to wind or dead downwind is not a maneuver until she
// settles on the other side, and wobbling back is not a second one. When the
// settled side flips, the last settled TWA and the new one are compared the
// way Rule 13's passedHeadToWind does: the short way across 0° is a tack,
// otherwise a gybe.
//
// Consecutive. Each maneuver while a penalty is pending is checked against
// the one before it (the candidate). A different kind, in the same rotation,
// within PENALTY_MANEUVER_WINDOW_S of the candidate, completes the pair and
// clears one penalty; the pair is used up. Otherwise the new maneuver
// replaces the candidate, so tack, tack, gybe clears on the gybe: the second
// tack and the gybe are themselves consecutive. Tack then gybe without
// anything between is necessarily one circle in one direction (after
// crossing 0° the next crossing is either 0° again or 180° going the same
// way); the rotation check only guards a single-step TWA jump. A candidate
// older than the window is dropped. The window runs on simulation time, a
// sum of fixed steps, like the Rule 15 timer.
//
// Only maneuvers made while a penalty is pending count. The first penalty
// on a boat starts with no candidate; a further collision while one is
// waiting stacks and leaves it alone.
export const PENALTY_MANEUVER_WINDOW_S = 10;
export const PENALTY_MANEUVER_HYST_DEG = 10;
export const PENALTY_CLEARED_MS = 2200;
const PENALTY_RING_R = 3.15;

// Mark a boat finished and hand back her unserved pending penalties (oldest
// first, each { time, incident }); her queue is emptied, so the FAULT badge
// goes and finish.js converts them (time penalty or DSQ).
export function finishBoatPenalties(boat) {
  if (!boat) return [];
  R.finishedBoats.add(boat);
  const queue = R.pendingPenalties.get(boat) || [];
  R.pendingPenalties.delete(boat);
  R.penaltyManeuvers.delete(boat);
  return queue.slice();
}

export function hasFinished(boat) {
  return R.finishedBoats.has(boat);
}

// Short rule name of a penalty incident: 'Rule 31', 'Rule 18.2', 'Rule 10'.
export function penaltyRuleName(incident) {
  return penaltyNameText(penaltyCode(incident));
}

// The penalty name as a code (rule-text.js penaltyNameText): finish results
// and leaderboard rows carry these.
export function penaltyCode(incident) {
  if (!incident) return '';
  if (incident.rule === '31' || incident.kind === 'mark') return '31';
  if (incident.finalId === '18') return '18';
  if (incident.kind === 'boundary') return 'Bd';
  if (incident.finalId === 'BR') return 'BR';
  if (incident.finalId) return String(incident.finalId);
  return incident.finalRule && incident.finalRule !== 'penalty' ? '=' + String(incident.finalRule) : '';
}

function maneuverTracker(boat) {
  let tracker = R.penaltyManeuvers.get(boat);
  if (!tracker) {
    // side: settled TWA sign (0 until the first settled sample).
    // first: the candidate { kind: 'tack' | 'gybe', dir: +1 CCW | −1 CW, age }.
    tracker = { side: 0, lastTwa: 0, first: null };
    R.penaltyManeuvers.set(boat, tracker);
  }
  return tracker;
}

// Drop the candidate. The settled side stays, so a crossing already under
// way still counts as one maneuver once she settles.
export function resetPenaltyManeuvers(boat) {
  if (!boat) return;
  maneuverTracker(boat).first = null;
}

function settledSide(twa) {
  const a = Math.abs(twa);
  if (a <= PENALTY_MANEUVER_HYST_DEG || a >= 180 - PENALTY_MANEUVER_HYST_DEG) return 0;
  return tackSign(twa);
}

// A side flip from prevTwa to twa (both settled, opposite signs). Hull
// heading up is TWA down, so a tack off port (+) turns counter-clockwise and
// a gybe off port turns clockwise.
function classifyManeuver(prevTwa, twa) {
  const prevSign = tackSign(prevTwa);
  if (passedHeadToWind(prevTwa, twa)) return { kind: 'tack', dir: prevSign };
  return { kind: 'gybe', dir: -prevSign };
}

function maneuverView(tracker) {
  const first = tracker && tracker.first;
  if (!first) return { first: null, dir: 0, remainingS: 0 };
  return {
    first: first.kind,
    dir: first.dir,
    remainingS: Math.max(0, PENALTY_MANEUVER_WINDOW_S - first.age),
  };
}

// { first: 'tack' | 'gybe' | null, dir, remainingS }. `first` is the
// candidate waiting for the other maneuver.
export function penaltyManeuverView(boat) {
  return maneuverView(R.penaltyManeuvers.get(boat));
}

// "Tack ✓ · Gybe … 7.2s", or null when no candidate is waiting.
export function penaltyManeuverText(view) {
  if (!view || !view.first) return null;
  const done = view.first === 'tack' ? 'Tack' : 'Gybe';
  const next = view.first === 'tack' ? 'Gybe' : 'Tack';
  return done + ' ✓ · ' + next + ' … ' + view.remainingS.toFixed(1) + 's';
}

export function pendingPenaltyCount(boat) {
  const queue = R.pendingPenalties.get(boat);
  return queue ? queue.length : 0;
}

// Oldest first. Each entry is { time, incident }.
export function pendingPenaltiesOf(boat) {
  const queue = R.pendingPenalties.get(boat);
  return queue ? queue.slice() : [];
}

function clearOldestPending(boat, now) {
  const queue = R.pendingPenalties.get(boat);
  if (!queue || !queue.length) return null;
  const cleared = queue.shift();
  if (!queue.length) R.pendingPenalties.delete(boat);
  R.penaltyCleared.push({ boat, startedAtMs: now });
  return cleared;
}

// Push one pending penalty. `incident` is the contact record, or a stand-in
// with at least { time } for a scenario that starts already charged.
export function chargePendingPenalty(boat, incident) {
  if (!boat || !incident) return;
  // A finished boat is no longer racing (finish.js): nothing more accrues.
  if (R.finishedBoats.has(boat)) return;
  let queue = R.pendingPenalties.get(boat);
  const wasEmpty = !queue || queue.length === 0;
  if (!queue) {
    queue = [];
    R.pendingPenalties.set(boat, queue);
  }
  queue.push({ time: incident.time, incident });
  if (wasEmpty) resetPenaltyManeuvers(boat);
}

// One TWA sample (degrees, −180..180) per physics step. `opts.dtS` is the
// simulation time since the previous sample (default SIM_STEP_S) and
// `opts.nowMs` stamps the CLEARED flash. Returns { maneuver, cleared, view }:
// `maneuver` is the tack or gybe completed on this sample (pending or not),
// `cleared` the penalty entry it removed.
export function notePenaltyManeuver(boat, twaDeg, opts) {
  if (!boat || !Number.isFinite(twaDeg)) return null;
  const tracker = maneuverTracker(boat);
  const dt = opts && Number.isFinite(opts.dtS) ? opts.dtS : SIM_STEP_S;
  const now = opts && typeof opts.nowMs === 'number' ? opts.nowMs : performance.now();
  const pending = pendingPenaltyCount(boat) > 0;

  if (tracker.first) {
    tracker.first.age += dt;
    if (tracker.first.age > PENALTY_MANEUVER_WINDOW_S + 1e-9) tracker.first = null;
  }
  if (!pending) tracker.first = null;

  let maneuver = null;
  let cleared = null;
  const side = settledSide(twaDeg);
  if (side !== 0) {
    if (tracker.side !== 0 && side !== tracker.side) {
      maneuver = classifyManeuver(tracker.lastTwa, twaDeg);
      if (pending) {
        const first = tracker.first;
        if (first && first.kind !== maneuver.kind && first.dir === maneuver.dir) {
          cleared = clearOldestPending(boat, now);
          tracker.first = null;
        } else {
          tracker.first = { kind: maneuver.kind, dir: maneuver.dir, age: 0 };
        }
      }
    }
    tracker.side = side;
    tracker.lastTwa = twaDeg;
  }
  return { maneuver, cleared, view: maneuverView(tracker) };
}

// Per-boat step: TWA from Map.get_wind at the boat, then notePenaltyManeuver.
export function updatePenaltyManeuvers(boat, opts) {
  if (!boat || !boat.map || typeof boat.map.get_wind !== 'function') return null;
  if (!Number.isFinite(boat.hull_angle) || !Number.isFinite(boat.x) || !Number.isFinite(boat.y)) return null;
  const from = windFromDeg(boatWind(boat));
  if (from === null) return null;
  return notePenaltyManeuver(boat, trueWindAngleDeg(boat.hull_angle, from), opts);
}

function pushArc(guides, cx, cy, radius, a0, sweep, color, opacity) {
  const n = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 28)));
  const count = Math.min(n, 96);
  for (let i = 0; i < count; i++) {
    const t0 = a0 + sweep * (i / count);
    const t1 = a0 + sweep * ((i + 1) / count);
    guides.push({
      type: 'guide',
      color,
      opacity,
      z: 0.36,
      x1: cx + Math.cos(t0) * radius,
      y1: cy + Math.sin(t0) * radius,
      x2: cx + Math.cos(t1) * radius,
      y2: cy + Math.sin(t1) * radius,
    });
  }
}

function sternOffset(boat, dist) {
  const fwd = headingForward(boat.hull_angle);
  if (!fwd) return { x: 0, y: dist };
  return { x: -fwd.x * dist, y: -fwd.y * dist };
}

function bowOffset(boat, dist) {
  const fwd = headingForward(boat.hull_angle);
  if (!fwd) return { x: 0, y: -dist };
  return { x: fwd.x * dist, y: fwd.y * dist };
}

// Degrees left on a Q/E autopilot circle (Boat.penalty_turn), or null.
export function penaltyAutopilotRemainingDeg(boat) {
  const turn = boat && boat.penalty_turn;
  if (!turn || !Number.isFinite(turn.progressDeg)) return null;
  return Math.max(0, 360 - turn.dir * turn.progressDeg);
}

// Small labels while Rule 18.2 is live for a pair: "GETS MARK-ROOM" on the
// entitled boat, "GIVES MARK-ROOM → boat n" on the other (n = index in
// `boats`, as in the info panel).
// GETS / GIVES BOUNDARY ROOM badges, like markRoomGuides.
export function boundaryRoomGuides(resolutions, boats) {
  return roomGuidesFromState(roomGuideState(resolutions, boats, 'boundaryRoom'), 'boundaryRoom', boatViews(boats));
}

export function markRoomGuides(resolutions, boats) {
  return roomGuidesFromState(roomGuideState(resolutions, boats, 'markRoom'), 'markRoom', boatViews(boats));
}

// The boats as the client sees them in state.boats ({ id, x, y, ha }).
function boatViews(boats) {
  return (boats || []).map((b) => (b ? { id: stateId(b), x: b.x, y: b.y, ha: b.hull_angle } : null));
}

// Live room obligations of one kind ('markRoom' | 'boundaryRoom') as
// [[r, g]]: the entitled and the giving boat's ids (pairs with a boat not
// in boats are left out).
export function roomGuideState(resolutions, boats, kind) {
  const out = [];
  const list = boats || [];
  for (const r of resolutions || []) {
    const m = r && r[kind];
    if (!m || !m.rightOfWay || !m.giveWay) continue;
    if (!list.includes(m.rightOfWay) || !list.includes(m.giveWay)) continue;
    out.push([stateId(m.rightOfWay), stateId(m.giveWay)]);
  }
  return out;
}

// GETS / GIVES badges, stacked above the higher boat so they never overlap.
// boats: state.boats ({ id, x, y }); "→ boat n" names the entitled boat by
// her position in boats, as the readout does. A stale id: no badge.
export function roomGuidesFromState(list, kind, boats) {
  const g = [];
  const mark = kind === 'markRoom';
  const index = (id) => (boats || []).findIndex((b) => b && b.id === id);
  for (const [rid, gid] of list) {
    const n = index(rid), gi = index(gid);
    if (n < 0 || gi < 0) continue;
    const rb = boats[n], gb = boats[gi];
    const top = Math.max(rb.y, gb.y) + 3.3;
    if (mark) {
      g.push({ type: 'label', badge: true, x: rb.x, y: top + 1.3, lines: [{ text: 'GETS MARK-ROOM', role: 'cleared', id: 'mr' }] });
      g.push({ type: 'label', badge: true, x: gb.x, y: top, lines: [{ text: 'GIVES MARK-ROOM → boat ' + n, role: 'turn', id: 'mr' }] });
    } else {
      g.push({ type: 'label', badge: true, x: rb.x, y: top + 1.3, lines: [{ text: 'GETS BOUNDARY ROOM', role: 'cleared', id: 'br' }] });
      g.push({ type: 'label', badge: true, x: gb.x, y: top, lines: [{ text: 'GIVES ROOM → boat ' + n, role: 'turn', id: 'br' }] });
    }
  }
  return g;
}

// "FAULT", "FAULT x2"; with the oldest pending penalty's reason when it has
// one (mark touches: "FAULT · Rule 31 · touched mark 2").
export function faultBadgeText(boat, count = pendingPenaltyCount(boat)) {
  return faultText(count, pendingPenaltyLabel(boat));
}

// The badge text from the count and the oldest penalty's label (or null).
export function faultText(count, label) {
  const base = count > 1 ? 'FAULT x' + count : 'FAULT';
  return label ? base + ' · ' + label : base;
}

// Label of the oldest pending penalty ("Rule 31 · touched mark 2"), or null.
export function pendingPenaltyLabel(boat) {
  const queue = R.pendingPenalties.get(boat);
  const oldest = queue && queue[0] && queue[0].incident;
  return oldest && oldest.label ? oldest.label : null;
}

// Incident code of the oldest pending penalty (rule-text.js), or null.
export function pendingPenaltyCode(boat) {
  const queue = R.pendingPenalties.get(boat);
  const oldest = queue && queue[0] && queue[0].incident;
  return oldest && Array.isArray(oldest.ic) ? oldest.ic : null;
}

// Reason of the oldest pending penalty ("Rule 31: touched mark 2"), or null.
export function pendingPenaltyReason(boat) {
  const queue = R.pendingPenalties.get(boat);
  const oldest = queue && queue[0] && queue[0].incident;
  return oldest && oldest.reason ? oldest.reason : null;
}

// FAULT badge while a penalty is pending (with a count when several are),
// the amber tack/gybe progress label, the ring and degrees left while the
// Q/E autopilot circles, and a short CLEARED flash.
export function penaltyGuides(boats, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : performance.now();
  const list = boats || [];
  return penaltyGuidesFromState(penaltyGuideState(list, now), boatViews(list));
}

// Penalty overlay state (scene-state.js), per boat (i: boat id):
//   boats: [{ i, c (pending count), ic (the oldest penalty's incident code,
//           rule-text.js; FAULT badge label) | null, t: { sh, pd, dir, left }
//           (Q/E circle) | null, mv: { first, remainingS } (tack/gybe
//           progress) | null }]
//   cleared: [{ i, c }] CLEARED flashes (expired ones are dropped here).
export function penaltyGuideState(boats, nowMs) {
  const list = boats || [];
  const live = new Set(list);
  const out = { boats: [], cleared: [] };
  for (let i = 0; i < list.length; i++) {
    const boat = list[i];
    if (!boat || !Number.isFinite(boat.x) || !Number.isFinite(boat.y)) continue;
    const c = pendingPenaltyCount(boat);
    const turn = boat.penalty_turn;
    // ic: the oldest penalty's incident code (FAULT badge label); mv: the
    // penalty tack/gybe progress (penaltyManeuverView) while one is waiting.
    const e = { i: stateId(boat), c, ic: c > 0 ? pendingPenaltyCode(boat) : null, t: null, mv: null };
    if (turn && Number.isFinite(turn.startHeading)) {
      e.t = { sh: turn.startHeading, pd: turn.progressDeg || 0, dir: turn.dir, left: Math.max(0, Math.ceil(penaltyAutopilotRemainingDeg(boat))) };
    } else if (c > 0) {
      const v = penaltyManeuverView(boat);
      if (v && v.first) e.mv = { first: v.first, remainingS: v.remainingS };
    }
    if (e.c > 0 || e.t || e.mv) out.boats.push(e);
  }
  for (let k = R.penaltyCleared.length - 1; k >= 0; k--) {
    const flash = R.penaltyCleared[k];
    const age = nowMs - flash.startedAtMs;
    if (age < 0 || age > PENALTY_CLEARED_MS || !live.has(flash.boat)) {
      R.penaltyCleared.splice(k, 1);
      continue;
    }
    const boat = flash.boat;
    if (!boat || !Number.isFinite(boat.x) || !Number.isFinite(boat.y)) continue;
    out.cleared.push({ i: stateId(boat), c: pendingPenaltyCount(boat) });
  }
  return out;
}

// FAULT badge while a penalty is pending (with a count when several are),
// the amber tack/gybe progress label, the ring and degrees left while the
// Q/E autopilot circles, and a short CLEARED flash. boats[i] = { x, y, ha }.
export function penaltyGuidesFromState(s, boats) {
  const guides = [];
  const byId = boatsById(boats);
  for (const e of s.boats) {
    const b = byId.get(e.i);
    if (!b) continue;
    const boat = { x: b.x, y: b.y, hull_angle: b.ha };
    if (e.c > 0) {
      const at = sternOffset(boat, 2.5);
      guides.push({ type: 'label', badge: true, x: boat.x + at.x, y: boat.y + at.y, lines: [{ text: faultText(e.c, incidentLabel(e.ic)), role: 'badge', id: 'fault' }] });
    }
    const ahead = bowOffset(boat, 4.3);
    if (e.t) {
      const bow = e.t.sh - Math.PI / 2;
      pushArc(guides, boat.x, boat.y, PENALTY_RING_R, bow, Math.PI * 2, 0xffffff, 0.28);
      const sweep = e.t.pd * Math.PI / 180;
      if (Math.abs(sweep) > 1e-3) pushArc(guides, boat.x, boat.y, PENALTY_RING_R, bow, sweep, 0xffc240, 1);
      guides.push({ type: 'label', badge: true, x: boat.x + ahead.x, y: boat.y + ahead.y, lines: [{ text: (e.t.dir < 0 ? 'CW ' : 'CCW ') + e.t.left + '°', role: 'turn', id: 'turn' }] });
      continue;
    }
    const mt = e.mv ? penaltyManeuverText(e.mv) : null;
    if (!mt) continue;
    guides.push({ type: 'label', badge: true, x: boat.x + ahead.x, y: boat.y + ahead.y, lines: [{ text: mt, role: 'turn', id: 'turn' }] });
  }
  for (const f of s.cleared) {
    const b = byId.get(f.i);
    if (!b) continue;
    const boat = { x: b.x, y: b.y, hull_angle: b.ha };
    const at = sternOffset(boat, f.c > 0 ? 4.4 : 2.5);
    guides.push({ type: 'label', badge: true, x: boat.x + at.x, y: boat.y + at.y, lines: [{ text: 'CLEARED', role: 'cleared', id: 'cleared' }] });
  }
  return guides;
}

export function penaltyJustCleared(boat, nowMs) {
  if (!boat) return false;
  const now = typeof nowMs === 'number' ? nowMs : performance.now();
  for (let i = 0; i < R.penaltyCleared.length; i++) {
    const flash = R.penaltyCleared[i];
    if (flash.boat !== boat) continue;
    const age = now - flash.startedAtMs;
    if (age >= 0 && age <= PENALTY_CLEARED_MS) return true;
  }
  return false;
}
