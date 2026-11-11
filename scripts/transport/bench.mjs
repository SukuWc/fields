// Transport bench: one server (child process), DESKTOPS fast clients on
// loopback and PHONES slow clients behind a simulated mobile link
// (scripts/transport/link.mjs), all in the europe-1 room on its default
// config (field on, 30 Hz). The phones use the variant under test.
// Staleness = wall time when a frame is rendered - wall time the server
// published that tick (same machine clock).
//
//   node --import ./test/register.mjs scripts/transport/bench.mjs
// env: VARIANT=ws (= send=legacy, main before #197)|ws-latest|ws-ack (the default)|rtc|rtc-ack|wt|wt-ack   DEFLATE=1   DUR_S=60 WARM_S=5
//      PHONES=2 DESKTOPS=3   RATE_KBPS=3000 DELAY_MS=15 QUEUE_KB=256
//      STALL_PCT=2 STALL_MS=300 LOSS_PCT=1   DECODE_MS=20 RENDER_MS=15 FIELD_MS=8
//      FIELD=1 (phones show the field)  OUT=file.json
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const self = fileURLToPath(import.meta.url);
const role = process.argv[2] || 'main';
const env = process.env;
const num = (k, d) => (env[k] !== undefined && env[k] !== '' ? Number(env[k]) : d);

