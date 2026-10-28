// Headless probe for scenario 23 large-σ gust checkerboard.
//   node --import ./test/register.mjs scripts/gust-checkerboard-probe.mjs
import '../test/dom-stub.mjs';
import fs from 'node:fs';
const { SimCore } = await import('../src/host.js');
const mute = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };

const outDir = process.argv[2] || 'out/gust-checkerboard';
fs.mkdirSync(outDir, { recursive: true });

const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
mute(() => core.command({ type: 'restart', scenario: 23 }));
mute(() => core.command({ type: 'cellBudget', tune: true, target: 50000 }));
mute(() => core.command({ type: 'refine', maxLevel: 2, boatRefineRadius: 3 }));

const DT = 1 / 30;
for (let t = 0; t < 90; t++) mute(() => core.tick({ dt: DT, held: [] })); // 3s

const bm = core.bm;
const cols = core.sim.gusts.columns;
console.log('t=', core.sim.rulesTime.toFixed(2), 'cols=', cols.length);
console.log('maxLevel', bm.maxLevel, 'amrMode', bm.amrMode, 'res', bm.resolution, 'cell', 1 / bm.resolution);
for (const c of cols) {
  console.log(' col', { x: +c.x.toFixed(1), y: +c.y.toFixed(1), env: +c.lastEnvelope?.toFixed(2), n: c.lastInjectCount, sa: c.alongSigma, sc: c.crossSigma });
}

const c0 = cols[0];
const cx = c0.x, cy = c0.y;
const cell = 1 / bm.resolution;
const U = bm.speed;
const vals = [];
for (let j = -8; j <= 8; j++) {
  const row = [];
  for (let i = -8; i <= 8; i++) {
    const v = bm.get_field_velocity(cx + i * cell, cy + j * cell);
    row.push(Math.hypot(v.x, v.y) - U / 4);
  }
  vals.push(row);
}
let sum = 0, n = 0, num = 0, den = 0;
for (const row of vals) for (const d of row) { sum += d; n++; }
const mean = sum / n;
for (let j = 0; j < vals.length; j++) {
  for (let i = 0; i < vals[j].length; i++) {
    const d = vals[j][i] - mean;
    const ch = ((i + j) % 2 === 0) ? 1 : -1;
    num += d * ch;
    den += d * d;
  }
}
const score = den > 0 ? num / Math.sqrt(den * n) : 0;
console.log('mean du', mean.toFixed(6), 'checkerboard corr (root cells)', score.toFixed(4));
for (let j = 0; j < vals.length; j++) {
  let s = '';
  for (let i = 0; i < vals[j].length; i++) {
    const d = vals[j][i] - mean;
    s += d > Math.abs(mean) * 0.05 + 1e-6 ? '#' : d < -(Math.abs(mean) * 0.05 + 1e-6) ? '.' : ' ';
  }
  console.log(s);
}

// Also sample at 1 m (half root) — checkerboard often shows on the stamp/texels
const vals1 = [];
for (let j = -20; j <= 20; j++) {
  const row = [];
  for (let i = -20; i <= 20; i++) {
    const v = bm.get_field_velocity(cx + i, cy + j);
    row.push(Math.hypot(v.x, v.y) - U / 4);
  }
  vals1.push(row);
}
let sum1 = 0, n1 = 0, num1 = 0, den1 = 0;
for (const row of vals1) for (const d of row) { sum1 += d; n1++; }
const mean1 = sum1 / n1;
for (let j = 0; j < vals1.length; j++) {
  for (let i = 0; i < vals1[j].length; i++) {
    const d = vals1[j][i] - mean1;
    const ch = ((i + j) % 2 === 0) ? 1 : -1;
    num1 += d * ch;
    den1 += d * d;
  }
}
const score1 = den1 > 0 ? num1 / Math.sqrt(den1 * n1) : 0;
console.log('1m sample checkerboard corr', score1.toFixed(4));

const lines = ['x,y,du'];
for (let j = -50; j <= 70; j++) {
  for (let i = -45; i <= 45; i++) {
    const v = bm.get_field_velocity(i, j);
    lines.push(`${i},${j},${Math.hypot(v.x, v.y) - U / 4}`);
  }
}
fs.writeFileSync(`${outDir}/frame.csv`, lines.join('\n'));
fs.writeFileSync(`${outDir}/summary.json`, JSON.stringify({
  t_s: core.sim.rulesTime, cell, maxLevel: bm.maxLevel, amrMode: bm.amrMode,
  checkerboard_corr_root: score, checkerboard_corr_1m: score1, mean_du: mean,
  cols: cols.map((c) => ({ x: c.x, y: c.y, env: c.lastEnvelope, n: c.lastInjectCount, sa: c.alongSigma, sc: c.crossSigma })),
}, null, 2));
console.log('wrote', outDir);
