// Sail force and hull resistance in newtons, shared by the heel model and
// the rigid body. No DOM.
//
// Apparent wind must be built in one unit. Boat velocity is m/s (world
// metres, 30 Hz). Wind inside the sail model is the internal unit
// (WIND_UNIT_MPS = 0.3 m/s). Adding those two vectors counts 1 m/s of
// boat speed as 0.3 m/s of wind, so upwind AWS — and therefore sail
// force — is low. Callers pass both in m/s (apparentWindMs).
//
// One sail force:
//   F_N = ½ ρ_air A aws² C cos²(heel) · SAIL_FORCE_SCALE
// The heel DOF takes the centreline-normal component in newtons. The
// rigid body is not in newtons (hull density 6, centreboard and rudder
// in the legacy internal unit, applyForce × FORCE_PASSES). It receives
// the same F_N multiplied by internalForcePerNewton. The lattice wake
// uses that internal vector too: SAIL_LATTICE_COUPLING was tuned to it.
//
// The old split was sail_efficiency = 0.15/3 on the body only, with
// sailForceToNewtons dividing it back out for heel. Those were not the
// same force. sail_efficiency is gone. internalForcePerNewton keeps the
// body's historical scale (so the centreboard, tuned against that scale,
// still balances) while heel sees true newtons.

import { G, RHO_AIR } from './heel.js';

export { RHO_AIR };

// Fresh water at 15 °C, the Day & Nixon 2014 scaling temperature.
export const RHO_WATER = 999;
export const NU_WATER = 1.139e-6;

// Day & Nixon 2014, Table 1, level trim, 160 kg (their 80 kg-crew
// benchmark: hull fittings ~58 kg + rig and foils ~22 kg + crew 80 kg).
// The heel model stays at hull 59 kg + crew 80 kg; that is righting
// moment, not this resistance displacement. A 10 kg displacement change
// moves tank resistance by about 3–6 %.
export const LASER_HULL = Object.freeze({
  lwl: 3.791,    // m
  wetted: 2.959, // m², appendages excluded (the tank had none)
  // Delft Reynolds length, the comparison Day & Nixon use.
  reynoldsLengthFactor: 0.7,
});

// Daggerboard length is about 0.90 m (ILCA). Used as the effective span
// for induced drag. The tank measured the bare hull.
export const LASER_FOIL_SPAN_M = 0.90;
// Viscous drag area of daggerboard + rudder, order of magnitude only.
// The tank drag area does not include it.
export const FOIL_DRAG_AREA = 0.0015;

// Day 2017 covers 5–15 kn. Above this true wind the polars are an
// extrapolation, not a validation.
export const POLAR_VALIDATED_TWS_MPS = 7.7;

// 6.5 kn: Day & Nixon, drag-area hump, where the hull starts to plane
// and measured drag area then falls. This model does not plane.
export const PLANING_HUMP_KN = 6.5;
const KN_TO_MPS = 0.514444;
export const PLANING_HUMP_MPS = PLANING_HUMP_KN * KN_TO_MPS;

// Legacy body coefficient (boat.js `0.15/3`, "was 0.35"). Not equal to
// ½ρA·WIND_UNIT². It survives only inside the unit bridge below.
export const LEGACY_SAIL_EFF = 0.15 / 3;

// Residual multiplier on ½ρAV²C after the apparent-wind unit fix.
// 1 = the lift/drag tables and the corrected AWS, with no extra scale.
// With that, dev-mode close-hauled hike still saturates at about 6.6 m/s.
// 1.45 brings first full hike to about 5.5 m/s (target 5–6; Day 2017's
// 80 kg sailor starts depowering near 4.6 m/s / 9 kn, and this model has
// no sheet-spill, only cos²(heel)). Heel and the hull both see it.
export const SAIL_FORCE_SCALE = 1.45;

// Multiplies residuary + foil drag area only. Friction stays on the ITTC
// 1957 line and the published wetted area. 1 is the bare curve above.
// 1.55 stands in for the daggerboard, rudder and induced drag Day 2017
// puts at about 20 % of upwind hydrodynamic drag in 10 kn, plus the extra
// residuary needed because the sail has no sheet-spill once the crew is
// fully hiked. Fitted to the polars below.
export const HULL_DRAG_SCALE = 1.55;

// internal force (the vector passed to applyFinite, before FORCE_PASSES)
// per newton of F_N. Cancels to LEGACY_SAIL_EFF / (½ ρ A windUnit²).
export function internalForcePerNewton(area, windUnit) {
  const dyn = 0.5 * RHO_AIR * area * windUnit * windUnit;
  return LEGACY_SAIL_EFF / dyn;
}

