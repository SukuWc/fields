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
// Rigid outline move.
{
  const pts = [1, 0, 2, 0];
  const out = G.moveOutline(pts, 1, 0, { dx: 5, dy: 0, da: Math.PI / 2 });
  assert(near(out[0], 6) && near(out[1], 0) && near(out[2], 6) && near(out[3], 1), "outline rotated about the body origin, then shifted");
}
// Assignment: nearest boat, polygons only, max distance.
{
  const bodies = [
    { kind: 'polygon', pts: [0, 0, 1, 0, 1, 1] },
    { kind: 'polygon', pts: [20, 0, 21, 0, 21, 1] },
    { kind: 'circle', pts: [0, 0, 1, 1] },
    { kind: 'polygon', pts: [100, 100, 101, 100, 101, 101] },
  ];
  const own = G.assignBodies(bodies, [{ px: 20, py: 0 }, { px: 0, py: 0 }]);
  assert(own.join() === "1,0,-1,-1", `assignment ${own.join()}`);
}
console.log("ghost-check: all passed");
