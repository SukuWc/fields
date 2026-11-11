// Backed jib through a tack. The old sheet is remembered when the rudder
// goes on; the jib keeps its ordinary trim until the bow is past
// head-to-wind, then that sheet is fixed until she is close-hauled on the
// new tack or the helm eases. The drawn shape is the ordinary sail: camber follows
// which side of the chord the apparent wind is on.
import './dom-stub.mjs';
import { JIB_DRAG_COLOR, JIB_LIFT_COLOR, SAIL_COLOR, boatGuides, jibDepth } from '../src/boat-draw.js';
import { Boat } from '../src/boat.js';
import {
  JIB_BACKWIND_ARRIVED_TWA_DEG,
  JIB_BACKWIND_RUDDER_DEG,
  JIB_BACKWIND_RUDDER_NEUTRAL_DEG,
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
  const twa = over.twa !== undefined ? over.twa : -50;
  // Starboard (negative TWA): positive rudder heads her up through the wind.
  const rudderDeg = over.rudderDeg !== undefined ? over.rudderDeg : 3;
  return jibBackwindStep(prev, {
    twa, boomTrim: twa * 0.5, rudderDeg, depower: 0, enabled: true, ...over,
  });
}

{
  let s = sheet(null, { twa: -50, boomTrim: -16, rudderDeg: 3 });
  check('course-keeping helm stores the sheet and does not hold it',
    s.memory === -16 && s.boom === -16 && !s.armed && !s.backwinded,
    `entry ${JIB_BACKWIND_RUDDER_DEG}°`);
  s = sheet(s, { twa: -48, boomTrim: -15, rudderDeg: 22 });
  check('rudder on at the start of the tack remembers the old sheet but the jib keeps its trim',
    s.armed && !s.backwinded && s.held === -16 && s.boom === -15 && s.rudderSign === 1);
  const armed = s;
  s = sheet(armed, { twa: -10, boomTrim: -4, rudderDeg: 24 });
  check('heading up before head-to-wind the jib follows the apparent wind, not the old sheet',
    s.armed && !s.backwinded && s.boom === -4 && s.held === -16);
  s = sheet(armed, { twa: 0, boomTrim: 0, rudderDeg: 24 });
  check('exactly head-to-wind is not past it: still the ordinary trim', s.armed && !s.backwinded && s.boom === 0);
  s = sheet(armed, { twa: 3, boomTrim: 1, rudderDeg: 24 });
  check('just past head-to-wind the remembered sheet is fixed on the old side',
    s.armed && s.backwinded && s.boom === -16);
  const held = s;
  s = sheet(held, { twa: 20, boomTrim: 8, rudderDeg: 24 });
  check('past head-to-wind the old sheet stays while the helm still asks', s.backwinded && s.boom === -16);
  s = sheet(held, { twa: 20, boomTrim: 8, rudderDeg: 12 });
  check('helm eased to 12°, still more than course-keeping, keeps the sheet', s.backwinded && s.boom === -16);
  s = sheet(held, { twa: -2, boomTrim: -1, rudderDeg: 24 });
  check('back on the old side of the wind the jib follows trim again while armed',
    s.armed && !s.backwinded && s.boom === -1);
  s = sheet(held, { twa: 30, boomTrim: 12, rudderDeg: 2 });
  check('rudder back to neutral releases the sheet',
    !s.armed && !s.backwinded && s.boom === 12, `neutral ${JIB_BACKWIND_RUDDER_NEUTRAL_DEG}°`);
  s = sheet(held, { twa: 25, boomTrim: 10, rudderDeg: -10 });
  check('rudder the other way releases the sheet', !s.armed && !s.backwinded && s.boom === 10);
  s = sheet(held, { twa: JIB_BACKWIND_ARRIVED_TWA_DEG, boomTrim: 16, rudderDeg: 24 });
  check('close-hauled on the new tack releases even if the rudder is still on',
    !s.armed && !s.backwinded && s.boom === 16, `arrived ${JIB_BACKWIND_ARRIVED_TWA_DEG}°`);
  s = sheet(held, { twa: 15, boomTrim: 6, rudderDeg: 24, depower: 0.5 });
  check('easing the sheets releases the hold', !s.armed && !s.backwinded && s.boom === 6);
  s = sheet(armed, { twa: -30, boomTrim: -12, rudderDeg: 2 });
  check('helm eased before head-to-wind disarms without ever holding', !s.armed && !s.backwinded && s.boom === -12);
}

