// Authoritative sim server: WebSocket, one Room (room.js) per ?room= name.
//
//   node dist-server/server.mjs [--port 8787] [--lockstep] [--field-hz 2] [--verbose]
//   (npm run server builds and starts it; PORT env works too)
//
// GET / answers a small JSON status (rooms, clients, tick cost) for health checks.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Room, FIELD_HZ } from './room.js';

export function startServer({ port = 8787, host = '0.0.0.0', lockstep = false, fieldHz = FIELD_HZ } = {}) {
  const rooms = new Map();
  const server = http.createServer((req, res) => {
    const status = {
      ok: true, lockstep,
      rooms: [...rooms.values()].map((r) => ({ name: r.name, clients: r.clients.size, ticks: r.ticks, tickMs: Math.round(r.tickMs * 10) / 10, fieldEncodes: r.fieldEncodes, fieldBytesSent: r.fieldBytesSent })),
    };
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(status));
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    const name = new URL(req.url || '/', 'http://x').searchParams.get('room') || 'default';
    let room = rooms.get(name);
    if (!room) { room = new Room(name, { lockstep, fieldHz }); rooms.set(name, room); }
    room.join(ws);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      try { room.message(ws, m); } catch (e) { console.error('room', name, e); }
    });
    ws.on('close', () => {
      room.leave(ws);
      if (room.clients.size === 0) rooms.delete(name);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({
      port: server.address().port, rooms,
      close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); for (const room of rooms.values()) room.stop(); wss.close(); server.close(() => r()); }),
    }));
  });
}

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : def;
}

const isMain = process.argv[1] && /(?:server\.mjs|apps[\\/]server[\\/]index\.js)$/.test(process.argv[1]);
if (isMain) {
  // The scenario scripts log every frame they run; keep the console quiet.
  if (!arg('verbose', false)) {
    const log = console.log;
    console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('Frame')) return; if (typeof a[0] === 'number') return; log(...a); };
  }
  const s = await startServer({
    port: Number(arg('port', process.env.PORT || 8787)),
    lockstep: !!arg('lockstep', false),
    fieldHz: Number(arg('field-hz', FIELD_HZ)),
  });
  console.info(`sim server listening on ws://localhost:${s.port}${arg('lockstep', false) ? ' (lockstep)' : ''}`);
}
