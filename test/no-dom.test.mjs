// Every simulation module must load and run under plain Node with no DOM
// stub: no document, no window, no three.js. This is the boundary the
// sim/client split (phase 2) draws; a page read sneaking back into a sim
// module fails here.
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

check('no DOM globals in this process', typeof document === 'undefined' && typeof window === 'undefined');

const SIM_MODULES = [
  'boltzmann.js', 'domainTrack.js', 'wind.js', 'map.js', 'boat.js', 'mark.js',
  'course.js', 'start.js', 'finish.js', 'mark-touch.js', 'rules.js',
  'race-bot.js', 'leaderboard.js', 'utils.js', 'loop.js',
];
const mods = {};
for (const f of SIM_MODULES) {
  try { mods[f] = await import('../src/' + f); check('imports without DOM: ' + f, true); }
  catch (e) { check('imports without DOM: ' + f, false, String(e && e.message || e)); }
}

// A short headless run: map, lattice, one boat, a few frames, readout as data.
try {
  const { Boltzmann } = mods['boltzmann.js'];
  const { Map } = mods['map.js'];
  const { Boat } = mods['boat.js'];
  const { FluidWind, ConstantWind } = mods['wind.js'];
  const bm = new Boltzmann(32, 32, 1, 90, 15);
  const map = new Map(32, 32, 90, 15, bm, new FluidWind(bm), new ConstantWind(90, 15));
  map.physics_model_init();
  const boat = new Boat(map, 0, 0, 5 * Math.PI / 4);
  for (let i = 0; i < 30; i++) { boat.physics_model_step(); map.world.step(1 / 30); bm.advance_frame(); }
  const t = boat.telemetry;
  check('boat step runs and exposes telemetry data', !!t && Number.isFinite(t.bs) && Number.isFinite(t.twa) && 'autopilot' in t,
    t ? `bs=${t.bs.toFixed(2)} twa=${t.twa.toFixed(0)}` : 'no telemetry');
  check('engine has no painter and paints nothing', bm.painter === undefined);
} catch (e) { check('headless sim run', false, String(e && e.stack || e)); }

if (failed) { console.log(failed + ' check(s) failed'); process.exit(1); }
