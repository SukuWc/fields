// Max rudder angle from the Dev TOML (rudder_max_deg): default 60°, range,
// the command that carries it, the boat clamp, and which boats it reaches
// in local and server-room modes.
import './dom-stub.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOPILOT_RUDDER_MAX, Boat, PENALTY_TURN_RUDDER_MAX,
  RUDDER_MAX_DEG, RUDDER_MAX_DEG_MAX, RUDDER_MAX_DEG_MIN,
} from '../src/boat.js';
import { RUDDER_MAX_DEG_DEFAULT, RUDDER_MAX_DEG_LIMITS, setting } from '../src/settings-registry.js';
import {
  DEV_CONFIG_DEFAULTS,
  devBoatCommand,
  parseAndValidateDevConfig,
  stringifyDevConfig,
  validateAutopilotGains,
} from '../src/dev-config.js';
import { LocalHost } from '../src/host.js';
import { Room } from '../apps/server/room.js';
import { parseServerMessage } from '../src/wire-codec.js';

const quiet = console.log;
const mute = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = quiet; } };
const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
const tex = () => ({ image: { data: new Uint8Array(0) } });

test('default is 60° and the registry matches the boat constants', () => {
  assert.equal(RUDDER_MAX_DEG, 60);
  assert.equal(RUDDER_MAX_DEG_DEFAULT, RUDDER_MAX_DEG);
  assert.equal(RUDDER_MAX_DEG_LIMITS.min, RUDDER_MAX_DEG_MIN);
  assert.equal(RUDDER_MAX_DEG_LIMITS.max, RUDDER_MAX_DEG_MAX);
  assert.equal(setting('rudderMax').min, 10);
  assert.equal(setting('rudderMax').max, 90);
  assert.equal(DEV_CONFIG_DEFAULTS.rudder_max_deg, 60);
});

