// Room seed determinism: the drawn wind_schedule_seed (_windSeed) drives
// wind-schedule streams and the gust PRNG. Same seed → same race. On config
// apply and on restart the seed is posted as a system chat line through the
// same _chatSystem / _chatPush path as join/leave and penalty lines (PR #223),
// including race-time `rc` when a start sequence is running.
import './dom-stub.mjs';
import { Room } from '../apps/server/room.js';
import { parseAndValidateRoomConfig, ROOM_CONFIG_BASE } from '../src/room-config.js';
import { parseServerMessage } from '../src/wire-codec.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const mute = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };

const toml = (seed, extra = '') => `scenario = 0
map_width_m = 100
map_height_m = 200
wind_angle_deg = 90
wind_speed_mps = 4.5
gusts = true
gust_rate_per_min = 30
gust_force_gain = [0.0005, 0.0002]
gust_along_sigma_m = [10, 5]
gust_cross_sigma_m = [10, 5]
gust_life_s = [10, 3]
gust_dir_deg = [0, 45]
gust_ramp_s = 1.5
wind_schedule = true
wind_schedule_seed = [${seed}, 0]
${extra}`;

const runSeries = (seed, ticks = 90) => {
  const room = new Room('det-' + seed + '-' + Math.random(), { lockstep: true, graceMs: 0 });
  const client = { send() {} };
  room.join(client);
  mute(() => room.message(client, { type: 'init', opts: { mapW: 100, mapH: 200, simRes: '2f', scenario: 0 } }));
  mute(() => room.applyTomlConfig(toml(seed)));
  const gusts = [];
  const wind = [];
  for (let i = 0; i < ticks; i++) {
    mute(() => room.step({ dt: 1 / 30, held: [], present: true, view: {} }));
    const g = room.core.sim.gusts;
    gusts.push(g.columns.map((c) => [c.x, c.y, c.dirDeg, c.forceGain, c.alongSigmaM, c.crossSigmaM, c.lifeS]));
    wind.push([room.core.map.wind_direction, room.core.map.wind_speed, room.core.sim.windClock]);
  }
  const snap = {
    seed: room.core.sim.windSchedule.seed,
    gustSeed: room.core.sim.gusts.spawner.seed,
    windTerms: room.core.sim.windRealised.terms.map((t) => [t.target, t.amp, t.freq_hz]),
    windPhases: [...room.core.sim.windRealised.phases],
    gusts,
    wind,
  };
  room.leave(client);
  return snap;
};

{
  const a = runSeries(42), b = runSeries(42), c = runSeries(99);
  check('same room seed → same wind-schedule seed and gust spawner seed', a.seed === 42 && a.gustSeed === 42 && b.gustSeed === 42 && c.seed === 99 && c.gustSeed === 99);
  check('same room seed → identical wind terms, phases and applied wind series', JSON.stringify(a.windTerms) === JSON.stringify(b.windTerms)
    && JSON.stringify(a.windPhases) === JSON.stringify(b.windPhases)
    && JSON.stringify(a.wind) === JSON.stringify(b.wind));
  check('same room seed → identical gust column series', JSON.stringify(a.gusts) === JSON.stringify(b.gusts));
  check('different room seed → different gusts or wind', JSON.stringify(a.gusts) !== JSON.stringify(c.gusts)
    || JSON.stringify(a.wind) !== JSON.stringify(c.wind));
}

