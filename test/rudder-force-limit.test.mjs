// Rudder force limit (rudder_max_force_n): the bidirectional limiter in
// src/rudder-limit.js (less rudder, more rudder, across zero, stalled
// non-monotonic load curves, nothing within the limit), the boat applying it
// after the helm / autopilot, the frame state, and the Dev TOML command.
import './dom-stub.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Boat, RUDDER_MAX_FORCE_N, RUDDER_MAX_FORCE_N_MAX, RUDDER_MAX_FORCE_N_MIN } from '../src/boat.js';
import { limitRudderAngle, rudderForceN, SCAN_STEP_DEG } from '../src/rudder-limit.js';
import { RUDDER_MAX_FORCE_N_DEFAULT, RUDDER_MAX_FORCE_N_LIMITS, setting } from '../src/settings-registry.js';
import {
  DEV_CONFIG_DEFAULTS, devBoatCommand, parseAndValidateDevConfig, stringifyDevConfig, validateAutopilotGains,
} from '../src/dev-config.js';
import { LocalHost } from '../src/host.js';
import { Room } from '../apps/server/room.js';
import { parseServerMessage } from '../src/wire-codec.js';

const quiet = console.log;
const mute = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = quiet; } };
const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
const tex = () => ({ image: { data: new Uint8Array(0) } });
// Straight-ahead inflow at the stock, 3 m/s: the bow is −Y, so the point moves at vBodyY = −3.
const AHEAD = { vBodyX: 0, vBodyY: -3 };

test('default and registry match the boat constants', () => {
  assert.equal(RUDDER_MAX_FORCE_N_DEFAULT, RUDDER_MAX_FORCE_N);
  assert.equal(RUDDER_MAX_FORCE_N_LIMITS.min, RUDDER_MAX_FORCE_N_MIN);
  assert.equal(RUDDER_MAX_FORCE_N_LIMITS.max, RUDDER_MAX_FORCE_N_MAX);
  assert.equal(setting('rudderMaxForce').default, RUDDER_MAX_FORCE_N);
  assert.equal(DEV_CONFIG_DEFAULTS.rudder_max_force_n, RUDDER_MAX_FORCE_N);
});

test('limiter: under the limit or no limit leaves the angle alone', () => {
  const f30 = rudderForceN(30, AHEAD.vBodyX, AHEAD.vBodyY);
  for (const max of [f30 + 1, 0, -5, NaN, Infinity]) {
    const r = limitRudderAngle({ commandedDeg: 30, ...AHEAD, maxForceN: max, maxDeg: 60 });
    assert.equal(r.deg, 30, String(max));
    assert.equal(r.limited, false);
  }
  const still = limitRudderAngle({ commandedDeg: 40, vBodyX: 0, vBodyY: 0, maxForceN: 1, maxDeg: 60 });
  assert.equal(still.deg, 40, 'no flow, no load');
});

// Brute force: the within-limit angle in [−maxDeg, maxDeg] nearest cmd.
function nearestValid(cmd, f, max, maxDeg, step = 0.01) {
  for (let d = 0; d <= 2 * maxDeg; d += step) {
    for (const a of [cmd - d, cmd + d]) if (a >= -maxDeg && a <= maxDeg && f(a) <= max) return a;
  }
  return null;
}

test('limiter: straight inflow, over the limit: less rudder, same side, on the limit', () => {
  const max = 0.5 * rudderForceN(8, AHEAD.vBodyX, AHEAD.vBodyY);
  for (const cmd of [8, -8, 45, -45]) {
    const r = limitRudderAngle({ commandedDeg: cmd, ...AHEAD, maxForceN: max, maxDeg: 60 });
    assert.equal(r.limited, true);
    assert.equal(Math.sign(r.deg), Math.sign(cmd));
    assert.ok(Math.abs(r.deg) < Math.abs(cmd));
    assert.ok(r.forceN <= max + 1e-9 && r.forceN > max * 0.999, `${r.forceN} vs ${max}`);
    assert.ok(r.commandedForceN > max);
  }
});

