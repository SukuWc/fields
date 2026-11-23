// The simulation, without DOM or three.js: the planck world and lattice (via
// Map / Boltzmann), the boats, marks, course, start, finish, bots, boundary,
// the rules state, and the scenario scripts. The client (main.js,
// controls.js, renderer.js) drives it with step() and command(), listens to
// its events, and reads its state or snapshot() to draw.
//
// One step() is one 30 Hz tick, run right after world.step(dt) (loop.js).
// The order of work inside a step is the order of the old main.js simPass.
import { SAIL_LATTICE_COUPLING, SAIL_WAKE_GAIN } from './boat.js';
import { boatTrueWind } from './wind.js';
import { trackBoats, resetTracking } from './domainTrack.js';
import { Leaderboard } from './leaderboard.js';
import {
  activeTouchMarks,
  recordMarkTouches,
  resetMarkTouches,
} from './mark-touch.js';
import {
  beginRule15Step, createRulesState, evaluateAllPairs, penaltyAutopilotRemainingDeg,
  penaltyJustCleared, penaltyManeuverText, penaltyManeuverView, pendingPenaltyCount,
  pendingPenaltyReason, pendingPenaltyCode, recordContacts, resetContacts, trueWindAngleDeg, useRulesState,
} from './rules.js';
import { markRoomTarget } from './course.js';
import { buildScenarios } from './scenarios.js';
import { CUSTOM_SCENARIO, customScenario } from './custom-scenario.js';
import { GustField } from './gusts.js';
import {
  validateWindSchedule, realiseWindSchedule, windScheduleOscillation, windScheduleOffset, windSlew,
  WIND_MAX_DEG_PER_S, WIND_SLEW_SPEED_MPS_PER_S, SIM_WIND_SCHEDULE,
} from './wind-schedule.js';
import { Boat } from './boat.js';
import { RaceLifecycle, SIM_RACE_LIFECYCLE, validateRaceLifecycle } from './race-lifecycle.js';
import { setFinishGhost, racingBoats } from './finish-ghost.js';
import { settingDefault } from './settings-registry.js';
import { validateAutopilotGains } from './dev-config.js';

const perfNow = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();

// Scenario frame indexes count the old 90 Hz passes (3 per 30 Hz tick), so
// the scripts keep their timing: one tick runs indexes f .. f+2 and the
// counter advances by SCENARIO_FRAMES_PER_TICK.
export const SCENARIO_FRAMES_PER_TICK = 3;

// Simulation resolution modes: sim-modes.js (the settings registry's simRes
// values and default).
import {
  DEFAULT_SIM_RES,
  SIM_RES_MODES,
  windCeilingMps,
} from './sim-modes.js';
export { SIM_RES_MODES, DEFAULT_SIM_RES, windCeilingMps };