// Boat velocity and true wind both in m/s. windFromRad is the direction
// the wind comes from. The result points upwind (the apparent-wind
// "from" vector the sail angle uses).
export function apparentWindMs(boatVel, windFromRad, twsMs) {
  return {
    x: boatVel.x + Math.cos(windFromRad) * twsMs,
    y: boatVel.y + Math.sin(windFromRad) * twsMs,
  };
}

// Dynamic pressure times area times heel factor, in newtons per unit C.
export function sailDynamicNewtons(awsMs, heelK, area, scale = SAIL_FORCE_SCALE) {
  return 0.5 * RHO_AIR * area * awsMs * awsMs * heelK * scale;
}

export function frictionalDragArea(speedMs) {
  const v = Math.max(speedMs, 0.05);
  const rn = v * LASER_HULL.lwl * LASER_HULL.reynoldsLengthFactor / NU_WATER;
  const cf = 0.075 / (Math.log10(rn) - 2) ** 2;
  return cf * LASER_HULL.wetted;
}

// Residuary drag area (m²). Rises as (Fn / Fn_hump)⁴ to RESIDUARY_HUMP_M2
// at 6.5 kn, the drag-area hump Day & Nixon describe (and a small Gaussian
// at 3.5 kn). The tank drag area then falls because the hull planes.
// Planing is not modelled: above the hump, residuary keeps climbing with
// the same power, so a reach does not run away. Not a digitization of
// Figure 4 — the paper plots drag area, it does not tabulate it. Below
// the hump the bare-hull total (friction + this) stays inside the
// published 0.010–0.028 m² axis.
export const RESIDUARY_HUMP_M2 = 0.015;
export function residuaryDragArea(speedMs) {
  const fn = speedMs / Math.sqrt(G * LASER_HULL.lwl);
  const fnHump = PLANING_HUMP_MPS / Math.sqrt(G * LASER_HULL.lwl);
  const x = Math.max(fn / fnHump, 0);
  const major = RESIDUARY_HUMP_M2 * x ** 4;
  const fnSmall = (3.5 * KN_TO_MPS) / Math.sqrt(G * LASER_HULL.lwl);
  const z = (fn - fnSmall) / 0.06;
  const small = 0.0015 * Math.exp(-0.5 * z * z);
  return major + small;
}

// Bare hull (friction + residuary), no foils, no scale. m².
export function bareHullDragArea(speedMs) {
  return frictionalDragArea(speedMs) + residuaryDragArea(speedMs);
}

// Induced drag of the foils (N) from the sail side force. q = ½ρV²,
// R_i = F² / (π q span²). Floored speed so a near-stop does not explode.
export function inducedDragNewtons(sideForceN, speedMs, spanM = LASER_FOIL_SPAN_M) {
  const f = Number.isFinite(sideForceN) ? sideForceN : 0;
  const v = Math.max(speedMs, 0.5);
  const q = 0.5 * RHO_WATER * v * v;
  return (f * f) / (Math.PI * q * spanM * spanM);
}

// Total hydrodynamic resistance along the velocity, newtons.
// sideForceN is the sail side force (last tick is fine): induced drag.
export function hullResistanceNewtons(speedMs, sideForceN = 0) {
  if (!(speedMs > 0)) return 0;
  const cdA = frictionalDragArea(speedMs)
    + (residuaryDragArea(speedMs) + FOIL_DRAG_AREA) * HULL_DRAG_SCALE;
  const viscous = 0.5 * RHO_WATER * speedMs * speedMs * cdA;
  return viscous + inducedDragNewtons(sideForceN, speedMs);
}

// Close-hauled and beam-reach boat speeds (m/s) for an 80 kg sailor.
// Close-hauled: Day 2017, flat water, VMG-best true-wind angle near 45°
// (the autopilot holds 50°, which Day finds still on the flat part of
// the upwind polar). Speed sits near 5 kn and barely rises once the
// sailor is depowering, from about 9 kn / 4.6 m/s. Beam reach: a
// displacement speed, held near the 6.5 kn hull-speed hump. Real beam
// reaches above that plane; this model does not, so those targets are
// the displacement limit, not a planing polar.
// extrapolated: true wind above Day 2017's 5–15 kn range.
export const LASER_POLAR = Object.freeze([
  { tws: 3, close: 2.20, beam: 2.70, extrapolated: false },
  { tws: 4, close: 2.45, beam: 3.05, extrapolated: false },
  { tws: 5, close: 2.60, beam: 3.30, extrapolated: false },
  { tws: 6, close: 2.72, beam: 3.45, extrapolated: false },
  { tws: 8, close: 2.86, beam: 3.60, extrapolated: true },
  { tws: 10, close: 2.95, beam: 3.75, extrapolated: true },
]);
