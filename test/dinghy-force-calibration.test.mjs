// Steady-wind sail force and hull drag (scripts/dinghy-force-calibration.mjs).
// Dev mode, one boat, autopilot. Close-hauled hike saturates in 5–6 m/s.
// Boat speed stays near the Laser polar in src/dinghy-forces.js. True wind
// above 7.7 m/s is extrapolated (Day 2017 stops at 15 kn) and is labelled.
import './dom-stub.mjs';
import { apparentWindMs, bareHullDragArea, dinghyTotalMass, hullResistanceNewtons, hydroToInternal, internalForcePerNewton, LASER_POLAR, legacyInternalPerNewton, POLAR_VALIDATED_TWS_MPS, residuaryDragArea, yawInertia, PLANING_HUMP_MPS } from '../src/dinghy-forces.js';
import { DINGHY_DEFAULTS } from '../src/heel.js';
import { WIND_UNIT_MPS } from '../src/wind.js';
import { Boat, FORCE_PASSES } from '../src/boat.js';
import { Map } from '../src/map.js';
import { hikeSaturationTws, sweep } from '../scripts/dinghy-force-calibration.mjs';

let failed = 0;
function check(name, ok, info = '') {
  if (!ok) failed++;
  console.info(`${ok ? 'ok  ' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
}

// Apparent wind in one unit: m/s + m/s.
{
  const still = apparentWindMs({ x: 0, y: 0 }, 0, 5);
  check('still boat: AWS = TWS', Math.abs(Math.hypot(still.x, still.y) - 5) < 1e-12);
  const up = apparentWindMs({ x: 2, y: 0 }, 0, 5);
  check('upwind boat speed adds to AWS', Math.abs(Math.hypot(up.x, up.y) - 7) < 1e-12);
  const oldMixed = Math.hypot(2 + 5 / WIND_UNIT_MPS, 0) * WIND_UNIT_MPS;
  check('old mix (m/s boat + internal wind) under-states AWS', oldMixed < 6.5 && oldMixed > 5);
}

// Mass is kilograms, so the hull integrates newtons: the pre-applyFinite
// vector is F_newton / FORCE_PASSES. hydroToInternal is the old centreboard
// bridge; the foils no longer use it (foil.js).
{
  const area = DINGHY_DEFAULTS.sailArea;
  const perN = internalForcePerNewton(FORCE_PASSES);
  const legacy = legacyInternalPerNewton(area, WIND_UNIT_MPS);
  check('internal force per newton is 1/FORCE_PASSES', Math.abs(perN * FORCE_PASSES - 1) < 1e-12, perN.toFixed(4));
  check('hydro scale lands the centreboard on that unit', Math.abs(hydroToInternal(area, WIND_UNIT_MPS, FORCE_PASSES) * legacy - perN) < 1e-12);
  const map = new Map(40, 40, 90, 4.5, null);
  map.physics_model_init();
  map.setDevMode(true);
  const boat = new Boat(map, 0, 0, 0);
  const mass = dinghyTotalMass();
  check('rigid body mass is hull + crew', Math.abs(boat.physics_model.getMass() - mass) < 1e-9, boat.physics_model.getMass().toFixed(3));
  check('yaw inertia is the Laser estimate about the CG', Math.abs(boat.physics_model.m_I - yawInertia()) < 1e-6, boat.physics_model.m_I.toFixed(2));
}

// Bare-hull drag area below the planing hump sits in the Day & Nixon
// figure axis (about 0.010–0.028 m²). Above the hump, residuary keeps
// climbing (no planing relief).
{
  const kn = (k) => k * 0.514444;
  for (const k of [2, 4, 6]) {
    const a = bareHullDragArea(kn(k));
    check(`bare drag area at ${k} kn inside 0.008–0.030 m²`, a > 0.008 && a < 0.030, a.toFixed(4));
  }
  const atHump = residuaryDragArea(PLANING_HUMP_MPS);
  const above = residuaryDragArea(PLANING_HUMP_MPS + 0.8);
  check('residuary keeps rising above the 6.5 kn hump (no planing)', above > atHump * 1.2, `${atHump.toFixed(4)} → ${above.toFixed(4)}`);
  check('resistance is zero at rest and rises with speed', hullResistanceNewtons(0) === 0 && hullResistanceNewtons(3) > hullResistanceNewtons(2));
}

const rows = sweep();
check('grid is the six true-wind speeds', rows.length === LASER_POLAR.length * 2);
for (const row of rows) {
  const polar = LASER_POLAR.find((p) => p.tws === row.tws);
  const target = row.heading === 'close-hauled' ? polar.close : polar.beam;
  const frac = row.heading === 'close-hauled'
    ? (row.tws <= 3 ? 0.25 : 0.12)
    : (row.extrapolated ? 0.25 : 0.15);
  const tag = row.extrapolated ? ' extrapolated' : '';
  check(`${row.heading} ${row.tws} m/s speed within ${(frac * 100).toFixed(0)}% of polar${tag}`,
    Math.abs(row.bs / target - 1) <= frac,
    `${row.bs.toFixed(2)} vs ${target.toFixed(2)}`);
  check(`${row.heading} ${row.tws} m/s extrapolated flag`, row.extrapolated === (row.tws > POLAR_VALIDATED_TWS_MPS) && row.extrapolated === polar.extrapolated);
  check(`${row.heading} ${row.tws} m/s forces finite, heel and hull share one force`,
    row.sideN > 20 && row.driveN > 10 && row.forceMatch && Number.isFinite(row.heel) && Number.isFinite(row.rudder),
    `side ${row.sideN.toFixed(0)} drive ${row.driveN.toFixed(0)}`);
  check(`${row.heading} ${row.tws} m/s reaches 90% speed`, row.t90 > 0 && row.t90 < 40, `${row.t90}`);
  if (row.heading === 'close-hauled') {
    check(`close-hauled ${row.tws} m/s holds a beat`, Math.abs(row.twa) >= 40 && Math.abs(row.twa) <= 55, row.twa.toFixed(1));
  } else if (!row.extrapolated) {
    check(`beam ${row.tws} m/s holds a reach`, Math.abs(row.twa) >= 80 && Math.abs(row.twa) <= 100, row.twa.toFixed(1));
  } else {
    check(`beam ${row.tws} m/s still reaching (weather helm, extrapolated)`, Math.abs(row.twa) >= 60 && Math.abs(row.twa) <= 100, row.twa.toFixed(1));
  }
}
const at3 = rows.find((r) => r.heading === 'close-hauled' && r.tws === 3);
const at5 = rows.find((r) => r.heading === 'close-hauled' && r.tws === 5);
const at6 = rows.find((r) => r.heading === 'close-hauled' && r.tws === 6);
check('close-hauled 3 m/s is not yet fully hiked', at3.hike < 60, `${at3.hike.toFixed(0)}%`);
check('close-hauled 5 m/s hike still short of 100%', at5.hike < 99, `${at5.hike.toFixed(0)}%`);
check('close-hauled 6 m/s hike is saturated', at6.hike >= 99, `${at6.hike.toFixed(0)}%`);

const sat = hikeSaturationTws();
check('full hike first reached between 5 and 6 m/s close-hauled',
  sat && sat.tws >= 5 && sat.tws <= 6 && sat.hike >= 99.5,
  sat ? `${sat.tws.toFixed(2)} m/s hike ${sat.hike.toFixed(0)}%` : 'none');

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('dinghy force calibration checks passed');
