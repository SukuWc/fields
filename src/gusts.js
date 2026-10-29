// Moving-column gusts: local momentum injection into the lattice (same family
// as sail wake via Boltzmann.apply_energy), not a free-stream speed disk and
// not a density/pressure pulse.
//
// Each column is an elliptical Gaussian kernel whose long axis is
// perpendicular to the gust wind (cross-wind bar, thin along-wind). While
// alive the centre advects at free-stream velocity and the kernel is
// re-injected each tick with a ramp in/out; after life ends, injection stops
// and LBM carries/diffuses the streak. Advantage is geometric: only boats
// inside/near a column feel it.
//
// No DOM. Units: world metres, wind m/s, sim time in seconds (30 Hz ticks).

/** Along-wind Gaussian σ (m). Thin axis of the ellipse. */
export const GUST_ALONG_SIGMA_M = 2.5;
/** Cross-wind Gaussian σ (m). Long axis ⊥ gust wind. Aspect = 5. */
export const GUST_CROSS_SIGMA_M = 12.5;
export const GUST_ASPECT = GUST_CROSS_SIGMA_M / GUST_ALONG_SIGMA_M;

/** Total life of continuous injection (s), including ramps. */
export const GUST_LIFE_S = 10;
/** Ramp-in and ramp-out duration (s) each end. */
export const GUST_RAMP_S = 1.5;

/**
 * Peak lattice-momentum kick per tick at the kernel centre (weight = 1),
 * before resolution scaling (× resolution² / velScale, same family as
 * Sim.sailEfficiency). Each sample deposits forceGain · weight · scale;
 * weights are the elliptical Gaussian (peak 1), not renormalised to sum 1,
 * so the centre keeps the full gain and the shape stays elliptical.
 * Tuned on 2f / 4.5 m/s: ~+50% peak |u| vs freestream while injecting,
 * stable over 16 s on scenario 22 (0.045 blew up by ~t=3–9 s).
 */
export const GUST_FORCE_GAIN = 0.003;

/** Cap on live columns (rate spawner + scripted). */
export const GUST_MAX_LIVE = 32;

/** Sample the kernel out to this many σ. */
const KERNEL_RADIUS_SIGMA = 3;
/** Soft floor: skip samples below this weight. */
const WEIGHT_EPS = 1e-3;

/** 1σ outline stroke (scene-build guides; no fill). */
export const GUST_OUTLINE_COLOR = 0x9fd4ff;
export const GUST_OUTLINE_OPACITY = 0.9;
/** Segments around the 1σ ellipse. */
export const GUST_OUTLINE_STEPS = 64;

/**
 * Scenario 22 demo layout (wind from +Y → flow −Y). Two columns spawn upwind
 * of the boat so they drift down onto the beat.
 */
export const GUST_DEMO = {
  windMps: 4.5,
  boat: { x: 0, y: -25, heading: 5 * Math.PI / 4 },
  columns: [
    // Wide cross-wind bar centred on the beat line, starts upwind.
    { x: 0, y: 35, alongSigma: GUST_ALONG_SIGMA_M, crossSigma: GUST_CROSS_SIGMA_M, lifeS: GUST_LIFE_S, rampS: GUST_RAMP_S, forceGain: GUST_FORCE_GAIN, delayS: 0.5 },
    // Second, slightly off-axis, later — shows sparse local advantage.
    { x: 18, y: 55, alongSigma: GUST_ALONG_SIGMA_M, crossSigma: GUST_CROSS_SIGMA_M, lifeS: GUST_LIFE_S, rampS: GUST_RAMP_S, forceGain: GUST_FORCE_GAIN * 0.85, delayS: 4 },
  ],
};

/**
 * Scenario 23: large-σ gust checkerboard repro (Europe-1 room TOML).
 * Circular-ish elliptical kernels with σ ≈ 10–15 m and the live room's
 * force gain (0.0005). Deterministic scripted columns — no Poisson spawner.
 * Regression for inject step = root cell (large σ used to sparsify with
 * min(σ)/2 and look checkerboard on the field overlay).
 */
