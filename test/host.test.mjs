// SimHost (host.js): LocalHost runs the same simulation as a bare Sim, and
// everything it hands the client is plain data (structured-cloneable, no
// engine objects), so the same client can sit on a worker or socket host.
// Runs without the DOM stub.
import { LocalHost, SimCore } from '../src/host.js';
import { buildScene } from '../src/scene-build.js';
import { sceneDiff } from './scene-diff.mjs';
import { Boltzmann } from '../src/boltzmann.js';
import { Map } from '../src/map.js';
import { FluidWind, ConstantWind } from '../src/wind.js';
import { Sim } from '../src/sim.js';

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const quiet = console.log;
const mute = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = quiet; } };

check('no DOM globals in this process', typeof document === 'undefined' && typeof window === 'undefined');

const W = 100, H = 200;
const texture = () => ({ image: { data: new Uint8Array(0) } });
const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };

// Bare Sim set up the way the app used to (main.js before phase 4).
function bareSim(simRes) {
  const bm = new Boltzmann(W, H, 0.25, 90, 15);
  const map = new Map(W, H, 90, 15, bm, new FluidWind(bm), new ConstantWind(90, 15));
  map.physics_model_init();
  const sim = new Sim(map);
  if (simRes === '4f') { bm.setResolution(0.25, 1); bm.setWindSpeed(15); }
  return sim;
}

const host = new LocalHost({ mapW: W, mapH: H, simRes: '4f', texture: texture() });
const events = [];
host.on((e) => events.push(e));
const frames = [];
host.onFrame((f) => frames.push(f));

check('info is plain data', (() => { try { structuredClone(host.info); return true; } catch { return false; } })());
check('info carries map size, wind, lattice and scenario text',
  host.info.mapW === W && host.info.wind.from === 90 && host.info.lattice.w >= W && typeof host.info.scenarios[7].title === 'string');
check('startup simRes 4f applied (one root step per tick)', host.core.bm.resolution === 0.25 && host.core.bm.stepsPerFrame === 1);

// Parity: the host and a bare Sim, same scenario and held inputs.
for (const n of [0, 7, 11]) {
  const ref = bareSim('4f');
  const h = new LocalHost({ mapW: W, mapH: H, simRes: '4f', texture: texture() });
  const card = h.commandSync({ type: 'restart', scenario: n });
  mute(() => ref.command({ type: 'restart', scenario: n }));
  const held = (t) => (t > 20 && t < 50 ? [{ type: 'helm', boat: 0, dir: -1 }] : []);
  let last;
  mute(() => {
    for (let t = 0; t < 90; t++) {
      ref.map.world.step(1 / 30); ref.step(1 / 30, held(t));
      last = h.tick({ dt: 1 / 30, held: held(t), present: true, view });
    }
  });
  const a = JSON.stringify(ref.snapshot()), b = JSON.stringify(h.core.sim.snapshot());
  check(`scenario ${n}: host and bare Sim identical after 90 ticks`, a === b);
  check(`scenario ${n}: restart returns the scenario card`, card && card.title === ref.scenarios[n].title);
  let plain = true;
  try { structuredClone(last); } catch { plain = false; }
  check(`scenario ${n}: frame is plain data`, plain);
  const scene = buildScene(last.state, last.statics, view);
  check(`scenario ${n}: frame has readout, scene state and statics that build guides and body outlines`,
    typeof last.hud.info === 'string' && last.hud.info.includes('Boat 0 TWA') && Array.isArray(scene.guides) && scene.guides.length > 0
    && scene.bodies.length > 0 && scene.bodies.every((o) => o.pts.length >= 4 && Number.isFinite(o.pts[0])),
    `guides=${scene.guides.length} bodies=${scene.bodies.length}`);
  check(`scenario ${n}: frame bodies match the live world`, sceneDiff(scene.bodies, h.bodies()) === 0);
  check(`scenario ${n}: boat0 follows boat 0`, last.boat0 && Math.abs(last.boat0.x - ref.players[0].x) < 1e-12);
}

mute(() => { host.commandSync({ type: 'restart', scenario: 0 }); for (let t = 0; t < 3; t++) host.tick({ dt: 1 / 30, held: [], present: true, view }); });
const bind = events.find((e) => e.type === 'bindControls');
check('bindControls event carries the boat count', bind && bind.boats === 1);
check('cleared event on restart', events.some((e) => e.type === 'cleared'));
check('events are plain data', (() => { try { structuredClone(events); return true; } catch { return false; } })());

// Commands that used to poke the lattice from main.js.
const bm = host.core.bm;
host.commandSync({ type: 'cellBudget', tune: false });
check('cellBudget off: no target, scale 1', bm.cellUpdateTarget === Infinity && bm.curlScale === 1 && bm.cellLoadRatio === 0);
host.commandSync({ type: 'cellBudget', tune: true, target: 12345 });
check('cellBudget number', bm.cellUpdateTarget === 12345);
host.commandSync({ type: 'cellBudget', tune: true, target: null });
check('cellBudget default', bm.cellUpdateTarget === 'default');
const same = host.commandSync({ type: 'simRes', mode: '4f' });
check('simRes unchanged: not rebuilt', same.rebuilt === false);
const re = host.commandSync({ type: 'simRes', mode: '2' });
check('simRes change: rebuilt, new lattice size', re.rebuilt === true && re.lattice.w >= W && bm.resolution === 0.5);
const amr = host.commandSync({ type: 'amrMode', mode: 'fixed' });
check('amrMode change: rebuilt', amr.rebuilt === true && bm.amrMode === 'fixed');
host.commandSync({ type: 'plot', plotType: 1, contrastExp: 2 });
check('plot command reaches the painter options', host.core.painter.getOptions().plotType === 1 && host.core.painter.getOptions().contrastExp === 2);
const st = host.perfStats();
check('perf stats are plain data', Array.isArray(st.levels) && Number.isFinite(st.defaultTarget) && structuredClone(st) !== null);
host.setPerf(true);
const pf = mute(() => host.tick({ dt: 1 / 30, held: [], present: false, view }));
check('frame carries perf stats when asked, no HUD when not presenting', pf.perf && pf.perf.levels.length >= 1 && pf.hud === undefined);
const v = await host.query({ type: 'fieldVelocity', x: 0, y: 0 });
const w = await host.query({ type: 'wind', x: 0, y: 0 });
check('queries answer with plain numbers', Number.isFinite(v.x) && Number.isFinite(w.speed));
check('SimCore is exported for other hosts', typeof SimCore === 'function');

if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all host checks passed');