// Boat input commands, applied with sim.command() (one-shot) or passed to
// step() (held: rudder and heading-target keys, applied once per tick).
//   { type: 'helm', boat, dir: -1 (left) | +1 (right) }        held
//   { type: 'headingTarget', boat, dir: +1 (increase) | -1 }    held
//   { type: 'headingSet', boat, aht }  absolute signed target (−TWA °)
//   { type: 'autopilot', boat }        toggle
//   { type: 'tack', boat }             autopilot tack toggle
//   { type: 'penaltyTurn', boat, dir: 'ccw' | 'cw' }
//   { type: 'depower', boat }          depower toggle (sails eased, luffing)
// A boat command may name a spawned boat by id ({ boatId }) instead of an
// index ({ boat }); the server uses that for boats a client owns.
//   { type: 'spawnBoat', name?, color? }  add a boat at a free spawn point, on
//                                      autopilot; returns { id, index, x, y }
//   { type: 'removeBoat', id }         remove a spawned boat; returns true if found
// Admin commands (sim.command()):
//   { type: 'restart', scenario }      clear and load scenario N
//   { type: 'wind', angle?, speed? }   base wind (from-angle °, true wind m/s); instant
//                                      unless the schedule or wind ramp is on (then slewed)
//   { type: 'windSchedule', enabled, seed, seedSpec?, dir, speed, ramp }
//                                      (seed: the drawn seed; seedSpec: wind_schedule_seed [mean, sd])
//                                      (dir / speed: { termN: [amp, amp_sd, freq, freq_sd] },
//                                      room config [wind_dir] / [wind_speed]; freq 0 terms
//                                      are the base, applied by the room config, not here)
//                                      base-wind oscillation (wind-schedule.js); returns
//                                      { error } for invalid settings or a rate over the limit
//   { type: 'devMode', on }            uniform wind, lattice frozen
//   { type: 'barrier', on }
//   { type: 'options', amr?, boatEnergy?, ladder? }
//   { type: 'simRes', mode }           SIM_RES_MODES key; returns true if the lattice was rebuilt
//   { type: 'amrMode', mode }          'auto' | 'fixed'; returns true if the lattice was rebuilt
//   { type: 'sailWake', gain }         sail → lattice momentum multiple (SAIL_WAKE_GAIN 16)
//   { type: 'raceLifecycle', timeLimitS, finishCountdownS }  race-lifecycle.js
//                                      (emits { type: 'raceLifecycle', phase, ... })
//   { type: 'gusts', enabled, ratePerMin, forceGain, forceGainSd, ... }
//                                      room-config rate spawner (gusts.js); clears columns
// Gusts (gusts.js GustField on sim.gusts): scenarios call sim.gusts.add(...); stepped each tick.
//   { type: 'refine', maxLevel?, boatRefineRadius? }  boat refinement levels (int) and
//                                      finest disk radius (m); null = mode default;
//                                      returns true if the lattice was rebuilt
//   { type: 'cellBudget', tune, target? }  refinement budget: tune false = off (no
//                                      budget, scale 1); target a positive number, else
//                                      the grid default (domainTrack defaultCellUpdateTarget)
//   { type: 'autopilotGains', kp, ki, kd, rudderMax?, rudderMaxForce?, autopilotHoldoffMs?, boatId? }
//                                      PID (and, if given, the manual rudder limit in
//                                      degrees) on one boat by id, or (no boatId) the sim
//                                      default written onto every boat by id. A `boat`
//                                      index is rejected. dev-config.js describes which
//                                      host may send the no-id form.
export const BOAT_ACTIONS = {
  helm: (b, c) => b.input_helm(c.dir),
  headingTarget: (b, c) => (c.dir > 0 ? b.input_autopilot_heading_increase() : b.input_autopilot_heading_decrease()),
  // Absolute signed target (−TWA). Client drag handle; not a held key.
  headingSet: (b, c) => b.input_autopilot_heading_set(c.aht),
  autopilot: (b) => b.input_autopilot_enabled_toggle(),
  tack: (b) => b.input_autopilot_tack_toggle(),
  penaltyTurn: (b, c) => (c.dir === 'cw' ? b.input_penalty_turn_cw() : b.input_penalty_turn_ccw()),
  depower: (b) => b.input_depower_toggle(),
};

export class Sim {
  // map: Map (map.js) with physics_model_init() done; bm: its Boltzmann.
  // options.ladder remains a sim flag (scenario 21); the visible ladder is
  // the per-client Dev setting (default on) and no longer uses this default.
  constructor(map, { amr = settingDefault('amr'), boatEnergy = settingDefault('boat_energy'), ladder = false, sailWakeGain = SAIL_WAKE_GAIN } = {}) {
    this.map = map;
    this.bm = map.bm;
    this.options = { amr, boatEnergy, ladder, sailWakeGain };
    // boatTrueWind reads map.sailWakeGain so the undo tracks the live room setting.
    map.sailWakeGain = sailWakeGain;
    this.rules = createRulesState();
    this.scenarios = buildScenarios(this);
    this.scenarioIndex = null;
    // Last layout loaded with loadScenario('custom', layout).
    this.customLayout = null;
    this.rulesTime = 0;
    this.leaderboard = null;
    // Race time limit + finish countdown (race-lifecycle.js); off in a bare Sim,
    // set by the room config. Kept across scenario loads, reset by each one.
    this.raceLifecycle = new RaceLifecycle(SIM_RACE_LIFECYCLE);
    this.ticks = 0;
    this._listeners = [];
    this._nextSpawn = 1;
    this.events = [];
    this.last = null;
    // Null: each boat keeps the gains it was given (remote, per owned boat).
    // Set: local/worker dev Apply, copied onto every boat after scenario frames.
    this.autopilotGains = null;
    // Base wind (room config / `wind` command) vs the applied wind on
    // map.wind_direction / wind_speed, bm.direction and ConstantWind. They
    // differ while the schedule runs or a ramped change is in progress.
    // Room-wide like the lattice: kept across scenario loads.
    this.windBase = { angle: map.wind_direction, speed: map.wind_speed };
    this.windSchedule = validateWindSchedule(SIM_WIND_SCHEDULE).schedule;
    // Amplitudes / periods drawn once from the spec's [mean, sd] and the seed, plus phases.
    this.windRealised = realiseWindSchedule(this.windSchedule);
    // Seconds of sim time since the schedule was (re)configured.
    this.windClock = 0;
    // Applied wind still slewing toward the target after the schedule / ramp went off.
    this._windSettling = false;
    this._reset();
  }

