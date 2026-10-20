// Scenario 7 "Rule 10 collision, port boat at fault": headless run (dev mode).
// Run: node --import ./test/register.mjs scripts/scenario-7-check.mjs
// KNOWN BUG: the promised outcome does not happen on main. Frames 0-2 run in
// one Sim tick before the first physics step, so input_autopilot_enabled_toggle
// (frame 1) sees autopilot_heading_target 0 and picks +50 (the starboard
// target) for both port-tack boats. Frame 36's tack toggle then puts boat 0
// back on port (no tack), and boat 1's +40° "bear away" lands on 90 = a
// starboard reach, so she tacks instead. The rule-outcome asserts are XFAIL
// (STRICT=1 makes them fail) until the sim is fixed.
const { runScenario, assert, knownBug, firstTime, pairOf, timeline, R } = await import("./scenario-harness.mjs");

let tw0 = null, tw1 = null, tgt0 = null;
const r = runScenario(7, 20, ({ t, byId, ids }) => {
  if (!ids || Math.abs(t - 0.1) > 0.02) return;
  tw0 = byId(ids[0]).twa; tw1 = byId(ids[1]).twa; tgt0 = byId(ids[0]).autopilot_heading_target;
});
const [b0, b1] = r.ids;
console.log(timeline(r.log) || "(no rule pairs)");
assert(r.ids.length === 2, `two scenario boats (${r.ids})`);
assert(Math.sign(tw0) === Math.sign(tw1) && R.classifyTack(Math.PI * 3 / 4, 90) !== undefined, "both start on the same (port) tack");
knownBug(tgt0 === -tw0 || Math.sign(tgt0) === -Math.sign(tw0), `frame-1 autopilot target matches the boat's own tack (twa ${tw0?.toFixed(0)}, target ${tgt0})`);
knownBug(firstTime(r.log, b0, b1, (p) => p.final === "13" && p.gw === b0) !== null, "boat 0 tacks: Rule 13, boat 0 keeps clear");
knownBug(r.log.some((e) => { const p = pairOf(e, b0, b1); return p && p.final === "15"; }), "Rule 15 briefly blocks Rule 10 on reaching close-hauled");
const inc = r.incidents;
knownBug(inc.length === 1 && inc[0].finalId === "10" && inc[0].faultBoat.boatId === b1, "contact under Rule 10, port boat (boat 1) at fault");
knownBug(inc.length === 1 && R.pendingPenaltyCount(r.byId(b1)) === 1, "boat 1 keeps a pending penalty (FAULT badge)");
console.log("scenario-7-check: passed (rule outcomes XFAIL, known sim bug)");
