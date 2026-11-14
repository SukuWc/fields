// Distance ladder lines (src/ladder-lines.js): wind path-length level
// sets from a mark, every 10 m toward the previous mark of the leg.
// Uniform wind → straight lines perpendicular to the wind; a local wake
// deflection bends the line.
import {
  ladderLines,
  ladderState,
  ladderGuidesFromState,
  ladderOriginFromState,
  ladderOriginForSim,
  ladderAnchorsFromState,
  ladderAnchorsForSim,
  ladderDrawable,
  ladderPlan,
  ladderDistances,
  createLadderCache,
  mapBoundsFromLat,
  LADDER_SPACING_M,
  LADDER_MAX_LINES,
  LADDER_DEFAULT_LENGTH_M,
} from '../src/ladder-lines.js';
import { windSample, ConstantWind } from '../src/wind.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// Wind from +Y (UI 90°): ConstantWind → flow (vx, vy) = (0, −mag).
{
  const cw = new ConstantWind(90, 4.5);
  const getWind = (x, y) => cw.getWind(x, y);
  const lines = ladderLines(getWind, 0, 40, [20, 40], { halfWidth: 30, spacing: 2, step: 0.5 });
  check('uniform +Y wind: both 20 m and 40 m lines', lines.length === 2 && lines[0].d === 20 && lines[1].d === 40);
  const y20 = lines[0].pts.map((p) => p[1]);
  const y40 = lines[1].pts.map((p) => p[1]);
  const x20 = lines[0].pts.map((p) => p[0]);
  check('20 m line at y ≈ 20 (mark 40 − 20 downwind)', y20.every((y) => near(y, 20, 0.6)), `y ${Math.min(...y20).toFixed(3)}…${Math.max(...y20).toFixed(3)}`);
  check('40 m line at y ≈ 0', y40.every((y) => near(y, 0, 0.6)), `y ${Math.min(...y40).toFixed(3)}…${Math.max(...y40).toFixed(3)}`);
  check('uniform: lines are straight (constant y) and span cross-wind', Math.max(...y20) - Math.min(...y20) < 1e-9 && Math.min(...x20) < -25 && Math.max(...x20) > 25);
}

// Wind from +X (0°): downwind −X. Mark at (40, 0) → 20 m line at x ≈ 20.
{
  const cw = new ConstantWind(0, 4.5);
  const lines = ladderLines((x, y) => cw.getWind(x, y), 40, 0, [20], { halfWidth: 20, spacing: 2, step: 0.5 });
  check('uniform +X wind: 20 m line at x ≈ 20, constant x (⊥ to wind)', lines.length === 1 && lines[0].pts.every((p) => near(p[0], 20, 0.6)));
  const ys = lines[0].pts.map((p) => p[1]);
  check('uniform +X: line spans cross-wind (±Y)', Math.min(...ys) < -15 && Math.max(...ys) > 15);
}

// Direction shear (wake-like): flow is mostly −Y but gains ±vx with x, so
// streamlines fan and the 20 m level set bends (distance ladders follow
// direction; a pure speed change would not move a geometric front).
{
  const getWind = (x, y) => windSample(0.0008 * x, -0.02);
  const lines = ladderLines(getWind, 0, 40, [20], { halfWidth: 30, spacing: 2, step: 0.25 });
  check('shear field: still one 20 m line', lines.length === 1);
  const pts = lines[0].pts;
  const mid = pts[Math.floor(pts.length / 2)];
  const edge = pts[0];
  // Edges travel diagonally; at the same arc length they have not gone as far
  // downwind as the centre (pure −Y), so mid.y < edge.y.
  check('shear field: centre of the line is further downwind than the edge', mid[1] < edge[1] - 0.3, `mid y ${mid[1].toFixed(2)} edge y ${edge[1].toFixed(2)}`);
}

// Compact state + guides.
{
  const cw = new ConstantWind(90, 4.5);
  const st = ladderState((x, y) => cw.getWind(x, y), 0, 40);
  check('ladderState with no previous point: default downwind lines every 10 m',
    st.length === LADDER_DEFAULT_LENGTH_M / LADDER_SPACING_M && st.every((f) => f.length >= 4 && f.length % 2 === 0));
  const guides = ladderGuidesFromState(st);
  check('ladderGuidesFromState: one polyline guide per line, no other types',
    guides.length === st.length && guides.every((g) => g.type === 'polyline' && g.pts.length >= 4));
  check('empty / short polylines yield no guides', ladderGuidesFromState([[], [1, 2]]).length === 0);
}

