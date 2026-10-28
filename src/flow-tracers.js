// Wind-field flow tracers (client side, no DOM, no three.js).
//
// The host samples the active wind (dev mode: the uniform ConstantWind; full
// fluid: the lattice velocity) on a coarse grid, sampleFlowGrid(), and sends
// it on the frame (frame.flow) every FLOW_GRID_EVERY ticks while "Flow
// tracers" (the old Toggle Field box, view.show_fields) is on. The client
// keeps a fixed pool of tracers (FlowTracers) and draws each one with a
// tail along its own past path, one LineSegments buffer for all of them
// (renderer.js). Live segments are packed densely; the renderer draws only
// that many via setDrawRange (no alpha-0 padding submitted).
//
// Tracers spawn at random points on the map, accepted with probability
// |v| / max|v| (rejection sampling), so spawn density is proportional to the
// local wind speed: the fast flow around and between boats fills in and the
// slow wind shadows thin out. Each lives TRACER_LIFETIME_S with a fade in and
// out (TRACER_FADE), is advected every frame with the bilinearly
// interpolated grid velocity (midpoint step), and is respawned when it dies
// or leaves the map. Initial ages are staggered so they don't blink together.
//
// Tail: every tracer keeps a ring buffer of TRACER_TAIL_POINTS past
// positions, one stored every tail / TRACER_TAIL_POINTS seconds. The tail is
// a uniform Catmull-Rom curve through head → newest → … → oldest point,
// TRACER_TAIL_SUBDIV segments per interval, fading towards the end. A
// respawn clears the buffer, so no tail jumps across the map.

import { WIND_UNIT_MPS } from './wind.js';

// Lattice velocity (Boltzmann.get_field_velocity, wind.js vx/vy) → m/s, the
// same scale as wind.js windSample().speed: × 400 internal wind units,
// × WIND_UNIT_MPS each.
export const FIELD_TO_MPS = 400 * WIND_UNIT_MPS;
// Grid: at most FLOW_GRID_MAX_X × 2·FLOW_GRID_MAX_X nodes (2:1 maps), at
// least 1 m apart. 50×100 → 1 m, 100×200 → 1.35 m, 200×400 → 2.7 m (finer
// than the 4 m fast-wind root cell; refined cells near boats are finer still).
export const FLOW_GRID_MAX_X = 75;
// Host sends the grid every Nth presented tick (30 Hz ticks → 10 Hz).
export const FLOW_GRID_EVERY = 3;
// Pool size on the 100 × 200 map; scaled with map area (clamped). On
// coarse-pointer (touch) devices the auto count is /5 (never below
// TRACER_COUNT_TOUCH_MIN) and tails use the lite quality below — Firefox
// mobile WebGL was dropping ~30→8 FPS at the old 125×20-segment defaults
// from per-frame DynamicDraw uploads of transparent LineSegments (including
// alpha-0 padding). UI / URL: Tracers (?tracers=N, empty = this auto count),
// Life (?tracerLife=s), Tail (?tracerTail=s).
export const TRACER_COUNT = 250;
export const TRACER_COUNT_MIN = 100;
export const TRACER_COUNT_MAX = 500;
export const TRACER_COUNT_TOUCH_MIN = 40;
export const TRACER_COUNT_LIMIT = 20000;
export const TRACER_LIFETIME_S = 6;
// Fraction of the lifetime spent fading in (and again fading out).
export const TRACER_FADE = 0.25;
// Tail length in seconds of the tracer's own past path.
export const TRACER_TAIL_S = 1.5;
export const TRACER_TAIL_MAX_S = 10;
// Stored past positions per tracer, and Catmull-Rom segments per interval.
// "lite" (touch): fewer history points, polyline (subdiv 1) — ~4× less
// geometry per tracer; desktop keeps the smooth Catmull-Rom.
export const TRACER_TAIL_POINTS = 10;
export const TRACER_TAIL_SUBDIV = 2;
export const TRACER_TAIL_POINTS_LITE = 5;
export const TRACER_TAIL_SUBDIV_LITE = 1;
// LineSegments segments per tracer at full quality (buffer sizing / checks).
export const TRACER_SEGMENTS = TRACER_TAIL_POINTS * TRACER_TAIL_SUBDIV;
export const TRACER_SEGMENTS_LITE = TRACER_TAIL_POINTS_LITE * TRACER_TAIL_SUBDIV_LITE;
export const TRACER_QUALITY = {
  full: { points: TRACER_TAIL_POINTS, subdiv: TRACER_TAIL_SUBDIV },
  lite: { points: TRACER_TAIL_POINTS_LITE, subdiv: TRACER_TAIL_SUBDIV_LITE },
};
// Spawn tries before a point is taken anyway (all-calm field).
export const TRACER_SPAWN_TRIES = 30;