export const GUST_CHECKERBOARD_DEMO = {
  windMps: 4.5,
  boat: { x: 0, y: -30, heading: 5 * Math.PI / 4 },
  // Match europe-1 refine knobs applied from the scenario frames.
  refine: { maxLevel: 2, boatRefineRadius: 3 },
  columns: [
    // Large near-circular puff centred on the course, starts injecting immediately.
    { x: 0, y: 10, alongSigma: 15, crossSigma: 15, lifeS: 12, rampS: 1.5, forceGain: 0.0005, delayS: 0 },
    // Second large puff off-axis (dir offset like gust_dir_deg sd), overlapping.
    { x: 20, y: 35, alongSigma: 12, crossSigma: 12, lifeS: 12, rampS: 1.5, forceGain: 0.0005, windFromDeg: 135, delayS: 0.5 },
    // Third at σ=10 (the TOML mean) for a mid-size reference.
    { x: -18, y: 40, alongSigma: 10, crossSigma: 10, lifeS: 10, rampS: 1.5, forceGain: 0.0005, delayS: 1 },
  ],
};

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Raised-cosine / cosine-taper envelope over [0, life]: ramp in, hold, ramp out. */
export function gustEnvelope(ageS, lifeS, rampS) {
  if (!(lifeS > 0) || ageS < 0 || ageS > lifeS) return 0;
  const r = Math.max(0, Math.min(rampS, lifeS / 2));
  if (ageS < r) return 0.5 - 0.5 * Math.cos(Math.PI * ageS / r);
  if (ageS > lifeS - r) return 0.5 - 0.5 * Math.cos(Math.PI * (lifeS - ageS) / r);
  return 1;
}

