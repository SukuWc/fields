// Capture scenario 23 (and a no-boat twin) lattice fields for large-σ checkerboard.
//   node --import ./test/register.mjs scripts/gust-checkerboard-shots.mjs [outDir]
import '../test/dom-stub.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const { SimCore } = await import('../src/host.js');
const { GUST_CHECKERBOARD_DEMO } = await import('../src/gusts.js');

const outDir = process.argv[2] || 'out/gust-checkerboard';
fs.mkdirSync(outDir, { recursive: true });
const mute = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
const DT = 1 / 30;

function sampleGrid(bm, halfX = 45, y0 = -50, y1 = 70, step = 0.5) {
  const U = bm.speed;
  const xs = [], ys = [], du = [];
  for (let y = y1; y >= y0 - 1e-9; y -= step) {
    ys.push(+y.toFixed(4));
    const row = [];
    for (let x = -halfX; x <= halfX + 1e-9; x += step) {
      if (ys.length === 1) xs.push(+x.toFixed(4));
      const v = bm.get_field_velocity(x, y);
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

function run(label, { scenario, noBoat, forceGain, along, cross, ticks }) {
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  if (scenario != null) {
    mute(() => core.command({ type: 'restart', scenario }));
  } else {
    mute(() => core.command({ type: 'restart', scenario: 0 }));
    mute(() => {
      core.sim.players.length = 0;
      core.sim.gusts.clear();
      const L = GUST_CHECKERBOARD_DEMO;
      core.command({ type: 'refine', maxLevel: 2, boatRefineRadius: 3 });
      core.command({ type: 'amrMode', mode: 'auto' });
      for (const c of L.columns) {
        core.sim.gusts.add({
          ...c,
          forceGain: forceGain ?? c.forceGain,
          alongSigma: along ?? c.alongSigma,
          crossSigma: cross ?? c.crossSigma,
          delayS: 0,
        });
      }
    });
  }
  mute(() => core.command({ type: 'refine', maxLevel: 2, boatRefineRadius: 3 }));
  mute(() => core.command({ type: 'cellBudget', tune: true, target: 50000 }));
  if (noBoat) mute(() => { core.sim.players.length = 0; });
  for (let t = 0; t < ticks; t++) mute(() => core.tick({ dt: DT, held: [] }));
  const bm = core.bm;
  const grid = sampleGrid(bm);
  writeCsv(`${label}.csv`, grid);
  const cols = core.sim.gusts.columns.map((c) => ({
    x: c.x, y: c.y, env: c.lastEnvelope, n: c.lastInjectCount,
    sa: c.alongSigma, sc: c.crossSigma, gain: c.forceGain,
  }));
  // Checkerboard score on 2 m lattice around first column
  const c0 = cols[0];
  let sum = 0, n = 0, num = 0, den = 0;
  const cell = 1 / bm.resolution;
  for (let j = -10; j <= 10; j++) {
    for (let i = -10; i <= 10; i++) {
      const v = bm.get_field_velocity(c0.x + i * cell, c0.y + j * cell);
      const d = Math.hypot(v.x, v.y) - bm.speed / 4;
      sum += d; n++;
    }
  }
  const mean = sum / n;
  for (let j = -10; j <= 10; j++) {
    for (let i = -10; i <= 10; i++) {
      const v = bm.get_field_velocity(c0.x + i * cell, c0.y + j * cell);
      const d = Math.hypot(v.x, v.y) - bm.speed / 4 - mean;
      const ch = ((i + j) % 2 === 0) ? 1 : -1;
      num += d * ch; den += d * d;
    }
  }
  const corr = den > 0 ? num / Math.sqrt(den * n) : 0;
  console.log(label, 't=', core.sim.rulesTime.toFixed(2), 'corr=', corr.toFixed(4), 'cols', cols.length, 'inject0', cols[0]?.n);
  return { label, t_s: core.sim.rulesTime, corr, cols, cell, maxLevel: bm.maxLevel };
}

const metas = [];
metas.push(run('sc23-t3', { scenario: 23, ticks: 90 }));
metas.push(run('sc23-noboat-t3', { scenario: 23, noBoat: true, ticks: 90 }));
// Stronger gain, same large σ — artifact visibility (still no math fix)
metas.push(run('large-strong-noboat-t2', {
  scenario: null, noBoat: true, forceGain: 0.003, along: 15, cross: 15, ticks: 60,
}));
// Europe-1 exact mean σ=10, gain 0.0005, no boat
metas.push(run('europe1-sigma10-noboat-t3', {
  scenario: null, noBoat: true, forceGain: 0.0005, along: 10, cross: 10, ticks: 90,
}));

fs.writeFileSync(path.join(outDir, 'shots-summary.json'), JSON.stringify({ metas, demo: GUST_CHECKERBOARD_DEMO }, null, 2));

const pyBin = process.env.GUST_PLOT_PYTHON || (fs.existsSync('/workspace/.venv-plot/bin/python') ? '/workspace/.venv-plot/bin/python' : 'python3');
const py = spawnSync(pyBin, ['-c', `
import csv, json, sys
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

out = Path(${JSON.stringify(outDir)})
summary = json.loads((out / "shots-summary.json").read_text())

def load(name):
    xs, ys, du = [], [], []
    with (out / name).open() as f:
        for row in csv.DictReader(f):
            xs.append(float(row["x"])); ys.append(float(row["y"])); du.append(float(row["du"]))
    xs, ys, du = map(np.array, (xs, ys, du))
    ux, uy = np.unique(xs), np.unique(ys)
    grid = np.full((len(uy), len(ux)), np.nan)
    ix = {v:i for i,v in enumerate(ux)}; iy = {v:i for i,v in enumerate(uy)}
    for x,y,v in zip(xs,ys,du):
        grid[iy[y], ix[x]] = v
    return ux, uy, grid

# Main repro figure: sc23-noboat at 0.5 m with nearest-style imshow (like app NearestFilter)
for meta in summary["metas"]:
    label = meta["label"]
    ux, uy, grid = load(label + ".csv")
    vmax = max(np.nanpercentile(np.abs(grid), 99.5), 1e-6)
    fig, axes = plt.subplots(1, 2, figsize=(11, 6.5), dpi=140)
    ax = axes[0]
    # pcolormesh
    im = ax.pcolormesh(ux, uy, grid, shading="auto", cmap="coolwarm", vmin=-vmax, vmax=vmax)
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04, label="Δ|u|")
    ax.set_aspect("equal"); ax.set_title(f"{label}  t={meta['t_s']:.1f}s  corr={meta['corr']:.3f}")
    for c in meta["cols"]:
        th = np.linspace(0, 2*np.pi, 80)
        ax.plot(c["x"] + c["sc"]*np.cos(th), c["y"] + c["sa"]*np.sin(th), "k--", lw=0.7)
        ax.plot(c["x"], c["y"], "ko", ms=3)
    # Zoom + nearest-neighbor display (mimics THREE.NearestFilter field tex)
    ax = axes[1]
    c0 = meta["cols"][0]
    # crop
    mx = (ux >= c0["x"]-22) & (ux <= c0["x"]+22)
    my = (uy >= c0["y"]-22) & (uy <= c0["y"]+22)
    g2 = grid[np.ix_(my, mx)]
    u2, v2 = ux[mx], uy[my]
    vmax2 = max(np.nanpercentile(np.abs(g2), 99), 1e-6)
    # imshow nearest
    extent = [u2.min()-0.25, u2.max()+0.25, v2.min()-0.25, v2.max()+0.25]
    im2 = ax.imshow(g2, origin="lower", extent=extent, cmap="coolwarm",
                    vmin=-vmax2, vmax=vmax2, interpolation="nearest", aspect="equal")
    fig.colorbar(im2, ax=ax, fraction=0.046, pad=0.04)
    step = meta["cell"]  # inject samples every root cell
    ax.set_title(f"nearest zoom; inject step≈{step:.1f} m")
    fig.tight_layout()
    fig.savefig(out / f"{label}.png")
    plt.close(fig)
    print("wrote", out / f"{label}.png")

# Canonical screenshot path
import shutil
src = out / "sc23-noboat-t3.png"
# Prefer strong artifact if corr much higher
best = max(summary["metas"], key=lambda m: abs(m["corr"]))
strong = out / (best["label"] + ".png")
shutil.copy(src if src.exists() else strong, "/workspace/gust-checkerboard-repro.png")
# Also copy strongest artifact as secondary
shutil.copy(strong, "/workspace/gust-checkerboard-repro-strong.png")
print("best corr", best["label"], best["corr"])
print("copied /workspace/gust-checkerboard-repro.png and -strong.png")
`], { encoding: 'utf8', cwd: process.cwd() });
console.log(py.stdout || '');
if (py.status !== 0) { console.error(py.stderr || ''); process.exit(py.status || 1); }
