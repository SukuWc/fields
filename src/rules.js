// Racing Rules of Sailing, Section A.
//
// Implemented: the 12 m interest gate, Rule 10 (opposite tacks), Rule 11
// (same tack, overlapped), Rule 12 (same tack, clear astern), Rule 13
// (while tacking), and Rule 15 (acquiring right of way).
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
// blocked rule shows on its own. Simulation time is the sum of Planck
// Runner steps (1/30 s each, the `fps: 30` passed to world.step). The
// runner also redraws once per animation frame without stepping; those
// calls do not advance the clock. Pausing stops the runner, so the clock
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

export const BOAT_LENGTH_M = 4;
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
// Planck Runner is constructed with fps: 30, and world.step receives 1/30.
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

// Per-boat Rule 13 state. Call once per physics step, after hull_angle is
// current. Reads Map.get_wind so dev mode and the lattice share one path.
// `boat.tacking` is the flag Section A reads. `boat.tackingOnto` is the tack
// she must reach close-hauled on ('port' | 'starboard').
export function updateTackingState(boat) {
  if (!boat || !boat.map || typeof boat.map.get_wind !== 'function') return;
  if (!Number.isFinite(boat.hull_angle) || !Number.isFinite(boat.x) || !Number.isFinite(boat.y)) return;
  const from = windFromDeg(boat.map.get_wind(boat.x, boat.y));
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

// Rule 13: a tacking boat keeps clear. She is not given Rules 10–12 rights.
// Both tacking: each keeps clear of the other (no right-of-way boat).
function rule13(boatA, boatB, clearance) {
  const aTacking = isTacking(boatA);
  const bTacking = isTacking(boatB);
  if (!aTacking && !bTacking) return null;
  if (aTacking && bTacking) {
    return {
      rule: 'Rule 13 both',
      bothGiveWay: true,
      boats: [boatA, boatB],
      clearance,
    };
  }
  const giveWay = aTacking ? boatA : boatB;
  const rightOfWay = aTacking ? boatB : boatA;
  return {
    rule: 'Rule 13',
    rightOfWay,
    giveWay,
    clearance,
  };
}

// Rule 11: windward keeps clear of leeward.
function rule11(boatA, boatB, fromA, fromB, clearance) {
  const windward = windwardBoat(boatA, boatB, fromA, fromB);
  if (!windward) return null;
  const leeward = windward === boatA ? boatB : boatA;
  return {
    rule: 'Rule 11',
    rightOfWay: leeward,
    giveWay: windward,
    clearance,
  };
}

// Rule 12: clear astern keeps clear of clear ahead.
function rule12(clearAhead, clearAstern, clearance) {
  return {
    rule: 'Rule 12',
    rightOfWay: clearAhead,
    giveWay: clearAstern,
    clearance,
  };
}

function rule10(boatA, boatB, tackA, clearance) {
  const rightOfWay = tackA === 'starboard' ? boatA : boatB;
  const giveWay = tackA === 'port' ? boatA : boatB;
  return {
    rule: 'Rule 10',
    rightOfWay,
    giveWay,
    clearance,
  };
}

// Section A between two racing boats. Null means no overlay.
export function evaluateSectionA(boatA, boatB, getWind) {
  if (!boatA || !boatB || typeof getWind !== 'function') return null;
  if (!Number.isFinite(boatA.x) || !Number.isFinite(boatA.y)) return null;
  if (!Number.isFinite(boatB.x) || !Number.isFinite(boatB.y)) return null;

  const clearance = boatClearance(boatA, boatB);
  if (!(clearance <= RULE10_INTEREST_RANGE_M)) return null;

  const whileTacking = rule13(boatA, boatB, clearance);
  if (whileTacking) return whileTacking;

  const fromA = windFromDeg(getWind(boatA.x, boatA.y));
  const fromB = windFromDeg(getWind(boatB.x, boatB.y));
  if (fromA === null || fromB === null) return null;

  const tackA = classifyTack(boatA.hull_angle, fromA);
  const tackB = classifyTack(boatB.hull_angle, fromB);
  if (!tackA || !tackB) return null;

  if (tackA !== tackB) return rule10(boatA, boatB, tackA, clearance);

  const geometry = sameTackGeometry(boatA, boatB);
  if (!geometry) return null;
  if (geometry.overlapped) return rule11(boatA, boatB, fromA, fromB, clearance);
  if (geometry.clearAhead && geometry.clearAstern) {
    return rule12(geometry.clearAhead, geometry.clearAstern, clearance);
  }
  return null;
}

// Short segment through the aftermost hull station, perpendicular to course.
// Null if the hull or heading is missing.
export function sternAbeamSegment(boat) {
  const poly = hullVerticesWorld(boat);
  const forward = headingForward(boat && boat.hull_angle);
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
  if (!obligation) return [];
  if (obligation.rule === 'Rule 12') {
    const mark = sternAbeamSegment(obligation.rightOfWay);
    return mark ? [mark] : [];
  }
  if (obligation.rule === 'Rule 11') {
    const marks = [];
    const leeward = sternAbeamSegment(obligation.rightOfWay);
    const windward = sternAbeamSegment(obligation.giveWay);
    if (leeward) marks.push(leeward);
    if (windward) marks.push(windward);
    return marks;
  }
  return [];
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

// Identity for pair memory. Live boats are keyed in a WeakMap. A what-if
// snapshot carries the same number on `id` plus `_ruleHull`, and does not
// keep the boat object alive.
const boatIds = new WeakMap();
let nextBoatId = 1;
const pairMemory = new Map();

function boatId(boat) {
  if (!boat) return 0;
  if (Number.isInteger(boat.id) && Array.isArray(boat._ruleHull)) return boat.id;
  let id = boatIds.get(boat);
  if (!id) {
    id = nextBoatId++;
    boatIds.set(boat, id);
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

function rule15Overlay(obligation, blockedRule, progress) {
  const row = obligation.rightOfWay;
  const give = obligation.giveWay;
  const mx = (row.x + give.x) / 2;
  const my = (row.y + give.y) / 2;
  return [
    { type: 'rule', color: RIGHT_OF_WAY_COLOR, x1: mx, y1: my, x2: row.x, y2: row.y, z: 0.2 },
    {
      type: 'rule',
      color: ROOM_OWED_COLOR,
      stroke: ROOM_OWED_STROKE_M,
      x1: mx, y1: my, x2: row.x, y2: row.y,
      z: 0.22,
    },
    { type: 'rule', color: GIVE_WAY_COLOR, x1: mx, y1: my, x2: give.x, y2: give.y, z: 0.2 },
    {
      type: 'label',
      text: 'Rule 15 (blocks ' + blockedRule + ')',
      x: mx,
      y: my,
      rule15: true,
      progress,
    },
    ...sternMarks(obligation),
  ];
}

function sectionAWithRule15(boatA, boatB, getWind, simTime) {
  const obligation = evaluateSectionA(boatA, boatB, getWind);
  const clearance = obligation ? obligation.clearance : boatClearance(boatA, boatB);
  const inRange = Number.isFinite(clearance) && clearance <= RULE10_INTEREST_RANGE_M;
  const key = pairKey(boatA, boatB);
  let mem = pairMemory.get(key);
  if (!mem) {
    mem = {};
    pairMemory.set(key, mem);
  }

  let active = mem.active || null;
  if (active) {
    const elapsed = simTime - active.startedAt;
    const timedOut = elapsed + 1e-6 >= RULE15_ROOM_S;
    const separated = !(clearance < RULE15_RANGE_M);
    const owesNow = rowId(obligation) === active.owesId;
    if (timedOut || separated || !owesNow) active = null;
  }

  const prevTime = mem.simTime;
  const consecutive = typeof prevTime === 'number'
    && Math.abs((simTime - prevTime) - SIM_STEP_S) <= 1e-6;
  const nextRowId = rowId(obligation);
  if (consecutive && mem.inRange && nextRowId && nextRowId !== mem.rowId && clearance < RULE15_RANGE_M) {
    const prevA = snapFor(mem.snaps, boatA);
    const prevB = snapFor(mem.snaps, boatB);
    const cause = acquisitionCause(boatA, boatB, prevA, prevB, mem.rowId, nextRowId, getWind);
    if (cause && boatId(cause) === nextRowId && obligation) {
      active = {
        owesId: nextRowId,
        blockedRule: obligation.rule,
        startedAt: simTime,
      };
    }
  }

  // A second callback at the same simulation time is a redraw between physics
  // steps. Keep last step's snapshots so the next real step can still what-if.
  if (prevTime !== simTime) {
    mem.simTime = simTime;
    mem.inRange = inRange;
    mem.rowId = nextRowId;
    mem.snaps = [captureBoat(boatA, getWind), captureBoat(boatB, getWind)];
  }
  mem.active = active;

  if (active && obligation && rowId(obligation) === active.owesId && clearance < RULE15_RANGE_M) {
    const elapsed = simTime - active.startedAt;
    const progress = Math.max(0, Math.min(1, (RULE15_ROOM_S - elapsed) / RULE15_ROOM_S));
    return rule15Overlay(obligation, active.blockedRule, progress);
  }
  return obligationOverlay(obligation);
}

// Drop pairs that missed the previous physics step (scenario restart, a boat
// leaving). Called once per rules update, before the pair loop.
export function beginRule15Step(simTime) {
  if (typeof simTime !== 'number' || !Number.isFinite(simTime)) return;
  for (const [key, mem] of pairMemory) {
    if (typeof mem.simTime !== 'number') continue;
    if (simTime - mem.simTime > SIM_STEP_S + 1e-4) pairMemory.delete(key);
  }
}

export function resetRule15Memory() {
  pairMemory.clear();
}

// Guide records for the debug overlay. Pass simTime (seconds, advanced only
// on physics steps) to apply Rule 15. Omit it for the stateless Rules 10–13
// overlay used by the headless checks.
export function sectionAOverlay(boatA, boatB, getWind, simTime) {
  if (typeof simTime !== 'number' || !Number.isFinite(simTime)) {
    return obligationOverlay(evaluateSectionA(boatA, boatB, getWind));
  }
  return sectionAWithRule15(boatA, boatB, getWind, simTime);
}
