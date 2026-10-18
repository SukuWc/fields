// Headless checks for the flow tracers (src/flow-tracers.js): spawn density
// follows wind speed, advection follows the field, lifetime and fade, the
// host grid on every map size in dev mode and full fluid.
// Run: node --import ./test/register.mjs scripts/tracers-check.mjs
import '../test/dom-stub.mjs';

const T = await import("../src/flow-tracers.js");
const { Map } = await import("../src/map.js");
const { Boltzmann } = await import("../src/boltzmann.js");
const { FluidWind, ConstantWind } = await import("../src/wind.js");
const MS = await import("../src/map-size.js");

function assert(cond, message) {
  if (!cond) { console.error("FAIL", message); process.exitCode = 1; throw new Error(message); }
  console.log("ok  ", message);
}
// Synthetic grid from f(x, y) → [vx, vy] over w × h centred on 0.
function grid(w, h, cell, f) {
  const nx = Math.round(w / cell) + 1, ny = Math.round(h / cell) + 1, x0 = -w / 2, y0 = -h / 2, v = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v.push(...f(x0 + i * cell, y0 + j * cell));
  return { x0, y0, cell, nx, ny, v };
}

// --- Spawn density ∝ local speed ---
{
  // Speed 1 m/s for x < 0, 3 m/s for x > 0 (sharp step at the middle node).
  const g = grid(100, 200, 1, (x) => [x < 0 ? 1 : x > 0 ? 3 : 2, 0]);
  const tr = new T.FlowTracers({ count: 1, rng: T.mulberry32(1) });
  tr.setGrid(g);
  let left = 0, right = 0;
  for (let k = 0; k < 40000; k++) { tr.spawn(0); if (tr.x[0] < -1) left++; else if (tr.x[0] > 1) right++; }
  const ratio = right / left;
  assert(Math.abs(ratio - 3) < 0.25, `spawn density ∝ speed: 3 m/s half gets ${ratio.toFixed(2)}× the 1 m/s half`);
  // Calm patch: no spawns where the wind is zero (unless all calm).
  const g2 = grid(100, 200, 1, (x, y) => (Math.hypot(x, y) < 20 ? [0, 0] : [5, 0]));
  tr.setGrid(g2);
  let inCalm = 0;
  for (let k = 0; k < 20000; k++) { tr.spawn(0); if (Math.hypot(tr.x[0], tr.y[0]) < 19) inCalm++; }
  assert(inCalm === 0, `no spawns inside a calm patch (${inCalm})`);
  const calm = new T.FlowTracers({ count: 50, rng: T.mulberry32(2) });
  calm.setGrid(grid(50, 100, 1, () => [0, 0]));
  calm.step(1 / 30);
  assert(calm.spawned >= 50 && [...calm.x].every(Number.isFinite), "all-calm field: tracers still spawn (uniformly), no NaN");
}

// --- Advection follows the field ---
{
  const tr = new T.FlowTracers({ count: 1, lifetime: 100, rng: T.mulberry32(3) });
  tr.setGrid(grid(100, 200, 2, () => [2, -1]));
  tr.x[0] = 0; tr.y[0] = 0; tr.age[0] = 1;
  for (let k = 0; k < 30; k++) tr.step(1 / 30);
  assert(Math.abs(tr.x[0] - 2) < 1e-3 && Math.abs(tr.y[0] + 1) < 1e-3, `uniform field: 1 s moves by (2, −1) → (${tr.x[0].toFixed(3)}, ${tr.y[0].toFixed(3)})`);
  // Solid-body rotation v = ω(−y, x): radius kept, angle = ω t.
  const w = 0.5;
  tr.setGrid(grid(100, 200, 1, (x, y) => [-w * y, w * x]));
  tr.x[0] = 20; tr.y[0] = 0; tr.age[0] = 1;
  for (let k = 0; k < 60; k++) tr.step(1 / 30);
  const r = Math.hypot(tr.x[0], tr.y[0]), ang = Math.atan2(tr.y[0], tr.x[0]);
  assert(Math.abs(r - 20) < 0.05 && Math.abs(ang - w * 2) < 0.01, `rotating field: radius ${r.toFixed(3)} m, angle ${ang.toFixed(3)} rad after 2 s (expect 20, 1.000)`);
  // Bilinear: halfway between nodes is the mean.
  const g = grid(10, 20, 2, (x) => [x, 0]);
  tr.setGrid(g);
  assert(Math.abs(tr.velocityAt(1.3, 0.7).x - 1.3) < 1e-9, "bilinear interpolation of a linear field is exact");
  // Leaving the map respawns inside.
  tr.setGrid(grid(50, 100, 1, () => [30, 0]));
  tr.x[0] = 24.5; tr.y[0] = 0; tr.age[0] = 1;
  tr.step(1 / 30);
  assert(tr.inside(tr.x[0], tr.y[0]) && tr.age[0] === 0, "a tracer blown off the map respawns inside it");
}

