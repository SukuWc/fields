// Vote to restart (Room._vote / _voteTick, hud.js restartVoteHtmlOf):
// racers (connected clients with a player boat) vote; the room starts a new
// race (new room seed) when every racer has voted; votes can be revoked,
// clear on every restart, and the total follows joins / leaves.
import './dom-stub.mjs';
import { Room } from '../apps/server/room.js';
import { restartVoteHtmlOf } from '../src/hud.js';
import { parseServerMessage } from '../src/wire-codec.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const mute = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };

const mkClient = (room, token) => {
  const got = [];
  const c = { got, send(s) { got.push(parseServerMessage(s)); } };
  room.join(c);
  mute(() => room.message(c, { type: 'init', ...(token ? { token } : {}), opts: { mapW: 100, mapH: 200, simRes: '2f', scenario: 0 } }));
  return c;
};
const results = (c) => c.got.filter((m) => m.type === 'result');
const lastResult = (c) => results(c).at(-1).r;
const vote = (room, c, on) => { mute(() => room.message(c, { type: 'vote', id: 7, on })); return lastResult(c); };
const spawn = (room, c, name) => mute(() => room.message(c, { type: 'command', id: 1, c: { type: 'spawnBoat', name } }));
const lastVote = (c) => c.got.filter((m) => m.type === 'event' && m.ev.type === 'restartVote').map((m) => m.ev).at(-1);
const chats = (c) => c.got.filter((m) => m.type === 'event' && m.ev.type === 'chat').map((m) => m.ev.msg.text);
const tick = (room, n = 1) => { for (let i = 0; i < n; i++) mute(() => room.step({ dt: 1 / 30, held: [], present: true, view: {} })); };
const mkRoom = (name, opts = {}) => {
  const room = new Room(name, { lockstep: true, graceMs: 0, ...opts });
  let races = 0;
  room.onNewRace = () => { races++; };
  return { room, races: () => races };
};

// Two racers and a spectator.
{
  const { room, races } = mkRoom('vote');
  const a = mkClient(room), b = mkClient(room), s = mkClient(room);
  mute(() => room.applyTomlConfig('scenario = 0\ngusts = false\nwind_schedule_seed = [1, 100]\n'));
  spawn(room, a, 'Ann'); spawn(room, b, 'Bo');
  tick(room, 2);
  check('2 racers, spectator not counted: 0/2', lastVote(a) && lastVote(a).cast === 0 && lastVote(a).total === 2 && lastVote(a).can && !lastVote(s).can, JSON.stringify(lastVote(s)));
  const rs = vote(room, s, true);
  check('spectator cannot vote', !!rs.error, JSON.stringify(rs));
  a.got.length = 0;
  const r1 = vote(room, a, true);
  check('Ann votes: 1/2', r1.ok && r1.cast === 1 && r1.total === 2 && lastVote(b).cast === 1 && lastVote(a).you && !lastVote(b).you, JSON.stringify(r1));
  check('chat: "Ann votes for a new race (1/2)"', chats(a).includes('Ann votes for a new race (1/2)'), JSON.stringify(chats(a)));
  check('the same vote again is a no-op', vote(room, a, true).cast === 1 && chats(a).length === 1);
  const r2 = vote(room, a, false);
  check('Ann revokes: 0/2 and a chat line', r2.cast === 0 && chats(a).includes('Ann withdrew the restart vote (0/2)'), JSON.stringify(chats(a)));
  vote(room, a, true);
  const seed0 = room.windSeed().seed;
  check('no new race before everyone voted', races() === 0);
  const r3 = vote(room, b, true);
  check('Bo votes too: vote passes, new race', races() === 1 && r3.ok, JSON.stringify(r3));
  const t = chats(a);
  check('chat: "Restart vote passed (2/2) · new race" then "Room seed N"', t.includes('Restart vote passed (2/2) · new race')
    && /^Room seed \d+$/.test(t.at(-1)), JSON.stringify(t.slice(-3)));
  check('votes clear after the restart: 0/2', r3.cast === 0 && r3.total === 2 && lastVote(a).cast === 0 && !lastVote(a).you, JSON.stringify(lastVote(a)) + ' seed ' + seed0 + '→' + room.windSeed().seed);
  tick(room, 3);
  check('racers kept their boats', room.core.sim.players.filter((x) => x.spawnId).length === 2 && lastVote(b).total === 2);
  // Voting during the respawn window still counts the racers.
  vote(room, a, true);
  check('after the new race Ann can vote again: 1/2', lastVote(b).cast === 1);
  // Any restart clears the votes (an admin scenario restart too).
  mute(() => room.message(a, { type: 'command', id: 2, c: { type: 'restart', scenario: 0 } }));
  tick(room, 1);
  check('a scenario restart clears the votes', lastVote(b).cast === 0 && lastVote(b).total === 2, JSON.stringify(lastVote(b)));
  // Leaving mid-vote: the total is recomputed and the vote can pass.
  vote(room, a, true);
  check('1/2 before Bo leaves', lastVote(a).cast === 1 && races() === 1);
  room.leave(b);
  tick(room, 1);
  check('Bo leaves: 1/1 passes → new race', races() === 2 && lastVote(a).total === 1 && lastVote(a).cast === 0, JSON.stringify(lastVote(a)));
  // A spectator who joins the race raises the total.
  spawn(room, s, 'Cy');
  tick(room, 2);
  check('spectator spawns: total 2, can vote', lastVote(a).total === 2 && lastVote(s).can);
  vote(room, s, true);
  mute(() => room.message(s, { type: 'command', id: 3, c: { type: 'removeBoat', id: room.owned.get(s)[0].id } }));
  tick(room, 1);
  check('Cy removes their boat: vote dropped, 0/1, no new race', lastVote(a).total === 1 && lastVote(a).cast === 0 && races() === 2 && !lastVote(s).can, JSON.stringify(lastVote(a)));
  room.leave(a); room.leave(s);
}

