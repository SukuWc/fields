// Remote (server clock) frame delivery:
// - every frame the room computes is broadcast to every client, with tick
//   numbers that increase by one and match across clients;
// - broadcasts are paced to a fixed 30 Hz clock: cheap ticks wait for their
//   slot (no faster than 30 Hz), slow ticks go out when done (no catch-up
//   burst afterwards);
// - a client that falls behind delivers only the newest queued frame.
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/index.js';
import { RemoteHost } from '../src/remote-host.js';

let failed = 0;
const quiet = console.log;
const check = (name, ok, extra = '') => { quiet((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
console.log = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tex = () => ({ image: { data: new Uint8Array(0) } });
// A tiny, cheap room: 20 × 20 m on the 1 m grid, dev mode (lattice frozen).
const tiny = { mapW: 20, mapH: 20, simRes: '1' };

// 1. Two clients get every frame; ticks consecutive and identical.
{
  const srv = await startServer({ port: 0, fieldHz: 0 });
  const url = `ws://127.0.0.1:${srv.port}/?room=bc`;
  const A = new RemoteHost(url, tiny, tex(), { WebSocketImpl: WebSocket });
  await A.ready;
  await A.command({ type: 'devMode', on: true });
  await A.command({ type: 'restart', scenario: 0 });
  const B = new RemoteHost(url, tiny, tex(), { WebSocketImpl: WebSocket });
  await B.ready;
  const ta = [], tb = [];
  A.onFrameArrival((f) => ta.push(f.tick));
  B.onFrameArrival((f) => tb.push(f.tick));
  await sleep(2000);
  A.terminate(); B.terminate();
  const consecutive = (t) => t.length > 1 && t.every((v, i) => i === 0 || v === t[i - 1] + 1);
  const common = ta.filter((t) => tb.includes(t));
  const firstB = tb[0], lastA = ta[ta.length - 1];
  const overlap = ta.filter((t) => t >= firstB && t <= Math.min(lastA, tb[tb.length - 1]));
  check('client A receives every frame (ticks +1 each, none missing)', consecutive(ta), `n=${ta.length} ${ta[0]}..${lastA}`);
  check('client B receives every frame (ticks +1 each, none missing)', consecutive(tb), `n=${tb.length} ${tb[0]}..${tb[tb.length - 1]}`);
  check('both clients got the same frames over the shared span', overlap.length > 30 && overlap.every((t) => tb.includes(t)), `shared=${common.length}`);
  await srv.close();
}

// 1b. Same tick → same frame content on both clients.
{
  const srv = await startServer({ port: 0, fieldHz: 0 });
  const url = `ws://127.0.0.1:${srv.port}/?room=same`;
  const A = new RemoteHost(url, tiny, tex(), { WebSocketImpl: WebSocket });
  await A.ready;
  await A.command({ type: 'devMode', on: true });
  await A.command({ type: 'restart', scenario: 0 });
  const B = new RemoteHost(url, tiny, tex(), { WebSocketImpl: WebSocket });
  await B.ready;
  const fa = new Map(), fb = new Map();
  A.onFrameArrival((f) => fa.set(f.tick, JSON.stringify([f.boat0, f.hud && f.hud.info])));
  B.onFrameArrival((f) => fb.set(f.tick, JSON.stringify([f.boat0, f.hud && f.hud.info])));
  await sleep(1000);
  A.terminate(); B.terminate();
  const keys = [...fa.keys()].filter((k) => fb.has(k));
  check('frames with the same tick are identical on both clients', keys.length > 15 && keys.every((k) => fa.get(k) === fb.get(k)), `compared ${keys.length}`);
  await srv.close();
}

// 2. Cheap ticks: broadcast rate at or under 30 Hz, evenly spaced.
{
  const srv = await startServer({ port: 0, fieldHz: 0 });
  const url = `ws://127.0.0.1:${srv.port}/?room=rate`;
  const A = new RemoteHost(url, tiny, tex(), { WebSocketImpl: WebSocket });
  await A.ready;
  await A.command({ type: 'devMode', on: true });
  const room = srv.rooms.get('rate');
  await sleep(300);
  const times = [];
  A.onFrameArrival(() => times.push(performance.now()));
  await sleep(3000);
  A.terminate();
  const hz = (times.length - 1) / ((times[times.length - 1] - times[0]) / 1000);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const bursts = gaps.filter((g) => g < 20).length;
  check('cheap ticks: broadcast rate stays at or under ~30 Hz', hz <= 30.5 && hz >= 27, `${hz.toFixed(2)} Hz over ${times.length} frames, tick ${room.tickMs.toFixed(2)} ms`);
  check('cheap ticks: no bursts (gaps < 20 ms)', bursts <= 2, `bursts=${bursts} min gap ${Math.min(...gaps).toFixed(1)} ms`);
  await srv.close();
}

// 3. Slow ticks (60 ms): each frame goes out when done, no catch-up burst.
// Times are taken where the room broadcasts: the client shares this process,
// and a busy server tick delays its socket reads.
{
  const srv = await startServer({ port: 0, fieldHz: 0 });
  const url = `ws://127.0.0.1:${srv.port}/?room=slow`;
  const A = new RemoteHost(url, tiny, tex(), { WebSocketImpl: WebSocket });
  await A.ready;
  await A.command({ type: 'devMode', on: true });
  const room = srv.rooms.get('slow');
  const core = room.core;
  const tick = core.tick.bind(core);
  let sink = null;
  const publish = room._publish.bind(room);
  room._publish = (out) => { if (sink) sink.push(performance.now()); publish(out); };
  core.tick = (r) => { const t = performance.now(); while (performance.now() - t < 60) { /* slow tick */ } return tick(r); };
  await sleep(300);
  const times = [];
  sink = times;
  await sleep(2500);
  core.tick = tick;
  // After the slow phase, cheap ticks again: still no burst to catch up.
  const after = [];
  sink = after;
  await sleep(1000);
  sink = null;
  A.terminate();
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const hz = (times.length - 1) / ((times[times.length - 1] - times[0]) / 1000);
  check('slow ticks: frames go out as they finish (~1/60 ms), not faster', Math.min(...gaps) >= 50 && hz > 12 && hz < 18, `${hz.toFixed(1)} Hz, min gap ${Math.min(...gaps).toFixed(1)} ms`);
  const ag = after.slice(1).map((t, i) => t - after[i]);
  check('after slow ticks: back to 30 Hz with no catch-up burst', ag.filter((g) => g < 20).length <= 2 && after.length <= 33, `frames in 1 s = ${after.length}, min gap ${Math.min(...ag).toFixed(1)} ms`);
  await srv.close();
}

// 4. A client that falls behind delivers only the newest frame.
{
  class FakeWS { constructor() { this.readyState = 1; } send() {} close() {} }
  const h = new RemoteHost('ws://fake', tiny, tex(), { WebSocketImpl: FakeWS });
  h.ws.onmessage({ data: JSON.stringify({ type: 'info', info: { mode: 'server', scenarios: [] } }) });
  const got = [];
  h.onFrame((f) => got.push(f.tick));
  for (let t = 1; t <= 5; t++) h.ws.onmessage({ data: JSON.stringify({ type: 'frame', frame: { tick: t } }) });
  await sleep(20);
  check('queued frames: only the newest is delivered, the rest counted as dropped',
    got.length === 1 && got[0] === 5 && h.framesReceived === 5 && h.framesDropped === 4 && h.lastFrame.tick === 5, JSON.stringify({ got, dropped: h.framesDropped }));
  h.ws.onmessage({ data: JSON.stringify({ type: 'frame', frame: { tick: 6 } }) });
  await sleep(20);
  check('a client that keeps up gets each frame', got.join() === '5,6');
  h.terminate();
}

console.log = quiet;
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all remote-frame checks passed');
process.exit(0);