  // Applied wind: what the lattice edges, dev-mode ConstantWind and every
  // reader of map.wind_direction / wind_speed see.
  _applyWind(angle, speed) {
    const map = this.map, bm = this.bm;
    if (Number.isFinite(angle)) {
      map.wind_direction = angle;
      bm.direction = angle + 180;
      map.constantWind.setAngle(angle);
    }
    if (Number.isFinite(speed)) {
      map.wind_speed = speed;
      if (bm.setWindSpeed) bm.setWindSpeed(speed); else bm.speed = speed / 30;
      map.constantWind.setSpeed(speed);
    }
  }

  _windCeiling(speed) {
    const bm = this.bm;
    return Math.max(0, bm.velScale > 0 ? Math.min(speed, 7.5 * bm.velScale) : speed);
  }

  // Target wind now: base, plus the schedule offset when it is on.
  windTarget() {
    const b = this.windBase, s = this.windSchedule;
    if (!s.enabled) return { angle: b.angle, speed: b.speed };
    const o = windScheduleOffset(this.windRealised.terms, this.windClock, this.windRealised.phases);
    return {
      angle: (((b.angle + o.dirDeg) % 360) + 360) % 360,
      speed: this._windCeiling(b.speed * o.speedFactor),
    };
  }

  // Once per world step: advance the schedule clock and slew the applied
  // wind toward the target (≤ WIND_MAX_DEG_PER_S, ≤ WIND_SLEW_SPEED_MPS_PER_S).
  _stepWind(dt) {
    const s = this.windSchedule;
    if (!s.enabled && !s.ramp && !this._windSettling) return;
    if (s.enabled) this.windClock += dt;
    const map = this.map;
    const next = windSlew({ angle: map.wind_direction, speed: map.wind_speed }, this.windTarget(),
      WIND_MAX_DEG_PER_S * dt, WIND_SLEW_SPEED_MPS_PER_S * dt);
    this._applyWind(next.angle, next.speed);
    if (!s.enabled && !s.ramp && next.done) this._windSettling = false;
  }

  _reset() {
    this.descriptor = {};
    this.players = [];
    // Race marks (buoys). Not boats: the rules engine only sees players.
    this.marks = [];
    // Active course (ordered marks + per-boat rounding progress), or null.
    this.course = null;
    this.startSequence = null;
    this.raceResults = null;
    this.raceBots = [];
    // Scenario 19: virtual boundary (boundary.js) and its boat script.
    this.boundary = null;
    this.boundaryScript = null;
    // Moving-column gusts (gusts.js): cleared on every scenario load.
    if (this.gusts) this.gusts.clear();
    else this.gusts = new GustField();
    this.frame = 0;
  }

  // Events go to listeners synchronously (in-process client) and are kept in
  // this.events until drainEvents() (a remote client, tests).
  // { type: 'view', follow?, zoom? }   camera hint from a scenario script
  // { type: 'bindControls' }           the scenario hands boats 0/1 to the keys
  // { type: 'cleared' }                scenario cleared: drop key bindings
  on(fn) { this._listeners.push(fn); }
  emit(ev) {
    this.events.push(ev);
    for (const fn of this._listeners) fn(ev);
  }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // Make this Sim's rules state the one rules.js / mark-touch.js read.
  activate() { useRulesState(this.rules); return this; }

  clear() {
    this.activate();
    for (const p of this.players) p.physics_model_deinit();
    for (const m of this.marks) m.physics_model_deinit();
    this._reset();
    // Bumped on every clear (scenario load): clients reset per-scenario
    // visuals such as boat trails (boat-trails.js) on a new epoch.
    this.epoch = (this.epoch || 0) + 1;
    resetContacts();
    resetMarkTouches();
    if (this.raceLifecycle) this.raceLifecycle.reset();
    this.emit({ type: 'cleared' });
  }

  // index: a scenario number, or 'custom' with a validated layout from the
  // room TOML (custom-scenario.js). A bare 'custom' reloads the last layout.
  loadScenario(index, layout) {
    if (index === CUSTOM_SCENARIO) {
      const L = layout || this.customLayout;
      if (!L) return null;
      this.clear();
      this.customLayout = L;
      const scenario = customScenario(this, L);
      this.scenarioIndex = CUSTOM_SCENARIO;
      this.descriptor = scenario.frames;
      return scenario;
    }
    this.clear();
    const scenario = this.scenarios[index];
    this.scenarioIndex = Number(index);
    this.descriptor = scenario && scenario.frames ? scenario.frames : {};
    return scenario;
  }

