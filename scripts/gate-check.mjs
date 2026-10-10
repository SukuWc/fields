// Headless checks for gate course elements (src/course.js Gate) on the
// scenario 13 windward-leeward course: mark 1 windward (to port), element 2
// a leeward gate. Boat positions are scripted point by point; the last block
// runs the real boat, marks, and planck world.
// Run: node --import ./test/register.mjs scripts/gate-check.mjs

const info = { innerHTML: "" };
globalThis.addEventListener = () => {};
globalThis.window = globalThis;
globalThis.location = { href: "http://localhost/" };
globalThis.document = {
  getElementById() { return info; },
  getElementsByTagName() { return []; },
  currentScript: { src: "http://localhost/gate-check.mjs" },
  createElement() { return { getContext() { return null; } }; },
};

const {
  Course,
  CourseProgress,
  Gate,
  isGate,
  GATE_PASS_HYST_M,
  COURSE_ACTIVATION_RADIUS_M,
  COURSE_NEXT_COLOR,
  COURSE_MID_COLOR,
  WINDWARD_LEEWARD_LAYOUT,
  TRIANGLE_COURSE_LAYOUT,
  courseGuides,
  courseText,
} = await import("../src/course.js");

function assert(cond, message) {
  if (!cond) {
    console.error("FAIL", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log("ok  ", message);
}

const DEG = Math.PI / 180;
const L = WINDWARD_LEEWARD_LAYOUT;
const W = L.windward;
const [GA, GB] = L.gate;
const GM = { x: (GA.x + GB.x) / 2, y: (GA.y + GB.y) / 2 };

function newState(gateSpec = "class") {
  const wm = { anchor: { ...W } };
  const ga = { anchor: { ...GA } };
  const gb = { anchor: { ...GB } };
  const gate = gateSpec === "class" ? new Gate(ga, gb) : { gate: [ga, gb] };
  const course = new Course([wm, gate], { start: L.start });
  return { course, p: new CourseProgress(course), at: L.start };
}

function walk(state, to, onStep) {
  const from = state.at;
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.25));
  for (let i = 1; i <= n; i++) {
    state.p.update(from.x + (to.x - from.x) * i / n, from.y + (to.y - from.y) * i / n);
    if (onStep) onStep();
  }
  state.at = to;
  return to;
}

function arc(state, c, r, a0, a1) {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0)));
  for (let i = 1; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    state.p.update(c.x + r * Math.cos(a * DEG), c.y + r * Math.sin(a * DEG));
  }
  state.at = { x: c.x + r * Math.cos(a1 * DEG), y: c.y + r * Math.sin(a1 * DEG) };
}

// Beat up and round the windward mark to port (from south, anticlockwise
// round to north and on to the west, then down the run).
function roundWindward(s, r = 4) {
  walk(s, { x: W.x + r, y: W.y - 10 });
  walk(s, { x: W.x + r, y: W.y });
  arc(s, W, r, 0, 200);
}

// --- API and geometry ---
{
  const s = newState();
  assert(isGate(s.course.marks[1]) && !isGate(s.course.marks[0]), "course mixes a single mark and a gate");
  assert(isGate(newState("plain").course.marks[1]), "{gate: [a, b]} is accepted as a gate");
  const r = s.course.rounding(1);
  assert(r.gate && Math.abs(r.at.x - GM.x) < 1e-9 && Math.abs(r.at.y - GM.y) < 1e-9, "gate position is the midpoint of its anchors");
  assert(r.ny < -0.99, "gate far side is downwind (leg from the windward mark)");
  const w = s.course.rounding(2);
  assert(Math.abs(w.prev.x - GM.x) < 1e-9 && Math.abs(w.prev.y - GM.y) < 1e-9, "windward mark lap 2 incoming ray comes from the gate midpoint");
  assert(Math.abs(GB.x - GA.x) >= 12 && Math.abs(GB.x - GA.x) <= 16 && GA.y === GB.y, "gate is 3–4 boat lengths wide, square to the wind");
  assert(GATE_PASS_HYST_M >= 0.5 && GATE_PASS_HYST_M <= 1, `gate hysteresis ${GATE_PASS_HYST_M} m`);
  // Triangle course still behaves as before (no gate code path).
  const tri = new Course(TRIANGLE_COURSE_LAYOUT.marks.map((p) => ({ anchor: p })), { start: TRIANGLE_COURSE_LAYOUT.start });
  assert(tri.marks.every((m) => !isGate(m)) && tri.rounding(0).roundedDeg > 0, "single-mark courses unchanged");
}

