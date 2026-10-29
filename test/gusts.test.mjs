// Moving-column gusts (src/gusts.js): elliptical momentum injection, long
// axis ⊥ wind, advects with free stream, visible speed anomaly on 2f.
import './dom-stub.mjs';
const {
  GustField, GustColumn, gustEnvelope, flowUnitFromWind, injectEllipticalKernel,
  gustState, gustGuidesFromState, gustColumnAxes, GUST_OUTLINE_STEPS,
  GUST_ASPECT, GUST_ALONG_SIGMA_M, GUST_CROSS_SIGMA_M, GUST_DEMO, GUST_FORCE_GAIN,
  samplePoisson, sampleNormal, mulberry32, GUST_MAX_LIVE,
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
  // Run until first column is in its hold (delay 0.5 s + ramp 1.5 s → ~2 s).
  for (let t = 0; t < 60; t++) mute(() => core.tick({ dt: 1 / 30, held: [] }));
  const col = core.sim.gusts.columns[0];
  check('first column injecting after ~2 s', !!col && col.lastEnvelope > 0.9 && col.lastInjectCount > 20,
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

// 1σ outline: compact state + guide polyline (long axis = cross-wind).
{
  const map = { wind_direction: 90, wind_speed: 4.5 };
  const g = new GustField();
  g.add({ x: 3, y: 7, alongSigma: GUST_ALONG_SIGMA_M, crossSigma: GUST_CROSS_SIGMA_M, forceGain: 0 });
  const st = gustState(g, map);
  check('gustState: one row [x,y,σa,σc,ax,ay]',
    !!st && st.length === 1 && st[0].length === 6
    && near(st[0][0], 3, 1e-12) && near(st[0][1], 7, 1e-12)
    && near(st[0][2], GUST_ALONG_SIGMA_M, 1e-12) && near(st[0][3], GUST_CROSS_SIGMA_M, 1e-12)
    && near(st[0][4], 0, 1e-12) && near(st[0][5], -1, 1e-12));
  const axes = gustColumnAxes(g.columns[0], map);
  check('axes: cross is +X when flow is −Y', near(axes.cross.x, 1, 1e-12) && near(axes.cross.y, 0, 1e-12));
  const guides = gustGuidesFromState(st);
  check('gustGuidesFromState: closed 1σ polyline',
    guides.length === GUST_OUTLINE_STEPS && guides.every((s) => s.type === 'guide' && Number.isFinite(s.x1)));
  // Extremum along +cross should sit at centre + σ_cross (x = 3+12.5).
  let maxX = -Infinity, minX = Infinity, maxY = -Infinity, minY = Infinity;
  for (const s of guides) {
    maxX = Math.max(maxX, s.x1, s.x2); minX = Math.min(minX, s.x1, s.x2);
    maxY = Math.max(maxY, s.y1, s.y2); minY = Math.min(minY, s.y1, s.y2);
  }
  check('1σ extents: ±σ_cross in X, ±σ_along in Y (wind from +Y)',
    near(maxX, 3 + GUST_CROSS_SIGMA_M, 0.05) && near(minX, 3 - GUST_CROSS_SIGMA_M, 0.05)
    && near(maxY, 7 + GUST_ALONG_SIGMA_M, 0.05) && near(minY, 7 - GUST_ALONG_SIGMA_M, 0.05),
    `x[${minX.toFixed(2)},${maxX.toFixed(2)}] y[${minY.toFixed(2)},${maxY.toFixed(2)}]`);
  check('empty / dead → no state', gustState(new GustField(), map) === null);
  check('bad row → no guides', gustGuidesFromState([[0, 0]]).length === 0);
}

// Rate spawner: Poisson arrivals, sd=0 → constant knobs, disabled → no spawn.
{
  const rng = mulberry32(42);
  let sum = 0;
  const N = 20000;
  const lambda = 0.2;
  for (let i = 0; i < N; i++) sum += samplePoisson(lambda, rng);
  const mean = sum / N;
  check('samplePoisson mean ≈ λ', Math.abs(mean - lambda) < 0.02, `mean ${mean.toFixed(4)} λ ${lambda}`);

  const g = new GustField();
  g.setSpawner({
    enabled: true,
    ratePerMin: 60, // 1 per second → λ = dt at 30 Hz ≈ 0.0333 per tick
    forceGain: 0.003, forceGainSd: 0,
    alongSigmaM: 2.5, alongSigmaMSd: 0,
    crossSigmaM: 12.5, crossSigmaMSd: 0,
    lifeS: 10, lifeSSd: 0,
    dirDeg: 0, dirDegSd: 0,
    rampS: 1.5,
    seed: 7,
  }, { clearColumns: true });
  const map = { width: 100, height: 200, wind_direction: 90, wind_speed: 4.5, devMode: true };
  const dt = 1 / 30;
  const ticks = 30 * 60; // 60 s → expect ~60 spawns (rate 60/min); life 10 s so ~10 alive steady
  let spawned = 0;
  const before = 0;
  for (let t = 0; t < ticks; t++) {
    const n0 = g.columns.length;
    g.step(dt, null, map);
    // Count births roughly: columns can die; track via age near 0 after step is hard.
    // Instead compare total ever-added via a counter on add — wrap by counting length jumps.
    if (g.columns.length > n0) spawned += g.columns.length - n0;
  }
  check('rate spawner ~60/min over 60 s (45..75)', spawned >= 45 && spawned <= 75, `spawned ${spawned}`);
  check('live columns capped / reasonable', g.columns.length <= GUST_MAX_LIVE && g.columns.length > 0,
    `live ${g.columns.length}`);
  // sd=0 → every column has exact means
  const allExact = g.columns.every((c) =>
    c.forceGain === 0.003 && c.alongSigma === 2.5 && c.crossSigma === 12.5 && c.lifeS === 10);
  check('sd=0 → constant knobs on every column', allExact);

  g.setSpawner({ enabled: false, ratePerMin: 60, forceGain: 0.003, seed: 9 }, { clearColumns: true });
  for (let t = 0; t < 90; t++) g.step(dt, null, map);
  check('gusts=false → zero columns from spawner', g.columns.length === 0);

  // Deterministic: same seed → same first spawn position
  const a = new GustField();
  const b = new GustField();
  const opts = {
    enabled: true, ratePerMin: 600, forceGain: 0.003, forceGainSd: 0,
    alongSigmaM: 2.5, alongSigmaMSd: 0, crossSigmaM: 12.5, crossSigmaMSd: 0,
    lifeS: 10, lifeSSd: 0, dirDeg: 0, dirDegSd: 0, rampS: 1.5, seed: 12345,
  };
  a.setSpawner(opts, { clearColumns: true });
  b.setSpawner(opts, { clearColumns: true });
  // Force one spawn via high rate over a few ticks
  for (let t = 0; t < 5; t++) { a.step(dt, null, map); b.step(dt, null, map); }
  check('same seed → same spawn sequence',
    a.columns.length === b.columns.length
    && a.columns.length > 0
    && near(a.columns[0].x, b.columns[0].x, 1e-12)
    && near(a.columns[0].y, b.columns[0].y, 1e-12),
    `a ${a.columns[0] && a.columns[0].x} b ${b.columns[0] && b.columns[0].x}`);
}


// Large-σ inject step = root cell (no min(σ)/2 sparsify → checkerboard).
{
  const along = flowUnitFromWind(90);
  const cross = { x: -along.y, y: along.x };
  const hits = [];
  const resolution = 0.5; // 2f root cell = 2 m
  const bm = {
    resolution,
    velScale: 2,
    apply_energy(wx, wy, fx, fy) { hits.push({ wx, wy }); },
  };
  const sa = 15, sc = 15;
  const n = injectEllipticalKernel(bm, 0, 0, along.x, along.y, along, cross, sa, sc);
  const cell = 1 / resolution;
  // Sparse old step would be max(cell, minσ/2) = 7.5 → ~143 hits; dense ≈ cell → ~2k.
  check('large-σ kernel samples every root cell (≫ sparse minσ/2 lattice)',
    n > 500 && hits.length === n, `n ${n} (expect ≫ 143 sparse)`);
  // Spacing between distinct x/y samples ≤ cell (no min(σ)/2 gaps).
  const xs = [...new Set(hits.map((h) => +h.wx.toFixed(9)))].sort((a, b) => a - b);
  const ys = [...new Set(hits.map((h) => +h.wy.toFixed(9)))].sort((a, b) => a - b);
  let maxGapX = 0, maxGapY = 0;
  for (let i = 1; i < xs.length; i++) maxGapX = Math.max(maxGapX, xs[i] - xs[i - 1]);
  for (let i = 1; i < ys.length; i++) maxGapY = Math.max(maxGapY, ys[i] - ys[i - 1]);
  check('large-σ sample gaps ≤ root cell',
    maxGapX <= cell + 1e-9 && maxGapY <= cell + 1e-9,
    `maxGapX ${maxGapX} maxGapY ${maxGapY} cell ${cell}`);
}

// Regression: a column at the map edge used to send every off-map sample into
// depositBilinear's nearest-ring search (~350k _rootCanTake calls each),
// ramping the server tick to >1 s. Off-map samples are now dropped.
{
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  const bm = core.bm;
  const along = flowUnitFromWind(90);
  const cross = { x: -along.y, y: along.x };
  const orig = bm._rootCanTake.bind(bm);
  let calls = 0;
  bm._rootCanTake = (i, j) => { calls++; return orig(i, j); };
  const t0 = performance.now();
  const n = injectEllipticalKernel(bm, 50, 100, along.x * 0.0005, along.y * 0.0005, along, cross, 10, 10);
  const ms = performance.now() - t0;
  check('edge gust: off-map samples dropped, no ring search',
    n > 0 && calls <= 4 * n + 16, `n ${n} rootCanTake ${calls}`);
  check('edge gust: kernel cheap', ms < 200, `${ms.toFixed(1)} ms`);
  const far = injectEllipticalKernel(bm, 500, 500, 1, 0, along, cross, 10, 10);
  check('gust fully off map injects nothing', far === 0, `n ${far}`);
}

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all gusts checks passed');
