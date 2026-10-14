// Scenario 19: two-boat boundary test (dev mode). A short script per boat
// sets the existing autopilot TWA target (boat.autopilot_heading_target =
// −TWA, positive TWA = port tack) like race-bot.js, so the run is
// reproducible. Steering boat 0 by hand stops her script.
//
// Phase 1 (boundary room): boat 0 beats on port (heading NE) toward the
// east boundary inside its zone; boat 1 is on starboard (heading NW) a few
// metres to the west. Rule 10 makes boat 0 (port) keep clear and Rule 13
// while she tacks, but boat 0 is closer to the boundary and in the zone, so
// boat 1 must give her room to tack: 'Boundary room' decides, Rules 10/13
// are struck through. Boat 0 tacks TACK_GAP_M from the line.
// Phase 2 (crossing): boat 1 holds starboard across the west boundary; after
// the 1 s grace she gets a 'Boundary: crossed' pending penalty and tacks
// back inside. Boat 0 tacks back onto port near the middle of the course.
// After that both tack TACK_GAP_M before whichever line they head for.

import { Boat } from './boat.js';
import { Boundary } from './boundary.js';
import { trueWindAngleDeg } from './rules.js';

export const BOUNDARY_TEST_LAYOUT = {
  // Map width the layout is built for (default 100 × 200: line x = ±40,
  // zone 20 m, walls ±48).
  mapWidth: 100,
  boats: [
    { x: 33.5, y: -14, twa: 50 },   // boat 0: port, heading NE
    { x: 32, y: -19.5, twa: -50 }, // boat 1: starboard, heading NW, astern
  ],
  speed: 2.6,
  tackGapM: 5,        // boat 0 tacks this far from the east line
  boat0BackX: 8,      // boat 0 tacks back onto port west of this x
  boat1OutS: 1.6,     // boat 1 stays beyond the west line this long
};

// Boat heading (rad, boat.js convention: direction (sin h, −cos h)) for a
// signed TWA with the wind from windFromDeg.
function headingForTwa(twa, windFromDeg) {
  // Upwind direction is windFrom; course angle = windFrom ∓ |twa|
  // (port tack: wind on the port side, sailing to the right of the wind).
  const courseDeg = windFromDeg - twa; // math angle of the velocity
  const c = courseDeg * Math.PI / 180;
  const vx = Math.cos(c), vy = Math.sin(c);
  return Math.atan2(vx, -vy);
}

class ScriptBot {
  constructor(boat, twa) {
    this.boat = boat;
    this.stopped = false;
    this.phase = 0;
    this.set(twa);
  }
  set(twa) {
    this.target = -twa;
    this.boat.autopilot_heading_target = this.target;
    this.boat.autopilot_enabled = true;
  }
  checkUser() {
    const b = this.boat;
    if (this.stopped) return true;
    if (!b.autopilot_enabled || b.penalty_turn || Math.abs(b.autopilot_heading_target - this.target) > 1e-6) {
      this.stopped = true;
    }
    return this.stopped;
  }
}

export function setupBoundaryTest(map) {
  const L = BOUNDARY_TEST_LAYOUT;
  const wind = map.wind_direction ?? 90;
  // Built for the 100 m width on every map size, so the line stays at ±40
  // (on 200 × 400 the walls are just further out behind it).
  const boundary = new Boundary(L.mapWidth, { yMin: -(map.height ?? 200) / 2 + 2, yMax: (map.height ?? 200) / 2 - 2 });
  const boats = [];
  const bots = [];
  for (const p of L.boats) {
    const h = headingForTwa(p.twa, wind);
    const boat = new Boat(map, p.x, p.y, h);
    boat.physics_model.setLinearVelocity({ x: Math.sin(h) * L.speed, y: -Math.cos(h) * L.speed });
    boats.push(boat);
    bots.push(new ScriptBot(boat, p.twa));
  }
  const [b0, b1] = bots;
  let outSince = null;
  // Later on: tack away TACK_GAP_M before the line she is heading for
  // (port tack heads east, starboard west).
  function keepInside(bot) {
    const port = bot.target < 0;
    const side = port ? 1 : -1;
    if (boundary.sideDistance(bot.boat, side) <= L.tackGapM && !bot.boat.tacking) bot.set(port ? -50 : 50);
  }
  function step(simTime) {
    // Boat 0: tack at the east line, then tack back near the middle.
    if (!b0.checkUser()) {
      if (b0.phase === 0 && boundary.sideDistance(b0.boat, 1) <= L.tackGapM) { b0.set(-50); b0.phase = 1; b0.tackedAt = simTime; }
      else if (b0.phase === 1 && b0.boat.x < L.boat0BackX) { b0.set(50); b0.phase = 2; }
    }
    // Boat 1: hold starboard across the west line, then tack back inside.
    if (!b1.checkUser()) {
      const out = boundary.sideDistance(b1.boat, -1) < 0;
      if (b1.phase === 0 && out) { outSince = outSince ?? simTime; if (simTime - outSince >= L.boat1OutS) { b1.set(50); b1.phase = 1; } }
      else if (b1.phase >= 1) keepInside(b1);
    }
    if (!b0.stopped && b0.phase >= 2) keepInside(b0);
  }
  return { boats, bots, boundary, step };
}

export { headingForTwa };
// For checks: signed TWA of a boat.
export function boatTwa(boat, windFromDeg) {
  return trueWindAngleDeg(boat.hull_angle, windFromDeg);
}
