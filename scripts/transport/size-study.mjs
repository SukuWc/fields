// How much smaller could the hot path get? Captures frames + field
// keyframes from a europe-1 room with 5 boats and reports raw size,
// deflate (per message; what permessage-deflate would do without context
// takeover), deflate with the previous message as dictionary (an upper
// bound for a generic delta coder) and the time each costs.
import { startServer } from '../../apps/server/index.js';
import { RemoteHost } from '../../src/remote-host.js';
import { decodeWire, encodeWire } from '../../src/wire-codec.js';
import { WebSocket } from 'ws';
import zlib from 'node:zlib';
globalThis.requestAnimationFrame = (f) => setTimeout(f, 16);
const srv = await startServer({ port: 0, host: '127.0.0.1', fixedRooms: ['europe-1'], graceMs: 0, adminGate: false });
for (let i = 0; i < 5; i++) {
  const h = new RemoteHost(`ws://127.0.0.1:${srv.port}/?room=europe-1`, { mapW: 100, mapH: 200 }, null, { WebSocketImpl: WebSocket });
  await h.ready; await h.command({ type: 'spawnBoat', name: 'p' + i });
  // Some steering so the boats move.
  h.sendInput({ held: [{ type: 'steer', dir: i % 2 ? 1 : -1 }] });
}
const got = { 1: [], 2: [] };
const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/?room=europe-1`);
ws.on('open', () => { ws.send(JSON.stringify({ type: 'init', opts: {} })); ws.send(JSON.stringify({ type: 'field', on: true, plotType: 3, contrastExp: 0 })); });
ws.on('message', (d, bin) => { if (bin && got[d[2]]) got[d[2]].push(Buffer.from(d)); });
await new Promise((r) => setTimeout(r, 6000));
const row = (name, arr) => {
  arr = arr.slice(-120);
  const avg = (f) => arr.reduce((a, b, i) => a + f(b, i), 0) / arr.length;
  const t0 = performance.now(); const d1 = avg((b) => zlib.deflateRawSync(b, { level: 1 }).length); const t1 = performance.now();
  const d6 = avg((b) => zlib.deflateRawSync(b, { level: 6 }).length); const t2 = performance.now();
  const dd = avg((b, i) => (i ? zlib.deflateRawSync(b, { level: 6, dictionary: arr[i - 1] }).length : zlib.deflateRawSync(b, { level: 6 }).length));
  console.log(`${name.padEnd(6)} raw ${avg((b) => b.length).toFixed(0)} B | deflate-1 ${d1.toFixed(0)} B (${((t1 - t0) / arr.length).toFixed(2)} ms) | deflate-6 ${d6.toFixed(0)} B (${((t2 - t1) / arr.length).toFixed(2)} ms) | deflate+prev-dict ${dd.toFixed(0)} B`);
};
row('frame', got[1]);
row('field', got[2]);
// Frame anatomy of the last frame.
const f = decodeWire(new Uint8Array(got[1].at(-1)).buffer).frame;
const st = f.state || {};
console.log('frame.state parts:', Object.entries(st).map(([k, v]) => [k, encodeWire({ type: 'frame', frame: { [k]: v } }).byteLength - 4]).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => k + ' ' + n).join(', '));
process.exit(0);
