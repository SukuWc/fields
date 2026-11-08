// Rudder and daggerboard forces. No DOM.
//
// Planform, fully down, treated as a rectangle:
//   Daggerboard chord 0.36 m along the flow. A class blade measures about
//   364 mm parallel to the bottom edge and 31 mm thick (class maximum
//   thickness 33 mm; sailingforums.com, "Laser Foil Details sought").
//   Immersed span 0.90 m: the builder board is about 1.18 m long and the
//   trunk covers the top when it is fully down.
//   Rudder chord 0.22 m. Class maximum thickness is 20 mm (ILCA class
//   rules); at the board's thickness ratio (~0.09) that is a 0.22 m chord.
//   Immersed span 0.50 m, the usual full-down blade.
// The real section is a bit thinner than 12%. Coefficients are NACA 0012
// at Re = 5×10^5 from Sheldahl & Klimas, SAND80-2114 (1981), condensed
// onto the angles below. A Laser foil at 2–4 m/s and these chords sits
// near that Reynolds number.
//
// Finite wing: section lift slope a0 from the table (0–6°), 
//   a = a0 / (1 + a0 / (π · AR_e · e)), e = 0.85.
// AR_e = 2 · span / chord. Day 2017 uses ARE = 2·bk/ck because the hull
// endplates the foil. Below 12° the section Cl is scaled by a/a0. From
// 12° to 20° that factor blends back to 1 (separated flow is not a
// lifting-line correction). Drag is the section Cd plus CL²/(π·AR_e·e).
//
// Forces are in newtons, in the body frame the caller uses: +X to the
// side, +Y aft, bow toward −Y. Lift is perpendicular to the local inflow
// (the velocity of that point on the hull). Drag is parallel to it and
// opposes the motion. A centred foil at speed therefore still has profile
// drag. alpha > 0 means the point is sliding toward +X; positive Cl then
// pushes back toward −X.

import { RHO_WATER } from './dinghy-forces.js';

export const RHO_FOIL = RHO_WATER;
export const OSWALD_E = 0.85;
export const STALL_DEG = 12;
export const DEEP_STALL_DEG = 20;

// Immersed rectangle. effectiveAspect = 2·b/c (hull reflection).
export const DAGGERBOARD = Object.freeze({
  span: 0.90,
  chord: 0.36,
  area: 0.90 * 0.36,
  effectiveAspect: 2 * 0.90 / 0.36,
});
export const RUDDER_BLADE = Object.freeze({
  span: 0.50,
  chord: 0.22,
  area: 0.50 * 0.22,
  effectiveAspect: 2 * 0.50 / 0.22,
});

// [degrees, Cl, Cd], NACA 0012, Re = 5×10^5, Sheldahl & Klimas 1981.
const NACA0012 = Object.freeze([
  [0, 0.000, 0.0080],
  [2, 0.210, 0.0082],
  [4, 0.420, 0.0086],
  [6, 0.630, 0.0094],
  [8, 0.820, 0.0110],
  [10, 0.980, 0.0145],
  [12, 1.050, 0.0210],
  [14, 1.020, 0.0400],
  [16, 0.920, 0.0700],
  [20, 0.800, 0.140],
  [25, 0.780, 0.230],
  [30, 0.750, 0.340],
  [40, 0.680, 0.560],
  [50, 0.580, 0.780],
  [60, 0.480, 0.980],
  [75, 0.250, 1.150],
  [90, 0.000, 1.200],
]);

const A0 = 0.630 / (6 * Math.PI / 180); // section lift slope, per radian, 0–6°

function lerpTable(deg) {
  const d = Math.min(90, Math.max(0, deg));
  let i = 1;
  while (i < NACA0012.length && NACA0012[i][0] < d) i++;
  if (i >= NACA0012.length) i = NACA0012.length - 1;
  const b = NACA0012[i];
  const a = NACA0012[i - 1];
  const t = b[0] === a[0] ? 0 : (d - a[0]) / (b[0] - a[0]);
  return { cl: a[1] + (b[1] - a[1]) * t, cd: a[2] + (b[2] - a[2]) * t };
}

// Section coefficients. Cl is odd in alpha, Cd is even. |alpha| above 90°
// folds back (the trailing edge is leading).
export function naca0012Section(alphaRad) {
  const sign = alphaRad < 0 ? -1 : 1;
  let deg = Math.abs(alphaRad) * 180 / Math.PI;
  if (deg > 90) deg = 180 - deg;
  if (deg > 90) deg = 90;
  const s = lerpTable(deg);
  return { cl: sign * s.cl, cd: s.cd };
}

export function finiteWingCoefficients(alphaRad, aspectRatio, e = OSWALD_E) {
  const sec = naca0012Section(alphaRad);
  const ar = Math.max(aspectRatio, 0.3);
  const ee = Math.max(e, 0.2);
  const a3 = A0 / (1 + A0 / (Math.PI * ar * ee));
  const kLin = a3 / A0;
  const deg = Math.min(90, Math.abs(alphaRad) * 180 / Math.PI);
  let k = kLin;
  if (deg >= DEEP_STALL_DEG) k = 1;
  else if (deg > STALL_DEG) k = kLin + (1 - kLin) * (deg - STALL_DEG) / (DEEP_STALL_DEG - STALL_DEG);
  const cl = k * sec.cl;
  const cd = sec.cd + (cl * cl) / (Math.PI * ar * ee);
  return { cl, cd, clSection: sec.cl, cdSection: sec.cd };
}

// vBodyX, vBodyY: velocity of this point of the hull, body frame (+X side,
// +Y aft, bow −Y). bladeRad: foil rotation from the centreline, radians,
// positive toward +X (the sim's positive rudder, clockwise yaw).
// Returns lift and drag in that frame, newtons.
export function foilForceNewtons({ vBodyX, vBodyY, bladeRad = 0, area, aspectRatio }) {
  const speed = Math.hypot(vBodyX, vBodyY);
  const zero = { x: 0, y: 0 };
  if (!(speed > 1e-6) || !(area > 0)) {
    return { lift: zero, drag: zero, alpha: 0, cl: 0, cd: 0, speed: 0 };
  }
  const forward = -vBodyY;
  const flowFromCenterline = Math.atan2(vBodyX, forward);
  const alpha = flowFromCenterline - bladeRad;
  const { cl, cd } = finiteWingCoefficients(alpha, aspectRatio);
  const qA = 0.5 * RHO_FOIL * speed * speed * area;
  const L = cl * qA;
  const Dmag = cd * qA;
  const vx = vBodyX / speed;
  const vy = vBodyY / speed;
  return {
    lift: { x: vy * L, y: -vx * L },
    drag: { x: -vx * Dmag, y: -vy * Dmag },
    alpha, cl, cd, speed,
  };
}