{
  let s = sheet(null, { twa: -160, boomTrim: -55, rudderDeg: 3 });
  s = sheet(s, { twa: -150, boomTrim: -55, rudderDeg: 24 });
  check('rudder toward the wind from a run is not a tack', !s.backwinded && s.boom === -55);
  s = sheet(null, { twa: -50, boomTrim: -16, rudderDeg: 3 });
  s = sheet(s, { twa: -48, boomTrim: -15, rudderDeg: 24, enabled: false });
  check('disabled, the boom is the ordinary trim', !s.backwinded && s.boom === -15);
}

// Camber side of the chord. sign(awa − boom) > 0 bellies one way; the
// normal sheet (boom between the centreline and the wind) matches
// sign(boom), and a backed chord bellies the other way.
function belly(awa, jba) {
  const g = boatGuides({
    x: 0, y: 0, px: 0, py: 0, pa: 0, ha: 0, awa, tw: 0, ap: 0, wd: 90, aht: 0,
    twa: -50, ra: 0, mba: awa * 0.5, jba, mf: 0, jf: 0, ph: 0, f: [],
  }, { rp: 1.8, rl: 0.5, cp: -0.15, cl: 0.6, mle: -0.8, mbl: 2.2, jle: -2, jbl: 1.4 });
  const sails = g.filter((seg) => seg.type === 'sail' && seg.color === SAIL_COLOR);
  // Main is drawn first, then the jib, three segments each when neither flaps.
  const jib = sails.slice(-3);
  const tack = jib[0];
  const clew = jib[2];
  const mid = jib[1];
  const cx = clew.x2 - tack.x1, cy = clew.y2 - tack.y1;
  const mx = mid.x1 - tack.x1, my = mid.y1 - tack.y1;
  return Math.sign(cx * my - cy * mx);
}
{
  const normal = belly(30, 15);
  const backed = belly(-12, 15);
  check('sheeted to the wind, the belly is the ordinary leeward side', normal !== 0 && normal === Math.sign(15));
  check('wind on the back of the chord, the belly is the other way', backed !== 0 && backed === -normal);
}

// Camber depth from the boom against the apparent wind. At the ordinary
// half-angle trim it is the old |awa|-based depth; a backed chord gets
// the depth of its own angle to the wind.
{
  const L = 1.4;
  const old = (awa) => Math.min(L * 0.05 * Math.abs(awa) / 15, L / 3);
  check('trimmed jib depth matches the |awa| depth it replaced',
    [5, 20, 35, -30, 90, 150].every((awa) => Math.abs(jibDepth(L, awa, awa * 0.5) - old(awa)) < 1e-12));
  check('backed jib depth follows its angle to the wind, not |awa|',
    Math.abs(jibDepth(L, 1, -15) - L * 0.05 * 16 / 7.5) < 1e-12 && jibDepth(L, 1, -15) > old(1));
  check('jib eased onto the wind is flat', jibDepth(L, 20, 20) === 0);
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
      if (b.jibBackwinded && !backed && Math.sign(b.jib_boom_angle) !== 0
          && Math.sign(b.awa) !== 0 && Math.sign(b.jib_boom_angle) !== Math.sign(b.awa)) {
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
      if (marks.htw === undefined && Math.sign(b.twa) === -before) marks.htw = t;
      if (b.jibBackwindArmed && !b.jibBackwinded) {
        marks.armedFree = (marks.armedFree || 0) + 1;
        const trim = Math.max(-b.jib_boom_angle_max, Math.min(b.jib_boom_angle_max, b.awa * b.jib_boom_angle_factor));
        if (Math.abs(b.jib_boom_angle - trim) > 1e-9) marks.armedOffTrim = (marks.armedOffTrim || 0) + 1;
      }
      if (Math.abs(t - 2) < DT / 2) marks.t2 = b.twa;
      if (Math.abs(t - 4) < DT / 2) marks.t4 = b.twa;
      if (done === null && Math.sign(b.twa) === -before && Math.abs(b.twa) > 45) done = t;
      if (done !== null && !b.jibBackwinded) break;
    }
    out = { done, sawBack, backed, marks, endTwa: b.twa };
  });
  return out;
}

