// Bit-exact state hash of a running SimCore, for the replay determinism
// spike (docs/replay-determinism.md). Every float is hashed by its IEEE-754
// bits (NaN canonicalised), so two runs match only if they computed exactly
// the same numbers. No DOM, no Node APIs: runs in Node and in a browser.
//
// hashCoreState(core) → { all, field, boats, wind, race } as 16-hex strings:
//   field  every lattice cell (9 populations, rho, ux, uy) of the root grid
//          and of every refinement domain (recursively), plus domain bounds
//   boats  planck body (position, angle, velocities) and every primitive own
//          field of each Boat (rudder, autopilot PID state, sail, heel, ...)
//   wind   applied/base wind, schedule clock, gust columns
//   race   sim tick / rules time, marks, course progress, start, leaderboard
const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);

// Two independent 32-bit lanes (FNV-1a and a murmur-style mix) = 64 bits.
export class StateHasher {
  constructor() { this.a = 0x811c9dc5; this.b = 0x9747b28c; }

  word(w) {
    this.a = Math.imul(this.a ^ (w >>> 0), 0x01000193);
    let k = Math.imul(w >>> 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    this.b = Math.imul(this.b ^ Math.imul(k, 0x1b873593), 5) + 0xe6546b64;
    this.b = (this.b << 13) | (this.b >>> 19);
  }

  num(v) {
    if (typeof v !== 'number') { this.word(0x7e57ab1e); return; }
    if (v !== v) { this.word(0x7ff80000); this.word(0); return; }
    F64[0] = v;
    this.word(U32[0]);
    this.word(U32[1]);
  }

  str(s) {
    this.word(s.length);
    for (let i = 0; i < s.length; i++) this.word(s.charCodeAt(i));
  }

  // Own enumerable number / boolean / string fields, in insertion order
  // (skip: keys left out).
  prims(o, skip) {
    if (!o) { this.word(0); return; }
    for (const k of Object.keys(o)) {
      if (skip && skip.has(k)) continue;
      const v = o[k];
      const t = typeof v;
      if (t === 'number') { this.str(k); this.num(v); }
      else if (t === 'boolean') { this.str(k); this.word(v ? 1 : 2); }
      else if (t === 'string') { this.str(k); this.str(v); }
    }
  }

  // Plain JSON-able data (leaderboard, results).
  json(v) { this.str(JSON.stringify(v === undefined ? null : v)); }

  hex() {
    return (this.a >>> 0).toString(16).padStart(8, '0') + (this.b >>> 0).toString(16).padStart(8, '0');
  }
}

function hashCells(h, cells) {
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!c) { h.word(0xdead); continue; }
    h.num(c.f0); h.num(c.fN); h.num(c.fS); h.num(c.fE); h.num(c.fW);
    h.num(c.fNE); h.num(c.fNW); h.num(c.fSE); h.num(c.fSW);
    h.num(c.rho); h.num(c.ux); h.num(c.uy);
  }
}

function hashDomains(h, domains) {
  h.word(domains ? domains.length : 0);
  if (!domains) return;
  for (const d of domains) {
    h.num(d.cx0); h.num(d.cy0); h.num(d.cx1); h.num(d.cy1); h.num(d.depth);
    hashCells(h, d.cells);
    hashDomains(h, d.domains);
  }
}

export function hashField(bm) {
  const h = new StateHasher();
  h.num(bm.width); h.num(bm.height);
  hashCells(h, bm.cells);
  hashDomains(h, bm.domains);
  return h.hex();
}

// Boat.uid comes from a process-wide counter (boat.js _nextBoatUid): an
// identity, not sim state, and it differs between two cores in one process.
// awayUntil is the reconnect-grace countdown (Room._markAway), a wall-clock
// display value, not sim state.
const BOAT_SKIP = new Set(['uid', 'awayUntil']);

export function hashBoats(sim) {
  const h = new StateHasher();
  h.word(sim.players.length);
  for (const b of sim.players) {
    const body = b.physics_model;
    if (body) {
      const p = body.getPosition();
      const v = body.getLinearVelocity();
      h.num(p.x); h.num(p.y); h.num(body.getAngle());
      h.num(v.x); h.num(v.y); h.num(body.getAngularVelocity());
    }
    h.prims(b, BOAT_SKIP);
    h.prims(b.telemetry);
  }
  return h.hex();
}

export function hashWind(sim) {
  const h = new StateHasher();
  const map = sim.map;
  h.num(map.wind_direction); h.num(map.wind_speed);
  h.num(sim.windBase.angle); h.num(sim.windBase.speed);
  h.num(sim.windClock);
  const g = sim.gusts;
  if (g) {
    h.num(g._tick);
    h.word(g.columns.length);
    for (const c of g.columns) h.prims(c);
  }
  return h.hex();
}

export function hashRace(sim) {
  const h = new StateHasher();
  h.num(sim.ticks); h.num(sim.rulesTime); h.num(sim.frame);
  for (const m of sim.marks) { h.num(m.x); h.num(m.y); }
  if (sim.course) {
    for (const b of sim.players) {
      const p = sim.course.progressFor(b);
      h.num(p.target); h.num(p.display); h.num(p.floor);
      for (const t of p.trackers.values()) h.prims(t);
    }
  }
  if (sim.startSequence) h.prims(sim.startSequence);
  h.json(sim.leaderboard ? sim.leaderboard.toData() : null);
  const rr = sim.raceResults;
  if (rr) {
    h.prims(rr);
    h.word(rr.entries.length);
    for (const e of rr.entries) { h.prims(e); h.json(e.unserved || null); }
  }
  for (const r of (sim.last && sim.last.boats) || []) h.prims(r);
  return h.hex();
}

export function hashCoreState(core) {
  const field = hashField(core.bm);
  const boats = hashBoats(core.sim);
  const wind = hashWind(core.sim);
  const race = hashRace(core.sim);
  const h = new StateHasher();
  h.str(field); h.str(boats); h.str(wind); h.str(race);
  return { all: h.hex(), field, boats, wind, race };
}
