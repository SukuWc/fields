// Scenario 5 "Empty template": no boats, no rules.
// Run: node --import ./test/register.mjs scripts/scenario-5-check.mjs
const { runScenario, assert } = await import("./scenario-harness.mjs");
const r = runScenario(5, 3);
assert(r.sim.scenarios[5].title === "Empty template", "slot 5 is the empty template");
assert(r.ids === null && r.log.every((e) => e.n === 0 && e.pairs.length === 0), "no boats, no rule pairs");
assert(r.sim.marks.length === 0 && r.incidents.length === 0, "no marks, no incidents");
console.log("scenario-5-check: all passed");
