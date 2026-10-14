// Scenario 19: two-boat boundary room test (dev mode). A short script per
// boat sets the existing autopilot TWA target (boat.autopilot_heading_target
// = −TWA, positive TWA = port tack) like race-bot.js, so the run is
// reproducible. Steering boat 0 by hand stops her script.
//
// Both boats beat on starboard toward the west boundary, overlapped: boat 0
// to leeward (inside, closer to the line), boat 1 to windward (outside). In
// the zone boat 0 is entitled to room to tack away ('Boundary room', rules.js
// 'BR'). She tacks onto port TACK_GAP_M from the line; boat 1 holds starboard
// and does not give room, so they collide. Rule 13 (while tacking) and
// Rule 10 (port/starboard, after the tack) would put boat 0 at fault, but
// Boundary room overrides both: boat 1 gets the penalty, boat 0 is
// exonerated. Boat 1 tacks away once she has been penalised.

import { Boat } from './boat.js';
import { Boundary } from './boundary.js';
import { trueWindAngleDeg } from './rules.js';

export const BOUNDARY_TEST_LAYOUT = {
  // Map width the layout is built for (default 100 × 200: line x = ±40,
  // zone 20 m, walls ±48).
  mapWidth: 100,
  boats: [
    { x: -14, y: -21, twa: -50 }, // boat 0: starboard, leeward / inside
    { x: -7.5, y: -21, twa: -50 }, // boat 1: starboard, windward / outside
  ],
  speed: 2.6,
  tackGapM: 6,        // boat 0 tacks this far from the west line
  lateTackM: 3,       // boat 1 only tacks this close (late, after the contact)
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
  // Tack away TACK_GAP_M before the line a boat is heading for (port tack
  // heads east, starboard west).
  function keepInside(bot) {
    const port = bot.target < 0;
    const side = port ? 1 : -1;
    if (boundary.sideDistance(bot.boat, side) <= L.tackGapM && !bot.boat.tacking) bot.set(port ? -50 : 50);
  }
  function step(simTime) {
    const d0 = boundary.sideDistance(b0.boat, -1);
    // Boat 0 (inside): tacks away from the boundary onto port.
    if (!b0.checkUser()) {
      if (b0.phase === 0 && d0 <= L.tackGapM) { b0.set(50); b0.phase = 1; b0.tackedAt = simTime; }
      else if (b0.phase >= 1) keepInside(b0);
    }
    // Boat 1 (outside): holds starboard, no room given; tacks away once the
    // line is close (keepInside).
    if (!b1.checkUser()) {
      if (b1.phase === 0 && boundary.sideDistance(b1.boat, -1) <= L.lateTackM) { b1.set(50); b1.phase = 1; }
      else if (b1.phase >= 1) keepInside(b1);
    }
  }
  return { boats, bots, boundary, step };
}

export { headingForTwa };
// For checks: signed TWA of a boat.
export function boatTwa(boat, windFromDeg) {
  return trueWindAngleDeg(boat.hull_angle, windFromDeg);
}
