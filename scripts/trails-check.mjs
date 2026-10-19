// Boat trails (boat-trails.js): dots every interval of sim time, ring
// capacity duration / interval, fade, live settings, resets (time going
// back, scenario epoch, respawn jump), and the host frame fields ts/ep/bc.
// Run: node --import ./test/register.mjs scripts/trails-check.mjs
import '../test/dom-stub.mjs';

const T = await import("../src/boat-trails.js");

function assert(cond, message) {
  if (!cond) { console.error("FAIL", message); process.exitCode = 1; throw new Error(message); }
  console.log("ok  ", message);
}
const run = (tr, t0, t1, dt, pos, key = 1) => { for (let t = t0; t <= t1 + 1e-9; t += dt) tr.update(t, pos(t), key); };

// Defaults.
{
  const tr = new T.BoatTrails();
  assert(tr.interval === 1 && tr.duration === 60 && tr.size === 0.4 && tr.cap === 60, `defaults: dot every 1 s, kept 60 s, 0.4 m (cap ${tr.cap})`);
}

// One dot per interval of sim time, at the boat's position; capped by duration.
{
  const tr = new T.BoatTrails();
  run(tr, 0, 10, 1 / 30, (t) => [{ px: t, py: 2 * t }]);
  const dots = [];
  tr.forEachDot((i, x, y, age) => dots.push({ i, x, y, age }));
  assert(dots.length === 11, `11 dots after 10 s at 1 s (got ${dots.length})`);
  assert(dots.every((d) => Math.abs(d.y - 2 * d.x) < 1e-3 && Math.abs(d.age - (10 - d.x)) < 0.05), "dots at the boat's position at the drop time");
  run(tr, 10 + 1 / 30, 200, 1 / 30, (t) => [{ px: (t % 6), py: 0 }]);
  assert(tr.count() === 60, `ring keeps 60 s of dots (got ${tr.count()})`);
}

// Fewer frames than intervals (big dt) still drop one dot per frame at most, no burst.
{
  const tr = new T.BoatTrails({ interval: 1 });
  run(tr, 0, 30, 2.5, () => [{ px: 0, py: 0 }]);
  assert(tr.count() === 13, `coarse frames: one dot per frame (got ${tr.count()})`);
}

// Fade: alpha falls from TRAIL_ALPHA_NEW at age 0 towards 0 at the duration.
{
  const tr = new T.BoatTrails({ interval: 1, duration: 10 });
  run(tr, 0, 9, 0.1, (t) => [{ px: t, py: 0 }, { px: -t, py: 0 }]);
  const pos = new Float32Array(100 * 3), col = new Float32Array(100 * 4);
  const n = tr.write(pos, col, (i) => (i ? [1, 0, 0] : [0, 0, 1]));
  const a = []; for (let k = 0; k < n; k++) a.push(col[k * 4 + 3]);
  assert(n === 20, `two boats × 10 dots written (got ${n})`);
  assert(Math.abs(a[0] - T.TRAIL_ALPHA_NEW) < 0.02 && a[9] < 0.15 && a.slice(0, 10).every((v, k) => k === 0 || v < a[k - 1]), `alpha fades with age (${a.slice(0, 10).map((v) => v.toFixed(2)).join(" ")})`);
  assert(col[0] === 0 && col[2] === 1 && col[10 * 4] === 1, "per-boat colour");
}

// Live settings: longer interval / shorter duration shrink the ring, keeping the newest.
{
  const tr = new T.BoatTrails();
  run(tr, 0, 59, 0.5, (t) => [{ px: t, py: 0 }]);
  tr.set({ duration: 20 });
  const xs = []; tr.forEachDot((i, x) => xs.push(x));
  assert(tr.cap === 20 && xs.length === 20 && xs[0] === 59 && xs[19] === 40, `duration 20 s keeps the newest 20 (${xs[0]}..${xs[xs.length - 1]})`);
  tr.set({ interval: 5, duration: 60 });
  run(tr, 59.5, 90, 0.5, (t) => [{ px: t, py: 0 }]);
  const ts = []; tr.forEachDot((i, x) => ts.push(x));
  assert(tr.cap === 12 && ts.slice(0, 5).every((x, k) => k === 0 || Math.abs(ts[k - 1] - x - 5) < 1e-6), `interval 5 s: dots 5 s apart (${ts.slice(0, 5).join(" ")})`);
  tr.set({ size: 1.2 });
  assert(tr.size === 1.2, "dot size live");
  tr.set({ interval: 0, duration: -1, size: NaN });
  assert(tr.interval === 5 && tr.duration === 60 && tr.size === 1.2, "invalid inputs ignored");
}

// Resets: time going back, a new scenario epoch, a respawn jump, fewer boats.
{
  const tr = new T.BoatTrails();
  run(tr, 0, 10, 0.5, (t) => [{ px: t, py: 0 }, { px: 0, py: t }], 1);
  assert(tr.count() === 22, "two trails");
  tr.update(11, [{ px: 11, py: 0 }, { px: 50, py: 50 }], 1);
  const per = [0, 0]; tr.forEachDot((i) => per[i]++);
  assert(per[0] === 12 && per[1] === 1, `respawn jump starts a fresh trail for that boat only (${per})`);
  tr.update(12, [{ px: 12, py: 0 }, { px: 50, py: 50 }], 2);
  assert(tr.count() === 2, `new scenario epoch resets (count ${tr.count()})`);
  run(tr, 12, 15, 0.5, (t) => [{ px: t, py: 0 }, { px: 50, py: 50 }], 2);
  tr.update(1, [{ px: 0, py: 0 }, { px: 50, py: 50 }], 2);
  assert(tr.count() === 2, "time going back resets");
  tr.update(1.5, [{ px: 0, py: 0 }], 2);
  assert(tr.boats.length === 1, "fewer boats resets");
}

// colorRgb.
{
  const c = T.colorRgb(0xff8000), d = T.colorRgb("#00ff00");
  assert(c[0] === 1 && Math.abs(c[1] - 128 / 255) < 1e-9 && c[2] === 0 && d[1] === 1 && T.colorRgb("x") === null, "colorRgb");
}

// Host: frame.state carries sim time ts, epoch ep (bumped on a scenario load).
{
  const { SimCore } = await import("../src/host.js");
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: "4f", texture: { image: { data: new Uint8Array(0) } } });
  core.command({ type: "devMode", on: true });
  core.command({ type: "restart", scenario: 19 });
  const view = { camera_position_x: 0, camera_position_y: 0, camera_zoom: 40, show_forces: false, show_fields: false };
  const tick = () => core.tick({ dt: 1 / 30, held: [], present: true, view }).state;
  const a = tick(); for (let i = 0; i < 59; i++) tick(); const b = tick();
  assert(Number.isFinite(a.ts) && b.ts > a.ts && Math.abs(b.ts - a.ts - 2) < 0.1, `state.ts is sim time (${a.ts.toFixed(2)} → ${b.ts.toFixed(2)})`);
  assert(b.boats.length > 0 && Number.isFinite(b.boats[0].px), "boats carry px/py");
  core.command({ type: "restart", scenario: 19 });
  const c = tick();
  assert(c.ep === a.ep + 1, `restart bumps state.ep (${a.ep} → ${c.ep})`);
  const tr = new T.BoatTrails();
  tr.update(b.ts, b.boats, b.ep); tr.update(c.ts, c.boats, c.ep);
  assert(tr.count() === c.boats.length, "trails reset on the new epoch");
}
console.log("trails-check: all passed");
