#!/usr/bin/env python3
"""Plot scripts/truewind-accuracy.mjs output: path, error vs time, error vs TWA.
Usage: python3 scripts/truewind-plot.py <outDir> [mode=2f]  (needs matplotlib)"""
import csv, sys, os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
out = sys.argv[1] if len(sys.argv) > 1 else 'out/truewind'
mode = sys.argv[2] if len(sys.argv) > 2 else '2f'
rows = list(csv.DictReader(open(os.path.join(out, f'truewind-{mode}.csv'))))
c = lambda k: [float(r[k]) for r in rows]
t = [v / 30 for v in c('tick')]
fig, ax = plt.subplots(2, 2, figsize=(13, 9))
a = ax[0][0]; sc = a.scatter(c('x'), c('y'), c=t, s=6, cmap='viridis'); a.set_aspect('equal'); a.set_title('Boat path (colour = time s); wind from +Y'); fig.colorbar(sc, ax=a); a.set_xlabel('x m'); a.set_ylabel('y m')
a = ax[0][1]; a.plot(t, c('eSmDir'), label='dir error, smoothed (autopilot)'); a.plot(t, c('eRawDir'), label='dir error, raw (HUD)', alpha=.6); a.set_ylabel('°'); a.set_xlabel('time s'); a.grid(alpha=.3)
a2 = a.twinx(); a2.plot(t, c('bs'), 'k:', label='boat speed', alpha=.5); a2.set_ylabel('boat speed m/s'); a.legend(loc='upper left', fontsize=8); a.set_title('Direction error vs time')
a = ax[1][0]; a.plot(t, c('eSmTws'), label='TWS error, smoothed'); a.plot(t, c('eRawTws'), label='TWS error, raw', alpha=.6); a.set_ylabel('m/s'); a.set_xlabel('time s'); a.grid(alpha=.3); a.legend(fontsize=8); a.set_title('Speed error vs time')
a = ax[1][1]; a.scatter(c('trueTwa'), c('eSmDir'), s=6, label='dir error ° (smoothed)'); a.scatter(c('trueTwa'), [10 * v for v in c('eSmTws')], s=6, label='TWS error ×10 m/s (smoothed)'); a.set_xlabel('true TWA ° (free stream vs hull)'); a.grid(alpha=.3); a.legend(fontsize=8); a.set_title('Error vs TWA')
fig.suptitle(f'True-wind accuracy baseline, scenario 20 ({mode})'); fig.tight_layout()
fig.savefig(os.path.join(out, f'truewind-{mode}.png'), dpi=110)
print(os.path.join(out, f'truewind-{mode}.png'))
