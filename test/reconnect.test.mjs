// Reconnect and keeping your boat (apps/server/room.js GRACE_MS,
// src/remote-host.js token / reconnect): a client that comes back with its
// token within the grace period gets the same boat back; after it the boat
// is gone; another token cannot take it; RemoteHost reconnects on its own
// after a drop; an empty room is kept for the grace period.
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

await srv.close();
console.log = quiet;
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all reconnect checks passed');
process.exit(0);
