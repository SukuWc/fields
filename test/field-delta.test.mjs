// Field text stream (src/field-codec.js, apps/server/room.js _fieldMessages):
//   1. Codec: keyframes and deltas decode to the grids sent, lossless at
//      tol 0, within tol of the lattice otherwise (barrier / hidden exact);
//      moved refinement windows are matched by their shift; a new grid
//      layout (simRes change) still decodes.
//   2. A delta against a message the receiver does not hold, or malformed
//      data, is refused (null).
//   3. Image: the remote texture after a second of deltas against a local
//      paint of the same lattice (FIELD_PNG_DIR=dir writes PNGs).
//   4. Bytes per frame at 30 Hz, scenario 0 on the default 4f grid, 1 and 3
//      boats, and the encode time (printed).
//   5. Server: a keyframe first, then deltas every tick; a client joining
//      or changing plot gets a keyframe; a client that loses step asks for
//      one and recovers; every client ends up with the server's grids.
import { WebSocket } from 'ws';
import { SimCore } from '../src/host.js';
import { FieldPainter, encodeFieldGrids, decodeFieldGrids, FIELD_BARRIER, FIELD_HIDDEN } from '../src/fieldPainter.js';
import { encodeFieldText, decodeFieldText } from '../src/field-codec.js';
import { startServer } from '../apps/server/index.js';
import { RemoteHost } from '../src/remote-host.js';

