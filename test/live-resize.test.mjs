// Live room resize (apps/server/room.js Room._resize): a config commit with
// new map_width_m / map_height_m rebuilds the server core at the new size,
// keeps clients connected, sends them the new dims ('info' → RemoteHost
// 'mapSize' event), respawns player boats, and frames keep flowing.
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/index.js';
import { RemoteHost } from '../src/remote-host.js';
import { parseServerMessage } from '../src/wire-codec.js';
import { Room } from '../apps/server/room.js';
import { configFromRoomState } from '../src/room-config.js';

let failed = 0;
const quiet = console.log;
const check = (name, ok, extra = '') => { quiet((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
console.log = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tex = () => ({ image: { data: new Uint8Array(0) } });
const opts = { mapW: 48, mapH: 60, simRes: '4f', scenario: 0 };
const spawned = (room) => room.core.sim.players.filter((p) => p.spawnId);

// 1. Lockstep Room: core dims, lattice, boats, refusals.
{
  const got = [];
  const A = { send(s) { got.push(parseServerMessage(s)); } };
  const room = new Room('resize-unit', { lockstep: true, fieldHz: 0, graceMs: 0 });
  room.join(A);
  room.message(A, { type: 'init', opts });
  const step = (n) => { for (let i = 0; i < n; i++) room.step({ dt: 1 / 30, held: [], present: true, view: {} }); };
  step(3);
  room.message(A, { type: 'command', id: 1, c: { type: 'spawnBoat', name: 'Ann', color: 0xd81b60 } });
  step(1);
  const oldCore = room.core;
  const cfg = configFromRoomState(room.core.roomState(), { mapW: 48, mapH: 60 });
  cfg.map_width_m = 80; cfg.map_height_m = 120;
  got.length = 0;
  room.message(A, { type: 'command', id: 2, c: { type: 'config', config: cfg } });
  const res = got.find((m) => m.type === 'result' && m.id === 2);
  check('config with a new size is accepted', res && !(res.r && res.r.error), res && res.r && res.r.error);
  check('core rebuilt at 80 x 120', room.core !== oldCore && room.core.map.width === 80 && room.core.map.height === 120, room.core.map.width + 'x' + room.core.map.height);
  const lat = room.core.lattice();
  check('lattice covers the new map', lat.w === 80 && lat.h === 120, JSON.stringify(lat));
  const info = got.find((m) => m.type === 'info');
  check('clients get info with the new dims', info && info.info.mapW === 80 && info.info.mapH === 120);
  check('room event follows', got.some((m) => m.type === 'event' && m.ev.type === 'room'));
  step(5);
  check('player boat respawned on the new core', spawned(room).length === 1 && room.owned.get(A).length === 1 && room.owned.get(A)[0].name === 'Ann',
    `spawned=${spawned(room).length} owned=${JSON.stringify(room.owned.get(A))}`);
  const b = spawned(room)[0];
  check('boat inside the new walls', b && Number.isFinite(b.x) && Math.abs(b.x) < 40 && Math.abs(b.y) < 60);
  check('room TOML reports the new size', /map_width_m = 80/.test(room.tomlConfig()) && /map_height_m = 120/.test(room.tomlConfig()));
  const bad = { ...cfg, map_width_m: 2000 };
  room.message(A, { type: 'command', id: 3, c: { type: 'config', config: bad } });
  const r3 = got.find((m) => m.type === 'result' && m.id === 3);
  check('over-limit size refused, core kept', r3 && r3.r && /map size/.test(r3.r.error) && room.core.map.width === 80, JSON.stringify(r3 && r3.r));
  const small = { ...cfg, scenario: 18, map_width_m: 60, map_height_m: 120 };
  room.message(A, { type: 'command', id: 4, c: { type: 'config', config: small } });
  const r4 = got.find((m) => m.type === 'result' && m.id === 4);
  check('scenario that does not fit the new size refused', r4 && r4.r && /does not fit/.test(r4.r.error) && room.core.map.width === 80);
  step(3);
  room.leave(A);
}

// 2. Real server, two RemoteHosts: both get the new dims, frames continue.
{
  const srv = await startServer({ port: 0, adminGate: false, fieldHz: 0 });
  const url = `ws://127.0.0.1:${srv.port}/?room=resize`;
  const A = new RemoteHost(url, opts, tex(), { WebSocketImpl: WebSocket });
  await A.ready;
  const B = new RemoteHost(url, opts, tex(), { WebSocketImpl: WebSocket });
  await B.ready;
  await B.command({ type: 'spawnBoat', name: 'Bo', color: 0x1e88e5 });
  const evA = [], evB = [];
  A.on((ev) => { if (ev.type === 'mapSize') evA.push(ev); });
  B.on((ev) => { if (ev.type === 'mapSize') evB.push(ev); });
  const cfg = configFromRoomState(A.room, { mapW: 48, mapH: 60 });
  cfg.map_width_m = 100; cfg.map_height_m = 200;
  const r = await A.command({ type: 'config', config: cfg });
  check('remote config resize result ok', r && !r.error, r && r.error);
  await sleep(300);
  check('both clients get a mapSize event', evA.length === 1 && evB.length === 1 && evB[0].mapW === 100 && evB[0].mapH === 200, JSON.stringify(evB.map((e) => [e.mapW, e.mapH])));
  check('host.info carries the new dims', A.info.mapW === 100 && B.info.mapH === 200);
  check('room lattice is the new size', B.room && B.room.lattice && B.room.lattice.w === 100 && B.room.lattice.h === 200, JSON.stringify(B.room && B.room.lattice));
  const before = B.framesReceived;
  await sleep(400);
  check('frames keep flowing after the resize', B.framesReceived > before, `${before} → ${B.framesReceived}`);
  const room = srv.rooms ? srv.rooms.get('resize') : null;
  if (room) check('server: B still owns one boat after the resize', [...room.owned.values()].flat().length === 1, JSON.stringify([...room.owned.values()]));
  check('B own list has its boat back', (B.own || []).length === 1, JSON.stringify(B.own));
  A.terminate(); B.terminate();
  await srv.close();
}

console.log = quiet;
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all live-resize checks passed');
process.exit(0);
