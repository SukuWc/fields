// Authoritative sim server: WebSocket, one Room (room.js) per ?room= name.
//
//   node dist-server/server.mjs [--port 8787] [--lockstep] [--field-hz 30|0] [--field-tol 1] [--grace-s 10]
//   field cadence is room setting fieldSkip; --field-hz 0 disables field encoding
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
//   GET /api/rooms   [{ id, players, config, admin, adminOpen }]  config = room TOML;
//                    admin = writes possible; adminOpen = no ADMIN_SECRET set, so
//                    anyone may write without a token (CORS *)
//   PUT|POST /api/rooms/:id/config   apply room TOML (Authorization: Bearer <ADMIN_SECRET>
//                    when ADMIN_SECRET is set; no auth when it is unset = open editing)
//                    body: raw TOML (text/plain) or JSON { "toml": "..." } / { "config": "..." }
//   GET /api/perf    { rooms: [{ id, players, sampleHz, windowS, endAt, times, latestMs }] }
//                    last ~180 s of frameMs (physics + field encode) per room (CORS *)
//   GET /api/status  rooms, clients, tick cost
//   GET /api/version { commit, url? }  short SHA (+ GitHub commit URL) from version.json
//   GET /healthz     { ok: true }
//   anything else    files from staticDir (npm run build:app: landing at /,
//                    game at /play/); without staticDir, / is the status.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { ClientTx, transportFromQuery, startWebTransport, makeWtCert } from './transport.js';
import {
  adminSecretsEqual,
  FIELD_HZ,
  FIELD_TOL,
  GRACE_MS,
  Room,
} from './room.js';

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

const REPO_COMMIT = 'https://github.com/SukuWc/fields/commit/';

function versionFromSha(raw) {
  const hex = String(raw).replace(/^[^0-9a-f]*/i, '') || String(raw);
  if (!hex || hex === 'dev' || !/^[0-9a-f]+$/i.test(hex)) return { commit: 'dev' };
  const sha = hex.length >= 40 ? hex.slice(0, 40) : hex;
  return { commit: sha.slice(0, 7), sha, url: REPO_COMMIT + sha };
}

function loadVersion(staticDir) {
  if (staticDir) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(path.resolve(staticDir), 'version.json'), 'utf8'));
      if (v && typeof v.commit === 'string' && v.commit) {
        if (v.url || v.commit === 'dev') return { commit: v.commit, ...(v.sha ? { sha: v.sha } : {}), ...(v.url ? { url: v.url } : {}) };
        return versionFromSha(v.sha || v.commit);
      }
    } catch { /* no version.json */ }
  }
  for (const key of ['SOURCE_COMMIT', 'COMMIT_SHA', 'GIT_COMMIT']) {
    const raw = (process.env[key] || '').trim();
    if (!raw || raw === 'dev') continue;
    return versionFromSha(raw);
  }
  return { commit: 'dev' };
}


/** Normalize ADMIN_SECRET: unset/blank → null (writes disabled). */
export function normalizeAdminSecret(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s ? s : null;
}

export { adminSecretsEqual };

