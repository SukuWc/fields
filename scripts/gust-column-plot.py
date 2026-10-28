#!/usr/bin/env python3
"""Plot gust-column Δ|u| grids from scripts/gust-column-shots.mjs."""
import csv, json, sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

out = Path(sys.argv[1] if len(sys.argv) > 1 else "out/gust-column")
summary = json.loads((out / "summary.json").read_text())

def load(name):
    xs, ys, du = [], [], []
    with (out / name).open() as f:
        r = csv.DictReader(f)
        for row in r:
            xs.append(float(row["x"]))
            ys.append(float(row["y"]))
            du.append(float(row["du"]))
    xs = np.array(xs); ys = np.array(ys); du = np.array(du)
    ux = np.unique(xs); uy = np.unique(ys)
    grid = np.full((len(uy), len(ux)), np.nan)
    ix = {v: i for i, v in enumerate(ux)}
    iy = {v: i for i, v in enumerate(uy)}
    for x, y, v in zip(xs, ys, du):
        grid[iy[y], ix[x]] = v
    return ux, uy, grid

def plot(csv_name, png_name, title, col=None, boat=None):
    ux, uy, grid = load(csv_name)
    # Symmetric colour around 0 so free stream is mid; gusts are warm.
    vmax = np.nanpercentile(np.abs(grid), 99.5)
    vmax = max(vmax, 1e-6)
    fig, ax = plt.subplots(figsize=(7.2, 8.5), dpi=120)
    im = ax.pcolormesh(ux, uy, grid, shading="auto", cmap="coolwarm",
                       vmin=-vmax, vmax=vmax)
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04, label="Δ|u| (field units)")
    ax.set_aspect("equal")
    ax.set_xlabel("x (m, cross-wind)")
    ax.set_ylabel("y (m, along-wind; wind from +Y → flow −Y)")
    ax.set_title(title)
    # Ellipse outline at 1σ (cross long, along thin) for the active column.
    if col:
        along = np.array([summary["flow"]["x"], summary["flow"]["y"]])
        cross = np.array([-along[1], along[0]])
        sa = summary["ellipse"]["along_sigma_m"]
        sc = summary["ellipse"]["cross_sigma_m"]
        th = np.linspace(0, 2 * np.pi, 120)
        pts = np.column_stack([
            col["x"] + sc * np.cos(th) * cross[0] + sa * np.sin(th) * along[0],
            col["y"] + sc * np.cos(th) * cross[1] + sa * np.sin(th) * along[1],
        ])
        ax.plot(pts[:, 0], pts[:, 1], "k--", lw=1.2, label="1σ ellipse")
        ax.plot(col["x"], col["y"], "ko", ms=4)
    if boat:
        ax.plot(boat["x"], boat["y"], "g^", ms=8, label="boat")
    ax.legend(loc="upper right", fontsize=8)
    fig.tight_layout()
    fig.savefig(out / png_name)
    plt.close(fig)
    print(f"wrote {out / png_name}")

inj = summary["inject"]
plot("frame-inject.csv", "inject.png",
     f"Scenario 22 — elliptical injection  t={inj['t_s']:.1f}s",
     col=inj.get("col"), boat=inj.get("boat"))
adv = summary["advected"]
# Prefer the first remaining column, else none.
col_b = adv["cols"][0] if adv.get("cols") else None
plot("frame-advected.csv", "advected.png",
     f"Scenario 22 — after advection  t={adv['t_s']:.1f}s",
     col=col_b, boat=adv.get("boat"))
