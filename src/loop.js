// Fixed-step simulation loop (replaces planck-renderer's Runner).
//
// The Runner called its callback once after every world.step (with the step)
// and again once per animation frame (without one), because start(render,
// update) stores `this.update = render`. How much simulation work ran per
// world step therefore depended on the display: three passes between steps
// on a 60 Hz screen, five on 120 Hz, fewer on a slow frame.
//
// This loop runs on requestAnimationFrame, but the simulation only advances in
// fixed ticks of 1/tickHz seconds of accumulated wall time. On each tick it
// calls world.step(dt) and then tick(dt). After any ticks for that frame it
// calls frame(). At most maxCatchUp ticks run per animation frame; any time
// still left over after that is dropped, so a long stall (a background tab, a
// breakpoint) slows the simulation down instead of freezing the page while it
// catches up.
export class FixedStepLoop {
  constructor(world, { tickHz = 30, maxCatchUp = 4, now, raf, caf } = {}) {
    this.world = world;
    this.dt = 1 / tickHz;
    this.maxCatchUp = maxCatchUp;
    this.now = now || (() => performance.now());
    this.raf = raf || ((cb) => requestAnimationFrame(cb));
    this.caf = caf || ((id) => cancelAnimationFrame(id));
    this.runId = null;
    this.ticks = 0;          // total fixed ticks run
    this.droppedMs = 0;      // wall time discarded by the catch-up cap
    this._acc = 0;
    this._last = 0;
  }

  // Advance by elapsedSec of wall time. Returns the number of ticks run.
  // Exposed separately from start() so tests can drive the loop without rAF.
  advance(elapsedSec, tick, frame) {
    this._acc += Math.max(0, Math.min(1, elapsedSec));
    let n = 0;
    while (this._acc >= this.dt - 1e-9 && n < this.maxCatchUp) {
      this.world.step(this.dt);
      tick(this.dt);
      this._acc -= this.dt;
      this.ticks++;
      n++;
    }
    if (this._acc >= this.dt) {
      this.droppedMs += (this._acc - (this._acc % this.dt)) * 1000;
      this._acc %= this.dt;
    }
    if (frame) frame(n);
    return n;
  }

  start(tick, frame) {
    if (this.runId) return;
    this._last = this.now();
    const loop = () => {
      const t = this.now();
      const elapsed = (t - this._last) / 1000;
      this._last = t;
      this.advance(elapsed, tick, frame);
      this.runId = this.raf(loop);
    };
    this.runId = this.raf(loop);
  }

  stop() {
    if (this.runId) { this.caf(this.runId); this.runId = null; }
  }
}
