// Scenario 9 "Contact during Rule 15": headless run (dev mode).
// Run: node --import ./test/register.mjs scripts/scenario-9-check.mjs
const { runScenario, assert, firstTime, pairOf, timeline, R } = await import("./scenario-harness.mjs");
const r = runScenario(9, 4);
const [lead, trail] = r.ids;
console.log(timeline(r.log));
const p0 = pairOf(r.log[0], lead, trail);
assert(p0 && p0.final === "12" && p0.row === lead && p0.gw === trail, "opens on Rule 12 (trailer clear astern)");
const t15 = firstTime(r.log, lead, trail, (p) => p.final === "15");
assert(t15 !== null && r.log.filter((e) => e.t >= t15 && e.t < t15 + R.RULE15_ROOM_S).every((e) => { const p = pairOf(e, lead, trail); return !p || p.final === "15" && (p.row === trail && p.inhibited.includes("11")); }), `overlap from leeward: Rule 15 blocks Rule 11 from ${t15?.toFixed(2)} s`);
const inc = r.incidents;
assert(inc.length === 1, "exactly one contact");
assert(inc[0].finalId === "15" && inc[0].time >= t15 && inc[0].time < t15 + R.RULE15_ROOM_S, `contact at ${inc[0].time.toFixed(2)} s, inside the Rule 15 window`);
assert(inc[0].faultBoat.boatId === trail, "the new right-of-way boat (trailer) is at fault");
assert(R.pendingPenaltyCount(r.byId(trail)) === 1 && R.pendingPenaltyCount(r.byId(lead)) === 0, "penalty on the trailer only");
console.log("scenario-9-check: all passed");
