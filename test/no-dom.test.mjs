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
  'boundary.js', 'boundary-scenario.js', 'scenarios.js', 'sim.js', 'map-size.js',
  'present.js', 'host.js', 'fieldPainter.js', 'info.js', 'settings-registry.js',
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
  const bm = new Boltzmann(32, 32, 1, 90, 4.5);
  const map = new Map(32, 32, 90, 4.5, bm, new FluidWind(bm), new ConstantWind(90, 4.5));
  map.physics_model_init();
  const boat = new Boat(map, 0, 0, 5 * Math.PI / 4);
  for (let i = 0; i < 30; i++) { boat.physics_model_step(); map.world.step(1 / 30); bm.advance_frame(); }
  const t = boat.telemetry;
  check('boat step runs and exposes telemetry data', !!t && Number.isFinite(t.bs) && Number.isFinite(t.twa) && 'autopilot' in t,
    t ? `bs=${t.bs.toFixed(2)} twa=${t.twa.toFixed(0)}` : 'no telemetry');
  check('engine has no painter and paints nothing', bm.painter === undefined);
} catch (e) { check('headless sim run', false, String(e && e.stack || e)); }

// Phase 3: the whole simulation (Sim, sim.js) runs headless. Each scenario
// loads and steps; a few rules outcomes are checked; snapshots are plain data;
// two Sims keep separate rules state.
try {
  const { Boltzmann } = mods['boltzmann.js'];
  const { Map } = mods['map.js'];
  const { FluidWind, ConstantWind } = mods['wind.js'];
  const { Sim } = mods['sim.js'];
  const makeSim = (w = 100, h = 200) => {
    const bm = new Boltzmann(w, h, 0.25, 90, 4.5);
    bm.setResolution(0.25, 1); // the app default, simRes 4f
    bm.setWindSpeed(4.5);
    const map = new Map(w, h, 90, 4.5, bm, new FluidWind(bm), new ConstantWind(90, 4.5));
    map.physics_model_init();
    return new Sim(map);
  };
  const run = (sim, ticks, held) => {
    for (let t = 0; t < ticks; t++) { sim.map.world.step(1 / 30); sim.step(1 / 30, held); }
  };
  const quiet = console.log;
  const sim = makeSim();
  const events = [];
  sim.on((e) => events.push(e.type));
  // Every scenario loads and runs 30 ticks (1 s); scenario 19 is dev mode only.
  const bad = [];
  for (let n = 0; n <= 19; n++) {
    if (!sim.scenarios[n]) continue;
    sim.command({ type: 'devMode', on: n === 19 });
    try {
      console.log = () => {};
      sim.command({ type: 'restart', scenario: n });
      run(sim, 30);
    } catch (e) { bad.push(n + ': ' + e.message); } finally { console.log = quiet; }
    const snap = sim.snapshot();
    if (!snap.boats.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y))) bad.push(n + ': non-finite boat');
  }
  sim.command({ type: 'devMode', on: false });
  check('every scenario loads and steps headless (1 s each)', bad.length === 0, bad.join('; '));
  check('scenario scripts bind controls and send view hints as events', events.includes('bindControls') && events.includes('view') && events.includes('cleared'));

  const outcome = (n, seconds, pred) => {
    const s = makeSim();
    console.log = () => {};
    try { s.command({ type: 'restart', scenario: n }); run(s, seconds * 30); } finally { console.log = quiet; }
    return { sim: s, ok: pred(s.snapshot()) };
  };
  const s9 = outcome(9, 3, (sn) => sn.boats[1] && sn.boats[1].pendingPenalties === 1);
  check('scenario 9 (contact during Rule 15): boat 1 penalised by 3 s', s9.ok);
  const s11 = outcome(11, 4, (sn) => sn.boats[0] && sn.boats[0].pendingPenalties >= 1);
  check('scenario 11 (mark touch): boat 0 penalised (Rule 31) by 4 s', s11.ok);
  // Two Sims do not share rules state: s9's penalties are not in s11's.
  s9.sim.activate();
  const p9 = s9.sim.snapshot().boats.map((b) => b.pendingPenalties).join();
  const p11 = s11.sim.snapshot().boats.map((b) => b.pendingPenalties).join();
  check('two Sims keep separate rules state', p9 === '0,1' && p11 === '1', `s9 ${p9} / s11 ${p11}`);
  const snap = s9.sim.snapshot();
  const round = JSON.parse(JSON.stringify(snap));
  check('snapshot is plain JSON data', JSON.stringify(round) === JSON.stringify(snap) && snap.boats.length === 2 && snap.boats[0].telemetry && snap.boats[0].rules, `tick ${snap.tick}`);
  // Commands: holding helm left turns boat 0 (autopilot off) more than no input.
  const helm = (held) => {
    const s = makeSim();
    console.log = () => {};
    try { s.command({ type: 'restart', scenario: 0 }); run(s, 30); s.command({ type: 'autopilot', boat: 0 }); run(s, 30, held); } finally { console.log = quiet; }
    return s.snapshot().boats[0].heading;
  };
  const h0 = helm(null), hl = helm([{ type: 'helm', boat: 0, dir: -1 }]);
  check('held helm command steers boat 0', Math.abs(hl - h0) > 0.05, `heading Δ ${(hl - h0).toFixed(3)} rad`);
} catch (e) { check('headless Sim run', false, String(e && e.stack || e)); }

if (failed) { console.log(failed + ' check(s) failed'); process.exit(1); }
