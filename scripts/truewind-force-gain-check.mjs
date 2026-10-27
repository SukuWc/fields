// Scenario 20 accuracy at several sailWakeGain values (2f), with own-force
// correction on (and k=0 ring-only at gain 16 for a baseline).
//   node --import ./test/register.mjs scripts/truewind-force-gain-check.mjs
import '../test/dom-stub.mjs';
const { setTrueWindOwnForceK, getTrueWindOwnForceK, boatTrueWind } = await import('../src/wind.js');
const { stats } = await import('./truewind-accuracy.mjs');
const { SimCore } = await import('../src/host.js');
const { WIND_UNIT_MPS } = await import('../src/wind.js');
const { TRUEWIND_SWEEP_STEP_DEG } = await import('../src/scenarios.js');

const wrap = (d) => ((d + 540) % 360) - 180;
const TICKS = 30 + 30 * (360 / TRUEWIND_SWEEP_STEP_DEG) + 120;

function sweep(gain, { kOn = true } = {}) {
  const prevK = getTrueWindOwnForceK();
  if (!kOn) setTrueWindOwnForceK(0);
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
      gain: map.sailWakeGain,
    });
  }
  setTrueWindOwnForceK(prevK);
  const R = rows.filter((r) => r.tick >= 30);
  for (const r of R) {
    r.eSmDir = wrap(r.smDir - r.trueDir);
    r.eSmTws = r.smTws - r.trueTws;
  }
  const d = stats(R.map((r) => r.eSmDir));
  const s = stats(R.map((r) => r.eSmTws));
  return { gain, kOn, n: R.length, mapGain: rows[rows.length - 1]?.gain, dirRMS: d.rms, dirBias: d.mean, twsRMS: s.rms, twsBias: s.mean };
}

const f = (x, d = 3) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
console.log('gain\tkOn\tmapGain\tdirRMS\tdirBias\ttwsRMS\ttwsBias');
const rows = [];
rows.push(sweep(16, { kOn: false })); // ring-only baseline at default wake
for (const g of [10, 16, 25]) rows.push(sweep(g, { kOn: true }));
for (const r of rows) {
  console.log([r.gain, r.kOn ? 'on' : 'off', r.mapGain, f(r.dirRMS), f(r.dirBias), f(r.twsRMS), f(r.twsBias)].join('\t'));
}
