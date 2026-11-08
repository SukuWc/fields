// Autopilot PID reaches the boat the host is allowed to steer, by id, and
// changes the rudder. LocalHost, the worker protocol, and a server room.
import { LocalHost } from '../src/host.js';
import { Room } from '../apps/server/room.js';
import { AUTOPILOT_KD, AUTOPILOT_KI, AUTOPILOT_KP, AUTOPILOT_RUDDER_BLEND } from '../src/boat.js';
import { parseServerMessage } from '../src/wire-codec.js';

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed++;
};
const quiet = console.log;
const mute = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = quiet; } };

const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
const tex = () => ({ image: { data: new Uint8Array(0) } });

function rudderFor(boat, kp, ki, kd) {
  boat.autopilot_enabled = true;
  boat.physics_model_step();
  const err = 10;
  boat.autopilot_heading_target = -boat.twa - err;
  boat.autopilot_kp = kp;
  boat.autopilot_ki = ki;
  boat.autopilot_kd = kd;
  boat.autopilot_compensator_last_error = err;
  boat.autopilot_compensator_sum_error = 0;
  boat.rudder_angle = 0;
  const ang = boat.physics_model.getAngle();
  const fwd = ang - Math.PI / 2;
  boat.physics_model.setLinearVelocity({ x: Math.cos(fwd) * 2, y: Math.sin(fwd) * 2 });
  boat.physics_model_step();
  return boat.rudder_angle;
}

// Local host: sim-wide gains, id targeting, index refused, rudder follows P and I.
{
  const host = new LocalHost({ mapW: 100, mapH: 200, simRes: '4f', texture: tex() });
  mute(() => {
    host.commandSync({ type: 'devMode', on: true });
    host.commandSync({ type: 'restart', scenario: 0 });
    for (let i = 0; i < 3; i++) host.tick({ dt: 1 / 30, held: [], present: false, view });
  });
  const sim = host.core.sim;
  const boat = sim.players[0];
  check('scenario boat is addressed by id', typeof boat.boatId === 'string' && boat.boatId !== '0' && !Number.isInteger(boat.boatId), boat.boatId);
  check('a new boat starts on the PD defaults', boat.autopilot_kp === AUTOPILOT_KP && boat.autopilot_ki === AUTOPILOT_KI && boat.autopilot_kd === AUTOPILOT_KD);

  const refused = host.commandSync({ type: 'autopilotGains', boat: 0, kp: 9, ki: 0, kd: 1 });
  check('an array index is refused and the boat is unchanged', refused && /index/.test(refused.error) && boat.autopilot_kp === AUTOPILOT_KP, JSON.stringify(refused));

  const bad = host.commandSync({ type: 'autopilotGains', kp: 50, ki: 0, kd: 1 });
  check('out of range does not write', bad && bad.error && boat.autopilot_kp === AUTOPILOT_KP, JSON.stringify(bad));

  const one = host.commandSync({ type: 'autopilotGains', boatId: boat.boatId, kp: 4, ki: 0, kd: 0 });
  check('boatId writes that boat only', one && one.boats[0] === boat.boatId && boat.autopilot_kp === 4 && boat.autopilot_ki === 0 && sim.autopilotGains === null, JSON.stringify(one));

  const missing = host.commandSync({ type: 'autopilotGains', boatId: 'no-such-boat', kp: 4, ki: 0, kd: 0 });
  check('unknown boat id changes nothing', missing && /no boat/.test(missing.error) && boat.autopilot_kp === 4, JSON.stringify(missing));

  const all = mute(() => host.commandSync({ type: 'autopilotGains', kp: AUTOPILOT_KP, ki: 0, kd: AUTOPILOT_KD }));
  check('no id sets every current boat and the sim default', all.boats.includes(boat.boatId) && sim.autopilotGains.kp === AUTOPILOT_KP && boat.autopilot_kp === AUTOPILOT_KP, JSON.stringify(all));

  // Stay under the 30° rudder clamp so the P term is linear (10° error × kp).
  const rDefault = rudderFor(boat, 1, 0, 0);
  const rDouble = rudderFor(boat, 2, 0, 0);
  const rZero = rudderFor(boat, 0, 0, 0);
  const rI = rudderFor(boat, 0, 0.5, 0);
  check('P gain scales the rudder and zero P does not steer', rDefault > 1 && Math.abs(rDouble / rDefault - 2) < 0.15 && Math.abs(rZero) < 0.05,
    `default ${rDefault} double ${rDouble} zero ${rZero}`);
  check('I gain moves the rudder when P and D are zero', Math.abs(rI) > 0.2, String(rI));
  check('default D is the boat constant and the blend is the one the step uses', AUTOPILOT_KD > 29 && AUTOPILOT_KD < 30 && AUTOPILOT_RUDDER_BLEND > 0.2);

  mute(() => host.commandSync({ type: 'autopilotGains', kp: 0, ki: 0, kd: 0 }));
  const spawned = host.commandSync({ type: 'spawnBoat', name: 'Later' });
  const spawnedBoat = sim.players.find((p) => p.boatId === spawned.id);
  check('a boat spawned after Apply gets the sim gains, by its id', spawnedBoat && spawnedBoat.autopilot_kp === 0 && spawnedBoat.autopilot_ki === 0 && spawnedBoat.boatId === spawned.id, spawned && spawned.id);

  // A tick must keep the commanded gains (scenario frames do not put the old constants back).
  mute(() => { for (let i = 0; i < 5; i++) host.tick({ dt: 1 / 30, held: [], present: true, view }); });
  const frame = host.tick({ dt: 1 / 30, held: [], present: true, view });
  check('local frame still lists boats by id after the gain change', frame.state.boats.some((b) => b.id === boat.boatId) && boat.autopilot_kp === 0 && spawnedBoat.autopilot_kp === 0);
}