// --- Passing between the marks downwind advances the target ---
{
  const s = newState();
  assert(courseText(s.p) === "Course: next mark 1 (port) · lap 1", `start text: "${courseText(s.p)}"`);
  roundWindward(s);
  assert(s.p.target === 1, "windward mark rounded, target is the gate");
  walk(s, { x: GM.x + 2, y: GA.y + 15 });
  assert(s.p.displayIndex === 1, "gate highlighted on the run");
  assert(courseText(s.p) === "Course: next gate 2 · lap 1", `run text: "${courseText(s.p)}"`);
  let advancedAt = null;
  walk(s, { x: GM.x + 2, y: GA.y - 3 }, () => { if (advancedAt === null && s.p.target === 2) advancedAt = s.p.view(1); });
  assert(s.p.target === 2 && s.p.isRounded(1), "sailing between the gate marks passes the gate");
  assert(s.p.display === 1 && s.p.view(1).rounded, "passed gate keeps the highlight inside the gate zone");
  const labels = courseGuides(s.course, s.p, 0).filter((g) => g.type === "label").map((g) => g.lines[0].text);
  assert(labels.includes("✓ 2"), `passed gate label: ${labels.join(", ")}`);
  assert(courseText(s.p) === "Course: next mark 1 (port) · lap 2", `after gate: "${courseText(s.p)}"`);
}

// --- Hysteresis: the pass needs GATE_PASS_HYST_M past the line ---
{
  const s = newState();
  roundWindward(s);
  walk(s, { x: GM.x, y: GA.y + 5 });
  walk(s, { x: GM.x, y: GA.y - GATE_PASS_HYST_M * 0.5 });
  assert(s.p.target === 1, "just across the line (inside the hysteresis): not passed yet");
  walk(s, { x: GM.x, y: GA.y - GATE_PASS_HYST_M - 0.1 });
  assert(s.p.target === 2, "past the hysteresis: passed");
  // Wobble on the line: no flicker.
  let flips = 0;
  let last = s.p.target;
  for (let i = 0; i < 40; i++) {
    walk(s, { x: GM.x, y: GA.y + (i % 2 ? -0.5 : 0.5) * GATE_PASS_HYST_M }, () => {
      if (s.p.target !== last) { flips++; last = s.p.target; }
    });
  }
  assert(flips <= 1, `wobbling across the line inside the hysteresis band does not flicker (${flips} change)`);
}

// --- Crossing back unpasses ---
{
  const s = newState();
  roundWindward(s);
  walk(s, { x: GM.x - 1, y: GA.y + 5 });
  walk(s, { x: GM.x - 1, y: GA.y - 3 });
  assert(s.p.target === 2, "passed");
  walk(s, { x: GM.x + 1, y: GA.y + 3 });
  assert(s.p.target === 1 && !s.p.isRounded(1), "sailing back up through the gate unpasses it, target moves back");
  assert(s.p.display === 1, "gate highlighted again");
  walk(s, { x: GM.x + 1, y: GA.y - 3 });
  assert(s.p.target === 2, "passing again counts");
}

