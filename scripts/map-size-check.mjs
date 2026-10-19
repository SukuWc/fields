// Headless checks for the configurable map size (src/map-size.js): URL
// parsing, walls, lattice dimensions, scenario fit, camera limits, and the
// scenario 17 race on the default size.
// Run: node --import ./test/register.mjs scripts/map-size-check.mjs
import '../test/dom-stub.mjs';

const MS = await import("../src/map-size.js");
const { Map } = await import("../src/map.js");
const { Boltzmann } = await import("../src/boltzmann.js");
const { TRIANGLE_COURSE_LAYOUT, WINDWARD_LEEWARD_LAYOUT, MARK_ROOM_LAYOUT } = await import("../src/course.js");
const { START_COURSE_LAYOUT } = await import("../src/start.js");
const { FINISH_COURSE_LAYOUT } = await import("../src/finish.js");
const { TEST_RACE_LAYOUT, setupTestRace } = await import("../src/race-bot.js");
const R = await import("../src/rules.js");
const { recordMarkTouches, getMarkTouches, resetMarkTouches } = await import("../src/mark-touch.js");

function assert(cond, message) {
  if (!cond) { console.error("FAIL", message); process.exitCode = 1; throw new Error(message); }
  console.log("ok  ", message);
}
const SIZES = MS.MAP_SIZE_ORDER;

// --- URL param parsing ---
assert(MS.parseMapSize("100x200") === "100x200" && MS.parseMapSize("200×400") === "200x400" && MS.parseMapSize(" 50X100 ") === "50x100", "parses 100x200 / 200×400 / 50X100");
assert(MS.parseMapSize("75") === "75x75" && MS.parseMapSize("150") === "150x150", "legacy single side 75 / 150");
assert(MS.parseMapSize("60x60") === null && MS.parseMapSize("") === null && MS.parseMapSize(null) === null, "unknown sizes rejected");
assert(MS.mapSizeFromQuery("") === MS.DEFAULT_MAP_SIZE && MS.DEFAULT_MAP_SIZE === "100x200", "default is 100x200");
assert(MS.mapSizeFromQuery("?map_size=200x400&scenario_selector=3") === "200x400", "?map_size=200x400");
assert(MS.mapSizeFromQuery("?mapSize=150") === "150x150", "legacy ?mapSize=150");
assert(MS.mapSizeFromQuery("?map_size=bogus") === MS.DEFAULT_MAP_SIZE, "bad value falls back to the default");
for (const k of SIZES) assert(MS.MAP_SIZES[k].h === 2 * MS.MAP_SIZES[k].w, `${k}: length (Y, along the wind) is twice the width`);

// --- Walls match the size ---
for (const k of [...SIZES, "75x75"]) {
  const { w, h } = MS.MAP_SIZES[k];
  const m = new Map(w, h, 90, 4.5, null);
  m.physics_model_init();
  let xs = [], ys = [];
  for (let b = m.world.getBodyList(); b; b = b.getNext()) {
    if (b.isDynamic()) continue;
    for (let f = b.getFixtureList(); f; f = f.getNext()) {
      if (f.getType() !== "edge") continue;
      const s = f.getShape();
      xs.push(s.m_vertex1.x, s.m_vertex2.x); ys.push(s.m_vertex1.y, s.m_vertex2.y);
    }
  }
  const ex = Math.max(...xs.map(Math.abs)), ey = Math.max(...ys.map(Math.abs));
  assert(ex === w / 2 - MS.WALL_INSET_M && ey === h / 2 - MS.WALL_INSET_M, `${k}: walls at ±${ex} × ±${ey}`);
}

// --- Lattice dims at each size's default root cell ---
const RES = { "1": 1, "2": 0.5, "4": 0.25, "2f": 0.5, "4f": 0.25 };
for (const k of SIZES) {
  const { w, h, simRes } = MS.MAP_SIZES[k];
  const bm = new Boltzmann(w, h, RES[simRes], 90, 4.5, undefined, 8);
  // The root grid is whole cells: with 4 m cells the 50 m width rounds up
  // to 13 cells (52 m), so the lattice may overhang the map by < 1 cell.
  const cell = 1 / RES[simRes];
  assert(bm.width === Math.ceil(w * RES[simRes] - 1e-9) && bm.height === Math.ceil(h * RES[simRes] - 1e-9) && bm.latticeWorldWidth >= w && bm.latticeWorldWidth < w + cell && bm.latticeWorldHeight >= h && bm.latticeWorldHeight < h + cell,
    `${k}: root grid ${bm.width}×${bm.height} (${bm.cellSize} m cells, ${bm.width * bm.height} cells) covers ${w}×${h} m (lattice ${bm.latticeWorldWidth}×${bm.latticeWorldHeight} m)`);
  assert(bm.width * bm.height <= 20000, `${k}: root grid stays ≤ 20k cells`);
  bm.stopSimulation?.();
}

