// Headless checks for the finish procedure (src/finish.js, course.js laps /
// finish / seed, rules.js finishBoatPenalties) and scenario 16.
// Run: node --import ./test/register.mjs scripts/finish-check.mjs

const info = { innerHTML: "" };
globalThis.addEventListener = () => {};
globalThis.window = globalThis;
globalThis.location = { href: "http://localhost/" };
globalThis.document = {
  getElementById() { return info; },
  getElementsByTagName() { return []; },
  currentScript: { src: "http://localhost/finish-check.mjs" },
  createElement() { return { getContext() { return null; } }; },
};

const R = await import("../src/rules.js");
const { Map } = await import("../src/map.js");
const { Boat } = await import("../src/boat.js");
const { Mark, markMassForBoat } = await import("../src/mark.js");
const { Course, Gate } = await import("../src/course.js");
const { StartLine, StartSequence, START_COURSE_LAYOUT } = await import("../src/start.js");
const { recordMarkTouches, resetMarkTouches } = await import("../src/mark-touch.js");
const F = await import("../src/finish.js");

function assert(cond, message) {
  if (!cond) {
    console.error("FAIL", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log("ok  ", message);
}

const DT = 1 / 30;
const map = new Map(75, 75, 90, 4.5, null);
map.physics_model_init();
map.setDevMode(true);

function pose(boat, x, y, h) {
  boat.physics_model.setTransform({ x, y }, h);
  boat.x = x;
  boat.y = y;
  boat.hull_angle = h;
}
const NORTH = Math.PI; // forward = (sin h, −cos h) = (0, 1)
const SOUTH = 0;

// Course: windward (0, 20), gate (−6, −10)/(6, −10), one lap; finish line
// y = 0 from x = −10 to 10, crossed northward (from the gate).
const windward = { x: 0, y: 20 };
const gate = new Gate({ x: -6, y: -10 }, { x: 6, y: -10 });
function makeCourse(opts = {}) {
  const finish = new F.FinishLine({ x: 10, y: 0 }, { x: -10, y: 0 }, gate.anchor);
  return new Course([windward, gate], { start: { x: 0, y: -20 }, laps: 1, finish, ...opts });
}
const boats = [new Boat(map, -30, 30, 0), new Boat(map, -25, 30, 0)];
function fresh() { R.resetContacts(); resetMarkTouches(); }
// Sail boat i north through y = 0 at x, from y0 to y1, with the clock.
function sail(res, course, i, x, y0, y1, h, clock0) {
  let clock = clock0;
  const n = Math.round(Math.abs(y1 - y0) / 0.1);
  for (let s = 0; s <= n; s++) {
    pose(boats[i], x, y0 + (y1 - y0) * s / n, h);
    course.progressFor(boats[i]).update(boats[i].x, boats[i].y);
    res.update(boats, clock);
    clock += 0.1;
  }
  return clock;
}

// --- Crossing before the course is complete does nothing ---
{
  fresh();
  const course = makeCourse();
  const res = new F.RaceResults(course);
  sail(res, course, 0, 0, -6, 6, NORTH, 10);
  assert(!res.isFinished(boats[0]) && res.entries.length === 0, "crossing the finish line before completing the course does not finish");
  assert(!course.progressFor(boats[0]).courseComplete, "course still incomplete");
}

// --- Complete then cross: finishes, time interpolated at the bow crossing ---
{
  fresh();
  const course = makeCourse();
  const res = new F.RaceResults(course);
  const p = course.progressFor(boats[0]).seed(course.totalRoundings);
  assert(p.courseComplete && p.finishNext, "seeded: course complete, finish next");
  pose(boats[0], 0, -6, NORTH);
  const bow = F.FinishLine && (await import("../src/start.js")).boatStartGeometry(boats[0]).bow;
  const bowAhead = bow.y - boats[0].y;
  sail(res, course, 0, 0, -6, 6, NORTH, 100);
  const e = res.entryFor(boats[0]);
  // centre at y = −bowAhead when the bow reaches 0; clock = 100 + (−bowAhead + 6) / 0.1 · 0.1.
  const expect = 100 + (6 - bowAhead);
  assert(e && Math.abs(e.finishTime - expect) < 0.11 && e.position === 1, `finishes at ${e && e.finishTime.toFixed(2)} s (bow crossing, expect ${expect.toFixed(2)})`);
  assert(/^1:4\d\.\d$/.test(F.formatRaceTime(e.elapsed)), `elapsed shown m:ss.s: ${F.formatRaceTime(e.elapsed)}`);
  sail(res, course, 0, 0, 6, -6, SOUTH, 120);
  sail(res, course, 0, 0, -6, 6, NORTH, 140);
  assert(res.entries.length === 1, "finishes once");
}

// --- Wrong direction and outside the ends ---
{
  fresh();
  const course = makeCourse();
  const res = new F.RaceResults(course);
  course.progressFor(boats[0]).seed(course.totalRoundings);
  sail(res, course, 0, 0, 6, -6, SOUTH, 0);
  assert(!res.isFinished(boats[0]), "crossing in the wrong direction does not finish");
  sail(res, course, 0, 14, -6, 6, NORTH, 20);
  assert(!res.isFinished(boats[0]), "crossing outside the ends does not finish");
  sail(res, course, 0, 3, -6, 6, NORTH, 40);
  assert(res.isFinished(boats[0]), "then a proper crossing finishes");
}

// --- Order of two boats; unserved penalty → time penalty, re-ordered ---
{
  fresh();
  const course = makeCourse();
  const res = new F.RaceResults(course);
  for (const b of boats) course.progressFor(b).seed(course.totalRoundings);
  R.chargePendingPenalty(boats[1], { time: 0, rule: "31", kind: "mark", reason: "Rule 31: touched gate 2", label: "Rule 31 · touched gate 2" });
  sail(res, course, 1, -4, -3, 3, NORTH, 50); // boat 1 first, raw
  sail(res, course, 0, 4, -3, 3, NORTH, 55);  // boat 0 ~5 s later
  const [p1, p2] = res.entries;
  assert(p1.boat === boats[0] && p2.boat === boats[1], "corrected time order: clean boat 0 P1, penalised boat 1 P2");
  assert(p2.order === 1 && p2.penaltyS === F.FINISH_UNSERVED_PENALTY_S && Math.abs(p2.corrected - p2.finishTime - F.FINISH_UNSERVED_PENALTY_S) < 1e-9, `boat 1 crossed first but gets +${F.FINISH_UNSERVED_PENALTY_S} s`);
  assert(F.penaltyNote(p2) === "+" + F.FINISH_UNSERVED_PENALTY_S + " s (Rule 31)", `note: ${F.penaltyNote(p2)}`);
  assert(R.pendingPenaltyCount(boats[1]) === 0 && R.hasFinished(boats[1]), "pending penalty no longer pending after finishing");
  const html = F.resultsHtml(res);
  assert(html.includes("P1 · boat 0") && html.includes("P2 · boat 1") && html.includes("(Rule 31)"), "results list html");
  const data = res.toData();
  assert(data.length === 2 && data[0].boat === 0 && data[1].unserved[0] === "Rule 31", "results exported as data");
}

// --- Unserved order with no penalty swap: two clean boats ---
{
  fresh();
  const course = makeCourse();
  const res = new F.RaceResults(course);
  for (const b of boats) course.progressFor(b).seed(course.totalRoundings);
  sail(res, course, 1, -4, -3, 3, NORTH, 50);
  sail(res, course, 0, 4, -3, 3, NORTH, 55);
  assert(res.entries[0].boat === boats[1] && res.entries[1].boat === boats[0], "two clean boats: order of crossing");
}

// --- dsq mode ---
{
  fresh();
  const course = makeCourse();
  const res = new F.RaceResults(course, { mode: "dsq" });
  for (const b of boats) course.progressFor(b).seed(course.totalRoundings);
  R.chargePendingPenalty(boats[1], { time: 0, finalId: "10", finalRule: "Rule 10" });
  sail(res, course, 1, -4, -3, 3, NORTH, 50);
  sail(res, course, 0, 4, -3, 3, NORTH, 55);
  const d = res.entries[1];
  assert(d.boat === boats[1] && d.dsq && d.position === null && F.penaltyNote(d) === "DSQ (Rule 10)", "dsq mode: listed last as DSQ (Rule 10)");
  assert(F.resultsHtml(res).includes("DSQ · boat 1"), "results list shows DSQ");
}

// --- Penalty cleared before crossing → clean ---
{
  fresh();
  const course = makeCourse();
  const res = new F.RaceResults(course);
  course.progressFor(boats[0]).seed(course.totalRoundings);
  const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
  const sweep = (from, to) => { const n = Math.ceil(Math.abs(to - from) / 2); for (let i = 1; i <= n; i++) R.notePenaltyManeuver(boats[0], wrap(from + (to - from) * i / n), { dtS: DT, nowMs: 0 }); };
  R.notePenaltyManeuver(boats[0], 60, { dtS: DT, nowMs: 0 });
  R.chargePendingPenalty(boats[0], { time: 0, rule: "31", kind: "mark" });
  sweep(60, -60); sweep(-60, -300);
  assert(R.pendingPenaltyCount(boats[0]) === 0, "tack + gybe cleared the penalty");
  sail(res, course, 0, 0, -3, 3, NORTH, 0);
  const e = res.entryFor(boats[0]);
  assert(e && e.unserved.length === 0 && e.penaltyS === 0 && F.penaltyNote(e) === "", "penalty taken before finishing: clean finish");
}

// --- No new penalties after finishing ---
{
  fresh();
  const course = makeCourse();
  const res = new F.RaceResults(course);
  course.progressFor(boats[0]).seed(course.totalRoundings);
  sail(res, course, 0, 0, -3, 3, NORTH, 0);
  R.chargePendingPenalty(boats[0], { time: 9, rule: "31", kind: "mark" });
  assert(res.isFinished(boats[0]) && R.pendingPenaltyCount(boats[0]) === 0, "penalties after finishing do not accrue");
}

// --- Not started / OCS boat cannot finish ---
{
  fresh();
  const line = new StartLine({ x: 10, y: -20 }, { x: -10, y: -20 }, windward);
  const seq = new StartSequence(line, { clock: 30 });
  const course = makeCourse({ startSequence: seq });
  const res = new F.RaceResults(course);
  course.progressFor(boats[0]).seed(course.totalRoundings);
  assert(!course.progressFor(boats[0]).courseComplete, "not started: course not complete even if seeded");
  sail(res, course, 0, 0, -3, 3, NORTH, 30);
  assert(!res.isFinished(boats[0]), "not-started boat cannot finish");
  seq.seedStarted(boats[0], 0);
  sail(res, course, 0, 0, -3, 3, NORTH, 40);
  sail(res, course, 0, 0, 3, -3, SOUTH, 41);
  sail(res, course, 0, 0, -3, 3, NORTH, 42);
  assert(res.isFinished(boats[0]), "after a (seeded) valid start she can");
}

// --- Real rounding: complete the course by sailing it, then finish ---
{
  fresh();
  const course = makeCourse();
  const res = new F.RaceResults(course);
  const p = course.progressFor(boats[0]);
  // Up to windward, round it to port (anticlockwise: east side → north → west).
  const path = [];
  for (let y = -20; y <= 14; y += 0.5) path.push([2, y]);
  for (let a = -90; a <= 180; a += 5) path.push([6 * Math.cos(a * Math.PI / 180), 20 + 6 * Math.sin(a * Math.PI / 180)]);
  for (let y = 20; y >= -14; y -= 0.5) path.push([-2, y]);
  // Round the east gate mark outside the gate line, back up to y = −6.
  for (let x = -2; x <= 8; x += 0.5) path.push([x, -14]);
  for (let y = -14; y <= -6; y += 0.5) path.push([8, y]);
  let clock = 0;
  for (const [x, y] of path) { pose(boats[0], x, y, NORTH); p.update(x, y); res.update(boats, clock); clock += 0.1; }
  assert(p.courseComplete && !res.isFinished(boats[0]), "sailed windward + gate: complete, not yet finished (earlier crossings ignored)");
  sail(res, course, 0, 0, -6, 4, NORTH, clock);
  assert(res.isFinished(boats[0]), "then crossing finishes");
}

// --- Scenario 16 in planck ---
{
  fresh();
  const L = F.FINISH_COURSE_LAYOUT;
  const m2 = new Map(75, 75, 90, 4.5, null);
  m2.physics_model_init();
  m2.setDevMode(true);
  const bs = L.boats.map((q) => {
    const b = new Boat(m2, q.x, q.y, q.heading);
    b.physics_model.setLinearVelocity({ x: Math.sin(q.heading) * 1.5, y: -Math.cos(q.heading) * 1.5 });
    return b;
  });
  const mass = markMassForBoat(bs[0].physics_model);
  const mk = (q) => new Mark(m2, q.x, q.y, { mass });
  const rc = mk(L.committee), pin = mk(L.pin), wm = mk(L.windward), ga = mk(L.gate[0]), gb = mk(L.gate[1]), fb = mk(L.finishBoat), fp = mk(L.finishPin);
  const marks = [rc, pin, wm, ga, gb, fb, fp];
  const seq = new StartSequence(new StartLine(rc, pin, L.windward), { timings: START_COURSE_LAYOUT.timings, clock: L.clock });
  const g = new Gate(ga, gb);
  const course = new Course([wm, g], { start: seq.line.mid, startSequence: seq, laps: L.laps, finish: new F.FinishLine(fb, fp, g.anchor) });
  const res = new F.RaceResults(course);
  for (const b of bs) { seq.seedStarted(b, 0); course.progressFor(b).seed(course.totalRoundings); }
  R.chargePendingPenalty(bs[1], { time: 0, rule: "31", kind: "mark", reason: "Rule 31: touched gate 2", label: "Rule 31 · touched gate 2" });
  let ok = true;
  for (let i = 0; i < 40 * 30 && res.entries.length < 2; i++) {
    for (const b of bs) b.physics_model_step();
    for (const m of marks) m.physics_model_step();
    m2.world.step(DT);
    seq.step(DT);
    seq.update(bs);
    if (i === 0) for (const b of bs) b.autopilot_enabled = true;
    for (const b of bs) course.progressFor(b).update(b.x, b.y);
    res.update(bs, seq.clock);
    R.beginRule15Step(seq.clock);
    const rr = R.evaluateAllPairs(bs, (x, y) => m2.get_wind(x, y), seq.clock, {});
    R.recordContacts(rr, seq.clock, bs);
    recordMarkTouches(bs, marks, { simTime: seq.clock, racing: true });
    ok = ok && bs.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y));
  }
  assert(ok, "scenario 16 physics finite");
  const d = res.toData();
  console.log("     results:", JSON.stringify(d.map((e) => ({ P: e.position, boat: e.boat, t: +e.elapsed.toFixed(1), pen: e.penaltyS, order: e.order }))));
  assert(d.length === 2, "scenario 16: both boats finish");
  assert(d[0].boat === 0 && d[1].boat === 1 && d[1].order === 1 && d[1].penaltyS === F.FINISH_UNSERVED_PENALTY_S, "boat 1 crosses first, +penalty drops her to P2");
  assert(d[0].elapsed > L.clock, "times measured from the gun");
}
console.log("finish-check: all passed");
