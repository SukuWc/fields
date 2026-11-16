// Ladder lines and laylines (src/ladder-lines.js): wind sampled once at
// the next course target; laylines at fixed best-VMG angles on the
// approach side (upwind or downwind mark from the previous point or the
// boat); ladder rungs every 10 m between them, clipped to the map. None
// before the start.
import {
  ladderState,
  ladderGeometry,
  ladderSide,
  laylineHalfAngleDeg,
  laylineGuidesFromState,
  ladderBuildKey,
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
  LAYLINE_GUIDE_COLOR,
  LAYLINE_GUIDE_OPACITY,
} from '../src/ladder-lines.js';
import { BEST_VMG_DOWNWIND_DEG, BEST_VMG_UPWIND_DEG } from '../src/boat-draw.js';
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

// Upwind mark: anchor (0, 40), wind from +Y (UI 90°: flow −Y, direction
// −90°), previous point downwind at (0, −70). Laylines ±50° from dead
// downwind to the map edge; ladder lines below the mark every 10 m, each
// between the laylines.
{
  const cw = new ConstantWind(90, 4.5);
  const getWind = (x, y) => cw.getWind(x, y);
  const anchors = { origin: { x: 0, y: 40 }, toward: { x: 0, y: -70 } };
  check('wind direction at the anchor: −90° (flow toward −Y)', ladderWindDeg(getWind, 0, 40) === -90);
  check('previous point downwind → upwind mark (side +1)', ladderSide(anchors, -90) === 1);
  check('half angles reuse the boat-draw constants: 50° up, 20° down',
    laylineHalfAngleDeg(1) === BEST_VMG_UPWIND_DEG && BEST_VMG_UPWIND_DEG === 50 && laylineHalfAngleDeg(-1) === 180 - BEST_VMG_DOWNWIND_DEG && laylineHalfAngleDeg(-1) === 20);
  const { ladder, layline } = ladderGeometry(getWind, anchors, { bounds });
  check('two laylines, each from the mark', layline.length === 2 && layline.every((f) => near(f[0], 0, 1e-9) && near(f[1], 40, 1e-9)));
  const angs = layline.map((f) => Math.atan2(f[3] - f[1], f[2] - f[0]) * 180 / Math.PI);
  // Dead downwind is −90°; ±50° → −140° and −40°.
  check('laylines at ±50° from dead downwind, extending downwind',
    angs.map((x) => Math.round(x * 1e6) / 1e6).sort((p, q) => p - q).join() === '-140,-40', angs.join());
  check('laylines end on the map edge', layline.every((f) => onEdge(f[2], f[3], bounds) && inside(f[2], f[3], bounds)));
  check('ladder lines are straight two-point segments, horizontal (⊥ wind)', ladder.length > 0 && ladder.every((f) => f.length === 4 && near(f[1], f[3], 1e-9)));
  const ys = ladder.map((f) => f[1]);
  check('ladder: 10 m spacing from the mark, approach side only, none at the mark (y = 30, 20, …, −100)',
    ys.length === 14 && ys.every((y, i) => near(y, 30 - 10 * i, 1e-9)), ys.join(','));
  // The layline at offset d below the mark is at x = ±d·tan 50°.
  const tan = Math.tan(50 * Math.PI / 180);
  const endsOnLaylines = ladder.every((f) => {
    const d = 40 - f[1];
    const w = d * tan;
    const ends = [f[0], f[2]].sort((p, q) => p - q);
    return (near(ends[0], -w, 1e-6) || near(ends[0], -50, 1e-9)) && (near(ends[1], w, 1e-6) || near(ends[1], 50, 1e-9));
  });
  check('ladder segments end on the laylines (or the map edge past where they leave the map)', endsOnLaylines);
  check('near rungs end exactly on the laylines (y = 30: x = ±11.92)', near(ladder[0][0], -10 * tan, 1e-6) && near(ladder[0][2], 10 * tan, 1e-6), `${ladder[0][0]} ${ladder[0][2]}`);
  check('every endpoint is inside the map', ladder.every((f) => inside(f[0], f[1], bounds) && inside(f[2], f[3], bounds)));
  // Each rung end lies on its layline: cross product with the layline direction is 0.
  const onLine = (x, y, f) => near((f[2] - f[0]) * (y - f[1]) - (f[3] - f[1]) * (x - f[0]), 0, 1e-6);
  check('the rung endpoints inside the map lie on a layline', ladder.slice(0, 4).every((f) => layline.some((l) => onLine(f[0], f[1], l)) && layline.some((l) => onLine(f[2], f[3], l))));
}