// --- Lifetime and fade ---
{
  const life = 2, n = 400, dt = 1 / 30;
  const tr = new T.FlowTracers({ count: n, lifetime: life, rng: T.mulberry32(4) });
  tr.setGrid(grid(200, 400, 4, () => [0.5, 0.2]));
  const s0 = tr.spawned;
  let maxAge = 0;
  for (let k = 0; k < 300; k++) { tr.step(dt); for (let i = 0; i < n; i++) maxAge = Math.max(maxAge, tr.age[i]); }
  const respawns = tr.spawned - s0, expect = n * (300 * dt) / life;
  assert(maxAge < life, `no tracer outlives its ${life} s lifetime (max age ${maxAge.toFixed(3)} s)`);
  assert(Math.abs(respawns - expect) / expect < 0.05, `respawns ${respawns} ≈ count × time / lifetime = ${expect.toFixed(0)} (dead ones reused)`);
  tr.age[0] = 0; assert(tr.alpha(0) === 0, "alpha 0 at birth");
  tr.age[0] = life / 2; assert(tr.alpha(0) === 1, "alpha 1 mid-life");
  tr.age[0] = life * 0.999; assert(tr.alpha(0) < 0.01, "alpha → 0 at death");
  const pos = new Float32Array(n * T.TRACER_SEGMENTS * 6), col = new Float32Array(n * T.TRACER_SEGMENTS * 8);
  tr.write(pos, col);
  assert([...pos].every(Number.isFinite) && [...col].every((c) => c >= 0 && c <= 1), "buffers: finite positions, colours 0..1");
}

