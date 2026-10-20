// Scenario 8 "Rule 15 from clear astern": headless run (dev mode).
// Run: node --import ./test/register.mjs scripts/scenario-8-check.mjs
const { runScenario, assert, firstTime, pairOf, timeline, R } = await import("./scenario-harness.mjs");
const r = runScenario(8, 6);
const [lead, trail] = r.ids;
console.log(timeline(r.log));
const p0 = pairOf(r.log[0], lead, trail);
assert(p0 && p0.final === "12" && p0.row === lead && p0.gw === trail, "opens on Rule 12: leader right of way, trailer clear astern keeps clear");
const t15 = firstTime(r.log, lead, trail, (p) => p.final === "15");
const t11 = firstTime(r.log, lead, trail, (p) => p.final === "11", t15 ?? 0);
assert(t15 !== null && t11 !== null, `Rule 15 from ${t15?.toFixed(2)} s, then Rule 11 from ${t11?.toFixed(2)} s`);
assert(r.log.every((e) => { const p = pairOf(e, lead, trail); return !p || p.final !== "15" || (p.row === trail && p.inhibited.includes("11")); }), "Rule 15 blocks Rule 11; trailer (new leeward boat) is the boat that must give room");
assert(Math.abs(t11 - t15 - R.RULE15_ROOM_S) < 0.1, `Rule 15 lasts about one second (${(t11 - t15).toFixed(2)} s)`);
assert(r.log.filter((e) => e.t >= t11).every((e) => { const p = pairOf(e, lead, trail); return !p || (p.final === "11" && p.row === trail && p.gw === lead); }), "then Rule 11 alone: leeward trailer right of way");
assert(r.incidents.length === 0, "no contact (about a metre of water alongside)");
console.log("scenario-8-check: all passed");
