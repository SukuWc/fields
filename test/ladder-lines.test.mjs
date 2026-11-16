// Ladder lines (src/ladder-lines.js): straight lines square to the wind
// sampled once at the next course target, 10 m apart on both sides, each
// clipped to the map (edge to edge). None before the start.
import {
  ladderLines,
  ladderState,
  ladderWindDeg,
  ladderWindKey,
  ladderAnchorKey,
  ladderGuidesFromState,
  ladderOriginFromState,
  ladderOriginForSim,
  ladderAnchorsFromState,
  ladderAnchorsForSim,
  ladderDrawable,
  createLadderCache,
  mapBoundsFromLat,
  LADDER_SPACING_M,
  LADDER_GUIDE_COLOR,
  LADDER_GUIDE_OPACITY,
} from '../src/ladder-lines.js';
import { windSample, ConstantWind } from '../src/wind.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const bounds = mapBoundsFromLat({ width: 100, height: 200 });
const onEdge = (x, y, b) => near(x, b.xmin, 1e-6) || near(x, b.xmax, 1e-6) || near(y, b.ymin, 1e-6) || near(y, b.ymax, 1e-6);
const inside = (x, y, b) => x >= b.xmin - 1e-9 && x <= b.xmax + 1e-9 && y >= b.ymin - 1e-9 && y <= b.ymax + 1e-9;
// Signed offset of (x, y) from the anchor along the downwind unit of dirDeg.
const along = (x, y, ox, oy, dirDeg) => {
  const t = dirDeg * Math.PI / 180;
  return (x - ox) * Math.cos(t) + (y - oy) * Math.sin(t);
};

// Uniform wind from +Y (UI 90°): flow −Y, direction −90°. Anchor (0, 40)
// on a 100 × 200 map: horizontal lines at y = 40 + 10k, k from −14 to 6.
{
  const cw = new ConstantWind(90, 4.5);
  const getWind = (x, y) => cw.getWind(x, y);
  check('wind direction at the anchor: −90° (flow toward −Y)', ladderWindDeg(getWind, 0, 40) === -90);
  const st = ladderState(getWind, 0, 40, { bounds });
  check('every line is a straight two-point segment', st.length > 0 && st.every((f) => f.length === 4), `n=${st.length}`);
  check('lines are horizontal (perpendicular to a −Y wind)', st.every((f) => near(f[1], f[3], 1e-9)));
  const ys = st.map((f) => f[1]).sort((p, q) => p - q);
  check('spacing is 10 m', LADDER_SPACING_M === 10 && ys.every((y, i) => i === 0 || near(y - ys[i - 1], 10, 1e-9)));
  check('both sides of the anchor, covering the whole map: y = −100 … 100 every 10 m (21 lines)',
    st.length === 21 && near(ys[0], -100, 1e-9) && near(ys[20], 100, 1e-9), `${ys[0]} … ${ys[ys.length - 1]} n=${ys.length}`);
  check('one line passes through the anchor (offset 0)', ys.some((y) => near(y, 40, 1e-9)));
  check('each line spans the full map width (x = −50 … 50)', st.every((f) => near(Math.min(f[0], f[2]), -50, 1e-9) && near(Math.max(f[0], f[2]), 50, 1e-9)));
}

