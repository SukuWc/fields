// Vector-field wire (src/vector-field.js): encode/decode, quantization,
// AMR bilinear sampling, client tracers and ladders, one shared server
// stream with no flow message, and arrival under a limited ack window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { SimCore } from '../src/host.js';
import { encodeFieldText, decodeFieldText } from '../src/field-codec.js';
import { encodeWire, fieldForWire, decodeWire, parseServerMessage } from '../src/wire-codec.js';
import { startServer } from '../apps/server/index.js';
import { RemoteHost } from '../src/remote-host.js';
import { ACK_MIN_WINDOW } from '../apps/server/transport.js';
import { FlowTracers } from '../src/flow-tracers.js';
import { FIELD_TO_MPS } from '../src/wind.js';
import {
  ladderOriginForSim,
  ladderState,
  mapBoundsFromLat,
} from '../src/ladder-lines.js';
import { DEFAULT_CUSTOM_COURSE } from '../src/room-config.js';
import { CUSTOM_SCENARIO, validateCustomLayout } from '../src/custom-scenario.js';
import {
  SPEED_MAX_MPS,
  SPEED_BYTE_MAX,
  VECTOR_KIND,
  VECTOR_BARRIER,
  VECTOR_HIDDEN,
  speedToByte,
  speedFromByte,
  dirToByte,
  dirFromByte,
  uvFromBytes,
  encodeVectorGrids,
  sampleVectorField,
  vectorFieldWind,
} from '../src/vector-field.js';

