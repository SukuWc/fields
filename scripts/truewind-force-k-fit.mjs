// Closed-loop fit of TRUE_WIND_OWN_FORCE_K on scenario 20 (2f).
//   node --import ./test/register.mjs scripts/truewind-force-k-fit.mjs [k1 k2 ...]
import '../test/dom-stub.mjs';
const { setTrueWindOwnForceK, getTrueWindOwnForceK } = await import('../src/wind.js');
const { runSweep, stats } = await import('./truewind-accuracy.mjs');

const wrap = (d) => ((d + 540) % 360) - 180;
const ks = process.argv.length > 2
  ? process.argv.slice(2).map(Number)
  : [0, 5e-5, 8e-5, 9e-5, 9.5e-5, 1e-4, 1.05e-4, 1.1e-4, 1.2e-4, 1.3e-4];
console.log('k\tdirRMS\tdirBias\ttwsRMS\ttwsBias\trawDirRMS');
let best = null;
for (const k of ks) {
  setTrueWindOwnForceK(k);
  const rows = runSweep('2f');
  const R = rows.filter((r) => r.tick >= 30);
  for (const r of R) {
    r.eSmDir = wrap(r.smDir - r.trueDir);
    r.eRawDir = wrap(r.rawDir - r.trueDir);
    r.eSmTws = r.smTws - r.trueTws;
  }
  const d = stats(R.map((r) => r.eSmDir));
  const dr = stats(R.map((r) => r.eRawDir));
  const s = stats(R.map((r) => r.eSmTws));
  const row = { k, dirRMS: d.rms, dirBias: d.mean, twsRMS: s.rms, twsBias: s.mean, rawDirRMS: dr.rms };
  console.log([k, d.rms.toFixed(3), d.mean.toFixed(3), s.rms.toFixed(3), s.mean.toFixed(3), dr.rms.toFixed(3)].join('\t'));
  if (!best || d.rms < best.dirRMS) best = row;
}
console.log('best', best);
setTrueWindOwnForceK(best.k);
console.log('left k at', getTrueWindOwnForceK());