if (role === 'server') {
  const { startServer } = await import('../../apps/server/index.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', fixedRooms: ['europe-1'], graceMs: 0, adminGate: false, deflate: env.DEFLATE === '1', wtPort: num('WT_PORT', 0) });
  const room = srv.rooms.get('europe-1');
  const pub = room._publish.bind(room);
  room._publish = (out) => { pub(out); process.send({ ev: 'tick', tick: out.frame.tick, t: Date.now() }); };
  process.on('message', (m) => {
    if (m === 'stats') {
      process.send({ ev: 'stats', cpu: process.cpuUsage(), ticks: room.ticks, tickMs: room.tickMs, frameMs: room.frameMs, lastFrameBytes: room.lastFrameBytes, clients: [...room.clients].map((c) => ({ id: c.txId, ...c.tx.snapshot() })) });
    }
  });
  process.send({ ev: 'port', port: srv.port, wtPort: num('WT_PORT', 0) });
} else if (role === 'client') {
  const { RemoteHost } = await import('../../src/remote-host.js');
  const { Worker } = await import('node:worker_threads');
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 16);
  const cfg = JSON.parse(env.CLIENT);
  // Like a browser: the socket is read off the main thread and messages
  // queue for it without TCP backpressure (classic WebSocket API).
  const wsPath = new URL('../../node_modules/ws/index.js', import.meta.url).pathname;
  class OffThreadWS {
    constructor(url) {
      this.readyState = 0;
      this.w = new Worker(`const { parentPort, workerData } = require('worker_threads'); const { WebSocket } = require(${JSON.stringify(wsPath)});
        const ws = new WebSocket(workerData.url, { perMessageDeflate: workerData.deflate });
        ws.binaryType = 'arraybuffer';
        ws.on('open', () => parentPort.postMessage({ ev: 'open' }));
        ws.on('close', () => parentPort.postMessage({ ev: 'close' }));
        ws.on('error', () => {});
        ws.on('message', (d, bin) => parentPort.postMessage({ ev: 'msg', d: bin ? d : String(d) }));
        parentPort.on('message', (m) => m === null ? ws.close() : ws.send(m));`, { eval: true, workerData: { url, deflate: env.DEFLATE === '1' } });
      this.w.on('message', ({ ev, d }) => {
        if (ev === 'open') { this.readyState = 1; this.onopen?.(); }
        else if (ev === 'close') { this.readyState = 3; this.onclose?.(); }
        else this.onmessage?.({ data: d });
      });
    }
    send(m) { this.w.postMessage(m); }
    close() { this.w.postMessage(null); }
  }
  let RTC, WT;
  if (cfg.transport === 'rtc') RTC = (await import('node-datachannel/polyfill')).RTCPeerConnection;
  if (cfg.transport === 'wt') WT = (await import('@fails-components/webtransport')).WebTransport;
  const pubAt = new Map();
  const pending = [];
  const samples = [];
  let recording = false;
  process.on('message', (m) => {
    if (m.ev === 'tick') {
      pubAt.set(m.tick, m.t);
      if (pubAt.size > 4000) pubAt.delete(pubAt.keys().next().value);
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i][0] === m.tick) { samples.push(pending[i][1] - m.t); pending.splice(i, 1); }
    } else if (m.ev === 'record') recording = m.on;
    else if (m.ev === 'report') {
      const h = hosts[0];
      process.send({ ev: 'report', samples, hotBytes: hosts.reduce((a, x) => a + x._hotBytes, 0), bytes: hosts.reduce((a, x) => a + x.bytesReceived, 0), rendered: renders, dropped: hosts.reduce((a, x) => a + x.framesDropped, 0), stale: hosts.reduce((a, x) => a + x.hotStale, 0), fieldsPainted, channel: h.hotChannel });
    } else if (m.ev === 'hotBytes') process.send({ ev: 'hotBytes', hotBytes: hosts.reduce((a, x) => a + x._hotBytes, 0) });
  });
  const burn = (ms) => { const end = performance.now() + ms; while (performance.now() < end) { /* busy */ } };
  const hosts = [];
  let renders = 0, fieldsPainted = 0;
  for (let i = 0; i < cfg.n; i++) {
    const opts = { WebSocketImpl: OffThreadWS, RTCPeerConnectionImpl: RTC, WebTransportImpl: WT };
    if (cfg.transport === 'rtc') {
      // Route the data channel through the parent's UDP link: the server's
      // candidate becomes the link's port; our own candidates are not sent,
      // so the server only learns the link's address (peer-reflexive).
      let mapped = false;
      opts.rtcMapCandidate = (c, dir) => {
        if (dir === 'local') return null;
        const p = c.replace(/^a=/, '').split(' ');
        if (mapped || p[2].toUpperCase() !== 'UDP' || !/^\d+\.\d+\.\d+\.\d+$/.test(p[4])) return null;
        mapped = true;
        process.send({ ev: 'udpTarget', i, host: p[4], port: +p[5] });
        p[4] = '127.0.0.1'; p[5] = String(cfg.udpPorts[i]);
        return p.join(' ');
      };
    }
    if (cfg.transport === 'wt') opts.wtMapUrl = () => `https://127.0.0.1:${cfg.udpPorts[i]}/wt`;
    const h = new RemoteHost(cfg.urls[i], { mapW: 100, mapH: 200 }, null, opts);
    await h.ready;
    if (cfg.field) {
      h.setField({ on: true });
      const apply = h._applyField.bind(h);
      h._applyField = (m) => { burn(cfg.fieldMs); fieldsPainted++; apply(m); };
    }
    h.onFrameArrival(() => burn(cfg.decodeMs));
    h.onFrame((f) => {
      burn(cfg.renderMs);
      renders++;
      if (!recording) return;
      const now = Date.now();
      const t = pubAt.get(f.tick);
      if (t !== undefined) samples.push(now - t); else pending.push([f.tick, now]);
    });
    if (cfg.spawn) await h.command({ type: 'spawnBoat', name: cfg.name + i });
    hosts.push(h);
  }
  process.send({ ev: 'ready' });
} else {
  const { TcpLink, UdpLink } = await import('./link.mjs');
  const VARIANT = env.VARIANT || 'ws';
  const DUR = num('DUR_S', 60) * 1000, WARM = num('WARM_S', 5) * 1000;
  const link = { rateKbps: num('RATE_KBPS', 3000), delayMs: num('DELAY_MS', 15), queueBytes: num('QUEUE_KB', 256) * 1024, stallPct: num('STALL_PCT', 2), stallMs: num('STALL_MS', 300), lossPct: num('LOSS_PCT', 1) };
  const transport = VARIANT.startsWith('rtc') ? 'rtc' : VARIANT.startsWith('wt') ? 'wt' : 'ws';
  const send = VARIANT.endsWith('-latest') ? 'latest' : VARIANT.endsWith('-ack') ? 'ack' : transport === 'ws' ? 'legacy' : 'latest';
  const wtPort = transport === 'wt' ? 20000 + Math.floor(Math.random() * 20000) : 0;
  const server = fork(self, ['server'], { execArgv: process.execArgv, env: { ...env, WT_PORT: String(wtPort) }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const { port } = await new Promise((r) => server.on('message', (m) => { if (m.ev === 'port') r(m); }));
  const children = [];
  server.on('message', (m) => { if (m.ev === 'tick') for (const c of children) c.connected && c.send(m); });
  const stats = () => new Promise((r) => { const f = (m) => { if (m.ev === 'stats') { server.off('message', f); r(m); } }; server.on('message', f); server.send('stats'); });
  const PHONES = num('PHONES', 2), DESKTOPS = num('DESKTOPS', 3);
  const tcp = new TcpLink({ host: '127.0.0.1', port }, link);
  const tcpPort = await tcp.listen();
  const udp = [];
  for (let i = 0; i < PHONES; i++) {
    const u = new UdpLink(transport === 'wt' ? { host: '127.0.0.1', port: wtPort } : null, link);
    await u.listen('127.0.0.1');
    udp.push(u);
  }
  const start = (name, cfg) => new Promise((resolve) => {
    const c = fork(self, ['client'], { execArgv: process.execArgv, env: { ...env, CLIENT: JSON.stringify(cfg) }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    c.name = name;
    c.on('message', (m) => {
      if (m.ev === 'ready') resolve(c);
      if (m.ev === 'udpTarget') udp[cfg.udpBase + m.i].setTarget({ host: m.host, port: m.port });
    });
    children.push(c);
  });
  // Desktops: direct, default policy, no CPU cost. One process each.
  const desk = [];
  for (let i = 0; i < DESKTOPS; i++) desk.push(await start('desktop' + i, { n: 1, name: 'd' + i, urls: [`ws://127.0.0.1:${port}/?room=europe-1&name=desktop${i}`], transport: 'ws', decodeMs: 1, renderMs: 2, fieldMs: 1, field: true, spawn: true }));
  // Phones: one process each (own main thread), behind the link.
  const phones = [];
  for (let i = 0; i < PHONES; i++) {
    const q = `room=europe-1&name=phone${i}&send=${send}` + (transport !== 'ws' ? `&transport=${transport}` : '') + (env.ACK_MS ? `&ackms=${env.ACK_MS}` : '');
    phones.push(await start('phone' + i, { n: 1, name: 'p' + i, urls: [`ws://127.0.0.1:${tcpPort}/?${q}`], transport, udpPorts: [udp[i].port], udpBase: i, decodeMs: num('DECODE_MS', 20), renderMs: num('RENDER_MS', 15), fieldMs: num('FIELD_MS', 8), field: env.FIELD !== '0', spawn: true }));
  }
  await new Promise((r) => setTimeout(r, WARM));
  const s0 = await stats();
  const t0 = Date.now();
  for (const c of children) c.send({ ev: 'record', on: true });
  const series = [];
  const hot = (c) => new Promise((r) => { const f = (m) => { if (m.ev === 'hotBytes') { c.off('message', f); r(m.hotBytes); } }; c.on('message', f); c.send({ ev: 'hotBytes' }); });
  while (Date.now() - t0 < DUR) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await stats();
    const row = { t: Math.round((Date.now() - t0) / 1000), tcpQueue: tcp.queued(), udpQueue: udp.reduce((a, u) => a + u.queued(), 0), phones: [] };
    for (let i = 0; i < PHONES; i++) {
      const cs = s.clients.find((x) => x.name === 'phone' + i) || {};
      const got = await hot(phones[i]);
      row.phones.push({ wsBuffered: cs.wsBuffered, buffered: cs.buffered, inFlight: cs.inFlight, window: cs.window, sent: cs.bytes, backlog: (cs.bytes || 0) - got, transport: cs.transport });
    }
    series.push(row);
    if (env.VERBOSE) console.log(JSON.stringify(row));
  }
  const s1 = await stats();
  for (const c of children) c.send({ ev: 'record', on: false });
  const reports = await Promise.all(children.map((c) => new Promise((r) => { const f = (m) => { if (m.ev === 'report') { c.off('message', f); r({ name: c.name, ...m }); } }; c.on('message', f); c.send({ ev: 'report' }); })));
  const secs = (Date.now() - t0) / 1000;
  const pct = (a, p) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p / 100 * b.length))]; };
  const summarize = (rs) => {
    const all = rs.flatMap((r) => r.samples);
    return { p50: pct(all, 50), p95: pct(all, 95), max: all.length ? Math.max(...all) : null, rendersPerS: +(rs.reduce((a, r) => a + r.samples.length, 0) / rs.length / secs).toFixed(1), kBps: +(rs.reduce((a, r) => a + r.hotBytes, 0) / rs.length / 1024 / (secs + WARM / 1000)).toFixed(0), fieldsPerS: +(rs.reduce((a, r) => a + r.fieldsPainted, 0) / rs.length / (secs + WARM / 1000)).toFixed(1), stale: rs.reduce((a, r) => a + r.stale, 0), channel: rs[0].channel };
  };
  const cpuS = ((s1.cpu.user - s0.cpu.user) + (s1.cpu.system - s0.cpu.system)) / 1e6;
  const ticks = s1.ticks - s0.ticks;
  const phoneRows = series.flatMap((r) => r.phones);
  const out = {
    variant: VARIANT, deflate: env.DEFLATE === '1', link, durS: +secs.toFixed(1),
    server: { cpuPct: +(cpuS / secs * 100).toFixed(1), tickHz: +(ticks / secs).toFixed(1), frameBytes: s1.lastFrameBytes,
      phoneSentKBps: +(s1.clients.filter((c) => c.name.startsWith('phone')).reduce((a, c) => a + c.bytes, 0) / PHONES / 1024 / (secs + WARM / 1000)).toFixed(0),
      phoneSkips: s1.clients.filter((c) => c.name.startsWith('phone')).map((c) => c.skips) },
    phones: summarize(reports.filter((r) => r.name.startsWith('phone'))),
    desktops: summarize(reports.filter((r) => r.name.startsWith('desktop'))),
    backlog: { maxWsBuffered: Math.max(0, ...phoneRows.map((p) => p.wsBuffered || 0)), maxBacklogBytes: Math.max(0, ...phoneRows.map((p) => p.backlog || 0)), avgBacklogBytes: Math.round(phoneRows.reduce((a, p) => a + (p.backlog || 0), 0) / Math.max(1, phoneRows.length)), maxLinkQueue: Math.max(0, ...series.map((r) => r.tcpQueue + r.udpQueue)) },
    udpDropped: udp.reduce((a, u) => a + u.dropped, 0),
    series: env.SERIES ? series : undefined,
  };
  console.log(JSON.stringify(out));
  if (env.OUT) fs.writeFileSync(env.OUT, JSON.stringify(out, null, 1));
  for (const c of children) c.kill();
  server.kill(); tcp.close(); for (const u of udp) u.close();
  process.exit(0);
}