export function tracerCountFor(mapW, mapH, { touch = false, override } = {}) {
  if (Number.isFinite(override) && override > 0) return Math.min(TRACER_COUNT_LIMIT, Math.round(override));
  let n = Math.round(TRACER_COUNT * (mapW * mapH) / (100 * 200));
  n = Math.max(TRACER_COUNT_MIN, Math.min(TRACER_COUNT_MAX, n));
  // Touch: /5 keeps Firefox/mobile near 30 FPS with the colour field on;
  // never below TOUCH_MIN so the field still reads.
  return touch ? Math.max(TRACER_COUNT_TOUCH_MIN, Math.round(n / 5)) : n;
}

export function tracerSegmentsFor(quality = 'full') {
  const q = TRACER_QUALITY[quality] || TRACER_QUALITY.full;
  return q.points * q.subdiv;
}

// Host side. map: Map (map.js). Returns plain data (survives postMessage and
// JSON): { x0, y0, cell, nx, ny, v: [vx, vy, ...] in m/s, row-major from
// (x0, y0) }.
export function sampleFlowGrid(map, maxX = FLOW_GRID_MAX_X) {
  const w = map.width, h = map.height;
  const cell = Math.max(1, w / (maxX - 1), h / (2 * maxX - 1));
  const nx = Math.floor(w / cell) + 1, ny = Math.floor(h / cell) + 1;
  const x0 = -w / 2, y0 = -h / 2;
  const v = new Array(nx * ny * 2);
  const fluid = !map.devMode && map.bm;
  // Fast-wind grids run a lower lattice U (wind.js FluidWind): velScale.
  const vs = fluid && Number.isFinite(map.bm.velScale) ? map.bm.velScale : 1;
  let k = 0;
  for (let j = 0; j < ny; j++) {
    const y = y0 + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell;
      let vx, vy;
      if (fluid) { const f = map.bm.get_field_velocity(x, y); vx = f.x; vy = f.y; }
      else { const f = map.get_wind(x, y); vx = f.vx; vy = f.vy; }
      vx *= FIELD_TO_MPS * (fluid ? vs : 1); vy *= FIELD_TO_MPS * (fluid ? vs : 1);
      v[k++] = Number.isFinite(vx) ? Math.round(vx * 1000) / 1000 : 0;
      v[k++] = Number.isFinite(vy) ? Math.round(vy * 1000) / 1000 : 0;
    }
  }
  return { x0, y0, cell, nx, ny, v };
}

