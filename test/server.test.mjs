// The Node sim server (apps/server) and RemoteHost (src/remote-host.js):
// lockstep runs match LocalHost frame for frame; the authoritative 30 Hz
// mode ticks on its own, takes commands and held keys from clients, streams
// field grids to clients that show the field, and serves several clients from one room.
import { hudFromState } from '../src/hud.js';
import { buildScene } from '../src/scene-build.js';
import { sceneDiff, geom } from './scene-diff.mjs';
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/index.js';
import { RemoteHost } from '../src/remote-host.js';
import { LocalHost } from '../src/host.js';

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const quiet = console.log;
const mute = () => { console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('PASS')) quiet(...a); else if (typeof a[0] === 'string' && a[0].startsWith('FAIL')) quiet(...a); }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { mapW: 100, mapH: 200, simRes: '4f' };
const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
const tex = () => ({ image: { data: new Uint8Array(0) } });
const strip = (s) => s.replace(/Phys Time.*?<br>/g, '');
mute();

// 1. Lockstep: the client drives ticks, same frames as a LocalHost.
{
  const srv = await startServer({ port: 0, lockstep: true });
  let rh, info;
  // A fresh room per scenario: a room keeps its lattice across restarts, as
  // a page does, and the reference is a fresh LocalHost.
  for (const n of [0, 7, 11]) {
    rh = new RemoteHost(`ws://127.0.0.1:${srv.port}/?room=t1-${n}`, opts, tex(), { WebSocketImpl: WebSocket, coalesce: false });
    info = await rh.ready;
    if (n === 0) check('lockstep: info from the server (mode client, scenarios)', info.mode === 'client' && info.mapW === 100 && info.scenarios.length > 10);
    const lh = new LocalHost({ ...opts, texture: tex() });
    const card = await rh.command({ type: 'restart', scenario: n });
    lh.commandSync({ type: 'restart', scenario: n });
    const frames = [];
    rh.onFrame((f) => frames.push(f));
    const local = [];
    for (let t = 0; t < 60; t++) {
      const held = t > 20 && t < 40 ? [{ type: 'helm', boat: 0, dir: -1 }] : [];
      rh.tick({ dt: 1 / 30, held, present: true, view });
      local.push(lh.tick({ dt: 1 / 30, held, present: true, view }));
    }
    await rh.idle();
    rh._frameListeners.length = 0;
    if (n !== 11) rh.terminate();
    const same = frames.length === 60 && frames.every((f, i) => strip(hudFromState(f.state.hud).info) === strip(hudFromState(local[i].state.hud).info) && sceneDiff(f.boat0, local[i].boat0) <= 1e-3 && sceneDiff(geom(buildScene(f.state, f.statics, view)), geom(buildScene(local[i].state, local[i].statics, view))) <= 1e-3);
    check(`lockstep scenario ${n}: 60 frames match LocalHost (HUD; boat0 and built scene within 1e-3, server rounds to 1e-4)`, same, `frames=${frames.length}`);
    check(`lockstep scenario ${n}: restart returns the card`, card && card.title === info.scenarios[n].title);
  }
  const v = await rh.query({ type: 'fieldVelocity', x: 0, y: 0 });
  check('lockstep: query answered', Number.isFinite(v.x));
  rh.terminate();
  await srv.close();
}

// 2. Authoritative: the server ticks at 30 Hz by itself.
{
  const srv = await startServer({ port: 0, fieldHz: 5 });
  const url = `ws://127.0.0.1:${srv.port}/?room=t2`;
  const a = new RemoteHost(url, opts, tex(), { WebSocketImpl: WebSocket });
  const info = await a.ready;
  check('server mode: info mode server', info.mode === 'server');
  a.setField({ on: true });
  const events = [];
  a.on((e) => events.push(e));
  await a.command({ type: 'restart', scenario: 0 });
  await sleep(1500);
  const n1 = a.framesReceived;
  check('server mode: ~30 frames per second without client ticks', n1 >= 25 && n1 <= 50, `frames in 1.5 s = ${n1}`);
  check('server mode: the scenario\'s bindControls is not sent (spectator: no keys)', !events.some((e) => e.type === 'bindControls') && a.bindings === 0);
  await a.command({ type: 'spawnBoat', name: 'A' });
  await sleep(100);
  check('server mode: an own boat brings this client\'s key binding', events.some((e) => e.type === 'bindControls' && e.boats === 1) && a.bindings === 1);
  check('server mode: field grids arrive as binary and paint the texture', a.fieldsReceived >= 3 && a.lastField && a.lastField.grids.length >= 1 && a.texture.image.width === a.lastField.rootW * Math.round((opts.oversampling || 8) / Math.min(1, a.lastField.resolution)),
    `fields=${a.fieldsReceived} size=${a.texture.image.width}x${a.texture.image.height}`);
  const b = new RemoteHost(url, opts, tex(), { WebSocketImpl: WebSocket });
  const evB = [];
  b.on((e) => evB.push(e));
  await b.ready;
  await sleep(300);
  check('second client joins the same room: frames and the welcome (spectator, no key binding)', b.framesReceived > 3 && b.room && b.room.scenario.index === 0 && b.bindings === 0 && !evB.some((e) => e.type === 'bindControls'));
  const core = srv.rooms.get('t2').core;
  // Hold helm from spectator B for 1 s: nothing happens to scenario boat 0.
  for (let i = 0; i < 30; i++) { b.tick({ dt: 1 / 30, held: [{ type: 'helm', boat: 0, dir: -1 }], present: true, view }); await sleep(33); }
  b.tick({ dt: 1 / 30, held: [], present: true, view });
  await sleep(200);
  const ap = hudFromState(b.lastFrame.state.hud).info.match(/Autopilot(\w+)/)[1];
  check('a spectator\'s held keys steer nothing (scenario boat keeps its autopilot)', ap === 'true' && core.sim.players[0].autopilot_enabled === true, ap);
  const st = await (await fetch(`http://127.0.0.1:${srv.port}/`)).json();
  check('status endpoint lists the room and its clients', st.ok && st.rooms.some((r) => r.name === 't2' && r.clients === 2 && r.ticks > 30), JSON.stringify(st.rooms));
  a.terminate(); b.terminate();
  await sleep(100);
  await srv.close();
}

// 3. No server: ready rejects (the page falls back to LocalHost).
{
  const rh = new RemoteHost('ws://127.0.0.1:1/', opts, tex(), { WebSocketImpl: WebSocket });
  let rejected = false;
  try { await rh.ready; } catch { rejected = true; }
  check('unreachable server: ready rejects', rejected);
}

console.log = quiet;
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all server checks passed');
process.exit(0);
