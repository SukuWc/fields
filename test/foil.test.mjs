// Foil hydrodynamics (src/foil.js). Pure: no DOM, no world step except one
// boat check that the overlay carries separate rudder lift and drag.
import './dom-stub.mjs';
import { DAGGERBOARD, DEEP_STALL_DEG, finiteWingCoefficients, foilForceNewtons, naca0012Section, OSWALD_E, RUDDER_BLADE, STALL_DEG } from '../src/foil.js';
import { DINGHY_DEFAULTS, DEG, hullDragOffsetX, sailCeOffsetX } from '../src/heel.js';
import { boatGuides } from '../src/boat-draw.js';
import { SimCore } from '../src/host.js';

let failed = 0;
function check(name, ok, info = '') {
  if (!ok) failed++;
  console.info(`${ok ? 'ok  ' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
}
const log = console.log;
const mute = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = log; } };

check('daggerboard area is span × chord', Math.abs(DAGGERBOARD.area - 0.90 * 0.36) < 1e-12);
check('rudder area is span × chord', Math.abs(RUDDER_BLADE.area - 0.50 * 0.22) < 1e-12);
check('effective aspect uses the hull reflection 2·b/c',
  Math.abs(DAGGERBOARD.effectiveAspect - 2 * 0.90 / 0.36) < 1e-12
  && Math.abs(RUDDER_BLADE.effectiveAspect - 2 * 0.50 / 0.22) < 1e-12);

{
  const a = 6 * DEG;
  const p = naca0012Section(a);
  const n = naca0012Section(-a);
  check('section Cl is odd in alpha', Math.abs(p.cl + n.cl) < 1e-12, `${p.cl}`);
  check('section Cd is even in alpha', Math.abs(p.cd - n.cd) < 1e-12);
  check('section Cl at 6° is the table value 0.63', Math.abs(p.cl - 0.63) < 1e-12);
  const deep = naca0012Section(20 * DEG);
  check('post-stall Cd is larger than the zero-lift Cd', deep.cd > p.cd && deep.cd > 0.1);
  const folded = naca0012Section(100 * DEG);
  check('|alpha| past 90° folds back toward the table', Math.abs(folded.cl) < 0.2 && folded.cd > 1);
}

{
  const low = finiteWingCoefficients(4 * DEG, 2);
  const high = finiteWingCoefficients(4 * DEG, 8);
  check('higher aspect ratio lifts more below stall', Math.abs(high.cl) > Math.abs(low.cl));
  const stalled = finiteWingCoefficients(STALL_DEG * DEG, DAGGERBOARD.effectiveAspect);
  const deep = finiteWingCoefficients(DEEP_STALL_DEG * DEG, DAGGERBOARD.effectiveAspect);
  check('induced drag is added below stall', stalled.cd > stalled.cdSection);
  check('deep stall uses the section Cl (blend factor 1)', Math.abs(deep.cl - deep.clSection) < 1e-9);
  check('Oswald efficiency is the documented 0.85', OSWALD_E === 0.85);
}

{
  const still = foilForceNewtons({ vBodyX: 0, vBodyY: 0, area: RUDDER_BLADE.area, aspectRatio: RUDDER_BLADE.effectiveAspect });
  check('zero speed gives zero force', still.lift.x === 0 && still.drag.y === 0 && still.speed === 0);
  const centred = foilForceNewtons({
    vBodyX: 0, vBodyY: -3, bladeRad: 0,
    area: RUDDER_BLADE.area, aspectRatio: RUDDER_BLADE.effectiveAspect,
  });
  check('centred foil at speed has profile drag and no lift',
    Math.abs(centred.lift.x) < 1e-6 && Math.abs(centred.lift.y) < 1e-6 && centred.drag.y > 0,
    `D=${centred.drag.y.toFixed(2)} N`);
  const leeway = foilForceNewtons({
    vBodyX: 0.4, vBodyY: -3, bladeRad: 0,
    area: DAGGERBOARD.area, aspectRatio: DAGGERBOARD.effectiveAspect,
  });
  check('leeway to +X produces a restoring (−X) lift', leeway.lift.x < 0 && leeway.cl > 0, `Lx=${leeway.lift.x.toFixed(1)}`);
  const helm = foilForceNewtons({
    vBodyX: 0, vBodyY: -3, bladeRad: 10 * DEG,
    area: RUDDER_BLADE.area, aspectRatio: RUDDER_BLADE.effectiveAspect,
  });
  check('positive rudder (clockwise) lifts toward +X', helm.lift.x > 0 && helm.cl < 0, `Lx=${helm.lift.x.toFixed(1)}`);
  check('deflected rudder drag exceeds the centred profile drag', helm.drag.y > centred.drag.y);
  const yawed = foilForceNewtons({
    vBodyX: -0.3, vBodyY: -3, bladeRad: 0,
    area: RUDDER_BLADE.area, aspectRatio: RUDDER_BLADE.effectiveAspect,
  });
  check('yaw-rate inflow from −X lifts toward +X', yawed.lift.x > 0);
}

check('hull drag offset shares the sail CE sign',
  Math.sign(hullDragOffsetX(20 * DEG)) === Math.sign(sailCeOffsetX(20 * DEG))
  && Math.abs(hullDragOffsetX(30 * DEG) - DINGHY_DEFAULTS.hullDragLateral * Math.sin(30 * DEG)) < 1e-12);

{
  const s = {
    x: 0, y: 0, px: 0, py: 0, pa: 0, ha: 0, awa: 30, tw: 0, ap: 0, wd: 90, aht: -50,
    twa: -50, ra: 8, mba: 20, jba: 20, mf: 0, jf: 0, ph: 0, f: [0, 0, 1, 0],
    hd: [0.2, 0], hdx: 0.2, rd: [0, 1.8], rdl: [2, 0.2], rdd: [0, 1.5],
    clr: [0, -0.15], cbl: [-3, 0], cbd: [0, 1],
  };
  const d = { rp: 1.8, rl: 0.5, cp: -0.15, cl: 1, mle: 0, mbl: 1, jle: 0, jbl: 1 };
  const g = boatGuides(s, d);
  const blue = g.filter((x) => x.color === 0x2255ff);
  const lift = g.filter((x) => x.color === 0xff8844);
  const drag = g.filter((x) => x.color === 0xff4422);
  check('overlay draws a hull-drag cross', blue.length === 2);
  check('overlay draws a rudder lift arrow and a rudder drag arrow', lift.length === 1 && drag.length === 1);
  check('rudder lift arrow starts at the rudder point', lift[0] && lift[0].x1 === 0 && lift[0].y1 === 1.8);
  check('rudder drag arrow is a different vector from lift', drag[0] && drag[0].y2 !== lift[0].y2);
}

{
  const view = { camera_position_x: 0, camera_position_y: 0, camera_zoom: 20, show_forces: true, show_fields: false };
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f', texture: undefined });
  mute(() => {
    core.command({ type: 'restart', scenario: 0 });
    for (let t = 0; t < 60; t++) core.tick({ dt: 1 / 30, held: [], present: true, view });
    const b = core.sim.players[0];
    b.physics_model.setLinearVelocity({ x: 0, y: -2 });
    b.rudder_angle = 12;
    b.physics_model_step();
  });
  const b = core.sim.players[0];
  const st = b.renderState(view);
  const liftN = Math.hypot(b._rudderLift.x, b._rudderLift.y) * 3;
  const dragN = Math.hypot(b._rudderDrag.x, b._rudderDrag.y) * 3;
  check('heeled or not, a deflected rudder at speed has both lift and drag', liftN > 5 && dragN > 0.2,
    `L=${liftN.toFixed(1)} D=${dragN.toFixed(1)}`);
  check('render state carries separate rudder lift and drag', Array.isArray(st.rdl) && Array.isArray(st.rdd));
  check('render state carries the hull drag point', Array.isArray(st.hd) && st.hd.length === 2);
}

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.info('foil tests passed');
