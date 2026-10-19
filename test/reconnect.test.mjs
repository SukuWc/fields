// Reconnect and keeping your boat (apps/server/room.js GRACE_MS,
// src/remote-host.js token / reconnect): a client that comes back with its
// token within the grace period gets the same boat back; after it the boat
// is gone; another token cannot take it; RemoteHost reconnects on its own
// after a drop; an empty room is kept for the grace period; the others see a
// countdown over an absent owner's boat (state.aw); default grace 10 s.
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/index.js';
import { RemoteHost } from '../src/remote-host.js';
import { buildScene } from '../src/scene-build.js';
import { GRACE_MS } from '../apps/server/room.js';

let failed = 0;
const quiet = console.log;
const check = (name, ok, extra = '') => { quiet((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
console.log = () => {};
console.warn = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { mapW: 100, mapH: 200, simRes: '4f' };
const tex = () => ({ image: { data: new Uint8Array(0) } });
const until = async (fn, ms = 4000) => { const t = Date.now(); while (!fn() && Date.now() - t < ms) await sleep(20); return fn(); };
const GRACE = 1500;
const srv = await startServer({ port: 0, fieldHz: 0, graceMs: GRACE });
const url = (r) => `ws://127.0.0.1:${srv.port}/?room=${r}`;
const connect = async (r, token, extra = {}) => { const h = new RemoteHost(url(r), { ...opts, scenario: 0 }, tex(), { WebSocketImpl: WebSocket, token, ...extra }); await h.ready; return h; };
const TA = 'token-aaaa-1111', TX = 'token-xxxx-9999';

// 1. Reload within the grace period: same boat, ownership, binding.
{
  const A = await connect('r1', TA);
  const room = srv.rooms.get('r1');
  const r = await A.command({ type: 'spawnBoat', name: 'Ann', color: 0x1e88e5 });
  await until(() => A.own.length === 1);
  A.terminate();
  await until(() => room.clients.size === 0);
  await sleep(300);
  const byId = (id) => room.core.sim.players.find((p) => p.spawnId === id);
  check('a disconnected client\'s boat stays during the grace period', !!byId(r.id) && room.parked.has(TA));
  // A different token cannot take it.
  const X = await connect('r1', TX);
  check('another token does not get the boat', X.own.length === 0 && X.bindings === 0);
  const t0 = byId(r.id).autopilot_heading_target;
  await X.command({ type: 'tack', boat: 0 });
  await X.command({ type: 'tack', boatId: r.id });
  check('…nor steer it', byId(r.id).autopilot_heading_target === t0);
  const A2 = await connect('r1', TA);
  check('reconnecting with the token within the grace period: the same boat id, owned, bound', A2.own.length === 1 && A2.own[0].id === r.id && A2.own[0].name === 'Ann' && A2.bindings === 1 && !room.parked.has(TA), JSON.stringify(A2.own));
  await A2.command({ type: 'tack', boat: 0 });
  check('and it steers it again', byId(r.id).autopilot_heading_target === -t0 && t0 !== 0);
  // 2. After the grace period the boat is removed.
  A2.terminate();
  await until(() => room.clients.size === 1);
  await sleep(GRACE + 400);
  check('after the grace period the boat is removed', !byId(r.id) && !room.parked.has(TA));
  const A3 = await connect('r1', TA);
  check('a late return gets no boat', A3.own.length === 0 && A3.bindings === 0);
  A3.terminate(); X.terminate();
  await sleep(100);
}

// 3. A restart while the owner is away keeps the boat for it.
{
  const A = await connect('r3', TA);
  const B = await connect('r3', TX);
  const room = srv.rooms.get('r3');
  await A.command({ type: 'spawnBoat', name: 'Ann', color: 0x43a047 });
  A.terminate();
  await until(() => room.clients.size === 1);
  await B.command({ type: 'restart', scenario: 1 });
  await until(() => room.core.sim.players.some((p) => p.spawnName === 'Ann'));
  const ann = room.core.sim.players.find((p) => p.spawnName === 'Ann');
  const A2 = await connect('r3', TA);
  check('a restart during the grace period re-spawns the absent owner\'s boat, and it gets it back', ann && ann.spawnColor === 0x43a047 && A2.own.length === 1 && A2.own[0].id === ann.spawnId);
  A2.terminate(); B.terminate();
  await sleep(100);
}

// 4. Auto-reconnect after a drop: status events, the same boat, frames again.
{
  const A = await connect('r4', TA, { reconnect: true, backoffMs: [200, 400] });
  const room = srv.rooms.get('r4');
  const r = await A.command({ type: 'spawnBoat', name: 'Ann' });
  await until(() => A.own.length === 1);
  const statuses = [];
  A.onStatus((s) => statuses.push(s.status));
  const own = [];
  A.on((e) => { if (e.type === 'ownBoats') own.push(e.boats); });
  // The server drops the socket (a network blip).
  for (const c of room.clients) c.terminate();
  await until(() => statuses.includes('connected'), 5000);
  const n0 = A.framesReceived;
  await sleep(500);
  check('RemoteHost reconnects by itself (reconnecting → connected)', statuses[0] === 'reconnecting' && statuses.includes('connected') && A.reconnects === 1, statuses.join(','));
  check('…gets its boat back from the welcome (ownBoats event, binding) and frames again', own.length && own.at(-1)[0].id === r.id && A.bindings === 1 && A.framesReceived > n0 + 5);
  const res = await A.command({ type: 'tack', boat: 0 });
  check('…and commands work after it', res === undefined || (res && !res.error));
  A.terminate();
  await sleep(100);
  check('terminate() does not reconnect', A.status !== 'connected' || A.ws.readyState >= 2);
}

// 5. An empty room is kept for the grace period, then dropped.
{
  const A = await connect('r5', TA);
  await A.command({ type: 'restart', scenario: 2 });
  A.terminate();
  await sleep(300);
  const kept = srv.rooms.has('r5') && srv.rooms.get('r5').core.sim.scenarioIndex === 2;
  const B = await connect('r5', TX);
  check('an empty room is kept during the grace period (a returning client finds it as it was)', kept && B.room.scenario.index === 2);
  B.terminate();
  await sleep(GRACE + 400);
  check('…and dropped after it', !srv.rooms.has('r5'));
}

// 6. No token: a disconnect removes the boat at once (as before).
{
  const A = await connect('r6', null);
  const room = srv.rooms.get('r6');
  const r = await A.command({ type: 'spawnBoat', name: 'NoTok' });
  A.terminate();
  await until(() => room.clients.size === 0);
  check('without a token the boat goes at once', !room.core.sim.players.some((p) => p.spawnId === r.id));
}

// 7. Countdown over an absent owner's boat (state.aw), seen by the others;
// cleared when the owner is back. Then the default grace period (10 s).
const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
const awayLabels = (f) => buildScene(f.state, f.statics, view).guides.filter((g) => g.type === 'label' && g.lines[0].id === 'away').map((g) => g.lines[0].text);
const awOf = (h, room, id) => { const f = h.lastFrame; const i = room.core.sim.players.findIndex((p) => p.spawnId === id); return f && f.state.aw && i >= 0 ? f.state.aw[i] : null; };
const tickFor = async (h, ms) => { const t = Date.now(); while (Date.now() - t < ms) { h.tick({ dt: 1 / 30, held: [], present: true, view }); await sleep(33); } };
{
  const srv2 = await startServer({ port: 0, fieldHz: 0 });
  const url2 = `ws://127.0.0.1:${srv2.port}/?room=cd`;
  const conn2 = async (token) => { const h = new RemoteHost(url2, { ...opts, scenario: 0 }, tex(), { WebSocketImpl: WebSocket, token }); await h.ready; return h; };
  check('default grace period is 10 s', GRACE_MS === 10000 && srv2.rooms.size === 0);
  const A = await conn2(TX);
  const room = srv2.rooms.get('cd');
  const B = await conn2(TA);
  const rb = await B.command({ type: 'spawnBoat', name: 'Bo' });
  await until(() => B.own.length === 1);
  await tickFor(A, 400);
  check('no countdown while the owner is connected', A.lastFrame && !A.lastFrame.state.aw && awayLabels(A.lastFrame).length === 0);
  B.terminate();
  await until(() => room.parked.has(TA));
  await tickFor(A, 500);
  const c0 = awOf(A, room, rb.id);
  const l0 = awayLabels(A.lastFrame);
  check('the state carries the countdown for the absent owner\'s boat (10 s)', c0 === 10 || c0 === 9, `aw ${JSON.stringify(A.lastFrame.state.aw)}`);
  check('…drawn as a label above that boat', l0.length === 1 && l0[0] === String(c0), JSON.stringify(l0));
  await tickFor(A, 2200);
  const c1 = awOf(A, room, rb.id);
  check('it counts down', Number.isInteger(c1) && c1 >= 6 && c1 <= c0 - 2, `${c0} → ${c1}`);
  const B2 = await conn2(TA);
  await tickFor(A, 400);
  check('it clears when the owner reconnects (same boat)', B2.own[0] && B2.own[0].id === rb.id && !A.lastFrame.state.aw && awayLabels(A.lastFrame).length === 0);
  B2.terminate();
  await until(() => room.parked.has(TA));
  const tDrop2 = Date.now();
  await tickFor(A, 9000);
  check('still there at 9 s', room.core.sim.players.some((p) => p.spawnId === rb.id) && awOf(A, room, rb.id) >= 1, `aw ${awOf(A, room, rb.id)}`);
  await until(() => !room.core.sim.players.some((p) => p.spawnId === rb.id), 3000);
  const gone = Date.now() - tDrop2;
  await tickFor(A, 300);
  check('removed after 10 s by default (and the countdown with it)', !room.core.sim.players.some((p) => p.spawnId === rb.id) && gone >= 9900 && gone < 11500 && !A.lastFrame.state.aw, `${gone} ms`);
  A.terminate();
  await srv2.close();
}

await srv.close();
console.log = quiet;
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all reconnect checks passed');
process.exit(0);
