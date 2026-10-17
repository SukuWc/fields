// SimHost: the one door between the client (main.js, controls.js, renderer,
// HUD, perf overlay) and the simulation. The client sends commands and tick
// requests and gets back plain data: an info record at start, a frame per
// tick (readout strings, guides, body outlines, perf counters, the field
// texture), and Sim events. It never holds Sim, Map, planck or Boltzmann
// objects, so the same client runs against
//   LocalHost   (this file): the Sim on the main thread, frames synchronous;
//   WorkerHost  (worker-host.js, the default; ?worker=0 = LocalHost): the Sim in a Web Worker;
//   RemoteHost  (phase 5): a server over a socket.
//
// SimHost interface (every host):
//   info                    { mapW, mapH, wind: { from, speed }, lattice: { w, h },
//                             scenarios: [{ title, description }] }
//   ready                   Promise that resolves once info is set
//   on(fn)                  Sim events (sim.js emit), plus bindControls.boats
//   onFrame(fn)             fn(frame) after every tick (see SimCore.tick)
//   command(c)              sim.js commands plus host ones (plot); Promise of
//                           the result (restart → { title, description },
//                           simRes / amrMode → { rebuilt, lattice })
//   tick({ dt, held, present, view })
//                           one sim pass; dt undefined for an extra pass
//                           (?simPasses), held the held boat commands (an
//                           array, or a function LocalHost calls after the
//                           scenario frames), present: build HUD/guides,
//                           view: camera position and drawing toggles
//   query(q)                Promise: { type: 'fieldVelocity' | 'wind', x, y }
//   setPerf(on)             include perf counters in frames
import { Boltzmann } from './boltzmann.js';
import { FieldPainter } from './fieldPainter.js';
import { Map } from './map.js';
import { FluidWind, ConstantWind } from './wind.js';
import { Sim } from './sim.js';
import { presentStep, bodyOutlines, perfStats } from './present.js';

// The Sim and everything around it that a host runs (shared by LocalHost and
// the worker). texture: the painter target, a three.js DataTexture or a plain
// { image: { data, width, height } }.
export class SimCore {
  constructor({ mapW, mapH, windAngle = 90, windSpeed = 4.5, simRes = '1', texture, oversampling = 8 }) {
    this.plot = { plotType: 3, contrastExp: 0 };
    this.perf = false;
    this.texture = texture;
    const rootRes = { '1': 1, '2': 0.5, '4': 0.25, '2f': 0.5, '2f34': 0.5, '4f': 0.25 }[simRes] || 1;
    this.painter = new FieldPainter(texture, oversampling, () => this.plot);
    const bm = new Boltzmann(mapW, mapH, rootRes, windAngle, windSpeed, this.painter);
    const map = new Map(mapW, mapH, windAngle, windSpeed, bm, new FluidWind(bm), new ConstantWind(windAngle, windSpeed));
    map.physics_model_init();
    this.bm = bm;
    this.map = map;
    this.sim = new Sim(map);
    this._fixtureIds = new WeakMap();
    // The constructor only took the root resolution; the mode's explicit
    // stepsPerFrame (fast-wind defaults such as '4f') applies before anything runs.
    this.sim.command({ type: 'simRes', mode: simRes });
    // Refinement layout: the app default is "auto" (the engine default too).
    this.sim.command({ type: 'amrMode', mode: 'auto' });
  }

  lattice() { return { w: this.bm.latticeWorldWidth, h: this.bm.latticeWorldHeight }; }

  info() {
    const s = this.sim.scenarios;
    const scenarios = [];
    for (let i = 0; i < s.length; i++) scenarios[i] = s[i] ? { title: s[i].title, description: s[i].description } : null;
    return {
      mapW: this.map.width, mapH: this.map.height,
      wind: { from: this.map.wind_direction, speed: this.map.wind_speed },
      lattice: this.lattice(),
      scenarios,
    };
  }

