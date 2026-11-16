// Sticky autopilot holdoff (sticky_autopilot_holdoff_ms, default 500 ms):
// Left / Right are plain helm; after they are released the boat waits the
// holdoff (sim time, no helm meanwhile) and engages heading hold on the
// heading she then has. Re-pressing restarts it, 0 engages at once, -1
// never. Up / Down never disengage the autopilot, so the holdoff does not
// apply to them. Per boat, through autopilotGains (local and server).
import './dom-stub.mjs';
await import('./full-stack.mjs');
const H = await import('../scripts/sim-res-harness.mjs');
const { Boat, wrapDeg180, STICKY_AUTOPILOT_HOLDOFF_MS, STICKY_AUTOPILOT_HOLDOFF_MS_MIN, STICKY_AUTOPILOT_HOLDOFF_MS_MAX } = await import('../src/boat.js');
const { BOAT_ACTIONS } = await import('../src/sim.js');
const { settingDefault, setting, STICKY_AUTOPILOT_HOLDOFF_MS_DEFAULT, STICKY_AUTOPILOT_HOLDOFF_MS_LIMITS } = await import('../src/settings-registry.js');
const { LocalHost } = await import('../src/host.js');
const { heldCommands, bindKeys, setVirtualKey } = await import('../src/controls.js');

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const DT = 1 / 30;

check('default 500 ms; registry and boat agree on default and range', STICKY_AUTOPILOT_HOLDOFF_MS === 500 && settingDefault('sticky_autopilot_holdoff_ms') === 500
  && STICKY_AUTOPILOT_HOLDOFF_MS_DEFAULT === STICKY_AUTOPILOT_HOLDOFF_MS && STICKY_AUTOPILOT_HOLDOFF_MS_LIMITS.min === STICKY_AUTOPILOT_HOLDOFF_MS_MIN && STICKY_AUTOPILOT_HOLDOFF_MS_LIMITS.max === STICKY_AUTOPILOT_HOLDOFF_MS_MAX
  && setting('sticky_autopilot_holdoff_ms').type === 'number');
check('the old sticky_autopilot setting and autopilotTurn command are gone', !BOAT_ACTIONS.autopilotTurn && (() => { try { setting('sticky_autopilot'); return false; } catch { return true; } })());
check('wrapDeg180', wrapDeg180(190) === -170 && wrapDeg180(-180) === 180 && wrapDeg180(-190) === 170 && wrapDeg180(720) === 0);

// One boat on a world, stepped like Sim.step does: held commands, then the
// holdoff, then physics.
function rig(holdoff) {
  const { map } = H.makeWorld(1);
  const b = new Boat(map, 10, -9, 5 * Math.PI / 4);
  if (holdoff !== undefined) check(`setStickyAutopilotHoldoff(${holdoff})`, b.setStickyAutopilotHoldoff(holdoff));
  const tick = (held = []) => {
    for (const c of held) BOAT_ACTIONS[c.type](b, c);
    b.stepHelmHoldoff(DT);
    map.world.step(DT);
    b.physics_model_step();
  };
  for (let t = 0; t < 60; t++) { if (t === 1) b.input_autopilot_enabled_toggle(); tick(); }
  return { b, tick };
}
const L = { type: 'helm', dir: -1 }, R = { type: 'helm', dir: +1 };

{
  const { b, tick } = rig();
  check('autopilot on before the helm', b.autopilot_enabled);
  for (let t = 0; t < 20; t++) tick([L]);
  check('Left helm disengages the autopilot (plain rudder)', !b.autopilot_enabled && Math.abs(b.rudder_angle) > 5, `rudder ${b.rudder_angle.toFixed(1)}`);
  // Release tick + 14 ticks = 466.7 ms: still off. The 15th (500 ms) engages.
  let engagedAt = -1, targetOk = false;
  for (let t = 0; t <= 30; t++) {
    const twaBefore = b.twa;
    b.stepHelmHoldoff(DT);
    if (b.autopilot_enabled && engagedAt < 0) { engagedAt = t; targetOk = b.autopilot_heading_target === wrapDeg180(-twaBefore); }
    map_step(b);
  }
  check('default: heading hold engages exactly 500 ms (15 ticks) after release', engagedAt === 15, `engaged at tick ${engagedAt}`);
  check('it holds the heading she had then (target = -TWA, no snap to best VMG)', targetOk);
}
function map_step(b) { b.map.world.step(DT); b.physics_model_step(); }

