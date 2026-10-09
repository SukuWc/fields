// Headless checks for the course rounding tracker (src/course.js) on the
// scenario 12 triangle (anticlockwise, every mark to port). Boat positions
// are scripted point by point; one block at the end runs the real boat,
// marks, and planck world for a few seconds.
// Run: node --import ./test/register.mjs scripts/course-check.mjs

const info = { innerHTML: "" };
globalThis.addEventListener = () => {};
globalThis.window = globalThis;
globalThis.location = { href: "http://localhost/" };
globalThis.document = {
  getElementById() { return info; },
  getElementsByTagName() { return []; },
  currentScript: { src: "http://localhost/course-check.mjs" },
  createElement() { return { getContext() { return null; } }; },
};

const {
  Course,
  CourseProgress,
  PORT,
  STARBOARD,
  COURSE_ACTIVATION_RADIUS_M,
  ROUNDING_HYST_DEG,
  COURSE_TRACK_BACK,
  TRIANGLE_COURSE_LAYOUT,
  roundingGeometry,
  courseGuides,
  courseText,
  wrap180,
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
const L = TRIANGLE_COURSE_LAYOUT;
// Plain anchored points stand in for Mark instances (course.js reads .anchor).
const marks = L.marks.map((p) => ({ anchor: { x: p.x, y: p.y } }));

function newProgress() {
  const course = new Course(marks, { start: L.start });
  return { course, p: new CourseProgress(course) };
}

// Walk a straight line in 0.25 m steps.
function walk(state, from, to) {
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.25));
  for (let i = 1; i <= n; i++) state.p.update(from.x + (to.x - from.x) * i / n, from.y + (to.y - from.y) * i / n);
  state.at = to;
  return to;
}

// Arc round centre c at radius r from bearing a0 to a1 (degrees, unwrapped:
// a1 > a0 is anticlockwise) in 1° steps. Calls onStep(bearing) after each.
function arc(state, c, r, a0, a1, onStep) {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0)));
  for (let i = 1; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    state.p.update(c.x + r * Math.cos(a * DEG), c.y + r * Math.sin(a * DEG));
    if (onStep) onStep(a);
  }
  state.at = { x: c.x + r * Math.cos(a1 * DEG), y: c.y + r * Math.sin(a1 * DEG) };
  return state.at;
}

function pt(c, deg, r) {
  return { x: c.x + r * Math.cos(deg * DEG), y: c.y + r * Math.sin(deg * DEG) };
}

// Round rounding k to port at radius r: walk to the incoming side, then arc
// anticlockwise from just off the incoming ray to `past` degrees beyond the
// outgoing ray. Returns the bearings at which the target advanced (rounded,
// midpoint ray) and the highlight moved on (outgoing ray).
function roundPort(state, k, r = 5, past = 15) {
  const g = state.course.rounding(k);
  const a0 = g.inDeg + 10;
  walk(state, state.at, pt(g.at, a0, r));
  let roundedAt = null;
  let releasedAt = null;
  const a1 = a0 + (g.nextLegDeg - 10) + past;
  arc(state, g.at, r, a0, a1, (a) => {
    if (roundedAt === null && state.p.target > k) roundedAt = a;
    if (releasedAt === null && state.p.display > k) releasedAt = a;
  });
  return { g, roundedAt, releasedAt };
}

// --- Geometry ---

