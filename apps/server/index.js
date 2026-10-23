// Authoritative sim server: WebSocket, one Room (room.js) per ?room= name.
//
//   node dist-server/server.mjs [--port 8787] [--lockstep] [--field-hz 30] [--field-tol 1] [--grace-s 10]
//                               [--rooms europe-1] [--open-rooms] [--static dist-app] [--verbose]
//   (npm run server builds and starts it; PORT env works too)
//
// fixedRooms (CLI --rooms, default europe-1) are created at startup and never
// dropped (Room persistent); with them set, no other room can be opened and a
// connection without ?room= joins the first one. --open-rooms (or
// fixedRooms: [] in startServer) keeps the old behaviour: any ?room= name
// opens a room that is dropped graceMs after it empties.
//
// HTTP on the same port:
//   GET /api/rooms   [{ id, players }]  players = connected clients (CORS *)
//   GET /api/status  rooms, clients, tick cost
//   GET /healthz     { ok: true }
//   anything else    files from staticDir (npm run build:app: landing at /,
//                    game at /play/); without staticDir, / is the status.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { Room, FIELD_HZ, FIELD_TOL, GRACE_MS } from './room.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

// A file under root for a URL path (dir -> index.html), or null.
function staticFile(root, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  const full = path.resolve(root, '.' + path.posix.normalize('/' + p));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  try {
    let st = fs.statSync(full);
    if (st.isDirectory()) { const f = path.join(full, 'index.html'); st = fs.statSync(f); return st.isFile() ? f : null; }
    return st.isFile() ? full : null;
  } catch { return null; }
}

export function startServer({ port = 8787, host = '0.0.0.0', lockstep = false, fieldHz = FIELD_HZ, fieldTol = FIELD_TOL, graceMs = GRACE_MS, fixedRooms = [], staticDir = null } = {}) {
  const rooms = new Map();
  for (const name of fixedRooms) {
    const room = new Room(name, { lockstep, fieldHz, fieldTol, graceMs, persistent: true });
    // The sim exists from startup (paused until someone joins).
    if (!lockstep) { room._create({}); room.stop(); }
    rooms.set(name, room);
  }
  const root = staticDir ? path.resolve(staticDir) : null;
  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const status = () => ({
    ok: true, lockstep,
    rooms: [...rooms.values()].map((r) => ({ name: r.name, clients: r.clients.size, ticks: r.ticks, tickMs: Math.round(r.tickMs * 10) / 10, fieldEncodes: r.fieldEncodes, fieldKeys: r.fieldKeys, fieldBytesSent: r.fieldBytesSent, fieldEncodeMs: Math.round(r.fieldEncodeMs * 100) / 100 })),
  });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-max-age': '86400' });
      return res.end();
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' });
    // Players: connected clients (spectators included); boats parked for a
    // reconnect grace period do not count.
    if (url.pathname === '/api/rooms') return json(res, 200, [...rooms.values()].map((r) => ({ id: r.name, players: r.clients.size })));
    if (url.pathname === '/api/status') return json(res, 200, status());
    if (url.pathname === '/healthz') return json(res, 200, { ok: true });
    if (!root) return json(res, url.pathname === '/' ? 200 : 404, url.pathname === '/' ? status() : { error: 'not found' });
    const file = staticFile(root, url.pathname);
    if (!file) return json(res, 404, { error: 'not found' });
    // /play -> /play/ so the page's relative assets resolve.
    if (!url.pathname.endsWith('/') && file.endsWith(path.sep + 'index.html') && path.basename(url.pathname) !== 'index.html') {
      res.writeHead(301, { location: url.pathname + '/' + url.search });
      return res.end();
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    const asked = new URL(req.url || '/', 'http://x').searchParams.get('room');
    const name = fixedRooms.length ? (asked || fixedRooms[0]) : (asked || 'default');
    let room = rooms.get(name);
    if (!room && fixedRooms.length) { ws.close(1008, 'no such room'); return; }
    if (!room) {
      room = new Room(name, { lockstep, fieldHz, fieldTol, graceMs });
      room.onDispose = (r) => { if (rooms.get(name) === r) rooms.delete(name); };
      rooms.set(name, room);
    }
    room.join(ws);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      try { room.message(ws, m); } catch (e) { console.error('room', name, e); }
    });
    // An empty room stays for graceMs (Room.leave), then onDispose drops it.
    ws.on('close', () => room.leave(ws));
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({
      port: server.address().port, rooms,
      close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); for (const room of rooms.values()) { room.graceMs = 0; room.persistent = false; room._dispose(); room.stop(); } wss.close(); server.close(() => r()); }),
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
    fieldTol: Number(arg('field-tol', FIELD_TOL)),
    graceMs: Number(arg('grace-s', GRACE_MS / 1000)) * 1000,
    fixedRooms: arg('open-rooms', false) ? [] : String(arg('rooms', process.env.ROOMS || 'europe-1')).split(',').map((s) => s.trim()).filter(Boolean),
    staticDir: arg('static', process.env.STATIC_DIR || (fs.existsSync('dist-app') ? 'dist-app' : null)),
  });
  console.info(`sim server listening on ws://localhost:${s.port}${arg('lockstep', false) ? ' (lockstep)' : ''}`);
}