// Rotated wind: 30° off. Lines perpendicular to it, 10 m apart along it,
// clipped to the map with both ends on its edge; rotating the wind
// rotates them.
{
  const dirFor = (uiDeg) => { const cw = new ConstantWind(uiDeg, 4.5); return [(x, y) => cw.getWind(x, y), ladderWindDeg((x, y) => cw.getWind(x, y), 10, 20)]; };
  const [w60, d60] = dirFor(60);
  const [w90, d90] = dirFor(90);
  const ox = 10, oy = 20;
  const st = ladderState(w60, ox, oy, { bounds });
  const lines = ladderLines(ox, oy, d60, bounds);
  check('rotated wind: direction is 30° from the 90° case', near(Math.abs(d60 - d90), 30, 1e-9), `${d60} vs ${d90}`);
  const th = d60 * Math.PI / 180, ux = Math.cos(th), uy = Math.sin(th);
  const perp = st.every((f) => near((f[2] - f[0]) * ux + (f[3] - f[1]) * uy, 0, 1e-6));
  check('rotated: every line is perpendicular to the wind at the anchor', st.length > 5 && perp, `n=${st.length}`);
  const offs = st.map((f) => along(f[0], f[1], ox, oy, d60));
  const sameOff = st.every((f, i) => near(along(f[2], f[3], ox, oy, d60), offs[i], 1e-6));
  check('rotated: both ends of a line at the same offset along the wind (straight, square)', sameOff);
  check('rotated: offsets are k · 10 m, consecutive, one at 0',
    offs.every((o, i) => near(o, 10 * Math.round(o / 10), 1e-6) && (i === 0 || near(o - offs[i - 1], 10, 1e-6))) && offs.some((o) => near(o, 0, 1e-6)));
  check('rotated: both ends on the map edge, nothing outside', st.every((f) => onEdge(f[0], f[1], bounds) && onEdge(f[2], f[3], bounds) && inside(f[0], f[1], bounds) && inside(f[2], f[3], bounds)));
  // Every k whose line crosses the map is there: one more step either way misses it.
  const ks = lines.map((l) => l.k);
  const lo = ks[0] - 1, hi = ks[ks.length - 1] + 1;
  const crosses = (k) => {
    const corners = [[bounds.xmin, bounds.ymin], [bounds.xmax, bounds.ymin], [bounds.xmin, bounds.ymax], [bounds.xmax, bounds.ymax]];
    const s = corners.map(([x, y]) => along(x, y, ox, oy, d60) - 10 * k);
    return Math.min(...s) < -1e-9 && Math.max(...s) > 1e-9;
  };
  check('rotated: every crossing line is drawn, none beyond', ks.every(crosses) && !crosses(lo) && !crosses(hi), `k ${ks[0]}…${ks[ks.length - 1]}`);
  const st90 = ladderState(w90, ox, oy, { bounds });
  const ang = (f) => Math.atan2(f[3] - f[1], f[2] - f[0]) * 180 / Math.PI;
  const turned = ((ang(st[0]) - ang(st90[0])) % 180 + 180) % 180;
  check('rotating the wind by 30° rotates the lines by 30°', near(Math.min(turned, 180 - turned), 30, 1e-6), `${turned}`);
}

// Only the wind at the anchor counts: a field that turns sharply away from
// the anchor gives the same lines as a uniform one with the anchor's wind.
{
  const ox = 0, oy = 40;
  const uniform = (x, y) => windSample(0, -0.02);
  const elsewhere = (x, y) => (Math.hypot(x - ox, y - oy) < 1 ? windSample(0, -0.02) : windSample(0.02 * Math.sin(x), -0.01 + 0.005 * y / 100));
  const a = ladderState(uniform, ox, oy, { bounds });
  const b = ladderState(elsewhere, ox, oy, { bounds });
  check('wind elsewhere in the field does not change the lines', a.length > 0 && JSON.stringify(a) === JSON.stringify(b));
  let calls = 0;
  ladderState((x, y) => { calls++; return windSample(0, -0.02); }, ox, oy, { bounds });
  check('the wind is sampled once, at the anchor', calls === 1, `calls=${calls}`);
  const speed = ladderState((x, y) => windSample(0, -0.2), ox, oy, { bounds });
  check('wind speed is irrelevant', JSON.stringify(speed) === JSON.stringify(a));
  check('direction is rounded to 1° (a 0.3° change keeps the same lines)',
    JSON.stringify(ladderState(() => windSample(0.02 * Math.sin(0.3 * Math.PI / 180), -0.02 * Math.cos(0.3 * Math.PI / 180)), ox, oy, { bounds })) === JSON.stringify(a));
}

