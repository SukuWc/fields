// Wind-field flow tracers (client side, no DOM, no three.js).
//
// The host samples the active wind (dev mode: the uniform ConstantWind; full
// fluid: the lattice velocity) on a coarse grid, sampleFlowGrid(), and sends
// it on the frame (frame.flow) every FLOW_GRID_EVERY ticks while "Flow
// tracers" (the old Toggle Field box, view.show_fields) is on. The client
// keeps a fixed pool of tracers (FlowTracers) and draws each one as a short
// streak, one LineSegments buffer for all of them (renderer.js).
//
// Tracers spawn at random points on the map, accepted with probability
// |v| / max|v| (rejection sampling), so spawn density is proportional to the
// local wind speed: the fast flow around and between boats fills in and the
// slow wind shadows thin out. Each lives TRACER_LIFETIME_S with a fade in and
// out (TRACER_FADE), is advected every frame with the bilinearly
// interpolated grid velocity (midpoint step), and is respawned when it dies
// or leaves the map. Initial ages are staggered so they don't blink together.

// Lattice velocity (Boltzmann.get_field_velocity, wind.js vx/vy) → m/s:
// × 400 gives the UI wind speed (knots), × 0.5144 knots → m/s.
export const FIELD_TO_MPS = 400 * 0.5144;
// Grid: at most FLOW_GRID_MAX_X × 2·FLOW_GRID_MAX_X nodes (2:1 maps), at
// least 1 m apart. 50×100 → 1 m, 100×200 → 1.35 m, 200×400 → 2.7 m (finer
// than the 4 m fast-wind root cell; refined cells near boats are finer still).
export const FLOW_GRID_MAX_X = 75;
// Host sends the grid every Nth presented tick (30 Hz ticks → 10 Hz).
export const FLOW_GRID_EVERY = 3;
// Pool size on the 100 × 200 map; scaled with map area (clamped), halved on
// coarse-pointer (touch) devices. URL: ?tracers=N, ?tracerLife=s.
export const TRACER_COUNT = 4000;
export const TRACER_COUNT_MIN = 1500;
export const TRACER_COUNT_MAX = 8000;
export const TRACER_LIFETIME_S = 3;
// Fraction of the lifetime spent fading in (and again fading out).
export const TRACER_FADE = 0.25;
// Streak length: the distance flown in this many seconds.
export const TRACER_TRAIL_S = 0.5;
// Spawn tries before a point is taken anyway (all-calm field).
export const TRACER_SPAWN_TRIES = 30;

export function tracerCountFor(mapW, mapH, { touch = false, override } = {}) {
  if (Number.isFinite(override) && override > 0) return Math.min(20000, Math.round(override));
  let n = Math.round(TRACER_COUNT * (mapW * mapH) / (100 * 200));
  n = Math.max(TRACER_COUNT_MIN, Math.min(TRACER_COUNT_MAX, n));
  return touch ? Math.round(n / 2) : n;
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
  constructor({ count = TRACER_COUNT, lifetime = TRACER_LIFETIME_S, trail = TRACER_TRAIL_S, fade = TRACER_FADE, rng = Math.random } = {}) {
    this.count = count;
    this.lifetime = lifetime;
    this.trail = trail;
    this.fade = fade;
    this.rng = rng;
    this.grid = null;
    this.maxSpeed = 0;
    this.minSpeed = 0;
    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.age = new Float32Array(count);
    this.life = new Float32Array(count);
    this.alive = new Uint8Array(count);
    this.spawned = 0; // total spawns (checks)
  }

  setGrid(g) {
    if (!g || !g.v || !(g.nx > 1) || !(g.ny > 1)) return;
    const first = !this.grid;
    this.grid = g;
    let m = 0, lo = Infinity;
    for (let k = 0; k < g.v.length; k += 2) {
      const s = Math.hypot(g.v[k], g.v[k + 1]);
      if (s > m) m = s;
      if (s < lo) lo = s;
    }
    this.maxSpeed = m;
    this.minSpeed = Number.isFinite(lo) ? lo : 0;
    if (first) {
      // Fill the pool with staggered ages.
      for (let i = 0; i < this.count; i++) { this.spawn(i); this.age[i] = this.rng() * this.life[i]; }
    }
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
    this.alive[i] = 1;
    this.spawned++;
  }

  // Advance every tracer dt seconds (midpoint rule); respawn the dead ones.
  step(dt) {
    if (!this.grid || !(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    const v = this._s || (this._s = { x: 0, y: 0 });
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.spawn(i); continue; }
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

  // Fill LineSegments buffers: positions (count × 2 vertices × 3) and colors
  // (same layout, rgb premultiplied by alpha for additive blending). The
  // streak runs from the tracer back along the flow for trail seconds; the
  // tail vertex is dark so it tapers. Colour runs from slow to fast over the
  // grid's speed range (min..max), so wakes and gusts stand out even when
  // the whole field is within ±20 % of the mean.
  write(positions, colors, z = 0, slow = [0.15, 0.3, 0.75], fast = [0.85, 1, 1]) {
    const v = this._w || (this._w = { x: 0, y: 0 });
    const span = this.maxSpeed - this.minSpeed, inv = span > 1e-6 ? 1 / span : 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * 6;
      const x = this.x[i], y = this.y[i];
      this.velocityAt(x, y, v);
      positions[o] = x; positions[o + 1] = y; positions[o + 2] = z;
      positions[o + 3] = x - v.x * this.trail; positions[o + 4] = y - v.y * this.trail; positions[o + 5] = z;
      const a = this.alpha(i);
      const u = inv ? Math.max(0, Math.min(1, (Math.hypot(v.x, v.y) - this.minSpeed) * inv)) : 1;
      colors[o] = (slow[0] + (fast[0] - slow[0]) * u) * a;
      colors[o + 1] = (slow[1] + (fast[1] - slow[1]) * u) * a;
      colors[o + 2] = (slow[2] + (fast[2] - slow[2]) * u) * a;
      colors[o + 3] = 0; colors[o + 4] = 0; colors[o + 5] = 0;
    }
  }
}
