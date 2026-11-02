// Repro: a client whose socket is read promptly (like a browser's network
// process) but whose main thread spends COST_MS per message (decode/paint on
// a slow phone). Prints how far its processed tick trails a fast client.
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/index.js';
import { parseServerMessage } from '../src/wire-codec.js';
const COST_MS = +(process.env.COST_MS || 45), DUR = +(process.env.DUR_S || 10) * 1000, ACK = process.env.ACK !== '0';
const srv = await startServer({ port: 0, host: '127.0.0.1', fixedRooms: ['r'], graceMs: 0 });
const url = `ws://127.0.0.1:${srv.port}/?room=r`;
let liveTick = 0;
function client(slow) {
  const ws = new WebSocket(url); const q = []; let busy = false, done = 0;
  const st = { lag: [], processed: 0 };
  const pump = () => {
    if (busy || !q.length) return; busy = true;
    const m = q.shift();
    setTimeout(() => { // per-message main-thread cost
      if (m.type === 'frame') { st.processed++; st.lag.push(liveTick - m.frame.tick);
        if (ACK && m.frame.tick % 3 === 0) ws.send(JSON.stringify({ type: 'ack', tick: m.frame.tick })); }
      busy = false; pump();
    }, slow ? COST_MS : 0);
  };
  ws.on('message', (d, bin) => {
    const m = parseServerMessage(bin ? new Uint8Array(d) : String(d));
    if (!slow && m.type === 'frame') { liveTick = Math.max(liveTick, m.frame.tick); return; }
    if (slow) { q.push(m); pump(); }
  });
  ws.on('open', () => ws.send(JSON.stringify({ type: 'init', opts: { mapW: 50, mapH: 100, simRes: '2f', scenario: 0 } })));
  st.ws = ws; return st;
}
const fast = client(false), slow = client(true);
const t0 = Date.now();
while (Date.now() - t0 < DUR) {
  await new Promise((r) => setTimeout(r, 2000));
  const l = slow.lag.slice(-10); console.log(`t=${((Date.now() - t0) / 1000).toFixed(0)}s lag(ticks) last=${l.at(-1)} max10=${Math.max(...l)}`);
}
fast.ws.close(); slow.ws.close(); await srv.close(); process.exit(0);
