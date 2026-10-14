// Scenario 19: two-boat boundary room test (dev mode). A short script per
// boat sets the existing autopilot TWA target (boat.autopilot_heading_target
// = −TWA, positive TWA = port tack) like race-bot.js, so the run is
// reproducible. Steering boat 0 by hand stops her script.
//
// Both boats beat on port toward the east boundary, overlapped about one
// boat length apart abeam: boat 0 to leeward (inside, closer to the line),
// boat 1 to windward (outside). Boat 0 reaches the zone first and closer, so
// she is entitled to room to tack away from the boundary ('Boundary room',
// rules.js 'BR'). Without the boundary, Rule 13 would make boat 0 keep clear
// while she tacks into boat 1's water and she would be stuck heading for the
// line; with it, boat 1 must give room: she tacks first (ROOM_TACK_M from the
// line, measured on boat 0), then boat 0 tacks TACK_GAP_M from the line.
// Rule 13 is struck through in the label stack while boat 0 tacks.
// Afterwards both beat on starboard and tack TACK_GAP_M before any line.

import { Boat } from './boat.js';
import { Boundary } from './boundary.js';
import { trueWindAngleDeg } from './rules.js';

export const BOUNDARY_TEST_LAYOUT = {
  // Map width the layout is built for (default 100 × 200: line x = ±40,
  // zone 20 m, walls ±48).
  mapWidth: 100,
  boats: [
    { x: 14, y: -24, twa: 50 },   // boat 0: port, leeward / inside
    { x: 10, y: -20, twa: 50 },   // boat 1: port, windward / outside
  ],
  speed: 2.6,
  roomTackM: 10,      // boat 1 tacks to give room when boat 0 is this close
  tackGapM: 6,        // boat 0 tacks this far from the east line
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
    const d0 = boundary.sideDistance(b0.boat, 1);
    // Boat 1 (outside): gives room by tacking first.
    if (!b1.checkUser()) {
      if (b1.phase === 0 && d0 <= L.roomTackM) { b1.set(-50); b1.phase = 1; b1.tackedAt = simTime; }
      else if (b1.phase >= 1) keepInside(b1);
    }
    // Boat 0 (inside): tacks away from the boundary once she has room.
    if (!b0.checkUser()) {
      if (b0.phase === 0 && d0 <= L.tackGapM) { b0.set(-50); b0.phase = 1; b0.tackedAt = simTime; }
      else if (b0.phase >= 1) keepInside(b0);
    }
  }
  return { boats, bots, boundary, step };
}

export { headingForTwa };
// For checks: signed TWA of a boat.
export function boatTwa(boat, windFromDeg) {
  return trueWindAngleDeg(boat.hull_angle, windFromDeg);
}
