// What is in a binary frame: bytes per top-level key (encodeWire of each key alone).
import { startServer } from '../../apps/server/index.js';
import { RemoteHost } from '../../src/remote-host.js';
import { encodeWire, decodeWire } from '../../src/wire-codec.js';
import { WebSocket } from 'ws';
globalThis.requestAnimationFrame = (f) => setTimeout(f, 16);
const srv = await startServer({ port: 0, host: '127.0.0.1', fixedRooms: ['europe-1'], graceMs: 0, adminGate: false });
for (let i = 0; i < 5; i++) {
  const h = new RemoteHost(`ws://127.0.0.1:${srv.port}/?room=europe-1`, { mapW: 100, mapH: 200 }, null, { WebSocketImpl: WebSocket });
  await h.ready; await h.command({ type: 'spawnBoat', name: 'p' + i });
}
let last;
const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/?room=europe-1`);
ws.on('open', () => ws.send(JSON.stringify({ type: 'init', opts: {} })));
ws.on('message', (d, bin) => { if (bin && d[2] === 1) last = d; });
await new Promise((r) => setTimeout(r, 5000));
const f = decodeWire(new Uint8Array(last).buffer.slice(0)).frame;
const rows = Object.entries(f).map(([k, v]) => [k, encodeWire({ type: 'frame', frame: { [k]: v } }).byteLength - 4]).sort((a, b) => b[1] - a[1]);
console.log('total', last.length); for (const [k, n] of rows.slice(0, 25)) console.log(k.padEnd(28), n);
const st = f.state || {}; if (typeof st === 'object') { console.log('-- state'); for (const [k, v] of Object.entries(st).map(([k, v]) => [k, encodeWire({ type: 'frame', frame: { [k]: v } }).byteLength]).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(' ', k.padEnd(26), v); }
process.exit(0);
