// Headless checks for the start procedure (src/start.js): RRS 26 signal
// timing, OCS at the gun (RRS 29.1), returning, proper start and start time,
// course progress waiting for the start, and scenario 14 in the planck world.
// Run: node --import ./test/register.mjs scripts/start-check.mjs

const info = { innerHTML: "" };
globalThis.addEventListener = () => {};
globalThis.window = globalThis;
globalThis.location = { href: "http://localhost/" };
globalThis.document = {
  getElementById() { return info; },
  getElementsByTagName() { return []; },
  currentScript: { src: "http://localhost/start-check.mjs" },
  createElement() { return { getContext() { return null; } }; },
};

const {
  StartLine,
  StartSequence,
  RRS_START_TIMINGS,
  COMPRESSED_START_TIMINGS,
  START_OCS_EXT_M,
  START_COURSE_LAYOUT,
  formatStartClock,
  startHudHtml,
  startGuides,
  startStatusText,
} = await import("../src/start.js");
const { Course, Gate, courseGuides, courseText } = await import("../src/course.js");

function assert(cond, message) {
  if (!cond) {
    console.error("FAIL", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log("ok  ", message);
}

const L = START_COURSE_LAYOUT;
const DT = 1 / 30;

// A 4 m × 1.5 m box hull pointing north (+Y, upwind) with its bow at the top.
function boatAt(x, y) {
  const b = { x, y };
  place(b, x, y);
  return b;
}
function place(b, x, y) {
  b.x = x;
  b.y = y;
  b.hull = [{ x: x - 0.75, y: y - 2 }, { x: x + 0.75, y: y - 2 }, { x: x + 0.75, y: y + 2 }, { x: x - 0.75, y: y + 2 }];
  b.bow = { x, y: y + 2 };
}

function setup(timings = COMPRESSED_START_TIMINGS) {
  const line = new StartLine({ anchor: L.committee }, { anchor: L.pin }, L.windward);
  const seq = new StartSequence(line, { timings, lead: 0 });
  return { line, seq };
}

// Run the clock to `clock`, keeping the boats where they are.
function runTo(seq, boats, clock) {
  while (seq.clock + 1e-9 < clock) {
    seq.step(Math.min(DT, clock - seq.clock));
    seq.update(boats);
  }
}

// Move boat b in a straight line to (x, y) at `speed` m/s.
function sail(seq, boats, b, x, y, speed = 2) {
  const dx = x - b.x;
  const dy = y - b.y;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (speed * DT)));
  const x0 = b.x;
  const y0 = b.y;
  for (let i = 1; i <= n; i++) {
    place(b, x0 + dx * i / n, y0 + dy * i / n);
    seq.step(DT);
    seq.update(boats);
  }
}

const LINE_Y = L.committee.y;
const MID_X = (L.committee.x + L.pin.x) / 2;

// --- Signals ---
{
  assert(RRS_START_TIMINGS.warning === 300 && RRS_START_TIMINGS.prep === 240 && RRS_START_TIMINGS.oneMinute === 60, "default RRS 26 timings 5-4-1-0 minutes");
  const C = COMPRESSED_START_TIMINGS;
  assert(C.warning / 300 === C.prep / 240 && C.prep / 240 === C.oneMinute / 60, `compressed sequence is the RRS one at a fixed scale (${C.warning}/${C.prep}/${C.oneMinute} s)`);
  const { seq } = setup(RRS_START_TIMINGS);
  assert(seq.clock === -300 && seq.signal.id === "warning", "default sequence starts at the warning signal, −5:00");
  const seen = [];
  const at = {};
  let last = seq.signal.id;
  while (seq.clock < 5) {
    seq.step(0.1);
    const id = seq.signal.id;
    if (id !== last) { seen.push(id); at[id] = seq.clock; last = id; }
  }
  assert(seen.join(",") === "prep,oneMinute,start", `signal order ${seen.join(", ")}`);
  assert(Math.abs(at.prep + 240) < 0.11 && Math.abs(at.oneMinute + 60) < 0.11 && Math.abs(at.start) < 0.11, "preparatory at −4:00, one-minute at −1:00, start at 0:00");
  const c = setup();
  c.seq.lead = 0;
  const flags = [];
  for (const t of [-61, -59, -47, -11, 1]) flags.push(c.seq.signalAt(t).flags.join("+") || "-");
  assert(flags.join(" ") === "- class class+P class -", `flags through the compressed sequence: ${flags.join(" ")}`);
  assert(formatStartClock(-45) === "−0:45" && formatStartClock(-44.2) === "−0:45" && formatStartClock(65.5) === "+1:05" && formatStartClock(-300) === "−5:00", "clock format");
  const s2 = new StartSequence(c.line, { timings: COMPRESSED_START_TIMINGS, lead: 2 });
  assert(s2.clock === -62 && s2.signal.id === "none", "lead runs before the warning signal");
  s2.step(2.05);
  assert(s2.signal.id === "warning" && s2.flashing, "HUD flashes on the warning signal");
  s2.step(1);
  assert(!s2.flashing, "flash ends");
}

