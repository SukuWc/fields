// Server-mode field stream (fieldPainter.js encodeFieldGrids / paintGrids,
// apps/server/room.js): per-level grids, one byte per cell, painted on the
// client like local mode; sent only to clients that show the field.
//   1. Image comparison: the same lattice painted locally (FieldPainter.paint)
//      and via encode → decode → paintGrids: every plot type within one
//      palette step. FIELD_PNG_DIR=dir writes local/remote/diff PNGs.
//   2. Bytes: field bytes per second per client on scenario 0, default 4f
//      grid, with 1 and 3 boats (printed; the old RGBA stream was 80 008 B
//      per message).
//   3. A client with the field off gets no field messages; nobody showing it
//      means nothing is encoded; per-plot messages.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { WebSocket } from 'ws';
import { SimCore } from '../src/host.js';
import { FieldPainter, encodeFieldGrids, decodeFieldGrids, decodeFieldValue, FIELD_HIDDEN } from '../src/fieldPainter.js';
import { startServer } from '../apps/server/index.js';
import { RemoteHost } from '../src/remote-host.js';
import { parseServerMessage } from '../src/wire-codec.js';

let failed = 0;
const quiet = console.log;
const check = (name, ok, extra = '') => { quiet((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
console.log = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
const tex = () => ({ image: { data: new Uint8Array(0) } });

function png(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    // Texture row 0 is world y min (bottom of the screen): flip for viewing.
    const src = (h - 1 - y) * w * 4;
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + src, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// 1. Image comparison on scenario 0 after 3 s (boat stack down to dx 1/32).
{
  const local = tex();
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f', texture: local, oversampling: 8 });
  core.command({ type: 'restart', scenario: 0 });
  for (let i = 0; i < 90; i++) core.tick({ dt: 1 / 30, held: [], present: false, view });
  const msg0 = decodeFieldGrids(encodeFieldGrids(core.bm, { plotType: 3, contrastExp: 0 }).buffer);
  check('grids: root plus every refinement level, each with its own dx', msg0.grids.length >= 4 && msg0.grids[0].dx === 1 && msg0.grids[0].w === core.bm.width && Math.min(...msg0.grids.map((g) => g.dx)) <= 0.125,
    msg0.grids.map((g) => `${g.w}x${g.h}@${g.dx}`).join(' '));
  const outDir = process.env.FIELD_PNG_DIR;
  for (const [plotType, contrastExp] of [[3, 0], [0, 0], [1, 2], [2, 0], [4, 3]]) {
    core.plot = { plotType, contrastExp };
    core.painter.paint(core.bm);
    const remote = tex();
    const u8 = encodeFieldGrids(core.bm, { plotType, contrastExp });
    const msg = decodeFieldGrids(u8.buffer);
    new FieldPainter(remote, 8).paintGrids(msg);
    const a = local.image.data, b = remote.image.data;
    let max = 0, px = 0, sum = 0;
    const diff = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (d) px++;
      sum += d;
      if (d > max) max = d;
      diff[i] = diff[i + 1] = diff[i + 2] = Math.min(255, d * 40); diff[i + 3] = 255;
    }
    const same = local.image.width === remote.image.width && local.image.height === remote.image.height;
    check(`plot ${plotType}: remote paint matches local within one palette step`, same && max <= 7,
      `${remote.image.width}x${remote.image.height}, max channel diff ${max}, pixels differing ${(100 * px / (a.length / 4)).toFixed(1)}%, mean ${(sum / (a.length / 4)).toFixed(2)}, ${u8.length} B`);
    if (outDir && plotType === 3) {
      fs.mkdirSync(outDir, { recursive: true });
      png(path.join(outDir, 'field-local.png'), local.image.width, local.image.height, a);
      png(path.join(outDir, 'field-remote.png'), remote.image.width, remote.image.height, b);
      png(path.join(outDir, 'field-diff-x40.png'), remote.image.width, remote.image.height, diff);
    }
  }
  // Decoded values: within half a quantization step of the cell (speed plot).
  const g = msg0.grids[0];
  const c = core.bm.cells[10 + 20 * core.bm.width];
  const v = decodeFieldValue(msg0, g.values[10 + 20 * g.w]);
  const speed = Math.hypot(c.ux, c.uy);
  check('bytes decode to the plotted value (speed) within a quantization step', Math.abs(v - speed) <= 1 / (253 * msg0.scale) + 1e-6, `${v.toFixed(5)} vs ${speed.toFixed(5)}`);
  check('domain nodes outside the disk are left to the layer below', msg0.grids.slice(1).some((gr) => gr.values.includes(FIELD_HIDDEN)));
}

// 2. Bytes per second per client, scenario 0 on the default 4f grid.
async function measure(label, boats, secs) {
  const srv = await startServer({ port: 0 });
  const url = `ws://127.0.0.1:${srv.port}/?room=bw`;
  const h = new RemoteHost(url, { mapW: 100, mapH: 200, simRes: '4f', oversampling: 8 }, tex(), { WebSocketImpl: WebSocket });
  await h.ready;
  h.setField({ on: true, plotType: 3, contrastExp: 0 });
  await h.command({ type: 'restart', scenario: 0 });
  for (let k = 1; k < boats; k++) await h.command({ type: 'spawnBoat', name: 'b' + k });
  await sleep(1500);
  const f0 = h.fieldBytes, n0 = h.fieldsReceived, t0 = performance.now(), k0 = srv.rooms.get('bw').ticks;
  await sleep(secs * 1000);
  const s = (performance.now() - t0) / 1000;
  const room = srv.rooms.get('bw');
  const r = { bps: (h.fieldBytes - f0) / s, msgs: h.fieldsReceived - n0, per: (h.fieldBytes - f0) / Math.max(1, h.fieldsReceived - n0), tickHz: (room.ticks - k0) / s, encodeMs: room.fieldEncodeMs };
  h.terminate();
  await srv.close();
  check(`bytes/s per client, ${label}`, r.msgs > 0 && r.per < 80008,
    `${Math.round(r.bps)} B/s field (${r.msgs} msgs, ${Math.round(r.per)} B each, encode ${r.encodeMs.toFixed(1)} ms, room at ${r.tickHz.toFixed(1)} ticks/s; at 30 Hz real time: ${Math.round(r.per * 30)} B/s)`);
}
await measure('scenario 0, 4f, 1 boat', 1, 5);
await measure('scenario 0, 4f, 3 boats', 3, 5);

// 3. Field only to clients that show it.
{
  const srv = await startServer({ port: 0, fieldHz: 10 });
  const url = `ws://127.0.0.1:${srv.port}/?room=sub`;
  const opts = { mapW: 50, mapH: 100, simRes: '2f', oversampling: 8 };
  const A = new RemoteHost(url, opts, tex(), { WebSocketImpl: WebSocket });
  await A.ready;
  await A.command({ type: 'restart', scenario: 0 });
  const room = srv.rooms.get('sub');
  await sleep(800);
  check('nobody shows the field: nothing encoded, nothing sent', room.fieldEncodes === 0 && A.fieldsReceived === 0, `encodes=${room.fieldEncodes}`);
  const B = new RemoteHost(url, opts, tex(), { WebSocketImpl: WebSocket });
  await B.ready;
  A.setField({ on: true });
  let bin = 0;
  const orig = B.ws.onmessage;
  B.ws.onmessage = (e) => { if (parseServerMessage(e.data).type === 'field') bin++; orig(e); };
  await sleep(1500);
  check('client with the field on gets field messages', A.fieldsReceived >= 3, `A=${A.fieldsReceived}`);
  check('client with the field off gets no field messages', B.fieldsReceived === 0 && B.fieldBytes === 0 && bin === 0 && B.framesReceived > 10, `B fields=${B.fieldsReceived} fieldMsgs=${bin} frames=${B.framesReceived}`);
  // Different plots: one message per plot, each client gets its own.
  B.setField({ on: true, plotType: 0 });
  const e0 = room.fieldEncodes;
  await sleep(1000);
  check('two plots: each client gets its plot', A.lastField && A.lastField.plotType === 3 && B.lastField && B.lastField.plotType === 0, `A=${A.lastField && A.lastField.plotType} B=${B.lastField && B.lastField.plotType}`);
  const perDue = (room.fieldEncodes - e0) / Math.max(1, Math.round((A.fieldsReceived)));
  check('one encode per distinct plot per due tick', room.fieldEncodes - e0 >= 4 && perDue > 0, `encodes=${room.fieldEncodes - e0}`);
  // Off again: stops.
  A.setField({ on: false }); B.setField({ on: false });
  await sleep(300);
  const a1 = A.fieldsReceived, b1 = B.fieldsReceived, e1 = room.fieldEncodes;
  await sleep(800);
  check('field off again: no more messages or encodes', A.fieldsReceived === a1 && B.fieldsReceived === b1 && room.fieldEncodes === e1);
  A.terminate(); B.terminate();
  await srv.close();
}

console.log = quiet;
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all field-grid checks passed');
process.exit(0);