// Calm / bad input; guides.
{
  check('calm wind → no lines', ladderState(() => windSample(0, 0), 0, 0, { bounds }).length === 0);
  check('no wind sample → no lines', ladderState(() => null, 0, 0, { bounds }).length === 0);
  check('non-finite anchor → no lines', ladderState(() => windSample(0, -0.01), NaN, 0, { bounds }).length === 0);
  const noBounds = ladderState(() => windSample(0, -0.01), 0, 0);
  check('without bounds: a 400 m square around the anchor (41 lines)', noBounds.length === 41, `n=${noBounds.length}`);
  const st = ladderState(() => windSample(0, -0.01), 0, 40, { bounds });
  const guides = ladderGuidesFromState(st);
  check('ladderGuidesFromState: one polyline guide per line, ladder colour and opacity',
    guides.length === st.length && guides.every((g) => g.type === 'polyline' && g.pts.length === 4 && g.color === LADDER_GUIDE_COLOR && g.opacity === LADDER_GUIDE_OPACITY));
  check('empty / short polylines yield no guides', ladderGuidesFromState([[], [1, 2]]).length === 0);
}

// Next-target origin: start-line mid before the gun, gate mid or mark
// while racing, finish-line mid on the last leg.
{
  const statics = {
    course: {
      n: 3,
      anchors: [{ x: 0, y: 65 }, { x: 0, y: -45 }, { x: 0, y: 65 }],
      gates: [null, [{ x: -8, y: -45 }, { x: 8, y: -45 }], null],
      start: { x: 0, y: -70 },
      fin: { x: 0, y: -70 },
    },
    start: { a: { x: -16, y: -70 }, b: { x: 16, y: -70 }, mid: { x: 0, y: -70 } },
    finish: { a: { x: -16, y: -70 }, b: { x: 16, y: -70 }, mid: { x: 0, y: -70 } },
    lat: { w: 50, h: 100, res: 0.5 },
  };
  const courseC = [{ x: 0.2, y: 64.8 }, [{ x: -8, y: -45 }, { x: 8, y: -45 }], { x: 0.2, y: 64.8 }];
  const waiting = ladderOriginFromState(
    { hud: { own: { 7: { co: { w: 1 } } } }, course: { c: courseC, waiting: true } },
    statics,
    { ownId: 7 },
  );
  check('before start: origin is the start-line mid, not a pin or the first mark',
    waiting && Math.abs(waiting.x - 0) < 1e-9 && Math.abs(waiting.y + 70) < 1e-9,
    JSON.stringify(waiting));
  const fromEnds = ladderOriginFromState(
    { hud: { co: { w: 1 } } },
    { start: { a: { x: -16, y: -70 }, b: { x: 16, y: -70 } } },
  );
  check('start mid is computed from pin and committee ends when mid is omitted',
    fromEnds && fromEnds.x === 0 && fromEnds.y === -70, JSON.stringify(fromEnds));
  const mark = ladderOriginFromState(
    { hud: { own: { 7: { co: { i: 0, lap: 1 } } } }, course: { c: courseC } },
    statics,
    { ownId: 7 },
  );
  check('racing: a single mark uses the mark itself',
    mark && Math.abs(mark.x - 0.2) < 1e-9 && Math.abs(mark.y - 64.8) < 1e-9,
    JSON.stringify(mark));
  const gate = ladderOriginFromState(
    { hud: { own: { 7: { co: { i: 1, gate: 1, lap: 1 } } } }, course: { c: courseC } },
    statics,
    { ownId: 7 },
  );
  check('racing: a gate uses the midpoint of its two marks',
    gate && Math.abs(gate.x - 0) < 1e-9 && Math.abs(gate.y + 45) < 1e-9,
    JSON.stringify(gate));
  const done = ladderOriginFromState({ hud: { co: { done: 1, fin: 1 } } }, statics);
  check('finish next: origin is the finish-line mid',
    done && done.x === 0 && done.y === -70, JSON.stringify(done));
  const finEnds = ladderOriginFromState(
    { hud: { co: { done: 1, fin: 1 } } },
    { finish: { a: { x: -12, y: -68 }, b: { x: 8, y: -72 } } },
  );
  check('finish mid is computed from the two ends when mid is omitted',
    finEnds && finEnds.x === -2 && finEnds.y === -70, JSON.stringify(finEnds));
  const fallback = ladderOriginFromState({ hud: {} }, statics);
  check('no progress yet, with a start line: start mid',
    fallback && fallback.x === 0 && fallback.y === -70, JSON.stringify(fallback));
  const noStart = ladderOriginFromState({ hud: {} }, { course: { anchors: [{ x: 0, y: 65 }] } });
  check('no progress and no start line: first course mark',
    noStart && noStart.x === 0 && noStart.y === 65, JSON.stringify(noStart));

  const startLine = { a: { x: -16, y: -70 }, b: { x: 16, y: -70 }, mid: { x: 0, y: -70 } };
  const finishLine = { a: { x: -16, y: -70 }, b: { x: 16, y: -70 }, mid: { x: 0, y: -70 } };
  const course = {
    marks: [{ x: 0, y: 65 }, { gate: [{ x: -8, y: -45 }, { x: 8, y: -45 }] }],
    start: { x: 0, y: -70 },
    finish: finishLine,
    progressFor() { return this._p; },
    _p: { courseComplete: false, waitingForStart: true, targetIndex: 0 },
  };
  const sim = { course, startSequence: { line: startLine } };
  const fromSimStart = ladderOriginForSim(sim, {});
  check('ladderOriginForSim before start uses the start-line mid',
    fromSimStart && fromSimStart.x === 0 && fromSimStart.y === -70, JSON.stringify(fromSimStart));
  course._p = { courseComplete: false, waitingForStart: false, targetIndex: 1 };
  const fromSimGate = ladderOriginForSim(sim, {});
  check('ladderOriginForSim at a gate uses the gate mid',
    fromSimGate && fromSimGate.x === 0 && fromSimGate.y === -45, JSON.stringify(fromSimGate));
  course._p = { courseComplete: true, waitingForStart: false, targetIndex: 0 };
  const fromSimFin = ladderOriginForSim(sim, {});
  check('ladderOriginForSim on the finish leg uses the finish-line mid',
    fromSimFin && fromSimFin.x === 0 && fromSimFin.y === -70, JSON.stringify(fromSimFin));
}

