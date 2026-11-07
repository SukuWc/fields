// Steady-wind dinghy calibration. One boat, autopilot, dev mode (constant
// wind, so TWS is the set value and not the boat's own wake).
//
//   node --import ./test/register.mjs scripts/dinghy-force-calibration.mjs
//
// Logs sail side and drive force (N), heel, hike, rudder, boat speed and
// the time to 90 % of settled speed, close-hauled and on a beam reach, at
// TWS 3, 4, 5, 6, 8 and 10 m/s. Then the true wind where close-hauled hike
// first saturates. No DOM in the sim; this script only drives SimCore.
import '../test/dom-stub.mjs';
import { SimCore } from '../src/host.js';
import { LASER_POLAR, POLAR_VALIDATED_TWS_MPS } from '../src/dinghy-forces.js';

const DT = 1 / 30;
const SETTLES = 22; // seconds. Wind smoothing and the hike ramp finish well inside this.
const TAIL_S = 3;
export const TWS_GRID = LASER_POLAR.map((p) => p.tws);

const log0 = console.log;
const mute = (fn) => {
  console.log = () => {};
  try { return fn(); } finally { console.log = log0; }
};

function mean(a) {
  return a.reduce((s, x) => s + x, 0) / a.length;
}

// Starboard: close-hauled is the autopilot best-VMG snap (target 50 → TWA −50).
// Beam reach is target 90 → TWA −90.
export const HEADINGS = Object.freeze([
  { name: 'close-hauled', target: null, polar: 'close' },
  { name: 'beam-reach', target: 90, polar: 'beam' },
]);

export function runCase(tws, heading, seconds = SETTLES) {
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f', texture: undefined });
  mute(() => {
    core.command({ type: 'devMode', on: true });
    core.command({ type: 'restart', scenario: 0 });
    core.command({ type: 'wind', angle: 90, speed: tws });
    core.map.world.step(DT);
    core.sim.step(DT, []);
  });
  const b = core.sim.players[0];
  if (!b) throw new Error('scenario 0 spawned no boat');
  // Start already on the asked heading. Bearing away from close-hauled at
  // the higher wind speeds broaches (weather helm, no flow on the rudder)
  // and the steady state is never reached.
  if (heading.target != null) {
    const ang = (heading.target === 90) ? 3 * Math.PI / 2 : b.physics_model.getAngle();
    const speed0 = 0;
    b.physics_model.setTransform(b.physics_model.getPosition(), ang);
    b.physics_model.setLinearVelocity({ x: Math.sin(ang) * speed0, y: -Math.cos(ang) * speed0 });
    b.physics_model.setAngularVelocity(0);
    b.autopilot_heading_target = heading.target;
    b.autopilot_compensator_sum_error = 0;
    b.autopilot_compensator_last_error = 0;
    b.rudder_angle = 0;
  }
  const speeds = [];
  const ticks = Math.round(seconds * 30);
  for (let i = 0; i < ticks; i++) {
    const p = b.physics_model.getPosition();
    // Dev-mode wind does not depend on position. Keep her off the walls.
    if (Math.abs(p.x) > 40 || Math.abs(p.y) > 80) {
      b.physics_model.setTransform({ x: 10, y: -9 }, b.physics_model.getAngle());
    }
    mute(() => { core.map.world.step(DT); core.sim.step(DT, []); });
    const v = b.physics_model.getLinearVelocity();
    speeds.push(Math.hypot(v.x, v.y));
  }
  const tailN = Math.round(TAIL_S * 30);
  const tail = speeds.slice(-tailN);
  const bs = mean(tail);
  const i90 = speeds.findIndex((v) => v >= 0.9 * bs);
  const samples = [];
  // Re-read the last TAIL_S seconds of state from a second pass would be
  // expensive. The last tick is inside the tail; collect by rewinding is
  // not available, so sample the final window on a short continuation.
  for (let i = 0; i < tailN; i++) {
    const p = b.physics_model.getPosition();
    if (Math.abs(p.x) > 40 || Math.abs(p.y) > 80) {
      b.physics_model.setTransform({ x: 10, y: -9 }, b.physics_model.getAngle());
    }
    mute(() => { core.map.world.step(DT); core.sim.step(DT, []); });
    const v = b.physics_model.getLinearVelocity();
    const fN = Math.hypot(b.sail_side_force_n || 0, b.sail_drive_force_n || 0);
    const fI = b.mainsail_force ? Math.hypot(b.mainsail_force.x, b.mainsail_force.y) : NaN;
    samples.push({
      bs: Math.hypot(v.x, v.y),
      twa: b.twa,
      heel: b.heel.phi * 180 / Math.PI,
      hike: Math.abs(b.heel.hike) * 100,
      rudder: b.rudder_angle,
      sideN: b.sail_side_force_n,
      driveN: b.sail_drive_force_n,
      // Hull internal force and heel newtons are one vector (dinghy-forces).
      forceMatch: Number.isFinite(fI) && Math.abs(fI - fN * b._sailForcePerN) < 1e-6,
    });
  }
  const m = (k) => mean(samples.map((s) => s[k]));
  return {
    tws,
    heading: heading.name,
    bs: m('bs'),
    twa: m('twa'),
    heel: m('heel'),
    hike: m('hike'),
    rudder: m('rudder'),
    sideN: m('sideN'),
    driveN: m('driveN'),
    t90: i90 < 0 ? null : i90 / 30,
    extrapolated: tws > POLAR_VALIDATED_TWS_MPS,
    forceMatch: samples.every((s) => s.forceMatch),
  };
}

