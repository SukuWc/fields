// Dinghy heel (src/heel.js + boat.js): moment balance, crew hike, bounds,
// sail force scaling with heel, frame fields and the remote round trip.
import * as H from '../src/heel.js';
import { SimCore } from '../src/host.js';
import { roundJson } from '../apps/server/room.js';
import { encodeWire, decodeWire } from '../src/wire-codec.js';

let failed = 0;
function check(name, ok, info = '') {
  if (!ok) failed++;
  console.info(`${ok ? 'ok  ' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
}
const log = console.log;
const mute = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = log; } };
const view = { camera_position_x: 0, camera_position_y: 0, camera_zoom: 20, show_forces: false, show_fields: false };
const D = H.DINGHY_DEFAULTS, DEG = H.DEG;
const settle = (F, n = 900) => { const s = H.createHeelState(); for (let i = 0; i < n; i++) H.stepHeel(s, F, 1 / 30); return s; };

// GZ curve shape.
check('GZ odd, zero at 0 and 90°', H.gz(0) === 0 && H.gz(90 * DEG) === 0 && H.gz(-30 * DEG) === -H.gz(30 * DEG));
const peak = [10, 20, 30, 40, 50, 60, 70, 80].reduce((a, d) => (H.gz(d * DEG) > H.gz(a * DEG) ? d : a), 10);
check('GZ peaks at 50–60°', peak >= 50 && peak <= 60, `peak ${peak}°`);

// Equilibrium: moments balance, heel at the 5° target, crew partly out.
for (const F of [100, 250]) {
  const s = settle(F);
  const resid = s.mHeel - s.mHull - s.mCrew;
  check(`F=${F} N: moment balance at equilibrium`, Math.abs(resid) < 1e-3 * s.mHeel && Math.abs(s.omega) < 1e-6, `resid ${resid.toExponential(2)}`);
  check(`F=${F} N: heel held at target`, Math.abs(s.phi / DEG - D.targetHeelDeg) < 0.05, `${(s.phi / DEG).toFixed(3)}°`);
  check(`F=${F} N: hike partial`, s.hike > 0 && s.hike < 1, `${(s.hike * 100).toFixed(0)}%`);
}
// Opposite side force: mirrored, crew on the other side.
{ const a = settle(150), b = settle(-150);
  check('mirror: heel and hike flip sign', Math.abs(a.phi + b.phi) < 1e-9 && Math.abs(a.hike + b.hike) < 1e-9 && b.hike < 0); }
// Saturation: full hike, heel past target, still bounded.
{ const s = settle(380);
  check('high wind: hike saturates at 100%', s.hike === 1, `${s.hike}`);
  check('high wind: heel grows past target', s.phi / DEG > 2 * D.targetHeelDeg, `${(s.phi / DEG).toFixed(1)}°`); }
{ let ok = true; for (const F of [0, 50, 400, 1000, 5000, -5000]) { const s = H.createHeelState();
    for (let i = 0; i < 600; i++) { H.stepHeel(s, F * (i % 90 < 45 ? 1 : 0.3), 1 / 30); if (!(Math.abs(s.phi) <= D.capsizeDeg * DEG + 1e-12) || !Number.isFinite(s.omega)) ok = false; } }
  check('heel bounded by the capsize limit, finite, for any force', ok);
  const s = settle(5000); check('overpowered: capsized flag set at the limit', s.capsized && Math.abs(s.phi / DEG - D.capsizeDeg) < 1e-9); }
// Crew moves at a finite rate.
{ const s = H.createHeelState(); H.stepHeel(s, 300, 1 / 30); check('crew rate limited', Math.abs(s.hike) <= D.crewRate / 30 + 1e-12); }
// Force factor.
check('heel force factor cos²', H.heelForceFactor(0) === 1 && Math.abs(H.heelForceFactor(30 * DEG) - 0.75) < 1e-12);

// Boat: sail force (propulsion and lattice mainsail_force) scales with cos²(heel).
{
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f', texture: undefined });
  mute(() => { core.command({ type: 'restart', scenario: 0 }); for (let t = 0; t < 60; t++) core.tick({ dt: 1 / 30, held: [], present: true, view }); });
  const b = core.sim.players[0];
  // Same inputs twice: snapshot the body, step with heel 0 and heel 30°.
  const body = b.physics_model, p = body.getPosition().clone(), a = body.getAngle(), v = body.getLinearVelocity().clone(), w = body.getAngularVelocity();
  const snap = { wx: b.wind_vx_smooth, wy: b.wind_vy_smooth, ra: b.rudder_angle, s: b.autopilot_compensator_sum_error, l: b.autopilot_compensator_last_error };
  const run = (phi) => {
    body.setTransform(p, a); body.setLinearVelocity(v); body.setAngularVelocity(w);
    Object.assign(b, { wind_vx_smooth: snap.wx, wind_vy_smooth: snap.wy, rudder_angle: snap.ra, autopilot_compensator_sum_error: snap.s, autopilot_compensator_last_error: snap.l });
    b.heel = { ...H.createHeelState(), phi };
    b.physics_model_step();
    return { ...b.mainsail_force };
  };
  const f0 = run(0), f30 = run(30 * DEG);
  const r = Math.hypot(f30.x, f30.y) / Math.hypot(f0.x, f0.y);
  check('boat sail force at 30° heel = 0.75 × upright', Math.abs(r - 0.75) < 1e-9, r.toFixed(6));
}

// Frame fields in local / worker (SimCore) and the remote round trip.
for (const n of [0, 24]) {
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f', texture: undefined });
  mute(() => core.command({ type: 'restart', scenario: n }));
  let present = true, ranged = true, rt = true, maxHike = 0;
  mute(() => {
    for (let t = 0; t < (n === 24 ? 1000 : 200); t++) {
      const f = core.tick({ dt: 1 / 30, held: [], present: true, view });
      if (!f.state) continue;
      for (const b of f.state.boats) {
        if (!Number.isFinite(b.heel_deg) || !Number.isFinite(b.hike_pct)) present = false;
        else { if (Math.abs(b.heel_deg) > D.capsizeDeg + 1e-9 || b.hike_pct < 0 || b.hike_pct > 100) ranged = false; maxHike = Math.max(maxHike, b.hike_pct); }
      }
      if (t % 25 === 0) {
        const m = { type: 'frame', frame: { state: { boats: f.state.boats } } };
        const d = decodeWire(encodeWire(m)); const j = JSON.parse(roundJson(m));
        f.state.boats.forEach((b, i) => { for (const k of ['heel_deg', 'hike_pct']) {
          const a = d.frame.state.boats[i][k];
          if (a !== j.frame.state.boats[i][k] || Math.abs(a - b[k]) > 1e-3) rt = false; } });
      }
    }
  });
  check(`scenario ${n}: heel_deg / hike_pct on every boat every frame`, present);
  check(`scenario ${n}: heel / hike in range`, ranged);
  check(`scenario ${n}: heel_deg / hike_pct survive the remote wire round trip`, rt);
  if (n === 24) check('scenario 24: crew reaches full hike in the ramp', maxHike === 100, `${maxHike}`);
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