// Downwind mark: anchor (0, −45), previous mark upwind at (0, 65). Laylines
// ±20° from dead upwind, extending upwind; rungs above the mark.
{
  const cw = new ConstantWind(90, 4.5);
  const getWind = (x, y) => cw.getWind(x, y);
  const anchors = { origin: { x: 0, y: -45 }, toward: { x: 0, y: 65 } };
  check('previous point upwind → downwind mark (side −1)', ladderSide(anchors, -90) === -1);
  const { ladder, layline } = ladderGeometry(getWind, anchors, { bounds });
  const angs = layline.map((f) => Math.atan2(f[3] - f[1], f[2] - f[0]) * 180 / Math.PI).map((x) => Math.round(x * 1e6) / 1e6).sort((p, q) => p - q);
  // Dead upwind is +90°; ±20° → 70° and 110°.
  check('downwind mark: laylines at ±20° from dead upwind, extending upwind', angs.join() === '70,110', angs.join());
  // From (0, −45) at 20° off vertical they leave the 100 m wide map at
  // x = ±50, y = −45 + 50 / tan 20° ≈ 92.4.
  check('downwind mark: laylines end on the map edge (sides, near the top)', layline.every((f) => near(Math.abs(f[2]), 50, 1e-9) && near(f[3], -45 + 50 / Math.tan(20 * Math.PI / 180), 1e-6)));
  const ys = ladder.map((f) => f[1]);
  check('downwind mark: rungs every 10 m above the mark, none at or below it (y = −35 … 95)',
    ys.length === 14 && ys.every((y, i) => near(y, -35 + 10 * i, 1e-9)), ys.join(','));
  const tan = Math.tan(20 * Math.PI / 180);
  check('downwind mark: rungs end on the laylines (x = ±d·tan 20°)', ladder.every((f) => {
    const d = f[1] + 45;
    const w = Math.min(d * tan, 50);
    return near(Math.min(f[0], f[2]), -w, 1e-6) && near(Math.max(f[0], f[2]), w, 1e-6);
  }));
  check('downwind mark: the near rung ends exactly on the laylines (y = −35: x = ±3.64)', near(Math.max(ladder[0][0], ladder[0][2]), 10 * tan, 1e-6));
  const noToward = ladderGeometry(getWind, { origin: { x: 0, y: -45 } }, { bounds });
  check('no previous point and no boat: counts as an upwind mark', ladderSide({ origin: { x: 0, y: -45 } }, -90) === 1 && noToward.ladder.every((f) => f[1] < -45));
}