{
  const { course } = newProgress();
  const r1 = course.rounding(0);
  assert(r1.side === PORT && course.sides.every((s) => s === PORT), "anticlockwise course: every mark to port");
  for (const k of [1, 2, 3, 4, 5]) {
    const r = course.rounding(k);
    assert(Math.abs(r.nextLegDeg - 300) < 1e-6 && Math.abs(r.roundedDeg - 150) < 1e-6 && Math.abs(r.turnDeg - 120) < 1e-6, `rounding ${k} (mark ${r.index + 1}): 120° turn, rounded at 150°, next leg at 300°`);
    assert(Math.abs(wrap180(r.midDeg - (r.inDeg + 150))) < 1e-9, `rounding ${k}: midpoint ray bisects incoming and outgoing rays`);
  }
  assert(Math.abs(r1.nextLegDeg - (180 + r1.turnDeg)) < 1e-9 && Math.abs(r1.roundedDeg - r1.nextLegDeg / 2) < 1e-9 && r1.roundedDeg > 140 && r1.roundedDeg < 150, `mark 1 on lap 1 measures from the start: rounded at ${r1.roundedDeg.toFixed(1)}°, next leg at ${r1.nextLegDeg.toFixed(1)}°`);
  const lap2 = course.rounding(3);
  assert(lap2.index === 0 && lap2.lap === 2 && Math.abs(wrap180(lap2.inDeg - course.rounding(2).outDeg + 180)) < 1e-9, "lap 2 mark 1 comes in from mark 3");
  const straight = roundingGeometry({ x: 0, y: -10 }, { x: 0, y: 0 }, { x: 0, y: 10 }, PORT);
  assert(Math.abs(straight.nextLegDeg - 180) < 1e-9 && Math.abs(straight.roundedDeg - 90) < 1e-9, "a straight pass: rounded abeam (90°), next leg at 180°");
  const stbd = roundingGeometry({ x: 0, y: -10 }, { x: 0, y: 0 }, { x: -10, y: 0 }, STARBOARD);
  assert(Math.abs(stbd.nextLegDeg - 90) < 1e-9 && Math.abs(stbd.turnDeg + 90) < 1e-9, "a mark left to starboard on a 90° left turn needs only 90° (turn −90°)");
  assert(COURSE_ACTIVATION_RADIUS_M === 12 && ROUNDING_HYST_DEG === 5 && COURSE_TRACK_BACK === 2, "constants: 12 m zone, 5° hysteresis, two marks tracked back");
}

// --- Rounded at the midpoint ray; highlight held until the outgoing ray ---

{
  const s = newProgress();
  s.at = L.start;
  walk(s, L.start, { x: 23, y: 5 });
  assert(s.p.target === 0 && s.p.display === 0 && !s.p.view().entered, "outside the zone: target mark 1, counter not started");
  const { g, roundedAt, releasedAt } = roundPort(s, 0);
  assert(roundedAt !== null, "port rounding of mark 1 rounds it");
  const overMid = roundedAt - (g.inDeg + g.roundedDeg);
  assert(overMid >= 0 && overMid < 1.5, `rounded as the check line crosses the midpoint ray (${overMid.toFixed(2)}° past)`);
  assert(releasedAt !== null, "the highlight moves on");
  const overOut = releasedAt - (g.inDeg + g.nextLegDeg);
  assert(overOut >= 0 && overOut < 1.5, `highlight moves on as the check line crosses the outgoing ray (${overOut.toFixed(2)}° past)`);
  assert(s.p.target === 1 && s.p.targetIndex === 1 && s.p.display === 1 && s.p.displayIndex === 1 && s.p.lap === 1, "target and highlight are mark 2, lap 1");
  walk(s, s.at, pt(marks[1].anchor, s.course.rounding(1).inDeg, 20));
  assert(s.p.target === 1, "sailing the reach to mark 2 keeps mark 1 rounded");
}

{
  // Between the rays: rounded but still highlighted, and the overlay says so.
  const s = newProgress();
  s.at = L.start;
  const g = s.course.rounding(0);
  walk(s, L.start, pt(g.at, g.inDeg + 10, 5));
  arc(s, g.at, 5, g.inDeg + 10, g.inDeg + 220);
  assert(s.p.target === 1 && s.p.isRounded(0), "past the midpoint: mark 1 is rounded, target mark 2");
  assert(s.p.display === 0 && s.p.displayIndex === 0, "before the outgoing ray: mark 1 is still highlighted");
  const v = s.p.view();
  assert(v.rounded && v.index === 0, "view() is the highlighted mark, flagged rounded");
  const labels = courseGuides(s.course, s.p, s.at, 0).filter((x) => x.type === "label").map((x) => x.lines[0].text);
  assert(labels.includes("✓ 1 rounded"), "highlighted mark shows the tick");
  assert(labels.includes("220° / 146° ✓ · 292°"), `arc label: ${labels.find((t) => /✓ ·/.test(t))}`);
  assert(labels.includes("rounded") && labels.includes("next leg"), "midpoint and outgoing rays are labelled");
  assert(/mark 1 rounded, sail on/.test(courseText(s.p)), `progress text: "${courseText(s.p)}"`);
}