function bearerToken(req) {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

function readRequestBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Extract TOML text from a raw body (plain TOML or JSON wrapper). */
export function tomlFromBody(raw, contentType) {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  const text = String(raw ?? '');
  if (ct === 'application/json') {
    let j;
    try { j = JSON.parse(text); } catch { return { error: 'invalid JSON body' }; }
    if (j && typeof j.toml === 'string') return { toml: j.toml };
    if (j && typeof j.config === 'string') return { toml: j.config };
    return { error: 'JSON body needs string "toml" or "config"' };
  }
  return { toml: text };
}

export function startServer({ port = 8787, host = '0.0.0.0', lockstep = false, fieldHz = FIELD_HZ, fieldTol = FIELD_TOL, graceMs = GRACE_MS, fixedRooms = [], staticDir = null, adminSecret = process.env.ADMIN_SECRET, adminGate = true, deflate = false, wtPort = 0, wtNames = null, rtcPortRange = null, rtcAnnounceIp = null, tls = null } = {}) {
  const secret = normalizeAdminSecret(adminSecret);
  const adminEnabled = !!secret;
  const rooms = new Map();
  for (const name of fixedRooms) {
    const room = new Room(name, { lockstep, fieldHz, fieldTol, graceMs, persistent: true, adminGate, adminSecret: secret });
    // The sim exists and ticks from startup (even with no clients).
    if (!lockstep) room._create({});
    // Fixed remote rooms start on the shared Reset preset (live europe-1 baseline).
    if (room.core) room.applyTomlConfig(room.defaultTomlConfig());
    rooms.set(name, room);
  }
  const root = staticDir ? path.resolve(staticDir) : null;
  const version = loadVersion(staticDir);
  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const status = () => ({
    ok: true, lockstep,
    rooms: [...rooms.values()].map((r) => ({ name: r.name, clients: r.clients.size, ticks: r.ticks, tickMs: Math.round(r.tickMs * 10) / 10, frameMs: Math.round(r.frameMs * 10) / 10, fieldEncodes: r.fieldEncodes, fieldKeys: r.fieldKeys, fieldBytesSent: r.fieldBytesSent, frameBytesSent: r.frameBytesSent, lastFrameBytes: r.lastFrameBytes, staticsBytesSent: r.staticsBytesSent, wire: 'binary-v1', fieldEncodeMs: Math.round(r.fieldEncodeMs * 100) / 100 })),
  });
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, PUT, POST, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type',
    'access-control-max-age': '86400',
  };
  // EXPERIMENT: tls = { cert, key } serves https/wss (WebTransport needs a
  // secure page; on a LAN that means a self-signed cert, see --https).
  const server = (tls ? https.createServer.bind(null, { cert: tls.cert, key: tls.key }) : http.createServer)((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      return res.end();
    }
    // Admin: apply room TOML without joining the WebSocket (landing page Commit).
    const configMatch = /^\/api\/rooms\/([^/]+)\/config$/.exec(url.pathname);
    if (configMatch && (req.method === 'PUT' || req.method === 'POST')) {
      (async () => {
        // No ADMIN_SECRET: open editing, no token needed. With one: Bearer secret.
        if (adminEnabled) {
          const token = bearerToken(req);
          if (!token || !adminSecretsEqual(token, secret)) return json(res, 401, { error: 'unauthorized' });
        }
        let id;
        try { id = decodeURIComponent(configMatch[1]); } catch { return json(res, 400, { error: 'bad room id' }); }
        const room = rooms.get(id);
        if (!room) return json(res, 404, { error: 'no such room' });
        let raw;
        try { raw = await readRequestBody(req); } catch (e) {
          return json(res, e.status || 400, { error: e.message || 'bad body' });
        }
        const extracted = tomlFromBody(raw, req.headers['content-type']);
        if (extracted.error) return json(res, 400, { error: extracted.error });
        const result = room.applyTomlConfig(extracted.toml);
        if (result.error) return json(res, 400, { error: result.error });
        return json(res, 200, { ok: true, id: room.name, config: result.config });
      })().catch((e) => {
        console.error('admin config', e);
        if (!res.headersSent) json(res, 500, { error: 'internal' });
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' });
    // Players: connected clients (spectators included); boats parked for a
    // reconnect grace period do not count.
    if (url.pathname === '/api/rooms') {
      return json(res, 200, [...rooms.values()].map((r) => ({
        id: r.name, players: r.clients.size, config: r.tomlConfig(), admin: true, adminOpen: !adminEnabled,
      })));
    }
    if (url.pathname === '/api/perf') {
      return json(res, 200, {
        rooms: [...rooms.values()].map((r) => ({
          id: r.name,
          players: r.clients.size,
          ...r.frameTimes.snapshot(),
        })),
      });
    }
    if (url.pathname === '/api/status') return json(res, 200, status());
    // Transport experiments: per-client hot-path counters (apps/server/transport.js).
    if (url.pathname === '/api/transport') {
      return json(res, 200, { deflate: !!deflate, wtPort: wt ? wt.port : 0, cpu: process.cpuUsage(), rooms: [...rooms.values()].map((r) => ({ id: r.name, ticks: r.ticks, clients: [...r.clients].map((c) => ({ id: c.txId, ...(c.tx ? c.tx.snapshot() : {}) })) })) });
    }
    if (url.pathname === '/api/version') return json(res, 200, version);
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
  // EXPERIMENT: permessage-deflate (ws default off), WebTransport, WebRTC options.
  const wss = new WebSocketServer({ server, perMessageDeflate: deflate ? { threshold: 256, zlibDeflateOptions: { level: 1 } } : false });
  let wt = null;
  const wtReady = wtPort ? (async () => {
    const c = tls && tls.hash ? tls : await makeWtCert(wtNames || ['localhost', '127.0.0.1']);
    wt = await startWebTransport({ port: wtPort, cert: c.cert, key: c.key, hash: c.hash });
    for (const r of rooms.values()) r.wt = wt;
    console.info(`webtransport on udp ${wtPort} (cert sha-256 ${c.hash})`);
  })().catch((e) => console.error('webtransport disabled:', e.message)) : Promise.resolve();
  const rtcOpts = { portRangeBegin: rtcPortRange ? rtcPortRange[0] : 0, portRangeEnd: rtcPortRange ? rtcPortRange[1] : 0, announceIp: rtcAnnounceIp };
  let nextTxId = 1;
  wss.on('connection', (ws, req) => {
    const params = new URL(req.url || '/', 'http://x').searchParams;
    const asked = params.get('room');
    ws.txId = nextTxId++;
    ws.tx = new ClientTx(ws, transportFromQuery(params));
    const name = fixedRooms.length ? (asked || fixedRooms[0]) : (asked || 'default');
    let room = rooms.get(name);
    if (!room && fixedRooms.length) { ws.close(1008, 'no such room'); return; }
    if (!room) {
      room = new Room(name, { lockstep, fieldHz, fieldTol, graceMs, adminGate, adminSecret: secret });
      room.onDispose = (r) => { if (rooms.get(name) === r) rooms.delete(name); };
      rooms.set(name, room);
    }
    room.wt = wt;
    room.rtcOpts = rtcOpts;
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
    server.listen(port, host, () => wtReady.then(() => resolve({
      port: server.address().port, rooms, version,
      close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); for (const room of rooms.values()) { room.graceMs = 0; room.persistent = false; room._dispose(); room.stop(); } wss.close(); if (wt) wt.close(); server.close(() => r()); }),
    })));
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
  // EXPERIMENT: --https [names] serves https/wss with a fresh self-signed
  // ECDSA cert (13 days, also used for WebTransport). names: comma list of
  // the LAN IPs / hostnames the phone will use (SAN).
  const httpsArg = arg('https', process.env.HTTPS_NAMES || false);
  let tls = null;
  if (httpsArg) {
    const os = await import('node:os');
    const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4').map((a) => a.address);
    const names = typeof httpsArg === 'string' ? httpsArg.split(',') : ['localhost', ...ips];
    tls = await makeWtCert(names);
    console.info(`https with self-signed cert for ${names.join(', ')}`);
  }
  const s = await startServer({
    tls,
    port: Number(arg('port', process.env.PORT || 8787)),
    lockstep: !!arg('lockstep', false),
    fieldHz: Number(arg('field-hz', FIELD_HZ)),
    fieldTol: Number(arg('field-tol', FIELD_TOL)),
    graceMs: Number(arg('grace-s', GRACE_MS / 1000)) * 1000,
    fixedRooms: arg('open-rooms', false) ? [] : String(arg('rooms', process.env.ROOMS || 'europe-1')).split(',').map((s) => s.trim()).filter(Boolean),
    staticDir: arg('static', process.env.STATIC_DIR || (fs.existsSync('dist-app') ? 'dist-app' : null)),
    // Transport experiments (docs/transport-experiments.md).
    deflate: !!arg('deflate', process.env.WS_DEFLATE === '1'),
    wtPort: Number(arg('wt-port', process.env.WT_PORT || 0)),
    wtNames: arg('wt-names', process.env.WT_NAMES || '') ? String(arg('wt-names', process.env.WT_NAMES)).split(',') : null,
    rtcPortRange: arg('rtc-ports', process.env.RTC_PORTS || '') ? String(arg('rtc-ports', process.env.RTC_PORTS)).split('-').map(Number) : null,
    rtcAnnounceIp: arg('rtc-ip', process.env.RTC_IP || null),
  });
  // Docker/Coolify stop sends SIGTERM: close sockets and the HTTP server,
  // then exit (forced after 5 s).
  let stopping = false;
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      if (stopping) return;
      stopping = true;
      console.info(`${sig}: shutting down`);
      setTimeout(() => process.exit(0), 5000).unref();
      s.close().then(() => process.exit(0));
    });
  }
  console.info(`sim server listening on ${tls ? 'wss' : 'ws'}://localhost:${s.port}${arg('lockstep', false) ? ' (lockstep)' : ''}`);
}
