// Wind providers. Boats ask Map.get_wind(x, y) and never sample the lattice
// themselves, so a rules engine can swap the source without touching boat code.
//
// Every provider returns the same sample:
//   { vx, vy, speed, direction }
// vx/vy match Boltzmann.get_field_velocity (lattice velocity / 4).
// speed is true-wind speed, |v| * FIELD_TO_WIND_SPEED, which recovers the
// UI wind speed (Boltzmann stores inlet speed as uiSpeed / 100, then
// get_field_velocity divides by 4).
// direction is degrees, atan2(vy, vx) * 180/π + 180. That is where the wind
// comes from (0 = from +X, 90 = from +Y), matching the Wind angle input.
// (vx, vy) themselves point the other way: downwind, which is the lattice
// flow and the direction sail drag pushes the boat.

// FIELD_TO_WIND_SPEED turns a field sample into the boat's internal wind
// units (the old UI wind: 100 × Default lattice U). Those units still drive
// the boat's sail model, unchanged. WIND_UNIT_MPS is one such unit in true
// m/s: Default lattice U × 1 m × 30 steps/s / 100 = 0.3 m/s. Every external
// wind (UI, Boltzmann, Map, ConstantWind, sample.speed) is in m/s.
const FIELD_TO_WIND_SPEED = 100 * 4;
export const WIND_UNIT_MPS = 0.3;
const FIELD_TO_MPS = FIELD_TO_WIND_SPEED * WIND_UNIT_MPS;

export function windSample(vx, vy) {
  const speed = Math.sqrt(vx * vx + vy * vy) * FIELD_TO_MPS;
  const direction = Math.atan2(vy, vx) / Math.PI * 180 + 180;
  return { speed, direction, vx, vy };
}

// Boat true-wind sample: the mean wind VECTOR of n points evenly spaced on
// a circle of radius r (world m) around (x, y). vx and vy are averaged
// separately and speed / direction come from the mean vector (angles are
// never averaged), so opposite samples cancel and directions near 0 / 360
// wrap correctly. Non-finite samples are skipped; null when none is finite.
// When every finite sample is identical (ConstantWind, dev mode) that exact
// sample's vector is returned, bit for bit.
export const BOAT_WIND_RING_R = 1;
export const BOAT_WIND_RING_N = 20;
export function ringWindSample(getWind, x, y, r = BOAT_WIND_RING_R, n = BOAT_WIND_RING_N) {
  let sx = 0, sy = 0, k = 0, first = null, same = true;
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * i / n;
    const w = getWind(x + r * Math.cos(a), y + r * Math.sin(a));
    if (!w || !Number.isFinite(w.vx) || !Number.isFinite(w.vy)) continue;
    if (first === null) first = w;
    else if (w.vx !== first.vx || w.vy !== first.vy) same = false;
    sx += w.vx; sy += w.vy; k++;
  }
  if (!k) return null;
  return same ? windSample(first.vx, first.vy) : windSample(sx / k, sy / k);
}

// Uniform wind. angleDeg and speed use the same units as the wind_angle /
// wind_speed constants in main.js and the Wind angle / Wind speed inputs.
export class ConstantWind {
  constructor(angleDeg, speed) {
    this.angleDeg = angleDeg;
    this.speed = speed;
    this._sample = windSample(0, 0);
    this._recompute();
  }

  setAngle(angleDeg) {
    this.angleDeg = angleDeg;
    this._recompute();
  }

  setSpeed(speed) {
    this.speed = speed;
    this._recompute();
  }

  _recompute() {
    // Boltzmann.initFluid sets lattice (ux, uy) from cos/sin of (uiAngle + 180)
    // at uiSpeed/100. get_field_velocity returns that divided by 4, and the
    // +180 in windSample brings the reported direction back to uiAngle.
    const rad = (this.angleDeg + 180) * Math.PI / 180;
    const mag = this.speed / FIELD_TO_MPS;
    let vx = Math.cos(rad) * mag;
    let vy = Math.sin(rad) * mag;
    if (Math.abs(vx) < 1e-12) vx = 0;
    if (Math.abs(vy) < 1e-12) vy = 0;
    this._sample = windSample(vx, vy);
  }

  getWind(_x, _y) {
    return {
      speed: this._sample.speed,
      direction: this._sample.direction,
      vx: this._sample.vx,
      vy: this._sample.vy,
    };
  }
}

// Lattice-sampled wind. Averages get_field_velocity over a ±2 world-unit
// stencil, which is the previous Map.get_wind body.
export class FluidWind {
  constructor(bm) {
    this.bm = bm;
  }

  getWind(x, y) {
    const WIND_SAMPLE_RADIUS = 2;
    const WIND_SAMPLE_STEP = 1;

    let vx = 0, vy = 0, n = 0;
    for (let dx = -WIND_SAMPLE_RADIUS; dx <= WIND_SAMPLE_RADIUS; dx += WIND_SAMPLE_STEP) {
      for (let dy = -WIND_SAMPLE_RADIUS; dy <= WIND_SAMPLE_RADIUS; dy += WIND_SAMPLE_STEP) {
        const v = this.bm.get_field_velocity(x + dx, y + dy);
        vx += v.x;
        vy += v.y;
        n++;
      }
    }
    // Fast-wind grids run a lower lattice U for the same physical wind;
    // velScale turns lattice velocity back into Default-grid units.
    const vs = this.bm.velScale;
    if (vs !== undefined && vs !== 1) { vx *= vs; vy *= vs; }
    return windSample(vx / n, vy / n);
  }
}

// Three line segments (shaft + two head barbs). directionDeg is the heading
// the arrow points (0 = +X, 90 = +Y). Pass the downwind / flow angle,
// atan2(vy, vx), not windSample.direction (that one is 180° off, upwind).
export function windArrowSegments(x, y, directionDeg, length) {
  const ang = directionDeg / 180 * Math.PI;
  const x2 = x + Math.cos(ang) * length;
  const y2 = y + Math.sin(ang) * length;
  const back = length * 0.22;
  const flank = length * 0.14;
  const px = Math.cos(ang + Math.PI / 2) * flank;
  const py = Math.sin(ang + Math.PI / 2) * flank;
  const bx = x2 - Math.cos(ang) * back;
  const by = y2 - Math.sin(ang) * back;
  return [
    { x1: x, y1: y, x2, y2 },
    { x1: x2, y1: y2, x2: bx + px, y2: by + py },
    { x1: x2, y1: y2, x2: bx - px, y2: by - py },
  ];
}
