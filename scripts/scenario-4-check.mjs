// Scenario 4 "Tack, then a small head-up": headless run (dev mode).
// Run: node --import ./test/register.mjs scripts/scenario-4-check.mjs
const { runScenario, assert, firstTime, pairOf, timeline } = await import("./scenario-harness.mjs");

let headBefore = null, headAfter = null, b1 = null;
const r = runScenario(4, 23, ({ t, byId, ids }) => {
  if (!ids) return;
  const b = byId(ids[1]);
  if (!b) return;
  if (Math.abs(t - 7.7) < 0.02) headBefore = b.autopilot_heading_target;
  if (Math.abs(t - 7.9) < 0.02) headAfter = b.autopilot_heading_target;
});
const [port, stbd] = r.ids;
console.log(timeline(r.log));
assert(r.ids.length === 2, `two scenario boats (${r.ids})`);
const tack = firstTime(r.log, port, stbd, (p) => p.final === "13");
assert(tack !== null && tack > 3 && tack < 4.5, `port boat tacks after frame 300: Rule 13 from ${tack?.toFixed(2)} s`);
assert(r.log.every((e) => { const p = pairOf(e, port, stbd); return !p || !p.final || p.gw === port; }), "the port (tacking) boat is give-way throughout (Rules 13, 12, 10)");
assert(headBefore !== null && headAfter !== null && Math.abs(Math.abs(headBefore) - Math.abs(headAfter) - 3) < 1e-9, `boat ${stbd} heads up 3° at frame 700 (target ${headBefore} → ${headAfter})`);
assert(r.incidents.length === 0, "no contact");
const cleared = r.log.find((e) => e.t > 21 && e.n === 0);
assert(cleared && cleared.t < 22.5, `script removes both boats at frame 2000 (${cleared?.t.toFixed(2)} s)`);
console.log("scenario-4-check: all passed");