// --- Behind the line at the gun, then crosses: clean start ---
{
  const { seq } = setup();
  const b = boatAt(MID_X, LINE_Y - 6);
  runTo(seq, [b], -1);
  assert(seq.statusOf(b) === "prestart", "pre-start status before the gun");
  runTo(seq, [b], 3);
  assert(seq.statusOf(b) === "notStarted" && !seq.xFlag, "behind the line at the gun: not OCS, not started yet, no X flag");
  sail(seq, [b], b, MID_X, LINE_Y + 3, 2);
  const s = seq.stateFor(b);
  // Bow from y−4 to the line: 4 m at 2 m/s after t = 3.
  assert(s.started && !s.wasOcs && Math.abs(s.startTime - 5) < 0.1, `clean start, start time ${s.startTime.toFixed(2)} s (expected 5.0)`);
  assert(startStatusText(seq, b) === "Started +5.0 s", `status: ${startStatusText(seq, b)}`);
}

// --- On the course side at the gun: OCS ---
{
  const { seq } = setup();
  const b = boatAt(MID_X, LINE_Y + 1.5); // bow and half the hull over
  const c = boatAt(MID_X + 4, LINE_Y - 1.95); // bow 5 cm over: also OCS
  const d = boatAt(MID_X - 4, LINE_Y - 2.1); // bow 10 cm behind: fine
  runTo(seq, [b, c, d], 0.5);
  assert(seq.statusOf(b) === "ocs" && seq.statusOf(c) === "ocs" && seq.statusOf(d) === "notStarted", "any part of the hull over at the gun is OCS; just behind is not");
  assert(seq.xFlag, "X flag up while a boat is OCS");
  assert(/X flag: individual recall/.test(startHudHtml(seq, b)) && /flag-x/.test(startHudHtml(seq, b)), "HUD shows the X flag");
  const gs = startGuides(seq, b, 0);
  assert(gs.some((g) => g.type === "label" && g.lines[0].text === "OCS — return" && g.lines[0].role === "badge"), "red 'OCS — return' label on the boat");
  // Outside the line span + START_OCS_EXT_M: not OCS (far up the course).
  const { seq: s2 } = setup();
  const far = boatAt(L.committee.x + START_OCS_EXT_M + 2, LINE_Y + 3);
  const near = boatAt(L.committee.x + START_OCS_EXT_M - 1.5, LINE_Y + 3);
  runTo(s2, [far, near], 0.5);
  assert(s2.statusOf(far) === "notStarted" && s2.statusOf(near) === "ocs", `course-side test covers the line plus ${START_OCS_EXT_M} m beyond each end`);
}

