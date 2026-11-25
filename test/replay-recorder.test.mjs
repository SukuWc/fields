// In-memory race replays (apps/server/replays.js, Room._endRace): a short
// race is recorded, the list keeps the last three (oldest dropped), and
// re-running a record's command log on a fresh SimCore reproduces its state
// hashes and finish results.
import './dom-stub.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../apps/server/room.js';
import { listReplays } from '../apps/server/replays.js';
import { getReplay } from '../apps/server/replays.js';
import { clearReplays } from '../apps/server/replays.js';
import { resimulate } from '../apps/server/replays.js';
import { REPLAY_KEEP } from '../apps/server/replays.js';
import { REPLAY_HASH_EVERY } from '../apps/server/replays.js';
import { saveReplay } from '../apps/server/replays.js';
import { recordBytes } from '../apps/server/replays.js';
import { startServer } from '../apps/server/index.js';
import { parseServerMessage } from '../src/wire-codec.js';

const mute = (f) => { const l = console.log; const i = console.info; console.log = () => {}; console.info = () => {}; try { return f(); } finally { console.log = l; console.info = i; } };

const RACE_S = 4;
const TOML = `scenario = 0\ngusts = true\ngust_rate_per_min = 30\nwind_schedule_seed = [7, 0]\nrace_time_limit_s = ${RACE_S}\n`;

// join() starts the room clock again; the tests tick by hand.
const mkClient = (room) => {
  const got = [];
  const c = { got, send(s) { got.push(parseServerMessage(s)); } };
  room.join(c);
  room.stop();
  return c;
};
const closeRoom = (room) => { for (const c of [...room.clients]) room.leave(c); room.stop(); };
const send = (room, c, m) => mute(() => room.message(c, m));
const cmd = (room, c, command) => send(room, c, { type: 'command', id: 1, c: command });
// Server clock without timers: Room.step() builds the tick from the inputs.
const tick = (room, n = 1) => { for (let i = 0; i < n; i++) mute(() => room.step()); };

function mkRoom(name) {
  const room = new Room(name, { graceMs: 0 });
  const a = mkClient(room);
  send(room, a, { type: 'init', opts: { mapW: 100, mapH: 200, simRes: '2f' } });
  room.stop();
  mute(() => room.applyTomlConfig(TOML));
  return { room, a };
}

// One race: two players, helm / autopilot / tack / Dev gains, a leave, until
// the time limit starts the next race.
function race(room, a, b, k) {
  cmd(room, a, { type: 'spawnBoat', name: 'Ann' });
  cmd(room, b, { type: 'spawnBoat', name: 'Bo' + k });
  cmd(room, a, { type: 'autopilotGains', kp: 1.2, ki: 0.05, kd: 0.4, rudderMax: 30 });
  tick(room, 10);
  send(room, a, { type: 'input', held: [{ type: 'helm', dir: 1 }] });
  tick(room, 8);
  send(room, a, { type: 'input', held: [] });
  send(room, b, { type: 'input', held: [{ type: 'headingTarget', dir: -1 }] });
  tick(room, 6);
  send(room, b, { type: 'input', held: [] });
  cmd(room, b, { type: 'tack' });
  tick(room, 15);
  cmd(room, a, { type: 'autopilot' });
  cmd(room, b, { type: 'penaltyTurn', dir: 'cw' });
  tick(room, 20);
  const newest = () => (listReplays()[0] || {}).id;
  const before = newest();
  for (let i = 0; i < 30 * (RACE_S + 2) && newest() === before; i++) tick(room);
}

test('a race is recorded, listed, fetched and replays to the same hashes and results', (t) => {
  clearReplays();
  const { room, a } = mkRoom('rec');
  t.after(() => closeRoom(room));
  const b = mkClient(room);
  send(room, b, { type: 'init', opts: {} });
  race(room, a, b, 1);
  const list = listReplays();
  assert.equal(list.length, 1);
  const s = list[0];
  assert.equal(s.room, 'rec');
  assert.equal(s.endReason, 'timeLimit');
  assert.deepEqual(s.players, ['Ann', 'Bo1']);
  assert.ok(typeof s.buildVersion === 'string' && s.buildVersion.length > 0);
  assert.ok(s.durationS >= RACE_S && s.ticks > 30 * RACE_S, JSON.stringify(s));
  assert.ok(!Number.isNaN(Date.parse(s.startedAt)));
  const rec = getReplay(s.id);
  assert.ok(rec);
  assert.equal(rec.seed.seed, 7);
  assert.match(rec.config, /race_time_limit_s = 4/);
  assert.equal(rec.hashes.length, Math.floor(rec.ticks / REPLAY_HASH_EVERY));
  const types = new Set(rec.log.filter((e) => e.c).map((e) => e.c.type));
  for (const t of ['windSchedule', 'restart', 'spawnBoat', 'autopilotGains', 'tack', 'autopilot', 'penaltyTurn']) assert.ok(types.has(t), t + ' in the log: ' + [...types]);
  assert.ok(rec.log.some((e) => e.held && e.held.length), 'held commands in the log');
  assert.equal(rec.inTickCommands, 0, 'every command lands between ticks');
  // The next race is running on a fresh core and is not listed yet.
  assert.notEqual(room.core, null);
  // Re-run from the JSON the endpoint sends.
  const again = resimulate(JSON.parse(JSON.stringify(rec)));
  assert.equal(again.firstMismatch, null, JSON.stringify(again.firstMismatch));
  assert.equal(again.hashes.length, rec.hashes.length);
  assert.equal(again.finalHash.all, rec.finalHash.all);
  assert.deepEqual(again.results, rec.results);
  assert.deepEqual(rec.results.boats.map((x) => x.name), ['Ann', 'Bo1']);
  // A changed log is caught at the first hash after the change.
  const bad = JSON.parse(JSON.stringify(rec));
  const i = bad.log.findIndex((e) => e.c && e.c.type === 'tack');
  bad.log[i] = { t: bad.log[i].t, c: { type: 'tack', boatId: 'b1' } };
  const off = resimulate(bad);
  assert.ok(off.firstMismatch && off.firstMismatch.t > bad.log[i].t, JSON.stringify(off.firstMismatch));
  room.leave(a);
  room.leave(b);
});