// No wind / bad origin.
{
  check('calm wind → no lines', ladderLines(() => windSample(0, 0), 0, 0, [20]).length === 0);
  check('non-finite origin → no lines', ladderLines(() => windSample(0, -0.01), NaN, 0, [20]).length === 0);
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

// Bounds: a start-line origin plus the default 50 m half-width would leave
// a 100 × 200 m map; clipped polylines stay inside.
{
  const cw = new ConstantWind(90, 4.5);
  const bounds = mapBoundsFromLat({ width: 100, height: 200 });
  check('mapBoundsFromLat from map width/height', bounds && bounds.xmin === -50 && bounds.xmax === 50 && bounds.ymin === -100 && bounds.ymax === 100);
  const fromLat = mapBoundsFromLat({ w: 50, h: 100, res: 0.5 });
  check('mapBoundsFromLat from lattice cells / resolution', fromLat && fromLat.xmin === -50 && fromLat.ymax === 100);
  const st = ladderState((x, y) => cw.getWind(x, y), 16, -70, { bounds });
  let n = 0, outside = 0;
  for (const flat of st) {
    for (let i = 0; i + 1 < flat.length; i += 2) {
      n++;
      const x = flat[i], y = flat[i + 1];
      if (x < bounds.xmin - 1e-9 || x > bounds.xmax + 1e-9 || y < bounds.ymin - 1e-9 || y > bounds.ymax + 1e-9) outside++;
    }
  }
  check('bounds: ladder from an off-centre start pin stays in the domain', n > 10 && outside === 0, `n=${n} outside=${outside}`);
}

// Spacing and count.
{
  check('spacing is 10 m', LADDER_SPACING_M === 10);
  check('ladderDistances: ceil(leg / 10) lines, 10 m apart',
    JSON.stringify(ladderDistances(35)) === JSON.stringify([10, 20, 30, 40]) && ladderDistances(110).length === 11 && ladderDistances(110)[10] === 110);
  check('ladderDistances: at least one line, capped at LADDER_MAX_LINES',
    ladderDistances(0).length === 1 && ladderDistances(1e6).length === LADDER_MAX_LINES);
}

// Side: toward the previous mark. Wind from +Y → downwind −Y.
{
  const cw = new ConstantWind(90, 4.5);
  const getWind = (x, y) => cw.getWind(x, y);
  // Leeward gate at y = −45, previous mark (windward) at y = 65: the run.
  const runPlan = ladderPlan(getWind, 0, -45, { x: 0, y: 65 });
  check('run: previous mark upwind → plan goes upwind', runPlan && runPlan.direction === -1, JSON.stringify(runPlan && runPlan.direction));
  const run = ladderState(getWind, 0, -45, { toward: { x: 0, y: 65 } });
  const ys = run.map((f) => f[1]);
  check('run: every ladder line is windward of (above) the leeward gate', run.length > 0 && run.every((f) => f.filter((_, i) => i % 2 === 1).every((y) => y > -45 + 9)),
    `first y ${ys[0] && ys[0].toFixed(2)}`);
  check('run: 110 m leg → 11 lines (ceil(110 / 10))', run.length === 11, `n=${run.length}`);
  check('run: lines 10 m apart from the gate', run.every((f, k) => Math.abs(f[1] - (-45 + 10 * (k + 1))) < 0.6),
    run.map((f) => f[1].toFixed(1)).join(','));
  // Windward mark at y = 65, previous gate at y = −45: the beat.
  const beat = ladderState(getWind, 0, 65, { toward: { x: 0, y: -45 } });
  check('beat: lines are leeward of (below) the windward mark', beat.length === 11 && beat.every((f) => f.filter((_, i) => i % 2 === 1).every((y) => y < 65 - 9)));
  check('beat: 10 m spacing downwind', beat.every((f, k) => Math.abs(f[1] - (65 - 10 * (k + 1))) < 0.6));
  // Count scales with leg length (measured along the wind).
  const short = ladderState(getWind, 0, 65, { toward: { x: 0, y: 40 } });
  const long = ladderState(getWind, 0, 65, { toward: { x: 0, y: -100 } });
  check('count scales with leg length: 25 m → 3, 165 m → 17', short.length === 3 && long.length === 17, `${short.length} ${long.length}`);
  // A previous mark off to the side widens the front so the lines span it.
  const wide = ladderPlan(getWind, 0, 65, { x: 120, y: -45 });
  check('cross-wind offset widens the front', wide.halfWidth >= 120 && wide.direction === 1, JSON.stringify(wide.halfWidth));
  // Perf bound: one build stays under ~LADDER_FRONT_POINTS × LADDER_MAX_STEPS samples.
  let calls = 0;
  const counted = (x, y) => { calls++; return cw.getWind(x, y); };
  const big = ladderState(counted, 0, 65, { toward: { x: 150, y: -900 } });
  check('capped leg: LADDER_MAX_LINES lines and a bounded number of wind samples',
    big.length === LADDER_MAX_LINES && calls < 50000, `n=${big.length} calls=${calls}`);
}

// Anchors (origin + previous point) from frame state and the sim.
{
  const statics = {
    course: { n: 2, anchors: [{ x: 0, y: 65 }, { x: 0, y: -45 }], start: { x: 0, y: -70 } },
    start: { a: { x: -16, y: -70 }, b: { x: 16, y: -70 }, mid: { x: 0, y: -70 } },
  };
  const c = [{ x: 0, y: 65 }, [{ x: -8, y: -45 }, { x: 8, y: -45 }]];
  const pre = ladderAnchorsFromState({ hud: { co: { w: 1 } }, course: { c } }, statics);
  check('pre-start: target is the start mid, but no ladder lines are drawn',
    pre && pre.origin.y === -70 && pre.preStart && !pre.toward && !ladderDrawable(pre), JSON.stringify(pre));
  const noCo = ladderAnchorsFromState({ hud: {}, course: { c } }, statics);
  check('no progress yet, with a start line: nothing drawn', !ladderDrawable(noCo), JSON.stringify(noCo));
  const leg1 = ladderAnchorsFromState({ hud: { co: { i: 0, lap: 1 } }, course: { c } }, statics);
  check('first leg: toward the start, drawn', leg1 && leg1.origin.y === 65 && leg1.toward.y === -70 && ladderDrawable(leg1), JSON.stringify(leg1));
  const gate = ladderAnchorsFromState({ hud: { co: { i: 1, lap: 1, gate: 1 } }, course: { c } }, statics);
  check('leeward gate: toward the windward mark', gate && gate.origin.y === -45 && gate.toward.y === 65, JSON.stringify(gate));
  const lap2 = ladderAnchorsFromState({ hud: { co: { i: 0, lap: 2 } }, course: { c } }, statics);
  check('lap 2 first mark: toward the last element (gate mid)', lap2 && lap2.toward.x === 0 && lap2.toward.y === -45, JSON.stringify(lap2));
  const fin = ladderAnchorsFromState({ hud: { co: { done: 1, fin: 1 } }, course: { c } }, { ...statics, finish: { mid: { x: 0, y: -70 } } });
  check('finish leg: toward the last mark', fin && fin.origin.y === -70 && fin.toward.y === -45, JSON.stringify(fin));

  const course = {
    marks: [{ x: 0, y: 65 }, { gate: [{ x: -8, y: -45 }, { x: 8, y: -45 }] }],
    start: { x: 0, y: -70 },
    progressFor() { return this._p; },
    _p: { courseComplete: false, waitingForStart: false, target: 1, targetIndex: 1 },
  };
  const sim = { course };
  course._p = { courseComplete: false, waitingForStart: true, target: 0, targetIndex: 0 };
  const simPre = ladderAnchorsForSim({ course, startSequence: { line: { mid: { x: 0, y: -70 } } } }, {});
  check('sim pre-start: no ladder lines', simPre && simPre.preStart && !ladderDrawable(simPre), JSON.stringify(simPre));
  course._p = { courseComplete: false, waitingForStart: false, target: 1, targetIndex: 1 };
  const g = ladderAnchorsForSim(sim, {});
  check('sim: gate target toward the windward mark', g && g.origin.y === -45 && g.toward.y === 65, JSON.stringify(g));
  course._p = { courseComplete: false, waitingForStart: false, target: 2, targetIndex: 0 };
  const l2 = ladderAnchorsForSim(sim, {});
  check('sim: lap 2 mark 1 toward the gate mid', l2 && l2.origin.y === 65 && l2.toward.y === -45, JSON.stringify(l2));
  course._p = { courseComplete: false, waitingForStart: false, target: 0, targetIndex: 0 };
  const l1 = ladderAnchorsForSim(sim, {});
  check('sim: first rounding toward the course start', l1 && l1.toward.y === -70, JSON.stringify(l1));
  const noCourse = ladderAnchorsForSim({ course: null, marks: [{ x: 0, y: 40 }] }, null);
  check('sim without a course (scenario 21): the mark, no previous point, drawn', noCourse && noCourse.origin.y === 40 && noCourse.toward === null && ladderDrawable(noCourse), JSON.stringify(noCourse));
}

// Cache: rebuild only when the key changes.
{
  const cache = createLadderCache();
  let builds = 0;
  const f = {};
  cache([f, 1, null], () => ++builds);
  cache([f, 1, null], () => ++builds);
  check('cache: same key → one build', builds === 1);
  cache([{}, 1, null], () => ++builds);
  check('cache: new field object → rebuild', builds === 2);
}

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all ladder-lines checks passed');