  _boatCommand(c) {
    const boat = c.boatId != null ? this.players.find((p) => p.spawnId === c.boatId) : this.players[c.boat];
    const act = BOAT_ACTIONS[c.type];
    if (boat && act) act(boat, c);
  }

  command(c) {
    if (!c) return undefined;
    if (BOAT_ACTIONS[c.type]) { this.activate(); this._boatCommand(c); return undefined; }
    const map = this.map, bm = this.bm;
    switch (c.type) {
      case 'restart': return this.loadScenario(c.scenario, c.layout);
      case 'spawnBoat': return this.spawnBoat(c);
      case 'removeBoat': return this.removeBoat(c.id);
      case 'autopilotGains': return this._autopilotGains(c);
      case 'wind': {
        // Sets the base wind. Clamp to the current mode's stable ceiling (7.5 m/s · velScale).
        if (Number.isFinite(c.angle)) this.windBase.angle = c.angle;
        if (Number.isFinite(c.speed)) this.windBase.speed = this._windCeiling(c.speed);
        // Schedule or ramp on: _stepWind slews toward it. Else instant, as before.
        const s = this.windSchedule;
        if (!s.enabled && !s.ramp) {
          this._windSettling = false;
          this._applyWind(Number.isFinite(c.angle) ? c.angle : undefined, Number.isFinite(c.speed) ? this.windBase.speed : undefined);
        }
        return undefined;
      }
      case 'windSchedule': {
        const v = validateWindSchedule(c);
        if (v.error) return { error: v.error };
        const prev = this.windSchedule;
        const same = JSON.stringify(prev) === JSON.stringify(v.schedule);
        if (same) return undefined;
        // Same oscillating terms and seed (e.g. only wind_ramp or a constant term changed): keep the clock.
        const osc = (x) => JSON.stringify({ ...windScheduleOscillation(x), ramp: 0, seedSpec: 0 });
        const sameTerms = osc(prev) === osc(v.schedule);
        this.windSchedule = v.schedule;
        this.windRealised = realiseWindSchedule(v.schedule);
        if (!sameTerms) {
          this.windClock = 0;
          // Schedule (re)started: the speed terms start off the base
          // (U0·(1 + Σ B sin φ)), so jump the applied wind to the start and
          // refill the flow field at it rather than slewing from the base.
          // Wipes wakes and gust flow (accepted: room start, Reset, Apply).
          if (v.schedule.enabled) {
            const t0 = this.windTarget();
            this._windSettling = false;
            this._applyWind(t0.angle, t0.speed);
            if (bm.refillUniform) bm.refillUniform();
          }
        }
        // Switching off: slew back to the base instead of jumping.
        if ((prev.enabled || prev.ramp) && !v.schedule.enabled && !v.schedule.ramp) this._windSettling = true;
        return undefined;
      }
      case 'raceLifecycle': {
        const v = validateRaceLifecycle(c);
        if (v.error) return { error: v.error };
        if (JSON.stringify(v.settings) !== JSON.stringify(this.raceLifecycle.settings)) this.raceLifecycle.set(v.settings);
        return undefined;
      }
      case 'devMode': map.setDevMode(c.on); return undefined;
      case 'barrier': bm.setBarriers(c.on); return undefined;
      case 'options':
        if ('amr' in c) this.options.amr = !!c.amr;
        if ('boatEnergy' in c) this.options.boatEnergy = !!c.boatEnergy;
        if ('ladder' in c) this.options.ladder = !!c.ladder;
        return undefined;
      case 'simRes': {
        const mode = SIM_RES_MODES[c.mode] || SIM_RES_MODES[DEFAULT_SIM_RES];
        const steps = mode.stepsPerFrame ?? mode.resolution;
        if (mode.resolution === bm.resolution && steps === bm.stepsPerFrame) return false;
        resetTracking(bm, this.players);
        bm.setResolution(mode.resolution, mode.stepsPerFrame);
        // A slower mode lowers the ceiling: clamp the wind to it.
        map.wind_speed = Math.min(map.wind_speed, 7.5 * bm.velScale);
        this.windBase.speed = Math.min(this.windBase.speed, 7.5 * bm.velScale);
        map.constantWind.setSpeed(map.wind_speed);
        bm.setWindSpeed(map.wind_speed);
        return true;
      }
      case 'amrMode': {
        const mode = c.mode === 'auto' ? 'auto' : 'fixed';
        if ((bm.amrMode || 'fixed') === mode) return false;
        resetTracking(bm, this.players);
        bm.amrMode = mode;
        bm.setResolution(bm.resolution, bm.stepsPerFrame === bm.resolution ? undefined : bm.stepsPerFrame);
        bm.setWindSpeed(map.wind_speed);
        return true;
      }
      case 'sailWake':
        if (Number.isFinite(c.gain) && c.gain >= 0) {
          this.options.sailWakeGain = c.gain;
          this.map.sailWakeGain = c.gain;
        }
        return undefined;
      case 'gusts': {
        // Room-config rate spawner. Clears live columns so a Commit rebuilds cleanly;
        // scenario 22 re-adds its scripted columns on restart.
        const opts = {
          enabled: !!c.enabled,
          ratePerMin: c.ratePerMin,
          forceGain: c.forceGain,
          forceGainSd: c.forceGainSd,
          alongSigmaM: c.alongSigmaM,
          alongSigmaMSd: c.alongSigmaMSd,
          crossSigmaM: c.crossSigmaM,
          crossSigmaMSd: c.crossSigmaMSd,
          lifeS: c.lifeS,
          lifeSSd: c.lifeSSd,
          dirDeg: c.dirDeg,
          dirDegSd: c.dirDegSd,
          rampS: c.rampS,
        };
        if (Number.isFinite(c.seed)) opts.seed = c.seed;
        if (!this.gusts) this.gusts = new GustField();
        this.gusts.setSpawner(opts, { clearColumns: true });
        return undefined;
      }
      case 'refine': {
        // Boat refinement stack (domainTrack amrParams): maxLevel levels below
        // the root, finest disk radius in metres; null = the mode default.
        const ml = 'maxLevel' in c ? (Number.isInteger(c.maxLevel) ? c.maxLevel : null) : (bm.maxLevel ?? null);
        const rr = 'boatRefineRadius' in c ? (Number.isFinite(c.boatRefineRadius) ? c.boatRefineRadius : null) : (bm.boatRefineRadius ?? null);
        if ((bm.maxLevel ?? null) === ml && (bm.boatRefineRadius ?? null) === rr) return false;
        resetTracking(bm, this.players);
        bm.maxLevel = ml;
        bm.boatRefineRadius = rr;
        bm.setResolution(bm.resolution, bm.stepsPerFrame === bm.resolution ? undefined : bm.stepsPerFrame);
        bm.setWindSpeed(map.wind_speed);
        return true;
      }
      case 'cellBudget':
        if (!c.tune) {
          bm.cellUpdateTarget = Infinity;
          bm.curlScale = 1;
          bm.cellLoadRatio = 0;
        } else {
          bm.cellUpdateTarget = Number.isFinite(c.target) && c.target > 0 ? c.target : 'default';
        }
        return undefined;
      default: return undefined;
    }
  }

