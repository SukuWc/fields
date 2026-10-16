// Player boats in a server room: two clients each spawn a boat, steer it
// independently (keys apply only to the own boat, never scenario boats),
// and a disconnect removes the client's boat. Plus the Sim commands
// spawnBoat / removeBoat on their own (local/worker modes are unchanged).
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/index.js';
import { RemoteHost } from '../src/remote-host.js';
import { LocalHost } from '../src/host.js';

let failed = 0;
const quiet = console.log;
const check = (name, ok, extra = '') => { quiet((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
console.log = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { mapW: 100, mapH: 200, simRes: '4f' };
const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
const tex = () => ({ image: { data: new Uint8Array(0) } });

// Sim commands in-process.
{
  const h = new LocalHost({ ...opts, texture: tex() });
  h.commandSync({ type: 'restart', scenario: 0 });
  for (let t = 0; t < 3; t++) h.tick({ dt: 1 / 30, held: [], present: true, view });
  const a = h.commandSync({ type: 'spawnBoat', name: 'Ann', color: 0xd81b60 });
  const b = h.commandSync({ type: 'spawnBoat', name: 'Bo' });
  const sim = h.core.sim;
  const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  check('spawnBoat adds boats with ids, clear of each other and boat 0',
    sim.players.length === 3 && a.id !== b.id && d(a, b) >= 9 && d(a, sim.players[0]) >= 9 && d(b, sim.players[0]) >= 9, JSON.stringify([a, b]));
  const f = h.tick({ dt: 1 / 30, held: [], present: true, view });
  check('frame lists spawned boats; name badges drawn', f.spawned.length === 2 && f.guides.some((g) => g.type === 'label' && g.lines[0].text === 'Ann'));
  check('own colour on the hull outline', sim.players[1].physics_model.render.stroke === 0xd81b60);
  check('removeBoat removes only that boat', h.commandSync({ type: 'removeBoat', id: a.id }) === true && sim.players.length === 2 && sim.players[1].spawnId === b.id);
  for (let t = 0; t < 30; t++) h.tick({ dt: 1 / 30, held: [], present: true, view });
  check('stepping after a removal is fine', Number.isFinite(sim.players[1].x));
  h.commandSync({ type: 'restart', scenario: 14 });
  for (let t = 0; t < 3; t++) h.tick({ dt: 1 / 30, held: [], present: true, view });
  const s = h.commandSync({ type: 'spawnBoat', name: 'S' });
  const line = sim.startSequence.line;
  const side = (s.x - line.mid.x) * line.nx + (s.y - line.mid.y) * line.ny;
  check('with a start line, spawn on the pre-start side near the line', side < 0 && side > -30, `side ${side.toFixed(1)}`);
}

// Server: two clients.
{
  const srv = await startServer({ port: 0, fieldHz: 0 });
  const url = `ws://127.0.0.1:${srv.port}/?room=own`;
  const A = new RemoteHost(url, opts, tex(), { WebSocketImpl: WebSocket });
  await A.ready;
  await A.command({ type: 'restart', scenario: 0 });
  const B = new RemoteHost(url, opts, tex(), { WebSocketImpl: WebSocket });
  await B.ready;
  const ownA = [], ownB = [];
  A.on((e) => { if (e.type === 'ownBoats') ownA.push(e.boats); });
  B.on((e) => { if (e.type === 'ownBoats') ownB.push(e.boats); });
  await sleep(300);
  const ra = await A.command({ type: 'spawnBoat', name: 'A' });
  const rb = await B.command({ type: 'spawnBoat', name: 'B' });
  await sleep(300);
  const pos = (h, id) => h.lastFrame.spawned.find((b) => b.id === id);
  check('each client spawns its own boat (server assigns ids)', ra.id && rb.id && ra.id !== rb.id && ownA.at(-1)[0].id === ra.id && ownB.at(-1)[0].id === rb.id);
  check('both clients see both spawned boats', A.lastFrame.spawned.length === 2 && B.lastFrame.spawned.length === 2);
  const ap = (h, name) => (h.lastFrame.hud.info.match(/Autopilot(\w+)/) || [])[1];
  // A tacks "boat 0" (its own boat) with a one-shot command: only A's
  // autopilot target flips sign.
  const core = srv.rooms.get('own').core;
  const byId = (id) => core.sim.players.find((p) => p.spawnId === id);
  const tgt = () => [byId(ra.id).autopilot_heading_target, byId(rb.id).autopilot_heading_target, core.sim.players[0].autopilot_heading_target];
  const t0 = tgt();
  await A.command({ type: 'tack', boat: 0 });
  const t1 = tgt();
  check('a one-shot command from A hits only A\'s boat', t1[0] === -t0[0] && t0[0] !== 0 && t1[1] === t0[1] && t1[2] === t0[2], JSON.stringify([t0, t1]));
  // A holds helm right, B holds helm left for 1.5 s.
  const h0A = byId(ra.id).physics_model.getAngle(), h0B = byId(rb.id).physics_model.getAngle(), h0S = core.sim.players[0].physics_model.getAngle();
  await B.command({ type: 'autopilot', boat: 0 });
  for (let i = 0; i < 45; i++) {
    A.tick({ dt: 1 / 30, held: [{ type: 'helm', boat: 0, dir: +1 }], present: true, view });
    B.tick({ dt: 1 / 30, held: [{ type: 'helm', boat: 0, dir: -1 }], present: true, view });
    await sleep(33);
  }
  const dA = byId(ra.id).physics_model.getAngle() - h0A, dB = byId(rb.id).physics_model.getAngle() - h0B;
  check('held helm steers each own boat independently (opposite turns)', Math.sign(dA) !== Math.sign(dB) && Math.abs(dA) > 0.1 && Math.abs(dB) > 0.1, `dA ${dA.toFixed(2)} dB ${dB.toFixed(2)}`);
  check('scenario boat 0 is not steered by players (still on autopilot)', core.sim.players[0].autopilot_enabled === true, `d0 ${(core.sim.players[0].physics_model.getAngle() - h0S).toFixed(2)}`);
  check('removeBoat of another client\'s boat is refused', (await A.command({ type: 'removeBoat', id: rb.id })) === false && !!byId(rb.id));
  B.terminate();
  for (let i = 0; i < 50 && byId(rb.id); i++) await sleep(100);
  await sleep(100);
  check('disconnect removes the client\'s boat', !byId(rb.id) && !!byId(ra.id) && A.lastFrame.spawned.length === 1);
  await A.command({ type: 'restart', scenario: 0 });
  await sleep(200);
  check('a room-wide restart clears player boats and ownership', !byId(ra.id) && ownA.at(-1).length === 0);
  A.terminate();
  await srv.close();
}

console.log = quiet;
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all own-boat checks passed');
process.exit(0);
