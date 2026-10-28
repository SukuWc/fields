// Moving-column gusts (src/gusts.js): elliptical momentum injection, long
// axis ⊥ wind, advects with free stream, visible speed anomaly on 2f.
import './dom-stub.mjs';
const {
  GustField, GustColumn, gustEnvelope, flowUnitFromWind, injectEllipticalKernel,
  GUST_ASPECT, GUST_ALONG_SIGMA_M, GUST_CROSS_SIGMA_M, GUST_DEMO, GUST_FORCE_GAIN,
} = await import('../src/gusts.js');
const { SimCore } = await import('../src/host.js');

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const near = (a, b, e) => Math.abs(a - b) <= e;

check('aspect ratio is high (cross / along = 5)', near(GUST_ASPECT, 5, 1e-9) && GUST_CROSS_SIGMA_M > 2 * GUST_ALONG_SIGMA_M);
check('envelope: 0 before birth and after life, 1 in the middle',
  gustEnvelope(-1, 10, 1.5) === 0 && gustEnvelope(11, 10, 1.5) === 0
  && near(gustEnvelope(5, 10, 1.5), 1, 1e-12)
  && gustEnvelope(0.75, 10, 1.5) > 0.4 && gustEnvelope(0.75, 10, 1.5) < 1);
check('flow unit: wind from +Y → flow −Y', (() => {
  const u = flowUnitFromWind(90);
  return near(u.x, 0, 1e-12) && near(u.y, -1, 1e-12);
})());

{
  const g = new GustField();
  g.add({ x: 0, y: 10, delayS: 1, lifeS: 2, rampS: 0.5, forceGain: 0 });
  // Fake map/bm: only advection matters here.
  const map = { wind_direction: 90, wind_speed: 4, devMode: true };
  g.step(1, null, map); // still in delay; age → 0, moved 4 m downwind
  check('column advects during delay', g.columns.length === 1 && near(g.columns[0].y, 10 - 4, 1e-9));
  g.step(2.1, null, map); // age past life → dead and pruned
  check('column pruned after life', g.columns.length === 0);
}

{
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  const mute = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
  mute(() => core.command({ type: 'restart', scenario: 22 }));
  // Scenario frames run on step, not on loadScenario.
  for (let t = 0; t < 2; t++) mute(() => core.tick({ dt: 1 / 30, held: [] }));
  check('scenario 22 loads with boat and two columns',
    core.sim.scenarioIndex === 22 && core.sim.players.length === 1 && core.sim.gusts.columns.length === 2,
    `boats ${core.sim.players.length} gusts ${core.sim.gusts.columns.length}`);
  // Run until first column is injecting (delay 0.5 s + ramp).
  for (let t = 0; t < 45; t++) mute(() => core.tick({ dt: 1 / 30, held: [] }));
  const col = core.sim.gusts.columns[0];
  check('first column injecting after ~1.5 s', !!col && col.lastEnvelope > 0.5 && col.lastInjectCount > 20,
    col ? `env ${col.lastEnvelope.toFixed(2)} n ${col.lastInjectCount}` : 'gone');
  // Peak |u| above freestream near the column centre.
  const bm = core.bm;
  const U = bm.speed;
  let peak = 0, at = null;
  const half = 20;
  for (let y = col.y - half; y <= col.y + half; y += 1) {
    for (let x = col.x - half; x <= col.x + half; x += 1) {
      const v = bm.get_field_velocity(x, y);
      const s = Math.hypot(v.x, v.y);
      // Compare in lattice units (get_field_velocity already /4); freestream lattice |u|/4 = U/4.
      const d = s - U / 4;
      if (d > peak) { peak = d; at = [x, y]; }
    }
  }
  check('speed anomaly visible while injecting (Δ|u|_field > 0)',
    peak > 1e-3, `peak Δ ${peak.toExponential(2)} at ${at}`);
}

// Kernel geometry (mock apply_energy): long axis is cross-wind, independent of LBM advection.
{
  const along = flowUnitFromWind(90); // (0, −1)
  const cross = { x: -along.y, y: along.x }; // (1, 0)
  const hits = [];
  const bm = {
    resolution: 0.5,
    velScale: 2,
    apply_energy(wx, wy, fx, fy) { hits.push({ wx, wy, f: Math.hypot(fx, fy) }); },
  };
  const n = injectEllipticalKernel(bm, 0, 0, along.x, along.y, along, cross, GUST_ALONG_SIGMA_M, GUST_CROSS_SIGMA_M);
  check('kernel deposits many samples', n > 50 && hits.length === n, `n ${n}`);
  // Force-weighted second moments along cross vs along.
  let wC = 0, wA = 0, sum = 0;
  for (const h of hits) {
    const dc = h.wx * cross.x + h.wy * cross.y;
    const da = h.wx * along.x + h.wy * along.y;
    wC += h.f * dc * dc;
    wA += h.f * da * da;
    sum += h.f;
  }
  const varC = wC / sum, varA = wA / sum;
  check('kernel variance: cross-wind ≫ along-wind (ellipse ⊥ wind)',
    varC > 4 * varA, `varC ${varC.toFixed(2)} varA ${varA.toFixed(2)} (σ² expect ~${(GUST_CROSS_SIGMA_M**2).toFixed(1)} / ${(GUST_ALONG_SIGMA_M**2).toFixed(1)})`);
}

{
  // After injection ends, the puff has moved downwind of the birth point.
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  const mute = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
  mute(() => {
    core.command({ type: 'restart', scenario: 0 });
    core.sim.players.length = 0; // no boat wake
    core.sim.gusts.clear();
    core.sim.gusts.add({
      x: 0, y: 40, delayS: 0, lifeS: 3, rampS: 0.5,
      forceGain: GUST_FORCE_GAIN, alongSigma: GUST_ALONG_SIGMA_M, crossSigma: GUST_CROSS_SIGMA_M,
    });
  });
  const birthY = 40;
  for (let t = 0; t < 30 * 8; t++) mute(() => core.tick({ dt: 1 / 30, held: [] })); // 8 s: life over, streak advected
  check('columns cleared after life', core.sim.gusts.columns.length === 0);
  const bm = core.bm, U = bm.speed;
  let bestY = birthY, best = -Infinity;
  for (let y = -20; y <= 50; y += 1) {
    const v = bm.get_field_velocity(0, y);
    const d = Math.hypot(v.x, v.y) - U / 4;
    if (d > best) { best = d; bestY = y; }
  }
  // Wind from +Y → flow −Y, so streak centre should be below birthY.
  check('after life, anomaly peak is downwind of birth',
    bestY < birthY - 5 && best > 0, `peakY ${bestY} birth ${birthY} Δ ${best.toExponential(2)}`);
}

check('demo layout exports two columns and a boat',
  GUST_DEMO.columns.length === 2 && Number.isFinite(GUST_DEMO.boat.y));

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all gusts checks passed');