// Worker protocol: the command is applied inside the worker, not by a client index.
{
  const msgs = [];
  globalThis.self = { postMessage(m) { msgs.push(m); } };
  await import('../src/sim.worker.js');
  const send = (m) => self.onmessage({ data: m });
  send({ type: 'init', opts: { mapW: 100, mapH: 200, simRes: '4f' } });
  const take = (type) => { const i = msgs.findIndex((m) => m.type === type); const m = msgs[i]; if (i >= 0) msgs.splice(i, 1); return m; };
  check('worker init', take('info') && true);
  mute(() => {
    send({ type: 'command', id: 1, c: { type: 'devMode', on: true } });
    send({ type: 'command', id: 2, c: { type: 'restart', scenario: 0 } });
    for (let t = 0; t < 3; t++) send({ type: 'tick', req: { dt: 1 / 30, held: [], present: true, view } });
  });
  msgs.length = 0;
  send({ type: 'command', id: 3, c: { type: 'autopilotGains', boat: 0, kp: 8, ki: 0, kd: 1 } });
  const indexed = take('result');
  check('worker refuses a boat index', indexed && indexed.r && /index/.test(indexed.r.error), JSON.stringify(indexed && indexed.r));
  send({ type: 'command', id: 4, c: { type: 'autopilotGains', kp: 0, ki: 0, kd: 0 } });
  const zero = take('result');
  check('worker applies gains with no index and returns boat ids', zero && zero.r && zero.r.ok && zero.r.boats.length > 0 && zero.r.boats.every((id) => typeof id === 'string'), JSON.stringify(zero && zero.r));
  mute(() => {
    send({ type: 'command', id: 5, c: { type: 'restart', scenario: 0 } });
    for (let t = 0; t < 3; t++) send({ type: 'tick', req: { dt: 1 / 30, held: [], present: true, view } });
    for (let n = 0; n < 15; n++) send({ type: 'command', id: 10 + n, c: { type: 'headingTarget', boat: 0, dir: 1 } });
    for (let t = 0; t < 8; t++) send({ type: 'tick', req: { dt: 1 / 30, held: [], present: true, view } });
  });
  const zeroFrame = [...msgs].reverse().find((m) => m.type === 'frame' && m.frame && m.frame.state);
  const zeroRudder = zeroFrame && zeroFrame.frame.state.boats[0].ra;
  msgs.length = 0;
  send({ type: 'command', id: 40, c: { type: 'autopilotGains', kp: 8, ki: 0, kd: 0 } });
  take('result');
  mute(() => {
    send({ type: 'command', id: 41, c: { type: 'restart', scenario: 0 } });
    for (let t = 0; t < 3; t++) send({ type: 'tick', req: { dt: 1 / 30, held: [], present: true, view } });
    for (let n = 0; n < 15; n++) send({ type: 'command', id: 50 + n, c: { type: 'headingTarget', boat: 0, dir: 1 } });
    for (let t = 0; t < 8; t++) send({ type: 'tick', req: { dt: 1 / 30, held: [], present: true, view } });
  });
  const pFrame = [...msgs].reverse().find((m) => m.type === 'frame' && m.frame && m.frame.state);
  const pRudder = pFrame && pFrame.frame.state.boats[0].ra;
  check('worker steering: a higher P gain after the same target shift holds more rudder than zero gains',
    Number.isFinite(zeroRudder) && Number.isFinite(pRudder) && Math.abs(pRudder) > Math.abs(zeroRudder) + 0.5,
    `zero ${zeroRudder} P ${pRudder}`);
}