{
  const { b, tick } = rig();
  for (let t = 0; t < 10; t++) tick([L]);
  for (let t = 0; t < 10; t++) tick();          // 333 ms released
  for (let t = 0; t < 5; t++) tick([R]);        // helm again: cancels
  let engagedAt = -1;
  for (let t = 0; t <= 30; t++) { tick(); if (b.autopilot_enabled && engagedAt < 0) engagedAt = t; }
  check('helm again during the holdoff restarts it from the new release', engagedAt === 15, `engaged at ${engagedAt}`);
}
{
  const { b, tick } = rig(0);
  for (let t = 0; t < 10; t++) tick([L]);
  tick();
  check('0 ms: engages on the release tick', b.autopilot_enabled);
}
{
  const { b, tick } = rig(-1);
  for (let t = 0; t < 10; t++) tick([L]);
  for (let t = 0; t < 150; t++) tick();
  check('-1: never engages (plain manual helm)', !b.autopilot_enabled);
  tick([{ type: 'autopilot' }]);
  check('-1: Space still engages it', b.autopilot_enabled);
}
{
  const { b, tick } = rig(1000);
  for (let t = 0; t < 10; t++) tick([L]);
  let at = -1;
  for (let t = 0; t <= 40; t++) { tick(); if (b.autopilot_enabled && at < 0) at = t; }
  check('1000 ms: engages after 30 ticks of sim time', at === 30, `at ${at}`);
}
{
  const { b, tick } = rig();
  const t0 = b.autopilot_heading_target;
  for (let t = 0; t < 10; t++) tick([{ type: 'headingTarget', dir: +1 }]);
  check('Up / Down keep the autopilot on and move the target (holdoff not involved)', b.autopilot_enabled && b.autopilot_heading_target !== t0 && b._holdoffElapsed === null);
  for (let t = 0; t < 10; t++) tick([L]);
  for (let t = 0; t < 3; t++) tick();
  tick([{ type: 'headingTarget', dir: -1 }]);
  check('Up / Down during the holdoff engage at once and end the holdoff', b.autopilot_enabled && b._holdoffElapsed === null);
}
{
  const { b, tick } = rig();
  for (let t = 0; t < 10; t++) { b.input_rudder_left(); tick(); }
  for (let t = 0; t < 30; t++) tick();
  check('scripts calling input_rudder_* directly never start a holdoff', !b.autopilot_enabled);
}
{
  const { map } = H.makeWorld(1);
  const b = new Boat(map, 10, -9, 5 * Math.PI / 4);
  check('setStickyAutopilotHoldoff rejects out-of-range / non-numbers', !b.setStickyAutopilotHoldoff(-2) && !b.setStickyAutopilotHoldoff(10001) && !b.setStickyAutopilotHoldoff('5') && !b.setStickyAutopilotHoldoff(NaN) && b.sticky_autopilot_holdoff_ms === 500);
}

// Sim level (LocalHost), two boats, per-boat holdoff via autopilotGains, held
// keys from controls.js: only the steered boat gets the holdoff, on sim time.
{
  const opts = { mapW: 100, mapH: 200, simRes: '4f' };
  const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
  const quiet = console.log; console.log = () => {};
  const h = new LocalHost({ ...opts, texture: { image: { data: new Uint8Array(0) } } });
  h.commandSync({ type: 'restart', scenario: 0 });
  for (let t = 0; t < 3; t++) h.tick({ dt: DT, held: [], present: false, view });
  h.commandSync({ type: 'spawnBoat', name: 'Two' });
  const [b0, b1] = h.core.sim.players;
  const g = { type: 'autopilotGains', kp: 2, ki: 0, kd: 0 };
  const r0 = h.commandSync({ ...g, boatId: b0.boatId, stickyHoldoffMs: 200 });
  const r1 = h.commandSync({ ...g, boatId: b1.boatId, stickyHoldoffMs: 1000 });
  const bad = h.commandSync({ ...g, boatId: b1.boatId, stickyHoldoffMs: 20000 });
  console.log = quiet;
  check('autopilotGains sets each boat\'s holdoff by id; out of range is refused', r0.ok && r1.ok && bad.error && /sticky_autopilot_holdoff_ms/.test(bad.error) && b0.sticky_autopilot_holdoff_ms === 200 && b1.sticky_autopilot_holdoff_ms === 1000, JSON.stringify(bad));
  console.log = () => {};
  for (let t = 0; t < 30; t++) h.tick({ dt: DT, held: [], present: false, view });
  if (!b0.autopilot_enabled) h.commandSync({ type: 'autopilot', boat: 0 });
  if (!b1.autopilot_enabled) h.commandSync({ type: 'autopilot', boat: 1 });
  bindKeys(2);
  setVirtualKey(37, true); setVirtualKey(65, true);    // P1 Left, P2 A (split layout)
  for (let t = 0; t < 10; t++) h.tick({ dt: DT, held: heldCommands(), present: false, view });
  const off = !b0.autopilot_enabled && !b1.autopilot_enabled;
  setVirtualKey(37, false); setVirtualKey(65, false);
  const at = [-1, -1];
  for (let t = 0; t <= 40; t++) {
    h.tick({ dt: DT, held: heldCommands(), present: false, view });
    if (b0.autopilot_enabled && at[0] < 0) at[0] = t;
    if (b1.autopilot_enabled && at[1] < 0) at[1] = t;
  }
  console.log = quiet;
  check('held keys go through as helm (both boats off while held)', off);
  check('per boat: 200 ms boat engages after 6 ticks, 1000 ms boat after 30', at[0] === 6 && at[1] === 30, JSON.stringify(at));
  bindKeys(0);
}