test('limiter: swung inflow (exiting a turn) increases the angle toward the flow', () => {
  // The stock slides to +X at 1.5 m/s while making 3 m/s: inflow about
  // 26.6° off the centreline. A centred blade is loaded; the limiter puts
  // rudder on, toward the flow, until the load is at the limit.
  const vBodyX = 1.5, vBodyY = -3;
  const f = (d) => rudderForceN(d, vBodyX, vBodyY);
  const max = 0.5 * f(0);
  const r = limitRudderAngle({ commandedDeg: 0, vBodyX, vBodyY, maxForceN: max, maxDeg: 60 });
  assert.equal(r.limited, true);
  assert.ok(r.deg > 0, `more rudder toward the flow: ${r.deg}`);
  assert.ok(r.forceN <= max + 1e-9 && r.forceN > max * 0.999);
  const ref = nearestValid(0, f, max, 60);
  assert.ok(Math.abs(r.deg - ref) < 0.02, `${r.deg} vs brute ${ref}`);
  // And from a small command on the same side: still increased.
  const r5 = limitRudderAngle({ commandedDeg: 5, vBodyX, vBodyY, maxForceN: max, maxDeg: 60 });
  assert.ok(r5.deg > 5);
});

test('limiter: crosses zero when the nearest valid angle is on the other side', () => {
  const vBodyX = 1.5, vBodyY = -3;
  const f = (d) => rudderForceN(d, vBodyX, vBodyY);
  const max = 0.5 * f(0);
  const r = limitRudderAngle({ commandedDeg: -4, vBodyX, vBodyY, maxForceN: max, maxDeg: 60 });
  assert.ok(r.deg > 0, `commanded −4°, got ${r.deg}`);
  assert.ok(r.forceN <= max + 1e-9);
  const ref = nearestValid(-4, f, max, 60);
  assert.ok(Math.abs(r.deg - ref) < 0.02, `${r.deg} vs brute ${ref}`);
});

test('limiter: matches brute force over flows, commands and limits; stays within the stop', () => {
  for (const vBodyX of [-1.5, -0.4, 0, 0.4, 1.5]) {
    const f = (d) => rudderForceN(d, vBodyX, -3);
    for (const cmd of [-60, -20, -3, 0, 3, 20, 60]) {
      for (const max of [20, 100, 300]) {
        const r = limitRudderAngle({ commandedDeg: cmd, vBodyX, vBodyY: -3, maxForceN: max, maxDeg: 60 });
        assert.ok(Math.abs(r.deg) <= 60 + 1e-12, `${cmd} → ${r.deg}`);
        const ref = f(cmd) <= max ? cmd : nearestValid(cmd, f, max, 60, 0.05);
        if (ref === null) {
          // Nothing within: the least loaded angle in range.
          for (let a = -60; a <= 60; a += 0.25) assert.ok(f(a) >= r.forceN - 1e-6, `${vBodyX} ${cmd} ${max}: ${a}`);
        } else {
          assert.ok(r.forceN <= max + 1e-9, `${vBodyX} ${cmd} ${max}: ${r.forceN}`);
          assert.ok(Math.abs(Math.abs(r.deg - cmd) - Math.abs(ref - cmd)) < 0.06, `${vBodyX} ${cmd} ${max}: ${r.deg} vs ${ref}`);
        }
      }
    }
  }
});

test('limiter, non-monotonic stall curve: nearest valid angle on either side', () => {
  // Stylised stalled blade, symmetric: load rises to a peak at 12°, falls
  // to a trough at 30°, rises again.
  const load = (deg) => {
    const a = Math.abs(deg);
    if (a <= 12) return 10 * a;             // 0..120
    if (a <= 30) return 120 - 3 * (a - 12); // 120..66
    return 66 + 2 * (a - 30);               // 66 at 30°, 126 at 60°
  };
  // 100 N from 60°: valid from 47° down to about 18.67°, nearest is 47°.
  const r = limitRudderAngle({ commandedDeg: 60, maxForceN: 100, maxDeg: 60, forceAt: load });
  assert.ok(Math.abs(r.deg - 47) < 1e-4, String(r.deg));
  // From 15° (load 111): valid below 10° and above 18.67°; 18.67° is 3.67
  // away, 10° is 5: more rudder, past the stall.
  const mid = limitRudderAngle({ commandedDeg: 15, maxForceN: 100, maxDeg: 60, forceAt: load });
  assert.ok(Math.abs(mid.deg - (12 + 20 / 3)) < 1e-4, String(mid.deg));
  // From 13° (load 117): 10° is 3 away, 18.67° is 5.67 away: less rudder.
  const less = limitRudderAngle({ commandedDeg: 13, maxForceN: 100, maxDeg: 60, forceAt: load });
  assert.ok(Math.abs(less.deg - 10) < 1e-4, String(less.deg));
  // 60 N from −60°: nothing from 12° to 60° qualifies (minimum 66), so
  // through the stall to −6°.
  const low = limitRudderAngle({ commandedDeg: -60, maxForceN: 60, maxDeg: 60, forceAt: load });
  assert.ok(Math.abs(low.deg + 6) < 1e-4, String(low.deg));
  // Within the limit: unchanged.
  assert.equal(limitRudderAngle({ commandedDeg: -25, maxForceN: 100, maxDeg: 60, forceAt: load }).deg, -25);
  assert.ok(SCAN_STEP_DEG <= 0.5);
});