export function hikeSaturationTws() {
  // Lowest TWS at which settled close-hauled hike reaches 100 %.
  let lo = 3, hi = 10, best = null;
  for (let n = 0; n < 8; n++) {
    const mid = (lo + hi) / 2;
    const r = runCase(mid, HEADINGS[0], 18);
    if (r.hike >= 99.5) { best = { tws: mid, ...r }; hi = mid; }
    else lo = mid;
  }
  return best;
}

export function sweep() {
  const rows = [];
  for (const tws of TWS_GRID) {
    for (const h of HEADINGS) rows.push(runCase(tws, h));
  }
  return rows;
}

function fmt(row) {
  const tag = row.extrapolated ? ' extrapolated' : '';
  return `${row.heading.padEnd(13)} TWS ${row.tws.toFixed(1)}  bs ${row.bs.toFixed(2)}  twa ${row.twa.toFixed(1)}  heel ${row.heel.toFixed(1)}  hike ${row.hike.toFixed(0).padStart(3)}%  rud ${row.rudder.toFixed(1)}  side ${row.sideN.toFixed(0).padStart(4)} N  drive ${row.driveN.toFixed(0).padStart(4)} N  t90 ${row.t90 == null ? '—' : row.t90.toFixed(1) + ' s'}${tag}`;
}

const isMain = process.argv[1] && process.argv[1].endsWith('dinghy-force-calibration.mjs');
if (isMain) {
  console.log(`steady TWS, dev mode, autopilot. Polars validated only through ${POLAR_VALIDATED_TWS_MPS} m/s (Day 2017, 15 kn). Above that: extrapolated. Planing is not modelled.`);
  console.log('heading        TWS   bs m/s   TWA    heel   hike   rudder   side N   drive N   time to 90%');
  const rows = sweep();
  for (const row of rows) console.log(fmt(row));
  const sat = hikeSaturationTws();
  console.log(`close-hauled hike first saturates at TWS ${sat ? sat.tws.toFixed(2) : '?'} m/s (hike ${sat ? sat.hike.toFixed(0) : '?'}%, heel ${sat ? sat.heel.toFixed(1) : '?'}°)`);
  console.log('polar comparison (boat speed m/s):');
  for (const p of LASER_POLAR) {
    const c = rows.find((r) => r.tws === p.tws && r.heading === 'close-hauled');
    const b = rows.find((r) => r.tws === p.tws && r.heading === 'beam-reach');
    const tag = p.extrapolated ? ' extrapolated' : '';
    console.log(`  TWS ${p.tws}  close ${c.bs.toFixed(2)} vs ${p.close.toFixed(2)} (${((c.bs / p.close - 1) * 100).toFixed(0)}%)  beam ${b.bs.toFixed(2)} vs ${p.beam.toFixed(2)} (${((b.bs / p.beam - 1) * 100).toFixed(0)}%)${tag}`);
  }
}