  // Free spawn point: below the start line when there is one (pre-start
  // side), else around boat 0 (or the map centre). Candidates step out in
  // SPAWN_STEP_M rings; the first that is SPAWN_CLEAR_M from every boat and
  // mark and SPAWN_MARGIN_M inside the walls wins.
  spawnPoint() {
    const STEP = 8, CLEAR = 9, MARGIN = 8;
    const map = this.map;
    let base = { x: 0, y: 0 };
    const seq = this.startSequence;
    if (seq && seq.line) {
      const m = seq.line.mid;
      base = { x: m.x - seq.line.nx * 12, y: m.y - seq.line.ny * 12 };
    } else if (this.players[0]) {
      base = { x: this.players[0].x, y: this.players[0].y };
    }
    const others = [...this.players, ...this.marks];
    const free = (x, y) => Math.abs(x) <= map.width / 2 - MARGIN && Math.abs(y) <= map.height / 2 - MARGIN
      && others.every((o) => Math.hypot(o.x - x, o.y - y) >= CLEAR);
    for (let ring = 0; ring < 12; ring++) {
      const n = ring === 0 ? 1 : ring * 8;
      for (let i = 0; i < n; i++) {
        const a = ring === 0 ? 0 : (i / n) * 2 * Math.PI;
        // Along the line first (east, then west), then behind it.
        const x = base.x + Math.cos(a) * ring * STEP, y = base.y - Math.abs(Math.sin(a)) * ring * STEP;
        if (free(x, y)) return { x, y };
      }
    }
    return base;
  }

  _writeAutopilotGains(boat, g) {
    boat.autopilot_kp = g.kp;
    boat.autopilot_ki = g.ki;
    boat.autopilot_kd = g.kd;
    if (g.rudderMax !== undefined && boat.rudder_angle_max !== g.rudderMax) boat.setRudderMax(g.rudderMax);
    if (g.rudderMaxForce !== undefined && boat.rudder_max_force_n !== g.rudderMaxForce) boat.setRudderMaxForce(g.rudderMaxForce);
    if (g.autopilotHoldoffMs !== undefined) boat.setAutopilotHoldoff(g.autopilotHoldoffMs);
  }