// --- Passing outside either mark does not count ---
for (const [name, x] of [["west of the west mark", GA.x - 3], ["east of the east mark", GB.x + 3]]) {
  const s = newState();
  roundWindward(s);
  walk(s, { x, y: GA.y + 10 });
  walk(s, { x, y: GA.y - 6 });
  assert(s.p.target === 1, `passing ${name} does not pass the gate`);
  // Coming back up outside and then down through: counts.
  walk(s, { x, y: GA.y + 4 });
  walk(s, { x: GM.x, y: GA.y + 4 });
  walk(s, { x: GM.x, y: GA.y - 3 });
  assert(s.p.target === 2, `after going back round (${name}), sailing through the gate counts`);
}
{
  // Pass outside, then come up through the gate from below: backward, net −1.
  const s = newState();
  roundWindward(s);
  walk(s, { x: GA.x - 3, y: GA.y + 6 });
  walk(s, { x: GA.x - 3, y: GA.y - 4 });
  walk(s, { x: GM.x, y: GA.y - 4 });
  walk(s, { x: GM.x, y: GA.y + 4 });
  walk(s, { x: GM.x, y: GA.y - 4 });
  assert(s.p.target === 1, "outside down, back up through the gate, then down again: net zero, not passed");
}

// --- After passing, either gate mark may be rounded; highlight release ---
for (const [name, m, dir] of [["west mark (to port: turn right, west)", GA, -1], ["east mark (to starboard: turn left, east)", GB, 1]]) {
  const s = newState();
  roundWindward(s);
  walk(s, { x: GM.x, y: GA.y + 8 });
  walk(s, { x: GM.x, y: GA.y - 3 });
  assert(s.p.target === 2, `passed (${name})`);
  // Round the chosen mark: below it, out to the side, then back up the beat.
  walk(s, { x: m.x, y: m.y - 3 });
  walk(s, { x: m.x + dir * 3, y: m.y });
  walk(s, { x: m.x + dir * 3, y: m.y + 5 });
  assert(s.p.target === 2 && s.p.display === 1, `rounding the ${name} keeps the gate passed and highlighted inside the zone`);
  walk(s, { x: m.x + dir * 3, y: m.y + COURSE_ACTIVATION_RADIUS_M + 3 });
  assert(s.p.target === 2 && s.p.display === 2 && s.p.displayIndex === 0, `clear of the gate zone the highlight moves to mark 1 (${name})`);
}

// --- Full lap wraps ---
{
  const s = newState();
  for (let lap = 1; lap <= 3; lap++) {
    roundWindward(s);
    walk(s, { x: GM.x, y: GA.y + 8 });
    walk(s, { x: GM.x, y: GA.y - 3 });
    walk(s, { x: GB.x + 3, y: GB.y });
    walk(s, { x: GB.x + 4, y: GB.y + 20 });
    assert(s.p.lap === lap + 1 && s.p.lapsCompleted === lap && s.p.displayIndex === 0, `lap ${lap} completes, lap ${lap + 1} sails for mark 1`);
  }
  // Ticks belong to the current lap: none at the start of a lap.
  assert(s.p.roundedMarks().size === 0, "no stale ticks at the start of a lap");
}

// --- Overlay ---
{
  const s = newState();
  roundWindward(s);
  walk(s, { x: GM.x, y: GA.y + 15 });
  const gs = courseGuides(s.course, s.p, 500);
  const labels = gs.filter((g) => g.type === "label").map((g) => g.lines[0].text);
  assert(labels.includes("NEXT GATE 2") && labels.length === 2, `one gate label: ${labels.join(", ")}`);
  const ring = (c) => gs.some((g) => g.type === "guide" && g.color === COURSE_NEXT_COLOR && Math.hypot(g.x1 - c.x, g.y1 - c.y) < 2);
  assert(ring(GA) && ring(GB), "both gate marks get the green ring");
  const gateLine = gs.filter((g) => g.type === "guide" && g.color === COURSE_MID_COLOR && Math.abs(g.y1 - GA.y) < 1e-9 && Math.abs(g.y2 - GA.y) < 1e-9);
  assert(gateLine.length > 3, `dashed gate line between the marks (${gateLine.length} dashes)`);
  const courseToMid = gs.some((g) => g.type === "guide" && Math.abs(g.x1 - W.x) < 1e-9 && Math.abs(g.y1 - W.y) < 1e-9 && Math.abs(g.x2 - W.x) < 1e-9);
  assert(courseToMid, "course line runs from the windward mark toward the gate midpoint");
  assert(gs.every((x) => x.type === "label" ? Number.isFinite(x.x) && Number.isFinite(x.y) : [x.x1, x.y1, x.x2, x.y2].every(Number.isFinite)), "all guide coordinates finite");
  const fresh = newState();
  const l0 = courseGuides(fresh.course, fresh.p, 0).filter((g) => g.type === "label").map((g) => g.lines[0].text);
  assert(l0.includes("GATE 2") && l0.some((t) => t.startsWith("NEXT 1")), `start labels: ${l0.join(", ")}`);
}

