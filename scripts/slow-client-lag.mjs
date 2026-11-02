// Repro for a slow (mobile) remote client: its socket is read cheaply, but
// decoding a frame costs DECODE_MS and rendering one RENDER_MS of main
// thread (onFrameArrival fires once per decoded frame, onFrame per render).
// The server runs in a child process so the busy client can't slow it.
// Lag = ticks the server should be at (30 Hz wall clock since the first
// frame) minus the tick just rendered.
//   COALESCE=0  every frame decoded + rendered
//   COALESCE=1  newest frame only decoded, once per animation frame
// Run against main's src/remote-host.js to see the old behaviour: it
// decodes every message in onmessage, so the backlog still grows.
import { fork } from 'node:child_process';
import { WebSocket } from 'ws';
import { Worker } from 'node:worker_threads';
import { RemoteHost } from '../src/remote-host.js';
if (process.argv[2] === 'server') {
  const { startServer } = await import('../apps/server/index.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', fixedRooms: ['r'], graceMs: 0, adminGate: false });
  process.send(srv.port);
} else {
  const DECODE_MS = +(process.env.DECODE_MS || 30), RENDER_MS = +(process.env.RENDER_MS || 15), DUR = +(process.env.DUR_S || 10) * 1000, COALESCE = process.env.COALESCE !== '0';
  // Node has no rAF: a 60 Hz timer stands in for it.
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 16);
  const child = fork(new URL(import.meta.url).pathname, ['server'], { execArgv: process.execArgv, stdio: 'ignore' });
  const port = await new Promise((r) => child.once('message', r));
  // Like a browser, the socket is read off the main thread (a worker) and
  // messages queue for the main thread without TCP backpressure.
  class OffThreadWS {
    constructor(url) {
      this.readyState = 0;
      this.w = new Worker(`const { parentPort, workerData } = require('worker_threads'); const { WebSocket } = require(${JSON.stringify(new URL('../node_modules/ws/index.js', import.meta.url).pathname)});
        const ws = new WebSocket(workerData); ws.binaryType = 'arraybuffer';
        ws.on('open', () => parentPort.postMessage({ ev: 'open' }));
        ws.on('close', () => parentPort.postMessage({ ev: 'close' }));
        ws.on('message', (d, bin) => parentPort.postMessage({ ev: 'msg', d: bin ? d : String(d) }));
        parentPort.on('message', (m) => m === null ? ws.close() : ws.send(m));`, { eval: true, workerData: url });
      this.w.on('message', ({ ev, d }) => {
        if (ev === 'open') { this.readyState = 1; this.onopen?.(); }
        else if (ev === 'close') { this.readyState = 3; this.onclose?.(); }
        else this.onmessage?.({ data: d });
      });
    }
    send(m) { this.w.postMessage(m); }
    close() { this.w.postMessage(null); }
  }
  const h = new RemoteHost(`ws://127.0.0.1:${port}/?room=r`, { mapW: 50, mapH: 100, simRes: '2f', scenario: 0 }, null, { WebSocketImpl: OffThreadWS, coalesce: COALESCE });
  await h.ready;
  const burn = (ms) => { const end = Date.now() + ms; while (Date.now() < end) { /* busy */ } };
  h.onFrameArrival(() => burn(DECODE_MS));
  let t0 = null, tick0 = 0, lag = 0;
  h.onFrame((f) => {
    if (t0 === null) { t0 = Date.now(); tick0 = f.tick; }
    burn(RENDER_MS);
    lag = Math.round((Date.now() - t0) * 30 / 1000) - (f.tick - tick0);
  });
  const start = Date.now();
  while (Date.now() - start < DUR) {
    await new Promise((r) => setTimeout(r, 2000));
    console.log(`t=${((Date.now() - start) / 1000).toFixed(0)}s lag(ticks) last=${lag} rendered=${h.framesDelivered} dropped=${h.framesDropped}`);
  }
  child.kill(); process.exit(0);
}