// --- Tail follows the head's own past path ---
{
  // Solid-body rotation about the origin: the past path is an arc of radius
  // 20 m; a straight streak along the current velocity would leave it.
  const w = 0.5, R0 = 20, tailS = 2;
  const tr = new T.FlowTracers({ count: 1, lifetime: 100, tail: tailS, rng: T.mulberry32(6) });
  tr.setGrid(grid(100, 200, 0.5, (x, y) => [-w * y, w * x]));
  tr.x[0] = R0; tr.y[0] = 0; tr.age[0] = 1; tr.hLen[0] = 0; tr.hAcc[0] = 0;
  for (let k = 0; k < 120; k++) tr.step(1 / 30);
  const px = new Float32Array(T.TRACER_TAIL_POINTS + 1), py = new Float32Array(T.TRACER_TAIL_POINTS + 1);
  const n = tr.tailPoints(0, px, py);
  let maxDev = 0;
  for (let k = 0; k < n; k++) maxDev = Math.max(maxDev, Math.abs(Math.hypot(px[k], py[k]) - R0));
  const a0 = Math.atan2(py[0], px[0]), aEnd = Math.atan2(py[n - 1], px[n - 1]);
  assert(n === T.TRACER_TAIL_POINTS + 1, `ring buffer full: head + ${n - 1} stored points`);
  assert(maxDev < 0.05, `stored tail points lie on the 20 m arc (max off ${maxDev.toFixed(3)} m)`);
  assert(Math.abs((a0 - aEnd) - w * tailS) < w * tailS * 0.12, `tail spans ≈ tail time along the path: ${(a0 - aEnd).toFixed(3)} rad (expect ${(w * tailS).toFixed(2)})`);
  const pos = new Float32Array(T.TRACER_SEGMENTS * 6), col = new Float32Array(T.TRACER_SEGMENTS * 8);
  tr.write(pos, col);
  let curveDev = 0;
  for (let k = 0; k < pos.length; k += 3) curveDev = Math.max(curveDev, Math.abs(Math.hypot(pos[k], pos[k + 1]) - R0));
  assert(curveDev < 0.1, `Catmull-Rom tail stays on the arc (max off ${curveDev.toFixed(3)} m)`);
  assert(pos[0] === tr.x[0] && pos[1] === tr.y[0], "tail starts at the head");
  let fadeOk = true;
  for (let sg = 1; sg < T.TRACER_SEGMENTS; sg++) if (col[sg * 8 + 3] > col[(sg - 1) * 8 + 3] + 1e-6) fadeOk = false;
  assert(fadeOk && Math.abs(col[3] - tr.alpha(0)) < 1e-6 && col[(T.TRACER_SEGMENTS - 1) * 8 + 7] < 1e-6, "alpha falls along the tail from the head to 0 at its end");
  // Respawn clears the history: no segment jumps from the old place.
  tr.age[0] = 200; tr.step(1 / 30);
  assert(tr.hLen[0] === 0, "respawn resets the history");
  tr.write(pos, col);
  let span = 0;
  for (let k = 0; k < pos.length; k += 3) span = Math.max(span, Math.hypot(pos[k] - tr.x[0], pos[k + 1] - tr.y[0]));
  assert(span === 0, "right after a respawn the tail is empty (no line across the map)");
  for (let k = 0; k < 15; k++) tr.step(1 / 30);
  tr.write(pos, col);
  span = 0;
  for (let k = 0; k < pos.length; k += 3) span = Math.max(span, Math.hypot(pos[k] - tr.x[0], pos[k + 1] - tr.y[0]));
  const flown = 15 / 30 * w * Math.hypot(tr.x[0], tr.y[0]) + 1e-3;
  assert(span <= flown * 1.05, `new tail only covers the new path (${span.toFixed(2)} m ≤ ${flown.toFixed(2)} m flown)`);
  // Tail 0: no tail at all.
  tr.setTail(0);
  for (let k = 0; k < 10; k++) tr.step(1 / 30);
  assert(tr.tailPoints(0, px, py) === 1, "tail 0 s: head only");
}

// --- Live settings (the UI inputs call these through renderer.setTracerParams) ---
{
  const tr = new T.FlowTracers({ count: 300, lifetime: 3, rng: T.mulberry32(8) });
  tr.setGrid(grid(100, 200, 2, () => [0, -7]));
  for (let k = 0; k < 30; k++) tr.step(1 / 30);
  assert(tr.setCount(800) && tr.count === 800 && tr.x.length === 800 && tr.hx.length === 800 * T.TRACER_TAIL_POINTS && [...tr.x].every(Number.isFinite), "count: pool reallocated and refilled live");
  assert(!tr.setCount(800), "same count: no reallocation");
  tr.setLifetime(1);
  let maxAge = 0;
  for (let k = 0; k < 90; k++) { tr.step(1 / 30); for (let i = 0; i < tr.count; i++) maxAge = Math.max(maxAge, tr.age[i]); }
  assert(maxAge < 1, `lifetime 1 s applies at once (max age ${maxAge.toFixed(2)} s)`);
  tr.setTail(4);
  assert(Math.abs(tr.histDt - 4 / T.TRACER_TAIL_POINTS) < 1e-9, "tail 4 s: points stored every tail / points s");
}

