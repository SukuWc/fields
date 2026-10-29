// Room chat (apps/server/room.js _chat; src/remote-host.js sendChat):
// validation (trim, control characters, length cap, empty refused), rate
// limit, broadcast with the sender's name / boat id / number / colour and
// the tick, system lines for boats joining and leaving, history (last
// CHAT_HISTORY) in the welcome, and a real RemoteHost round trip.
import { WebSocket } from 'ws';
import { Room, CHAT_MAX_LEN, CHAT_HISTORY, CHAT_RATE_N, CHAT_RATE_MS } from '../apps/server/room.js';
import { startServer } from '../apps/server/index.js';
import { RemoteHost } from '../src/remote-host.js';
import { parseServerMessage } from '../src/wire-codec.js';

let failed = 0;
const quiet = console.log;
const check = (name, ok, extra = '') => { quiet((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
console.log = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let T = 0;
const room = new Room('chat', { lockstep: true, fieldHz: 0, now: () => T, graceMs: 0 });
const client = () => { const c = { got: [], send(s) { c.got.push(parseServerMessage(s)); } }; room.join(c); return c; };
const chats = (c) => c.got.filter((m) => m.type === 'event' && m.ev.type === 'chat').map((m) => m.ev.msg);
const result = (c) => c.got.filter((m) => m.type === 'result').pop().r;
const say = (c, text) => { room.message(c, { type: 'chat', id: 1, text }); return result(c); };

const A = client();
room.message(A, { type: 'init', opts: { mapW: 50, mapH: 100, simRes: '2f', scenario: 0 } });
const B = client();
room.message(B, { type: 'init', opts: {} });
room.step({ dt: 1 / 30, held: [], present: true, view: {} });
room.message(A, { type: 'command', id: 2, c: { type: 'spawnBoat', name: 'Ann', color: 0x123456 } });
room.step({ dt: 1 / 30, held: [], present: true, view: {} });

// Validation.
check('empty and whitespace refused', !!say(A, '').error && !!say(A, '   \n\t ').error && !!say(A, 42).error);
const r1 = say(A, '  hello <b>there</b>\u0007  ');
const m1 = chats(B).pop();
check('accepted: trimmed, control characters dropped, HTML kept as text', r1.ok && m1.text === 'hello <b>there</b>', JSON.stringify(m1 && m1.text));
check('stamped with name, boat id, boat number, colour and tick', m1.from.name === 'Ann' && typeof m1.from.boatId === 'string' && Number.isInteger(m1.from.n) && m1.from.color === 0x123456 && m1.tick === room.ticks && m1.seq > 0, JSON.stringify(m1.from));
check('broadcast to everyone in the room (sender too)', chats(A).some((m) => m.seq === m1.seq) && chats(B).some((m) => m.seq === m1.seq));
const long = say(B, 'x'.repeat(500));
check(`cut to ${CHAT_MAX_LEN} characters`, long.ok && chats(A).pop().text.length === CHAT_MAX_LEN);
check('a client without a boat chats as spectator', chats(A).pop().from.name === 'spectator' && chats(A).at(-1).from.boatId === null);
check('system line when a boat joins', room.chat.some((m) => m.sys && /Ann joined \(boat \d+\)/.test(m.text)));

// Rate limit (B sent 1 so far).
T = 100000;
let ok = 0, refused = null;
for (let k = 0; k < CHAT_RATE_N + 2; k++) { const r = say(A, 'spam ' + k); if (r.ok) ok++; else refused = refused || r.error; }
check(`rate limit: ${CHAT_RATE_N} per ${CHAT_RATE_MS / 1000} s, then refused`, ok === CHAT_RATE_N && /slow down/.test(refused || ''), `${ok} ok, "${refused}"`);
T += CHAT_RATE_MS + 1;
check('rate limit: allowed again after the window', !!say(A, 'back').ok);

// History cap and welcome.
for (let k = 0; k < CHAT_HISTORY + 10; k++) { T += CHAT_RATE_MS; say(B, 'h' + k); }
check(`history keeps the last ${CHAT_HISTORY}`, room.chat.length === CHAT_HISTORY && room.chat.at(-1).text === 'h' + (CHAT_HISTORY + 9));
const C = client();
room.message(C, { type: 'init', opts: {} });
const w = C.got.find((m) => m.type === 'welcome');
check('a joiner gets the history in its welcome', w && Array.isArray(w.chat) && w.chat.length === CHAT_HISTORY && w.chat.at(-1).seq === room.chat.at(-1).seq);

// Removal and leave.
const own = A.got.filter((m) => m.type === 'event' && m.ev.type === 'ownBoats').pop().ev.boats[0];
room.message(A, { type: 'command', id: 3, c: { type: 'removeBoat', id: own.id } });
check('system line when a boat is removed', /Ann left \(boat \d+\)/.test(chats(C).pop().text) && chats(C).at(-1).sys === true);
room.message(B, { type: 'command', id: 4, c: { type: 'spawnBoat', name: 'Bob' } });
room.step({ dt: 1 / 30, held: [], present: true, view: {} });
room.leave(B);
check('system line when a client with a boat leaves', /Bob left/.test(chats(C).pop().text));

// Real socket: two RemoteHosts.
{
  const srv = await startServer({ port: 0, fieldHz: 0 });
  const url = `ws://127.0.0.1:${srv.port}/?room=chat2`;
  const opts = { mapW: 50, mapH: 100, simRes: '2f' };
  const H1 = new RemoteHost(url, opts, null, { WebSocketImpl: WebSocket });
  await H1.ready;
  await H1.command({ type: 'restart', scenario: 0 });
  await H1.command({ type: 'spawnBoat', name: 'Uno' });
  const H2 = new RemoteHost(url, opts, null, { WebSocketImpl: WebSocket });
  await H2.ready;
  const seen = [];
  H2.on((ev) => { if (ev.type === 'chat') seen.push(ev.msg); });
  const r = await H1.sendChat('ahoy');
  for (let k = 0; k < 50 && !seen.some((m) => m.text === 'ahoy'); k++) await sleep(20);
  const got = seen.find((m) => m.text === 'ahoy');
  check('RemoteHost: sendChat resolves ok and the other client gets it', r.ok && got && got.from.name === 'Uno', JSON.stringify(got && got.from));
  const H3 = new RemoteHost(url, opts, null, { WebSocketImpl: WebSocket });
  await H3.ready;
  check('RemoteHost: a joiner starts with the history', H3.chat.some((m) => m.text === 'ahoy') && H3.chat.some((m) => m.sys));
  const bad = await H2.sendChat('   ');
  check('RemoteHost: refusals come back as { error }', !!bad.error);
  H1.terminate(); H2.terminate(); H3.terminate();
  await srv.close();
}

console.log = quiet;
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all chat checks passed');
process.exit(0);
