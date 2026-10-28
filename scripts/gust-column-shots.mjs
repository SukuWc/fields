// Headless capture for scenario 22 (moving-column gusts). Samples the lattice
// speed anomaly on 2f at two moments: (a) while the first elliptical column
// is injecting, (b) later after advection. Writes CSV grids + a small summary,
// then calls scripts/gust-column-plot.py for PNGs.
//   node --import ./test/register.mjs scripts/gust-column-shots.mjs [outDir]
import '../test/dom-stub.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const { SimCore } = await import('../src/host.js');
const { flowUnitFromWind, GUST_DEMO, GUST_ALONG_SIGMA_M, GUST_CROSS_SIGMA_M, GUST_ASPECT, GUST_FORCE_GAIN, GUST_LIFE_S } =
  await import('../src/gusts.js');

const outDir = process.argv[2] || 'out/gust-column';
fs.mkdirSync(outDir, { recursive: true });

const mute = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };

const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
mute(() => core.command({ type: 'restart', scenario: 22 }));

function sampleGrid(halfX = 40, y0 = -40, y1 = 60, step = 1) {
  const bm = core.bm;
  const U = bm.speed;
  const xs = [], ys = [], du = [];
  for (let y = y1; y >= y0; y -= step) {
    ys.push(y);
    const row = [];
    for (let x = -halfX; x <= halfX; x += step) {
      if (ys.length === 1) xs.push(x);
      const v = bm.get_field_velocity(x, y);
      // Field |u| minus freestream |U|/4 (get_field_velocity divides by 4).
      row.push(Math.hypot(v.x, v.y) - U / 4);
    }
    du.push(row);
  }
  return { xs, ys, du, U };
}

function writeCsv(name, grid) {
  const lines = ['x,y,du'];
  for (let j = 0; j < grid.ys.length; j++) {
    for (let i = 0; i < grid.xs.length; i++) {
      lines.push(`${grid.xs[i]},${grid.ys[j]},${grid.du[j][i]}`);
    }
  }
  fs.writeFileSync(path.join(outDir, name), lines.join('\n'));
}

// (a) ~2 s: first column well into its hold, still near birth latitude.
for (let t = 0; t < 60; t++) mute(() => core.tick({ dt: 1 / 30, held: [] }));
const colA = core.sim.gusts.columns[0];
const gridA = sampleGrid();
writeCsv('frame-inject.csv', gridA);
const metaA = {
  label: 'inject',
  t_s: core.sim.rulesTime,
  col: colA ? { x: colA.x, y: colA.y, env: colA.lastEnvelope, n: colA.lastInjectCount } : null,
  boat: core.sim.players[0] ? { x: core.sim.players[0].x, y: core.sim.players[0].y } : null,
};

// (b) ~9 s: first column finished / finishing; streak advected downwind.
for (let t = 0; t < 210; t++) mute(() => core.tick({ dt: 1 / 30, held: [] }));
const cols = core.sim.gusts.columns;
const gridB = sampleGrid();
writeCsv('frame-advected.csv', gridB);
const metaB = {
  label: 'advected',
  t_s: core.sim.rulesTime,
  cols: cols.map((c) => ({ x: c.x, y: c.y, env: c.lastEnvelope, age: c.ageS })),
  boat: core.sim.players[0] ? { x: core.sim.players[0].x, y: core.sim.players[0].y } : null,
};

const summary = {
  simRes: '2f',
  wind_from_deg: 90,
  wind_mps: GUST_DEMO.windMps,
  ellipse: { along_sigma_m: GUST_ALONG_SIGMA_M, cross_sigma_m: GUST_CROSS_SIGMA_M, aspect: GUST_ASPECT },
  force_gain: GUST_FORCE_GAIN,
  life_s: GUST_LIFE_S,
  flow: flowUnitFromWind(90),
  inject: metaA,
  advected: metaB,
};
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(outDir, 'summary.md'), [
  '# Moving-column gusts (scenario 22)',
  '',
  `- simRes **2f**, wind **${GUST_DEMO.windMps} m/s** from +Y (flow −Y)`,
  `- ellipse σ_along **${GUST_ALONG_SIGMA_M} m**, σ_cross **${GUST_CROSS_SIGMA_M} m** (aspect **${GUST_ASPECT}**), long axis ⊥ wind`,
  `- force gain **${GUST_FORCE_GAIN}** (pre lattice scale), life **${GUST_LIFE_S} s**`,
  `- inject frame t = ${metaA.t_s.toFixed(2)} s, column at (${metaA.col?.x.toFixed(1)}, ${metaA.col?.y.toFixed(1)}), env ${metaA.col?.env?.toFixed(2)}`,
  `- advected frame t = ${metaB.t_s.toFixed(2)} s`,
  '',
  'PNGs: `inject.png`, `advected.png` (Δ|u| field vs freestream).',
  '',
].join('\n'));

const pyBin = process.env.GUST_PLOT_PYTHON || (fs.existsSync('/workspace/.venv-plot/bin/python') ? '/workspace/.venv-plot/bin/python' : 'python3');
const py = spawnSync(pyBin, [path.join('scripts', 'gust-column-plot.py'), outDir], { encoding: 'utf8' });
if (py.status !== 0) {
  console.error(py.stdout || '', py.stderr || '');
  process.exit(py.status || 1);
}
console.log(py.stdout.trim());
console.log('wrote', outDir);
