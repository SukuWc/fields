// Field coalesce (remote-host) and send-buffer skip (room._publish): a slow
// client must not fall seconds behind the server while a fresh joiner is current.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { SimCore } from '../src/host.js';
import { encodeFieldGrids, decodeFieldGrids } from '../src/fieldPainter.js';
import { encodeFieldText } from '../src/field-codec.js';
import { startServer } from '../apps/server/index.js';
import { SEND_BUF_MAX } from '../apps/server/room.js';
import { RemoteHost } from '../src/remote-host.js';
import { parseServerMessage } from '../src/wire-codec.js';

let failed = 0;
const quiet = console.log;
const check = (name, ok, extra = '') => { quiet((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
console.log = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { mapW: 100, mapH: 200, simRes: '4f' };
const tex = () => ({ image: { data: new Uint8Array(0) } });
const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
const plot = { plotType: 3, contrastExp: 0 };

function fieldPair() {
  const core = new SimCore({ mapW: 50, mapH: 100, simRes: '2f', oversampling: 8 });
  core.command({ type: 'restart', scenario: 0 });
  core.tick({ dt: 1 / 30, held: [], present: false, view });
  const g1 = decodeFieldGrids(encodeFieldGrids(core.bm, plot));
  const e1 = encodeFieldText(g1, 1, null);
  core.tick({ dt: 1 / 30, held: [], present: false, view });
  const g2 = decodeFieldGrids(encodeFieldGrids(core.bm, plot));
  const e2 = encodeFieldText(g2, 2, { seq: 1, msg: e1.shown });
  core.tick({ dt: 1 / 30, held: [], present: false, view });
  const g3 = decodeFieldGrids(encodeFieldGrids(core.bm, plot));
  const e3 = encodeFieldText(g3, 3, null); // keyframe
  return { k1: e1.m, d2: e2.m, k3: e3.m };
}

// 1. Unit: stash without paint; drop delta while behind; keyframe replaces stash.
{
  class FakeWS { constructor() { this.readyState = 1; this.sent = []; } send(s) { this.sent.push(parseServerMessage(s)); } close() {} }
  const { k1, d2, k3 } = fieldPair();
  const paints = [];
  const h = new RemoteHost('ws://fake', opts, tex(), { WebSocketImpl: FakeWS });
  h._painter = { paintGrids: (msg) => paints.push(msg) };
  h.ws.onmessage({ data: JSON.stringify({ type: 'info', info: { mode: 'server', scenarios: [] } }) });
  h._field.on = true;

  h.ws.onmessage({ data: JSON.stringify(k1) });
  check('field stashed, not painted yet', paints.length === 0 && !!h._latestField && h.fieldsReceived === 0);

  h.ws.onmessage({ data: JSON.stringify({ type: 'frame', frame: { tick: 1 } }) });
  await sleep(30);
  check('deliver paints the stashed keyframe with the frame',
    paints.length === 1 && h.fieldsReceived === 1 && h.lastFrame && h.lastFrame.tick === 1,
    `paints ${paints.length} fields ${h.fieldsReceived}`);

  // Behind: pending field + scheduled deliver → delta dropped, keyframe asked.
  h._latestField = { m: k1 };
  h._scheduled = true;
  const resyncs = h.fieldResyncs;
  const drops = h.fieldsDropped;
  h.ws.onmessage({ data: JSON.stringify(d2) });
  check('delta while behind is dropped, held cleared, keyframe asked once',
    h._latestField == null && h._fieldHeld == null && h.fieldResyncs === resyncs + 1
    && h.fieldsDropped === drops + 1 && h._fieldAsked
    && h.ws.sent.some((m) => m.type === 'field' && m.on === true),
    `resyncsΔ ${h.fieldResyncs - resyncs} dropΔ ${h.fieldsDropped - drops}`);

  // Keyframe while behind replaces stash.
  h._scheduled = true;
  h.ws.onmessage({ data: JSON.stringify(k3) });
  check('keyframe while behind replaces the stash',
    h._latestField && h._latestField.m.seq === 3 && h._fieldAsked === false);
  h._latest = { tick: 3 };
  h._deliver();
  check('keyframe is painted on deliver',
    h.fieldsReceived >= 2 && paints.length >= 2 && h.lastFrame.tick === 3,
    `fields ${h.fieldsReceived} paints ${paints.length}`);
  h.terminate();
}

// 2. Server skips a client with a full outbound buffer; after drain, keyframes resume.
{
  check('SEND_BUF_MAX is 256KiB', SEND_BUF_MAX === 256 * 1024);
  const srv = await startServer({ port: 0, graceMs: 0 });
  const host = new RemoteHost(`ws://127.0.0.1:${srv.port}/?room=buf`, opts, tex(), { WebSocketImpl: WebSocket, coalesce: false });
  await host.ready;
  await host.command({ type: 'restart', scenario: 0 });
  host.setField({ on: true, plotType: 3, contrastExp: 0 });
  await sleep(150);
  const r = srv.rooms.get('buf');
  const client = [...r.clients][0];
  const sent = [];
  const origSend = client.send.bind(client);
  client.send = (...a) => { sent.push(1); return origSend(...a); };
  Object.defineProperty(client, 'bufferedAmount', { configurable: true, get: () => SEND_BUF_MAX + 1 });
  const skips0 = r.sendSkips;
  const n0 = sent.length;
  await sleep(400);
  check('full buffer: further publishes are skipped (no sends)',
    r.sendSkips > skips0 && sent.length === n0,
    `skipsΔ ${r.sendSkips - skips0} sendsΔ ${sent.length - n0}`);
  const skips1 = r.sendSkips;
  r._skipClient(client);
  check('skip increments sendSkips', r.sendSkips === skips1 + 1);
  Object.defineProperty(client, 'bufferedAmount', { configurable: true, get: () => 0 });
  const fields = [];
  const prev = host.ws.onmessage;
  host.ws.onmessage = (e) => {
    { const m = parseServerMessage(e.data); if (m.type === 'field') fields.push(m); }
    prev.call(host.ws, e);
  };
  host.setField({ on: true, plotType: 3, contrastExp: 0 });
  await sleep(500);
  check('after buffer drains, fields resume as keyframes',
    fields.length > 0 && fields.every((m) => m.base === 0),
    `n=${fields.length} bases ${fields.slice(0, 6).map((m) => m.base).join(',')}`);
  host.terminate();
  await srv.close();
}

// 3. Dual-client: slow paint on A; B joins later — both near server ticks.
{
  const root = new URL('..', import.meta.url).pathname;
  const launcher = `
    import { startServer } from ${JSON.stringify(root + '/apps/server/index.js')};
    const srv = await startServer({ port: 0, host: '127.0.0.1', fixedRooms: ['europe-1'], graceMs: 0, fieldHz: 30 });
    const room = srv.rooms.get('europe-1');
    process.stdout.write('PORT ' + srv.port + '\\n');
    setInterval(() => process.stdout.write('STAT ' + JSON.stringify({ ticks: room.ticks }) + '\\n'), 200);
  `;
  const proc = spawn(process.execPath, ['--import', root + '/test/register.mjs', '--input-type=module', '-e', launcher], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  proc.stderr.on('data', () => {});
  proc.stdout.on('data', (d) => { buf += String(d); });
  const port = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server timeout: ' + buf)), 8000);
    const checkPort = () => {
      const m = buf.match(/^PORT (\d+)/m);
      if (m) { clearTimeout(t); resolve(Number(m[1])); }
    };
    proc.stdout.on('data', checkPort);
    checkPort();
    proc.on('exit', (c) => reject(new Error('server exit ' + c + ' ' + buf)));
  });
  const lastStat = () => {
    let s = null;
    for (const line of buf.split('\n')) if (line.startsWith('STAT ')) try { s = JSON.parse(line.slice(5)); } catch {}
    return s;
  };

  const slowPaintMs = 55;
  const A = new RemoteHost(`ws://127.0.0.1:${port}/ws?room=europe-1`, opts, tex(), { WebSocketImpl: WebSocket });
  await A.ready;
  await A.command({ type: 'restart', scenario: 0 });
  A.setField({ on: true, plotType: 3, contrastExp: 0 });
  const apply = A._applyField.bind(A);
  A._applyField = (m) => {
    const t0 = performance.now();
    while (performance.now() - t0 < slowPaintMs) {}
    return apply(m);
  };
  let aTick = 0;
  A.onFrame((f) => { aTick = f.tick; });

  await sleep(3500);
  const B = new RemoteHost(`ws://127.0.0.1:${port}/ws?room=europe-1`, opts, tex(), { WebSocketImpl: WebSocket });
  await B.ready;
  let bTick = 0;
  B.onFrame((f) => { bTick = f.tick; });
  await sleep(2000);
  await sleep(300);
  const st = lastStat();
  const lagA = st.ticks - aTick;
  const lagB = st.ticks - bTick;
  check('slow field client stays within a few ticks of the server (no multi-second lag)',
    Math.abs(lagA) <= 8,
    `server ${st.ticks} A ${aTick} lag ${lagA} fDrop=${A.framesDropped} fieldDrop=${A.fieldsDropped} resyncs=${A.fieldResyncs}`);
  check('fresh joiner is current',
    Math.abs(lagB) <= 8,
    `server ${st.ticks} B ${bTick} lag ${lagB}`);
  check('slow client dropped frames/fields or resynced rather than replaying the backlog',
    A.framesDropped > 0 || A.fieldsDropped > 0 || A.fieldResyncs > 0,
    `fDrop ${A.framesDropped} fieldDrop ${A.fieldsDropped} resyncs ${A.fieldResyncs}`);

  A.terminate();
  B.terminate();
  proc.kill('SIGTERM');
  await sleep(100);
}

console.log = quiet;
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all desync checks passed');
process.exit(0);
