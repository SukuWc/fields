// Replay engine (replay seeking, part 2): plays a recorded race
// (src/replay-stepper.js) and seeks in it with in-memory keyframes
// (SimCore.snapshot, src/sim-snapshot.js). DOM-free; it runs in the replay
// worker (src/replay.worker.js) or, without Worker, on the page.
//
// Playback steps the race one recorded tick per page tick (speed: 1, 2 or 4
// ticks, the last one presented). A keyframe is taken every keyframeEvery
// ticks (10 s of race time) by whichever stepper passes that tick: playback,
// a seek's fast-forward, or the look-ahead scan, a second stepper that runs
// ahead of playback in idle time so later seeks find a keyframe close by.
// Keyframes live within a memory budget: when the estimate (cells × bytes
// per cell) is over it, every other keyframe is dropped (tick 0 is kept)
// and the spacing doubles.
//
// seek(t): restore the latest keyframe at or before t (or keep stepping
// from the current position when that is closer), then fast-forward in
// chunks (runSeek(maxMs) does one chunk; the caller yields between chunks
// so the page stays responsive and a new seek or cancel can come in).
// Fast-forward never paints the field, and skips building the scene when
// the record's hash version allows it (ReplayStepper.canSkipDraw). Every stepper checks the
// recorded hashes as it goes, so a seek verifies the path it simulates.
import { ReplayStepper } from './replay-stepper.js';

export const KEYFRAME_EVERY_TICKS = 300;
export const DEFAULT_MEMORY_MB = 160;
// Heap per lattice cell in a keyframe (measured: about 9.6 MB for the
// 14 500 cells of a one-boat europe-1 race, 40 MB for 60 000 with six).
export const KEYFRAME_BYTES_PER_CELL = 700;

/** Lattice cells of a core (root grid and every refinement level). */
export function cellCount(core) {
  let n = 0;
  const stack = [core.bm];
  while (stack.length) {
    const d = stack.pop();
    n += d.cells ? d.cells.length : 0;
    if (d.domains) for (const c of d.domains) stack.push(c);
  }
  return n;
}

export class ReplayEngine {
  /**
   * record: replay record. texture / oversampling: the field painter target
   * (playback only). memoryMB: keyframe budget. scan: run the look-ahead.
   * now(): ms clock (performance.now).
   */
  constructor(record, { texture, oversampling, memoryMB = DEFAULT_MEMORY_MB, scan = true, keyframeEvery = KEYFRAME_EVERY_TICKS, now = () => performance.now() } = {}) {
    this.record = record;
    this.player = new ReplayStepper(record, { texture, oversampling });
    this.core = this.player.core;
    this.ticks = record.ticks;
    this.budget = Math.max(1, memoryMB) * 1e6;
    this.every = keyframeEvery;
    this.baseEvery = keyframeEvery;
    this.now = now;
    this.speed = 1;
    this.keyframes = [];
    this._kfBytes = 0;
    this.seeking = null;
    this.scanEnabled = !!scan;
    this.scanner = null;
    this.scanDone = false;
    this.lastSeekMs = null;
    this.mismatch = null;
    this._keyframe(this.player);
  }

  // A keyframe at the stepper's tick, if it is due and missing.
  _keyframe(s) {
    const t = s.t;
    if (t % this.every !== 0 || t >= this.ticks || s.done) return;
    const ks = this.keyframes;
    let i = ks.length;
    while (i > 0 && ks[i - 1].t > t) i--;
    if (i > 0 && ks[i - 1].t === t) return;
    const bytes = cellCount(s.core) * KEYFRAME_BYTES_PER_CELL;
    ks.splice(i, 0, { t, snap: s.snapshot(), bytes });
    this._kfBytes += bytes;
    this._thin();
  }

  // Over budget: drop every other keyframe (tick 0 stays), double the spacing.
  _thin() {
    while (this._kfBytes > this.budget && this.keyframes.length > 1) {
      this.every *= 2;
      const keep = [];
      let bytes = 0;
      for (const k of this.keyframes) {
        if (k.t === 0 || k.t % this.every === 0) { keep.push(k); bytes += k.bytes; }
      }
      if (keep.length === this.keyframes.length) break;
      this.keyframes = keep;
      this._kfBytes = bytes;
    }
  }

  /** Latest keyframe at or before t. */
  keyframeAt(t) {
    let best = null;
    for (const k of this.keyframes) { if (k.t <= t) best = k; else break; }
    return best;
  }

  _noteMismatch(s) {
    if (s.firstMismatch && (!this.mismatch || s.firstMismatch.t < this.mismatch.t)) this.mismatch = s.firstMismatch;
  }

  get t() { return this.player.t; }
  get done() { return this.player.done; }