// --- OCS boat crossing again without dipping fully back: no start ---
{
  const { seq } = setup();
  const b = boatAt(MID_X, LINE_Y + 1);
  runTo(seq, [b], 1);
  assert(seq.statusOf(b) === "ocs", "OCS at the gun");
  // Back off until the centre is 1 m below: the bow is still 1 m over.
  sail(seq, [b], b, MID_X, LINE_Y - 1, 1);
  assert(seq.statusOf(b) === "ocs", "partly back (bow still over): still OCS");
  sail(seq, [b], b, MID_X, LINE_Y + 4, 2);
  assert(seq.statusOf(b) === "ocs" && !seq.hasStarted(b), "crossing again without the whole hull back: no start, still OCS");
  // Bow dipped under but not the whole hull: rotate the boat, bow pointing
  // down (south) so the bow is below and the stern above.
  const { seq: s2 } = setup();
  const r = { x: MID_X, y: LINE_Y };
  const setDown = (y) => { r.x = MID_X; r.y = y; r.hull = [{ x: MID_X - 0.75, y: y - 2 }, { x: MID_X + 0.75, y: y - 2 }, { x: MID_X + 0.75, y: y + 2 }, { x: MID_X - 0.75, y: y + 2 }]; r.bow = { x: MID_X, y: y - 2 }; };
  setDown(LINE_Y + 1);
  runTo(s2, [r], 1);
  for (let y = LINE_Y + 1; y >= LINE_Y - 1; y -= 0.05) { setDown(y); s2.step(DT); s2.update([r]); }
  assert(s2.statusOf(r) === "ocs", "bow under the line but stern over: not yet returned");
  place(r, MID_X, LINE_Y - 1); // turn round: bow up, now bow 1 m over
  for (let y = LINE_Y - 1; y <= LINE_Y + 3; y += 0.05) { place(r, MID_X, y); s2.step(DT); s2.update([r]); }
  assert(s2.statusOf(r) === "ocs" && !s2.hasStarted(r), "crossing up again after only a partial dip: still OCS");
}

// --- OCS, dips fully back, then crosses: started with the right time ---
{
  const { seq } = setup();
  const b = boatAt(MID_X, LINE_Y + 1);
  runTo(seq, [b], 1);
  sail(seq, [b], b, MID_X, LINE_Y - 2.5, 2); // whole hull just below
  assert(seq.statusOf(b) === "notStarted" && seq.stateFor(b).wasOcs, "whole hull back below the line: OCS cleared, not started");
  assert(!seq.xFlag, "X flag down once every OCS boat has returned");
  const t0 = seq.clock;
  sail(seq, [b], b, MID_X, LINE_Y + 2, 2);
  const s = seq.stateFor(b);
  // Bow from LINE_Y − 0.5 to the line: 0.5 m at 2 m/s.
  assert(s.started && Math.abs(s.startTime - (t0 + 0.25)) < 0.05, `started after returning, start time ${s.startTime.toFixed(2)} s (expected ${(t0 + 0.25).toFixed(2)})`);
  const gs = startGuides(seq, b, 0);
  assert(gs.some((g) => g.type === "label" && /^STARTED \+/.test(g.lines[0].text)), "green STARTED label on the boat");
  // Returning round the end (via the extension) also counts.
  const { seq: s2 } = setup();
  const e = boatAt(L.pin.x + 1, LINE_Y + 1);
  runTo(s2, [e], 1);
  sail(s2, [e], e, L.pin.x - 3, LINE_Y + 1);
  sail(s2, [e], e, L.pin.x - 3, LINE_Y - 3);
  assert(s2.statusOf(e) === "notStarted", "returning below the line's extension clears OCS");
}

// --- X flag time limit ---
{
  const { seq } = setup();
  const b = boatAt(MID_X, LINE_Y + 1);
  runTo(seq, [b], COMPRESSED_START_TIMINGS.xFlag + 1);
  assert(!seq.xFlag && seq.statusOf(b) === "ocs", "X flag down after timings.xFlag; the boat is still OCS");
}

// --- Course side to pre-start side does not count; crossing outside the ends does not count ---
{
  const { seq } = setup();
  const b = boatAt(L.committee.x + START_OCS_EXT_M + 3, LINE_Y + 4); // over, but beyond the OCS span
  runTo(seq, [b], 1);
  assert(seq.statusOf(b) === "notStarted", "far over outside the span: not OCS");
  sail(seq, [b], b, MID_X, LINE_Y + 4);
  sail(seq, [b], b, MID_X, LINE_Y - 4);
  assert(!seq.hasStarted(b), "crossing from the course side to the pre-start side is not a start");
  sail(seq, [b], b, L.committee.x + 3, LINE_Y - 4);
  sail(seq, [b], b, L.committee.x + 3, LINE_Y + 4);
  assert(!seq.hasStarted(b), "crossing the extension outside the committee end is not a start");
  sail(seq, [b], b, L.committee.x + 3, LINE_Y - 4);
  sail(seq, [b], b, L.committee.x - 1, LINE_Y - 4);
  sail(seq, [b], b, L.committee.x - 1, LINE_Y + 4);
  assert(seq.hasStarted(b), "then crossing between the ends starts");
}