/** Unit vector of free-stream flow (downwind) from UI wind-from angle (°). */
export function flowUnitFromWind(windFromDeg) {
  const rad = (windFromDeg + 180) * Math.PI / 180;
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

/** Along (flow) and cross (long-axis) units for a column / map wind. */
export function gustColumnAxes(col, map) {
  const from = Number.isFinite(col && col.windFromDeg) ? col.windFromDeg
    : (map && Number.isFinite(map.wind_direction) ? map.wind_direction : 90);
  const along = flowUnitFromWind(from);
  return { along, cross: { x: -along.y, y: along.x } };
}

/**
 * Compact frame payload for alive columns (scene-state.js):
 *   [[x, y, alongSigma, crossSigma, alongX, alongY], ...]
 * Cross = (−alongY, alongX); 1σ contour uses those σ axes.
 */
export function gustState(field, map) {
  if (!field || !field.columns || !field.columns.length) return null;
  const out = [];
  for (const c of field.columns) {
    if (c.dead) continue;
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    if (!(c.alongSigma > 0) || !(c.crossSigma > 0)) continue;
    const { along } = gustColumnAxes(c, map);
    out.push([c.x, c.y, c.alongSigma, c.crossSigma, along.x, along.y]);
  }
  return out.length ? out : null;
}

/**
 * Guide segments for the 1σ elliptical contour (scene-build.js).
 * Parametric: centre + along·σ_a·cosθ + cross·σ_c·sinθ.
 */
export function gustGuidesFromState(gust) {
  const guides = [];
  if (!gust || !gust.length) return guides;
  const steps = GUST_OUTLINE_STEPS;
  for (const e of gust) {
    if (!e || e.length < 6) continue;
    const cx = e[0], cy = e[1], sa = e[2], sc = e[3], ax = e[4], ay = e[5];
    if (!(sa > 0) || !(sc > 0)) continue;
    const mag = Math.hypot(ax, ay);
    if (!(mag > 1e-12)) continue;
    const ux = ax / mag, uy = ay / mag;
    const vx = -uy, vy = ux;
    for (let i = 0; i < steps; i++) {
      const a0 = (i / steps) * 2 * Math.PI;
      const a1 = ((i + 1) / steps) * 2 * Math.PI;
      const c0 = Math.cos(a0), s0 = Math.sin(a0);
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      guides.push({
        color: GUST_OUTLINE_COLOR,
        opacity: GUST_OUTLINE_OPACITY,
        type: 'guide',
        x1: cx + ux * sa * c0 + vx * sc * s0,
        y1: cy + uy * sa * c0 + vy * sc * s0,
        x2: cx + ux * sa * c1 + vx * sc * s1,
        y2: cy + uy * sa * c1 + vy * sc * s1,
      });
    }
  }
  return guides;
}

/** Lattice momentum scale matching sailEfficiency (resolution² / velScale). */
export function gustLatticeScale(bm) {
  if (!bm) return 1;
  const res = bm.resolution || 1;
  const vs = bm.velScale === undefined || bm.velScale === 1 ? 1 : bm.velScale;
  return (res * res) / vs;
}

/**
 * Deposit an elliptical Gaussian momentum kernel at (cx, cy).
 * Force direction = (fx, fy) total (sum of sample shares ≈ this vector).
 * along = unit along wind; cross = unit ⊥ (long axis).
 */
export function injectEllipticalKernel(bm, cx, cy, fx, fy, along, cross, alongSigma, crossSigma) {
  if (!bm || !Number.isFinite(cx) || !Number.isFinite(cy)) return 0;
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return 0;
  if (!(alongSigma > 0) || !(crossSigma > 0)) return 0;
  const ax = along.x, ay = along.y, cxu = cross.x, cyu = cross.y;
  // World sample step = one root cell. Large σ used to sparsify with
  // min(σ)/2, which left deposits on a sparse Cartesian lattice and looked
  // checkerboard on the field overlay; keep every root cell inside the
  // ellipse. Area weight below keeps total momentum ~resolution-independent.
  const cell = 1 / (bm.resolution || 1);
  const step = cell;
  const halfA = KERNEL_RADIUS_SIGMA * alongSigma;
  const halfC = KERNEL_RADIUS_SIGMA * crossSigma;
  // Bounding box in world axes from the oriented ellipse extents.
  const extX = Math.abs(ax) * halfA + Math.abs(cxu) * halfC;
  const extY = Math.abs(ay) * halfA + Math.abs(cyu) * halfC;

  // fx,fy are the peak (centre) force; each sample gets that × Gaussian weight.
  // Step area factor keeps the deposit roughly resolution-independent when the
  // sample grid is denser than 1 m: weight · (step/ref)² so refining the
  // sample grid does not dump more total momentum.
  const ref = 1; // world metres: gain defined on a 1 m sample lattice
  const area = (step / ref) * (step / ref);
  const scale = gustLatticeScale(bm);
  // Clip to the root interior (cells 1..width-2): samples off the map are
  // dropped rather than redistributed onto the nearest water.
  const res = bm.resolution || 1;
  const hasGrid = Number.isFinite(bm.width) && Number.isFinite(bm.height);
  const minX = hasGrid ? (1 - bm.width / 2) / res : -Infinity;
  const maxX = hasGrid ? (bm.width - 2 - bm.width / 2) / res : Infinity;
  const minY = hasGrid ? (1 - bm.height / 2) / res : -Infinity;
  const maxY = hasGrid ? (bm.height - 2 - bm.height / 2) / res : Infinity;
  const opts = { dropIfBlocked: true };
  let n = 0;
  for (let dy = -extY; dy <= extY + 1e-9; dy += step) {
    for (let dx = -extX; dx <= extX + 1e-9; dx += step) {
      const da = dx * ax + dy * ay;
      const dc = dx * cxu + dy * cyu;
      if (Math.abs(da) > halfA || Math.abs(dc) > halfC) continue;
      const w = Math.exp(-0.5 * ((da / alongSigma) ** 2 + (dc / crossSigma) ** 2));
      if (w < WEIGHT_EPS) continue;
      const wx = cx + dx, wy = cy + dy;
      if (wx < minX || wx > maxX || wy < minY || wy > maxY) continue;
      const s = w * area * scale;
      bm.apply_energy(wx, wy, fx * s, fy * s, opts);
      n++;
    }
  }
  return n;
}

export class GustColumn {
  /**
   * @param {object} opts
   * @param {number} opts.x start centre x (m)
   * @param {number} opts.y start centre y (m)
   * @param {number} [opts.alongSigma]
   * @param {number} [opts.crossSigma]
   * @param {number} [opts.lifeS]
   * @param {number} [opts.rampS]
   * @param {number} [opts.forceGain] peak total lattice force per tick (pre-scale)
   * @param {number} [opts.delayS] wait before birth (age stays negative)
   * @param {number} [opts.windFromDeg] optional override; else map.wind_direction
   * @param {number} [opts.windSpeedMps] optional override; else map.wind_speed
   */
  constructor(opts = {}) {
    this.x = opts.x;
    this.y = opts.y;
    this.alongSigma = opts.alongSigma ?? GUST_ALONG_SIGMA_M;
    this.crossSigma = opts.crossSigma ?? GUST_CROSS_SIGMA_M;
    this.lifeS = opts.lifeS ?? GUST_LIFE_S;
    this.rampS = opts.rampS ?? GUST_RAMP_S;
    this.forceGain = opts.forceGain ?? GUST_FORCE_GAIN;
    this.delayS = opts.delayS ?? 0;
    this.windFromDeg = opts.windFromDeg;
    this.windSpeedMps = opts.windSpeedMps;
    // Age after delay: −delay … 0 … life. Dead once age > life.
    this.ageS = -this.delayS;
    this.dead = false;
    this.lastInjectCount = 0;
    this.lastEnvelope = 0;
  }

  envelope() {
    return gustEnvelope(this.ageS, this.lifeS, this.rampS);
  }

  step(dt, bm, map) {
    if (this.dead || !(dt > 0)) return;
    this.ageS += dt;
    if (this.ageS > this.lifeS) {
      this.dead = true;
      this.lastEnvelope = 0;
      this.lastInjectCount = 0;
      return;
    }
    const from = Number.isFinite(this.windFromDeg) ? this.windFromDeg
      : (map && Number.isFinite(map.wind_direction) ? map.wind_direction : 90);
    const speed = Number.isFinite(this.windSpeedMps) ? this.windSpeedMps
      : (map && Number.isFinite(map.wind_speed) ? map.wind_speed : 0);
    const along = flowUnitFromWind(from);
    // Cross-wind unit (long axis): rotate along by +90° in the plane.
    const cross = { x: -along.y, y: along.x };

    // Advect at free-stream even during delay so the spawn point is the
    // birth location in the scenario layout.
    this.x += along.x * speed * dt;
    this.y += along.y * speed * dt;

    const env = this.envelope();
    this.lastEnvelope = env;
    if (!(env > 0) || !bm || (map && map.devMode)) {
      this.lastInjectCount = 0;
      return;
    }
    const amp = this.forceGain * env;
    this.lastInjectCount = injectEllipticalKernel(
      bm, this.x, this.y, along.x * amp, along.y * amp,
      along, cross, this.alongSigma, this.crossSigma,
    );
  }
}

/** Default rate-spawner settings (room-config off). */
export function defaultGustSpawner() {
  return {
    enabled: false,
    ratePerMin: 0,
    forceGain: GUST_FORCE_GAIN,
    forceGainSd: 0,
    alongSigmaM: GUST_ALONG_SIGMA_M,
    alongSigmaMSd: 0,
    crossSigmaM: GUST_CROSS_SIGMA_M,
    crossSigmaMSd: 0,
    lifeS: GUST_LIFE_S,
    lifeSSd: 0,
    dirDeg: 0,
    dirDegSd: 0,
    rampS: GUST_RAMP_S,
    maxLive: GUST_MAX_LIVE,
    seed: 1,
  };
}

/** Mulberry32: deterministic [0,1) from a 32-bit state. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string to a uint32 seed. */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Sample N(mean, sd²); sd≤0 → mean. */
export function sampleNormal(mean, sd, rng) {
  if (!(sd > 0)) return mean;
  // Box–Muller
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * sd;
}

/** Knuth Poisson for small λ (our rates ≪ 30 per tick). */
export function samplePoisson(lambda, rng) {
  if (!(lambda > 0)) return 0;
  if (lambda > 100) lambda = 100;
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

/** Clamp non-negative physics knobs after sampling. */
function clampNonNeg(x) {
  return Number.isFinite(x) && x > 0 ? x : 0;
}

/** Sparse set of moving columns owned by one Sim (+ optional rate spawner). */
export class GustField {
  constructor() {
    this.columns = [];
    this.spawner = defaultGustSpawner();
    this._rng = mulberry32(this.spawner.seed);
    this._tick = 0;
  }

  clear() {
    this.columns.length = 0;
  }

  /**
   * Apply room-config / command spawner settings.
   * Replaces settings and reseeds RNG; clears live columns when `clearColumns`.
   */
  setSpawner(opts = {}, { clearColumns = true } = {}) {
    const d = defaultGustSpawner();
    const s = { ...d, ...this.spawner, ...opts };
    s.enabled = !!s.enabled;
    s.ratePerMin = Number.isFinite(s.ratePerMin) ? Math.max(0, s.ratePerMin) : 0;
    s.forceGain = Number.isFinite(s.forceGain) ? Math.max(0, s.forceGain) : d.forceGain;
    s.forceGainSd = Number.isFinite(s.forceGainSd) ? Math.max(0, s.forceGainSd) : 0;
    s.alongSigmaM = Number.isFinite(s.alongSigmaM) ? Math.max(0, s.alongSigmaM) : d.alongSigmaM;
    s.alongSigmaMSd = Number.isFinite(s.alongSigmaMSd) ? Math.max(0, s.alongSigmaMSd) : 0;
    s.crossSigmaM = Number.isFinite(s.crossSigmaM) ? Math.max(0, s.crossSigmaM) : d.crossSigmaM;
    s.crossSigmaMSd = Number.isFinite(s.crossSigmaMSd) ? Math.max(0, s.crossSigmaMSd) : 0;
    s.lifeS = Number.isFinite(s.lifeS) ? Math.max(0, s.lifeS) : d.lifeS;
    s.lifeSSd = Number.isFinite(s.lifeSSd) ? Math.max(0, s.lifeSSd) : 0;
    s.dirDeg = Number.isFinite(s.dirDeg) ? s.dirDeg : 0;
    s.dirDegSd = Number.isFinite(s.dirDegSd) ? Math.max(0, s.dirDegSd) : 0;
    s.rampS = Number.isFinite(s.rampS) && s.rampS >= 0 ? s.rampS : d.rampS;
    s.maxLive = Number.isFinite(s.maxLive) && s.maxLive > 0 ? Math.floor(s.maxLive) : GUST_MAX_LIVE;
    s.seed = (Number.isFinite(s.seed) ? s.seed : d.seed) >>> 0;
    this.spawner = s;
    this._rng = mulberry32(s.seed);
    this._tick = 0;
    if (clearColumns) this.clear();
  }

  /** Add a column; returns it (or null if at cap). */
  add(opts) {
    if (this.columns.length >= (this.spawner.maxLive || GUST_MAX_LIVE)) return null;
    const c = opts instanceof GustColumn ? opts : new GustColumn(opts);
    this.columns.push(c);
    return c;
  }

  /** Alive (not yet past life) columns. */
  get alive() {
    return this.columns.filter((c) => !c.dead);
  }

  _spawnOne(map) {
    const s = this.spawner;
    const rng = this._rng;
    const w = map && Number.isFinite(map.width) ? map.width : 100;
    const h = map && Number.isFinite(map.height) ? map.height : 200;
    // WALL_INSET_M = 2 (map-size.js); keep spawns inside open water.
    const inset = 2;
    const halfW = Math.max(0, w / 2 - inset);
    const halfH = Math.max(0, h / 2 - inset);
    const x = (rng() * 2 - 1) * halfW;
    const y = (rng() * 2 - 1) * halfH;
    const windFrom = (map && Number.isFinite(map.wind_direction) ? map.wind_direction : 90)
      + sampleNormal(s.dirDeg, s.dirDegSd, rng);
    const gain = clampNonNeg(sampleNormal(s.forceGain, s.forceGainSd, rng));
    const along = clampNonNeg(sampleNormal(s.alongSigmaM, s.alongSigmaMSd, rng));
    const cross = clampNonNeg(sampleNormal(s.crossSigmaM, s.crossSigmaMSd, rng));
    const life = clampNonNeg(sampleNormal(s.lifeS, s.lifeSSd, rng));
    if (!(along > 0) || !(cross > 0) || !(life > 0) || !(gain > 0)) return null;
    return this.add({
      x, y,
      alongSigma: along,
      crossSigma: cross,
      lifeS: life,
      rampS: s.rampS,
      forceGain: gain,
      windFromDeg: ((windFrom % 360) + 360) % 360,
      delayS: 0,
    });
  }

  _spawn(dt, map) {
    const s = this.spawner;
    if (!s.enabled || !(s.ratePerMin > 0) || !(dt > 0)) return;
    const lambda = (s.ratePerMin / 60) * dt;
    const n = samplePoisson(lambda, this._rng);
    for (let i = 0; i < n; i++) {
      if (this.columns.length >= s.maxLive) break;
      this._spawnOne(map);
    }
  }

  step(dt, bm, map) {
    if (!(dt > 0)) return;
    this._tick++;
    this._spawn(dt, map);
    for (const c of this.columns) c.step(dt, bm, map);
    // Keep finished columns out of the hot list; scenarios that want history
    // can snapshot before they die.
    let w = 0;
    for (let i = 0; i < this.columns.length; i++) {
      if (!this.columns[i].dead) this.columns[w++] = this.columns[i];
    }
    this.columns.length = w;
  }
}
