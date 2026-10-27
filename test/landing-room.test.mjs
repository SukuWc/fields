// The persistent room and HTTP side of apps/server: fixed rooms exist from
// startup and survive the last disconnect (sim keeps ticking while empty),
// /api/rooms counts connected clients with CORS, other room names are
// refused, and staticDir is served on the WebSocket's port.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/index.js';
import { RemoteHost } from '../src/remote-host.js';

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const quiet = console.log;
console.log = (...a) => { if (typeof a[0] === 'string' && /^(PASS|FAIL)/.test(a[0])) quiet(...a); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { mapW: 100, mapH: 200, simRes: '4f' };
const tex = () => ({ image: { data: new Uint8Array(0) } });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sz-static-'));
fs.writeFileSync(path.join(dir, 'index.html'), '<h1>landing</h1>');
fs.mkdirSync(path.join(dir, 'play'));
fs.writeFileSync(path.join(dir, 'play', 'index.html'), '<h1>game</h1>');
fs.writeFileSync(path.join(dir, 'logo.svg'), '<svg/>');
fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ commit: 'abc1234', sha: 'abc1234deadbeef', url: 'https://github.com/SukuWc/fields/commit/abc1234deadbeef' }) + '\n');
fs.writeFileSync(path.join(os.tmpdir(), 'sz-secret.txt'), 'secret');

const srv = await startServer({ port: 0, fixedRooms: ['europe-1'], staticDir: dir, graceMs: 50 });
const base = `http://127.0.0.1:${srv.port}`;
const rooms = async () => { const r = await fetch(base + '/api/rooms'); return { cors: r.headers.get('access-control-allow-origin'), body: await r.json() }; };

let r = await rooms();
check('/api/rooms at startup: europe-1 with 0 players, CORS *', JSON.stringify(r.body) === '[{"id":"europe-1","players":0}]' && r.cors === '*', JSON.stringify(r.body));
const room = srv.rooms.get('europe-1');
check('europe-1 has its sim from startup, clock running', room && room.persistent && room.core && !!room.timer);
await sleep(200);
const ticksAtStart = room.ticks;
await sleep(250);
check('europe-1 ticks with 0 clients from startup', room.ticks > ticksAtStart && room.frameTimes.length > 0,
  `ticks ${ticksAtStart}→${room.ticks} samples ${room.frameTimes.length}`);

const a = new RemoteHost(`ws://127.0.0.1:${srv.port}/ws?room=europe-1`, opts, tex(), { WebSocketImpl: WebSocket });
const info = await a.ready;
check('a client joins europe-1', info.room === 'europe-1');
await a.command({ type: 'restart', scenario: 0 });
const b = new RemoteHost(`ws://127.0.0.1:${srv.port}/ws`, opts, tex(), { WebSocketImpl: WebSocket });
check('no ?room= joins the first fixed room', (await b.ready).room === 'europe-1');
r = await rooms();
check('/api/rooms counts 2 connected players', r.body[0].players === 2, JSON.stringify(r.body));
b.terminate();
await sleep(150);
check('count drops to 1 after a leave', (await rooms()).body[0].players === 1);
await sleep(500);
const ticks = room.ticks;
check('the room ticks while someone is in it', ticks > 5, 'ticks ' + ticks);
a.terminate();
await sleep(300);
r = await rooms();
check('after the last disconnect (and past graceMs) the room is still listed with 0', JSON.stringify(r.body) === '[{"id":"europe-1","players":0}]', JSON.stringify(r.body));
check('same Room and sim kept, clock still running', srv.rooms.get('europe-1') === room && room.core && !!room.timer && room.ticks >= ticks);
const ticksWhileEmpty = room.ticks;
const samplesWhileEmpty = room.frameTimes.length;
await sleep(300);
check('ticks and frame times grow while empty', room.ticks > ticksWhileEmpty && room.frameTimes.length > samplesWhileEmpty && !!room.timer,
  `ticks ${ticksWhileEmpty}→${room.ticks} samples ${samplesWhileEmpty}→${room.frameTimes.length}`);
const ticksBeforeRejoin = room.ticks;
const c = new RemoteHost(`ws://127.0.0.1:${srv.port}/ws?room=europe-1`, opts, tex(), { WebSocketImpl: WebSocket });
await c.ready;
await sleep(300);
check('rejoining finds the same already-running sim', srv.rooms.get('europe-1') === room && room.ticks > ticksBeforeRejoin && !!room.timer);
c.terminate();

const closed = await new Promise((res) => { const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws?room=mine`); ws.on('close', (code) => res(code)); ws.on('error', () => {}); });
check('other room names are refused (1008), no room created', closed === 1008 && srv.rooms.size === 1);

const get = async (p) => { const x = await fetch(base + p, { redirect: 'manual' }); return { s: x.status, t: x.headers.get('content-type') || '', l: x.headers.get('location'), b: await x.text() }; };
let g = await get('/');
check('static: / is the landing index.html', g.s === 200 && g.b.includes('landing') && g.t.startsWith('text/html'));
g = await get('/play/?room=europe-1');
check('static: /play/ is the game', g.s === 200 && g.b.includes('game'));
g = await get('/play');
check('static: /play redirects to /play/', g.s === 301 && g.l === '/play/');
g = await get('/logo.svg');
check('static: svg content type', g.s === 200 && g.t === 'image/svg+xml');
g = await get('/../sz-secret.txt');
const g2 = await get('/%2e%2e/sz-secret.txt');
check('static: no path traversal', g.s === 404 && g2.s === 404 && !g2.b.includes('secret'));
g = await get('/nope.js');
check('static: missing file 404', g.s === 404);
g = await get('/healthz');
check('/healthz ok', g.s === 200 && JSON.parse(g.b).ok === true);
g = await get('/api/version');
check('/api/version from version.json', g.s === 200 && JSON.parse(g.b).commit === 'abc1234' && JSON.parse(g.b).url === 'https://github.com/SukuWc/fields/commit/abc1234deadbeef');
g = await get('/api/status');
check('/api/status lists the room', g.s === 200 && JSON.parse(g.b).rooms[0].name === 'europe-1');
const o = await fetch(base + '/api/rooms', { method: 'OPTIONS' });
check('CORS preflight answers 204', o.status === 204 && o.headers.get('access-control-allow-origin') === '*');
await srv.close();

// Without fixedRooms / staticDir the old behaviour holds: / is the status, rooms open on demand.
const old = await startServer({ port: 0, graceMs: 0 });
const s = await (await fetch(`http://127.0.0.1:${old.port}/`)).json();
check('open rooms: / is the JSON status, no rooms yet', s.ok === true && s.rooms.length === 0);
await old.close();

fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(path.join(os.tmpdir(), 'sz-secret.txt'), { force: true });
if (failed) { quiet(failed + ' FAILED'); process.exit(1); }
quiet('all landing/room checks passed');
process.exit(0);