{
  // Rounded, then sail off out of the zone without reaching the outgoing ray.
  const s = newProgress();
  s.at = L.start;
  const g = s.course.rounding(0);
  walk(s, L.start, pt(g.at, g.inDeg + 10, 5));
  arc(s, g.at, 5, g.inDeg + 10, g.inDeg + 200);
  assert(s.p.display === 0 && s.p.target === 1, "rounded, still highlighted");
  const exit = g.inDeg + 200;
  let movedAt = null;
  for (let r = 5; r <= 16; r += 0.1) {
    s.p.update(g.at.x + r * Math.cos(exit * DEG), g.at.y + r * Math.sin(exit * DEG));
    if (movedAt === null && s.p.display === 1) movedAt = r;
  }
  s.at = pt(g.at, exit, 16);
  assert(movedAt !== null && movedAt > COURSE_ACTIVATION_RADIUS_M && movedAt < COURSE_ACTIVATION_RADIUS_M + 0.2, `leaving the zone after rounding moves the highlight on (at ${movedAt && movedAt.toFixed(1)} m)`);
  walk(s, s.at, pt(g.at, exit, 8));
  assert(s.p.display === 1, "coming back into the zone does not take the highlight back (release is latched)");
  arc(s, g.at, 8, exit, g.inDeg + g.roundedDeg - ROUNDING_HYST_DEG - 1);
  assert(s.p.target === 0 && s.p.display === 0, "unwinding below the midpoint brings target and highlight back to mark 1");
}

// --- Wrong side: starboard passes do not count ---

{
  const s = newProgress();
  s.at = L.start;
  const g = s.course.rounding(0);
  walk(s, L.start, pt(g.at, g.inDeg - 10, 5));
  // Clockwise from just right of the incoming ray to the outgoing ray (mark
  // on the boat's starboard side), then on to mark 2.
  const a0 = g.inDeg - 10;
  const cw = (((a0 - g.outDeg) % 360) + 360) % 360;
  arc(s, g.at, 5, a0, a0 - cw - 5);
  walk(s, s.at, marks[1].anchor);
  assert(s.p.target === 0 && s.p.display === 0, `leaving mark 1 to starboard does not round it (swept ${s.p.view().swept.toFixed(0)}°)`);
  const b = Math.atan2(s.at.y - g.at.y, s.at.x - g.at.x) / DEG;
  walk(s, s.at, pt(g.at, b, 6));
  arc(s, g.at, 6, b, b - 360);
  assert(s.p.target === 0 && s.p.view().swept < 0, "a clockwise circle unwinds instead of counting");
  arc(s, g.at, 6, b - 360, b - 360 + 200);
  assert(s.p.target === 0, "200° anticlockwise after the clockwise circle is still short of the midpoint");
}

// --- Zone: the counter starts inside, holds outside ---