test('a race keeps its chat with race ticks, outside the sim log and hashes', (t) => {
  clearReplays();
  const { room, a } = mkRoom('chat');
  t.after(() => closeRoom(room));
  cmd(room, a, { type: 'spawnBoat', name: 'Ann' });
  tick(room, 10);
  send(room, a, { type: 'chat', id: 2, text: 'hello  ' });
  tick(room, 25);
  send(room, a, { type: 'chat', id: 3, text: 'GG' });
  tick(room, 5);
  mute(() => room.newRace('vote'));
  const s = listReplays()[0];
  const rec = getReplay(s.id);
  assert.ok(Array.isArray(rec.chat));
  const said = rec.chat.filter((m) => !m.sys);
  assert.deepEqual(said.map((m) => [m.t, m.text, m.from.name]), [[10, 'hello', 'Ann'], [35, 'GG', 'Ann']]);
  assert.ok(said.every((m) => Number.isFinite(m.seq) && Number.isFinite(m.at)));
  assert.ok(rec.chat.some((m) => m.sys && /Ann joined/.test(m.text)), JSON.stringify(rec.chat));
  assert.ok(rec.chat.every((m) => m.t >= 0 && m.t <= rec.ticks));
  // The next race starts with its own chat (its room seed line), not these.
  const next = room._recorder.chatLines;
  assert.ok(next.every((m) => m.t === 0 && m.sys), JSON.stringify(next));
  assert.ok(!rec.log.some((e) => e.c && e.c.type === 'chat'), 'chat is not in the sim log');
  // Chat does not change the replay: same hashes with the chat dropped.
  const again = resimulate({ ...JSON.parse(JSON.stringify(rec)), chat: undefined });
  assert.equal(again.firstMismatch, null, JSON.stringify(again.firstMismatch));
  assert.equal(again.finalHash.all, rec.finalHash.all);
  // The list carries the record's size (JSON bytes, chat included).
  assert.equal(s.bytes, recordBytes(rec));
  assert.equal(s.bytes, Buffer.byteLength(JSON.stringify(rec)));
  room.leave(a);
});

test('the list keeps the last three races, oldest dropped; empty races are not kept', (t) => {
  clearReplays();
  const { room, a } = mkRoom('ring');
  t.after(() => closeRoom(room));
  const b = mkClient(room);
  send(room, b, { type: 'init', opts: {} });
  const ids = [];
  for (let k = 1; k <= REPLAY_KEEP + 1; k++) {
    race(room, a, b, k);
    ids.push(listReplays()[0].id);
    // The kept boats come back on the new race's third tick; the players
    // then leave and join again with new names.
    tick(room, 4);
    for (const c of [a, b]) for (const own of [...(room.owned.get(c) || [])]) cmd(room, c, { type: 'removeBoat', id: own.id });
    tick(room, 1);
  }
  const list = listReplays();
  assert.equal(list.length, REPLAY_KEEP);
  assert.deepEqual(list.map((r) => r.id), ids.slice(1).reverse(), 'newest first, the first race evicted');
  assert.equal(getReplay(ids[0]), null);
  // Kept boats come back in the next race, so each race lists the last one's too.
  assert.deepEqual(list[0].players, ['Ann', 'Bo3', 'Bo4']);
  assert.deepEqual(list.map((r) => r.players.at(-1)), ['Bo4', 'Bo3', 'Bo2'], JSON.stringify(list.map((r) => r.players)));
  // A race nobody joined is not kept.
  room.leave(a);
  room.leave(b);
  assert.equal(listReplays().length, REPLAY_KEEP);
  const last = resimulate(getReplay(ids[3]));
  assert.equal(last.firstMismatch, null, JSON.stringify(last.firstMismatch));
});

test('GET /api/replays lists them, /api/replays/:id returns one', async (t) => {
  clearReplays();
  const srv = await mute(() => startServer({ port: 0, host: '127.0.0.1', fixedRooms: [] }));
  t.after(() => srv.close());
  const get = async (p) => { const r = await fetch(`http://127.0.0.1:${srv.port}${p}`); return { status: r.status, body: await r.json() }; };
  assert.deepEqual((await get('/api/replays')).body, []);
  for (let k = 1; k <= 4; k++) saveReplay({ id: 'r' + k, room: 'x', startedAt: 's', endedAt: 'e', durationS: k, ticks: 30 * k, players: ['P' + k], buildVersion: 'v', endReason: 'timeLimit', seed: null, log: [] });
  const list = await get('/api/replays');
  assert.deepEqual(list.body.map((r) => r.id), ['r4', 'r3', 'r2']);
  assert.equal(list.body[0].log, undefined, 'the list has no logs');
  const r3 = await fetch(`http://127.0.0.1:${srv.port}/api/replays/r3`);
  assert.equal(list.body[1].bytes, Buffer.byteLength(await r3.text()), 'bytes = size of the record response');
  const one = await get('/api/replays/r3');
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.log, []);
  assert.equal((await get('/api/replays/r1')).status, 404);
  clearReplays();
});