// --- Before the gun crossings do not start ---
{
  const { seq } = setup();
  const b = boatAt(MID_X, LINE_Y - 4);
  runTo(seq, [b], -5);
  sail(seq, [b], b, MID_X, LINE_Y + 3, 2); // crosses at about −2.5 s
  assert(!seq.hasStarted(b) && seq.clock < 0, "crossing before the gun is not a start");
  runTo(seq, [b], 1);
  assert(seq.statusOf(b) === "ocs", "and leaves her OCS at the gun");
}

// --- Course progress waits for the start ---
{
  const { line, seq } = setup();
  const b = boatAt(MID_X, LINE_Y - 4);
  const wm = { anchor: L.windward };
  const gate = new Gate({ anchor: L.gate[0] }, { anchor: L.gate[1] });
  const course = new Course([wm, gate], { start: line.mid, startSequence: seq });
  const p = course.progressFor(b);
  const step = () => { seq.update([b]); p.update(b.x, b.y); };
  assert(p.waitingForStart && courseText(p) === "Course: start first, then mark 1", `before the start: "${courseText(p)}"`);
  const labels = courseGuides(course, p, 0).filter((g) => g.type === "label").map((g) => g.lines[0].text);
  assert(!labels.some((t) => t.startsWith("NEXT")), `no mark highlighted before the start (${labels.join(", ")})`);
  // Over the line at the gun (OCS) and round the windward mark anyway:
  // nothing counts.
  place(b, L.windward.x + 5, LINE_Y + 1);
  runTo(seq, [b], 1);
  assert(seq.statusOf(b) === "ocs", "OCS at the gun");
  const path = [];
  for (let y = LINE_Y + 1; y <= L.windward.y - 5; y += 0.5) path.push([L.windward.x + 5, y]);
  for (let a = -90; a <= 200; a += 2) path.push([L.windward.x + 5 * Math.cos(a * Math.PI / 180), L.windward.y + 5 * Math.sin(a * Math.PI / 180)]);
  for (const [x, y] of path) { place(b, x, y); seq.step(DT); step(); }
  assert(seq.clock > 0 && !seq.hasStarted(b) && p.target === 0, "rounding mark 1 before a valid start does not count");
  // Come back down (outside the ends), start, and round.
  const back = [[L.committee.x + 8, 0], [L.committee.x + 8, LINE_Y - 4], [MID_X, LINE_Y - 4], [MID_X, LINE_Y + 2]];
  for (const [x, y] of back) {
    const x0 = b.x, y0 = b.y;
    const n = Math.ceil(Math.hypot(x - x0, y - y0) / 0.25);
    for (let i = 1; i <= n; i++) { place(b, x0 + (x - x0) * i / n, y0 + (y - y0) * i / n); seq.step(DT); step(); }
  }
  assert(seq.hasStarted(b) && !p.waitingForStart && p.displayIndex === 0, "after the start mark 1 is the target");
  assert(courseText(p) === "Course: next mark 1 (port) · lap 1", `after the start: "${courseText(p)}"`);
  const round = path.filter(([x, y]) => y > L.windward.y - 15);
  for (const [x, y] of round) { place(b, x, y); seq.step(DT); step(); }
  assert(p.target === 1, "mark 1 rounded after the start counts");
  // Courses without a start sequence start at once (scenarios 12, 13).
  const free = new Course([wm, gate], { start: line.mid });
  assert(!free.progressFor(boatAt(0, 0)).waitingForStart, "courses without a start sequence are not held");
}