// Alone in the room: the vote is a restart button.
{
  const { room, races } = mkRoom('solo');
  const a = mkClient(room);
  mute(() => room.applyTomlConfig('scenario = 0\ngusts = false\nwind_schedule_seed = [42, 0]\n'));
  spawn(room, a, 'Ann');
  tick(room, 2);
  a.got.length = 0;
  const r = vote(room, a, true);
  check('alone: one vote starts a new race at once', races() === 1 && r.cast === 0 && r.total === 1, JSON.stringify(r));
  check('alone: "Restart vote · new race", "Room seed 42" (sd 0 keeps it)', JSON.stringify(chats(a)) === '["Restart vote · new race","Room seed 42"]', JSON.stringify(chats(a)));
  room.leave(a);
}

// An owner away in the grace period does not count.
{
  const { room, races } = mkRoom('grace', { graceMs: 60000 });
  const a = mkClient(room, 'tok-aaaaaaaaaaaaaaaa'), b = mkClient(room, 'tok-bbbbbbbbbbbbbbbb');
  spawn(room, a, 'Ann'); spawn(room, b, 'Bo');
  tick(room, 2);
  vote(room, a, true);
  room.leave(b);
  tick(room, 1);
  check('disconnected owner (boat kept) is not a voter: vote passes', races() === 1, `${races()}`);
  for (const e of room.parked.values()) clearTimeout(e.timer);
  room.leave(a);
  for (const e of room.parked.values()) clearTimeout(e.timer);
  if (room._emptyTimer) clearTimeout(room._emptyTimer);
}

// Race timer HTML.
{
  check('no state / nobody racing: nothing', restartVoteHtmlOf(null) === '' && restartVoteHtmlOf({ cast: 0, total: 0, you: false, can: false }) === '');
  const h = restartVoteHtmlOf({ cast: 1, total: 3, you: false, can: true });
  check('racer: "Vote restart" button and 1/3', /data-vote="1"/.test(h) && />Vote restart</.test(h) && />1\/3</.test(h), h);
  const y = restartVoteHtmlOf({ cast: 2, total: 3, you: true, can: true });
  check('voted: "Revoke restart vote"', /data-vote="0"/.test(y) && /Revoke restart vote/.test(y) && /aria-pressed="true"/.test(y), y);
  check('alone: "Restart race"', /Restart race/.test(restartVoteHtmlOf({ cast: 0, total: 1, you: false, can: true })));
  const sp = restartVoteHtmlOf({ cast: 1, total: 2, you: false, can: false });
  check('spectator: count only, no button', !/button/.test(sp) && /Restart votes/.test(sp), sp);
}

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all restart vote checks passed');
