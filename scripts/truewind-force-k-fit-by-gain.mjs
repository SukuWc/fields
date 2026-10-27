// Fit absolute k_eff at given sailWakeGain values on scenario 20 / 2f.
// Compensates the live gain→k table so the swept value is absolute k_eff.
//   node --import ./test/register.mjs scripts/truewind-force-k-fit-by-gain.mjs
import '../test/dom-stub.mjs';
const {
  setTrueWindOwnForceK, getTrueWindOwnForceK, boatTrueWind,
  TRUE_WIND_OWN_FORCE_GAIN_REF, trueWindOwnForceKEff,
} = await import('../src/wind.js');
const { stats } = await import('./truewind-accuracy.mjs');
const { SimCore } = await import('../src/host.js');
const { WIND_UNIT_MPS } = await import('../src/wind.js');
const { TRUEWIND_SWEEP_STEP_DEG } = await import('../src/scenarios.js');

const wrap = (d) => ((d + 540) % 360) - 180;
const TICKS = 30 + 30 * (360 / TRUEWIND_SWEEP_STEP_DEG) + 120;

function sweep(gain, kAbs) {
  // kEff(gain) = kTable(gain) * (kBase / kTable(16)). Choose kBase so kEff == kAbs.
  const prev = getTrueWindOwnForceK();
  const kTable = trueWindOwnForceKEff(gain, 0.000105);
  const kBase = kTable > 0 ? kAbs * (0.000105 / kTable) : 0;
  setTrueWindOwnForceK(kBase);
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  const log = console.log; console.log = () => {};
  try {
    core.command({ type: 'restart', scenario: 20 });
    core.command({ type: 'sailWake', gain });
  } finally { console.log = log; }
  const map = core.map, rows = [];
  for (let t = 0; t < TICKS; t++) {
    console.log = () => {};
    try { core.tick({ dt: 1 / 30, held: [] }); } finally { console.log = log; }
    const b = core.sim.players[0];
    if (!b || t % 3) continue;
    const raw = boatTrueWind(b) || (map.get_wind(b.x, b.y));
    const tru = map.constantWind.getWind(b.x, b.y);
    rows.push({
      tick: t,
      smDir: b.wind_direction, smTws: b.wind_speed * WIND_UNIT_MPS,
      rawDir: raw.direction, rawTws: raw.speed,
      trueDir: tru.direction, trueTws: tru.speed,
    });
  }
  setTrueWindOwnForceK(prev);
  const R = rows.filter((r) => r.tick >= 30);
  for (const r of R) {
    r.eSmDir = wrap(r.smDir - r.trueDir);
    r.eSmTws = r.smTws - r.trueTws;
    r.eRawDir = wrap(r.rawDir - r.trueDir);
  }
  const d = stats(R.map((r) => r.eSmDir));
  const s = stats(R.map((r) => r.eSmTws));
  const dr = stats(R.map((r) => r.eRawDir));
  return { gain, kAbs, dirRMS: d.rms, dirBias: d.mean, twsRMS: s.rms, twsBias: s.mean, rawDirRMS: dr.rms };
}

const gains = (process.argv[2] ? process.argv[2].split(',').map(Number) : [10, 16, 25]);
const ks = process.argv.length > 3
  ? process.argv.slice(3).map(Number)
  : [0, 3e-5, 5e-5, 6e-5, 7e-5, 8e-5, 9e-5, 1e-4, 1.05e-4, 1.1e-4, 1.2e-4, 1.4e-4, 1.6e-4, 1.8e-4, 2e-4, 2.5e-4];

console.log('gain\tkAbs\tdirRMS\tdirBias\ttwsRMS\ttwsBias\trawDirRMS');
const bests = [];
for (const gain of gains) {
  let best = null;
  for (const kAbs of ks) {
    const row = sweep(gain, kAbs);
    console.log([gain, kAbs, row.dirRMS.toFixed(3), row.dirBias.toFixed(3), row.twsRMS.toFixed(3), row.twsBias.toFixed(3), row.rawDirRMS.toFixed(3)].join('\t'));
    if (!best || row.dirRMS < best.dirRMS) best = row;
  }
  bests.push(best);
  console.log('best@' + gain, best);
}
console.log('SUMMARY');
for (const b of bests) console.log(JSON.stringify(b));
