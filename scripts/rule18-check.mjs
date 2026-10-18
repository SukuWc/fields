// Headless checks for Rule 18.2 mark-room (src/rules.js evaluateRule18,
// course.js markRoomTarget, mark-touch.js exoneration) and scenario 15.
// Run: node --import ./test/register.mjs scripts/rule18-check.mjs

const info = { innerHTML: "" };
globalThis.addEventListener = () => {};
globalThis.window = globalThis;
globalThis.location = { href: "http://localhost/" };
globalThis.document = {
  getElementById() { return info; },
  getElementsByTagName() { return []; },
  currentScript: { src: "http://localhost/rule18-check.mjs" },
  createElement() { return { getContext() { return null; } }; },
};

const R = await import("../src/rules.js");
const { Map } = await import("../src/map.js");
const { Boat } = await import("../src/boat.js");
const { Mark, markMassForBoat } = await import("../src/mark.js");
const { Course, Gate, markRoomTarget, MARK_ROOM_LAYOUT } = await import("../src/course.js");
const { recordMarkTouches, resetMarkTouches, getMarkTouches } = await import("../src/mark-touch.js");

function assert(cond, message) {
  if (!cond) {
    console.error("FAIL", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log("ok  ", message);
}

const DT = 1 / 30;
const D = Math.PI / 180;
const map = new Map(75, 75, 90, 4.5, null);
map.physics_model_init();
map.setDevMode(true);
const getWind = (x, y) => map.get_wind(x, y);

// Two real boats posed by hand (no physics stepping).
function pose(boat, x, y, h) {
  boat.physics_model.setTransform({ x, y }, h);
  boat.x = x;
  boat.y = y;
  boat.hull_angle = h;
  boat.tacking = false;
}
const A = new Boat(map, -30, 30, 0);
const B = new Boat(map, -30, 25, 0);
let t = 0;
function fresh() {
  R.resetRule15Memory();
  R.resetContacts();
  resetMarkTouches();
}
function evalPair(markFor) {
  t += DT;
  R.beginRule15Step(t);
  const res = R.evaluateAllPairs([A, B], getWind, t, { markFor });
  return res[0] || null;
}
// Walk both boats straight from (from) by (dx, dy) per step, n steps.
function run(n, a, b, markFor, onStep) {
  let r = null;
  for (let i = 0; i < n; i++) {
    pose(A, a.x + a.dx * i, a.y + a.dy * i, a.h);
    pose(B, b.x + b.dx * i, b.y + b.dy * i, b.h);
    r = evalPair(markFor);
    if (onStep) onStep(r, i);
  }
  return r;
}

const M = { x: 0, y: 0 };
const mark = { anchor: M };
// Leave it to starboard (−1): running south, the mark is on their right (west).
const markFor = () => ({ key: mark, at: M, done: false, side: -1 });
const RUN = -10 * D; // heading 10° west of south: starboard run (TWA ≈ −170)

// --- Overlapped at zone entry: outside owes inside ---
{
  fresh();
  // A inside (west, nearer the mark), B outside, abeam 2.5 m, 25 m up.
  const r = run(60, { x: 2, y: 25, dx: -0.05, dy: -0.3, h: RUN }, { x: 4.5, y: 25.4, dx: -0.05, dy: -0.3, h: RUN }, markFor);
  assert(r && r.markRoom && r.markRoom.rightOfWay === A && r.markRoom.giveWay === B && r.markRoom.basis === "overlapped", "overlapped at the zone: outside boat owes the inside boat mark-room");
  assert(R.isMarkRoomEntitled(A) && !R.isMarkRoomEntitled(B), "isMarkRoomEntitled marks the inside boat");
  const g = R.markRoomGuides([r], [A, B]).map((x) => x.lines[0].text);
  assert(g.includes("GETS MARK-ROOM") && g.includes("GIVES MARK-ROOM → boat 0"), `boat labels: ${g.join(", ")}`);
  // Freeze: the outside boat pulls clear ahead and crosses inside; still owes.
  const r2 = run(20, { x: A.x, y: A.y, dx: 0, dy: -0.1, h: RUN }, { x: B.x, y: B.y, dx: -0.15, dy: -0.4, h: RUN }, markFor);
  const geo = R.sameTackGeometry(A, B);
  assert(geo && !geo.overlapped && geo.clearAhead === B, "later the outside boat is clear ahead");
  assert(r2 && r2.markRoom && r2.markRoom.rightOfWay === A && r2.markRoom.giveWay === B, "relationship frozen at zone entry: she still owes mark-room");
}

// --- Clear ahead at zone entry: astern owes ahead; frozen when overlap comes later ---
{
  fresh();
  // A ahead (enters the zone first), B 6 m astern.
  const r = run(30, { x: 2, y: 20, dx: 0, dy: -0.3, h: RUN }, { x: 2, y: 26, dx: 0, dy: -0.3, h: RUN }, markFor);
  assert(r && r.markRoom && r.markRoom.rightOfWay === A && r.markRoom.giveWay === B && r.markRoom.basis === "clear ahead", "clear ahead at the zone: clear-astern boat owes mark-room");
  // B catches up and gets an inside overlap (west of A, nearer the mark).
  const r2 = run(25, { x: A.x, y: A.y, dx: 0, dy: -0.1, h: RUN }, { x: B.x, y: B.y, dx: -0.1, dy: -0.32, h: RUN }, markFor);
  const geo = R.sameTackGeometry(A, B);
  assert(geo && geo.overlapped, "the astern boat later overlaps inside");
  assert(r2 && r2.markRoom && r2.markRoom.rightOfWay === A && r2.markRoom.giveWay === B, "an inside overlap gained later does not change it (18.2(b))");
}

// --- 18.1(a): opposite tacks on a beat → not applicable ---
{
  fresh();
  const stbd = 5 * Math.PI / 4;
  const port = 3 * Math.PI / 4;
  const r = run(5, { x: -3, y: -6, dx: 0, dy: 0, h: stbd }, { x: 3, y: -6, dx: 0, dy: 0, h: port }, markFor);
  assert(r && !r.markRoom && r.final && r.final.id === "10", "opposite tacks beating to the mark: Rule 18 does not apply (Rule 10 only)");
  fresh();
  const r2 = run(5, { x: -3, y: -6, dx: 0, dy: 0, h: stbd }, { x: 0, y: -8, dx: 0, dy: 0, h: stbd }, markFor);
  assert(r2 && r2.markRoom, "same tack beating to the mark: Rule 18 applies");
  fresh();
  const r3 = run(5, { x: -3, y: 6, dx: 0, dy: 0, h: -10 * D }, { x: 1.5, y: 6, dx: 0, dy: 0, h: 10 * D }, markFor);
  assert(r3 && r3.markRoom, "opposite tacks on a run: Rule 18 applies");
}

// --- Entitlement ends: rounded, left the zone, passed head to wind ---
{
  const state = { done: false };
  const mf = () => ({ key: mark, at: M, done: state.done, side: -1 });
  fresh();
  let r = run(40, { x: 2, y: 20, dx: 0, dy: -0.3, h: RUN }, { x: 2, y: 26, dx: 0, dy: -0.3, h: RUN }, mf);
  assert(r.markRoom, "entitled");
  state.done = true;
  r = run(2, { x: A.x, y: A.y, dx: 0, dy: -0.1, h: RUN }, { x: B.x, y: B.y, dx: 0, dy: -0.1, h: RUN }, mf);
  assert(!r.markRoom, "ends once she has rounded the mark");
  state.done = false;
  r = run(3, { x: A.x, y: A.y, dx: 0, dy: -0.1, h: RUN }, { x: B.x, y: B.y, dx: 0, dy: -0.1, h: RUN }, mf);
  assert(!r.markRoom, "and stays ended while still in the zone");

  fresh();
  r = run(40, { x: 2, y: 20, dx: 0, dy: -0.3, h: RUN }, { x: 2, y: 26, dx: 0, dy: -0.3, h: RUN }, mf);
  assert(r.markRoom && r.markRoom.rightOfWay === A, "entitled again (fresh pair)");
  // A sails out of the zone sideways, B stays in.
  r = run(40, { x: A.x, y: A.y, dx: 0.45, dy: 0, h: 80 * D }, { x: B.x, y: B.y, dx: 0, dy: 0, h: RUN }, mf);
  assert(Math.hypot(A.x, A.y) > R.RULE18_ZONE_M + 2 && !r?.markRoom, "ends when the entitled boat leaves the zone");

  fresh();
  r = run(40, { x: 2, y: 20, dx: 0, dy: -0.3, h: RUN }, { x: 2, y: 26, dx: 0, dy: -0.3, h: RUN }, mf);
  assert(r.markRoom, "entitled again");
  t += DT;
  A.tacking = true;
  R.beginRule15Step(t);
  r = R.evaluateAllPairs([A, B], getWind, t, { markFor: mf })[0];
  assert(!r.markRoom, "ends when the entitled boat passes head to wind (tacking)");

  // Both out of the zone resets the pair: the next approach freezes afresh.
  fresh();
  r = run(40, { x: 2, y: 20, dx: 0, dy: -0.3, h: RUN }, { x: 2, y: 26, dx: 0, dy: -0.3, h: RUN }, mf);
  state.done = true;
  run(2, { x: A.x, y: A.y, dx: 0, dy: 0, h: RUN }, { x: B.x, y: B.y, dx: 0, dy: 0, h: RUN }, mf);
  state.done = false;
  run(2, { x: 2, y: 30, dx: 0, dy: 0, h: RUN }, { x: 2, y: 36, dx: 0, dy: 0, h: RUN }, mf);
  r = run(40, { x: 2, y: 26, dx: 0, dy: -0.3, h: RUN }, { x: 2, y: 20, dx: 0, dy: -0.3, h: RUN }, mf);
  assert(r.markRoom && r.markRoom.rightOfWay === B, "after both leave the zone, the next approach freezes again (now B ahead)");
}

// --- Gate: different gate marks → not applicable; same gate mark → applies ---
{
  const L = MARK_ROOM_LAYOUT;
  const ga = { anchor: L.gate[0] };
  const gb = { anchor: L.gate[1] };
  const wm = { anchor: L.windward };
  const course = new Course([new Gate(ga, gb), wm], { start: { x: 22, y: 0 } });
  const mf = (boat) => markRoomTarget(course, boat);
  fresh();
  pose(A, 18, -16, 0);
  pose(B, 26, -16, 0);
  assert(mf(A).key === ga && mf(B).key === gb, "markRoomTarget: each boat's gate mark is the one her course line meets the gate nearer");
  let r = evalPair(mf);
  assert(r && !r.markRoom, "boats heading for different gate marks: Rule 18 does not apply");
  fresh();
  pose(B, 20.5, -16.5, 0);
  r = evalPair(mf);
  assert(mf(B).key === ga && r && r.markRoom && r.markRoom.rightOfWay === A, "both heading for the west gate mark: applies, inside boat entitled");
  // Gate passed → done → ends.
  for (const [boat, y] of [[A, -16], [A, -26]]) course.progressFor(boat).update(boat.x, y);
  pose(A, 18, -26.5, 0);
  r = evalPair(mf);
  assert(mf(A).done && !(r && r.markRoom), "entitlement ends once she has passed the gate");
}

// --- Label stack: decisive 18.2 strikes the Section A rule ---
{
  fresh();
  // Starboard run; A inside and windward (north of B) → Rule 11 makes A keep clear.
  const r = run(50, { x: 2, y: 24, dx: -0.05, dy: -0.3, h: RUN }, { x: 4.4, y: 23.3, dx: -0.05, dy: -0.3, h: RUN }, markFor);
  assert(r.sectionA.final && r.sectionA.final.id === "11" && r.sectionA.final.giveWay === A, "Section A: Rule 11, the inside windward boat keeps clear");
  assert(r.final && r.final.id === "18" && r.faultBoat === B && r.markRoom.decisive, "Rule 18.2 is decisive: fault on contact goes to the outside boat");
  const label = r.guides.find((g) => g.type === "label");
  const lines = label.lines.map((l) => l.text + ":" + l.role);
  assert(lines.includes("Rule 18.2 mark-room:final") && lines.includes("Rule 11:inhibited"), `label stack: ${lines.join(" | ")}`);
  // Section A already favours the entitled boat: 18 shown, not decisive.
  fresh();
  const r2 = run(50, { x: 2, y: 23.3, dx: -0.05, dy: -0.3, h: RUN }, { x: 4.4, y: 24, dx: -0.05, dy: -0.3, h: RUN }, markFor);
  assert(r2.markRoom && !r2.markRoom.decisive && r2.final.id === "11" && r2.faultBoat === B, "inside leeward boat: Rule 11 stays final, 18.2 shown as supporting");
}

// --- Rule 31 exoneration while entitled ---
{
  fresh();
  const r = run(60, { x: 2, y: 25, dx: -0.05, dy: -0.3, h: RUN }, { x: 4.5, y: 25.4, dx: -0.05, dy: -0.3, h: RUN }, markFor);
  assert(r.markRoom && r.markRoom.rightOfWay === A, "A entitled");
  const buoyA = { x: A.x - 1.2, y: A.y, radius: 0.5, anchor: { x: A.x - 1.2, y: A.y }, markName: "mark 1" };
  const buoyB = { x: B.x + 1.2, y: B.y, radius: 0.5, anchor: { x: B.x + 1.2, y: B.y }, markName: "mark 1" };
  recordMarkTouches([A], [buoyA], { simTime: t });
  recordMarkTouches([B], [buoyB], { simTime: t });
  const ta = getMarkTouches().find((x) => x.boat === A);
  assert(ta && ta.exonerated && R.pendingPenaltyCount(A) === 0, `entitled boat touching the mark is exonerated: "${ta && ta.reason}"`);
  assert(R.pendingPenaltyCount(B) === 1, "the boat owing mark-room still takes a rule 31 penalty");
}

// --- Scenario 15 in planck: squeeze → contact charged to the outside boat ---
{
  fresh();
  const L = MARK_ROOM_LAYOUT;
  const m2 = new Map(75, 75, 90, 4.5, null);
  m2.physics_model_init();
  m2.setDevMode(true);
  const boats = [L.inside, L.outside].map((p) => {
    const b = new Boat(m2, p.x, p.y, p.heading);
    b.physics_model.setLinearVelocity({ x: Math.sin(p.heading) * 2, y: -Math.cos(p.heading) * 2 });
    return b;
  });
  const mass = markMassForBoat(boats[0].physics_model);
  const wm = new Mark(m2, L.windward.x, L.windward.y, { mass });
  const ga = new Mark(m2, L.gate[0].x, L.gate[0].y, { mass });
  const gb = new Mark(m2, L.gate[1].x, L.gate[1].y, { mass });
  const marks = [wm, ga, gb];
  const course = new Course([new Gate(ga, gb), wm], { start: L.start });
  const mf = (boat) => markRoomTarget(course, boat);
  let sim = 0;
  let sawLabel = false;
  let frozenAt = null;
  let ok = true;
  for (let i = 0; i < 20 * 30; i++) {
    for (const b of boats) b.physics_model_step();
    for (const m of marks) m.physics_model_step();
    m2.world.step(DT);
    sim += DT;
    if (i === 0) for (const b of boats) b.autopilot_enabled = true;
    for (const b of boats) course.progressFor(b).update(b.x, b.y);
    R.beginRule15Step(sim);
    const res = R.evaluateAllPairs(boats, (x, y) => m2.get_wind(x, y), sim, { markFor: mf });
    R.recordContacts(res, sim, boats);
    recordMarkTouches(boats, marks, { simTime: sim });
    const r = res[0];
    if (r && r.markRoom && frozenAt === null) frozenAt = { sim, entitled: r.markRoom.rightOfWay, basis: r.markRoom.basis };
    if (r && R.markRoomGuides(res, boats).length === 2) sawLabel = true;
    ok = ok && boats.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y));
  }
  assert(ok, "scenario 15 runs 20 s with finite boats");
  assert(frozenAt && frozenAt.entitled === boats[0] && frozenAt.basis === "overlapped", `zone reached overlapped at ${frozenAt && frozenAt.sim.toFixed(1)} s: inside boat 0 entitled`);
  assert(sawLabel, "GETS / GIVES MARK-ROOM labels shown");
  const inc = R.getIncidents()[0];
  assert(inc && inc.finalId === "18" && inc.faultBoat === boats[1] && inc.exonerated && inc.exonerated[0] === boats[0], `contact at ${inc && inc.time.toFixed(1)} s: fault on the outside boat under Rule 18.2, inside boat exonerated`);
  const d = Math.hypot(inc.x - L.gate[0].x, inc.y - L.gate[0].y);
  assert(d < R.RULE18_ZONE_M, `contact inside the zone (${d.toFixed(1)} m from the gate mark)`);
  assert(R.pendingPenaltyCount(boats[1]) >= 1 && R.pendingPenaltyCount(boats[0]) === 0, "penalty on boat 1 only");
  assert(R.faultBadgeText(boats[1]).startsWith("FAULT") && R.faultBadgeText(boats[1]).includes("Rule 18.2 · mark-room"), `FAULT badge: "${R.faultBadgeText(boats[1])}"`);
}

if (!process.exitCode) console.log("rule18-check: all passed");
