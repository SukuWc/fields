// Race lifecycle (src/race-lifecycle.js, Sim raceLifecycle, Room.newRace):
// race time limit (race_time_limit_s, default 600 s) and finish countdown
// (finish_countdown_s, default 30 s) restart the room with a new room seed;
// chat lines go through Room._chatSystem; a bare Sim never restarts.
import './dom-stub.mjs';
import { RaceLifecycle, DEFAULT_RACE_LIFECYCLE, SIM_RACE_LIFECYCLE, validateRaceLifecycle } from '../src/race-lifecycle.js';
import {
  ROOM_CONFIG_DEFAULTS, parseAndValidateRoomConfig, stringifyRoomConfig, configFromRoomState, roomConfigErrorLine,
} from '../src/room-config.js';
import { SimCore } from '../src/host.js';
import { Room } from '../apps/server/room.js';
import { hudFromState } from '../src/hud.js';
import { parseServerMessage } from '../src/wire-codec.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const mute = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };

// 1. RaceLifecycle on its own.
{
  const racer = { spawnId: 'b1' }, bot = {};
  const finished = new Set();
  const results = { isFinished: (b) => finished.has(b) };
  const lc = new RaceLifecycle({ timeLimitS: 10, finishCountdownS: 3 });
  const seq = { clock: -5 };
  check('no racers (only scenario boats): never fires', lc.step(100, { startSeq: null, players: [bot], results }) === null && lc.elapsed === 0);
  check('prestart (clock < 0) does not count', lc.step(1, { startSeq: seq, players: [racer], results }) === null && lc.hud(seq) === null);
  seq.clock = 9.5;
  check('race time left on the gun clock', JSON.stringify(lc.hud(seq)) === '{"tl":0.5}', JSON.stringify(lc.hud(seq)));
  check('before the limit: nothing', lc.step(1 / 30, { startSeq: seq, players: [racer], results }) === null);
  seq.clock = 10;
  const ev = lc.step(1 / 30, { startSeq: seq, players: [racer], results });
  check('time limit reached → restart (timeLimit)', ev && ev.phase === 'restart' && ev.reason === 'timeLimit', JSON.stringify(ev));
  check('fires once until reset', lc.step(1 / 30, { startSeq: seq, players: [racer], results }) === null);
  lc.reset();
  seq.clock = 1;
  finished.add(racer);
  const c = lc.step(1 / 30, { startSeq: seq, players: [racer, bot], results });
  check('every racer finished (bots ignored) → countdown 3 s', c && c.phase === 'countdown' && c.s === 3, JSON.stringify(c));
  check('countdown in the HUD', lc.hud(seq).cd === 3);
  let out = null, n = 0;
  while (!out && n < 200) { out = lc.step(1 / 30, { startSeq: seq, players: [racer, bot], results }); n++; }
  check('after 3 s → restart (finished)', out && out.reason === 'finished' && Math.abs(n / 30 - 3) < 0.1, `${n} ticks`);
  const z = new RaceLifecycle({ timeLimitS: 0, finishCountdownS: 0 });
  const zz = z.step(1 / 30, { startSeq: null, players: [racer], results });
  check('finish_countdown_s = 0: restart at once; time limit 0 = off', zz && zz.reason === 'finished' && z.hud(null) === null, JSON.stringify(zz));
  const nolimit = new RaceLifecycle({ timeLimitS: 5, finishCountdownS: 30 });
  for (let i = 0; i < 30 * 4; i++) nolimit.step(1 / 30, { startSeq: null, players: [], results: null });
  check('no start sequence: race time counts only while a racer is on the water', nolimit.elapsed === 0);
  const bare = new RaceLifecycle(SIM_RACE_LIFECYCLE);
  check('bare Sim lifecycle is off', bare.step(1e6, { startSeq: null, players: [racer], results }) === null && bare.hud(null) === null);
  check('validation names the setting', /race_time_limit_s/.test(validateRaceLifecycle({ timeLimitS: -1 }).error)
    && /finish_countdown_s/.test(validateRaceLifecycle({ finishCountdownS: 'x' }).error));
}

// 2. Room config: defaults, TOML, validation.
{
  check('defaults: race_time_limit_s 600, finish_countdown_s 30', ROOM_CONFIG_DEFAULTS.race_time_limit_s === 600 && ROOM_CONFIG_DEFAULTS.finish_countdown_s === 30
    && DEFAULT_RACE_LIFECYCLE.timeLimitS === 600 && DEFAULT_RACE_LIFECYCLE.finishCountdownS === 30);
  const txt = stringifyRoomConfig(ROOM_CONFIG_DEFAULTS);
  check('TOML writes both keys', /\nrace_time_limit_s = 600\n/.test(txt) && /\nfinish_countdown_s = 30\n/.test(txt));
  const bad = 'race_time_limit_s = -5\n';
  const b = parseAndValidateRoomConfig(bad);
  check('bad value refused with its line', !!b.error && /race_time_limit_s/.test(b.error) && roomConfigErrorLine(bad, b) === 1, b.error);
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  check('bare SimCore: lifecycle off', core.sim.raceLifecycle.settings.enabled === false);
  const v = parseAndValidateRoomConfig('scenario = 0\nrace_time_limit_s = 120\nfinish_countdown_s = 5\n');
  mute(() => core.command({ type: 'config', config: v.config }));
  check('config sets the Sim lifecycle', core.sim.raceLifecycle.settings.enabled && core.sim.raceLifecycle.settings.timeLimitS === 120 && core.sim.raceLifecycle.settings.finishCountdownS === 5);
  const back = configFromRoomState(core.roomState(), { mapW: 100, mapH: 200 });
  check('room state → TOML round-trips both keys', back.race_time_limit_s === 120 && back.finish_countdown_s === 5);
}

