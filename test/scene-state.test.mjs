// Compact scene state (src/scene-state.js) and client-side geometry
// (src/scene-build.js):
//   1. Round trip: for several scenarios, the scene a remote client builds
//      from the server's rounded JSON (room.js roundJson) matches the scene
//      built from the exact local frame within 1e-3 (metres; colours, labels
//      and structure identical).
//   2. Size: a rounded scenario 0 frame (1 boat, 4f) stays small; the
//      geometry it replaces was ~40 KB.
//   3. Statics: a Room sends { type: 'statics' } to each client once, before
//      its first frame, again only when they change (restart, a new boat),
//      and to a late joiner before its first frame; frames never carry them.
//   4. buildScene is pure: the same state and statics build the same scene.
//   5. The readout / HUD panels the client writes from the server JSON read
//      exactly as the local ones (HUD values travel unrounded), and no state
//      carries prebuilt HTML or guide records.
import { SimCore } from '../src/host.js';
import { buildScene } from '../src/scene-build.js';
import { Room, roundJson } from '../apps/server/room.js';
import { sceneDiff } from './scene-diff.mjs';

let failed = 0;
function check(name, ok, info = '') {
  if (!ok) failed++;
  console.info(`${ok ? 'ok  ' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
}
const log = console.log;
const mute = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = log; } };
const opts = { mapW: 100, mapH: 200, simRes: '4f' };
const view = { camera_position_x: 0, camera_position_y: 0, camera_zoom: 20, show_forces: true, show_fields: false };

// 1. and 4.
const seen = new Set();
for (const [n, ticks] of [[0, 90], [11, 400], [15, 300], [19, 300], [17, 150], [18, 150]]) {
  const core = new SimCore({ ...opts, texture: undefined });
  // Pinned to the pre-#86 full refinement stack: at the 3-level / 3 m default
  // scenario 15's boats no longer reach the zone overlapped (no mark-room).
  core.command({ type: 'refine', maxLevel: null, boatRefineRadius: null });
  mute(() => core.command({ type: 'restart', scenario: n }));
  let max = 0, pure = true, statics = null, rstatics = null, guides = 0, hudSame = true, prebuilt = null;
  mute(() => {
    for (let t = 0; t < ticks; t++) {
      const held = n === 0 && t % 45 < 12 ? [{ type: 'helm', boat: 0, dir: 1 }] : [];
      const f = core.tick({ dt: 1 / 30, held, present: true, view });
      if (f.statics) { statics = f.statics; rstatics = JSON.parse(roundJson(f.statics)); }
      const r = JSON.parse(roundJson({ type: 'frame', frame: { ...f, statics: undefined } })).frame;
      for (const [k, v] of Object.entries(f.state)) if (v && (typeof v !== 'object' || Object.keys(v).length)) seen.add(k);
      const exact = buildScene(f.state, statics, view);
      const remote = buildScene(r.state, rstatics, view);
      max = Math.max(max, sceneDiff(exact, remote));
      if (JSON.stringify(exact.hud) !== JSON.stringify(remote.hud)) hudSame = false;
      // No ready-made text or geometry in the state: no HTML, no guide records.
      const js = JSON.stringify(f.state);
      if (!prebuilt && /<br>|<div|"type":"(guide|rule|label|force|abeam)"|"x1":/.test(js)) prebuilt = js.match(/.{0,60}(<br>|<div|"type":"\w+"|"x1":).{0,40}/)[0];
      if (t % 30 === 0 && sceneDiff(exact, buildScene(f.state, statics, view)) !== 0) pure = false;
      guides = exact.guides.length;
    }
  });
  check(`scenario ${n}: scene from the rounded server JSON matches the exact one`, max <= 1e-3, `max diff ${max.toExponential(2)}, ${guides} guides`);
  check(`scenario ${n}: buildScene is pure`, pure);
  check(`scenario ${n}: readout and HUD panels from the server JSON read exactly as local`, hudSame);
  check(`scenario ${n}: state carries no prebuilt text or geometry`, !prebuilt, prebuilt || '');
}

const want = ['hud', 'boats', 'mk', 'start', 'course', 'finish', 'pair', 'br', 'mr', 'mt', 'cf', 'pen', 'amr', 'bt'];
check('the round trip covered every kind of state', want.every((k) => seen.has(k)), 'missing: ' + want.filter((k) => !seen.has(k)).join(','));

// 2. Size, scenario 0, 1 boat.
{
  const core = new SimCore({ ...opts, texture: undefined });
  mute(() => core.command({ type: 'restart', scenario: 0 }));
  let sum = 0, n = 0, staticsBytes = 0;
  mute(() => {
    for (let t = 0; t < 90; t++) {
      const f = core.tick({ dt: 1 / 30, held: [], present: true, view: { ...view, show_forces: false } });
      if (f.statics) staticsBytes = roundJson(f.statics).length;
      if (t >= 30) { sum += roundJson({ type: 'frame', frame: { ...f, statics: undefined } }).length; n++; }
    }
  });
  const avg = Math.round(sum / n);
  check('scenario 0 (1 boat, 4f): a frame message is under 8 KB', avg < 8000, `avg ${avg} B/frame, statics ${staticsBytes} B once`);
}

// 3. Statics delivery through a Room (lockstep: client a drives the ticks).
{
  const room = new Room('statics-test', { lockstep: true, fieldHz: 0 });
  const mk = (name) => ({ name, got: [], send(s) { if (typeof s === 'string') this.got.push(JSON.parse(s)); } });
  const a = mk('a'), b = mk('b');
  const tick = () => room.message(a, { type: 'tick', req: { dt: 1 / 30, held: [], present: true, view } });
  const types = (c) => c.got.filter((m) => m.type === 'statics' || m.type === 'frame').map((m) => m.type[0]).join('');
  mute(() => {
    room.join(a); room.message(a, { type: 'init', opts });
    room.message(a, { type: 'command', id: 1, c: { type: 'restart', scenario: 0 } });
    for (let t = 0; t < 5; t++) tick();
  });
  check('room: statics once, before the first frame', types(a) === 'sfffff', types(a));
  check('room: frames carry state, not statics', a.got.filter((m) => m.type === 'frame').every((m) => m.frame.state && !m.frame.statics && !m.frame.guides && !m.frame.bodies));
  mute(() => { room.join(b); room.message(b, { type: 'init', opts }); for (let t = 0; t < 3; t++) tick(); });
  check('room: a late joiner gets the statics before its first frame', types(b) === 'sfff', types(b));
  check('room: the others do not get them again', types(a) === 'sffffffff', types(a));
  a.got.length = 0; b.got.length = 0;
  mute(() => { room.message(b, { type: 'command', id: 2, c: { type: 'spawnBoat', name: 'Bo' } }); tick(); tick(); });
  const st = b.got.find((m) => m.type === 'statics');
  check('room: a new boat resends the statics to everyone, once', types(a) === 'sff' && types(b) === 'sff' && st.statics.defs.some((d) => d.name === 'Bo'), types(a) + ' ' + types(b));
  const f = b.got.filter((m) => m.type === 'frame').pop().frame;
  check('room: the new boat is drawn with its name from state + statics', buildScene(f.state, st.statics, view).guides.some((g) => g.type === 'label' && g.lines[0].text === 'Bo'));
  a.got.length = 0; b.got.length = 0;
  mute(() => { room.message(a, { type: 'command', id: 3, c: { type: 'restart', scenario: 7 } }); tick(); });
  check('room: a restart resends the statics', types(a) === 'sf' && types(b) === 'sf', types(a) + ' ' + types(b));
  check('room: statics and frame bytes are counted', room.staticsBytesSent > 0 && room.frameBytesSent > 0 && room.lastFrameBytes > 0);
  room.stop();
}

if (failed) { console.error(`${failed} FAILED`); process.exit(1); }
console.info('all scene-state checks passed');
process.exit(0);
