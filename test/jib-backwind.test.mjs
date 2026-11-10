// Backed jib through a slow tack. The sheet stays on the old side; the
// existing per-sail force (apparent wind on the wrong side of that chord)
// yaws the bow. A fast tack never holds the sheet.
import './dom-stub.mjs';
import { JIB_BACKWIND_COLOR, JIB_DRAG_COLOR, JIB_LIFT_COLOR, SAIL_COLOR, boatGuides } from '../src/boat-draw.js';
import { Boat } from '../src/boat.js';
import {
  JIB_BACKWIND_ENTER_SPEED_MPS,
  JIB_BACKWIND_ENTER_TWA_DEG,
  JIB_BACKWIND_ENTER_YAW_DEG_S,
  JIB_BACKWIND_RELEASE_SPEED_MPS,
  JIB_BACKWIND_RELEASE_TWA_DEG,
  jibBackwindStep,
} from '../src/dinghy-forces.js';
import { SimCore } from '../src/host.js';

let failed = 0;
function check(name, ok, info = '') {
  if (!ok) failed++;
  console.info(`${ok ? 'ok  ' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
}
const log = console.log;
const mute = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = log; } };

function sheet(prev, over) {
  const twa = over.twa !== undefined ? over.twa : 50;
  return jibBackwindStep(prev, {
    twa, awa: twa, boomTrim: 16, speedMs: 2.5, yawDegS: 1, depower: 0, enabled: true, ...over,
  });
}

// Working sheet is remembered once she is sailing, and the boom still
// follows the apparent wind until a slow crossing.
{
  let s = sheet(null, {});
  check('settled close-hauled stores the sheet and does not back',
    s.memory === 16 && s.boom === 16 && !s.backwinded);
  s = sheet(s, { twa: 20, boomTrim: 8, speedMs: 1.6, yawDegS: 18 });
  check('inside the memory angle the sheet freezes and the boom still follows trim',
    s.memory === 16 && s.boom === 8 && !s.backwinded);
  s = sheet(s, { twa: -4, boomTrim: -2, speedMs: 1.6, yawDegS: -22 });
  check('fast tack through head-to-wind does not hold the jib',
    !s.backwinded && s.boom === -2 && s.memory === 16,
    `speed gate ${JIB_BACKWIND_ENTER_SPEED_MPS} m/s, yaw gate ${JIB_BACKWIND_ENTER_YAW_DEG_S}°/s`);
}

{
  let s = sheet(null, { twa: -52, boomTrim: -15, speedMs: 1.2, yawDegS: 0 });
  s = sheet(s, { twa: 0, boomTrim: 0, speedMs: 0.4, yawDegS: -3 });
  check('exactly head-to-wind does not count as the new tack yet', !s.backwinded && s.boom === 0);
  s = sheet(s, { twa: 4, awa: -3, boomTrim: -1, speedMs: 0.4, yawDegS: -3 });
  check('true wind has crossed but apparent wind has not: the sheet still follows',
    !s.backwinded && s.boom === -1);
  s = sheet(s, { twa: 4, boomTrim: 2, speedMs: 0.4, yawDegS: -3 });
  check('slow boat just past head-to-wind holds the old sheet',
    s.backwinded && s.boom === -15 && Math.sign(s.boom) !== Math.sign(4),
    `window ${JIB_BACKWIND_ENTER_TWA_DEG}°`);
  const held = s;
  s = sheet(s, { twa: 0, boomTrim: 0, speedMs: 0.3, yawDegS: -2 });
  check('a sample on head-to-wind keeps the backed sheet', s.backwinded && s.boom === -15);
  s = sheet(held, { twa: 8, boomTrim: 3, speedMs: JIB_BACKWIND_RELEASE_SPEED_MPS, yawDegS: -4 });
  check('steerage way releases the sheet', !s.backwinded && s.boom === 3);
  s = sheet(held, { twa: JIB_BACKWIND_RELEASE_TWA_DEG, boomTrim: 14, speedMs: 0.5, yawDegS: -6 });
  check('borne away to the release angle, the new sheet takes over', !s.backwinded && s.boom === 14);
  s = sheet(held, { twa: 6, boomTrim: 3, speedMs: 0.3, yawDegS: 1, depower: 0.4 });
  check('easing the sheets releases the back', !s.backwinded && s.boom === 3);
  // Same crossing must not grab the sheet again after a release.
  s = sheet(s, { twa: 6, boomTrim: 3, speedMs: 0.3, yawDegS: 1, depower: 0 });
  check('after release she does not back again until she is sailing on a tack', !s.backwinded && s.boom === 3);
  s = sheet(held, { twa: -14, boomTrim: -6, speedMs: 0.4, yawDegS: 2 });
  check('falling back onto the old tack lets the sheet follow', !s.backwinded && s.boom === -6);
}

{
  let s = sheet(null, { twa: 100, boomTrim: 40, speedMs: 2, yawDegS: 0 });
  s = sheet(s, { twa: -170, boomTrim: -40, speedMs: 0.3, yawDegS: 2 });
  check('a gybe is not a backed-jib tack', !s.backwinded && s.boom === -40);
  s = sheet(null, { twa: -50, boomTrim: -15 });
  s = sheet(s, { twa: 5, boomTrim: 2, speedMs: 0.3, yawDegS: 2, enabled: false });
  check('disabled, the boom is the ordinary trim', !s.backwinded && s.boom === 2);
}

const DT = 1 / 30;
const view = { camera_position_x: 0, camera_position_y: 0, camera_zoom: 20, show_forces: true, show_fields: false };
function way(h, v) { return { x: Math.sin(h) * v, y: -Math.cos(h) * v }; }
function spd(b) {
  const v = b.physics_model.getLinearVelocity();
  return Math.hypot(v.x, v.y);
}

// One autopilot tack from a settled starboard close-hauled beat.
// `stall` kills the way once she is just past head-to-wind, the in-irons case.
function tack({ tws, enabled, stall = false, settleS = 10, maxS = 28 }) {
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f', texture: { image: { data: new Uint8Array(0) } } });
  let out;
  mute(() => {
    core.command({ type: 'devMode', on: true });
    core.command({ type: 'wind', angle: 90, speed: tws });
    core.command({ type: 'restart', scenario: 5 });
    const b = new Boat(core.map, 0, 0, 5 * Math.PI / 4);
    b.jibBackwindEnabled = enabled;
    core.sim.players.push(b);
    b.input_autopilot_enabled_toggle();
    const step = () => { core.map.world.step(DT); core.sim.step(DT, []); };
    for (let i = 0; i < settleS * 30; i++) step();
    const before = Math.sign(b.twa);
    b.input_autopilot_tack_toggle();
    let done = null;
    let backed = null;
    let sawBack = false;
    const marks = {};
    for (let i = 0; i < maxS * 30; i++) {
      step();
      const t = (i + 1) * DT;
      // Just onto the new tack, with the bow already through: drop the way
      // so the rudder cannot finish it. Earlier than this the kill lands
      // while she is still head-to-wind and both runs simply stop.
      if (stall && !marks.stalled && Math.sign(b.twa) === -before && Math.abs(b.twa) > 1 && Math.abs(b.twa) < 8) {
        const h = b.physics_model.getAngle();
        b.physics_model.setLinearVelocity(way(h, 0.15));
        b.physics_model.setAngularVelocity(0);
        marks.stalled = t;
      }
      if (b.jibBackwinded && !backed && Math.abs(b.awa) > 2) {
        sawBack = true;
        backed = {
          t, twa: b.twa, awa: b.awa, jib: b.jib_boom_angle, main: b.mainsail_boom_angle,
          aoa: b._jibAoaDeg, side: b.jib_side_force_n,
          clewX: b._jibClewLocal.x, mainClewX: b._mainClewLocal.x,
        };
        // Let the drawn boom catch the held sheet. Rendering does not
        // feed the physics.
        let st = null;
        for (let k = 0; k < 45; k++) st = b.renderState(view);
        backed.state = st;
        backed.guides = boatGuides(st, b.renderDef());
      }
      if (!sawBack && b.jibBackwinded) sawBack = true;
      if (Math.abs(t - 2) < DT / 2) marks.t2 = b.twa;
      if (Math.abs(t - 4) < DT / 2) marks.t4 = b.twa;
      if (done === null && Math.sign(b.twa) === -before && Math.abs(b.twa) > 45) done = t;
      if (done !== null && !b.jibBackwinded) break;
    }
    out = { done, sawBack, backed, marks, endTwa: b.twa };
  });
  return out;
}

const fastOn = tack({ tws: 8, enabled: true, maxS: 8 });
const fastOff = tack({ tws: 8, enabled: false, maxS: 8 });
console.info(`8 m/s tack  on ${fastOn.done?.toFixed(2)} s  off ${fastOff.done?.toFixed(2)} s  backed ${fastOn.sawBack}`);
check('8 m/s autopilot tack never backs the jib', fastOn.sawBack === false && fastOff.sawBack === false);
check('8 m/s tack time is unchanged by the backwind path',
  fastOn.done != null && fastOff.done != null && Math.abs(fastOn.done - fastOff.done) < DT
  && Math.abs(fastOn.marks.t2 - fastOff.marks.t2) < 1e-6
  && Math.abs(fastOn.marks.t4 - fastOff.marks.t4) < 1e-6,
  `${fastOn.done?.toFixed(3)} vs ${fastOff.done?.toFixed(3)}, TWA@2s ${fastOn.marks.t2?.toFixed(3)}`);
check('8 m/s tack finishes near 4.2 s', fastOn.done > 3.8 && fastOn.done < 4.6, fastOn.done?.toFixed(2));

const stallOn = tack({ tws: 3, enabled: true, stall: true });
const stallOff = tack({ tws: 3, enabled: false, stall: true });
console.info(`stalled 3 m/s tack  on ${stallOn.done?.toFixed(2)} s  off ${stallOff.done?.toFixed(2)} s`);
check('stalled tack completes with the jib backed',
  stallOn.done != null && stallOn.done < 9 && stallOn.sawBack, stallOn.done?.toFixed(2));
check('the same stall without a backed jib takes much longer',
  stallOff.done != null && stallOff.done > 18 && !stallOff.sawBack, stallOff.done?.toFixed(2));
check('backing saves more than 10 s on the stalled tack',
  stallOff.done - stallOn.done > 10, `${(stallOff.done - stallOn.done).toFixed(2)} s`);

const back = stallOn.backed;
check('while backed, the jib boom is on the old side of the apparent wind and the main follows it',
  back && Math.sign(back.jib) !== 0 && Math.sign(back.jib) !== Math.sign(back.awa)
  && Math.sign(back.main) === Math.sign(back.awa),
  back && `jib ${back.jib.toFixed(1)} main ${back.main.toFixed(1)} awa ${back.awa.toFixed(1)}`);
check('backed jib angle of attack is the held chord against the apparent wind, and the sail is loaded',
  back && Math.abs(Math.abs(back.jib - back.awa) - back.aoa) < 1e-6 && Math.abs(back.side) > 4,
  back && `AoA ${back.aoa.toFixed(2)} side ${back.side.toFixed(1)} N`);
check('backed jib clew stays on the old side of the main clew',
  back && Math.sign(back.clewX) !== 0 && Math.sign(back.clewX) !== Math.sign(back.mainClewX),
  back && `jib clew x ${back.clewX.toFixed(3)} main ${back.mainClewX.toFixed(3)}`);
check('frame state carries jib_backwinded and the drawn boom is the old sheet',
  back && back.state.jib_backwinded === 1 && Math.sign(back.state.jba) === Math.sign(back.jib)
  && Math.sign(back.state.mba) === Math.sign(back.awa),
  back && `jba ${back.state.jba.toFixed(1)} mba ${back.state.mba.toFixed(1)}`);
const amber = back && back.guides.filter((g) => g.color === JIB_BACKWIND_COLOR && g.role === 'jib-backwind');
const mainCloth = back && back.guides.filter((g) => g.color === SAIL_COLOR && g.type === 'sail');
check('overlay draws the backed jib red and full, and the main in the ordinary cloth',
  amber && amber.length === 3 && mainCloth.length >= 3);
check('overlay still draws the jib lift and drag from the jib centre',
  back && back.guides.some((g) => g.color === JIB_LIFT_COLOR && g.x1 === back.state.jce[0] && g.y1 === back.state.jce[1])
  && back.guides.some((g) => g.color === JIB_DRAG_COLOR && g.x1 === back.state.jce[0]));

const lightOn = tack({ tws: 1.5, enabled: true, settleS: 12, maxS: 22 });
const lightOff = tack({ tws: 1.5, enabled: false, settleS: 12, maxS: 22 });
console.info(`1.5 m/s tack  on ${lightOn.done?.toFixed(2)} s  off ${lightOff.done?.toFixed(2)} s  backed ${lightOn.sawBack}`);
check('a natural light-air tack backs the jib and finishes faster',
  lightOn.sawBack && lightOn.done != null && lightOff.done != null && lightOff.done - lightOn.done >= 2,
  `${lightOn.done?.toFixed(2)} vs ${lightOff.done?.toFixed(2)}`);

if (failed) { console.error(`${failed} jib-backwind check(s) failed`); process.exit(1); }
console.log('jib-backwind checks passed');