// --- Scenario extents cover the layouts; course scenarios fit the default ---
function pts(o, acc = []) {
  if (o && typeof o === "object") {
    if (typeof o.x === "number" && typeof o.y === "number") acc.push(o);
    for (const v of Object.values(o)) pts(v, acc);
  }
  return acc;
}
const LAYOUTS = { 12: TRIANGLE_COURSE_LAYOUT, 13: WINDWARD_LEEWARD_LAYOUT, 14: START_COURSE_LAYOUT, 15: MARK_ROOM_LAYOUT, 16: FINISH_COURSE_LAYOUT, 17: TEST_RACE_LAYOUT };
for (const [n, L] of Object.entries(LAYOUTS)) {
  const p = pts(L), e = MS.scenarioExtent(Number(n));
  const mx = Math.max(...p.map((q) => Math.abs(q.x))), my = Math.max(...p.map((q) => Math.abs(q.y)));
  assert(mx + 1 <= e.x && my + 1 <= e.y, `scenario ${n}: layout ±${mx.toFixed(1)} × ±${my.toFixed(1)} inside its extent ±${e.x} × ±${e.y}`);
  assert(MS.scenarioFits(Number(n), "100x200") && MS.scenarioFits(Number(n), "200x400") && !MS.scenarioFits(Number(n), "50x100"), `scenario ${n}: fits 100x200 and 200x400, not 50x100`);
  assert(MS.fitMapSize(Number(n), "50x100") === "100x200" && MS.fitMapSize(Number(n), "200x400") === "200x400", `scenario ${n}: 50x100 clamps to 100x200, 200x400 kept`);
  assert(MS.scenarioFits(Number(n), "75x75"), `scenario ${n}: still fits the old 75 m square`);
}
for (let n = 0; n <= 11; n++) assert(SIZES.every((k) => MS.fitMapSize(n, k) === k), `scenario ${n}: fits every size`);

// --- Camera shows the whole length ---
for (const k of SIZES) {
  const { w, h } = MS.MAP_SIZES[k];
  const c = MS.cameraLimits(w, h);
  const halfView = c.zoomMax * Math.tan(35 * Math.PI / 180);
  assert(halfView >= h / 2 && c.xMax === w / 2 - 7.5 && c.yMax === h / 2 - 7.5, `${k}: zoom-out ${c.zoomMax} sees ±${halfView.toFixed(0)} m ≥ ±${h / 2}; pan ±${c.xMax} × ±${c.yMax}`);
}

// --- Scenario 17 race on the default size ---
{
  R.resetContacts(); resetMarkTouches();
  const DT = 1 / 30;
  const { w, h } = MS.MAP_SIZES[MS.DEFAULT_MAP_SIZE];
  const m = new Map(w, h, 90, 4.5, null);
  m.physics_model_init();
  m.setDevMode(true);
  const { boats, marks, seq, course, results, leaderboard, bots } = setupTestRace(m);
  let endAt = null;
  for (let i = 0; i < 150 * 30; i++) {
    for (const b of boats) b.physics_model_step();
    for (const mk of marks) mk.physics_model_step();
    m.world.step(DT);
    seq.step(DT); seq.update(boats);
    for (const b of boats) course.progressFor(b).update(b.x, b.y);
    results.update(boats, seq.clock);
    for (const bot of bots) bot.step(seq.clock, 90, boats, results.isFinished(bot.boat), results.entries.length);
    leaderboard.update(boats, seq.clock, 90);
    R.beginRule15Step(seq.clock);
    R.recordContacts(R.evaluateAllPairs(boats, (x, y) => m.get_wind(x, y), seq.clock, {}), seq.clock, boats);
    recordMarkTouches(boats, marks, { simTime: seq.clock, racing: seq.racing });
    if (results.entries.length === 3 && endAt === null) endAt = seq.clock;
    if (endAt !== null && seq.clock > endAt + 5) break;
  }
  const d = results.toData();
  console.log("     results:", d.map((e) => `P${e.position} boat ${e.boat} ${e.elapsed.toFixed(1)} s`).join(", "));
  assert(d.length === 3, `scenario 17 on ${MS.DEFAULT_MAP_SIZE}: all three finish`);
  assert(R.getIncidents().length === 0 && getMarkTouches().length === 0, "no contacts, no mark touches");
  const wallX = w / 2 - MS.WALL_INSET_M, wallY = h / 2 - MS.WALL_INSET_M;
  assert(boats.every((b) => Math.abs(b.x) < wallX - 2 && Math.abs(b.y) < wallY - 2), "boats stay inside the walls");
}
console.log("map-size-check: all passed");