  // PID by boat id. No boatId: sim-wide default (local / worker). A numeric
  // `boat` index is refused so a client cannot aim at players[i].
  _autopilotGains(c) {
    if (c.boat != null) return { error: 'autopilotGains targets boats by id, not by index' };
    const g = validateAutopilotGains(c);
    if (g.error) return { error: g.error };
    if (c.boatId != null) {
      if (typeof c.boatId !== 'string' || !c.boatId) return { error: 'boatId must be a boat id' };
      const boat = this.players.find((p) => p.boatId === c.boatId);
      if (!boat) return { error: 'no boat ' + c.boatId };
      this._writeAutopilotGains(boat, g);
      return { ok: true, boats: [boat.boatId] };
    }
    this.autopilotGains = { kp: g.kp, ki: g.ki, kd: g.kd, ...(g.rudderMax !== undefined ? { rudderMax: g.rudderMax } : {}), ...(g.rudderMaxForce !== undefined ? { rudderMaxForce: g.rudderMaxForce } : {}), ...(g.autopilotHoldoffMs !== undefined ? { autopilotHoldoffMs: g.autopilotHoldoffMs } : {}) };
    const ids = [];
    for (const b of this.players) { this._writeAutopilotGains(b, g); ids.push(b.boatId); }
    return { ok: true, boats: ids };
  }

