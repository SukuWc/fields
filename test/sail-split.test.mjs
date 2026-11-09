// Mainsail and jib as two forces: 470 area split of the calibrated total,
// own angle of attack, each force on that sail's boom then walked leeward
// with heel, heel moment on the sum at ceHeight.
import './dom-stub.mjs';
import { boomStation, CLASS_470_JIB_M2, CLASS_470_MAIN_FRACTION, CLASS_470_MAIN_M2, jibBoomForceLocal, jibCentroidLocal, mainBoomForceLocal, sailAreas, SAIL_CE_CHORD_FRACTION } from '../src/dinghy-forces.js';
import { DINGHY_DEFAULTS, heelMoment, sailCeOffsetX } from '../src/heel.js';
import { JIB_CE_COLOR, JIB_DRAG_COLOR, JIB_LIFT_COLOR, MAIN_CE_COLOR, MAIN_DRAG_COLOR, MAIN_LIFT_COLOR, boatGuides } from '../src/boat-draw.js';
import { SimCore } from '../src/host.js';

let failed = 0;
function check(name, ok, info = '') {
  if (!ok) failed++;
  console.info(`${ok ? 'ok  ' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
}
const log = console.log;
const mute = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = log; } };
const DEG = Math.PI / 180;

check('470 areas are the published main and jib', CLASS_470_MAIN_M2 === 9.12 && CLASS_470_JIB_M2 === 3.58);
check('main fraction is 9.12 / (9.12 + 3.58)', Math.abs(CLASS_470_MAIN_FRACTION - 9.12 / (9.12 + 3.58)) < 1e-15);
check('dinghy main fraction matches the 470 split', Math.abs(DINGHY_DEFAULTS.mainAreaFraction - CLASS_470_MAIN_FRACTION) < 1e-15);
{
  const a = sailAreas();
  check('main + jib = sailArea', Math.abs(a.main + a.jib - DINGHY_DEFAULTS.sailArea) < 1e-12, `${a.main.toFixed(4)} + ${a.jib.toFixed(4)}`);
  check('jib is the smaller sail', a.jib > 1 && a.jib < a.main);
}

// Main: one third of the sheeted boom (the plan centroid lies on the spar).
// Jib: the triangle centroid projected onto the foot. No aft balance shift.
{
  const mast = -0.8, boom = 2.2, tack = -2, jibBoom = 1.4;
  const main0 = mainBoomForceLocal(mast, boom, 0);
  check('main force amidships is a third of the boom aft of the mast',
    Math.abs(main0.x) < 1e-12 && Math.abs(main0.y - (mast + boom * SAIL_CE_CHORD_FRACTION)) < 1e-12, main0.y.toFixed(4));
  const eased = 40 * DEG;
  const mainE = mainBoomForceLocal(mast, boom, eased);
  check('eased main force lies on the boom, off the centreline',
    Math.abs(Math.hypot(mainE.x, mainE.y - mast) - boom * SAIL_CE_CHORD_FRACTION) < 1e-12 && mainE.x !== 0 && mainE.y > mast,
    `x ${mainE.x.toFixed(3)} y ${mainE.y.toFixed(3)}`);
  const cen0 = jibCentroidLocal(tack, mast, jibBoom, 0);
  const jib0 = jibBoomForceLocal(mast, tack, jibBoom, 0);
  const clewY = tack + jibBoom;
  check('jib centroid amidships is the average of tack, head and clew',
    Math.abs(cen0.x) < 1e-12 && Math.abs(cen0.y - (tack + mast + clewY) / 3) < 1e-12, cen0.y.toFixed(4));
  check('jib amidships: centroid already lies on the boom, forward of the mast',
    Math.abs(jib0.x - cen0.x) < 1e-12 && Math.abs(jib0.y - cen0.y) < 1e-12 && jib0.y < mast);
  const cenE = jibCentroidLocal(tack, mast, jibBoom, eased);
  const jibE = jibBoomForceLocal(mast, tack, jibBoom, eased);
  const foot = boomStation(0, tack, jibBoom, eased, 1);
  const cross = (p) => foot.x * (p.y - tack) - (foot.y - tack) * p.x;
  const boomLen = Math.hypot(foot.x, foot.y - tack);
  const onSegment = Math.abs(Math.hypot(jibE.x, jibE.y - tack) + Math.hypot(foot.x - jibE.x, foot.y - jibE.y) - boomLen) < 1e-9;
  check('eased jib force is the centroid projected onto the boom',
    Math.abs(cross(jibE)) < 1e-9 && onSegment && jibE.y < mast, `y ${jibE.y.toFixed(3)} fraction ${jibE.fraction.toFixed(3)}`);
  check('eased jib centroid sits inboard of the boom', Math.abs(cross(cenE)) > 0.05, `cross ${cross(cenE).toFixed(3)}`);
}

const view = { camera_position_x: 0, camera_position_y: 0, camera_zoom: 20, show_forces: true, show_fields: false };
{
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f', texture: undefined });
  mute(() => {
    core.command({ type: 'restart', scenario: 0 });
    for (let t = 0; t < 60; t++) core.tick({ dt: 1 / 30, held: [], present: true, view });
  });
  const b = core.sim.players[0];
  b.heel.phi = 20 * DEG;
  b.ceLeewardOffset = true;
  b.physics_model.setAngularVelocity(0);
  const expectX = sailCeOffsetX(20 * DEG, b.dinghy);
  mute(() => b.physics_model_step());
  const mainLocal = b.physics_model.getLocalPoint(b._mainSail.point);
  const jibLocal = b.physics_model.getLocalPoint(b._jibSail.point);
  const onBoomPlus = (local, sail) => Math.abs(local.x - (sail.boom.x + expectX)) < 1e-9 && Math.abs(local.y - sail.boom.y) < 1e-9;
  check('each sail applies at its boom station plus ceLateralHeight·sinφ',
    onBoomPlus(mainLocal, b._mainSail) && onBoomPlus(jibLocal, b._jibSail),
    `main (${mainLocal.x.toFixed(3)}, ${mainLocal.y.toFixed(3)}) boom x ${b._mainSail.boom.x.toFixed(3)} + ${expectX.toFixed(3)}`);
  check('sheeted booms are already off the centreline',
    Math.abs(b._mainSail.boom.x) > 0.05 && Math.abs(b._jibSail.boom.x) > 0.05,
    `main boom x ${b._mainSail.boom.x.toFixed(3)} jib ${b._jibSail.boom.x.toFixed(3)}`);
  check('main force is aft of the mast, jib force is forward',
    mainLocal.y > b.mainsail_leading_edge_position && jibLocal.y < b.mainsail_leading_edge_position,
    `main y ${mainLocal.y.toFixed(3)} mast ${b.mainsail_leading_edge_position} jib y ${jibLocal.y.toFixed(3)}`);
  check('heel moment uses ceHeight on the summed side force, not boom height',
    b.dinghy.ceHeight === 2.5
    && Math.abs(b.heel.mHeel - heelMoment(b.sail_side_force_n, b.heel.phi, b.dinghy)) < 1e-6,
    `mHeel ${b.heel.mHeel.toFixed(2)} side ${b.sail_side_force_n.toFixed(2)}`);
  check('jib tack is the stem fitting and the head is the mast',
    b._jibTackLocal.y === b.jib_leading_edge_position && b._jibHeadLocal.y === b.mainsail_leading_edge_position);
  check('jib clew is a boom-length from the tack',
    Math.abs(Math.hypot(b._jibClewLocal.x, b._jibClewLocal.y - b._jibTackLocal.y) - b.jib_boom_length) < 1e-9);
  check('heel side force is the sum of the two sails',
    Math.abs(b.sail_side_force_n - (b.main_side_force_n + b.jib_side_force_n)) < 1e-6
    && Math.abs(b.sail_drive_force_n - (b.main_drive_force_n + b.jib_drive_force_n)) < 1e-6,
    `side ${b.main_side_force_n.toFixed(1)} + ${b.jib_side_force_n.toFixed(1)}`);
  check('both sails produce a force', Math.hypot(b._mainSail.total.x, b._mainSail.total.y) > 0 && Math.hypot(b._jibSail.total.x, b._jibSail.total.y) > 0);
  check('steady boat: both sails see the same apparent wind', Math.abs(b._mainSail.awa - b._jibSail.awa) < 1e-6 && Math.abs(b._mainSail.awa - b.awa) < 1e-6);
  check('close-hauled: both sails sheeted to the same angle of attack', Math.abs(b._jibAoaDeg - b._sailAoaDeg) < 1e-6,
    `main ${b._sailAoaDeg.toFixed(2)} jib ${b._jibAoaDeg.toFixed(2)}`);
  const sheetAoa = (awa, factor, max) => {
    let boom = awa * factor;
    if (boom > max) boom = max;
    if (boom < -max) boom = -max;
    return Math.abs(boom - awa);
  };
  check('running: jib stops at 55° so its angle of attack is its own',
    sheetAoa(160, b.jib_boom_angle_factor, b.jib_boom_angle_max)
      > sheetAoa(160, b.mainsail_boom_angle_factor, b.mainsail_boom_angle_max) + 20);
  const st = b.renderState(view);
  check('render state carries per-sail lift, drag and CE',
    Array.isArray(st.ml) && Array.isArray(st.md) && Array.isArray(st.jl) && Array.isArray(st.jd)
    && Array.isArray(st.mce) && Array.isArray(st.jce) && Array.isArray(st.ce));
  const g = boatGuides(st, b.renderDef());
  const n = (color) => g.filter((x) => x.color === color).length;
  check('overlay draws four sail arrows and a CE cross per sail',
    n(MAIN_LIFT_COLOR) === 1 && n(MAIN_DRAG_COLOR) === 1 && n(JIB_LIFT_COLOR) === 1 && n(JIB_DRAG_COLOR) === 1
    && n(MAIN_CE_COLOR) === 2 && n(JIB_CE_COLOR) === 2);
  check('mainsail lift arrow starts at the main CE', g.some((x) => x.color === MAIN_LIFT_COLOR && x.x1 === st.mce[0] && x.y1 === st.mce[1]));
  check('jib drag arrow starts at the jib CE', g.some((x) => x.color === JIB_DRAG_COLOR && x.x1 === st.jce[0] && x.y1 === st.jce[1]));
  check('rig CE, CLR and hull-drag markers stay', n(0xff66cc) === 2 && n(0x33ccff) === 2 && n(0x2255ff) === 2);
  b.physics_model.setAngularVelocity(0.8);
  mute(() => b.physics_model_step());
  check('yawing: both sails still use the boat apparent wind',
    Math.abs(b._mainSail.awa - b.awa) < 1e-9 && Math.abs(b._jibSail.awa - b.awa) < 1e-9);
}

if (failed) { console.error(`${failed} sail-split check(s) failed`); process.exit(1); }
console.log('sail-split checks passed');
