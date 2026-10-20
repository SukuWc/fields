// Shared headless runner for the scripts/scenario-<n>-check.mjs checks.
// Not a check itself (no -check suffix). Boats are looked up by id
// (boat.boatId: s1.. for scenario boats), never by position in sim.players.
import '../test/dom-stub.mjs';

const { SimCore } = await import("../src/host.js");
export const R = await import("../src/rules.js");

export function assert(cond, message) {
  if (!cond) { console.error("FAIL", message); process.exitCode = 1; throw new Error(message); }
  console.log("ok  ", message);
}
export const DT = 1 / 30;

// Same order as SimCore.tick: world.step(dt), then sim.step.
// Load scenario n in dev mode (uniform wind) and step it for `seconds`.
// onStep({ t, sim, rec, byId, pairs }) is called every tick; returning true stops.
// Returns { core, sim, ids, byId, t, log } where ids are the scenario's boat
// ids in spawn order (ascending uid) and log is the per-tick pair summary.
export function runScenario(n, seconds, onStep) {
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: "4f", texture: { image: { data: new Uint8Array(0) } } });
  core.command({ type: "devMode", on: true });
  core.command({ type: "restart", scenario: n });
  const sim = core.sim;
  const origLog = console.log;
  let ids = null, t = 0;
  const log = [];
  const byId = (id) => sim.players.find((p) => p.boatId === id) || null;
  for (let i = 0; i < seconds * 30; i++) {
    console.log = () => {}; // scenario scripts log "Frame n"
    let rec;
    try { core.map.world.step(DT); rec = sim.step(DT, []); } finally { console.log = origLog; }
    t += DT;
    if (!ids && sim.players.length) {
      ids = sim.players.map((p) => p.boatId).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    }
    const pairs = rec.resolutions.filter(Boolean).map((r) => ({
      a: r.boatA.boatId, b: r.boatB.boatId,
      final: r.final ? r.final.id : null,
      row: r.final && r.final.rightOfWay ? r.final.rightOfWay.boatId : null,
      gw: r.final && r.final.giveWay ? r.final.giveWay.boatId : null,
      inhibited: (r.applicable || []).filter((x) => x.inhibited).map((x) => x.id),
      clearance: r.clearance,
    }));
    log.push({ t, pairs, n: sim.players.length });
    if (onStep && onStep({ t, sim, rec, byId, pairs, ids })) break;
  }
  return { core, sim, ids, byId, t, log, incidents: R.getIncidents().slice() };
}

// Compact timeline: "t: A/B final(row>gw)" on every change, for debugging.
export function timeline(log) {
  const out = []; let last = "";
  for (const e of log) {
    const s = e.pairs.map((p) => `${p.a}/${p.b} ${p.final ?? "-"}${p.row ? `(${p.row}>${p.gw})` : ""}${p.inhibited.length ? " ~" + p.inhibited.join("~") : ""}`).join(" | ") + ` [${e.n}]`;
    if (s !== last) { out.push(`${e.t.toFixed(2)}: ${s}`); last = s; }
  }
  return out.join("\n");
}

// Pairs for one boat-id pair in a log entry.
export function pairOf(entry, a, b) {
  return entry.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a)) || null;
}
// First log time where pred(pair) holds for the a/b pair, or null.
export function firstTime(log, a, b, pred, from = 0) {
  for (const e of log) { if (e.t < from) continue; const p = pairOf(e, a, b); if (p && pred(p)) return e.t; }
  return null;
}
// Known sim bug: XFAIL unless STRICT=1 (then a real FAIL). Prints XPASS once fixed.
export function knownBug(cond, message) {
  if (cond) { console.log("XPASS", message, "(known bug fixed? drop the knownBug wrapper)"); return; }
  if (process.env.STRICT === "1") assert(false, message);
  console.log("XFAIL", message);
}