// Server room: the holdoff reaches only the sender's own boats; a
// spectator's value is remembered for its spawn, and a later Apply without
// it keeps the remembered value.
{
  const { Room } = await import('../apps/server/room.js');
  const { parseServerMessage } = await import('../src/wire-codec.js');
  const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
  const quiet = console.log; console.log = () => {};
  const room = new Room('holdoff', { lockstep: true, graceMs: 0, fieldHz: 0 });
  const join = (list) => { const c = { send: (m) => list.push(parseServerMessage(m)) }; room.join(c); return c; };
  const aIn = [], bIn = [], cIn = [];
  const A = join(aIn), B = join(bIn), C = join(cIn);
  const resultOf = (list) => { const m = [...list].reverse().find((x) => x.type === 'result'); return m && m.r; };
  room.message(A, { type: 'init', opts: { mapW: 100, mapH: 200, simRes: '4f' } });
  room.message(B, { type: 'init', opts: {} });
  room.message(C, { type: 'init', opts: {} });
  room.message(A, { type: 'command', id: 1, c: { type: 'devMode', on: true } });
  room.message(A, { type: 'command', id: 2, c: { type: 'restart', scenario: 0 } });
  for (let t = 0; t < 3; t++) room.step({ dt: DT, held: [], present: false, view });
  const sim = room.core.sim;
  room.message(A, { type: 'command', id: 3, c: { type: 'spawnBoat', name: 'A' } });
  const idA = resultOf(aIn).id;
  room.message(B, { type: 'command', id: 4, c: { type: 'spawnBoat', name: 'B' } });
  const idB = resultOf(bIn).id;
  const byId = (id) => sim.players.find((p) => p.boatId === id);
  room.message(A, { type: 'command', id: 5, c: { type: 'autopilotGains', kp: 2, ki: 0, kd: 0, stickyHoldoffMs: 0 } });
  const okA = resultOf(aIn).ok;
  room.message(C, { type: 'command', id: 6, c: { type: 'autopilotGains', kp: 2, ki: 0, kd: 0, stickyHoldoffMs: 250 } });
  room.message(C, { type: 'command', id: 7, c: { type: 'autopilotGains', kp: 3, ki: 0, kd: 0 } });
  room.message(C, { type: 'command', id: 8, c: { type: 'spawnBoat', name: 'C' } });
  const boatC = byId(resultOf(cIn).id);
  const holdA = byId(idA).sticky_autopilot_holdoff_ms, holdB = byId(idB).sticky_autopilot_holdoff_ms;
  room.leave(A); room.leave(B); room.leave(C);
  console.log = quiet;
  check('server: holdoff only on the sender\'s boat', okA && holdA === 0 && holdB === 500, JSON.stringify([holdA, holdB]));
  check('server: a spectator\'s holdoff is remembered for its spawn (kept by a later Apply without it)', boatC.sticky_autopilot_holdoff_ms === 250 && boatC.autopilot_kp === 3);
}

if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all sticky-autopilot checks passed');
process.exit(0);