{
  const s = newProgress();
  s.at = L.start;
  const g = s.course.rounding(0);
  walk(s, L.start, pt(g.at, g.inDeg + 5, 15));
  arc(s, g.at, 15, g.inDeg + 5, g.inDeg + 5 + 340);
  assert(s.p.target === 0 && !s.p.view().entered, "a wide circle outside the 12 m zone does not round the mark");
  const s2 = newProgress();
  s2.at = L.start;
  walk(s2, L.start, pt(g.at, g.inDeg + 5, 8));
  const before = s2.p.view().swept;
  walk(s2, s2.at, pt(g.at, g.inDeg + 5, 16));
  arc(s2, g.at, 16, g.inDeg + 5, g.inDeg + 65);
  assert(Math.abs(s2.p.view().swept - before) < 1e-9, "outside the zone the count is held");
  walk(s2, s2.at, pt(g.at, g.inDeg + 65, 8));
  assert(Math.abs(s2.p.view().swept - before - 60) < 1e-6, `re-entering adds the arc sailed outside (${(s2.p.view().swept - before).toFixed(1)}°)`);
  arc(s2, g.at, 8, g.inDeg + 65, g.inDeg + g.roundedDeg + 2);
  assert(s2.p.target === 1, "and the rounding completes inside");
}

// --- Hysteresis on the midpoint ray ---

{
  const s = newProgress();
  s.at = L.start;
  const g = s.course.rounding(0);
  walk(s, L.start, pt(g.at, g.inDeg + 10, 5));
  const mid = g.inDeg + g.roundedDeg;
  arc(s, g.at, 5, g.inDeg + 10, mid + 1);
  assert(s.p.target === 1 && s.p.display === 0, "rounded just past the midpoint ray, still highlighted");
  let flips = 0;
  let last = s.p.target;
  let a = mid + 1;
  for (let i = 0; i < 20; i++) {
    const to = i % 2 ? mid + 3 : mid - 3;
    arc(s, g.at, 5, a, to, () => { if (s.p.target !== last) { flips++; last = s.p.target; } });
    a = to;
  }
  assert(flips === 0 && s.p.display === 0, `wobbling ±3° on the midpoint ray does not flicker (hysteresis ${ROUNDING_HYST_DEG}°)`);
  arc(s, g.at, 5, a, mid - ROUNDING_HYST_DEG - 1);
  assert(s.p.target === 0, "dropping more than the hysteresis below the midpoint unrounds it");
  arc(s, g.at, 5, mid - ROUNDING_HYST_DEG - 1, mid + 0.5);
  assert(s.p.target === 1, "and coming back past the midpoint rounds it again");
}

// --- Unwinding the previous mark moves the target back ---

{
  const s = newProgress();
  s.at = L.start;
  roundPort(s, 0);
  assert(s.p.target === 1 && s.p.display === 1, "mark 1 rounded and released");
  const g = s.course.rounding(0);
  walk(s, s.at, pt(g.at, g.outDeg, 9));
  assert(s.p.target === 1, "still mark 2 on the reach");
  // Unwrapped bearings: the outgoing ray is inDeg + nextLegDeg.
  const out = g.inDeg + g.nextLegDeg;
  const mid = g.inDeg + g.roundedDeg;
  arc(s, g.at, 9, out, mid + 20);
  assert(s.p.target === 1, "turning back clockwise but still past the midpoint: still rounded");
  arc(s, g.at, 9, mid + 20, mid - ROUNDING_HYST_DEG - 1);
  assert(s.p.target === 0 && s.p.targetIndex === 0 && s.p.display === 0, "going back round mark 1 below the midpoint unwinds it: target and highlight back to mark 1");
  arc(s, g.at, 9, mid - ROUNDING_HYST_DEG - 1, out + 10);
  assert(s.p.target === 1 && s.p.display === 1, "rounding it again moves both forward");
}

// --- A full lap wraps to mark 1 with a lap counter ---

