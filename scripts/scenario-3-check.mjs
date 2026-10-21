// Scenario 3 "Crossing, then the port boat tacks": headless run (dev mode).
// Run: node --import ./test/register.mjs scripts/scenario-3-check.mjs
const { runScenario, assert, firstTime, pairOf, timeline } = await import("./scenario-harness.mjs");

const r = runScenario(3, 23);
const [port, stbd] = r.ids;
console.log(timeline(r.log));
assert(r.ids.length === 2 && r.ids.every((id) => /^s\d+$/.test(id)), `two scenario boats (${r.ids})`);
const tack = firstTime(r.log, port, stbd, (p) => p.final === "13");
assert(tack !== null && tack > 3.5 && tack < 5, `port boat tacks after frame 350: Rule 13 from ${tack?.toFixed(2)} s`);
assert(r.log.every((e) => { const p = pairOf(e, port, stbd); return !p || p.final !== "13" || (p.gw === port && p.row === stbd); }), "Rule 13: the tacking (port) boat keeps clear");
const r10 = firstTime(r.log, port, stbd, (p) => p.final === "10", tack);
assert(r10 !== null, `Rule 10 after the tack (${r10?.toFixed(2)} s)`);
assert(r.log.every((e) => { const p = pairOf(e, port, stbd); return !p || p.final !== "10" || (p.row === stbd && p.gw === port); }), "Rule 10: starboard boat right of way, port boat keeps clear");
assert(r.incidents.length === 0, "no scored collision");
const cleared = r.log.find((e) => e.t > 21 && e.n === 0);
assert(cleared && cleared.t < 22.5, `script removes both boats at frame 2000 (${cleared?.t.toFixed(2)} s)`);
console.log("scenario-3-check: all passed");
