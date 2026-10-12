// Headless checks for the live leaderboard (src/leaderboard.js) and the
// scenario 17 test race (src/race-bot.js).
// Run: node --import ./test/register.mjs scripts/leaderboard-check.mjs

const info = { innerHTML: "" };
globalThis.addEventListener = () => {};
globalThis.window = globalThis;
globalThis.location = { href: "http://localhost/" };
globalThis.document = {
  getElementById() { return info; },
  getElementsByTagName() { return []; },
  currentScript: { src: "http://localhost/leaderboard-check.mjs" },
  createElement() { return { getContext() { return null; } }; },
};

const R = await import("../src/rules.js");
const { Map } = await import("../src/map.js");
const { Course, Gate } = await import("../src/course.js");
const { StartLine, StartSequence } = await import("../src/start.js");
const { FinishLine, RaceResults } = await import("../src/finish.js");
const L = await import("../src/leaderboard.js");
const { setupTestRace } = await import("../src/race-bot.js");
const { recordMarkTouches, getMarkTouches, resetMarkTouches } = await import("../src/mark-touch.js");

function assert(cond, message) {
  if (!cond) {
    console.error("FAIL", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log("ok  ", message);
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const W = L.upwindVector(90); // wind from +Y
const C50 = Math.cos(50 * Math.PI / 180);

// --- Leg distance ---
{
  assert(near(W.x, 0) && near(W.y, 1), "wind from 90°: upwind is +Y");
  let r = L.legDistance({ x: 0, y: 0 }, { x: 0, y: 30 }, W);
  assert(near(r.dist, 30 / C50) && r.kind === "beat", `dead upwind: u / cos 50° = ${r.dist.toFixed(2)} m`);
  r = L.legDistance({ x: 0, y: 0 }, { x: 10, y: 30 }, W);
  assert(near(r.dist, 30 / C50), "inside the laylines: every tack combination is u / cos 50°");
  r = L.legDistance({ x: 0, y: 0 }, { x: 30, y: 10 }, W);
  assert(near(r.dist, Math.hypot(30, 10)) && r.kind === "reach", "outside the laylines (overstood): straight distance");
  const t = Math.tan(50 * Math.PI / 180);
  const a = L.legDistance({ x: 0, y: 0 }, { x: 10 * t - 1e-6, y: 10 }, W).dist;
  const b = L.legDistance({ x: 0, y: 0 }, { x: 10 * t + 1e-6, y: 10 }, W).dist;
  assert(near(a, b, 1e-4) && near(a, 10 / C50, 1e-4), "continuous at the layline");
  r = L.legDistance({ x: 0, y: 30 }, { x: 3, y: 0 }, W);
  assert(near(r.dist, Math.hypot(3, 30)) && r.kind === "run", "run: straight distance");
}

// --- Leg state: gate midpoint, finish midpoint, total distance to finish ---
const boat = (x, y) => ({ x, y, hull_angle: 0, hull: [{ x, y }], bow: { x, y } });
{
  const gate = new Gate({ x: -6, y: -10 }, { x: 6, y: -10 });
  const windward = { x: 0, y: 20 };
  const finish = new FinishLine({ x: 10, y: 0 }, { x: -10, y: 0 }, gate.anchor);
  const course = new Course([windward, gate], { start: { x: 0, y: -20 }, laps: 2, finish });
  const b = boat(0, -15);
  let s = L.legState(course, null, null, b, W);
  assert(s.status === "racing" && s.leg === 1 && s.legs === 5 && s.label === "Leg 1/5", `leg label ${s.label}`);
  const leg1 = 35 / C50;
  const down = 30; // windward → gate midpoint, straight run
  const up = 30 / C50; // gate midpoint → windward
  const fin = 10 / C50; // gate midpoint (0,−10) → finish midpoint (0,0) is a beat
  assert(near(s.legM, leg1) && near(s.toFinishM, leg1 + down + up + down + fin), `distance to finish = leg + full legs incl. lap 2 and finish (${s.toFinishM.toFixed(1)} m)`);
  course.progressFor(b).seed(1);
  b.y = -4; b.bow.y = -4; b.x = 3; b.bow.x = 3;
  s = L.legState(course, null, null, b, W);
  assert(near(s.legM, Math.hypot(3, 6)) && s.kind === "run" && s.leg === 2, "gate leg measured to the gate midpoint");
  course.progressFor(b).seed(course.totalRoundings);
  s = L.legState(course, null, null, b, W);
  assert(s.label === "Finish" && near(s.legM, Math.max(4 / C50, 5)) && near(s.toFinishM, s.legM), "finish leg measured to the finish line midpoint");
  // Looping course: no finish, legs Infinity, toFinish Infinity
  const loop = new Course([windward, gate], { start: { x: 0, y: -20 } });
  const s2 = L.legState(loop, null, null, boat(0, 0), W);
  assert(s2.legs === Infinity && s2.toFinishM === Infinity && s2.label === "Leg 1", "looping course: leg count open, no distance to finish");
}

// --- Ranking ---
{
  R.resetContacts();
  const windward = { x: 0, y: 20 };
  const line = new StartLine({ x: 10, y: -20 }, { x: -10, y: -20 }, windward);
  const seq = new StartSequence(line, { clock: 10 });
  const finish = new FinishLine({ x: 10, y: -10 }, { x: -10, y: -10 }, windward);
  const course = new Course([windward], { start: line.mid, startSequence: seq, laps: 1, finish });
  const results = new RaceResults(course);
  const bs = [boat(0, 10), boat(0, 5), boat(0, -25), boat(0, 0), boat(0, -18)];
  for (const i of [0, 1, 3]) seq.seedStarted(bs[i], 0);
  // OCS boat 4
  seq.stateFor(bs[4]).gunChecked = true; seq.stateFor(bs[4]).ocs = true;
  course.progressFor(bs[3]).seed(1); // rounded: on the run to the finish
  const lb = new L.Leaderboard(course, { startSequence: seq, results });
  lb.update(bs, 10, 90);
  lb.update(bs, 12, 90);
  let order = lb.rows().map((r) => r.boat).join("");
  assert(order === "30142", `legs first, then distance to finish, not started / OCS last by distance to the line (${order})`);
  const rows = lb.rows();
  assert(rows[3].label === "OCS" && rows[4].label === "Start", "not-started and OCS labels");
  assert(rows[0].gapM === 0 && rows[2].gapM > rows[1].gapM && rows[1].gapM > 0, "gap to leader in metres");
  const txt = L.leaderboardRowText(rows[1]);
  assert(/^2  boat 0  Leg 1\/2 ↑  \d+ m  \+\d+ m$/.test(txt), `row text: "${txt}"`);
  // Finish boat 1 (behind on the beat) → top.
  results.record(bs[1], 1, 30);
  lb.update(bs, 30, 90);
  order = lb.rows().map((r) => r.boat).join("");
  assert(order[0] === "1" && L.leaderboardRowText(lb.rows()[0]).includes("Fin 0:30.0"), `finished boat on top (${order}): ${L.leaderboardRowText(lb.rows()[0])}`);
  // Hysteresis: boat 0 moves just ahead of boat 3's distance? Use two boats on one leg.
  const c2 = new Course([windward], { start: line.mid, laps: 1, finish });
  const a = boat(0, 10), b = boat(0, 9);
  const lb2 = new L.Leaderboard(c2, {});
  lb2.update([a, b], 0, 90);
  assert(lb2.rows()[0].boat === 0, "a (nearer the mark) leads");
  b.y = 11; b.bow.y = 11;
  lb2.update([a, b], 0.1, 90);
  lb2.update([a, b], 0.6, 90);
  assert(lb2.rows()[0].boat === 0, "a 0.5 s blip does not swap");
  b.y = 9; b.bow.y = 9;
  lb2.update([a, b], 0.7, 90);
  b.y = 11; b.bow.y = 11;
  lb2.update([a, b], 1.0, 90);
  lb2.update([a, b], 1.9, 90);
  assert(lb2.rows()[0].boat === 0, "the timer restarts when the swap is no longer wanted");
  lb2.update([a, b], 2.1, 90);
  assert(lb2.rows()[0].boat === 1, "after ≥ 1 s ahead she takes the lead");
  // Any number of boats.
  const many = Array.from({ length: 12 }, (_, i) => boat(i - 6, i));
  const lb3 = new L.Leaderboard(c2, {});
  for (let t = 0; t < 3; t += 0.1) lb3.update(many, t, 90);
  const o3 = lb3.rows().map((r) => r.boat);
  assert(o3.length === 12 && o3[0] === 11 && o3[11] === 0 && L.leaderboardHtml(lb3).split("finish-row").length === 13, "12 boats ranked by distance, one row each");
}

// --- Scenario 17: full headless race ---
{
  R.resetContacts();
  resetMarkTouches();
  const DT = 1 / 30;
  const m = new Map(75, 75, 90, 15, null);
  m.physics_model_init();
  m.setDevMode(true);
  const { boats, marks, seq, course, results, leaderboard, bots } = setupTestRace(m);
  const orders = new Set();
  let endAt = null;
  let ok = true;
  let minD = Infinity;
  for (let i = 0; i < 150 * 30; i++) {
    for (const b of boats) b.physics_model_step();
    for (const mk of marks) mk.physics_model_step();
    m.world.step(DT);
    seq.step(DT);
    seq.update(boats);
    for (const b of boats) course.progressFor(b).update(b.x, b.y);
    results.update(boats, seq.clock);
    for (const bot of bots) bot.step(seq.clock, 90, boats, results.isFinished(bot.boat), results.entries.length);
    leaderboard.update(boats, seq.clock, 90);
    R.beginRule15Step(seq.clock);
    const rr = R.evaluateAllPairs(boats, (x, y) => m.get_wind(x, y), seq.clock, {});
    R.recordContacts(rr, seq.clock, boats);
    recordMarkTouches(boats, marks, { simTime: seq.clock, racing: seq.racing });
    ok = ok && boats.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y));
    for (let a = 0; a < 3; a++) for (let c = a + 1; c < 3; c++) minD = Math.min(minD, Math.hypot(boats[a].x - boats[c].x, boats[a].y - boats[c].y));
    orders.add(leaderboard.rows().map((r) => r.boat).join(""));
    if (results.entries.length === 3 && endAt === null) endAt = seq.clock;
    if (endAt !== null && seq.clock > endAt + 15) break;
  }
  assert(ok, "scenario 17 physics finite");
  assert(boats.every((b) => seq.hasStarted(b)), "all three made a valid start");
  const d = results.toData();
  console.log("     results:", d.map((e) => `P${e.position} boat ${e.boat} ${e.elapsed.toFixed(1)} s`).join(", "), "· orders seen:", [...orders].join(" "), "· tacks:", bots.map((b) => b.tacks).join(","), "· min centre distance", minD.toFixed(1), "m");
  assert(d.length === 3, "all three finish (start → windward mark → finish)");
  assert(R.getIncidents().length === 0, "no boat-boat contact incidents");
  assert(getMarkTouches().length === 0, "no mark touches");
  assert(bots.every((b) => b.tacks >= 1 && b.tacks <= 3), "a couple of tacks at most");
  assert(orders.size >= 2, "leaderboard order changes during the race");
  const final = leaderboard.rows().map((r) => r.boat);
  assert(final.join("") === d.map((e) => e.boat).join(""), `final leaderboard ${final.join("")} = finish order`);
  assert(leaderboard.rows().every((r) => r.status === "finished"), "all rows finished");
}
console.log("leaderboard-check: all passed");
