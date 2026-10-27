// Distance ladder lines (src/ladder-lines.js): downwind path-length level
// sets from a mark. Uniform wind → straight lines perpendicular to the
// wind; a local wake deflection bends the line.
import { ladderLines, ladderState, ladderGuidesFromState, LADDER_DISTANCES_M } from '../src/ladder-lines.js';
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
  check('ladderState: one flat polyline per LADDER_DISTANCES_M', st.length === LADDER_DISTANCES_M.length && st.every((f) => f.length >= 4 && f.length % 2 === 0));
  const guides = ladderGuidesFromState(st);
  check('ladderGuidesFromState: guide segments, no other types', guides.length > 10 && guides.every((g) => g.type === 'guide' && Number.isFinite(g.x1)));
  check('empty / short polylines yield no guides', ladderGuidesFromState([[], [1, 2]]).length === 0);
}

// No wind / bad origin.
{
  check('calm wind → no lines', ladderLines(() => windSample(0, 0), 0, 0, [20]).length === 0);
  check('non-finite origin → no lines', ladderLines(() => windSample(0, -0.01), NaN, 0, [20]).length === 0);
}

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all ladder-lines checks passed');
