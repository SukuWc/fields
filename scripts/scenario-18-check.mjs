// Scenario 18 "Fleet of four upwind": headless run (dev mode).
// Run: node --import ./test/register.mjs scripts/scenario-18-check.mjs
const { runScenario, assert } = await import("./scenario-harness.mjs");
const { FLEET4 } = await import("../src/scenarios.js");
const R = await import("../src/rules.js");
let start = null;
const r = runScenario(18, 20, ({ byId, ids }) => { if (ids && !start) start = ids.map((id) => { const b = byId(id); return [b.x, b.y]; }); });
assert(r.ids.length === 4 && new Set(r.ids).size === 4, `four boats with unique ids (${r.ids})`);
assert(start.every(([x, y], k) => Math.hypot(x - FLEET4[k][0], y - FLEET4[k][1]) < 0.5), "spawned at the FLEET4 positions (by id order)");
assert(r.ids.every((id) => { const b = r.byId(id); return b.autopilot_enabled; }), "every boat on autopilot");
const finals = new Set(r.log.flatMap((e) => e.pairs.map((p) => p.final)).filter(Boolean));
assert([...finals].every((f) => f === "11" || f === "12"), `all on starboard, same tack: only Rules 11/12 (${[...finals]})`);
assert(r.log.every((e) => e.n === 4), "nobody removed");
assert(r.incidents.length === 0 && r.ids.every((id) => R.pendingPenaltyCount(r.byId(id)) === 0), "no contact, no penalties");
console.log("scenario-18-check: all passed");
