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

const FIELD_TO_WIND_SPEED = 100 * 4;

export function windSample(vx, vy) {
  const speed = Math.sqrt(vx * vx + vy * vy) * FIELD_TO_WIND_SPEED;
  const direction = Math.atan2(vy, vx) / Math.PI * 180 + 180;
  return { speed, direction, vx, vy };
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
    const mag = this.speed / FIELD_TO_WIND_SPEED;
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
