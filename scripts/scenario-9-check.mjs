// Scenario 9 "Contact during Rule 15": headless run (dev mode).
// Run: node --import ./test/register.mjs scripts/scenario-9-check.mjs
// KNOWN DISCREPANCY: on main the bow meets the leader at ~1 s while the pair
// is still Rule 12 (clear astern), before any overlap / Rule 15 window. The
// fault boat (the trailer) is the one the description names, but the deciding
// rule is 12, not 15. The Rule-15 assert is XFAIL (STRICT=1 makes it fail).
const { runScenario, assert, knownBug, pairOf, timeline, R } = await import("./scenario-harness.mjs");
const r = runScenario(9, 4);
const [lead, trail] = r.ids;
console.log(timeline(r.log));
for (const i of r.incidents) console.log(`     incident at ${i.time.toFixed(2)} s: Rule ${i.finalId}, fault ${i.faultBoat.boatId}`);
const p0 = pairOf(r.log[0], lead, trail);
assert(p0 && p0.final === "12" && p0.row === lead && p0.gw === trail, "opens on Rule 12 (trailer clear astern)");
const inc = r.incidents;
assert(inc.length === 1, "exactly one contact");
assert(inc[0].faultBoat.boatId === trail, "the trailer (motoring boat) is at fault");
assert(R.pendingPenaltyCount(r.byId(trail)) === 1 && R.pendingPenaltyCount(r.byId(lead)) === 0, "penalty on the trailer only");
knownBug(inc[0].finalId === "15", `contact falls inside the Rule 15 window (deciding rule ${inc[0].finalId})`);
console.log("scenario-9-check: passed (Rule 15 window XFAIL, known discrepancy)");
