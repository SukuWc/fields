// Multiplayer room state and controls (apps/server/room.js): joining does
// not reset the room, room-wide settings are validated and broadcast,
// clients steer only their own boats, each client's readout is its own
// boat's, per-client subscriptions (flow tracers, perf) stay per client,
// and player boats survive a room-wide restart.
import { hudFromState, telemetryState, telemetryHtmlOf } from '../src/hud.js';
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/index.js';
import { RemoteHost } from '../src/remote-host.js';

let failed = 0;
const quiet = console.log;
const check = (name, ok, extra = '') => { quiet((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
console.log = () => {};
console.warn = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { mapW: 100, mapH: 200, simRes: '4f' };
const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
const tex = () => ({ image: { data: new Uint8Array(0) } });
const connect = async (url, o = opts) => { const h = new RemoteHost(url, o, tex(), { WebSocketImpl: WebSocket }); await h.ready; return h; };
const until = async (fn, ms = 3000) => { const t = Date.now(); while (!fn() && Date.now() - t < ms) await sleep(20); return fn(); };

// Server clock rooms.
{
  const srv = await startServer({ port: 0, adminGate: false, fieldHz: 0 });
  const url = (r) => `ws://127.0.0.1:${srv.port}/?room=${r}`;

  // 1. Joining: the creator's scenario loads once; a second client changes nothing.
  {
    const A = await connect(url('join'), { ...opts, scenario: 1 });
    const room = srv.rooms.get('join');
    const core = room.core;
    check('the creating client\'s scenario is loaded (welcome carries it)', core.sim.scenarioIndex === 1 && A.room.scenario.index === 1 && A.room.scenario.title === core.sim.scenarios[1].title);
    await A.command({ type: 'wind', speed: 6, angle: 80 });
    await A.command({ type: 'barrier', on: true });
    await sleep(400);
    const frameBefore = core.sim.frame;
    const boatsBefore = core.sim.players.length;
    const settingsBefore = JSON.stringify(core.settings);
    const roomEvents = [];
    A.on((e) => { if (e.type === 'room') roomEvents.push(e.room); });
    // A different page: other scenario, size and grid in its URL.
    const B = await connect(url('join'), { mapW: 50, mapH: 100, simRes: '1', scenario: 5 });
    await sleep(300);
    check('a second client joining does not restart the room', core.sim.scenarioIndex === 1 && core.sim.frame > frameBefore && core.sim.players.length === boatsBefore, `frame ${frameBefore} -> ${core.sim.frame}`);
    check('a second client joining does not change room settings', JSON.stringify(core.settings) === settingsBefore && roomEvents.length === 0, settingsBefore);
    check('the welcome snapshot carries the room as it is (size, scenario, settings)', B.info.mapW === 100 && B.room.scenario.index === 1 && B.room.settings.wind.speed === 6 && B.room.settings.wind.angle === 80 && B.room.settings.barrier === true && B.bindings === 0 && B.own.length === 0);
    // 2. Room-wide change: every client hears it.
    const evB = [];
    B.on((e) => { if (e.type === 'room') evB.push(e.room); });
    await B.command({ type: 'devMode', on: true });
    await until(() => evB.length && roomEvents.length);
    check('a room-wide change is broadcast to every client', evB.at(-1).settings.devMode === true && roomEvents.at(-1).settings.devMode === true && A.room.settings.devMode === true);
    const card = await A.command({ type: 'restart', scenario: 2 });
    await until(() => evB.length >= 2);
    check('restart: the card for the sender, the room event (index, title) for all', card.title === core.sim.scenarios[2].title && B.room.scenario.index === 2 && B.room.scenario.description === core.sim.scenarios[2].description);
    // 3. Validation.
    const bad = [
      [{ type: 'wind', speed: 99 }, 'wind speed'],
      [{ type: 'wind', angle: 'x' }, 'wind angle'],
      [{ type: 'restart', scenario: 99 }, 'scenario 99'],
      [{ type: 'restart', scenario: 'abc' }, 'scenario abc'],
      [{ type: 'simRes', mode: 'zzz' }, 'simRes'],
      [{ type: 'amrMode', mode: 'big' }, 'amrMode'],
      [{ type: 'devMode', on: 'yes' }, 'devMode'],
      [{ type: 'cellBudget', tune: true, target: 5 }, 'cellBudget'],
      [{ type: 'options', amr: 1 }, 'options'],
      [{ type: 'teleport' }, 'unknown'],
    ];
    const before = JSON.stringify(core.settings);
    const results = [];
    for (const [c] of bad) results.push(await A.command(c));
    check('invalid room commands are refused with an error and change nothing', results.every((r) => r && typeof r.error === 'string') && JSON.stringify(core.settings) === before && core.sim.scenarioIndex === 2, JSON.stringify(results.map((r) => r && r.error)));
    A.terminate(); B.terminate();
    await sleep(100);
  }
  {
    const S = await connect(url('small'), { mapW: 50, mapH: 100, simRes: '4f', scenario: 0 });
    const r = await S.command({ type: 'restart', scenario: 18 });
    check('a scenario that does not fit the room is refused', r && /does not fit/.test(r.error), JSON.stringify(r));
    S.terminate();
  }

  // 4. Steering: own boats only.
  {
    const A = await connect(url('steer'), { ...opts, scenario: 0 });
    const B = await connect(url('steer'));
    const core = srv.rooms.get('steer').core;
    await sleep(300);
    const s0 = core.sim.players[0];
    const binds = [];
    A.on((e) => { if (e.type === 'bindControls') binds.push(e.boats); });
    const ra = await A.command({ type: 'spawnBoat', name: 'Ann', color: 0x1e88e5 });
    const second = await A.command({ type: 'spawnBoat', name: 'Ann2' });
    const cap = await A.command({ type: 'spawnBoat', name: 'Ann3' });
    check('boats per client are capped (two)', ra.id && second.id && /at most/.test(cap.error) && core.sim.players.filter((b) => b.spawnId).length === 2, JSON.stringify(cap));
    await until(() => binds.at(-1) === 2);
    check('two own boats bind two players', binds.at(-1) === 2 && A.bindings === 2 && B.bindings === 0);
    await A.command({ type: 'removeBoat', id: second.id });
    await until(() => binds.at(-1) === 1);
    check('the client\'s key binding follows its own boats (1 with a boat)', binds.at(-1) === 1 && A.bindings === 1 && B.bindings === 0);
    const a = () => core.sim.players.find((p) => p.spawnId === ra.id);
    // Spectator B: one-shot and held commands at boat 0 / at A's boat.
    const tgt0 = s0.autopilot_heading_target, tgtA = a().autopilot_heading_target;
    await B.command({ type: 'tack', boat: 0 });
    await B.command({ type: 'autopilot', boat: 0 });
    await B.command({ type: 'tack', boatId: ra.id });
    for (let i = 0; i < 30; i++) { B.sendInput({ held: [{ type: 'helm', boat: 0, dir: -1 }, { type: 'helm', boatId: ra.id, dir: 1 }] }); await sleep(33); }
    B.sendInput({ held: [] });
    await sleep(100);
    check('a client without a boat cannot steer scenario boats', s0.autopilot_enabled === true && s0.autopilot_heading_target === tgt0);
    check('a client cannot steer another client\'s boat', a().autopilot_enabled === true && a().autopilot_heading_target === tgtA);
    // B joins too: its commands still never reach A's boat or boat 0.
    const rb = await B.command({ type: 'spawnBoat', name: 'Bo' });
    await B.command({ type: 'tack', boatId: ra.id });
    const b = () => core.sim.players.find((p) => p.spawnId === rb.id);
    check('with its own boat, a client\'s commands hit only that boat', a().autopilot_heading_target === tgtA && s0.autopilot_heading_target === tgt0 && b().autopilot_heading_target !== 0);
    // Both hold helm on "boat 0": each turns only its own boat.
    const hA = a().physics_model.getAngle(), hB = b().physics_model.getAngle();
    await A.command({ type: 'autopilot', boat: 0 });
    await B.command({ type: 'autopilot', boat: 0 });
    for (let i = 0; i < 30; i++) { A.sendInput({ held: [{ type: 'helm', boat: 0, dir: 1 }] }); B.sendInput({ held: [{ type: 'helm', boat: 0, dir: -1 }] }); await sleep(33); }
    A.sendInput({ held: [] }); B.sendInput({ held: [] });
    await sleep(100);
    const dA = a().physics_model.getAngle() - hA, dB = b().physics_model.getAngle() - hB;
    check('keys from two clients never combine on one boat (opposite turns)', Math.sign(dA) !== Math.sign(dB) && Math.abs(dA) > 0.05 && Math.abs(dB) > 0.05 && s0.autopilot_enabled === true, `dA ${dA.toFixed(2)} dB ${dB.toFixed(2)}`);
    // Leave: no steering at all afterwards.
    const ownEv = [];
    B.on((e) => { if (e.type === 'ownBoats') ownEv.push(e.boats); });
    await B.command({ type: 'removeBoat', id: rb.id });
    await until(() => ownEv.length && B.bindings === 0);
    const t0 = s0.autopilot_heading_target, ta = a().autopilot_heading_target;
    await B.command({ type: 'tack', boat: 0 });
    for (let i = 0; i < 20; i++) { B.sendInput({ held: [{ type: 'helm', boat: 0, dir: -1 }] }); await sleep(33); }
    B.sendInput({ held: [] });
    await sleep(100);
    check('after Leave a client steers nothing (binding 0, scenario boat untouched)', !b() && B.bindings === 0 && s0.autopilot_enabled === true && s0.autopilot_heading_target === t0,
      JSON.stringify([!b(), B.bindings, s0.autopilot_enabled, s0.autopilot_heading_target, t0, a().autopilot_heading_target, ta]));

    // 5. Restart keeps player boats, with the same name and colour.
    await B.command({ type: 'spawnBoat', name: 'Bo', color: 0x43a047 });
    const evA = [], evB2 = [];
    A.on((e) => { if (e.type === 'ownBoats') evA.push(e.boats); });
    B.on((e) => { if (e.type === 'ownBoats') evB2.push(e.boats); });
    await A.command({ type: 'restart', scenario: 1 });
    await until(() => evA.length && evB2.length && A.own.length === 1 && B.own.length === 1);
    await sleep(200);
    const spawned = core.sim.players.filter((p) => p.spawnId);
    const ann = spawned.find((p) => p.spawnName === 'Ann'), bo = spawned.find((p) => p.spawnName === 'Bo');
    check('player boats survive a room-wide restart (same name and colour, owned again)',
      core.sim.scenarioIndex === 1 && spawned.length === 2 && ann && bo && ann.spawnColor === 0x1e88e5 && bo.spawnColor === 0x43a047
      && A.own[0].id === ann.spawnId && B.own[0].id === bo.spawnId && A.bindings === 1 && B.bindings === 1
      && core.sim.players.filter((p) => !p.spawnId).length === 2,
      JSON.stringify([A.own, B.own, core.sim.players.length]));
    const tb = bo.autopilot_heading_target;
    await B.command({ type: 'tack', boat: 0 });
    check('the re-spawned boat obeys its owner', bo.autopilot_heading_target === -tb && tb !== 0);
    A.terminate(); B.terminate();
    await sleep(100);
  }

  // 6. Per-client subscriptions: flow tracers and perf.
  {
    const A = await connect(url('subs'), { ...opts, scenario: 0 });
    const B = await connect(url('subs'));
    let aFlow = 0, aPerf = 0, bFlow = 0, bPerf = 0;
    A.onFrame((f) => { if (f.flow) aFlow++; if (f.perf) aPerf++; });
    B.onFrame((f) => { if (f.flow) bFlow++; if (f.perf) bPerf++; });
    const bBytes = [];
    B.onFrameArrival(() => bBytes.push(srv.rooms.get('subs').lastFrameBytes));
    A.setFlow(true);
    A.setPerf(true);
    await sleep(1200);
    check('one client\'s flow tracers / perf overlay reach only that client', aFlow >= 5 && aPerf >= 10 && bFlow === 0 && bPerf === 0, `A flow ${aFlow} perf ${aPerf}, B flow ${bFlow} perf ${bPerf}`);
    const f = B.lastFrame;
    check('the broadcast frame carries neither (B\'s frames unchanged)', f && !('flow' in f) && !('perf' in f));
    A.setFlow(false); A.setPerf(false);
    await sleep(300);
    const a0 = aFlow, p0 = aPerf;
    await sleep(500);
    check('unsubscribing stops them', aFlow === a0 && aPerf === p0);
    A.terminate(); B.terminate();
    await sleep(100);
  }
  await srv.close();
}

// 7. Readouts: each client's readout is its own boat's (lockstep: the
// server state is still when the last frame arrives).
{
  const srv = await startServer({ port: 0, adminGate: false, lockstep: true, fieldHz: 0 });
  const url = `ws://127.0.0.1:${srv.port}/?room=hud`;
  const A = new RemoteHost(url, { ...opts, scenario: 14 }, tex(), { WebSocketImpl: WebSocket, coalesce: false });
  await A.ready;
  const B = new RemoteHost(url, opts, tex(), { WebSocketImpl: WebSocket, coalesce: false });
  await B.ready;
  for (let t = 0; t < 3; t++) A.tick({ dt: 1 / 30, held: [], present: true, view });
  await A.idle();
  const ra = await A.command({ type: 'spawnBoat', name: 'A' });
  const rb = await B.command({ type: 'spawnBoat', name: 'B' });
  for (let t = 0; t < 40; t++) {
    A.tick({ dt: 1 / 30, held: t < 20 ? [{ type: 'helm', boat: 0, dir: 1 }] : [], present: true, view });
    await A.idle();
  }
  await sleep(100);
  const core = srv.rooms.get('hud').core;
  const byId = (id) => core.sim.players.find((p) => p.spawnId === id);
  const hA = hudFromState(A.lastFrame.state.hud, A.own[0].id), hB = hudFromState(B.lastFrame.state.hud, B.own[0].id);
  const telA = telemetryHtmlOf(telemetryState(byId(ra.id).telemetry)), telB = telemetryHtmlOf(telemetryState(byId(rb.id).telemetry));
  const seq = core.sim.startSequence;
  const startA = hA.startHud && hA.startHud.html.includes('start-boat'), startB = hB.startHud && hB.startHud.html.includes('start-boat');
  check('each client\'s readout shows its own boat\'s telemetry', hA.info.startsWith(telA) && hB.info.startsWith(telB) && telA !== telB);
  check('start panel and course progress are per own boat', seq && startA && startB && hA.info.includes('Start: ') && /Next|Mark|mark/.test(hA.info));
  const hS = hudFromState(A.lastFrame.state.hud);
  check('without an own boat the readout is the scenario\'s (as local mode)', hS.info.startsWith(telemetryHtmlOf(telemetryState(core.sim.players[core.sim.players.length - 1].telemetry))) || !hS.info.startsWith(telA));
  A.terminate(); B.terminate();
  await srv.close();
}

console.log = quiet;
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all multiplayer checks passed');
process.exit(0);