const fastOn = tack({ tws: 8, enabled: true, maxS: 16 });
const fastOff = tack({ tws: 8, enabled: false, maxS: 16 });
console.info(`8 m/s tack  on ${fastOn.done?.toFixed(2)} s  off ${fastOff.done?.toFixed(2)} s  backed ${fastOn.sawBack}`);
check('8 m/s tack holds the jib and still reaches the new tack',
  fastOn.sawBack === true && fastOff.sawBack === false && fastOn.done != null && fastOff.done != null,
  `on ${fastOn.done?.toFixed(2)} off ${fastOff.done?.toFixed(2)}`);
check('before head-to-wind the armed jib is the ordinary trim',
  fastOn.marks.armedFree > 0 && !fastOn.marks.armedOffTrim,
  `${fastOn.marks.armedFree} armed steps, ${fastOn.marks.armedOffTrim || 0} off trim`);
check('so she reaches head-to-wind at the same moment either way',
  fastOn.marks.htw != null && Math.abs(fastOn.marks.htw - fastOff.marks.htw) < DT / 2,
  `${fastOn.marks.htw?.toFixed(2)} vs ${fastOff.marks.htw?.toFixed(2)}`);
// With the P-only autopilot at the 60° rudder limit (#200) the free-sheet
// 8 m/s tack is already 1.67 s and the hold saves about 0.17 s (it saved
// 0.47 s at the old 30° PD autopilot). More than 0.1 s, three ticks, is
// still a real gain and not step noise. The slow tacks keep a large gain
// (stalled and light-air checks below).
check('and the held jib gets her to 45° on the new tack sooner',
  fastOn.done < fastOff.done - 0.1,
  `${fastOn.done?.toFixed(2)} vs ${fastOff.done?.toFixed(2)}`);

const stallOn = tack({ tws: 3, enabled: true, stall: true });
const stallOff = tack({ tws: 3, enabled: false, stall: true });
console.info(`stalled 3 m/s tack  on ${stallOn.done?.toFixed(2)} s  off ${stallOff.done?.toFixed(2)} s`);
check('stalled tack completes with the jib held',
  stallOn.done != null && stallOn.sawBack, stallOn.done?.toFixed(2));
check('the same stall without the hold takes longer',
  stallOff.done != null && !stallOff.sawBack && stallOn.done != null && stallOff.done > stallOn.done + 5,
  `${stallOn.done?.toFixed(2)} vs ${stallOff.done?.toFixed(2)}`);

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
const cloth = back && back.guides.filter((g) => g.color === SAIL_COLOR && g.type === 'sail');
check('overlay draws the backed jib with the ordinary sail cloth, not a stand-in shape',
  cloth && cloth.length >= 3 && !back.guides.some((g) => g.role === 'jib-backwind'));
check('drawn jib boom is the held sheet, on the other side of the apparent wind',
  back && Math.sign(back.state.jba) !== 0 && Math.sign(back.state.jba) !== Math.sign(back.state.awa));
check('overlay still draws the jib lift and drag from the jib centre',
  back && back.guides.some((g) => g.color === JIB_LIFT_COLOR && g.x1 === back.state.jce[0] && g.y1 === back.state.jce[1])
  && back.guides.some((g) => g.color === JIB_DRAG_COLOR && g.x1 === back.state.jce[0]));

const lightOn = tack({ tws: 1.5, enabled: true, settleS: 12, maxS: 22 });
const lightOff = tack({ tws: 1.5, enabled: false, settleS: 12, maxS: 22 });
console.info(`1.5 m/s tack  on ${lightOn.done?.toFixed(2)} s  off ${lightOff.done?.toFixed(2)} s  backed ${lightOn.sawBack}`);
check('a natural light-air tack holds the jib and finishes sooner',
  lightOn.sawBack && lightOn.done != null && lightOff.done != null && lightOn.done < lightOff.done,
  `${lightOn.done?.toFixed(2)} vs ${lightOff.done?.toFixed(2)}`);

if (failed) { console.error(`${failed} jib-backwind check(s) failed`); process.exit(1); }
console.log('jib-backwind checks passed');