// Small seeded PRNG (mulberry32), so checks are reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class FlowTracers {
  constructor({ count = TRACER_COUNT, lifetime = TRACER_LIFETIME_S, tail = TRACER_TAIL_S, fade = TRACER_FADE, quality = 'full', rng = Math.random } = {}) {
    this.lifetime = lifetime;
    this.fade = fade;
    this.rng = rng;
    this.grid = null;
    this.maxSpeed = 0;
    this.minSpeed = 0;
    this.spawned = 0; // total spawns (checks)
    this.quality = 'full';
    this.H = TRACER_TAIL_POINTS;
    this.subdiv = TRACER_TAIL_SUBDIV;
    this.segments = TRACER_SEGMENTS;
    this.setQuality(quality);
    this.setTail(tail);
    this._alloc(count);
  }

  // 'full' = desktop Catmull-Rom; 'lite' = touch polyline, fewer points.
  // Returns true when the history / segment layout changed (caller rebuilds the GPU buffer).
  setQuality(quality) {
    const q = TRACER_QUALITY[quality] || TRACER_QUALITY.full;
    const name = TRACER_QUALITY[quality] ? quality : 'full';
    if (this.H === q.points && this.subdiv === q.subdiv && this.quality === name) return false;
    this.quality = name;
    this.H = q.points;
    this.subdiv = q.subdiv;
    this.segments = q.points * q.subdiv;
    this.setTail(this.tail ?? TRACER_TAIL_S);
    if (this.x) {
      this._alloc(this.count);
      if (this.grid) this._fill();
    }
    return true;
  }

  _alloc(count) {
    this.count = count;
    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.age = new Float32Array(count);
    this.life = new Float32Array(count);
    // History ring buffer: hx/hy[i * H + k], hHead[i] = slot of the newest,
    // hLen[i] = stored points, hAcc[i] = time since the last store.
    this.hx = new Float32Array(count * this.H);
    this.hy = new Float32Array(count * this.H);
    this.hHead = new Uint16Array(count);
    this.hLen = new Uint16Array(count);
    this.hAcc = new Float32Array(count);
  }

  // Live settings (UI inputs). Count reallocates and refills the pool.
  setCount(n) {
    n = Math.max(1, Math.min(TRACER_COUNT_LIMIT, Math.round(n)));
    if (n === this.count) return false;
    this._alloc(n);
    if (this.grid) this._fill();
    return true;
  }
  setLifetime(s) {
    if (!(s > 0)) return;
    this.lifetime = s;
    for (let i = 0; i < this.count; i++) this.life[i] = s;
  }
  setTail(s) {
    this.tail = Math.max(0, Math.min(TRACER_TAIL_MAX_S, s));
    this.histDt = this.tail / this.H;
  }

  _fill() {
    for (let i = 0; i < this.count; i++) { this.spawn(i); this.age[i] = this.rng() * this.life[i]; }
  }

  setGrid(g) {
    if (!g || !g.v || !(g.nx > 1) || !(g.ny > 1)) return;
    const first = !this.grid;
    this.grid = g;
    let m = 0, lo = Infinity;
    for (let k = 0; k < g.v.length; k += 2) {
      const sp = Math.hypot(g.v[k], g.v[k + 1]);
      if (sp > m) m = sp;
      if (sp < lo) lo = sp;
    }
    this.maxSpeed = m;
    this.minSpeed = Number.isFinite(lo) ? lo : 0;
    if (first) this._fill();
  }

  // Bilinear velocity at (x, y), clamped to the grid; out.x / out.y in m/s.
  velocityAt(x, y, out = { x: 0, y: 0 }) {
    const g = this.grid;
    if (!g) { out.x = 0; out.y = 0; return out; }
    let fx = (x - g.x0) / g.cell, fy = (y - g.y0) / g.cell;
    fx = Math.max(0, Math.min(g.nx - 1.000001, fx));
    fy = Math.max(0, Math.min(g.ny - 1.000001, fy));
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j;
    const v = g.v, nx = g.nx;
    const a = (j * nx + i) * 2, b = a + 2, c = a + nx * 2, d = c + 2;
    const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
    out.x = v[a] * w00 + v[b] * w10 + v[c] * w01 + v[d] * w11;
    out.y = v[a + 1] * w00 + v[b + 1] * w10 + v[c + 1] * w01 + v[d + 1] * w11;
    return out;
  }

  inside(x, y) {
    const g = this.grid;
    return x >= g.x0 && y >= g.y0 && x <= g.x0 + (g.nx - 1) * g.cell && y <= g.y0 + (g.ny - 1) * g.cell;
  }

  // Rejection sampling: uniform point, kept with probability |v| / max|v|.
  // Clears the tracer's history.
  spawn(i) {
    const g = this.grid, rng = this.rng, v = this._v || (this._v = { x: 0, y: 0 });
    const W = (g.nx - 1) * g.cell, H = (g.ny - 1) * g.cell;
    let x = 0, y = 0;
    for (let t = 0; t < TRACER_SPAWN_TRIES; t++) {
      x = g.x0 + rng() * W; y = g.y0 + rng() * H;
      if (!(this.maxSpeed > 0)) break;
      this.velocityAt(x, y, v);
      if (rng() * this.maxSpeed <= Math.hypot(v.x, v.y)) break;
    }
    this.x[i] = x; this.y[i] = y;
    this.age[i] = 0;
    this.life[i] = this.lifetime;
    this.hLen[i] = 0;
    this.hAcc[i] = 0;
    this.spawned++;
  }

  // k-th stored point back from the newest (0 = newest).
  histPoint(i, k, out) {
    const H = this.H;
    const slot = (this.hHead[i] - k + H * 2) % H;
    out.x = this.hx[i * H + slot]; out.y = this.hy[i * H + slot];
    return out;
  }

  _store(i) {
    const H = this.H;
    const slot = this.hLen[i] === 0 ? 0 : (this.hHead[i] + 1) % H;
    this.hx[i * H + slot] = this.x[i]; this.hy[i * H + slot] = this.y[i];
    this.hHead[i] = slot;
    if (this.hLen[i] < H) this.hLen[i]++;
  }

  // Advance every tracer dt seconds (midpoint rule); respawn the dead ones.
  // Before moving, the position is stored every histDt seconds.
  step(dt) {
    if (!this.grid || !(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    const v = this._s || (this._s = { x: 0, y: 0 });
    const hd = this.histDt;
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.spawn(i); continue; }
      if (hd > 0) {
        if (this.hLen[i] === 0) this._store(i);
        this.hAcc[i] += dt;
        if (this.hAcc[i] >= hd) { this.hAcc[i] -= hd; if (this.hAcc[i] > hd) this.hAcc[i] = 0; this._store(i); }
      }
      const x = this.x[i], y = this.y[i];
      this.velocityAt(x, y, v);
      const mx = x + v.x * dt * 0.5, my = y + v.y * dt * 0.5;
      this.velocityAt(mx, my, v);
      const nx = x + v.x * dt, ny = y + v.y * dt;
      if (!this.inside(nx, ny)) { this.spawn(i); continue; }
      this.x[i] = nx; this.y[i] = ny;
    }
  }

  // 0..1: fade in over the first `fade` of the life, out over the last.
  alpha(i) {
    const u = this.age[i] / this.life[i];
    const f = this.fade;
    if (u < f) return u / f;
    if (u > 1 - f) return Math.max(0, (1 - u) / f);
    return 1;
  }

  // Tail control points of tracer i: head, then newest → oldest stored.
  // Returns the point count (1 + stored, capped by the tail length).
  tailPoints(i, px, py) {
    px[0] = this.x[i]; py[0] = this.y[i];
    const n = this.tail > 0 ? this.hLen[i] : 0;
    const H = this.H, base = i * H;
    let slot = this.hHead[i];
    for (let k = 0; k < n; k++) {
      px[k + 1] = this.hx[base + slot]; py[k + 1] = this.hy[base + slot];
      slot = slot === 0 ? H - 1 : slot - 1;
    }
    return n + 1;
  }

  // Pack live LineSegments densely into the buffers and return the segment
  // count. The renderer draws only that many (geometry.setDrawRange) so
  // alpha-0 padding is never submitted — that padding was free on desktop
  // Chrome and expensive on Firefox mobile WebGL. The curve is Catmull-Rom
  // at full quality (subdiv > 1) or a polyline through the history (lite).
  // Alpha falls off linearly to 0 at the tail end, times the life fade;
  // colour runs slow → fast over the grid's speed range.
  write(positions, colors, z = 0, slow = [0.15, 0.3, 0.75], fast = [0.85, 1, 1]) {
    const v = this._w || (this._w = { x: 0, y: 0 });
    const span = this.maxSpeed - this.minSpeed, inv = span > 1e-6 ? 1 / span : 0;
    const S = this.subdiv;
    if (!this._px || this._px.length < this.H + 1) {
      this._px = new Float32Array(this.H + 1);
      this._py = new Float32Array(this.H + 1);
    }
    const px = this._px, py = this._py;
    let o = 0, oc = 0, totalSegs = 0;
    for (let i = 0; i < this.count; i++) {
      const n = this.tailPoints(i, px, py);
      if (n < 2) continue;
      this.velocityAt(px[0], py[0], v);
      const a = this.alpha(i);
      const u = inv ? Math.max(0, Math.min(1, (Math.hypot(v.x, v.y) - this.minSpeed) * inv)) : 1;
      const r = slow[0] + (fast[0] - slow[0]) * u;
      const gg = slow[1] + (fast[1] - slow[1]) * u;
      const b = slow[2] + (fast[2] - slow[2]) * u;
      const total = (n - 1) * S;
      let lx = px[0], ly = py[0], lf = 1, seg = 0;
      for (let k = 0; k < n - 1; k++) {
        const k0 = k > 0 ? k - 1 : 0, k3 = k + 2 < n ? k + 2 : n - 1;
        const p0x = px[k0], p0y = py[k0], p1x = px[k], p1y = py[k], p2x = px[k + 1], p2y = py[k + 1], p3x = px[k3], p3y = py[k3];
        for (let s = 1; s <= S; s++) {
          const t = s / S, t2 = t * t, t3 = t2 * t;
          const cx = 0.5 * ((2 * p1x) + (-p0x + p2x) * t + (2 * p0x - 5 * p1x + 4 * p2x - p3x) * t2 + (-p0x + 3 * p1x - 3 * p2x + p3x) * t3);
          const cy = 0.5 * ((2 * p1y) + (-p0y + p2y) * t + (2 * p0y - 5 * p1y + 4 * p2y - p3y) * t2 + (-p0y + 3 * p1y - 3 * p2y + p3y) * t3);
          const f = 1 - (seg + 1) / total;
          positions[o] = lx; positions[o + 1] = ly; positions[o + 2] = z;
          positions[o + 3] = cx; positions[o + 4] = cy; positions[o + 5] = z;
          colors[oc] = r; colors[oc + 1] = gg; colors[oc + 2] = b; colors[oc + 3] = a * lf;
          colors[oc + 4] = r; colors[oc + 5] = gg; colors[oc + 6] = b; colors[oc + 7] = a * f;
          lx = cx; ly = cy; lf = f; o += 6; oc += 8; seg++; totalSegs++;
        }
      }
    }
    return totalSegs;
  }
}