  /** Highest tick simulated so far (playback, seek or scan). */
  get simulatedTo() {
    let t = this.player.t;
    if (this.scanner) t = Math.max(t, this.scanner.t);
    const k = this.keyframes[this.keyframes.length - 1];
    if (k) t = Math.max(t, k.t);
    if (this.scanDone) t = this.ticks;
    return Math.min(t, this.ticks);
  }

  setSpeed(n) { this.speed = [1, 2, 4].includes(n) ? n : 1; }

  /**
   * Playback: `speed` recorded ticks, the last one presented. Returns the
   * last frame (null at the end or while a seek runs).
   */
  play() {
    if (this.seeking || this.player.done) return null;
    let frame = null;
    const painter = this.core.bm.painter;
    for (let i = 0; i < this.speed && !this.player.done; i++) {
      const last = i === this.speed - 1;
      this.core.bm.painter = last ? painter : null;
      try {
        frame = this.player.step(last ? {} : { draw: false });
      } finally {
        this.core.bm.painter = painter;
      }
      this._noteMismatch(this.player);
      this._keyframe(this.player);
    }
    return frame;
  }

  /** Start a seek to tick t (replaces a running one). */
  seek(t) {
    const target = Math.max(0, Math.min(this.ticks, Math.round(t)));
    const from = this.player.t;
    let k = this.keyframeAt(target);
    // The look-ahead scan may be closer than its last keyframe: copy it.
    const sc = this.scanner;
    if (sc && !sc.done && sc.t <= target && sc.t > (k ? k.t : -1) && sc.t > (from <= target ? from : -1)) {
      k = { t: sc.t, snap: sc.snapshot() };
    }
    // Keep going from the current position when that is closer than any keyframe.
    const restore = !(from <= target && (!k || k.t <= from)) && k;
    this.seeking = { from, to: target, start: restore ? k.t : from, t0: this.now() };
    if (restore) this.player.restore(k.snap);
    return this.seeking;
  }

  cancelSeek() { this.seeking = null; }

  /**
   * One fast-forward chunk of the running seek, at most maxMs. Returns the
   * frame of the target tick when the seek is done (presented), else null.
   */
  runSeek(maxMs = 30) {
    const sk = this.seeking;
    if (!sk) return null;
    const p = this.player;
    // Field painting only reads the field: off while fast-forwarding.
    const painter = this.core.bm.painter;
    this.core.bm.painter = null;
    const t0 = this.now();
    let frame = null;
    try {
      while (p.t < sk.to - 1 && !p.done && this.now() - t0 < maxMs) {
        p.step({ draw: false });
        this._noteMismatch(p);
        this._keyframe(p);
      }
    } finally {
      this.core.bm.painter = painter;
    }
    if (p.t >= sk.to - 1 || p.done) {
      // The target tick itself is presented, so the page draws where it landed.
      if (p.t < sk.to && !p.done) { frame = p.step(); this._noteMismatch(p); this._keyframe(p); }
      this.lastSeekMs = this.now() - sk.t0;
      this.seeking = null;
      if (!frame) frame = { stepped: false, seeked: true };
    }
    return frame;
  }

  /** Look-ahead scan for at most maxMs (idle time). Returns true while there is more to do. */
  runScan(maxMs = 10) {
    if (!this.scanEnabled || this.scanDone) return false;
    if (!this.scanner) {
      this.scanner = new ReplayStepper(this.record);
      this.scanner.core.bm.painter = null;
      // Start from the furthest keyframe there is.
      const k = this.keyframes[this.keyframes.length - 1];
      if (k && k.t > 0) { this.scanner.restore(k.snap); this.scanner.core.bm.painter = null; }
    }
    const s = this.scanner;
    const t0 = this.now();
    while (!s.done && this.now() - t0 < maxMs) {
      s.step({ draw: false });
      this._noteMismatch(s);
      this._keyframe(s);
    }
    if (s.done) {
      this.scanDone = true;
      this.scanner = null;
    }
    return !this.scanDone;
  }

  status() {
    const p = this.player;
    const r = this.record;
    const sk = this.seeking;
    return {
      t: p.t,
      ticks: r.ticks,
      checked: p.checked + (p.done && r.finalHash ? 1 : 0),
      total: p.want.size + (r.finalHash && !p.want.has(r.ticks) ? 1 : 0),
      mismatch: this.mismatch,
      done: p.done,
      speed: this.speed,
      seeking: sk ? { from: sk.from, to: sk.to, at: p.t, start: sk.start } : null,
      simulatedTo: this.simulatedTo,
      keyframes: this.keyframes.map((k) => k.t),
      keyframeEvery: this.every,
      keyframeMB: Math.round(this._kfBytes / 1e5) / 10,
      lastSeekMs: this.lastSeekMs === null ? null : Math.round(this.lastSeekMs),
    };
  }
}
