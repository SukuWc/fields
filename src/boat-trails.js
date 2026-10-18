// Boat trails (client side, no DOM, no three.js): a dot at each boat's
// position every TRAIL_INTERVAL_S of sim time, kept for TRAIL_DURATION_S,
// fading with age. One fixed ring buffer per boat; renderer.js draws every
// dot from one Points buffer (world-size circles, per-dot colour and alpha).
//
// Sim time comes from the frame (state.ts = Sim.rulesTime). It resets on a
// scenario change (time goes back, or the boat count / scenario changes);
// a boat that jumps further than TRAIL_JUMP_M between two frames (respawn,
// moved by a script) starts a fresh trail.
//
// Colour: the boat's own colour if it has one (spawnBoat color, state.bc),
// else TRAIL_COLORS by boat index. UI / URL: Trail dot every (?trailInterval=s),
// kept (?trailDuration=s), dot size (?trailSize=m), Boat trails box (?boat_trails).

export const TRAIL_INTERVAL_S = 1;
export const TRAIL_DURATION_S = 60;
export const TRAIL_SIZE_M = 0.4;
// Ring capacity limit per boat (duration / interval is capped to this).
export const TRAIL_MAX_DOTS = 2000;
export const TRAIL_JUMP_M = 8;
// Dot opacity: newest TRAIL_ALPHA_NEW, oldest fading to 0.
export const TRAIL_ALPHA_NEW = 0.9;
export const TRAIL_COLORS = [0x2f80ff, 0xff6a2f, 0x2fd06a, 0xffd02f, 0xc05cff, 0x2fe0e0, 0xff4fa0, 0xa0a0a0];

export function colorRgb(c) {
  if (typeof c === 'string') {
    const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
    c = m ? parseInt(m[1], 16) : NaN;
  }
  if (!Number.isFinite(c)) return null;
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}

export class BoatTrails {
  constructor({ interval = TRAIL_INTERVAL_S, duration = TRAIL_DURATION_S, size = TRAIL_SIZE_M } = {}) {
    this.size = size;
    this.boats = [];
    this.lastTime = null;
    this.key = null;
    this.set({ interval, duration });
  }

  // Live settings; a new capacity keeps the newest dots that still fit.
  set({ interval, duration, size } = {}) {
    if (interval > 0) this.interval = interval;
    if (duration > 0) this.duration = duration;
    if (size > 0) this.size = size;
    const cap = Math.max(1, Math.min(TRAIL_MAX_DOTS, Math.ceil(this.duration / this.interval)));
    if (cap !== this.cap) {
      this.cap = cap;
      for (const b of this.boats) this._resize(b, cap);
    }
  }

  _newBoat() {
    return { x: new Float32Array(this.cap), y: new Float32Array(this.cap), t: new Float64Array(this.cap), head: -1, len: 0, next: null, px: null, py: null };
  }

  _resize(b, cap) {
    const nb = this._newBoat();
    const keep = Math.min(b.len, cap);
    for (let k = keep - 1; k >= 0; k--) {
      const s = (b.head - k + b.x.length * 2) % b.x.length;
      nb.head = (nb.head + 1) % cap;
      nb.x[nb.head] = b.x[s]; nb.y[nb.head] = b.y[s]; nb.t[nb.head] = b.t[s];
    }
    nb.len = keep; nb.next = b.next; nb.px = b.px; nb.py = b.py;
    Object.assign(b, nb);
  }

  reset() { this.boats = []; this.lastTime = null; }

  _drop(b, x, y, t) {
    b.head = (b.head + 1) % this.cap;
    b.x[b.head] = x; b.y[b.head] = y; b.t[b.head] = t;
    if (b.len < this.cap) b.len++;
  }

  // One frame. time: sim seconds; boats: [{ px, py } or { x, y }] in index order; key:
  // anything that changes with the scenario (the scenario epoch state.ep).
  update(time, boats, key) {
    if (!Number.isFinite(time)) return;
    if ((this.lastTime !== null && time + 1e-9 < this.lastTime) || (key !== undefined && key !== this.key && this.key !== null) || boats.length < this.boats.length) this.reset();
    this.key = key;
    this.lastTime = time;
    for (let i = 0; i < boats.length; i++) {
      let b = this.boats[i];
      if (!b) b = this.boats[i] = this._newBoat();
      // Body position (renderState px/py), else x/y.
      const q = boats[i];
      const x = Number.isFinite(q.px) ? q.px : q.x, y = Number.isFinite(q.py) ? q.py : q.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (b.px !== null && Math.hypot(x - b.px, y - b.py) > TRAIL_JUMP_M) { b.len = 0; b.head = -1; b.next = null; }
      b.px = x; b.py = y;
      if (b.next === null) b.next = time;
      if (time + 1e-9 >= b.next) {
        this._drop(b, x, y, time);
        b.next += this.interval * Math.max(1, Math.floor((time - b.next) / this.interval + 1e-9) + 1);
      }
    }
  }

  // Dots alive now (age < duration), newest first per boat.
  count() {
    let n = 0;
    this.forEachDot(() => { n++; });
    return n;
  }

  // fn(boatIndex, x, y, age, u) with u = age / duration (0 new .. 1 old).
  forEachDot(fn) {
    const now = this.lastTime;
    for (let i = 0; i < this.boats.length; i++) {
      const b = this.boats[i];
      for (let k = 0; k < b.len; k++) {
        const s = (b.head - k + this.cap) % this.cap;
        const age = now - b.t[s];
        if (age >= this.duration) break;
        fn(i, b.x[s], b.y[s], age, age / this.duration);
      }
    }
  }

  // Fill Points buffers (positions xyz, colors rgba); returns the dot count.
  // colorOf(i) → [r, g, b].
  write(positions, colors, colorOf, z = 0.004) {
    const max = positions.length / 3;
    let n = 0;
    this.forEachDot((i, x, y, age, u) => {
      if (n >= max) return;
      const c = colorOf(i);
      positions[n * 3] = x; positions[n * 3 + 1] = y; positions[n * 3 + 2] = z;
      colors[n * 4] = c[0]; colors[n * 4 + 1] = c[1]; colors[n * 4 + 2] = c[2];
      colors[n * 4 + 3] = TRAIL_ALPHA_NEW * (1 - u);
      n++;
    });
    return n;
  }
}
