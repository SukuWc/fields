// Field text stream (src/field-codec.js, apps/server/room.js _fieldMessages):
//   1. Codec: keyframes decode to the grids sent; payload is base64url RLE.
//   2. Malformed keyframe data is refused (null). Legacy delta-without-base
//      still refused (codec keeps decode for old servers).
//   3. Image: remote texture after keyframes vs local paint of the same lattice.
//   4. Bytes/s for keyframes at fieldSkip 0 / 1 / 2 (printed).
//   5. Server: keyframes only; fieldSkip N → send every (N + 1) ticks.
import { WebSocket } from 'ws';
import { SimCore } from '../src/host.js';
import { FieldPainter, encodeFieldGrids, decodeFieldGrids, FIELD_BARRIER } from '../src/fieldPainter.js';
import { encodeFieldText, decodeFieldText } from '../src/field-codec.js';
import { startServer } from '../apps/server/index.js';
import { RemoteHost } from '../src/remote-host.js';
import { settingDefault } from '../src/settings-registry.js';

let failed = 0;
const quiet = console.log;
const check = (name, ok, extra = '') => { quiet((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
console.log = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
const tex = () => ({ image: { data: new Uint8Array(0) } });
const plot = { plotType: 3, contrastExp: 0 };
const gridsOf = (core) => decodeFieldGrids(encodeFieldGrids(core.bm, plot));

function core0(boats, simRes = '4f', texture = undefined) {
  const core = new SimCore({ mapW: 100, mapH: 200, simRes, texture, oversampling: 8 });
  core.command({ type: 'restart', scenario: 0 });
  for (let k = 1; k < boats; k++) core.command({ type: 'spawnBoat', name: 'b' + k });
  return core;
}

// Stream ticks as keyframes only (what the server sends now).
function streamKeys(core, ticks) {
  let cPrev = null, seq = 0;
  const r = { frames: 0, bytes: 0, maxBytes: 0, encMs: 0, exact: true, maxErr: 0, specialExact: true, decoded: true };
  for (let t = 0; t < ticks; t++) {
    core.tick({ dt: 1 / 30, held: [], present: false, view });
    const t0 = performance.now();
    const m = gridsOf(core);
    const e = encodeFieldText(m, ++seq, null, 0);
    const s = JSON.stringify(e.m);
    r.encMs += performance.now() - t0;
    const d = decodeFieldText(JSON.parse(s), null);
    if (!d) { r.decoded = false; break; }
    for (let k = 0; k < m.grids.length; k++) {
      const a = d.msg.grids[k].values, v = m.grids[k].values;
      for (let i = 0; i < v.length; i++) {
        if (a[i] !== v[i]) r.exact = false;
        if (v[i] >= FIELD_BARRIER || a[i] >= FIELD_BARRIER) { if (a[i] !== v[i]) r.specialExact = false; continue; }
        r.maxErr = Math.max(r.maxErr, Math.abs(a[i] - v[i]));
      }
    }
    r.frames++; r.bytes += s.length; r.maxBytes = Math.max(r.maxBytes, s.length);
    cPrev = d;
  }
  r.last = cPrev;
  return r;
}

check('fieldSkip default is 0', settingDefault('fieldSkip') === 0);

// 1. Codec keyframes.
{
  const r0 = streamKeys(core0(2), 30);
  check('keyframe stream: every frame decodes to exactly the lattice bytes', r0.decoded && r0.exact && r0.maxErr === 0 && r0.specialExact, `${r0.frames} keys`);
  const ma = gridsOf(core0(1));
  const allKey = encodeFieldText(ma, 1, null).m;
  check('keyframe: base 0, every grid coded alone, payload is plain base64url text', allKey.base === 0 && allKey.g.every((g) => g[5] === -1 && /^[A-Za-z0-9_-]*$/.test(g[6])));

  // 2. Refusals (legacy delta path still in codec).
  const c = core0(1);
  c.tick({ dt: 1 / 30, held: [], present: false, view });
  const m1 = gridsOf(c), k1 = encodeFieldText(m1, 5, null);
  c.tick({ dt: 1 / 30, held: [], present: false, view });
  const d2 = encodeFieldText(gridsOf(c), 6, { seq: 5, msg: k1.shown }).m;
  check('legacy delta without its base: refused', decodeFieldText(d2, null) === null && decodeFieldText(d2, { seq: 4, msg: m1 }) === null);
  check('legacy delta on its base: still decodes', !!decodeFieldText(d2, decodeFieldText(k1.m, null)));
  const bad = JSON.parse(JSON.stringify(k1.m)); bad.g[0][6] = bad.g[0][6].slice(0, -3);
  const bad2 = JSON.parse(JSON.stringify(k1.m)); bad2.g[0][6] = '!' + bad2.g[0][6];
  check('truncated or invalid data: refused', decodeFieldText(bad, null) === null && decodeFieldText(bad2, null) === null && decodeFieldText({ type: 'field' }, null) === null);
}

// 3. Image: remote keyframes vs local paint.
for (const _ of (process.env.FD_QUICK ? [] : [0])) {
  const local = tex();
  const core = core0(1, '4f', local);
  for (let t = 0; t < 60; t++) core.tick({ dt: 1 / 30, held: [], present: false, view });
  const r = streamKeys(core, 30);
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
  check('remote texture after 30 keyframes matches local paint', same && max <= 7,
    `${remote.image.width}x${remote.image.height}, max channel diff ${max}, pixels differing ${(100 * px / (a.length / 4)).toFixed(1)}%`);
}

// 4. Bytes/s for keyframes at skip 0 / 1 / 2 (1 boat, scenario 0, 4f).
const bandwidth = {};
for (const boats of (process.env.FD_QUICK ? [] : [1])) {
  const core = core0(boats);
  for (let t = 0; t < 30; t++) core.tick({ dt: 1 / 30, held: [], present: false, view });
  const raw = encodeFieldGrids(core.bm, plot).length;
  const r = streamKeys(core0(boats), 60);
  const per = r.bytes / r.frames;
  for (const skip of [0, 1, 2]) {
    const hz = 30 / (skip + 1);
    const kBs = per * hz / 1024;
    bandwidth[skip] = kBs;
    check(`keyframe bytes, ${boats} boat, skip ${skip}`, per < raw,
      `${Math.round(per)} B/key × ${hz.toFixed(1)} Hz → ${kBs.toFixed(1)} KB/s; raw ${raw} B; encode ${(r.encMs / 60).toFixed(2)} ms/key`);
  }
}
if (Object.keys(bandwidth).length) quiet('BANDWIDTH_KB_S ' + JSON.stringify(bandwidth));

// 5. Server: keyframes only + fieldSkip cadence.
{
  const srv = await startServer({ port: 0, lockstep: true });
  const url = `ws://127.0.0.1:${srv.port}/?room=keys`;
  const opts = { mapW: 50, mapH: 100, simRes: '2f', oversampling: 8 };
  const A = new RemoteHost(url, opts, tex(), { WebSocketImpl: WebSocket, coalesce: false });
  await A.ready;
  await A.command({ type: 'restart', scenario: 0 });
  const room = srv.rooms.get('keys');
  check('room default fieldSkip is 0', room.core.settings.fieldSkip === 0);
  const msgs = [];
  const tap = (h, list) => { const o = h.ws.onmessage; h.ws.onmessage = (e) => { if (typeof e.data === 'string' && e.data.startsWith('{"type":"field"')) list.push(JSON.parse(e.data)); o(e); }; };
  tap(A, msgs);
  A.setField({ on: true, plotType: 3, contrastExp: 0 });
  const run = async (n) => { const f0 = A.framesReceived; for (let k = 0; k < n; k++) A.tick({ dt: 1 / 30, held: [], present: true, view }); for (let w = 0; w < 500 && A.framesReceived < f0 + n; w++) await sleep(10); await sleep(30); };
  await run(20);
  check('every field message is a keyframe (base 0)', msgs.length >= 19 && msgs.every((m) => m.base === 0),
    `${msgs.length} msgs, bases ${msgs.slice(0, 4).map((m) => m.base).join(',')}`);
  check('at fieldSkip 0, roughly one keyframe per tick', msgs.length >= 18 && msgs.length <= 22, `${msgs.length} in ~20 ticks`);

  // fieldSkip 2 → every 3rd tick.
  msgs.length = 0;
  await A.command({ type: 'fieldSkip', n: 2 });
  check('fieldSkip 2 persisted in room state', room.core.settings.fieldSkip === 2);
  // Align: next due at ticks % 3 === 0 after the command; run enough ticks.
  await run(30);
  const expectedMin = 8, expectedMax = 12; // ~30/3 = 10
  check('fieldSkip 2: about one keyframe every 3 ticks', msgs.length >= expectedMin && msgs.length <= expectedMax && msgs.every((m) => m.base === 0),
    `${msgs.length} msgs in ~30 ticks (expect ~10)`);

  const B = new RemoteHost(url, opts, tex(), { WebSocketImpl: WebSocket, coalesce: false });
  await B.ready;
  check('joiner sees current fieldSkip in welcome room state', B.room && B.room.settings && B.room.settings.fieldSkip === 2,
    JSON.stringify(B.room && B.room.settings && B.room.settings.fieldSkip));
  const bm = []; tap(B, bm);
  B.setField({ on: true, plotType: 3, contrastExp: 0 });
  await sleep(50);
  await run(9);
  check('second subscriber also gets keyframes only', bm.length >= 2 && bm.every((m) => m.base === 0),
    `B ${bm.length} msgs bases ${bm.slice(0, 4).map((m) => m.base).join(',')}`);

  B.setField({ plotType: 0 });
  const b0 = bm.length;
  await sleep(50);
  await run(6);
  check('plot change: next due message is still a keyframe of the new plot',
    bm.slice(b0).some((m) => m.base === 0 && m.p === 0) && B.lastField && B.lastField.plotType === 0,
    `after ${bm.length - b0} msgs`);

  // Clamp / validation
  const bad = await A.command({ type: 'fieldSkip', n: 99 });
  check('fieldSkip 99 refused', bad && bad.error, JSON.stringify(bad));
  check('fieldSkip stays 2 after refused command', room.core.settings.fieldSkip === 2);

  A.terminate(); B.terminate();
  await srv.close();
}

console.log = quiet;
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all field-delta checks passed');
process.exit(0);
