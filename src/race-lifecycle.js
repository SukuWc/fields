// Race lifecycle: the race time limit and the finish countdown (no DOM; runs
// in the Sim on the server, the worker and in tests).
//
// Room config (room-config.js): race_time_limit_s (default 600 s, 0 = off)
// and finish_countdown_s (default 30 s, 0 = restart as soon as the last
// racer finishes). A bare Sim has both off (SIM_RACE_LIFECYCLE), so scenario
// checks and unit tests never restart.
//
// Racers are the player boats (spawnBoat: boat.spawnId); scenario boats and
// race bots do not count. The lifecycle runs only while at least one racer is
// on the water. Race time is the start sequence clock from the gun (prestart
// not counted); without a start sequence, the time since the lifecycle reset
// (scenario load) while a racer is on the water.
//
// step() returns null, or an event the Sim emits as { type: 'raceLifecycle', ... }:
//   { phase: 'countdown', s }      every racer has finished: new race in s seconds
//   { phase: 'restart', reason }   'timeLimit' | 'finished': the host restarts
// After 'restart' the lifecycle stays done until reset() (the scenario load
// of the restart), so it fires once.

export const DEFAULT_RACE_LIFECYCLE = Object.freeze({ timeLimitS: 600, finishCountdownS: 30 });
export const SIM_RACE_LIFECYCLE = Object.freeze({ timeLimitS: 0, finishCountdownS: 0, enabled: false });
export const MAX_RACE_TIME_LIMIT_S = 4 * 3600;
export const MAX_FINISH_COUNTDOWN_S = 600;

/** Validate { timeLimitS, finishCountdownS, enabled? } → { settings } or { error }. */
export function validateRaceLifecycle(raw = {}) {
  const d = DEFAULT_RACE_LIFECYCLE;
  const tl = raw.timeLimitS === undefined ? d.timeLimitS : raw.timeLimitS;
  const cd = raw.finishCountdownS === undefined ? d.finishCountdownS : raw.finishCountdownS;
  if (typeof tl !== 'number' || !Number.isFinite(tl) || tl < 0 || tl > MAX_RACE_TIME_LIMIT_S) {
    return { error: 'race_time_limit_s must be 0..' + MAX_RACE_TIME_LIMIT_S + ' (0 = no limit)' };
  }
  if (typeof cd !== 'number' || !Number.isFinite(cd) || cd < 0 || cd > MAX_FINISH_COUNTDOWN_S) {
    return { error: 'finish_countdown_s must be 0..' + MAX_FINISH_COUNTDOWN_S };
  }
  return { settings: { enabled: raw.enabled !== false, timeLimitS: tl, finishCountdownS: cd } };
}

export class RaceLifecycle {
  constructor(settings = SIM_RACE_LIFECYCLE) {
    this.set(settings);
  }

  set(settings) {
    const v = validateRaceLifecycle(settings);
    this.settings = v.settings || { ...SIM_RACE_LIFECYCLE };
    this.reset();
  }

  reset() {
    this.elapsed = 0; // race time without a start sequence
    this.countdown = null; // seconds left of the finish countdown, or null
    this.done = false;
  }

  // dt: sim seconds this step; startSeq: sim.startSequence or null;
  // players: sim.players; results: sim.raceResults or null.
  step(dt, { startSeq, players, results }) {
    const s = this.settings;
    if (!s.enabled || this.done) return null;
    const racers = this.racers(players);
    if (!racers.length) return null;
    const raceTime = this.raceTime(startSeq, dt);
    if (s.timeLimitS > 0 && raceTime !== null && raceTime >= s.timeLimitS) {
      this.done = true;
      this.countdown = null;
      return { phase: 'restart', reason: 'timeLimit' };
    }
    const allFinished = !!results && racers.every((b) => results.isFinished(b));
    if (allFinished && this.countdown === null) {
      this.countdown = s.finishCountdownS;
      if (this.countdown > 0) return { phase: 'countdown', s: this.countdown };
    }
    if (this.countdown !== null) {
      if (this.countdown > 0) this.countdown = Math.max(0, this.countdown - dt);
      if (this.countdown <= 0) {
        this.done = true;
        this.countdown = null;
        return { phase: 'restart', reason: 'finished' };
      }
    }
    return null;
  }

  // Boats the lifecycle waits for: player boats (spawnId). Single player
  // (soloAllBoats, set by a soloBoat SimCore) on a numbered scenario has no
  // spawned boat (the page drives the scenario's own boats), so there every
  // boat counts, and the race clock runs from the scenario start.
  racers(players) {
    const list = (players || []).filter((b) => b);
    const spawned = list.filter((b) => b.spawnId);
    return spawned.length || !this.soloAllBoats ? spawned : list;
  }

  raceTime(startSeq, dt = 0) {
    if (startSeq) return startSeq.clock >= 0 ? startSeq.clock : null;
    this.elapsed += dt;
    return this.elapsed;
  }

  // HUD: { tl: race time left (s) or null, cd: countdown left (s) or null }.
  hud(startSeq) {
    const s = this.settings;
    if (!s.enabled) return null;
    const out = {};
    if (s.timeLimitS > 0) {
      const t = startSeq ? (startSeq.clock >= 0 ? startSeq.clock : null) : this.elapsed;
      if (t !== null) out.tl = Math.max(0, s.timeLimitS - t);
    }
    if (this.countdown !== null) out.cd = this.countdown;
    return Object.keys(out).length ? out : null;
  }
}