test('TOML: absent key is 60, a valid value is kept, out of range and wrong type are refused', () => {
  const text = stringifyDevConfig(DEV_CONFIG_DEFAULTS);
  assert.match(text, /^rudder_max_deg = 60$/m);
  assert.match(text, /# rudder_max_deg:/);
  const without = text.split('\n').filter((l) => !/^rudder_max_deg/.test(l)).join('\n');
  assert.equal(parseAndValidateDevConfig(without).config.rudder_max_deg, 60);
  assert.equal(parseAndValidateDevConfig(text.replace('rudder_max_deg = 60', 'rudder_max_deg = 35.5')).config.rudder_max_deg, 35.5);
  for (const bad of ['5', '91', '"45"', 'true']) {
    const r = parseAndValidateDevConfig(text.replace('rudder_max_deg = 60', 'rudder_max_deg = ' + bad));
    assert.match(r.error, /rudder_max_deg must be 10\.\.90/, bad);
  }
  assert.equal(parseAndValidateDevConfig(text.replace('rudder_max_deg = 60', 'rudder_max_deg = 10')).config.rudder_max_deg, 10);
  assert.equal(parseAndValidateDevConfig(text.replace('rudder_max_deg = 60', 'rudder_max_deg = 90')).config.rudder_max_deg, 90);
});

test('the Apply command carries rudderMax; validation keeps old commands unchanged', () => {
  const c = devBoatCommand({ ...DEV_CONFIG_DEFAULTS, rudder_max_deg: 40 });
  assert.equal(c.type, 'autopilotGains');
  assert.equal(c.rudderMax, 40);
  assert.equal(validateAutopilotGains(c).rudderMax, 40);
  assert.equal('rudderMax' in validateAutopilotGains({ kp: 2, ki: 0, kd: 1 }), false);
  assert.match(validateAutopilotGains({ kp: 2, ki: 0, kd: 1, rudderMax: 120 }).error, /rudder_max_deg/);
  assert.match(validateAutopilotGains({ kp: 2, ki: 0, kd: 1, rudderMax: null }).error, /rudder_max_deg/);
});

function boatAt() {
  const host = new LocalHost({ mapW: 100, mapH: 200, simRes: '4f', texture: tex() });
  mute(() => {
    host.commandSync({ type: 'devMode', on: true });
    host.commandSync({ type: 'restart', scenario: 0 });
    for (let i = 0; i < 3; i++) host.tick({ dt: 1 / 30, held: [], present: false, view });
  });
  return host;
}

test('boat: manual helm stops at the limit; setRudderMax clamps and refuses bad values', () => {
  const host = boatAt();
  const boat = host.core.sim.players[0];
  assert.equal(boat.rudder_angle_max, 60);
  boat.autopilot_enabled = false;
  for (let i = 0; i < 120; i++) { boat.input_rudder_left(); boat.physics_model_step(); }
  assert.equal(Math.abs(boat.rudder_angle), 60);
  const side = Math.sign(boat.rudder_angle);
  assert.equal(boat.setRudderMax(25), true);
  assert.equal(boat.rudder_angle, 25 * side);
  for (let i = 0; i < 60; i++) { boat.input_rudder_right(); boat.physics_model_step(); }
  assert.equal(boat.rudder_angle, -25 * side);
  for (const bad of [5, 95, NaN, '30', null]) assert.equal(boat.setRudderMax(bad), false);
  assert.equal(boat.rudder_angle_max, 25);
});

test('boat: autopilot and penalty limits are unchanged at 60 and capped by a lower limit', () => {
  assert.equal(AUTOPILOT_RUDDER_MAX, 30);
  assert.equal(PENALTY_TURN_RUDDER_MAX, 50);
  const host = boatAt();
  const boat = host.core.sim.players[0];
  const hardOver = () => {
    boat.autopilot_enabled = true;
    boat.autopilot_kp = 20; boat.autopilot_ki = 0; boat.autopilot_kd = 0;
    boat.autopilot_heading_target = -boat.twa - 90;
    boat.rudder_angle = 0;
    let peak = 0;
    for (let i = 0; i < 60; i++) { boat.physics_model_step(); peak = Math.max(peak, Math.abs(boat.rudder_angle)); }
    return peak;
  };
  const at60 = hardOver();
  assert.ok(at60 > 25 && at60 <= 30 + 1e-9, String(at60));
  boat.setRudderMax(15);
  const at15 = hardOver();
  assert.ok(at15 > 12 && at15 <= 15 + 1e-9, String(at15));
});

test('local host: Apply sets every boat and later boats; a command without rudderMax leaves them', () => {
  const host = boatAt();
  const sim = host.core.sim;
  const boat = sim.players[0];
  const r = mute(() => host.commandSync({ ...devBoatCommand(DEV_CONFIG_DEFAULTS), rudderMax: 35 }));
  assert.ok(r.ok && r.boats.includes(boat.boatId));
  assert.equal(boat.rudder_angle_max, 35);
  const s = host.commandSync({ type: 'spawnBoat', name: 'Later' });
  assert.equal(sim.players.find((p) => p.boatId === s.id).rudder_angle_max, 35);
  mute(() => { for (let i = 0; i < 3; i++) host.tick({ dt: 1 / 30, held: [], present: false, view }); });
  assert.equal(boat.rudder_angle_max, 35);
  const bad = host.commandSync({ type: 'autopilotGains', kp: 2, ki: 0, kd: 1, rudderMax: 200 });
  assert.ok(bad.error);
  assert.equal(boat.rudder_angle_max, 35);
  mute(() => host.commandSync({ type: 'autopilotGains', boatId: boat.boatId, kp: 2, ki: 0, kd: 1 }));
  assert.equal(boat.rudder_angle_max, 35);
});

test('server room: only the sender\'s boats; remembered for a spectator\'s spawn', () => {
  const room = new Room('rudder', { lockstep: true, graceMs: 0, fieldHz: 0 });
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
  room.message(A, { type: 'command', id: 5, c: { type: 'autopilotGains', kp: 2, ki: 0, kd: 1, rudderMax: 30 } });
  assert.ok(resultOf(aIn).ok);
  assert.equal(byId(idA).rudder_angle_max, 30);
  assert.equal(byId(idB).rudder_angle_max, 60);
  assert.equal(sim.players[0].rudder_angle_max, 60);
  room.message(A, { type: 'command', id: 6, c: { type: 'autopilotGains', kp: 2, ki: 0, kd: 1, rudderMax: 9 } });
  assert.ok(resultOf(aIn).error);
  assert.equal(byId(idA).rudder_angle_max, 30);
  room.message(C, { type: 'command', id: 7, c: { type: 'autopilotGains', kp: 2, ki: 0, kd: 1, rudderMax: 75 } });
  assert.ok(resultOf(cIn).pending);
  room.message(C, { type: 'command', id: 8, c: { type: 'autopilotGains', kp: 3, ki: 0, kd: 1 } });
  room.message(C, { type: 'command', id: 9, c: { type: 'spawnBoat', name: 'C' } });
  const boatC = byId(resultOf(cIn).id);
  assert.equal(boatC.rudder_angle_max, 75);
  assert.equal(boatC.autopilot_kp, 3);
  room.leave(A); room.leave(B); room.leave(C);
});