// --- Real world: scenario 14 layout, boat and marks in planck ---
{
  const { Map } = await import("../src/map.js");
  const { Boat } = await import("../src/boat.js");
  const { Mark, markMassForBoat } = await import("../src/mark.js");
  const map = new Map(75, 75, 90, 15, null);
  map.physics_model_init();
  map.setDevMode(true);
  const boat = new Boat(map, L.boat.x, L.boat.y, L.boatHeading);
  const mass = markMassForBoat(boat.physics_model);
  const rc = new Mark(map, L.committee.x, L.committee.y, { mass });
  const pin = new Mark(map, L.pin.x, L.pin.y, { mass });
  const wm = new Mark(map, L.windward.x, L.windward.y, { mass });
  const ga = new Mark(map, L.gate[0].x, L.gate[0].y, { mass });
  const gb = new Mark(map, L.gate[1].x, L.gate[1].y, { mass });
  const real = [rc, pin, wm, ga, gb];
  const line = new StartLine(rc, pin, L.windward);
  const seq = new StartSequence(line, { timings: L.timings, lead: L.lead });
  const course = new Course([wm, new Gate(ga, gb)], { start: line.mid, startSequence: seq });
  const progress = course.progressFor(boat);
  let ok = true;
  const step = () => {
    boat.physics_model_step();
    for (const m of real) m.physics_model_step();
    map.world.step(DT);
    seq.step(DT);
    seq.update([boat]);
    progress.update(boat.x, boat.y);
    ok = ok && Number.isFinite(boat.x) && Number.isFinite(boat.y);
  };
  step();
  boat.autopilot_heading_target = (Math.sign(boat.autopilot_heading_target) || 1) * 90;
  boat.autopilot_enabled = true;
  for (let i = 0; i < 300; i++) step();
  assert(ok && boat.y < LINE_Y - 4 && boat.x > L.boat.x + 10, `10 s on the port beam reach autopilot below the line: boat at (${boat.x.toFixed(1)}, ${boat.y.toFixed(1)})`);
  assert(seq.statusOf(boat) === "prestart" && progress.waitingForStart, "pre-start, course waiting");
  // Put her just over the line before the gun; she is OCS at the gun.
  while (seq.clock < -0.3) step();
  boat.physics_model.setTransform({ x: MID_X, y: LINE_Y + 2 }, Math.PI);
  boat.physics_model.setLinearVelocity({ x: 0, y: 0 });
  boat.autopilot_enabled = false;
  while (seq.clock < 0.5) step();
  assert(ok && seq.statusOf(boat) === "ocs" && seq.xFlag, "physics boat over the line at the gun is OCS");
  // Back below, then sail up across (bow north, heading π).
  boat.physics_model.setTransform({ x: MID_X, y: LINE_Y - 6 }, Math.PI);
  boat.physics_model.setLinearVelocity({ x: 0, y: 0 });
  step();
  assert(seq.statusOf(boat) === "notStarted", "physics boat back below: OCS cleared");
  for (let i = 0; i < 300 && !seq.hasStarted(boat); i++) {
    boat.physics_model.setTransform({ x: MID_X, y: boat.y + 0.1 }, Math.PI);
    step();
  }
  assert(ok && seq.hasStarted(boat) && !progress.waitingForStart, `physics boat started at +${seq.stateFor(boat).startTime.toFixed(1)} s, course active`);
  const gs = [...startGuides(seq, boat, 1234), ...courseGuides(course, progress, 1234)];
  assert(gs.length > 30 && gs.every((x) => x.type === "label" ? Number.isFinite(x.x) && Number.isFinite(x.y) : [x.x1, x.y1, x.x2, x.y2].every(Number.isFinite)), `overlay draws (${gs.length} guides), all finite`);
  for (const p of [L.committee, L.pin, L.windward, ...L.gate]) {
    for (const q of [{ x: 0, y: 14.5, r: 0.5 }, { x: 0, y: 20, r: 5 }]) {
      assert(Math.hypot(p.x - q.x, p.y - q.y) > q.r + 6, `mark (${p.x}, ${p.y}) clear of the map.js circle at (${q.x}, ${q.y})`);
    }
    assert(Math.abs(p.x) <= 35.5 - 5.5 && Math.abs(p.y) <= 35.5 - 8.5, `mark (${p.x}, ${p.y}) inside the walls with room`);
  }
  assert(L.gate[0].y - LINE_Y >= 12, "gate is well above the start line");
}

if (!process.exitCode) console.log("start-check: all passed");
