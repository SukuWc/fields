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
  // World sample step ≈ one root cell (or finer when resolution > 1).
  const cell = 1 / (bm.resolution || 1);
  const step = Math.max(cell, Math.min(alongSigma, crossSigma) / 2);
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
  let n = 0;
  for (let dy = -extY; dy <= extY + 1e-9; dy += step) {
    for (let dx = -extX; dx <= extX + 1e-9; dx += step) {
      const da = dx * ax + dy * ay;
      const dc = dx * cxu + dy * cyu;
      if (Math.abs(da) > halfA || Math.abs(dc) > halfC) continue;
      const w = Math.exp(-0.5 * ((da / alongSigma) ** 2 + (dc / crossSigma) ** 2));
      if (w < WEIGHT_EPS) continue;
      const s = w * area * scale;
      bm.apply_energy(cx + dx, cy + dy, fx * s, fy * s);
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

/** Sparse set of moving columns owned by one Sim. */
export class GustField {
  constructor() {
    this.columns = [];
  }

  clear() {
    this.columns.length = 0;
  }

  /** Add a column; returns it. */
  add(opts) {
    const c = opts instanceof GustColumn ? opts : new GustColumn(opts);
    this.columns.push(c);
    return c;
  }

  /** Alive (not yet past life) columns. */
  get alive() {
    return this.columns.filter((c) => !c.dead);
  }

  step(dt, bm, map) {
    if (!(dt > 0)) return;
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