// Anchors from frame state and the sim; none drawn before the start.
{
  const statics = {
    course: { n: 2, anchors: [{ x: 0, y: 65 }, { x: 0, y: -45 }], start: { x: 0, y: -70 } },
    start: { a: { x: -16, y: -70 }, b: { x: 16, y: -70 }, mid: { x: 0, y: -70 } },
  };
  const c = [{ x: 0, y: 65 }, [{ x: -8, y: -45 }, { x: 8, y: -45 }]];
  const pre = ladderAnchorsFromState({ hud: { co: { w: 1 } }, course: { c } }, statics);
  check('pre-start: target is the start mid, but no ladder lines are drawn',
    pre && pre.origin.y === -70 && pre.preStart && !ladderDrawable(pre), JSON.stringify(pre));
  const noCo = ladderAnchorsFromState({ hud: {}, course: { c } }, statics);
  check('no progress yet, with a start line: nothing drawn', !ladderDrawable(noCo), JSON.stringify(noCo));
  const leg1 = ladderAnchorsFromState({ hud: { co: { i: 0, lap: 1 } }, course: { c } }, statics);
  check('first leg: windward mark, drawn', leg1 && leg1.origin.y === 65 && ladderDrawable(leg1), JSON.stringify(leg1));
  const gate = ladderAnchorsFromState({ hud: { co: { i: 1, lap: 1, gate: 1 } }, course: { c } }, statics);
  check('leeward gate: gate mid', gate && gate.origin.y === -45 && gate.origin.x === 0 && ladderDrawable(gate), JSON.stringify(gate));
  const fin = ladderAnchorsFromState({ hud: { co: { done: 1, fin: 1 } }, course: { c } }, { ...statics, finish: { mid: { x: 0, y: -70 } } });
  check('finish leg: finish-line mid, drawn', fin && fin.origin.y === -70 && ladderDrawable(fin), JSON.stringify(fin));

  const course = {
    marks: [{ x: 0, y: 65 }, { gate: [{ x: -8, y: -45 }, { x: 8, y: -45 }] }],
    start: { x: 0, y: -70 },
    progressFor() { return this._p; },
    _p: { courseComplete: false, waitingForStart: true, target: 0, targetIndex: 0 },
  };
  const simPre = ladderAnchorsForSim({ course, startSequence: { line: { mid: { x: 0, y: -70 } } } }, {});
  check('sim pre-start: no ladder lines', simPre && simPre.preStart && !ladderDrawable(simPre), JSON.stringify(simPre));
  course._p = { courseComplete: false, waitingForStart: false, target: 1, targetIndex: 1 };
  const g = ladderAnchorsForSim({ course }, {});
  check('sim: gate target is the gate mid', g && g.origin.y === -45 && g.origin.x === 0 && ladderDrawable(g), JSON.stringify(g));
  course._p = { courseComplete: false, waitingForStart: false, target: 2, targetIndex: 0 };
  const l2 = ladderAnchorsForSim({ course }, {});
  check('sim: lap 2 mark 1', l2 && l2.origin.y === 65, JSON.stringify(l2));
  const noCourse = ladderAnchorsForSim({ course: null, marks: [{ x: 0, y: 40 }] }, null);
  check('sim without a course (scenario 21): the mark, drawn', noCourse && noCourse.origin.y === 40 && ladderDrawable(noCourse), JSON.stringify(noCourse));
}