// Server room: only the sender's boats, by id. A spectator stores gains until they spawn.
{
  const room = new Room('pid', { lockstep: true, graceMs: 0, fieldHz: 0 });
  const sent = (list) => { const c = { send: (s) => list.push(parseServerMessage(s)) }; room.join(c); return c; };
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
  const scenarioBoat = sim.players[0];
  aIn.length = 0; bIn.length = 0;
  room.message(A, { type: 'command', id: 3, c: { type: 'spawnBoat', name: 'A' } });
  room.message(B, { type: 'command', id: 4, c: { type: 'spawnBoat', name: 'B' } });
  const idA = resultOf(aIn).id;
  const idB = resultOf(bIn).id;
  const boatA = () => sim.players.find((p) => p.boatId === idA);
  const boatB = () => sim.players.find((p) => p.boatId === idB);
  check('spawned boats have ids', typeof idA === 'string' && typeof idB === 'string' && idA !== idB, idA + ' ' + idB);

  aIn.length = 0;
  room.message(A, { type: 'command', id: 5, c: { type: 'autopilotGains', boat: 0, kp: 8, ki: 0, kd: 1 } });
  const applied = resultOf(aIn);
  check('A setting gains, even with a boat index, touches only A',
    applied && applied.ok && applied.boats.length === 1 && applied.boats[0] === idA
    && boatA().autopilot_kp === 8 && boatA().autopilot_ki === 0 && boatA().autopilot_kd === 1
    && boatB().autopilot_kp === AUTOPILOT_KP && scenarioBoat.autopilot_kp === AUTOPILOT_KP
    && sim.autopilotGains === null,
    JSON.stringify(applied));

  const beforeB = boatB().autopilot_kp;
  aIn.length = 0;
  room.message(A, { type: 'command', id: 6, c: { type: 'autopilotGains', kp: 40, ki: 0, kd: 1 } });
  check('A bad gain is rejected and no boat changes', resultOf(aIn) && resultOf(aIn).error && boatA().autopilot_kp === 8 && boatB().autopilot_kp === beforeB, JSON.stringify(resultOf(aIn)));

  cIn.length = 0;
  room.message(C, { type: 'command', id: 7, c: { type: 'autopilotGains', kp: 1, ki: 0.25, kd: 4 } });
  const pending = resultOf(cIn);
  check('a spectator does not change anyone else\'s controller', pending && pending.ok && pending.pending && pending.boats.length === 0
    && boatA().autopilot_kp === 8 && boatB().autopilot_kp === AUTOPILOT_KP && scenarioBoat.autopilot_kp === AUTOPILOT_KP, JSON.stringify(pending));
  cIn.length = 0;
  room.message(C, { type: 'command', id: 8, c: { type: 'spawnBoat', name: 'C' } });
  const idC = resultOf(cIn).id;
  const boatC = sim.players.find((p) => p.boatId === idC);
  check('the spectator\'s gains apply to the boat they spawn, by that id', boatC && boatC.autopilot_kp === 1 && boatC.autopilot_ki === 0.25 && boatC.autopilot_kd === 4
    && boatA().autopilot_kp === 8 && boatB().autopilot_kp === AUTOPILOT_KP, idC);

  const steerA = rudderFor(boatA(), 8, 0, 0);
  const steerB = rudderFor(boatB(), AUTOPILOT_KP, 0, 0);
  check('remote boats keep their own gains through a steer step', Math.abs(steerA) > Math.abs(steerB) && boatA().autopilot_kp === 8 && boatB().autopilot_kp === AUTOPILOT_KP,
    `A ${steerA} B ${steerB}`);
  room.leave(A); room.leave(B); room.leave(C);
}

if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all dev-pid checks passed');
process.exit(0);