// --- Real world: scenario 13 boat, marks, and planck ---
{
  const { Map } = await import("../src/map.js");
  const { Boat } = await import("../src/boat.js");
  const { Mark, markMassForBoat } = await import("../src/mark.js");
  const map = new Map(75, 75, 90, 15, null);
  map.physics_model_init();
  map.setDevMode(true);
  const boat = new Boat(map, L.start.x, L.start.y, L.startHeading);
  const mass = markMassForBoat(boat.physics_model);
  const wm = new Mark(map, W.x, W.y, { mass });
  const ga = new Mark(map, GA.x, GA.y, { mass });
  const gb = new Mark(map, GB.x, GB.y, { mass });
  const real = [wm, ga, gb];
  const course = new Course([wm, new Gate(ga, gb)], { start: L.start });
  boat.input_autopilot_enabled_toggle();
  const progress = course.progressFor(boat);
  const step = () => {
    boat.physics_model_step();
    for (const m of real) m.physics_model_step();
    map.world.step(1 / 30);
    progress.update(boat.x, boat.y);
  };
  for (let i = 0; i < 300; i++) step();
  assert(Number.isFinite(boat.x) && Number.isFinite(boat.y) && progress.target === 0, `10 s of starboard close-hauled: boat at (${boat.x.toFixed(1)}, ${boat.y.toFixed(1)}), sailing for mark 1`);
  // Put the boat just past mark 1 (rounded by script), then let physics run
  // her down through the gate.
  roundWindward({ p: progress, at: { x: boat.x, y: boat.y } });
  assert(progress.target === 1, "mark 1 rounded (scripted)");
  boat.autopilot_enabled = false;
  boat.physics_model.setTransform({ x: GM.x, y: GA.y + 10 }, 0);
  boat.physics_model.setLinearVelocity({ x: 0, y: -2 });
  boat.physics_model.setAngularVelocity(0);
  let ok = true;
  for (let i = 0; i < 600 && progress.target < 2; i++) {
    step();
    progress.update(boat.x, boat.y);
    ok = ok && Number.isFinite(boat.x) && Number.isFinite(boat.y);
  }
  assert(ok && progress.target === 2, `physics boat running downwind passes the gate (boat at ${boat.x.toFixed(1)}, ${boat.y.toFixed(1)})`);
  assert([ga, gb].every((m) => Math.hypot(m.x - m.anchor.x, m.y - m.anchor.y) < 1), "gate buoys stay on station");
  const gs = courseGuides(course, progress, 1234);
  assert(gs.length > 20, `scenario overlay draws (${gs.length} guides)`);
  for (const p of [W, GA, GB]) {
    for (const q of [{ x: 0, y: 14.5, r: 0.5 }, { x: 0, y: 20, r: 5 }]) {
      assert(Math.hypot(p.x - q.x, p.y - q.y) > q.r + COURSE_ACTIVATION_RADIUS_M / 2, `mark (${p.x}, ${p.y}) is clear of the map.js circle at (${q.x}, ${q.y})`);
    }
    assert(Math.abs(p.x) <= 35.5 - 7.5 && Math.abs(p.y) <= 35.5 - 9.5, `mark (${p.x}, ${p.y}) has room to round inside the walls`);
  }
}

if (!process.exitCode) console.log("gate-check: all passed");