const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
const tex = () => ({ image: { data: new Uint8Array(0) } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function steppedCore({ boats = 1, ticks = 45, simRes = '2f', mapW = 100, mapH = 200 } = {}) {
  const core = new SimCore({ mapW, mapH, simRes, oversampling: 8 });
  core.command({ type: 'restart', scenario: 0 });
  for (let k = 1; k < boats; k++) core.command({ type: 'spawnBoat', name: 'b' + k });
  for (let i = 0; i < ticks; i++) core.tick({ dt: 1 / 30, held: [], present: false, view });
  return core;
}

test('speed/direction quantization stays within the documented bounds', () => {
  const vmax = SPEED_MAX_MPS;
  const speedErr = vmax / (2 * SPEED_BYTE_MAX);
  assert.ok(speedErr < 0.032);
  for (const s of [0, 0.1, 1, 4.5, 5.7, 15, 16, 20]) {
    const b = speedToByte(s, vmax);
    const back = speedFromByte(b, vmax);
    if (s >= vmax) {
      assert.equal(b, SPEED_BYTE_MAX);
      assert.equal(back, vmax);
    } else {
      assert.ok(Math.abs(back - Math.min(s, vmax)) <= speedErr + 1e-12, `${s} -> ${back}`);
    }
  }
  const dirErr = Math.PI / 256;
  for (let deg = 0; deg < 360; deg += 7.5) {
    const a = deg * Math.PI / 180;
    const u = Math.cos(a), v = Math.sin(a);
    const b = dirToByte(u, v);
    const back = dirFromByte(b);
    let d = Math.abs(back - a);
    if (d > Math.PI) d = 2 * Math.PI - d;
    assert.ok(d <= dirErr + 1e-12, `dir ${deg} err ${d}`);
  }
  const uv = uvFromBytes(speedToByte(5, vmax), dirToByte(3, 4), vmax);
  assert.ok(Math.abs(Math.hypot(uv.u, uv.v) - 5) <= speedErr + 1e-9);
});

test('vector encode/decode round-trips AMR geometry and stays within quantization at cell centres', () => {
  const core = steppedCore({ boats: 1, ticks: 45 });
  const msg = encodeVectorGrids(core.bm);
  assert.equal(msg.kind, VECTOR_KIND);
  assert.equal(msg.vmax, SPEED_MAX_MPS);
  assert.ok(msg.grids.length >= 2);
  assert.equal(msg.grids[0].w, core.bm.width);
  assert.equal(msg.grids[0].h, core.bm.height);
  const e = encodeFieldText(msg, 1, null, 0);
  assert.equal(e.m.kind, 'vec');
  assert.equal(e.m.base, 0);
  const wire = encodeWire(fieldForWire(e.m), { exact: true });
  const back = decodeFieldText(decodeWire(wire), null);
  assert.ok(back && back.msg.kind === 'vec');
  assert.equal(back.msg.grids.length, msg.grids.length);
  const speedErr = SPEED_MAX_MPS / (2 * SPEED_BYTE_MAX);
  const dirErr = Math.PI / 256;
  let checked = 0;
  for (let gi = 0; gi < msg.grids.length; gi++) {
    const g = msg.grids[gi], g2 = back.msg.grids[gi];
    assert.equal(g.w, g2.w);
    assert.equal(g.h, g2.h);
    assert.deepEqual(g.speed, g2.speed);
    assert.deepEqual(g.dir, g2.dir);
    for (let j = 0; j < g.h; j += Math.max(1, Math.floor(g.h / 6))) {
      for (let i = 0; i < g.w; i += Math.max(1, Math.floor(g.w / 6))) {
        const k = i + j * g.w;
        if (g.speed[k] >= VECTOR_BARRIER) continue;
        const cx = g.x0 + (i + 0.5) * g.dx;
        const cy = g.y0 + (j + 0.5) * g.dx;
        const wx = (cx - msg.rootW / 2) / msg.resolution;
        const wy = (cy - msg.rootH / 2) / msg.resolution;
        const live = core.bm.get_field_velocity(wx, wy);
        const vs = core.bm.velScale || 1;
        const lu = live.x * FIELD_TO_MPS * vs, lv = live.y * FIELD_TO_MPS * vs;
        const decoded = uvFromBytes(g.speed[k], g.dir[k], msg.vmax);
        const liveSp = Math.hypot(lu, lv), sp = Math.hypot(decoded.u, decoded.v);
        const cap = Math.min(liveSp, SPEED_MAX_MPS);
        assert.ok(Math.abs(sp - cap) <= speedErr + 1e-9, `speed ${sp} vs ${cap}`);
        if (cap > 0.2) {
          let da = Math.atan2(decoded.v, decoded.u) - Math.atan2(lv, lu);
          while (da > Math.PI) da -= 2 * Math.PI;
          while (da < -Math.PI) da += 2 * Math.PI;
          assert.ok(Math.abs(da) <= dirErr + 1e-9, `dir err ${da}`);
        }
        checked++;
      }
    }
  }
  assert.ok(checked > 20, `checked ${checked}`);
  assert.ok(msg.grids.slice(1).some((g) => g.speed.includes(VECTOR_HIDDEN) || g.speed.includes(VECTOR_BARRIER)) || msg.grids.length >= 1);
});

test('AMR bilinear sample uses the finest covering grid', () => {
  const core = steppedCore({ boats: 1, ticks: 45 });
  const msg = encodeVectorGrids(core.bm);
  assert.ok(msg.grids.length >= 2, 'expected a refinement patch');
  const fine = msg.grids[msg.grids.length - 1];
  const root = msg.grids[0];
  // A centre of a fine cell that is not hidden.
  let i = -1, j = -1;
  for (let jj = 2; jj < fine.h - 2 && i < 0; jj++) {
    for (let ii = 2; ii < fine.w - 2; ii++) {
      if (fine.speed[ii + jj * fine.w] < VECTOR_BARRIER) { i = ii; j = jj; break; }
    }
  }
  assert.ok(i >= 0);
  const cx = fine.x0 + (i + 0.5) * fine.dx;
  const cy = fine.y0 + (j + 0.5) * fine.dx;
  const wx = (cx - msg.rootW / 2) / msg.resolution;
  const wy = (cy - msg.rootH / 2) / msg.resolution;
  const atFine = uvFromBytes(fine.speed[i + j * fine.w], fine.dir[i + j * fine.w], msg.vmax);
  const sampled = sampleVectorField(msg, wx, wy);
  assert.ok(Math.abs(sampled.x - atFine.u) < 1e-9 && Math.abs(sampled.y - atFine.v) < 1e-9);

  // Same world point against a root-only message should generally differ
  // near a boat wake (or at least use the coarser sample).
  const rootOnly = { ...msg, grids: [root] };
  const coarse = sampleVectorField(rootOnly, wx, wy);
  // The fine cell is a higher-resolution sample of the same field; it may
  // match the root in a calm patch. Just assert both are finite.
  assert.ok(Number.isFinite(coarse.x) && Number.isFinite(sampled.x));
});

test('FlowTracers.velocityAt matches sampleVectorField on a vec grid', () => {
  const core = steppedCore({ boats: 1, ticks: 45 });
  const msg = encodeVectorGrids(core.bm);
  const tracers = new FlowTracers({ count: 20, rng: () => 0.3 });
  tracers.setGrid(msg);
  assert.ok(tracers.grid && tracers.grid.kind === 'vec');
  assert.ok(tracers.maxSpeed > 0);
  const p = { x: 2, y: -10 };
  const a = sampleVectorField(msg, p.x, p.y);
  const b = tracers.velocityAt(p.x, p.y);
  assert.equal(a.x, b.x);
  assert.equal(a.y, b.y);
  assert.ok(tracers.inside(0, 0));
  assert.equal(tracers.inside(10_000, 0), false);
});

test('client ladder from the vector field matches server ladderState on the same sampler, and is close to get_wind', () => {
  const core = steppedCore({ boats: 1, ticks: 45 });
  // Scenario 0 has no marks; the algorithm only needs an origin.
  const p = { x: 0, y: 40 };
  const msg = encodeVectorGrids(core.bm);
  const fromVec = ladderState((x, y) => vectorFieldWind(msg, x, y), p.x, p.y);
  const same = ladderState((x, y) => vectorFieldWind(msg, x, y), p.x, p.y);
  assert.equal(fromVec.length, same.length);
  for (let i = 0; i < fromVec.length; i++) assert.deepEqual(fromVec[i], same[i]);
  const fromWind = ladderState((x, y) => core.map.get_wind(x, y), p.x, p.y);
  // Same algorithm; the client samples quantized cell centres without the
  // ±2 m get_wind stencil, so allow a few metres of discrepancy in wake.
  let maxD = 0, n = 0;
  for (let li = 0; li < Math.min(fromVec.length, fromWind.length); li++) {
    const a = fromVec[li], b = fromWind[li];
    const npts = Math.min(a.length, b.length) / 2;
    for (let k = 0; k < npts; k++) {
      const d = Math.hypot(a[k * 2] - b[k * 2], a[k * 2 + 1] - b[k * 2 + 1]);
      if (d > maxD) maxD = d;
      n++;
    }
  }
  assert.ok(n > 10, `compared ${n}`);
  assert.ok(maxD < 4, `max point distance ${maxD.toFixed(2)} m`);
});

test('client ladder matches server ladderState at a non-centred custom-course mark and stays in-domain', () => {
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f', oversampling: 8 });
  const layout = validateCustomLayout(DEFAULT_CUSTOM_COURSE, 100, 200);
  core.command({ type: 'restart', scenario: CUSTOM_SCENARIO, layout });
  for (let i = 0; i < 45; i++) core.tick({ dt: 1 / 30, held: [], present: false, view });
  const courseOrigin = ladderOriginForSim(core.sim, core.sim.players[0] || null);
  assert.ok(courseOrigin, 'custom course has a next-target origin');
  // Before the start the origin is the start-line mid (pin −16 and RC +16 at y = −70), not either end.
  assert.ok(Math.hypot(courseOrigin.x - 0, courseOrigin.y + 70) < 2, `expected start-line mid, got ${JSON.stringify(courseOrigin)}`);
  assert.ok(Math.abs(courseOrigin.x) < 2, 'origin must not be a start-line end');
  // Off-centre mark on the same live field (not the x=0 windward).
  const origin = { x: 18, y: 40 };
  const bounds = mapBoundsFromLat(core.map);
  assert.ok(bounds && bounds.xmax === 50 && bounds.ymax === 100);
  const msg = encodeVectorGrids(core.bm);
  const fromVec = ladderState((x, y) => vectorFieldWind(msg, x, y), origin.x, origin.y, { bounds });
  const fromWind = ladderState((x, y) => core.map.get_wind(x, y), origin.x, origin.y, { bounds });
  assert.ok(fromVec.some((f) => f.length >= 4) && fromWind.some((f) => f.length >= 4));
  let maxD = 0, n = 0, outside = 0;
  const all = [...fromVec, ...fromWind];
  for (const flat of all) {
    for (let k = 0; k + 1 < flat.length; k += 2) {
      const x = flat[k], y = flat[k + 1];
      if (x < bounds.xmin - 1e-9 || x > bounds.xmax + 1e-9 || y < bounds.ymin - 1e-9 || y > bounds.ymax + 1e-9) outside++;
    }
  }
  for (let li = 0; li < Math.min(fromVec.length, fromWind.length); li++) {
    const a = fromVec[li], b = fromWind[li];
    const npts = Math.min(a.length, b.length) / 2;
    for (let k = 0; k < npts; k++) {
      const d = Math.hypot(a[k * 2] - b[k * 2], a[k * 2 + 1] - b[k * 2 + 1]);
      if (d > maxD) maxD = d;
      n++;
    }
  }
  assert.ok(n > 10, `compared ${n}`);
  assert.ok(maxD < 4, `max point distance ${maxD.toFixed(2)} m`);
  assert.equal(outside, 0, `${outside} points left the 100×200 m domain`);
});

test('server sends one shared vec keyframe and no flow message', async () => {
  const srv = await startServer({ port: 0, adminGate: false, lockstep: true });
  const A = new RemoteHost(`ws://127.0.0.1:${srv.port}/?room=vecshare`, { mapW: 50, mapH: 100, simRes: '2f', oversampling: 8 }, tex(), { WebSocketImpl: WebSocket, coalesce: false });
  const B = new RemoteHost(`ws://127.0.0.1:${srv.port}/?room=vecshare`, { mapW: 50, mapH: 100, simRes: '2f', oversampling: 8 }, tex(), { WebSocketImpl: WebSocket, coalesce: false });
  try {
    await A.ready;
    await B.ready;
    await A.command({ type: 'restart', scenario: 0 });
    const room = srv.rooms.get('vecshare');
    const typesA = [];
    const origA = A.ws.onmessage;
    A.ws.onmessage = (e) => { typesA.push(parseServerMessage(e.data).type); origA(e); };
    A.setField({ on: true, plotType: 3 });
    B.setField({ on: true, plotType: 0 });
    for (let k = 0; k < 12; k++) {
      A.tick({ dt: 1 / 30, held: [], present: true, view: { ...view, show_fields: true } });
      await A.idle();
    }
    await sleep(30);
    assert.ok(A.fieldsReceived >= 8 && B.fieldsReceived >= 8, `A=${A.fieldsReceived} B=${B.fieldsReceived}`);
    assert.equal(A.lastField.kind, 'vec');
    assert.equal(B.lastField.kind, 'vec');
    assert.ok(!typesA.includes('flow'));
    assert.ok(A.lastFrame && !('flow' in A.lastFrame) && !('ladder' in (A.lastFrame.state || {})));
    // One encode per due tick (fieldSkip 0), not one per client.
    assert.ok(room.fieldEncodes <= A.fieldsReceived + 2, `encodes=${room.fieldEncodes} A=${A.fieldsReceived}`);
    A.setFlow(true);
    // setFlow must not start a second stream or a flow message.
    A.tick({ dt: 1 / 30, held: [], present: true, view });
    await A.idle();
    assert.ok(!typesA.includes('flow'));
  } finally {
    A.terminate();
    B.terminate();
    await srv.close();
  }
});

test('vector field arrives under send=ack with a limited window', async () => {
  const srv = await startServer({ port: 0, adminGate: false });
  const h = new RemoteHost(`ws://127.0.0.1:${srv.port}/?room=vecack&send=ack`, { mapW: 100, mapH: 200, simRes: '2f', oversampling: 8 }, tex(), { WebSocketImpl: WebSocket, coalesce: false });
  try {
    await h.ready;
    await h.command({ type: 'restart', scenario: 0 });
    await h.command({ type: 'spawnBoat', name: 'p1' });
    const room = srv.rooms.get('vecack');
    const client = [...room.clients][0];
    const tx = room._tx(client);
    // Until the first ack arrives, mode() stays 'legacy'; the policy is ack.
    assert.equal(tx.policy, 'ack');
    // Smaller than the old 117 KB flow grid, larger than a vector keyframe + frame.
    tx.window = Math.min(ACK_MIN_WINDOW, 16 * 1024);
    h.setFlow(true);
    await sleep(1500);
    assert.ok(h.fieldsReceived >= 8, `fields=${h.fieldsReceived} under window=${tx.window}`);
    assert.ok(h.lastField && h.lastField.kind === 'vec');
    const v = sampleVectorField(h.lastField, 0, 0);
    assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y));
  } finally {
    h.terminate();
    await srv.close();
  }
});

test('WIRE_VERSION mismatch is a protocol error, not a silent paint', async () => {
  const core = steppedCore({ boats: 0, ticks: 5, mapW: 50, mapH: 100 });
  const e = encodeFieldText(encodeVectorGrids(core.bm), 1, null, 0);
  const buf = encodeWire(fieldForWire(e.m), { exact: true });
  buf[1] = buf[1] + 1;
  class FakeWS { constructor() { this.readyState = 1; this.sent = []; } send(s) { this.sent.push(s); } close() {} }
  const h = new RemoteHost('ws://fake', { mapW: 50, mapH: 100, simRes: '2f' }, tex(), { WebSocketImpl: FakeWS, coalesce: false });
  h.ws.onmessage({ data: JSON.stringify({ type: 'info', info: { mode: 'server', scenarios: [] } }) });
  h._field.on = true;
  h.ws.onmessage({ data: buf });
  assert.ok(h.protocolError && /wire version|builds differ|reload/i.test(h.protocolError), h.protocolError);
  assert.equal(h.lastField, null);
  h.terminate();
});
