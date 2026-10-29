// Binary wire codec (src/wire-codec.js): round trip equals the JSON path
// (JSON.parse(roundJson(m)) for frames / flow, JSON.parse(JSON.stringify(m))
// for field / perf), version check, and JSON vs binary sizes / encode time
// for a typical frame and a field keyframe.
import { SimCore } from '../src/host.js';
import { encodeFieldGrids, decodeFieldGrids } from '../src/fieldPainter.js';
import { encodeFieldText, decodeFieldText } from '../src/field-codec.js';
import { roundJson } from '../apps/server/room.js';
import { markExact } from '../src/host-protocol.js';
import { encodeWire, decodeWire, fieldForWire, WireVersionError, WIRE_VERSION } from '../src/wire-codec.js';
import { isDeepStrictEqual } from 'node:util';

let failed = 0;
function check(name, ok, info = '') { if (!ok) failed++; console.info(`${ok ? 'ok  ' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); }
const log = console.log;
const mute = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = log; } };
const view = { camera_position_x: 0, camera_position_y: 0, camera_zoom: 20, show_forces: false, show_fields: true };
const time = (fn, n = 200) => { fn(); const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t0) / n; };

// 1. Primitives / edge cases.
{
  const m = { type: 'frame', frame: { a: 1, b: -3, c: 0.123456, d: 1234.56789, e: 0.03125, f: NaN, g: Infinity, h: null, i: undefined, j: [1, undefined, 'x'], k: 'héllo ✓', l: true, m: false, n: 2 ** 40, o: -(2 ** 31), p: 255.99996, q: -0, r: { s: [0.1, 0.2] } } };
  const ex = markExact({ v: 0.123456789 }); m.frame.hud = ex;
  const d = decodeWire(encodeWire(m));
  check('primitives decode as JSON.parse(roundJson(m))', isDeepStrictEqual(d, JSON.parse(roundJson(m))), JSON.stringify(d));
  const s = 'ABCxyz-_09'; for (let L = 0; L < 10; L++) {
    const sub = s.slice(0, L); const mm = { type: 'field', seq: 1, g: [[0, 0, 1, 1, 1, -1, sub]] };
    const r = decodeWire(encodeWire(fieldForWire(mm), { exact: true }));
    if (r.g[0][6] !== sub) check('sym6 length ' + L, false, r.g[0][6]);
  }
  check('sym6 round trip, lengths 0..9', true);
  const bad = encodeWire(m); bad[1] = WIRE_VERSION + 1;
  let err = null; try { decodeWire(bad); } catch (e) { err = e; }
  check('other wire version throws WireVersionError', err instanceof WireVersionError, err && err.message);
}

// 2. Real frames and field keyframes.
for (const [scenario, ticks] of [[0, 90], [11, 200]]) {
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f', texture: undefined });
  mute(() => core.command({ type: 'restart', scenario }));
  let frame;
  let allEq = true;
  mute(() => {
    for (let t = 0; t < ticks; t++) {
      frame = core.tick({ dt: 1 / 30, held: t % 45 < 12 ? [{ type: 'helm', boat: 0, dir: 1 }] : [], present: true, view });
      const f = { ...frame, statics: undefined };
      if (t % 10 === 0 && !isDeepStrictEqual(decodeWire(encodeWire({ type: 'frame', frame: f })), JSON.parse(roundJson({ type: 'frame', frame: f })))) allEq = false;
    }
  });
  const f = { ...frame, statics: undefined };
  check(`scenario ${scenario}: frames round-trip equal to the JSON path`, allEq);
  const j = roundJson({ type: 'frame', frame: f }), b = encodeWire({ type: 'frame', frame: f });
  const tj = time(() => roundJson({ type: 'frame', frame: f })), tb = time(() => encodeWire({ type: 'frame', frame: f }));
  check(`scenario ${scenario}: binary frame smaller than JSON`, b.length < j.length, `JSON ${j.length} B → binary ${b.length} B (${Math.round(100 - 100 * b.length / j.length)}% less); encode ${tj.toFixed(3)} → ${tb.toFixed(3)} ms`);

  const plot = { plotType: 0, contrastExp: 0 };
  const grids = decodeFieldGrids(encodeFieldGrids(core.bm, plot));
  const e = encodeFieldText(grids, 1, null, 0);
  const fj = JSON.stringify(e.m), fb = encodeWire(fieldForWire(e.m), { exact: true });
  const back = decodeWire(fb);
  check(`scenario ${scenario}: field keyframe round trip equals JSON`, isDeepStrictEqual(back, JSON.parse(fj)));
  const dg = decodeFieldText(back, null);
  check(`scenario ${scenario}: field keyframe decodes to the same cells`, dg && dg.msg.grids.every((g, k) => isDeepStrictEqual(g.values, grids.grids[k].values)));
  const tfj = time(() => JSON.stringify(e.m), 50), tfb = time(() => encodeWire(fieldForWire(e.m), { exact: true }), 50);
  check(`scenario ${scenario}: binary field keyframe smaller than JSON`, fb.length < fj.length, `JSON ${fj.length} B → binary ${fb.length} B (${Math.round(100 - 100 * fb.length / fj.length)}% less); serialize ${tfj.toFixed(3)} → ${tfb.toFixed(3)} ms`);
  if (frame.flow) {
    const fl = { type: 'flow', flow: frame.flow };
    check(`scenario ${scenario}: flow round trip`, isDeepStrictEqual(decodeWire(encodeWire(fl)), JSON.parse(roundJson(fl))), `JSON ${roundJson(fl).length} B → binary ${encodeWire(fl).length} B`);
  }
}

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.info('wire-codec: all ok');
