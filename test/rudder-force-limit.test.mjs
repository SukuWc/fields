// Rudder force limit (rudder_max_force_n): the limiter in src/rudder-limit.js
// (monotonic and stalled, non-monotonic load curves), the boat applying it
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
    const r = limitRudderAngle({ commandedDeg: 30, ...AHEAD, maxForceN: max });
    assert.equal(r.deg, 30, String(max));
    assert.equal(r.limited, false);
  }
  const still = limitRudderAngle({ commandedDeg: 40, vBodyX: 0, vBodyY: 0, maxForceN: 1 });
  assert.equal(still.deg, 40, 'no flow, no load');
});

test('limiter: over the limit reduces toward 0, keeps the sign, lands on the limit', () => {
  const max = 0.5 * rudderForceN(8, AHEAD.vBodyX, AHEAD.vBodyY);
  for (const cmd of [8, -8, 45, -45]) {
    const r = limitRudderAngle({ commandedDeg: cmd, ...AHEAD, maxForceN: max });
    assert.equal(r.limited, true);
    assert.equal(Math.sign(r.deg), Math.sign(cmd));
    assert.ok(Math.abs(r.deg) < Math.abs(cmd));
    assert.ok(r.forceN <= max + 1e-9, `${r.forceN} ≤ ${max}`);
    assert.ok(r.forceN > max * 0.999, `at the limit: ${r.forceN} vs ${max}`);
    assert.ok(r.commandedForceN > max);
  }
});

test('limiter: never increases the angle, also in cross flow', () => {
  for (const vBodyX of [-1.5, -0.3, 0, 0.3, 1.5]) {
    for (const cmd of [-60, -20, -3, 0, 3, 20, 60]) {
      for (const max of [5, 30, 100]) {
        const r = limitRudderAngle({ commandedDeg: cmd, vBodyX, vBodyY: -3, maxForceN: max });
        assert.ok(Math.abs(r.deg) <= Math.abs(cmd) + 1e-12, `${cmd} → ${r.deg}`);
        assert.ok(r.deg === 0 || Math.sign(r.deg) === Math.sign(cmd));
        if (r.forceN > max) {
          // Not reachable: deg is the least loaded angle in [0, cmd].
          for (let a = 0; a <= Math.abs(cmd); a += 0.05) {
            assert.ok(rudderForceN(Math.sign(cmd) * a, vBodyX, -3) >= r.forceN - 1e-6);
          }
        }
      }
    }
  }
});

test('limiter, non-monotonic stall: largest angle not above the commanded one within the limit', () => {
  // Stylised stalled blade: load rises to a peak at 12°, falls to a trough
  // at 30°, rises again. A limit between trough and peak is met at 30°+ and
  // under 12°, but not in between.
  const load = (deg) => {
    const a = Math.abs(deg);
    if (a <= 12) return 10 * a;          // 0..120
    if (a <= 30) return 120 - 3 * (a - 12); // 120..66
    return 66 + 2 * (a - 30);            // 66 at 30°, 126 at 60°
  };
  // 100 N: at 60° the load is 126; the largest angle ≤ 60 with load ≤ 100 is 47°.
  const r = limitRudderAngle({ commandedDeg: 60, maxForceN: 100, forceAt: load });
  assert.ok(Math.abs(r.deg - 47) < 1e-4, String(r.deg));
  assert.equal(r.limited, true);
  // Commanded 25° (load 81): within the limit, unchanged.
  assert.equal(limitRudderAngle({ commandedDeg: -25, maxForceN: 100, forceAt: load }).deg, -25);
  // 60 N: no angle from 12° to 60° (minimum 66 at 30°) is within it, so it
  // goes on down through the stall into the attached range: 6°.
  const low = limitRudderAngle({ commandedDeg: -60, maxForceN: 60, forceAt: load });
  assert.ok(Math.abs(low.deg + 6) < 1e-4, String(low.deg));
  // A within-limit window narrower than one scan step is still not skipped
  // past a larger valid angle: the scan stops at the first valid step.
  assert.ok(SCAN_STEP_DEG <= 0.5);
});

test('limiter on the NACA 0012 blade in cross flow: load is not monotonic in angle, result is the largest valid angle', () => {
  // The stock slides sideways (leeway / yaw rate): the inflow comes about
  // 9.5° off the centreline, so the load falls from 0° to that angle and
  // rises past it. Commanded 40°, limit below the load at 0°: the angles
  // just under 40° are over it, the ones near the flow angle are within it.
  const vBodyX = 0.5, vBodyY = -3;
  const f = (d) => rudderForceN(d, vBodyX, vBodyY);
  assert.ok(f(0) > f(9.5) && f(40) > f(9.5), 'load dips near the flow angle');
  const max = 0.5 * f(0);
  const r = limitRudderAngle({ commandedDeg: 40, vBodyX, vBodyY, maxForceN: max });
  assert.equal(r.limited, true);
  assert.ok(r.forceN <= max + 1e-9 && r.forceN > max * 0.999);
  assert.ok(r.deg > 9.5 && r.deg < 40, String(r.deg));
  for (let a = r.deg + 0.05; a <= 40; a += 0.05) assert.ok(f(a) > max - 1e-6, String(a));
  // Same flow, the other side: no angle from 0 to −40° is within a limit
  // below the load at 0°, and 0 is the least loaded there.
  const other = limitRudderAngle({ commandedDeg: -40, vBodyX, vBodyY, maxForceN: max });
  assert.equal(other.deg === 0 || Object.is(other.deg, -0), true, String(other.deg));
  assert.ok(other.forceN > max);
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
    assert.ok(Math.abs(boat.rudder_angle_effective) <= Math.abs(boat.rudder_angle) + 1e-12);
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
  assert.ok(boat.rudderForceN <= 5 + 1e-6 || Math.abs(boat.rudder_angle_effective) === 0);
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
