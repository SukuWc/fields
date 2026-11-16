// Minimap math (src/minimap.js).
import { minimapTransform, cameraRect, minimapLaylines, xy } from '../src/minimap.js';
import { ladderAnchorsFromState, ladderGeometry } from '../src/ladder-lines.js';
let n = 0;
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const check = (name, ok) => { if (!ok) throw new Error('failed: ' + name); n++; };
const t = minimapTransform(75, 150, 320, 256, 6);
check('fits the taller side', near(t.s, 244 / 150));
check('centre maps to the middle', near(t.toPx(0, 0)[0], 160) && near(t.toPx(0, 0)[1], 128));
check('north is up', t.toPx(0, 10)[1] < 128);
const [wx, wy] = t.toWorld(...t.toPx(12, -30));
check('round trip', near(wx, 12) && near(wy, -30));
check('letterbox rect keeps aspect', near(t.rect[2] / t.rect[3], 0.5));
const cr = cameraRect({ camera_zoom: 30, camera_position_x: 5, camera_position_y: -5 }, 2);
check('camera rect centred on the camera', near(cr[0] + cr[2] / 2, 5) && near(cr[1] + cr[3] / 2, -5) && near(cr[2], 2 * cr[3]));
// Laylines: the main view's geometry (ladder-lines.js). The old minimap
// drew both from the target's centre at a fixed ±45° always downwind, so
// at the downwind (leeward) gate they pointed away from the boats running
// down to it, from the gate mid instead of each mark. Default course on
// the 100 × 200 m map, wind from north (twd 0, blowing toward −Y).
{
  const statics = {
    course: { n: 2, anchors: [{ x: 0, y: 65 }, { x: 0, y: -45 }], gates: [null, [{ x: -8, y: -45 }, { x: 8, y: -45 }]], start: { x: 0, y: -70 } },
    start: { a: { x: -16, y: -70 }, b: { x: 16, y: -70 }, mid: { x: 0, y: -70 } },
  };
  const c = [{ x: 0, y: 65 }, [{ x: -8, y: -45 }, { x: 8, y: -45 }]];
  const opts = { twdDeg: 0, mapW: 100, mapH: 200 };
  const deg = (f) => Math.atan2(f[3] - f[1], f[2] - f[0]) * 180 / Math.PI;
  const main = (state) => ladderGeometry(() => ({ vx: 0, vy: -1 }), ladderAnchorsFromState(state, statics), { bounds: { xmin: -50, xmax: 50, ymin: -100, ymax: 100 } }).layline;
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const same = (p, q) => JSON.stringify(p.map((f) => f.map(r6))) === JSON.stringify(q.map((f) => f.map(r6)));

  // Downwind gate, running down from the windward mark.
  const gateState = { hud: { co: { i: 1, lap: 1, gate: 1 } }, course: { c } };
  const g = minimapLaylines(gateState, statics, opts);
  const fromW = g.find((f) => near(f[0], -8) && near(f[1], -45));
  const fromE = g.find((f) => near(f[0], 8) && near(f[1], -45));
  check('downwind gate: one layline from each gate mark, none from the mid', g.length === 2 && fromW && fromE && !g.some((f) => near(f[0], 0) && near(f[1], -45)));
  check('downwind gate: 20° off dead upwind on the outer side (west 110°, east 70°), running upwind', near(deg(fromW), 110) && near(deg(fromE), 70) && g.every((f) => f[3] > f[1]));
  check('downwind gate: ends on the map edge', g.every((f) => near(Math.abs(f[2]), 50) || near(Math.abs(f[3]), 100)));
  check('downwind gate: identical to the main view geometry', same(g, main(gateState)));

  // Single (windward) mark on the first beat.
  const beatState = { hud: { co: { i: 0, lap: 1 } }, course: { c } };
  const m = minimapLaylines(beatState, statics, opts);
  check('single mark: both laylines from the mark', m.length === 2 && m.every((f) => near(f[0], 0) && near(f[1], 65)));
  check('single mark: 50° off dead downwind (−140°, −40°), running downwind', m.map(deg).map(Math.round).sort((p, q) => p - q).join() === '-140,-40');
  check('single mark: identical to the main view geometry', same(m, main(beatState)));

  // Frame already carries the main view's laylines: used as they are.
  const carried = [[1, 2, 3, 4]];
  check('state.layline is reused as is', minimapLaylines({ ...gateState, layline: carried }, statics, opts) === carried);
  check('before the start: no laylines', minimapLaylines({ hud: { co: { w: 1 } }, course: { c } }, statics, opts).length === 0);
  check('no wind and nothing carried: no laylines', minimapLaylines(gateState, statics, { ...opts, twdDeg: NaN }).length === 0);
}
check('xy accepts arrays and objects', xy([1, 2])[1] === 2 && xy({ x: 3, y: 4 })[0] === 3 && xy(null) === null);
// Finish line target (downwind finish through the start line on the
// default course): the minimap shows one layline from the pin and one
// from the RC, identical to the main view, not a V from the line mid.
{
  const w = { x: 0, y: 65 };
  const statics = {
    course: { n: 3, anchors: [w, { x: 0, y: -45 }, w], gates: [null, [{ x: -8, y: -45 }, { x: 8, y: -45 }], null], start: { x: 0, y: -70 } },
    start: { a: { x: -16, y: -70 }, b: { x: 16, y: -70 }, mid: { x: 0, y: -70 } },
    finish: { a: { x: -16, y: -70 }, b: { x: 16, y: -70 }, mid: { x: 0, y: -70 } },
  };
  const state = { hud: { co: { done: 1, fin: 1 } }, course: { c: [w, [{ x: -8, y: -45 }, { x: 8, y: -45 }], w] } };
  const deg = (f) => Math.atan2(f[3] - f[1], f[2] - f[0]) * 180 / Math.PI;
  const f = minimapLaylines(state, statics, { twdDeg: 0, mapW: 100, mapH: 200 });
  const pinL = f.find((s) => near(s[0], -16) && near(s[1], -70));
  const rcL = f.find((s) => near(s[0], 16) && near(s[1], -70));
  check('finish: one layline from the pin, one from the RC, none from the mid', f.length === 2 && pinL && rcL && !f.some((s) => near(s[0], 0)));
  check('finish: 20° off dead upwind on the outer side (110°, 70°)', near(deg(pinL), 110) && near(deg(rcL), 70));
  const main = ladderGeometry(() => ({ vx: 0, vy: -1 }), ladderAnchorsFromState(state, statics), { bounds: { xmin: -50, xmax: 50, ymin: -100, ymax: 100 } }).layline;
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  check('finish: identical to the main view geometry', JSON.stringify(f.map((s) => s.map(r6))) === JSON.stringify(main.map((s) => s.map(r6))));
}
console.log(`all ${n} minimap checks passed`);
