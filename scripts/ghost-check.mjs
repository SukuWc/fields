// Ghost boat (ghost-boat.js): constant turn-rate prediction, straight line
// and constant turn, rigid outline move, body→boat assignment.
// Run: node --import ./test/register.mjs scripts/ghost-check.mjs
import '../test/dom-stub.mjs';
const G = await import("../src/ghost-boat.js");
function assert(cond, message) {
  if (!cond) { console.error("FAIL", message); process.exitCode = 1; throw new Error(message); }
  console.log("ok  ", message);
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
assert(G.GHOST_AHEAD_S === 2, "default lookahead 2 s");
// Straight line.
{
  const p = G.predictPose(3, -1, 0, 2);
  assert(near(p.dx, 6) && near(p.dy, -2) && p.da === 0, `straight: (6, -2) (got ${p.dx}, ${p.dy})`);
  const q = G.predictPose(3, 0, 1e-9, 2);
  assert(near(q.dx, 6, 1e-6) && near(q.dy, 0, 1e-6), "tiny turn rate = straight line");
}
// Constant turn: speed v, rate w → circle radius v/w. Quarter turn ends at (R, R).
{
  const v = 2, w = Math.PI / 4, t = 2; // 90° in 2 s
  const p = G.predictPose(v, 0, w, t);
  const R = v / w;
  assert(near(p.dx, R) && near(p.dy, R) && near(p.da, Math.PI / 2), `quarter turn left: (${R.toFixed(3)}, ${R.toFixed(3)}), +90°`);
  const r = G.predictPose(v, 0, -w, t);
  assert(near(r.dx, R) && near(r.dy, -R) && near(r.da, -Math.PI / 2), "quarter turn right mirrors");
  // Matches small-step integration.
  let x = 0, y = 0, a = 0; const n = 10000, dt = t / n;
  for (let i = 0; i < n; i++) { x += v * Math.cos(a + w * dt / 2) * dt; y += v * Math.sin(a + w * dt / 2) * dt; a += w * dt; }
  assert(near(p.dx, x, 1e-4) && near(p.dy, y, 1e-4), "arc matches numeric integration");
  const full = G.predictPose(v, 0, Math.PI, 2);
  assert(near(full.dx, 0) && near(full.dy, 0), "full circle returns to start");
}
// Host frames: hull statics keyed by boat id, ghosts matched by id.
{
  const { SimCore } = await import("../src/host.js");
  const { buildBodies } = await import("../src/scene-build.js");
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: "4f", texture: { image: { data: new Uint8Array(0) } } });
  core.command({ type: "devMode", on: true });
  core.command({ type: "restart", scenario: 17 });
  const view = { camera_position_x: 0, camera_position_y: 0, camera_zoom: 40, show_forces: false, show_fields: false };
  let statics = null;
  const tick = () => { const f = core.tick({ dt: 1 / 30, held: [], present: true, view }); if (f.statics) statics = f.statics; return f; };
  for (let i = 0; i < 60; i++) tick();
  core.command({ type: "spawnBoat", name: "P" });
  let f = tick();
  const st = f.state, boats = st.boats;
  assert(boats.length >= 4, `scenario 17 + a spawned boat (${boats.length} boats)`);
  assert(boats.every((b) => typeof b.id === "string" && ["vx", "vy", "w"].every((k) => Number.isFinite(b[k]))), "every boat carries id, vx, vy, w");
  const ids = boats.map((b) => b.id);
  assert(new Set(ids).size === ids.length && ids.some((id) => id.startsWith("b")) && ids.some((id) => id.startsWith("s")), `unique ids, scenario and player boats (${ids.join(",")})`);
  assert(ids.every((id) => statics.hulls[id] && statics.hulls[id].v.length >= 6), "statics.hulls has every boat id");
  assert(boats.every((b) => ["vx", "vy", "w"].every((k) => Math.abs(b[k] * 1000 - Math.round(b[k] * 1000)) < 1e-6)), "vx, vy, w rounded to 1e-3");
  // Statics are not resent per frame (hull shapes are static).
  let resent = 0; for (let i = 0; i < 30; i++) if (tick().statics) resent++;
  assert(resent === 0, `statics not resent while nothing changes (${resent})`);
  f = tick();
  // t = 0 ghost lies on the drawn hull.
  const drawn = buildBodies(statics.bodies, f.state.bt).filter((b) => b.kind === "polygon");
  for (const b of f.state.boats) {
    const g = G.ghostOutline(statics.hulls[b.id], b, 0);
    const hit = drawn.some((d) => d.pts.length === g.length && d.pts.every((x, k) => Math.abs(x - g[k]) < 1e-3));
    assert(hit, `t=0 ghost of ${b.id} matches its drawn hull`);
  }
  // Matching is by id: reversing boat order (and swapping hulls) keeps each ghost on its id.
  const rev = [...f.state.boats].reverse();
  const out = G.ghostOutlines(rev, statics.hulls, 2);
  assert(out.length === rev.length && out.every((g, k) => g.id === rev[k].id && g.i === k), "ghosts follow boat ids, not order");
  const fake = { ...statics.hulls, [rev[0].id]: { v: [0, 0, 1, 0, 1, 1], com: [0, 0] } };
  const out2 = G.ghostOutlines(rev, fake, 2);
  assert(out2[0].pts.length === 8 && out2[1].pts.length === out[1].pts.length, "a hull change applies only to its id");
  assert(G.ghostOutlines([{ id: "zz", px: 0, py: 0, pa: 0, vx: 1, vy: 0, w: 0 }], statics.hulls, 2).length === 0, "unknown id: no ghost (no fallback)");
  // Frame size: ghost fields (id, vx, vy, w) bounded per boat.
  const full = JSON.stringify(f.state).length;
  const bare = JSON.stringify({ ...f.state, boats: f.state.boats.map(({ id, vx, vy, w, ...r }) => r) }).length;
  const per = (full - bare) / f.state.boats.length;
  console.log(`     frame ${full} B, without ghost fields ${bare} B: +${full - bare} B (+${(100 * (full - bare) / bare).toFixed(1)} %), ${per.toFixed(1)} B per boat`);
  assert(per <= 50 && (full - bare) / bare < 0.05, "ghost fields add at most 50 B per boat and < 5 % of the frame");
}

console.log("ghost-check: all passed");