// Rotated wind (UI 60°): laylines and rungs turn with it; rungs stay
// square to the wind, 10 m apart, ending on the laylines.
{
  const mk = (ui) => { const cw = new ConstantWind(ui, 4.5); return (x, y) => cw.getWind(x, y); };
  const w60 = mk(60), w90 = mk(90);
  const ox = 10, oy = 20;
  const d60 = ladderWindDeg(w60, ox, oy);
  const th = d60 * Math.PI / 180, ux = Math.cos(th), uy = Math.sin(th);
  const anchors = { origin: { x: ox, y: oy }, toward: { x: ox + 30 * ux, y: oy + 30 * uy } };
  const g60 = ladderGeometry(w60, anchors, { bounds });
  const g90 = ladderGeometry(w90, { origin: { x: ox, y: oy }, toward: { x: ox, y: oy - 30 } }, { bounds });
  check('rotated: rungs perpendicular to the wind at the anchor', g60.ladder.length > 3 && g60.ladder.every((f) => near((f[2] - f[0]) * ux + (f[3] - f[1]) * uy, 0, 1e-6)));
  const offs = g60.ladder.map((f) => along(f[0], f[1], ox, oy, d60));
  check('rotated: offsets 10, 20, … downwind', offs.every((o, i) => near(o, 10 * (i + 1), 1e-6)), offs.slice(0, 4).join(','));
  const lineAng = (f) => Math.atan2(f[3] - f[1], f[2] - f[0]) * 180 / Math.PI;
  const turn = ((lineAng(g60.layline[0]) - lineAng(g90.layline[0])) % 360 + 360) % 360;
  check('rotating the wind by 30° rotates the laylines by 30°', near(Math.min(turn, 360 - turn), 30, 1e-6), String(turn));
  const relAng = g60.layline.map((f) => {
    const a = Math.atan2(f[3] - f[1], f[2] - f[0]);
    return Math.round(Math.acos(Math.cos(a) * ux + Math.sin(a) * uy) * 180 / Math.PI * 1e6) / 1e6;
  });
  check('rotated: both laylines 50° from dead downwind', relAng.every((x) => near(x, 50, 1e-6)), relAng.join());
  const tan = Math.tan(50 * Math.PI / 180);
  const first = g60.ladder[0];
  check('rotated: first rung half-width is 10·tan 50°', near(Math.hypot(first[2] - first[0], first[3] - first[1]) / 2, 10 * tan, 1e-6));
}

// Only the wind at the anchor counts.
{
  const anchors = { origin: { x: 0, y: 40 }, toward: { x: 0, y: -70 } };
  const uniform = () => windSample(0, -0.02);
  const elsewhere = (x, y) => (Math.hypot(x, y - 40) < 1 ? windSample(0, -0.02) : windSample(0.02 * Math.sin(x), -0.01 + 0.005 * y / 100));
  const a = ladderGeometry(uniform, anchors, { bounds });
  const b = ladderGeometry(elsewhere, anchors, { bounds });
  check('wind elsewhere in the field does not change ladder or laylines', a.ladder.length > 0 && JSON.stringify(a) === JSON.stringify(b));
  let calls = 0;
  ladderGeometry(() => { calls++; return windSample(0, -0.02); }, anchors, { bounds });
  check('the wind is sampled once, at the anchor', calls === 1, `calls=${calls}`);
  check('wind speed is irrelevant', JSON.stringify(ladderGeometry(() => windSample(0, -0.2), anchors, { bounds })) === JSON.stringify(a));
  check('direction is rounded to 1° (a 0.3° change keeps the same lines)',
    JSON.stringify(ladderGeometry(() => windSample(0.02 * Math.sin(0.3 * Math.PI / 180), -0.02 * Math.cos(0.3 * Math.PI / 180)), anchors, { bounds })) === JSON.stringify(a));
  check('ladderState is the ladder part', JSON.stringify(ladderState(uniform, 0, 40, { bounds, toward: anchors.toward })) === JSON.stringify(a.ladder));
}