test('limiter: no angle within the limit takes the least loaded one (blade along the flow)', () => {
  const vBodyX = 0.5, vBodyY = -3;
  const flowDeg = Math.atan2(vBodyX, 3) * 180 / Math.PI;
  const r = limitRudderAngle({ commandedDeg: -40, vBodyX, vBodyY, maxForceN: 0.01, maxDeg: 60 });
  assert.ok(Math.abs(r.deg - flowDeg) < 0.05, `${r.deg} vs flow ${flowDeg}`);
  assert.equal(r.limited, true);
  // Flow beyond the stop: the stop.
  const far = limitRudderAngle({ commandedDeg: 0, vBodyX: 3, vBodyY: -1, maxForceN: 0.01, maxDeg: 30 });
  assert.ok(Math.abs(far.deg - 30) < 1e-6, String(far.deg));
});

function boatAt() {
  const host = new LocalHost({ mapW: 100, mapH: 200, simRes: '4f', texture: tex() });
  mute(() => {
    host.commandSync({ type: 'devMode', on: true });
    host.commandSync({ type: 'restart', scenario: 0 });
    for (let i = 0; i < 90; i++) host.tick({ dt: 1 / 30, held: [], present: false, view });
  });
  return host;
}

test('boat: hard-over helm at speed is held to the force; frame state shows the effective angle', () => {
  const host = boatAt();
  const boat = host.core.sim.players[0];
  boat.autopilot_enabled = false;
  assert.equal(boat.setRudderMaxForce(5), true);
  let limitedSeen = false;
  for (let i = 0; i < 90; i++) {
    boat.input_rudder_left(); boat.physics_model_step();
    assert.ok(Math.abs(boat.rudder_angle_effective) <= boat.rudder_angle_max + 1e-12);
    if (boat.rudderForceLimited) {
      limitedSeen = true;
      const s = boat.renderState ? boat.renderState() : null;
      if (s) {
        assert.equal(s.ra, boat.rudder_angle_effective);
        assert.equal(s.rudder_deg, boat.rudder_angle_effective);
        assert.equal(s.rudder_limited, 1);
        assert.equal(s.rudder_cmd_deg, boat.rudder_angle);
      }
    }
  }
  assert.ok(limitedSeen);
  assert.equal(Math.abs(boat.rudder_angle), 60, 'the commanded angle still reaches the stop');
  assert.ok(boat.rudderForceN <= 5 + 1e-6, String(boat.rudderForceN));
  assert.ok(Math.abs(boat.rudder_angle_effective) < 60);
  for (const bad of [-1, 5001, NaN, '50', null]) assert.equal(boat.setRudderMaxForce(bad), false);
  assert.equal(boat.setRudderMaxForce(0), true);
  boat.input_rudder_left(); boat.physics_model_step();
  assert.equal(boat.rudderForceLimited, false);
  assert.equal(boat.rudder_angle_effective, boat.rudder_angle);
});

test('boat: the autopilot command is limited too', () => {
  const host = boatAt();
  const boat = host.core.sim.players[0];
  boat.setRudderMaxForce(10);
  boat.autopilot_enabled = true;
  boat.autopilot_heading_target = -boat.twa - 90;
  let limited = 0;
  for (let i = 0; i < 30; i++) { boat.physics_model_step(); if (boat.rudderForceLimited) limited++; }
  assert.ok(limited > 0);
});

