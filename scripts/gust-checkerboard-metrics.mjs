// Metrics for large-σ gust mottling: peak |Δu|, footprint std, high-freq RMS, inject n, force sum.
//   node --import ./test/register.mjs scripts/gust-checkerboard-metrics.mjs [before|after]
import '../test/dom-stub.mjs';
import fs from 'node:fs';
const { SimCore } = await import('../src/host.js');
const {
  injectEllipticalKernel, flowUnitFromWind,
  GUST_ALONG_SIGMA_M, GUST_CROSS_SIGMA_M,
} = await import('../src/gusts.js');

const mute = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
const DT = 1 / 30;
const label = process.argv[2] || 'before';

function footprintMetrics(bm, cx, cy, sa, sc) {
  const U = bm.speed;
  const step = 0.5;
  const half = 2 * Math.max(sa, sc);
  const vals = [];
  let peak = 0, sum = 0, sumAbs = 0, n = 0;
  for (let y = cy - half; y <= cy + half + 1e-9; y += step) {
    for (let x = cx - half; x <= cx + half + 1e-9; x += step) {
      const dx = x - cx, dy = y - cy;
      const r2 = (dx / sc) ** 2 + (dy / sa) ** 2;
      if (r2 > 4) continue; // 2σ ellipse
      const v = bm.get_field_velocity(x, y);
      const d = Math.hypot(v.x, v.y) - U / 4;
      vals.push({ x, y, d });
      peak = Math.max(peak, Math.abs(d));
      sum += d; sumAbs += Math.abs(d); n++;
    }
  }
  const mean = sum / n;
  let var_ = 0;
  for (const p of vals) var_ += (p.d - mean) ** 2;
  const std = Math.sqrt(var_ / n);
  const key = (x, y) => `${(+x).toFixed(2)},${(+y).toFixed(2)}`;
  const map = new Map(vals.map((p) => [key(p.x, p.y), p.d]));
  let hf = 0, hn = 0;
  for (const p of vals) {
    let s = 0, c = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const v = map.get(key(p.x + i * step, p.y + j * step));
      if (v !== undefined) { s += v; c++; }
    }
    const local = s / c;
    hf += (p.d - local) ** 2; hn++;
  }
  const hfRms = Math.sqrt(hf / hn);
  // Checkerboard at the *old* large-σ inject step (minσ/2), for mottling score
  const injStep = Math.max(1 / bm.resolution, Math.min(sa, sc) / 2);
  let csum = 0, cn = 0, cnum = 0, cden = 0;
  const halfN = Math.floor(half / injStep);
  for (let j = -halfN; j <= halfN; j++) {
    for (let i = -halfN; i <= halfN; i++) {
      const v = bm.get_field_velocity(cx + i * injStep, cy + j * injStep);
      const d = Math.hypot(v.x, v.y) - U / 4;
      csum += d; cn++;
    }
  }
  const cmean = csum / cn;
  for (let j = -halfN; j <= halfN; j++) {
    for (let i = -halfN; i <= halfN; i++) {
      const v = bm.get_field_velocity(cx + i * injStep, cy + j * injStep);
      const d = Math.hypot(v.x, v.y) - U / 4 - cmean;
      const ch = ((i + j) % 2 === 0) ? 1 : -1;
      cnum += d * ch; cden += d * d;
    }
  }
  const corrInj = cden > 0 ? cnum / Math.sqrt(cden * cn) : 0;
  return { peakAbsDu: peak, meanDu: mean, meanAbsDu: sumAbs / n, stdDu: std, hfRms, corrInj, n, injStep };
}

function forceSum(alongSig, crossSig, resolution = 0.5) {
  let total = 0, n = 0;
  const along = flowUnitFromWind(90);
  const cross = { x: -along.y, y: along.x };
  const bm = {
    resolution,
    velScale: 2,
    apply_energy(wx, wy, fx, fy) { total += Math.hypot(fx, fy); n++; },
  };
  injectEllipticalKernel(bm, 0, 0, 1, 0, along, cross, alongSig, crossSig);
  const cell = 1 / resolution;
  return { total, n, cell };
}

const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
mute(() => core.command({ type: 'restart', scenario: 23 }));
mute(() => core.command({ type: 'cellBudget', tune: true, target: 50000 }));
mute(() => core.command({ type: 'refine', maxLevel: 2, boatRefineRadius: 3 }));
mute(() => { core.sim.players.length = 0; });
for (let t = 0; t < 90; t++) mute(() => core.tick({ dt: DT, held: [] }));

const cols = core.sim.gusts.columns;
const m0 = footprintMetrics(core.bm, cols[0].x, cols[0].y, cols[0].alongSigma, cols[0].crossSigma);
const out = {
  label,
  t_s: core.sim.rulesTime,
  inject0: cols[0].lastInjectCount,
  env0: cols[0].lastEnvelope,
  footprint0: m0,
  forceSum: {
    thin2f: forceSum(GUST_ALONG_SIGMA_M, GUST_CROSS_SIGMA_M),
    large2f: forceSum(15, 15),
    thin1f: forceSum(GUST_ALONG_SIGMA_M, GUST_CROSS_SIGMA_M, 1),
    sigma10_2f: forceSum(10, 10),
  },
};
console.log(JSON.stringify(out, null, 2));
fs.mkdirSync('out/gust-checkerboard-metrics', { recursive: true });
fs.writeFileSync(`out/gust-checkerboard-metrics/${label}.json`, JSON.stringify(out, null, 2));