  // Plain result for a command (no engine objects cross the host).
  command(c) {
    if (!c) return undefined;
    if (c.type === 'plot') {
      if (Number.isFinite(c.plotType)) this.plot.plotType = c.plotType;
      if ('contrastExp' in c) this.plot.contrastExp = c.contrastExp;
      return undefined;
    }
    const r = this.sim.command(c);
    if (c.type === 'restart') return r ? { title: r.title, description: r.description } : null;
    if (c.type === 'simRes' || c.type === 'amrMode') return { rebuilt: !!r, lattice: this.lattice() };
    return r;
  }

  query(q) {
    if (q.type === 'fieldVelocity') { const v = this.bm.get_field_velocity(q.x, q.y); return { x: v.x, y: v.y }; }
    if (q.type === 'wind') { const w = this.map.get_wind(q.x, q.y); return { speed: w.speed, direction: w.direction, vx: w.vx, vy: w.vy }; }
    return null;
  }

  // world.step(dt) (when dt is given) and one sim.step. Returns the frame:
  //   { stepped, fieldSteps, fieldMs, fieldReady, devMode, boat0: { x, y } | null,
  //     hud?, guides?, bodies? (present), perf? (setPerf) }
  // fieldReady: the painter wrote a new texture this pass.
  tick({ dt, held, present, view }) {
    const { sim, bm, map } = this;
    if (dt !== undefined) map.world.step(dt);
    const rec = sim.step(dt, held);
    const p0 = sim.players[0];
    const frame = {
      stepped: rec.stepped, fieldSteps: rec.fieldSteps, fieldMs: bm.field_ms,
      fieldReady: false, devMode: map.devMode,
      boat0: p0 ? { x: p0.x, y: p0.y } : null,
      // Boats added with spawnBoat (remote players): id and position.
      spawned: sim.players.filter((b) => b.spawnId).map((b) => ({ id: b.spawnId, x: b.x, y: b.y, name: b.spawnName })),
    };
    if (present) {
      const hud = presentStep(sim, rec, view);
      frame.guides = hud.guides;
      hud.guides = undefined;
      frame.hud = hud;
      frame.bodies = this.bodies();
    }
    if (this.perf) frame.perf = perfStats(bm, map);
    if (!map.devMode && bm.step_ready) {
      frame.fieldReady = true;
      bm.step_ready = false;
    }
    return frame;
  }

  bodies() { return bodyOutlines(this.map.world, this._fixtureIds); }
  perfStats() { return perfStats(this.bm, this.map); }
}

// The Sim on the main thread. Ticks run synchronously inside tick() and the
// painter writes straight into the client's DataTexture (no copy).
export class LocalHost {
  constructor(opts) {
    this.core = new SimCore(opts);
    this._listeners = [];
    this._frameListeners = [];
    this.lastFrame = null;
    const sim = this.core.sim;
    sim.on((ev) => {
      const out = ev.type === 'bindControls' ? { ...ev, boats: sim.players.length } : ev;
      for (const fn of this._listeners) fn(out);
    });
    this.info = this.core.info();
    this.ready = Promise.resolve(this.info);
    this.kind = 'local';
  }

  on(fn) { this._listeners.push(fn); }
  onFrame(fn) { this._frameListeners.push(fn); }

  // Synchronous result too (commandSync), for callers that need the value in
  // the same task, as the old direct sim.command calls did.
  commandSync(c) { return this.core.command(c); }
  command(c) { return Promise.resolve(this.core.command(c)); }

  tick(req) {
    const frame = this.core.tick(req);
    this.lastFrame = frame;
    for (const fn of this._frameListeners) fn(frame);
    return frame;
  }

  query(q) { return Promise.resolve(this.core.query(q)); }
  setPerf(on) { this.core.perf = !!on; }
  perfStats() { return this.core.perfStats(); }
  bodies() { return this.core.bodies(); }
}
