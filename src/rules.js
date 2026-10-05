// Racing Rules of Sailing, Section A.
//
// Implemented: the 12 m interest gate, Rule 10 (opposite tacks), Rule 11
// (same tack, overlapped) and Rule 12 (same tack, clear astern).
// Rule 13 (while tacking) stays a stub. Boat has no tacking flag, and a
// heading rate is not a substitute, so Rule 13 never draws an overlay.
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
// Stern mark. While Rule 11 or Rule 12 is showing, a short cyan dashed
// segment is drawn through the aftermost hull point, perpendicular to that
// boat's course — the same abeam line the clear-astern test uses, so the
// mark is where 11 and 12 swap. Rule 12 draws it on the clear-ahead boat
// only (her stern is the line the trailer must stay behind). Rule 11 draws
// it on both boats. Rule 10 does not draw it. The segment is 4 m long,
// centered on the aftermost station, a bit wider than the 1.5 m beam.

export const BOAT_LENGTH_M = 4;
// Shared Section A gate. The name is historical; Rules 10, 11, and 12 all use it.
export const RULE10_INTEREST_RANGE_M = 3 * BOAT_LENGTH_M;

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

// Rule 13 needs a tacking state. Boat does not record one, and a heading
// rate is not a substitute (a boat can be head to wind without tacking, and
// can be tacking before she is head to wind). Skip the rule.
function rule13(_boatA, _boatB) {
  return null;
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

  const whileTacking = rule13(boatA, boatB);
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

// Guide records for the debug overlay. Empty when Section A does not apply.
// Green runs from the midpoint to the right-of-way boat; red to the give-way boat.
// A cyan dashed stern mark is appended for Rules 11 and 12.
export function sectionAOverlay(boatA, boatB, getWind) {
  const obligation = evaluateSectionA(boatA, boatB, getWind);
  if (!obligation) return [];

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
