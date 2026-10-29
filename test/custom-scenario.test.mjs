// Custom scenario from the room TOML (scenario = "custom" + [custom]):
// parse / validation errors, TOML round trip, the built statics, the
// statics sent to clients, and the server (Room) config path.
import { SimCore } from '../src/host.js';
import { Room, validateRoomCommand } from '../apps/server/room.js';
import {
  parseAndValidateRoomConfig, stringifyRoomConfig, configFromRoomState, commandsFromConfig,
  ROOM_CONFIG_DEFAULTS,
} from '../src/room-config.js';
import { Gate, PORT, STARBOARD } from '../src/course.js';
import { COMPRESSED_START_TIMINGS } from '../src/start.js';
import { DEFAULT_MARK_MASS, markMassForBoat } from '../src/mark.js';
import { sceneStatics } from '../src/scene-state.js';
import { EXAMPLE_CUSTOM_TOML } from './custom-scenario-example.mjs';

let failed = 0;
const say = console.log;
const check = (name, ok, extra = '') => { say((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
console.log = () => {};

const base = stringifyRoomConfig(ROOM_CONFIG_DEFAULTS).replace(/^scenario = 0$/m, 'scenario = "custom"');
const withCustom = (custom) => base + '\n' + custom;
const err = (text, checks = {}) => parseAndValidateRoomConfig(text, checks).error || '';

// 1. Parse + validate the example; round trip through stringify.
{
  const p = parseAndValidateRoomConfig(EXAMPLE_CUSTOM_TOML);
  check('example parses and validates', !p.error, p.error);
  const t = stringifyRoomConfig(p.config);
  check('legs are written inline', /legs = \[\n  \{ mark = "w1", round = "port" \},\n  \{ gate = \["g2w", "g2e"\] \},\n\]/.test(t), t);
  check('marks written as [x, y]', /\nrc = \[24, -70\]\n/.test(t));
  const p2 = parseAndValidateRoomConfig(t);
  check('stringified TOML validates again', !p2.error, p2.error);
  check('stringify is stable', stringifyRoomConfig(p2.config) === t);
  check('custom table round-trips', JSON.stringify(p2.config.custom) === JSON.stringify(p.config.custom));
  const cmds = commandsFromConfig(p.config);
  const rs = cmds[cmds.length - 1];
  check('restart command carries the layout', rs.type === 'restart' && rs.scenario === 'custom' && rs.layout && rs.layout.marks.length === 7, JSON.stringify(rs).slice(0, 120));
  // Timings table form.
  const tt = parseAndValidateRoomConfig(EXAMPLE_CUSTOM_TOML.replace('timings = "compressed"', 'timings = { warning = 90, prep = 60, one_minute = 20 }'));
  check('timings table validates', !tt.error, tt.error);
  check('timings table round-trips inline', /timings = \{ warning = 90, prep = 60, one_minute = 20 \}/.test(stringifyRoomConfig(tt.config)));
}

// 2. Validation errors name the TOML path / problem.
{
  const cases = [
    ['[custom] without scenario = "custom"', stringifyRoomConfig(ROOM_CONFIG_DEFAULTS) + '\n[custom]\ntitle = "x"\n', '[custom] needs scenario = "custom"'],
    ['scenario = "custom" without [custom]', base, 'needs a [custom] table'],
    ['bad scenario string', base.replace('"custom"', '"foo"'), 'or "custom"'],
    ['unknown key in custom', withCustom('[custom]\ncolour = 1\n'), 'unknown key(s) in [custom]: colour'],
    ['unknown key in start', withCustom('[custom.marks]\na = [0, -60]\nb = [10, -60]\n[custom.start]\ncommittee = "a"\npin = "b"\ngun = 1\n'), 'unknown key(s) in [custom.start]: gun'],
    ['mark not [x, y]', withCustom('[custom.marks]\na = [1]\n'), 'custom.marks.a must be [x, y]'],
    ['bad mark id', withCustom('[custom.marks]\nBig = [1, -60]\n'), 'mark id "Big"'],
    ['mark outside the room', withCustom('[custom.marks]\na = [60, 0]\n'), 'mark a (60, 0) is outside this 100 x 200 m room'],
    ['mark on the obstacle', withCustom('[custom.marks]\na = [0, 22]\n'), 'fixed obstacle at (0, 20)'],
    ['marks too close', withCustom('[custom.marks]\na = [0, -60]\nb = [1, -60]\n'), 'marks a and b are 1 m apart'],
    ['start references a missing mark', withCustom('[custom.marks]\na = [0, -60]\n[custom.start]\ncommittee = "a"\npin = "zz"\n'), 'custom.start.pin: no mark "zz"'],
    ['short start line', withCustom('[custom.marks]\na = [0, -60]\nb = [4, -60]\n[custom.start]\ncommittee = "a"\npin = "b"\n'), 'start line a–b is 4 m long (min 5 m)'],
    ['bad timings', withCustom('[custom.marks]\na = [0, -60]\nb = [10, -60]\n[custom.start]\ncommittee = "a"\npin = "b"\ntimings = { warning = 10, prep = 20, one_minute = 5 }\n'), 'custom.start.timings'],
    ['mark used twice', withCustom('[custom.marks]\na = [0, -60]\nb = [10, -60]\nc = [0, 60]\n[custom.start]\ncommittee = "a"\npin = "b"\n[custom.course]\nlegs = [{ mark = "c" }, { mark = "a" }]\n'), 'mark a is used twice'],
    ['narrow gate', withCustom('[custom.marks]\na = [0, -60]\nb = [4, -60]\nc = [0, 60]\n[custom.course]\nlegs = [{ mark = "c" }, { gate = ["a", "b"] }]\n'), 'gate a–b is 4 m wide (min 6 m)'],
    ['bad leg', withCustom('[custom.marks]\nc = [0, 60]\n[custom.course]\nlegs = [{ mark = "c", round = "left" }, { foo = 1 }]\n'), 'custom.course.legs[0].round must be "port" or "starboard"'],
    ['leg without mark or gate', withCustom('[custom.marks]\nc = [0, 60]\nd = [10, 60]\n[custom.course]\nlegs = [{ mark = "c" }, { foo = 1 }]\n'), 'custom.course.legs[1]'],
    ['one-leg looping course', withCustom('[custom.marks]\nc = [0, 60]\n[custom.course]\nlegs = [{ mark = "c" }]\n'), 'at least 2 legs'],
    ['finish on a looping course', withCustom('[custom.marks]\nc = [0, 60]\nd = [10, 60]\nf = [0, -60]\ng = [10, -60]\n[custom.course]\nlegs = [{ mark = "c" }, { mark = "d" }]\n[custom.finish]\ncommittee = "f"\npin = "g"\n'), 'custom.finish needs custom.course with a finite laps'],
    ['laps out of range', withCustom('[custom.marks]\nc = [0, 60]\nd = [10, 60]\n[custom.course]\nlaps = 50\nlegs = [{ mark = "c" }, { mark = "d" }]\n'), 'custom.course.laps must be an integer 1..20'],
    ['boundary zone too wide', withCustom('[custom.boundary]\nzone_m = 30\n'), 'custom.boundary.zone_m must be 2..20 m'],
    ['boundary y range', withCustom('[custom.boundary]\ny_min_m = 10\ny_max_m = -10\n'), 'y_min_m must be less than y_max_m'],
  ];
  for (const [name, text, want] of cases) {
    const e = err(text);
    check('error: ' + name, e.includes(want), JSON.stringify(e));
  }
  // The same layout is checked against the map it runs on.
  const small = EXAMPLE_CUSTOM_TOML.replace('map_width_m = 100', 'map_width_m = 50').replace('map_height_m = 200', 'map_height_m = 100');
  check('error: layout outside a smaller map', err(small).includes('outside this 50 x 100 m room'), err(small));
}

// 3. SimCore: built statics, settings round trip, statics sent to clients.
{
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f' });
  const p = parseAndValidateRoomConfig(EXAMPLE_CUSTOM_TOML, { core });
  check('validates against a core', !p.error, p.error);
  const r = core.command({ type: 'config', config: p.config });
  check('config returns the custom title', r && r.title === 'Windward-leeward, 2 laps', JSON.stringify(r));
  for (let i = 0; i < 3; i++) core.tick({ dt: 1 / 30, held: [], present: false, view: {} });
  const sim = core.sim;
  check('scenarioIndex is "custom"', sim.scenarioIndex === 'custom');
  check('7 marks at their anchors', sim.marks.length === 7 && sim.marks[0].anchor.x === 24 && sim.marks[0].anchor.y === -70);
  check('marks use DEFAULT_MARK_MASS', sim.marks.every((m) => m.mass === DEFAULT_MARK_MASS));
  const seq = sim.startSequence;
  check('start line committee rc / pin pin', seq && seq.line.committee === sim.marks[0] && seq.line.pin === sim.marks[1]);
  check('compressed timings + lead', seq && seq.timings.warning === COMPRESSED_START_TIMINGS.warning && seq.lead === 2);
  const c = sim.course;
  check('course: w1 then gate, 2 laps', c && c.marks.length === 2 && c.marks[0] === sim.marks[2] && c.marks[1] instanceof Gate && c.laps === 2);
  check('course sides port', c && c.sides[0] === PORT);
  check('course uses the start sequence', c && c.startSequence === seq);
  check('finish line fb / fp with results', c && c.finish && c.finish.committee === sim.marks[5] && !!sim.raceResults);
  const b = sim.boundary;
  check('boundary inset/zone/y range', b && b.x === 40 && b.zone === 15 && b.yMin === -90 && b.yMax === 90, JSON.stringify(b && { x: b.x, zone: b.zone, yMin: b.yMin, yMax: b.yMax }));
  const st = sceneStatics(sim, new Map());
  check('statics carry marks, start, course, finish, boundary with no boat', st.marks.length === 7 && !!st.start && !!st.course && !!st.finish && !!st.boundary, Object.keys(st).join(','));
  const rs = core.roomState();
  check('roomState index "custom" + title', rs.scenario.index === 'custom' && rs.scenario.title === 'Windward-leeward, 2 laps');
  const back = configFromRoomState(rs, { mapW: 100, mapH: 200 });
  check('configFromRoomState round-trips the layout', stringifyRoomConfig(back) === stringifyRoomConfig(p.config));
  // Boat spawns 12 m below the start line.
  const sp = core.command({ type: 'spawnBoat', name: 'Ann' });
  const boat = sim.players.find((x) => x.spawnId === sp.id);
  check('player boat spawns below the line', boat && Math.abs(boat.x - 8) < 1e-6 && Math.abs(boat.y + 82) < 1e-6, boat && boat.x + ',' + boat.y);
  // Bare restart reloads the same layout.
  core.command({ type: 'restart', scenario: 'custom' });
  core.tick({ dt: 1 / 30, held: [], present: false, view: {} });
  check('bare restart "custom" rebuilds', sim.marks.length === 7 && !!sim.course);
  // Back to a numbered scenario: custom state is cleared.
  const n = parseAndValidateRoomConfig(stringifyRoomConfig({ ...back, scenario: 0, custom: undefined }), { core });
  check('numbered config validates after custom', !n.error, n.error);
  core.command({ type: 'config', config: n.config });
  core.tick({ dt: 1 / 30, held: [], present: false, view: {} });
  check('numbered scenario 0 back, settings.custom dropped', sim.scenarioIndex === 0 && !('custom' in core.settings) && configFromRoomState(core.roomState(), { mapW: 100, mapH: 200 }).custom === undefined);
  // Starboard rounding.
  const sb = parseAndValidateRoomConfig(EXAMPLE_CUSTOM_TOML.replace('round = "port"', 'round = "starboard"'), { core });
  core.command({ type: 'config', config: sb.config });
  core.tick({ dt: 1 / 30, held: [], present: false, view: {} });
  check('starboard rounding side', sim.course.sides[0] === STARBOARD);
  // A real boat's mark mass matches the constant.
  const want = markMassForBoat(boat.physics_model);
  check('DEFAULT_MARK_MASS matches markMassForBoat', Math.abs(want - DEFAULT_MARK_MASS) / want < 0.01, want);
}

// 4. Server Room: config path keeps the player boat and loads the layout;
//    restart "custom"; a forged restart with a layout drops it.
{
  const client = () => { const c = { got: [], send(s) { c.got.push(JSON.parse(s)); } }; return c; };
  const step = (room, n = 1) => { for (let i = 0; i < n; i++) room.step({ dt: 1 / 30, held: [], present: true, view: {} }); };
  const room = new Room('custom-toml', { lockstep: true, fieldHz: 0, graceMs: 0 });
  const A = client();
  room.join(A);
  room.message(A, { type: 'init', opts: { mapW: 100, mapH: 200, simRes: '4f' } });
  room.message(A, { type: 'command', id: 1, c: { type: 'restart', scenario: 0 } });
  step(room, 3);
  check('no custom restart before a commit', !!validateRoomCommand({ type: 'restart', scenario: 'custom' }, room.core).error);
  room.message(A, { type: 'command', id: 2, c: { type: 'spawnBoat', name: 'Ann', color: 0xd81b60 } });
  step(room, 1);
  const p = parseAndValidateRoomConfig(EXAMPLE_CUSTOM_TOML);
  // Over the wire: JSON, as the page sends it.
  room.message(A, { type: 'command', id: 3, c: JSON.parse(JSON.stringify({ type: 'config', config: p.config })) });
  step(room, 5);
  const sim = room.core.sim;
  const reply = A.got.find((m) => m.type === 'result' && m.id === 3) || A.got.find((m) => m.id === 3);
  check('server config accepted', reply && !(reply.r && reply.r.error) && !reply.error, JSON.stringify(reply));
  check('server loaded the layout', sim.scenarioIndex === 'custom' && sim.marks.length === 7 && !!sim.course && !!sim.boundary);
  const own = room.owned.get(A) || [];
  const pb = sim.players.filter((b) => b.spawnId);
  check('player boat kept, one boat, below the line', own.length === 1 && pb.length === 1 && Math.abs(pb[0].y + 82) < 1, JSON.stringify(own) + ' y=' + (pb[0] && pb[0].y));
  const ev = [...A.got].reverse().find((m) => m.type === 'event' && m.ev && m.ev.type === 'room');
  check('room event carries scenario "custom" and settings.custom', ev && ev.ev.room.scenario.index === 'custom' && ev.ev.room.settings.custom && ev.ev.room.settings.custom.marks.rc[0] === 24);
  const cfgBack = configFromRoomState(ev.ev.room, { mapW: 100, mapH: 200 });
  check('page TOML from the room event round-trips', stringifyRoomConfig(cfgBack) === stringifyRoomConfig(p.config));
  // tomlConfig() / PUT path.
  if (typeof room.tomlConfig === 'function') check('room.tomlConfig() includes [custom]', /\[custom\.course\]/.test(room.tomlConfig()));
  if (typeof room.applyTomlConfig === 'function') {
    const r = room.applyTomlConfig(EXAMPLE_CUSTOM_TOML.replace('laps = 2', 'laps = 3'));
    step(room, 3);
    check('applyTomlConfig loads a changed layout', !(r && r.error) && sim.course && sim.course.laps === 3, JSON.stringify(r));
    const bad = room.applyTomlConfig(EXAMPLE_CUSTOM_TOML.replace('w1 = [8, 60]', 'w1 = [8, 600]'));
    check('applyTomlConfig refuses a bad layout', bad && bad.error && bad.error.includes('mark w1'), JSON.stringify(bad));
  }
  const v = validateRoomCommand({ type: 'restart', scenario: 'custom', layout: { marks: [] } }, room.core);
  check('restart "custom" validates, layout dropped', v.c && v.c.layout === undefined, JSON.stringify(v));
  check('map change refused on the server', !!validateRoomCommand({ type: 'config', config: parseAndValidateRoomConfig(EXAMPLE_CUSTOM_TOML.replace('map_width_m = 100', 'map_width_m = 200').replace('map_height_m = 200', 'map_height_m = 400')).config }, room.core).error);
}

console.log = say;
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('custom-scenario: all passed');