let failed = 0;
const quiet = console.log;
const check = (name, ok, extra = '') => { quiet((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
console.log = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
const tex = () => ({ image: { data: new Uint8Array(0) } });
const plot = { plotType: 3, contrastExp: 0 };
const gridsOf = (core) => decodeFieldGrids(encodeFieldGrids(core.bm, plot));
const sameLayout = (a, b) => a.grids.length === b.grids.length && a.grids.every((g, k) => g.w === b.grids[k].w && g.h === b.grids[k].h && g.x0 === b.grids[k].x0 && g.y0 === b.grids[k].y0 && g.dx === b.grids[k].dx);

function core0(boats, simRes = '4f', texture = undefined) {
  const core = new SimCore({ mapW: 100, mapH: 200, simRes, texture, oversampling: 8 });
  core.command({ type: 'restart', scenario: 0 });
  for (let k = 1; k < boats; k++) core.command({ type: 'spawnBoat', name: 'b' + k });
  return core;
}

// Stream ticks frames of core through the codec; returns stats.
function stream(core, ticks, tol) {
  let sPrev = null, cPrev = null, seq = 0;
  const r = { frames: 0, bytes: 0, maxBytes: 0, encMs: 0, exact: true, maxErr: 0, specialExact: true, shifted: 0, refs: 0, decoded: true };
  for (let t = 0; t < ticks; t++) {
    core.tick({ dt: 1 / 30, held: [], present: false, view });
    const t0 = performance.now();
    const m = gridsOf(core);
    const e = encodeFieldText(m, ++seq, sPrev, tol);
    const s = JSON.stringify(e.m);
    r.encMs += performance.now() - t0;
    const d = decodeFieldText(JSON.parse(s), cPrev);
    if (!d) { r.decoded = false; break; }
    for (let k = 0; k < m.grids.length; k++) {
      const a = d.msg.grids[k].values, b = e.shown.grids[k].values, v = m.grids[k].values;
      for (let i = 0; i < v.length; i++) {
        if (a[i] !== b[i]) r.exact = false;
        if (v[i] >= FIELD_BARRIER || a[i] >= FIELD_BARRIER) { if (a[i] !== v[i]) r.specialExact = false; continue; }
        r.maxErr = Math.max(r.maxErr, Math.abs(a[i] - v[i]));
      }
    }
    for (const g of e.m.g) if (g[5] >= 0) { r.refs++; if (g[6] || g[7]) r.shifted++; }
    if (t > 0) { r.frames++; r.bytes += s.length; r.maxBytes = Math.max(r.maxBytes, s.length); }
    sPrev = { seq, msg: e.shown }; cPrev = d;
  }
  r.last = cPrev;
  return r;
}

// 1. Codec.
{
  const r0 = stream(core0(2), 90, 0);
  check('tol 0: every frame decodes to exactly the lattice bytes', r0.decoded && r0.exact && r0.maxErr === 0 && r0.specialExact, `${r0.frames} deltas`);
  check('moved refinement windows are coded against their shifted previous grid', r0.shifted > 0, `${r0.shifted} of ${r0.refs} grid deltas shifted`);
  const r1 = stream(core0(2), 90, 1);
  check('tol 1: the client holds what the server says it holds', r1.decoded && r1.exact);
  check('tol 1: within one byte of the lattice, barrier / hidden exact', r1.maxErr <= 1 && r1.specialExact, `max err ${r1.maxErr}`);
  check('tol 1 sends less than tol 0', r1.bytes < r0.bytes, `${Math.round(r1.bytes / r1.frames)} vs ${Math.round(r0.bytes / r0.frames)} B/frame`);
  // New layout (another simRes): no grid matches, each is coded on its own.
  const a = core0(1, '4f'), b = core0(1, '2f');
  for (let t = 0; t < 30; t++) { a.tick({ dt: 1 / 30, held: [], present: false, view }); b.tick({ dt: 1 / 30, held: [], present: false, view }); }
  const ma = gridsOf(a), mb = gridsOf(b);
  const ea = encodeFieldText(ma, 1, null), eb = encodeFieldText(mb, 2, { seq: 1, msg: ea.shown });
  const db = decodeFieldText(JSON.parse(JSON.stringify(eb.m)), decodeFieldText(ea.m, null));
  check('new grid layout: a delta still decodes (grids without a match coded alone)', !!db && !sameLayout(ma, mb) && db.msg.grids.every((g, k) => Buffer.compare(Buffer.from(g.values), Buffer.from(mb.grids[k].values)) === 0));
  const allKey = encodeFieldText(ma, 1, null).m;
  check('keyframe: base 0, every grid coded alone, payload is plain base64url text', allKey.base === 0 && allKey.g.every((g) => g[5] === -1 && /^[A-Za-z0-9_-]*$/.test(g[6])));

  // 2. Refusals.
  const c = core0(1);
  c.tick({ dt: 1 / 30, held: [], present: false, view });
  const m1 = gridsOf(c), k1 = encodeFieldText(m1, 5, null);
  c.tick({ dt: 1 / 30, held: [], present: false, view });
  const d2 = encodeFieldText(gridsOf(c), 6, { seq: 5, msg: k1.shown }).m;
  check('delta without its base: refused', decodeFieldText(d2, null) === null && decodeFieldText(d2, { seq: 4, msg: m1 }) === null);
  check('delta on its base: decodes', !!decodeFieldText(d2, decodeFieldText(k1.m, null)));
  const bad = JSON.parse(JSON.stringify(k1.m)); bad.g[0][6] = bad.g[0][6].slice(0, -3);
  const bad2 = JSON.parse(JSON.stringify(k1.m)); bad2.g[0][6] = '!' + bad2.g[0][6];
  check('truncated or invalid data: refused', decodeFieldText(bad, null) === null && decodeFieldText(bad2, null) === null && decodeFieldText({ type: 'field' }, null) === null);
}

// 3. Image: remote (1 s of 30 Hz deltas) vs local paint of the same lattice.
for (const tol of (process.env.FD_QUICK ? [] : [0, 1])) {
  const local = tex();
  const core = core0(1, '4f', local);
  for (let t = 0; t < 60; t++) core.tick({ dt: 1 / 30, held: [], present: false, view });
  const r = stream(core, 30, tol);
  core.painter.paint(core.bm);
  const remote = tex();
  new FieldPainter(remote, 8).paintGrids(r.last.msg);
  const a = local.image.data, b = remote.image.data;
  let max = 0, px = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (d) px++;
    if (d > max) max = d;
  }
  const same = a.length === b.length && a.length > 0;
  check(`tol ${tol}: remote texture after 30 deltas matches local paint`, same && max <= (tol ? 9 : 7),
    `${remote.image.width}x${remote.image.height}, max channel diff ${max}, pixels differing ${(100 * px / (a.length / 4)).toFixed(1)}%`);
}

// 4. Bytes per frame (30 Hz), scenario 0, 4f.
for (const boats of (process.env.FD_QUICK ? [] : [1, 3])) {
  const core = core0(boats);
  for (let t = 0; t < 30; t++) core.tick({ dt: 1 / 30, held: [], present: false, view });
  const raw = encodeFieldGrids(core.bm, plot).length;
  const key = JSON.stringify(encodeFieldText(gridsOf(core), 1, null).m).length;
  for (const tol of [0, 1]) {
    const r = stream(core0(boats), 60, tol);
    const per = r.bytes / r.frames;
    check(`bytes, ${boats} boat${boats > 1 ? 's' : ''}, tol ${tol}`, per < raw / 4,
      `delta ${Math.round(per)} B/frame (max ${r.maxBytes}), ${(per * 30 / 1024).toFixed(1)} KB/s at 30 Hz; keyframe ${key} B; raw ${raw} B/msg (${(raw * 30 / 1024).toFixed(0)} KB/s at 30 Hz); encode ${(r.encMs / 60).toFixed(2)} ms/frame`);
  }
}

// 5. Server stream.
{
  const srv = await startServer({ port: 0, lockstep: true });
  const url = `ws://127.0.0.1:${srv.port}/?room=delta`;
  const opts = { mapW: 50, mapH: 100, simRes: '2f', oversampling: 8 };
  const A = new RemoteHost(url, opts, tex(), { WebSocketImpl: WebSocket, coalesce: false });
  await A.ready;
  await A.command({ type: 'restart', scenario: 0 });
  const room = srv.rooms.get('delta');
  const msgs = [];
  const tap = (h, list) => { const o = h.ws.onmessage; h.ws.onmessage = (e) => { if (typeof e.data === 'string' && e.data.startsWith('{"type":"field"')) list.push(JSON.parse(e.data)); o(e); }; };
  tap(A, msgs);
  A.setField({ on: true, plotType: 3, contrastExp: 0 });
  const run = async (n) => { const f0 = A.framesReceived; for (let k = 0; k < n; k++) A.tick({ dt: 1 / 30, held: [], present: true, view }); for (let w = 0; w < 500 && A.framesReceived < f0 + n; w++) await sleep(10); await sleep(30); };
  await run(20);
  check('a keyframe first, then a delta every tick', msgs.length >= 19 && msgs[0].base === 0 && msgs.slice(1).every((m, k) => m.base === msgs[k].seq), `${msgs.length} msgs, bases ${msgs.slice(0, 4).map((m) => m.base).join(',')}`);
  const B = new RemoteHost(url, opts, tex(), { WebSocketImpl: WebSocket, coalesce: false });
  await B.ready;
  const bm = []; tap(B, bm);
  const n0 = msgs.length;
  B.setField({ on: true, plotType: 3, contrastExp: 0 });
  await sleep(50);
  await run(5);
  check('a client joins: keyframe (to both, so they hold the same), then deltas again', bm.length >= 4 && bm[0].base === 0 && msgs[n0].base === 0 && bm.slice(1).every((m) => m.base > 0), `B bases ${bm.map((m) => m.base).join(',')}`);
  // A loses step: its held message no longer matches.
  A._fieldHeld = { seq: -1, msg: A._fieldHeld.msg };
  const r0 = A.fieldResyncs;
  await run(5);
  await run(3);
  check('a client that loses step asks for a keyframe and recovers', A.fieldResyncs === r0 + 1 && A._fieldHeld && A._fieldHeld.seq === room.fieldStreams.get('3|0').seq, `resyncs ${A.fieldResyncs - r0}`);
  const shown = room.fieldStreams.get('3|0').shown;
  const eq = (h) => h.lastField && h.lastField.grids.every((g, k) => Buffer.compare(Buffer.from(g.values), Buffer.from(shown.grids[k].values)) === 0);
  check('both clients hold exactly the server\'s grids', eq(A) && eq(B));
  B.setField({ plotType: 0 });
  const b0 = bm.length;
  await sleep(50);
  await run(3);
  check('plot change: keyframe of the new plot', bm[b0] && bm[b0].base === 0 && bm[b0].p === 0 && B.lastField.plotType === 0);
  A.terminate(); B.terminate();
  await srv.close();
}

console.log = quiet;
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all field-delta checks passed');
process.exit(0);