// --- Pool size ---
{
  const c = (w, h, o) => T.tracerCountFor(w, h, o);
  assert(c(100, 200) === T.TRACER_COUNT && c(50, 100) === T.TRACER_COUNT_MIN && c(200, 400) === T.TRACER_COUNT_MAX, `count: 50×100 ${c(50, 100)}, 100×200 ${c(100, 200)}, 200×400 ${c(200, 400)}`);
  assert(c(100, 200, { touch: true }) === T.TRACER_COUNT / 2 && c(100, 200, { override: 800 }) === 800, "touch halves it; ?tracers=N overrides");
}

// --- Host grid on every map size: dev mode and full fluid ---
for (const k of ["50x100", "100x200", "200x400"]) {
  const { w, h } = MS.MAP_SIZES[k];
  const bm = new Boltzmann(w, h, 0.25, 90, 15, undefined, 8);
  const m = new Map(w, h, 90, 15, bm, new FluidWind(bm), new ConstantWind(90, 15));
  m.physics_model_init();
  m.setDevMode(true);
  let g = T.sampleFlowGrid(m);
  const cw = m.get_wind(0, 0);
  const ok = g.v.length === g.nx * g.ny * 2 && g.nx <= T.FLOW_GRID_MAX_X && g.cell >= 1 && Math.abs(g.v[1] - cw.vy * T.FIELD_TO_MPS) < 1e-3;
  const mps = Math.hypot(g.v[0], g.v[1]);
  assert(ok && Math.abs(mps - cw.speed) < 0.01, `${k} dev mode: ${g.nx}×${g.ny} grid, ${g.cell.toFixed(2)} m cells, uniform ${mps.toFixed(2)} m/s (= wind sample speed ${cw.speed.toFixed(2)})`);
  m.setDevMode(false);
  for (let i = 0; i < 20; i++) bm.step_ready = false, bm.advance_frame ? bm.advance_frame() : null;
  g = T.sampleFlowGrid(m);
  const node = 7 * g.nx + 11, fv = bm.get_field_velocity(g.x0 + 11 * g.cell, g.y0 + 7 * g.cell);
  assert(Math.abs(g.v[node * 2] - fv.x * T.FIELD_TO_MPS) < 2e-3 && Math.abs(g.v[node * 2 + 1] - fv.y * T.FIELD_TO_MPS) < 2e-3, `${k} full fluid: grid node = lattice velocity there`);
  const tr = new T.FlowTracers({ count: 300, rng: T.mulberry32(5) });
  tr.setGrid(g);
  for (let i = 0; i < 60; i++) tr.step(1 / 30);
  assert(g.v.every(Number.isFinite) && tr.maxSpeed > 0 && [...tr.x].every(Number.isFinite) && JSON.parse(JSON.stringify(g)).v.length === g.v.length,
    `${k} full fluid: grid finite (max ${tr.maxSpeed.toFixed(2)} m/s), tracers advect, grid survives JSON`);
}
// --- Host frames carry the grid only while the view shows tracers ---
{
  const { SimCore } = await import("../src/host.js");
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: "4f", texture: { image: { data: new Uint8Array(0) } } });
  core.command({ type: "devMode", on: true });
  core.command({ type: "restart", scenario: 19 });
  const view = { camera_position_x: 0, camera_position_y: 0, camera_zoom: 40, show_forces: false, show_fields: false };
  let off = 0, on = 0;
  for (let i = 0; i < 6; i++) if (core.tick({ dt: 1 / 30, held: [], present: true, view }).flow) off++;
  view.show_fields = true;
  const flags = [];
  for (let i = 0; i < 6; i++) { const f = core.tick({ dt: 1 / 30, held: [], present: true, view }); flags.push(f.flow ? 1 : 0); if (f.flow) on++; }
  assert(off === 0 && flags[0] === 1 && on === Math.ceil(6 / T.FLOW_GRID_EVERY), `frame.flow: none while off, at once when switched on, then every ${T.FLOW_GRID_EVERY} ticks (${flags.join("")})`);
}
console.log("tracers-check: all passed");
