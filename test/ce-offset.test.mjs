// Leeward sail CE offset (heel.js sailCeOffsetX + boat.js applyForce point):
// geometry, weather helm under autopilot, rudder_deg on the frame.
import * as H from '../src/heel.js';
import { SimCore } from '../src/host.js';
import { roundJson } from '../apps/server/room.js';
import { encodeWire, decodeWire } from '../src/wire-codec.js';
import { READOUT_TILES, readoutValues, formatReadout } from '../src/instrument-readout.js';

let failed = 0;
function check(name, ok, info = '') {
  if (!ok) failed++;
  console.info(`${ok ? 'ok  ' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
}
const log = console.log;
const mute = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = log; } };
const view = { camera_position_x: 0, camera_position_y: 0, camera_zoom: 20, show_forces: true, show_fields: false };
const D = H.DINGHY_DEFAULTS, DEG = H.DEG;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

// Geometry: 0 at upright; h·sinφ to leeward (= heel sign) on both tacks.
check('offset 0 at φ = 0', H.sailCeOffsetX(0) === 0);
for (const deg of [10, 30, 45, 60]) {
  const phi = deg * DEG;
  const x = H.sailCeOffsetX(phi);
  check(`φ=${deg}°: offset = h·sinφ`, Math.abs(x - D.ceHeight * Math.sin(phi)) < 1e-12, x.toFixed(6));
  check(`φ=-${deg}°: mirrored to the other side`, Math.abs(H.sailCeOffsetX(-phi) + x) < 1e-12);
}
check('leeward = heel sign (φ>0 → +X)', Math.sign(H.sailCeOffsetX(20 * DEG)) === 1
  && Math.sign(H.sailCeOffsetX(-20 * DEG)) === -1);

// Boat applies the offset through planck: local X of the mainsail force point.
{
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f', texture: undefined });
  mute(() => {
    core.command({ type: 'restart', scenario: 0 });
    for (let t = 0; t < 30; t++) core.tick({ dt: 1 / 30, held: [], present: true, view });
  });
  const b = core.sim.players[0];
  b.heel.phi = 30 * DEG;
  b.ceLeewardOffset = true;
  mute(() => b.physics_model_step());
  const expect = H.sailCeOffsetX(30 * DEG, b.dinghy);
  check('boat: CE local X = h·sinφ when offset on', Math.abs(b._sailCeLocalX - expect) < 1e-9,
    `${b._sailCeLocalX} vs ${expect}`);
  b.ceLeewardOffset = false;
  mute(() => b.physics_model_step());
  check('boat: CE local X = 0 when offset off', Math.abs(b._sailCeLocalX) < 1e-12, `${b._sailCeLocalX}`);
}

// Weather helm: slow wind ramp to 9 m/s on a large map; autopilot holds
// close-hauled. With the offset on, steady rudder is non-zero and larger in
// magnitude than with the offset off, and of the weather-helm-countering
// sign (on starboard, more negative = bear away against the rounding-up).
function settle(offset, finalWind = 9) {
  const core = new SimCore({ mapW: 400, mapH: 800, simRes: '4f', texture: undefined });
  mute(() => {
    core.command({ type: 'restart', scenario: 0 });
    for (let t = 0; t < 5; t++) core.tick({ dt: 1 / 30, held: [], present: true, view });
    const b = core.sim.players[0];
    b.ceLeewardOffset = offset;
    if (!b.autopilot_enabled) b.input_autopilot_enabled_toggle();
    core.command({ type: 'wind', angle: 90, speed: 4.5 });
    for (let t = 0; t < 450; t++) core.tick({ dt: 1 / 30, held: [], present: true, view });
    for (let w = 5; w <= finalWind; w += 0.5) {
      core.command({ type: 'wind', speed: w });
      for (let t = 0; t < 90; t++) core.tick({ dt: 1 / 30, held: [], present: true, view });
    }
  });
  const b = core.sim.players[0];
  const rudders = [], heels = [], speeds = [];
  mute(() => {
    for (let t = 0; t < 450; t++) {
      core.tick({ dt: 1 / 30, held: [], present: true, view });
      if (t >= 150) {
        rudders.push(b.rudder_angle);
        heels.push(b.heel.phi * 180 / Math.PI);
        speeds.push(Math.hypot(b.physics_model.getLinearVelocity().x, b.physics_model.getLinearVelocity().y));
      }
    }
  });
  return {
    rudder: mean(rudders), heel: mean(heels), bs: mean(speeds),
    twa: b.twa, cex: b._sailCeLocalX || 0, rudder_deg: b.rudder_angle,
  };
}
const off = settle(false);
const on = settle(true);
check('strong wind, offset off: sailing near 45° with small rudder',
  Math.abs(off.twa) > 40 && Math.abs(off.twa) < 55 && Math.abs(off.rudder) < 8 && off.bs > 3,
  `twa=${off.twa.toFixed(1)} ra=${off.rudder.toFixed(2)} bs=${off.bs.toFixed(2)}`);
check('strong wind, offset on: heel past the 5° target (overpowered)',
  Math.abs(on.heel) > 8, `heel=${on.heel.toFixed(1)}°`);
check('strong wind, offset on: steady rudder non-zero and |ra| ≫ offset-off',
  Math.abs(on.rudder) > 8 && Math.abs(on.rudder) > Math.abs(off.rudder) + 5,
  `on=${on.rudder.toFixed(2)} off=${off.rudder.toFixed(2)}`);
// Weather helm on starboard (twa < 0): AP bears away with negative rudder.
check('weather helm sign: starboard → more negative rudder with offset',
  on.twa < 0 && on.rudder < off.rudder - 5,
  `on twa=${on.twa.toFixed(1)} ra=${on.rudder.toFixed(2)} vs off ${off.rudder.toFixed(2)}`);
check('offset on: boat still holds a course (speed > 2)', on.bs > 2, `bs=${on.bs.toFixed(2)}`);
check('offset on: CE displaced to leeward of centreline', Math.abs(on.cex) > 0.3, `cex=${on.cex.toFixed(3)}`);

// rudder_deg on the frame + readout tile.
{
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f', texture: undefined });
  let present = true, rt = true;
  mute(() => {
    core.command({ type: 'restart', scenario: 0 });
    for (let t = 0; t < 120; t++) {
      const f = core.tick({ dt: 1 / 30, held: [], present: true, view });
      if (!f.state) continue;
      for (const boat of f.state.boats) {
        if (!Number.isFinite(boat.rudder_deg)) present = false;
      }
      if (t % 30 === 0) {
        const m = { type: 'frame', frame: { state: { boats: f.state.boats } } };
        const d = decodeWire(encodeWire(m));
        const j = JSON.parse(roundJson(m));
        f.state.boats.forEach((boat, i) => {
          const a = d.frame.state.boats[i].rudder_deg;
          if (a !== j.frame.state.boats[i].rudder_deg || Math.abs(a - boat.rudder_deg) > 1e-3) rt = false;
        });
      }
    }
  });
  check('rudder_deg on every boat every frame', present);
  check('rudder_deg survives the remote wire round trip', rt);
}
check('fourteen tiles incl. RUD', READOUT_TILES.length === 14 && READOUT_TILES.some((t) => t.key === 'rudder'));
{
  const v = readoutValues({ boats: [{ id: 'a', ha: 0, vx: 1, vy: 0, wd: 90, rudder_deg: -12.4 }] });
  check('readout carries signed rudder', v && v.rudder === -12.4);
  check('format rudder rounds to int', formatReadout('rudder', -12.4) === '-12');
}

// Scenario 0 still sane with the offset on (default).
{
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f', texture: undefined });
  let bsAt500 = null;
  mute(() => {
    core.command({ type: 'restart', scenario: 0 });
    for (let t = 0; t < 600; t++) {
      core.tick({ dt: 1 / 30, held: [], present: true, view });
      if (t === 500) {
        const b = core.sim.players[0];
        bsAt500 = Math.hypot(b.physics_model.getLinearVelocity().x, b.physics_model.getLinearVelocity().y);
      }
    }
  });
  const b = core.sim.players[0];
  const bs = Math.hypot(b.physics_model.getLinearVelocity().x, b.physics_model.getLinearVelocity().y);
  check('scenario 0: heading near 45° with CE offset on', Math.abs(b.twa) >= 40 && Math.abs(b.twa) <= 55,
    `twa=${b.twa.toFixed(1)}`);
  check('scenario 0: speed settled with CE offset on',
    bs > 2.4 && bs < 3.1 && Math.abs(bs - bsAt500) < 0.15,
    `bs=${bs.toFixed(3)} at500=${bsAt500.toFixed(3)}`);
}

if (failed) { console.error(failed + ' ce-offset checks failed'); process.exit(1); }
console.log('all ce-offset checks passed');
