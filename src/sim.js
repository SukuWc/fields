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
import { resetMarkTouches, recordMarkTouches } from './mark-touch.js';
import {
  beginRule15Step, createRulesState, evaluateAllPairs, penaltyAutopilotRemainingDeg,
  penaltyJustCleared, penaltyManeuverText, penaltyManeuverView, pendingPenaltyCount,
  pendingPenaltyReason, pendingPenaltyCode, recordContacts, resetContacts, trueWindAngleDeg, useRulesState,
} from './rules.js';
import { markRoomTarget } from './course.js';
import { buildScenarios } from './scenarios.js';
import { Boat } from './boat.js';
import { settingDefault } from './settings-registry.js';

const perfNow = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();

// Scenario frame indexes count the old 90 Hz passes (3 per 30 Hz tick), so
// the scripts keep their timing: one tick runs indexes f .. f+2 and the
// counter advances by SCENARIO_FRAMES_PER_TICK.
export const SCENARIO_FRAMES_PER_TICK = 3;

// Simulation resolution modes: sim-modes.js (the settings registry's simRes
// values and default).
import { SIM_RES_MODES, DEFAULT_SIM_RES, windCeilingMps } from './sim-modes.js';
export { SIM_RES_MODES, DEFAULT_SIM_RES, windCeilingMps };

// Boat input commands, applied with sim.command() (one-shot) or passed to
// step() (held: rudder and heading-target keys, applied once per tick).
//   { type: 'helm', boat, dir: -1 (left) | +1 (right) }        held
//   { type: 'headingTarget', boat, dir: +1 (increase) | -1 }    held
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
//   { type: 'wind', angle?, speed? }   UI wind (from-angle °, true wind m/s)
//   { type: 'devMode', on }            uniform wind, lattice frozen
//   { type: 'barrier', on }
//   { type: 'options', amr?, boatEnergy?, ladder? }
//   { type: 'simRes', mode }           SIM_RES_MODES key; returns true if the lattice was rebuilt
//   { type: 'amrMode', mode }          'auto' | 'fixed'; returns true if the lattice was rebuilt
//   { type: 'sailWake', gain }         sail → lattice momentum multiple (SAIL_WAKE_GAIN 16)
//   { type: 'refine', maxLevel?, boatRefineRadius? }  boat refinement levels (int) and
//                                      finest disk radius (m); null = mode default;
//                                      returns true if the lattice was rebuilt
//   { type: 'cellBudget', tune, target? }  refinement budget: tune false = off (no
//                                      budget, scale 1); target a positive number, else
//                                      the grid default (domainTrack defaultCellUpdateTarget)
export const BOAT_ACTIONS = {
  helm: (b, c) => (c.dir < 0 ? b.input_rudder_left() : b.input_rudder_right()),
  headingTarget: (b, c) => (c.dir > 0 ? b.input_autopilot_heading_increase() : b.input_autopilot_heading_decrease()),
  autopilot: (b) => b.input_autopilot_enabled_toggle(),
  tack: (b) => b.input_autopilot_tack_toggle(),
  penaltyTurn: (b, c) => (c.dir === 'cw' ? b.input_penalty_turn_cw() : b.input_penalty_turn_ccw()),
  depower: (b) => b.input_depower_toggle(),
};

export class Sim {
  // map: Map (map.js) with physics_model_init() done; bm: its Boltzmann.
  constructor(map, { amr = settingDefault('amr'), boatEnergy = settingDefault('boat_energy'), ladder = settingDefault('ladder'), sailWakeGain = SAIL_WAKE_GAIN } = {}) {
    this.map = map;
    this.bm = map.bm;
    this.options = { amr, boatEnergy, ladder, sailWakeGain };
    // boatTrueWind reads map.sailWakeGain so the undo tracks the live room setting.
    map.sailWakeGain = sailWakeGain;
    this.rules = createRulesState();
    this.scenarios = buildScenarios(this);
    this.scenarioIndex = null;
    this.rulesTime = 0;
    this.leaderboard = null;
    this.ticks = 0;
    this._listeners = [];
    this._nextSpawn = 1;
    this.events = [];
    this.last = null;
    this._reset();
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
    this.emit({ type: 'cleared' });
  }

  loadScenario(index) {
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
      case 'restart': return this.loadScenario(c.scenario);
      case 'spawnBoat': return this.spawnBoat(c);
      case 'removeBoat': return this.removeBoat(c.id);
      case 'wind':
        if (Number.isFinite(c.angle)) {
          map.wind_direction = c.angle;
          bm.direction = c.angle + 180;
          map.constantWind.setAngle(c.angle);
        }
        if (Number.isFinite(c.speed)) {
          // Clamp to the current mode's stable ceiling (7.5 m/s · velScale).
          const speed = Math.max(0, bm.velScale > 0 ? Math.min(c.speed, 7.5 * bm.velScale) : c.speed);
          map.wind_speed = speed;
          if (bm.setWindSpeed) bm.setWindSpeed(speed); else bm.speed = speed / 30;
          map.constantWind.setSpeed(speed);
        }
        return undefined;
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

    const players = this.players;
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
      if (!map.devMode && this.options.boatEnergy) {
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
    if (course && course.finish && results && stepped) results.update(players, raceClock);
    // Race bots (scenario 17): autopilot targets once per step.
    const windFrom = map.wind_direction;
    if (stepped) {
      for (const bot of this.raceBots) bot.step(raceClock, windFrom, players, !!results && results.isFinished(bot.boat), results ? results.entries.length : 1);
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
    rec.resolutions = evaluateAllPairs(players, getWind, rulesTime, { markFor, boundary });
    recordContacts(rec.resolutions, rulesTime, players);
    // Rule 31: boat-versus-mark touches. Racing from the preparatory signal
    // when there is a start sequence, else always.
    recordMarkTouches(players, this.marks, { simTime: rulesTime, racing: !startSeq || startSeq.racing });

    // Refinement windows follow the boats (and curl islands). Tracking reads
    // curl, which only changes on a lattice step, so it runs on stepping
    // frames. Dev mode leaves the lattice frozen.
    const trackT0 = perfNow();
    if (!map.devMode && this.options.amr && bm.stepsDueThisFrame() > 0) trackBoats(bm, players);
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