  spawnBoat({ name, color } = {}) {
    this.activate();
    const p = this.spawnPoint();
    const boat = new Boat(this.map, p.x, p.y, 5 * Math.PI / 4);
    boat.spawnId = 'b' + this._nextSpawn++;
    boat.spawnName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 24) : boat.spawnId;
    if (Number.isFinite(color)) {
      boat.spawnColor = color;
      boat.physics_model.render = { ...(boat.physics_model.render || {}), stroke: color };
    }
    boat.input_autopilot_enabled_toggle();
    if (this.autopilotGains) this._writeAutopilotGains(boat, this.autopilotGains);
    this.players.push(boat);
    return { id: boat.spawnId, index: this.players.length - 1, x: p.x, y: p.y, name: boat.spawnName };
  }

  removeBoat(id) {
    const i = this.players.findIndex((b) => b.spawnId === id);
    if (i < 0) return false;
    this.activate();
    this.players[i].physics_model_deinit();
    this.players.splice(i, 1);
    return true;
  }

  // Sail reaction → lattice momentum. See SAIL_LATTICE_COUPLING. A root cell
  // holds cellSize² world units of fluid (ρ and lattice u keep their physical
  // scale at every resolution, see Boltzmann.setResolution), so the same
  // physical momentum per frame is SAIL_LATTICE_COUPLING × resolution² in
  // lattice units. On a fast-wind grid lattice velocity is velScale × smaller
  // per unit of physical wind: divide by it.
  sailEfficiency() {
    const bm = this.bm;
    // ?sailWakeGain scales the coupling; at the default (SAIL_WAKE_GAIN) it is ×1 exactly.
    const g = this.options.sailWakeGain;
    const e = SAIL_LATTICE_COUPLING * (g === SAIL_WAKE_GAIN ? 1 : g / SAIL_WAKE_GAIN) * bm.resolution * bm.resolution;
    return bm.velScale === undefined || bm.velScale === 1 ? e : e / bm.velScale;
  }

  // One tick. simDt: the world.step just taken (1/30 s), or undefined for an
  // extra pass (?simPasses). held: array of held boat commands, or a function
  // returning one; it is read after this tick's scenario frames, where the old
  // loop read the keys. Returns a record of what the step saw, for the client
  // readout (Sim.last).
  step(simDt, held) {
    const tickT0 = perfNow();
    this.activate();
    const map = this.map, bm = this.bm;
    const stepped = typeof simDt === 'number' && Number.isFinite(simDt) && simDt > 0;
    if (stepped) this.rulesTime += simDt;
    const rulesTime = this.rulesTime;
    beginRule15Step(rulesTime);

    const rec = { stepped, simDt, rulesTime, distSum: null, telemetryIndex: -1, physTimes: [], boats: [], resolutions: [], fieldSteps: 0 };

    // Scenario frames f .. f+2 of this tick.
    for (let f = this.frame; f < this.frame + SCENARIO_FRAMES_PER_TICK; f++) {
      if (this.descriptor[f] !== undefined) {
        console.log("Frame ", f);
        this.descriptor[f]();
      }
    }
    const inputs = typeof held === 'function' ? held() : held;
    if (inputs) for (const c of inputs) this._boatCommand(c);
    // Base-wind schedule / ramp: the applied wind for this tick's forces,
    // gusts and lattice edges (after scenario frames, which may set the base).
    if (stepped) this._stepWind(simDt);

    const players = this.players;
    // Autopilot holdoff: heading hold after Left / Right is released
    // (boat.js stepHelmHoldoff), on sim time.
    for (const b of players) b.stepHelmHoldoff(stepped ? simDt : 0);
    // Local/worker dev PID: boats created by the scenario frames above pick
    // up the page's gains. Remote leaves this null and writes by boat id.
    if (this.autopilotGains) {
      for (const b of players) this._writeAutopilotGains(b, this.autopilotGains);
    }
    // Sum of pairwise distances, before the boats step (the old #dist_info).
    let sum = 0;
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const dx = players[i].x - players[j].x;
        const dy = players[i].y - players[j].y;
        sum += Math.sqrt(dx * dx + dy * dy);
        rec.distSum = sum;
      }
    }

    // Bump once per tick so wind.js boatSpeedAcc reuses acc for HUD/rules
    // re-entry in the same step (finite difference of |v| at 30 Hz).
    map._trueWindUndoStep = (map._trueWindUndoStep || 0) + 1;

    // Boats: forces, telemetry, sail energy into the lattice.
    players.forEach((player, index) => {
      player.physics_model_step();
      if (player.telemetry) rec.telemetryIndex = index;
      // Finish ghosts (finish-ghost.js) put no momentum into the lattice.
      if (!map.devMode && this.options.boatEnergy && !player.finishGhost) {
        const eff = this.sailEfficiency();
        for (const seg of player.getSailSegments()) {
          bm.apply_energy_segment(seg.x0, seg.y0, seg.x1, seg.y1, seg.fx * eff, seg.fy * eff);
        }
      }
      rec.physTimes.push(bm.t_delta);
    });

    // Marks: anchor spring + damper once per world.step (planck clears
    // forces after each step).
    if (stepped) for (const mark of this.marks) mark.physics_model_step();

    // Moving-column gusts: elliptical momentum into the lattice (skipped in
    // dev mode inside GustColumn.step). Same tick as sail→lattice energy,
    // before advance_frame.
    if (stepped && this.gusts) this.gusts.step(simDt, bm, map);

    // Start sequence: the clock runs on sim time; each boat's OCS / start
    // state is evaluated once per world step, before course progress.
    const startSeq = this.startSequence;
    if (startSeq && stepped) {
      startSeq.step(simDt);
      startSeq.update(players);
    }
    // Course: each boat's rounding counters advance once per world step.
    const course = this.course;
    if (course) {
      for (const boat of players) {
        const progress = course.progressFor(boat);
        if (stepped) progress.update(boat.x, boat.y);
      }
    }
    // Finish: bow crossings by boats with a complete course, on the race
    // clock (time since the gun, or since the scenario start).
    const results = this.raceResults;
    const raceClock = startSeq ? startSeq.clock : (results ? results.relClock(rulesTime) : rulesTime);
    rec.raceClock = raceClock;
    if (course && course.finish && results && stepped) {
      // A boat that finishes becomes a finish ghost (finish-ghost.js).
      for (const e of results.update(players, raceClock)) setFinishGhost(e.boat, true);
    }
    // Race time limit / finish countdown: the host restarts on 'restart'.
    if (stepped) {
      const lc = this.raceLifecycle.step(simDt, { startSeq, players, results });
      if (lc) this.emit({ type: 'raceLifecycle', ...lc });
    }
    // Race bots (scenario 17): autopilot targets once per step.
    const windFrom = map.wind_direction;
    if (stepped) {
      for (const bot of this.raceBots) bot.step(raceClock, windFrom, racingBoats(players), !!results && results.isFinished(bot.boat), results ? results.entries.length : 1);
    }
    // Live leaderboard for any course.
    if (course) {
      if (!this.leaderboard || this.leaderboard.course !== course) this.leaderboard = new Leaderboard(course, { startSequence: startSeq, results });
      this.leaderboard.results = results;
      if (stepped) this.leaderboard.update(players, raceClock, windFrom);
    }

    // Per-boat rules readout, read before this step's contacts are recorded
    // (as the old readout did).
    for (let i = 0; i < players.length; i++) {
      const b = players[i];
      const sample = boatTrueWind(b) || map.get_wind(b.x, b.y);
      const from = sample && Number.isFinite(sample.direction) ? sample.direction : null;
      const pending = pendingPenaltyCount(b);
      const steered = b.penalty_turn;
      rec.boats.push({
        twa: from === null ? null : trueWindAngleDeg(b.hull_angle, from),
        tacking: !!b.tacking,
        tackingOnto: b.tacking && b.tackingOnto ? b.tackingOnto : null,
        pending,
        justCleared: penaltyJustCleared(b),
        penaltyTurn: steered ? { dir: steered.dir, remainingDeg: penaltyAutopilotRemainingDeg(b) } : null,
        reason: pending > 0 ? pendingPenaltyReason(b) : null,
        ic: pending > 0 ? pendingPenaltyCode(b) : null,
        maneuvers: pending > 0 ? penaltyManeuverText(penaltyManeuverView(b)) : null,
        maneuverView: pending > 0 ? penaltyManeuverView(b) : null,
      });
    }

    // Rules read true wind only at boats: same boatTrueWind the boat / HUD use.
    const getWind = (x, y) => {
      for (const b of players) {
        if (b.x === x && b.y === y) return boatTrueWind(b) || map.get_wind(x, y);
      }
      return map.get_wind(x, y);
    };
    // Rule 18 asks the course which mark each boat is rounding.
    const markFor = course ? (boat) => markRoomTarget(course, boat) : null;
    // Virtual boundary (scenario 19 only): its script and crossing penalties.
    const boundary = this.boundary;
    if (boundary) {
      if (stepped && this.boundaryScript) this.boundaryScript.step(rulesTime);
      if (stepped) boundary.update(players, rulesTime);
    }
    // Finish ghosts take no part in the rules: no pairs, contacts or mark
    // touches, so a racer is never charged for one (finish-ghost.js).
    const ruled = racingBoats(players);
    rec.resolutions = evaluateAllPairs(ruled, getWind, rulesTime, { markFor, boundary });
    recordContacts(rec.resolutions, rulesTime, ruled);
    // Rule 31: boat-versus-mark touches. Racing from the preparatory signal
    // when there is a start sequence, else always.
    // Only the boat's own next mark / gate ends / line ends count.
    const activeMarks = course ? (boat) => activeTouchMarks(course, startSeq, boat) : null;
    recordMarkTouches(ruled, this.marks, { simTime: rulesTime, racing: !startSeq || startSeq.racing, activeMarks });

    // Refinement windows follow the boats (and curl islands). Tracking reads
    // curl, which only changes on a lattice step, so it runs on stepping
    // frames. Dev mode leaves the lattice frozen.
    const trackT0 = perfNow();
    // Finish ghosts (finish-ghost.js) get no refinement window of their own.
    if (!map.devMode && this.options.amr && bm.stepsDueThisFrame() > 0) trackBoats(bm, racingBoats(players));
    const trackMs = perfNow() - trackT0;
    // AMR off: a restart that removed a boat would keep drawing a ring.
    if (!map.devMode && !this.options.amr && bm.domains.length > players.length) {
      bm.domains.length = players.length;
      bm._rebuildInteriorCells();
    }
    if (!map.devMode) rec.fieldSteps = bm.advance_frame();
    if (bm.levelPerf) bm.levelPerf.side(trackMs, perfNow() - tickT0);

    this.frame += SCENARIO_FRAMES_PER_TICK;
    if (stepped) this.ticks++;
    this.last = rec;
    return rec;
  }

  // Plain-data state for a remote client, tests and replays (no planck or
  // engine objects).
  snapshot() {
    this.activate();
    const map = this.map;
    const r = (v) => (Number.isFinite(v) ? v : null);
    return {
      tick: this.ticks,
      scenario: this.scenarioIndex,
      scenarioFrame: this.frame,
      rulesTime: this.rulesTime,
      devMode: map.devMode,
      wind: { from: map.wind_direction, speed: map.wind_speed },
      windBase: { from: this.windBase.angle, speed: this.windBase.speed },
      boats: this.players.map((b, i) => {
        const v = b.physics_model.getLinearVelocity();
        return {
          x: r(b.x), y: r(b.y), heading: r(b.physics_model.getAngle()),
          vx: r(v.x), vy: r(v.y),
          autopilot: !!b.autopilot_enabled, headingTarget: b.autopilot_heading_target,
          telemetry: b.telemetry ? { ...b.telemetry } : null,
          rules: this.last && this.last.boats[i] ? { ...this.last.boats[i] } : null,
          pendingPenalties: pendingPenaltyCount(b),
        };
      }),
      marks: this.marks.map((m) => ({ x: r(m.x), y: r(m.y), name: m.markName || null })),
      race: {
        start: this.startSequence ? { clock: this.startSequence.clock, racing: !!this.startSequence.racing } : null,
        leaderboard: this.leaderboard ? this.leaderboard.toData() : null,
      },
    };
  }
}