// Calm / bad input; guides.
{
  check('calm wind → no lines', ladderState(() => windSample(0, 0), 0, 0, { bounds }).length === 0);
  check('no wind sample → no lines', ladderState(() => null, 0, 0, { bounds }).length === 0);
  check('non-finite anchor → no lines', ladderState(() => windSample(0, -0.01), NaN, 0, { bounds }).length === 0);
  const noBounds = ladderState(() => windSample(0, -0.01), 0, 0);
  check('without bounds: a 400 m square around the anchor (20 rungs downwind)', noBounds.length === 20, `n=${noBounds.length}`);
  const geo = ladderGeometry(() => windSample(0, -0.01), { origin: { x: 0, y: 40 }, toward: { x: 0, y: 0 } }, { bounds });
  const guides = ladderGuidesFromState(geo.ladder);
  check('ladderGuidesFromState: one polyline guide per line, ladder colour and opacity',
    guides.length === geo.ladder.length && guides.every((g) => g.type === 'polyline' && g.pts.length === 4 && g.color === LADDER_GUIDE_COLOR && g.opacity === LADDER_GUIDE_OPACITY));
  const lg = laylineGuidesFromState(geo.layline);
  check('laylineGuidesFromState: two polyline guides in a distinct colour',
    lg.length === 2 && lg.every((g) => g.type === 'polyline' && g.color === LAYLINE_GUIDE_COLOR && g.opacity === LAYLINE_GUIDE_OPACITY) && LAYLINE_GUIDE_COLOR !== LADDER_GUIDE_COLOR);
  check('calm: no laylines either', ladderGeometry(() => windSample(0, 0), { origin: { x: 0, y: 0 } }, { bounds }).layline.length === 0);
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
  check('first leg: windward mark toward the start, drawn', leg1 && leg1.origin.y === 65 && leg1.toward.y === -70 && ladderDrawable(leg1), JSON.stringify(leg1));
  const gate = ladderAnchorsFromState({ hud: { co: { i: 1, lap: 1, gate: 1 } }, course: { c } }, statics);
  check('leeward gate: gate mid toward the windward mark', gate && gate.origin.y === -45 && gate.origin.x === 0 && gate.toward.y === 65 && ladderDrawable(gate), JSON.stringify(gate));
  const lap2 = ladderAnchorsFromState({ hud: { co: { i: 0, lap: 2 } }, course: { c } }, statics);
  check('lap 2 first mark: toward the last element (gate mid)', lap2 && lap2.toward.x === 0 && lap2.toward.y === -45, JSON.stringify(lap2));
  const fin = ladderAnchorsFromState({ hud: { co: { done: 1, fin: 1 } }, course: { c } }, { ...statics, finish: { mid: { x: 0, y: -70 } } });
  check('finish leg: finish-line mid toward the last mark, drawn', fin && fin.origin.y === -70 && fin.toward.y === -45 && ladderDrawable(fin), JSON.stringify(fin));
  const solo = ladderAnchorsFromState({ hud: { co: { i: 0, lap: 1 } }, boats: [{ id: 's9', px: 3, py: -20 }], course: { c } }, { course: { anchors: [{ x: 0, y: 65 }] } }, { ownId: 's9' });
  check('state: no previous point → toward the own boat (px, py)', solo && solo.toward && solo.toward.x === 3 && solo.toward.y === -20, JSON.stringify(solo));

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
  check('sim: gate target is the gate mid, toward the windward mark', g && g.origin.y === -45 && g.origin.x === 0 && g.toward.y === 65 && ladderDrawable(g), JSON.stringify(g));
  course._p = { courseComplete: false, waitingForStart: false, target: 2, targetIndex: 0 };
  const l2 = ladderAnchorsForSim({ course }, {});
  check('sim: lap 2 mark 1 toward the gate mid', l2 && l2.origin.y === 65 && l2.toward.y === -45, JSON.stringify(l2));
  course._p = { courseComplete: false, waitingForStart: false, target: 0, targetIndex: 0 };
  const l1 = ladderAnchorsForSim({ course }, {});
  check('sim: first rounding toward the course start', l1 && l1.toward.y === -70, JSON.stringify(l1));
  const noCourse = ladderAnchorsForSim({ course: null, marks: [{ x: 0, y: 40 }] }, { x: 8, y: -8 });
  check('sim without a course (scenario 21): the mark, toward the boat, drawn', noCourse && noCourse.origin.y === 40 && noCourse.toward.x === 8 && noCourse.toward.y === -8 && ladderDrawable(noCourse), JSON.stringify(noCourse));
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
  const up = { origin: { x: 0, y: 40 }, toward: { x: 1, y: -10 } };
  const up2 = { origin: { x: 0, y: 40 }, toward: { x: 5, y: -30 } };
  const down = { origin: { x: 0, y: 40 }, toward: { x: 0, y: 90 } };
  check('build key: the boat moving on the same side keeps it; flipping the side changes it',
    JSON.stringify(ladderBuildKey(w1, up)) === JSON.stringify(ladderBuildKey(w1, up2)) && JSON.stringify(ladderBuildKey(w1, up)) !== JSON.stringify(ladderBuildKey(w1, down)));
}

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all ladder-lines checks passed');