{
  const room = new Room('chat-seed', { lockstep: true, graceMs: 0 });
  const got = [];
  const client = { send(s) { got.push(parseServerMessage(s)); } };
  room.join(client);
  mute(() => room.message(client, { type: 'init', opts: { mapW: 100, mapH: 200, simRes: '2f', scenario: 0 } }));
  got.length = 0;
  mute(() => room.applyTomlConfig(toml(77)));
  const sys = got.filter((m) => m.type === 'event' && m.ev && m.ev.type === 'chat').map((m) => m.ev.msg);
  const seedLine = sys.find((m) => m.sys && /^Room seed 77$/.test(m.text));
  check('config apply: Room seed posted as sys chat via _chatSystem/_chatPush', !!seedLine && seedLine.sys === true && Number.isInteger(seedLine.seq) && Number.isInteger(seedLine.tick),
    JSON.stringify(sys.map((m) => m.text)));
  check('gust spawner seed equals drawn room seed (not room-name hash)', room.core.sim.gusts.spawner.seed === 77
    && room.core.sim.windSchedule.seed === 77);

  // Bare restart: one more system line, gusts reseeded from the same seed.
  for (let i = 0; i < 60; i++) mute(() => room.step({ dt: 1 / 30, held: [], present: true, view: {} }));
  const beforeCols = room.core.sim.gusts.columns.length;
  got.length = 0;
  mute(() => room.message(client, { type: 'command', id: 9, c: { type: 'restart', scenario: 0 } }));
  const after = got.filter((m) => m.type === 'event' && m.ev && m.ev.type === 'chat').map((m) => m.ev.msg);
  const restartLine = after.find((m) => m.sys && /^Room seed 77$/.test(m.text));
  check('bare restart: Room seed posted again as sys chat (same path as penalties)', !!restartLine && restartLine.sys === true, JSON.stringify(after.map((m) => m.text)));
  check('bare restart: gust PRNG reseeded from room seed, columns cleared', room.core.sim.gusts.spawner.seed === 77
    && room.core.sim.gusts.columns.length === 0 && beforeCols >= 0);

  // Same _chatPush path as penalties (PR #223): when a start sequence clock
  // is live, the system line carries race-time `rc`. A bare restart clears the
  // sequence first, so that announcement usually has wall-clock time until the
  // new start; posting while the clock is live proves the stamp.
  room.core.sim.startSequence = { clock: -12.5 };
  got.length = 0;
  room._chatRoomSeed(room.windSeed());
  const withRc = got.map((m) => m.ev && m.ev.msg).find((m) => m && m.sys && /Room seed 77/.test(m.text));
  check('seed system line carries race-time rc when startSequence.clock is set (PR #223 path)', withRc && withRc.rc === -12.5, JSON.stringify(withRc));

  // Config apply that includes a restart posts the seed only once.
  got.length = 0;
  mute(() => room.applyTomlConfig(toml(77)));
  const applyLines = got.filter((m) => m.type === 'event' && m.ev && m.ev.type === 'chat' && m.ev.msg.sys && /Room seed 77/.test(m.ev.msg.text));
  check('config apply with restart: seed announced once (not doubled)', applyLines.length === 1, String(applyLines.length));

  room.leave(client);
}

{
  // Host / commandsFromConfig path: gusts command carries _windSeed.
  const cfg = parseAndValidateRoomConfig(toml(55)).config;
  check('validated config: _windSeed 55 and gustSpawner seed 55', cfg._windSeed === 55);
  const { commandsFromConfig, gustSpawnerFromConfig } = await import('../src/room-config.js');
  const sp = gustSpawnerFromConfig(cfg);
  check('gustSpawnerFromConfig includes room seed', sp.seed === 55);
  const cmds = commandsFromConfig(cfg);
  const g = cmds.find((c) => c.type === 'gusts');
  check('commandsFromConfig gusts command carries the room seed', g && g.seed === 55, JSON.stringify(g && g.seed));
  // Changing only the seed still emits a gusts reseed.
  const cfg2 = parseAndValidateRoomConfig(toml(56)).config;
  const cmds2 = commandsFromConfig(cfg2, cfg);
  check('seed change alone reseeds gusts', cmds2.some((c) => c.type === 'gusts' && c.seed === 56)
    && cmds2.some((c) => c.type === 'windSchedule' && c.seed === 56));
}

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all room seed checks passed');
