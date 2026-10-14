// Headless checks for the virtual boundary (src/boundary.js), boundary room
// (rules.js 'BR') and scenario 19 (src/boundary-scenario.js).
// Run: node --import ./test/register.mjs scripts/boundary-check.mjs
import '../test/dom-stub.mjs';

const R = await import("../src/rules.js");
const { Map } = await import("../src/map.js");
const B = await import("../src/boundary.js");
const S = await import("../src/boundary-scenario.js");
const { Boat } = await import("../src/boat.js");

function assert(cond, message) {
  if (!cond) { console.error("FAIL", message); process.exitCode = 1; throw new Error(message); }
  console.log("ok  ", message);
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const DT = 1 / 30;
function freshMap() {
  const m = new Map(100, 200, 90, 15, null);
  m.physics_model_init();
  m.setDevMode(true);
  return m;
}
function reset() { R.resetContacts(); R.resetRule15Memory(); }
const getWindOf = (m) => (x, y) => m.get_wind(x, y);
const ids = (res) => res.applicable.map((a) => (a.inhibited ? "~" : "") + a.id).join(" ");

// --- Geometry and scaling ---
{
  const b100 = new B.Boundary(100), b50 = new B.Boundary(50), b200 = new B.Boundary(200);
  assert(near(b100.x, 40) && near(b100.zone, 20), "100 m wide: line x = ±40 (8 m inside the ±48 walls), zone 20 m");
  assert(near(b50.zone, 10) && near(b50.x, 25 - 2 - 4), `50 m wide: zone scales to 10 m, line at ±${b50.x}`);
  assert(near(b200.x, 90) && near(b200.zone, 20), "200 m wide: line ±90, zone 20 m");
  assert(B.BOUNDARY_ZONE_M === 20 && B.BOUNDARY_GRACE_S === 1, "defaults: 20 m zone (5 boat lengths), 1 s grace");
  const pt = (x, y) => ({ x, y, _ruleHull: [{ x, y }] });
  assert(near(b100.distanceOf(pt(35, 0)).dist, 5) && b100.distanceOf(pt(35, 0)).side === 1, "east side distance");
  assert(near(b100.distanceOf(pt(-38, 0)).dist, 2) && b100.distanceOf(pt(-38, 0)).side === -1, "west side distance");
  assert(b100.inZone(pt(21, 0), 1) && !b100.inZone(pt(19, 0), 1), "zone is the 20 m band inside the line");
  assert(b100.distanceOf(pt(41, 0)).dist < 0, "beyond the line: negative distance");
  assert(b100.guides().length > 100, "overlay: dashed line, zone edge, hatching");
}

// --- Boundary room in the scenario 19 start position (closer boat entitled) ---
{
  reset();
  const m = freshMap();
  const t = S.setupBoundaryTest(m);
  const [p, s] = t.boats;
  for (const b of t.boats) b.physics_model_step();
  m.world.step(DT);
  const without = R.evaluateAllPairs(t.boats, getWindOf(m), 0, {});
  assert(without.length === 1 && without[0].final.id === "10" && without[0].final.giveWay === p, "no boundary: Rule 10, port boat 0 keeps clear");
  assert(!without[0].applicable.some((a) => a.id === "BR"), "no boundary: no boundary room");
  reset();
  const res = R.evaluateAllPairs(t.boats, getWindOf(m), 0, { boundary: t.boundary });
  const r = res[0];
  assert(t.boundary.sideDistance(p, 1) + 1 < t.boundary.sideDistance(s, 1), "boat 0 is closer to the east boundary");
  assert(r.final.id === "BR" && r.final.rightOfWay === p && r.final.giveWay === s && r.faultBoat === s, "Boundary room final: boat 0 entitled, boat 1 gives room (fault side)");
  assert(r.applicable.find((a) => a.id === "10").inhibited && r.applicable.find((a) => a.id === "10").inhibitedBy === "BR", `Rule 10 struck through by boundary room (${ids(r)})`);
  assert(r.boundaryRoom && r.boundaryRoom.decisive, "resolution.boundaryRoom set, decisive");
  const lines = r.guides.find((g) => g.type === "label").lines;
  assert(lines.some((l) => l.text === "Boundary room" && l.role === "final") && lines.some((l) => l.id === "10" && l.role === "inhibited"), "label stack: Boundary room bold, Rule 10 struck");
  const badges = R.boundaryRoomGuides(res, t.boats).map((g) => g.lines[0].text);
  assert(badges.includes("GETS BOUNDARY ROOM") && badges.includes("GIVES ROOM → boat 0"), "GETS / GIVES ROOM badges");
}

// --- Freeze, hysteresis and ending (fake boundary distances) ---
{
  reset();
  const m = freshMap();
  const a = new Boat(m, 0, 0, Math.PI * 0.72), b = new Boat(m, -3, -4, Math.PI * 1.28);
  for (const x of [a, b]) x.physics_model_step();
  m.world.step(DT);
  const d = new globalThis.Map([[a, 10], [b, 10.5]]);
  const fake = { zone: 20, distanceOf: (x) => ({ side: 1, dist: d.get(x) }), sideDistance: (x) => d.get(x) };
  const ev = (time) => R.evaluateAllPairs([a, b], getWindOf(m), time, { boundary: fake })[0];
  let r = ev(0);
  assert(!r.boundaryRoom, "within BOUNDARY_TIE_M (0.5 m apart): nobody entitled yet");
  d.set(b, 12);
  r = ev(DT);
  assert(r.boundaryRoom && r.boundaryRoom.rightOfWay === a, "2 m closer: boat a entitled (frozen)");
  d.set(a, 13); d.set(b, 9);
  r = ev(2 * DT);
  assert(r.boundaryRoom && r.boundaryRoom.rightOfWay === a, "frozen: stays with a after b becomes closer");
  d.set(a, 20.5);
  r = ev(3 * DT);
  assert(r.boundaryRoom && r.boundaryRoom.rightOfWay === a, "0.5 m beyond the zone edge: still entitled (exit hysteresis 1 m)");
  d.set(a, 21.5);
  r = ev(4 * DT);
  assert(!r.boundaryRoom, "left the zone: entitlement ends");
  d.set(a, 15);
  r = ev(5 * DT);
  assert(!r.boundaryRoom, "ended stays ended while a boat is still in the zone");
  d.set(a, 25); d.set(b, 25);
  ev(6 * DT);
  d.set(a, 15); d.set(b, 5);
  r = ev(7 * DT);
  assert(r.boundaryRoom && r.boundaryRoom.rightOfWay === b, "both out of the zone, then back in: freezes afresh (b closer)");
  assert(!R.evaluateAllPairs([a, b], getWindOf(m), 8 * DT, {})[0].applicable.some((x) => x.id === "BR"), "without opts.boundary nothing changes");
}

// --- Contact while boundary room is final: giving boat at fault ---
{
  reset();
  const m = freshMap();
  const t = S.setupBoundaryTest(m);
  const [p, s] = t.boats;
  for (const b of t.boats) b.physics_model_step();
  m.world.step(DT);
  // Freeze with boat 0 entitled, then move boat 1 onto her (touching).
  R.evaluateAllPairs(t.boats, getWindOf(m), 0, { boundary: t.boundary });
  s.physics_model.setPosition({ x: p.x - 1.2, y: p.y - 0.6 });
  s.physics_model.setAngle(p.physics_model.getAngle());
  for (const b of t.boats) b.physics_model_step();
  const res = R.evaluateAllPairs(t.boats, getWindOf(m), DT, { boundary: t.boundary });
  R.recordContacts(res, DT, t.boats);
  const inc = R.getIncidents();
  assert(res[0].clearance <= 0.05, `boats touching (clearance ${res[0].clearance.toFixed(2)} m)`);
  assert(inc.length === 1 && inc[0].finalId === "BR" && inc[0].faultBoat === s && inc[0].exonerated[0] === p, "contact: fault on the giving boat, entitled boat exonerated");
  assert(R.penaltyRuleName(inc[0]) === "Boundary room" && inc[0].reason === "Boundary room: did not give room", "incident named Boundary room");
  assert(R.pendingPenaltyCount(s) === 1 && R.pendingPenaltyCount(p) === 0, "pending penalty on the giving boat only");
}

// --- Crossing penalty: grace, one per excursion, re-arm ---
{
  reset();
  const bd = new B.Boundary(100);
  const boat = { x: 0, y: 0, _ruleHull: [{ x: 39, y: 0 }, { x: 39.5, y: 1 }] };
  const at = (x) => { boat._ruleHull = [{ x, y: 0 }, { x: x - 0.5, y: 1 }]; };
  bd.update([boat], 0);
  at(40.3);
  let charged = 0;
  for (let t = 0.1; t < 0.95; t += 0.1) charged += bd.update([boat], t).length;
  assert(charged === 0 && R.pendingPenaltyCount(boat) === 0, "outside for < 1 s: no penalty (grace)");
  charged += bd.update([boat], 1.1).length;
  assert(charged === 1 && R.pendingPenaltyCount(boat) === 1, "after 1 s outside: one pending penalty");
  assert(R.pendingPenaltyReason(boat) && /Boundary: crossed/.test(R.pendingPenaltyReason(boat)), `reason '${R.pendingPenaltyReason(boat)}'`);
  for (let t = 1.2; t < 4; t += 0.1) charged += bd.update([boat], t).length;
  assert(charged === 1, "stays outside: still one penalty for the excursion");
  at(39.9);
  bd.update([boat], 4.1);
  at(39); bd.update([boat], 4.2);
  at(40.6);
  for (let t = 4.3; t < 5.5; t += 0.1) charged += bd.update([boat], t).length;
  assert(charged === 2 && R.pendingPenaltyCount(boat) === 2, "fully back inside, out again ≥ 1 s: second penalty");
  assert(R.penaltyRuleName(bd.crossings[0]) === "Boundary", "penalty named Boundary");
}

// --- Scenario 19 headless run ---
{
  reset();
  const m = freshMap();
  const t = S.setupBoundaryTest(m);
  const [p, s] = t.boats;
  let tm = 0, brSeen = false, struck10 = false, struck13 = false, brEndedInRange = false, brOnTack = false, minClear = Infinity, maxBrT = 0;
  for (let i = 0; i < 70 * 30; i++) {
    for (const b of t.boats) b.physics_model_step();
    m.world.step(DT); tm += DT;
    t.step(tm); t.boundary.update(t.boats, tm);
    R.beginRule15Step(tm);
    const res = R.evaluateAllPairs(t.boats, getWindOf(m), tm, { boundary: t.boundary });
    R.recordContacts(res, tm, t.boats);
    for (const r of res) {
      minClear = Math.min(minClear, r.clearance);
      const br = r.final && r.final.id === "BR";
      if (br) { brSeen = true; maxBrT = tm; if (p.tacking) brOnTack = true; }
      if (br && r.applicable.some((a) => a.id === "10" && a.inhibited)) struck10 = true;
      if (br && r.applicable.some((a) => a.id === "13" && a.inhibited)) struck13 = true;
      if (!r.boundaryRoom && brSeen && tm < 10) brEndedInRange = true;
    }
  }
  console.log(`     boundary room until ${maxBrT.toFixed(1)} s, min clearance ${minClear.toFixed(1)} m, crossings ${t.boundary.crossings.map((c) => "boat " + t.boats.indexOf(c.faultBoat) + " @" + c.time.toFixed(1) + " s").join(", ")}`);
  assert(brSeen && struck10 && struck13, "scenario 19: Boundary room final, Rule 10 and then Rule 13 struck through");
  assert(brOnTack && brEndedInRange, "entitlement holds through the tack and ends after it (pair still in range)");
  assert(R.getIncidents().length === 0, "no contact");
  assert(t.boundary.crossings.length === 1 && t.boundary.crossings[0].faultBoat === s, "boat 1 crosses the west boundary once: one penalty");
  assert(t.bots[0].phase >= 2 && t.bots[1].phase >= 1, "scripts ran both phases");
}
console.log("boundary-check: all passed");