{
  const s = newProgress();
  s.at = L.start;
  for (const k of [0, 1, 2]) {
    const { roundedAt, releasedAt } = roundPort(s, k);
    assert(roundedAt !== null && releasedAt !== null && s.p.target === k + 1 && s.p.display === k + 1, `mark ${k + 1} rounded and released`);
    walk(s, s.at, pt(s.course.rounding(k).at, s.course.rounding(k).outDeg, 16));
  }
  assert(s.p.target === 3 && s.p.targetIndex === 0 && s.p.displayIndex === 0 && s.p.lap === 2 && s.p.lapsCompleted === 1, "after mark 3 the target is mark 1 again, lap 2");
  assert(s.p.isRounded(0) && !s.p.trackers.has(0), "the oldest rounding is frozen (not tracked)");
  assert(s.p.trackers.size <= COURSE_TRACK_BACK + 1, `at most ${COURSE_TRACK_BACK + 1} counters live`);
  assert(s.p.roundedThisLap().length === 0, "a new lap starts with no marks rounded");
  roundPort(s, 3);
  assert(s.p.target === 4 && s.p.lap === 2 && s.p.roundedThisLap()[0] === 0, "lap 2 mark 1 rounds and shows as rounded this lap");
  const text = courseText(s.p);
  assert(/next mark 2 \(port\) · lap 2/.test(text), `progress text: "${text}"`);
}

// --- Guides: next mark labelled, check line and rays present ---

{
  const s = newProgress();
  s.at = L.start;
  const g = s.course.rounding(0);
  walk(s, L.start, pt(g.at, g.inDeg + 10, 5));
  arc(s, g.at, 5, g.inDeg + 10, g.inDeg + 120);
  const boat = s.at;
  const guides = courseGuides(s.course, s.p, boat, 0);
  const labels = guides.filter((x) => x.type === "label").map((x) => x.lines[0].text);
  assert(labels.includes("NEXT 1 · port"), "the next mark carries a NEXT label");
  assert(labels.includes("2") && labels.includes("3"), "other marks are numbered");
  assert(labels.includes("120° / 146° · 292°"), `check-angle label before rounding (${labels.find((t) => /°/.test(t))})`);
  const check = guides.find((x) => x.type === "guide" && x.x2 === boat.x && x.y2 === boat.y);
  assert(check && check.x1 === g.at.x && check.y1 === g.at.y, "a line runs from the mark centre to the boat");
  assert(guides.every((x) => x.type === "label" ? Number.isFinite(x.x) && Number.isFinite(x.y) : [x.x1, x.y1, x.x2, x.y2].every(Number.isFinite)), "all guide coordinates finite");
}

// --- Real world: scenario 12 boat, marks, and planck, a few seconds ---

{
  const { Map } = await import("../src/map.js");
  const { Boat } = await import("../src/boat.js");
  const { Mark, markMassForBoat } = await import("../src/mark.js");
  const map = new Map(75, 75, 90, 15, null);
  map.physics_model_init();
  map.setDevMode(true);
  const boat = new Boat(map, L.start.x, L.start.y, L.startHeading);
  const mass = markMassForBoat(boat.physics_model);
  const real = L.marks.map((p) => new Mark(map, p.x, p.y, { mass }));
  const course = new Course(real, { start: L.start });
  boat.input_autopilot_enabled_toggle();
  const progress = course.progressFor(boat);
  for (let i = 0; i < 300; i++) {
    boat.physics_model_step();
    for (const m of real) m.physics_model_step();
    map.world.step(1 / 30);
    progress.update(boat.x, boat.y);
  }
  assert(Number.isFinite(boat.x) && Number.isFinite(boat.y) && progress.target === 0, `10 s of starboard close-hauled: boat at (${boat.x.toFixed(1)}, ${boat.y.toFixed(1)}), still sailing for mark 1`);
  assert(course.progressFor(boat) === progress, "one progress tracker per boat");
  const gs = courseGuides(course, progress, boat, 1234);
  assert(gs.length > 50, `scenario overlay draws (${gs.length} guides)`);
  for (const p of L.marks) {
    for (const q of [{ x: 0, y: 14.5, r: 0.5 }, { x: 0, y: 20, r: 5 }]) {
      assert(Math.hypot(p.x - q.x, p.y - q.y) > q.r + COURSE_ACTIVATION_RADIUS_M / 2, `mark (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) is clear of the map.js circle at (${q.x}, ${q.y})`);
    }
    assert(Math.abs(p.x) < 35.5 - 8 && Math.abs(p.y) < 35.5 - 8, "mark has room to round inside the walls");
  }
}

if (!process.exitCode) console.log("course-check: all passed");