// Bounds helpers.
{
  check('mapBoundsFromLat from map width/height', bounds && bounds.xmin === -50 && bounds.xmax === 50 && bounds.ymin === -100 && bounds.ymax === 100);
  const fromLat = mapBoundsFromLat({ w: 50, h: 100, res: 0.5 });
  check('mapBoundsFromLat from lattice cells / resolution', fromLat && fromLat.xmin === -50 && fromLat.ymax === 100);
}

// Cache keys: rebuild only when the anchor moves (0.5 m) or the wind
// direction at it changes (1°), not on a new field.
{
  const a = { origin: { x: 10.1, y: 20 } };
  const b = { origin: { x: 10.2, y: 20 } };
  const c = { origin: { x: 11, y: 20 } };
  check('anchor key: 0.1 m drift keeps the key, 1 m changes it',
    JSON.stringify(ladderAnchorKey(a)) === JSON.stringify(ladderAnchorKey(b)) && JSON.stringify(ladderAnchorKey(a)) !== JSON.stringify(ladderAnchorKey(c)));
  const w1 = () => windSample(0, -0.02);
  const w2 = () => windSample(0.02 * Math.sin(5 * Math.PI / 180), -0.02 * Math.cos(5 * Math.PI / 180));
  check('wind key: the rounded direction at the anchor', ladderWindKey(w1, a) === -90 && ladderWindKey(w2, a) === -85, `${ladderWindKey(w1, a)} ${ladderWindKey(w2, a)}`);
  const cache = createLadderCache();
  let builds = 0;
  const key = (w, anc) => [...ladderAnchorKey(anc), ladderWindKey(w, anc)];
  cache(key(w1, a), () => ++builds);
  cache(key(() => windSample(0, -0.05), b), () => ++builds);
  check('cache: new field, same direction, anchor within 0.5 m → no rebuild', builds === 1);
  cache(key(w2, b), () => ++builds);
  check('cache: wind direction at the anchor changed → rebuild', builds === 2);
  cache(key(w2, c), () => ++builds);
  check('cache: anchor moved → rebuild', builds === 3);
}

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all ladder-lines checks passed');
