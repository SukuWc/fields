// Scenario 7 "Rule 10 collision, port boat at fault": headless run (dev mode).
// Run: node --import ./test/register.mjs scripts/scenario-7-check.mjs
const { runScenario, assert, firstTime, pairOf, timeline, R } = await import("./scenario-harness.mjs");

let tgt = null;
const r = runScenario(7, 12, ({ t, byId, ids }) => {
  if (!ids || Math.abs(t - 0.2) > 0.02) return;
  tgt = ids.map((id) => { const b = byId(id); return { twa: b.twa, tgt: b.autopilot_heading_target }; });
});
const [b0, b1] = r.ids;
console.log(timeline(r.log));
assert(r.ids.length === 2, `two scenario boats (${r.ids})`);
assert(tgt.every((x) => x.twa > 0 && x.tgt < 0), "both start on port; autopilot holds their own tack (target = -twa side)");
const t13 = firstTime(r.log, b0, b1, (p) => p.final === "13");
assert(t13 !== null && r.log.every((e) => { const p = pairOf(e, b0, b1); return !p || p.final !== "13" || (p.gw === b0 && p.row === b1); }), `boat 0 tacks: Rule 13 from ${t13?.toFixed(2)} s, boat 0 keeps clear`);
const b1h = r.byId(b1).autopilot_heading_target;
assert(Math.abs(b1h) === 90 && Math.sign(b1h) === Math.sign(tgt[1].tgt), `boat 1 bears away onto a port beam reach (target ${b1h})`);
const t15 = firstTime(r.log, b0, b1, (p) => p.final === "15", t13);
assert(t15 !== null && r.log.every((e) => { const p = pairOf(e, b0, b1); return !p || p.final !== "15" || (p.row === b0 && p.inhibited.includes("10")); }), `close-hauled on starboard: Rule 15 blocks Rule 10 from ${t15?.toFixed(2)} s`);
const t10 = firstTime(r.log, b0, b1, (p) => p.final === "10", t15);
assert(t10 !== null && t10 - t15 <= R.RULE15_ROOM_S + 0.1, `then Rule 10 from ${t10?.toFixed(2)} s`);
assert(r.log.every((e) => { const p = pairOf(e, b0, b1); return !p || p.final !== "10" || (p.row === b0 && p.gw === b1); }), "Rule 10: boat 0 (starboard) right of way, boat 1 (port) keeps clear");
const inc = r.incidents;
assert(inc.length === 1 && inc[0].finalId === "10" && inc[0].faultBoat.boatId === b1 && inc[0].time > t10, `one contact under Rule 10 at ${inc[0]?.time.toFixed(2)} s, port boat (boat 1) at fault`);
assert(R.pendingPenaltyCount(r.byId(b1)) === 1 && R.pendingPenaltyCount(r.byId(b0)) === 0, "boat 1 keeps a pending penalty (FAULT badge), boat 0 none");
console.log("scenario-7-check: all passed");