// 3. Room: time limit → chat + new race with a new seed.
const mkRoom = (name) => {
  const room = new Room(name, { lockstep: true, graceMs: 0 });
  const got = [];
  const client = { got, send(s) { got.push(parseServerMessage(s)); } };
  room.join(client);
  mute(() => room.message(client, { type: 'init', opts: { mapW: 100, mapH: 200, simRes: '2f', scenario: 0 } }));
  return { room, client, got };
};
const chats = (got) => got.filter((m) => m.type === 'event' && m.ev && m.ev.type === 'chat').map((m) => m.ev.msg.text);
const tick = (room, n) => { for (let i = 0; i < n; i++) mute(() => room.step({ dt: 1 / 30, held: [], present: true, view: {} })); };
{
  const { room, client, got } = mkRoom('limit');
  mute(() => room.applyTomlConfig('scenario = 0\ngusts = false\nwind_schedule_seed = [1, 100]\nrace_time_limit_s = 2\n'));
  tick(room, 30 * 3);
  check('no player boat: the time limit does not run', !chats(got).some((t) => /Time limit/.test(t)));
  mute(() => room.message(client, { type: 'command', id: 1, c: { type: 'spawnBoat', name: 'Ann' } }));
  tick(room, 2);
  const seeds = new Set([room.core.sim.windSchedule.seed]);
  let races = 0;
  room.onNewRace = () => { races++; seeds.add(room.core.sim.windSchedule.seed); };
  got.length = 0;
  tick(room, 30 * 2 + 5);
  const t = chats(got);
  check('time limit: "Time limit reached · new race" then "Room seed N"', t.indexOf('Time limit reached · new race') >= 0
    && t.findIndex((x) => /^Room seed \d+$/.test(x)) > t.indexOf('Time limit reached · new race'), JSON.stringify(t));
  check('time limit: one new race, player boat kept', races === 1 && room.core.sim.players.some((b) => b.spawnName === 'Ann'), `${races}, ${room.core.sim.players.length}`);
  for (let i = 0; i < 6; i++) { tick(room, 30 * 2 + 5); }
  check('each time limit draws a new seed from [1, 100]', races === 7 && seeds.size > 3, [...seeds].join(','));
  const st = room.core.roomState().settings.raceLifecycle;
  check('new race keeps the room TOML (limit still 2 s)', st.timeLimitS === 2 && st.finishCountdownS === 30);
  room.leave(client);
}
{
  const { room, client, got } = mkRoom('pinned');
  mute(() => room.applyTomlConfig('scenario = 0\ngusts = false\nwind_schedule_seed = [42, 0]\nrace_time_limit_s = 1\n'));
  mute(() => room.message(client, { type: 'command', id: 1, c: { type: 'spawnBoat', name: 'Bo' } }));
  got.length = 0;
  tick(room, 30 * 1 + 5);
  check('sd 0: the new race keeps seed 42', room.core.sim.windSchedule.seed === 42 && chats(got).includes('Room seed 42'), JSON.stringify(chats(got)));
  room.leave(client);
}

// 4. Room: last racer finishes → countdown line, then a new race.
{
  const { room, client, got } = mkRoom('finish');
  mute(() => room.applyTomlConfig(stringifyRoomConfig({ ...ROOM_CONFIG_DEFAULTS, gusts: false, finish_countdown_s: 2 })));
  mute(() => room.message(client, { type: 'command', id: 1, c: { type: 'spawnBoat', name: 'Cy' } }));
  tick(room, 3);
  const sim = room.core.sim;
  const boat = sim.players.find((b) => b.spawnId);
  check('custom course has race results', !!sim.raceResults && !!boat);
  let races = 0;
  room.onNewRace = () => { races++; };
  got.length = 0;
  sim.raceResults.entries.push({ boat, elapsed: 1, corrected: 1, finishTime: 1, dsq: false, unserved: [] });
  tick(room, 2);
  const t = chats(got);
  check('all finished: "All finished · new race in 2 s"', t.includes('All finished · new race in 2 s'), JSON.stringify(t));
  const h = room.core.tick({ dt: 1 / 30, held: [], present: true, view: {} });
  const hud = hudFromState(h.state.hud, null, h.state.boats);
  check('start HUD shows the countdown', /New race in 0:0\d/.test(hud.startHud && hud.startHud.html), hud.startHud && hud.startHud.html);
  tick(room, 30 * 2 + 3);
  check('countdown over: "New race" + new race', races === 1 && chats(got).includes('New race') && chats(got).some((x) => /^Room seed \d+$/.test(x)), JSON.stringify(chats(got)));
  check('new race: results cleared, boat back', room.core.sim.raceResults && room.core.sim.raceResults.entries.length === 0);
  room.leave(client);
}

// 5. HUD: time left under the start clock.
{
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  mute(() => core.command({ type: 'config', config: parseAndValidateRoomConfig(stringifyRoomConfig({ ...ROOM_CONFIG_DEFAULTS, gusts: false })).config }));
  mute(() => core.command({ type: 'spawnBoat', name: 'D' }));
  mute(() => core.tick({ dt: 1 / 30, held: [], present: true, view: {} }));
  core.sim.startSequence.clock = 15;
  const f = mute(() => core.tick({ dt: 1 / 30, held: [], present: true, view: {} }));
  const hud = hudFromState(f.state.hud, null, f.state.boats);
  check('HUD: "Time left 9:45" after 15 s of racing', /Time left 9:45/.test(hud.startHud.html), hud.startHud.html);
}

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all race lifecycle checks passed');