test('TOML and command: rudder_max_force_n default, range, carried as rudderMaxForce', () => {
  const text = stringifyDevConfig(DEV_CONFIG_DEFAULTS);
  assert.match(text, new RegExp(`^rudder_max_force_n = ${RUDDER_MAX_FORCE_N}$`, 'm'));
  assert.match(text, /# rudder_max_force_n:/);
  const without = text.split('\n').filter((l) => !/^rudder_max_force_n/.test(l)).join('\n');
  assert.equal(parseAndValidateDevConfig(without).config.rudder_max_force_n, RUDDER_MAX_FORCE_N);
  const line = `rudder_max_force_n = ${RUDDER_MAX_FORCE_N}`;
  assert.equal(parseAndValidateDevConfig(text.replace(line, 'rudder_max_force_n = 0')).config.rudder_max_force_n, 0);
  assert.equal(parseAndValidateDevConfig(text.replace(line, 'rudder_max_force_n = 250.5')).config.rudder_max_force_n, 250.5);
  for (const bad of ['-1', '5001', '"50"', 'true']) {
    assert.match(parseAndValidateDevConfig(text.replace(line, 'rudder_max_force_n = ' + bad)).error, /rudder_max_force_n/, bad);
  }
  const c = devBoatCommand({ ...DEV_CONFIG_DEFAULTS, rudder_max_force_n: 80 });
  assert.equal(c.rudderMaxForce, 80);
  assert.equal(validateAutopilotGains(c).rudderMaxForce, 80);
  assert.equal('rudderMaxForce' in validateAutopilotGains({ kp: 2, ki: 0, kd: 0 }), false);
  assert.match(validateAutopilotGains({ kp: 2, ki: 0, kd: 0, rudderMaxForce: 9000 }).error, /rudder_max_force_n/);
});

test('local host: Apply sets every boat and later boats; a command without it leaves them', () => {
  const host = boatAt();
  const sim = host.core.sim;
  const boat = sim.players[0];
  assert.equal(boat.rudder_max_force_n, RUDDER_MAX_FORCE_N);
  const r = mute(() => host.commandSync({ ...devBoatCommand(DEV_CONFIG_DEFAULTS), rudderMaxForce: 42 }));
  assert.ok(r.ok);
  assert.equal(boat.rudder_max_force_n, 42);
  const s = host.commandSync({ type: 'spawnBoat', name: 'Later' });
  assert.equal(sim.players.find((p) => p.boatId === s.id).rudder_max_force_n, 42);
  mute(() => host.commandSync({ type: 'autopilotGains', boatId: boat.boatId, kp: 2, ki: 0, kd: 0 }));
  assert.equal(boat.rudder_max_force_n, 42);
  assert.ok(host.commandSync({ type: 'autopilotGains', kp: 2, ki: 0, kd: 0, rudderMaxForce: -3 }).error);
  assert.equal(boat.rudder_max_force_n, 42);
});

test('server room: only the sender\'s boats; remembered across an Apply without it', () => {
  const room = new Room('rudderforce', { lockstep: true, graceMs: 0, fieldHz: 0 });
  const sent = (list) => { const c = { send: (m) => list.push(parseServerMessage(m)) }; room.join(c); return c; };
  const aIn = [], bIn = [], cIn = [];
  const A = sent(aIn), B = sent(bIn), C = sent(cIn);
  const resultOf = (list) => { const m = [...list].reverse().find((x) => x.type === 'result'); return m && m.r; };
  room.message(A, { type: 'init', opts: { mapW: 100, mapH: 200, simRes: '4f' } });
  room.message(B, { type: 'init', opts: {} });
  room.message(C, { type: 'init', opts: {} });
  mute(() => {
    room.message(A, { type: 'command', id: 1, c: { type: 'devMode', on: true } });
    room.message(A, { type: 'command', id: 2, c: { type: 'restart', scenario: 0 } });
    for (let t = 0; t < 3; t++) room.step({ dt: 1 / 30, held: [], present: false, view });
  });
  const sim = room.core.sim;
  room.message(A, { type: 'command', id: 3, c: { type: 'spawnBoat', name: 'A' } });
  room.message(B, { type: 'command', id: 4, c: { type: 'spawnBoat', name: 'B' } });
  const byId = (id) => sim.players.find((p) => p.boatId === id);
  const idA = resultOf(aIn).id, idB = resultOf(bIn).id;
  room.message(A, { type: 'command', id: 5, c: { type: 'autopilotGains', kp: 2, ki: 0, kd: 0, rudderMaxForce: 55 } });
  assert.ok(resultOf(aIn).ok);
  assert.equal(byId(idA).rudder_max_force_n, 55);
  assert.equal(byId(idB).rudder_max_force_n, RUDDER_MAX_FORCE_N);
  room.message(C, { type: 'command', id: 6, c: { type: 'autopilotGains', kp: 2, ki: 0, kd: 0, rudderMaxForce: 70 } });
  room.message(C, { type: 'command', id: 7, c: { type: 'autopilotGains', kp: 3, ki: 0, kd: 0 } });
  room.message(C, { type: 'command', id: 8, c: { type: 'spawnBoat', name: 'C' } });
  const boatC = byId(resultOf(cIn).id);
  assert.equal(boatC.rudder_max_force_n, 70);
  assert.equal(boatC.autopilot_kp, 3);
  room.leave(A); room.leave(B); room.leave(C);
});
