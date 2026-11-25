// Steps a recorded race (apps/server/replays.js RaceRecorder record) on a
// fresh SimCore, one tick at a time, and checks the stored state hashes.
// Shared by the server's resimulate() and the browser replay player
// (src/replay-host.js), so both run exactly the same stepping code.
// No DOM, no Node APIs.
//
// Record shape used here: start: { opts, nextSpawn }, ticks, hashEvery,
// log: [{ t, c } (a top-level SimCore.command before tick t) |
//       { t, dt?, held?, present?, view? } (tick inputs from tick t on)],
// hashes: [{ t, all, ... }] (after t ticks), finalHash: { t, all, ... }.
import { SimCore } from './host.js';
import { hashCoreState } from './state-hash.js';

export const REPLAY_TICK_DT = 1 / 30;
export const REPLAY_HASH_EVERY = 30;

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

export class ReplayStepper {
  /**
   * record: a replay record. texture / oversampling: the field painter
   * target (the browser's DataTexture; none on the server). Painting only
   * reads the field, so it does not change the hashes.
   */
  constructor(record, { texture, oversampling } = {}) {
    const opts = { ...record.start.opts, texture };
    if (oversampling !== undefined) opts.oversampling = oversampling;
    this.record = record;
    this.core = new SimCore(opts);
    this.core.sim._nextSpawn = record.start.nextSpawn;
    this.ticks = record.ticks;
    this.every = record.hashEvery || REPLAY_HASH_EVERY;
    this.want = new Map((record.hashes || []).map((h) => [h.t, h.all]));
    this.t = 0;
    this.li = 0;
    this.held = [];
    this.present = false;
    this.view = null;
    this.hashes = [];
    this.checked = 0;
    this.firstMismatch = null;
    this.finalHash = null;
  }

  /** True once every tick ran and the final hash was taken. */
  get done() { return this.finalHash !== null; }

  // Log entries stamped with the current tick: commands run now, inputs
  // apply to this tick and the ones after it. Returns this tick's dt.
  _apply() {
    const log = this.record.log;
    let dt = REPLAY_TICK_DT;
    while (this.li < log.length && log[this.li].t === this.t) {
      const e = log[this.li++];
      if ('c' in e) { this.core.command(clone(e.c)); continue; }
      if ('dt' in e) dt = e.dt;
      if ('held' in e) this.held = e.held;
      if ('present' in e) this.present = e.present;
      if ('view' in e) this.view = e.view;
    }
    return dt;
  }

  _finish() {
    this._apply();
    const finalHash = { t: this.ticks, ...hashCoreState(this.core) };
    const want = this.record.finalHash;
    if (!this.firstMismatch && want && finalHash.all !== want.all) this.firstMismatch = { t: this.ticks, want: want.all, got: finalHash.all };
    this.finalHash = finalHash;
  }

  /**
   * One recorded tick: the SimCore frame (as SimCore.tick returns it), or
   * null when the race is over (the first such call takes the final hash).
   */
  step() {
    if (this.done) return null;
    if (this.t >= this.ticks) { this._finish(); return null; }
    const dt = this._apply();
    const frame = this.core.tick({ dt, held: clone(this.held), present: this.present, view: clone(this.view) });
    this.t++;
    if (this.t % this.every === 0 && this.want.has(this.t)) {
      const h = { t: this.t, ...hashCoreState(this.core) };
      this.hashes.push(h);
      this.checked++;
      const want = this.want.get(this.t);
      if (!this.firstMismatch && h.all !== want) this.firstMismatch = { t: this.t, want, got: h.all };
    }
    if (this.t >= this.ticks) this._finish();
    return frame;
  }

  /** Runs to the end; returns { hashes, finalHash, firstMismatch }. */
  run() {
    while (!this.done) this.step();
    return { hashes: this.hashes, finalHash: this.finalHash, firstMismatch: this.firstMismatch };
  }
}
