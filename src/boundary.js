// Virtual course boundary (SailGP style), enabled per scenario (only 19).
//
// Two boundary lines run along the side edges of the map, parallel to the
// wind axis (Y), `inset` metres inside the walls. The walls stay the hard
// limit behind them. A zone of `zone` metres lies inside each line.
//
// Boundary room (game rule, rules.js id 'BR', evaluateBoundaryRoom): when
// the boat closer to a side's boundary is in that side's zone, she is
// entitled to room to tack or gybe away from it; the other boat of the pair
// (inside the usual 12 m pair gate) must give that room, whatever Section A
// says (Rules 10-13). Only the closer boat needs to be in the zone: the
// other one is usually sailing in toward her from further out.
//
// Crossing: any hull vertex beyond the line for BOUNDARY_GRACE_S of sim time
// in a row adds one pending penalty 'Boundary: crossed' (cleared like any
// other: tack + gybe or the Q/E circle). It re-arms once the whole hull is
// back inside.

import { chargePendingPenalty, hullVerticesWorld } from './rules.js';
import { WALL_INSET_M } from './map-size.js';

export const BOUNDARY_ZONE_M = 20; // 5 boat lengths
export const BOUNDARY_INSET_M = 8; // boundary line inside the wall
export const BOUNDARY_GRACE_S = 1;
// The entitlement freezes only once one boat is this much closer (hysteresis).
export const BOUNDARY_TIE_M = 1;
// Leaving the zone ends the entitlement this far beyond the zone edge.
export const BOUNDARY_EXIT_HYST_M = 1;
export const BOUNDARY_LINE_COLOR = 0xff3b30;
export const BOUNDARY_ZONE_COLOR = 0xff8a80;

export class Boundary {
  // mapWidth (m). Line at x = ±(w/2 − wall inset − inset). The zone is
  // BOUNDARY_ZONE_M but at most 20 % of the width (10 m on the 50 m map),
  // so the two zones never meet; the inset is at most 8 % of the width.
  constructor(mapWidth, opts = {}) {
    const inset = opts.inset ?? Math.min(BOUNDARY_INSET_M, mapWidth * 0.08);
    this.x = mapWidth / 2 - WALL_INSET_M - inset;
    this.zone = opts.zone ?? Math.min(BOUNDARY_ZONE_M, mapWidth * 0.2);
    this.yMin = opts.yMin ?? -200;
    this.yMax = opts.yMax ?? 200;
    this.grace = opts.grace ?? BOUNDARY_GRACE_S;
    this._cross = new Map(); // boat -> { outSince, armed }
    this.crossings = [];
  }

  // Distance from the hull to one side's line (+1 east, −1 west); negative
  // once part of the hull is beyond it.
  sideDistance(boat, side) {
    let d = Infinity;
    for (const p of hullPoints(boat)) d = Math.min(d, side > 0 ? this.x - p.x : p.x + this.x);
    return d;
  }

  // Nearest side: { side, dist }.
  distanceOf(boat) {
    const e = this.sideDistance(boat, 1), w = this.sideDistance(boat, -1);
    return e <= w ? { side: 1, dist: e } : { side: -1, dist: w };
  }

  inZone(boat, side) {
    return this.sideDistance(boat, side) <= this.zone;
  }

  // Once per world step: boundary crossings, one penalty per excursion.
  update(boats, simTime) {
    const charged = [];
    for (const boat of boats || []) {
      if (!boat) continue;
      let st = this._cross.get(boat);
      if (!st) { st = { outSince: null, armed: true }; this._cross.set(boat, st); }
      const d = this.distanceOf(boat);
      if (d.dist >= 0) { st.outSince = null; st.armed = true; continue; }
      if (st.outSince === null) st.outSince = simTime;
      if (st.armed && simTime - st.outSince >= this.grace - 1e-9) {
        st.armed = false;
        const incident = {
          time: simTime, rule: 'Boundary', finalRule: 'Boundary', kind: 'boundary',
          faultBoat: boat, side: d.side,
          reason: 'Boundary: crossed', label: 'Boundary · crossed',
        };
        this.crossings.push(incident);
        chargePendingPenalty(boat, incident);
        charged.push(incident);
      }
    }
    return charged;
  }

  isOutside(boat) {
    const st = this._cross.get(boat);
    return !!(st && st.outSince !== null);
  }

  // Faint overlay: dashed red/white boundary line, dashed zone edge, light
  // diagonal hatching across the zone.
  guides() {
    return boundaryGuides(this.boundaryState());
  }

  boundaryState() { return { x: this.x, zone: this.zone, yMin: this.yMin, yMax: this.yMax }; }
}

// Boundary overlay from its state ({ x, zone, yMin, yMax }; scene-build.js).
export function boundaryGuides(b) {
  const g = [];
  const y0 = b.yMin, y1 = b.yMax;
  for (const s of [1, -1]) {
    const x = s * b.x;
    let k = 0;
    for (let y = y0; y < y1; y += 2, k++) {
      g.push({ type: 'guide', color: k % 2 ? 0xffffff : BOUNDARY_LINE_COLOR, opacity: 0.85, x1: x, y1: y, x2: x, y2: Math.min(y1, y + 2) });
    }
    const xi = s * (b.x - b.zone);
    for (let y = y0; y < y1; y += 4) {
      g.push({ type: 'guide', color: BOUNDARY_ZONE_COLOR, opacity: 0.35, x1: xi, y1: y, x2: xi, y2: Math.min(y1, y + 1.5) });
    }
    for (let y = y0; y < y1 - b.zone * 0.5; y += 6) {
      g.push({ type: 'guide', color: BOUNDARY_ZONE_COLOR, opacity: 0.12, x1: xi, y1: y, x2: x, y2: y + b.zone * 0.5 });
    }
  }
  return g;
}

function hullPoints(boat) {
  const v = hullVerticesWorld(boat);
  if (v && v.length) return v;
  return Array.isArray(boat.hull) && boat.hull.length ? boat.hull : [{ x: boat.x, y: boat.y }];
}
