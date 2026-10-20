// Scenario 6 "Tack through Rule 13 into Rule 10": headless run (dev mode).
// Run: node --import ./test/register.mjs scripts/scenario-6-check.mjs
const { runScenario, assert, firstTime, pairOf, timeline } = await import("./scenario-harness.mjs");
const r = runScenario(6, 8);
const [b0, b1] = r.ids;
console.log(timeline(r.log));
const first = pairOf(r.log[0], b0, b1);
assert(first && first.final === "11", "opens on Rule 11 (same tack, overlapped, inside 12 m)");
const t13 = firstTime(r.log, b0, b1, (p) => p.final === "13");
assert(t13 !== null && t13 > 0.9, `boat 0 tacks: Rule 13 from ${t13?.toFixed(2)} s`);
assert(r.log.every((e) => { const p = pairOf(e, b0, b1); return !p || p.final !== "13" || (p.gw === b0 && p.row === b1 && p.inhibited.includes("10")); }), "Rule 13: boat 0 keeps clear, Rule 10 struck");
const t10 = firstTime(r.log, b0, b1, (p) => p.final === "10", t13);
assert(t10 !== null, `close-hauled on port: Rule 10 from ${t10?.toFixed(2)} s`);
assert(r.log.every((e) => { const p = pairOf(e, b0, b1); return !p || p.final !== "10" || (p.gw === b0 && p.row === b1); }), "Rule 10: boat 0 (port) keeps clear, boat 1 (starboard) right of way");
assert(r.incidents.length === 0, "no contact");
console.log("scenario-6-check: all passed");
