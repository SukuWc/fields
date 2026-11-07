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
// The heel DOF takes the side component in newtons. The rigid body mass
// is hull + crew in kilograms, so the hull integrates that same F_N.
// applyForce is multiplied by FORCE_PASSES, therefore the vector passed
// in is F_N / FORCE_PASSES (internalForcePerNewton). Foil lift and drag
// are computed in src/foil.js and converted the same way. The lattice
// wake stays on the legacy internal sail vector.
//
// The old split was sail_efficiency = 0.15/3 on the body only, with
// sailForceToNewtons dividing it back out for heel. Those were not the
// same force. sail_efficiency is gone.

import { DINGHY_DEFAULTS, G, RHO_AIR } from './heel.js';

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

// Daggerboard span used only by the old induced-drag stand-in. Foil
// geometry now lives in foil.js.
export const LASER_FOIL_SPAN_M = 0.90;

// Day 2017 covers 5–15 kn. Above this true wind the polars are an
// extrapolation, not a validation.
export const POLAR_VALIDATED_TWS_MPS = 7.7;

// 6.5 kn: Day & Nixon, drag-area hump, where the hull starts to plane
// and measured drag area then falls. This model does not plane.
export const PLANING_HUMP_KN = 6.5;
const KN_TO_MPS = 0.514444;
export const PLANING_HUMP_MPS = PLANING_HUMP_KN * KN_TO_MPS;

// ILCA hull length. The drawn collision polygon is 4.0 m (y −2.25 to 1.75);
// yaw inertia uses the real length.
export const LASER_LOA_M = 4.23;

// Hull+rig yaw gyradius as a fraction of LOA. A uniform rod is 1/√12 ≈ 0.289.
// A Laser is fuller amidships than a rod, so the usual small-craft value
// 0.25 is a bit under that.
export const HULL_YAW_GYRADIUS_OVER_LOA = 0.25;
// Seated sailor, centre of gravity at the boat CG (cockpit, near the
// centre). Own radius of gyration about a vertical axis through that CG.
export const CREW_YAW_GYRADIUS_M = 0.35;

export function dinghyTotalMass(p = DINGHY_DEFAULTS) {
  return p.boatMass + p.crewMass;
}

// kg·m² about the vertical axis through the combined centre of gravity.
export function yawInertia(p = DINGHY_DEFAULTS) {
  const kHull = HULL_YAW_GYRADIUS_OVER_LOA * LASER_LOA_M;
  return p.boatMass * kHull * kHull + p.crewMass * CREW_YAW_GYRADIUS_M * CREW_YAW_GYRADIUS_M;
}

// Drawn hull polygon area is 4.4375 m². Density 6 made the rigid body
// 26.625 kg. Kept only so impulses and the mark spring, which were tuned
// at that mass, can be scaled onto the real mass.
export const LEGACY_DENSITY_MASS_KG = 26.625;

// Legacy body coefficient (boat.js `0.15/3`, "was 0.35"). Not equal to
// ½ρA·WIND_UNIT². The centreboard and rudder formulas are still in the
// unit where this was the sail scale.
export const LEGACY_SAIL_EFF = 0.15 / 3;

// Old pre-applyFinite sail force per newton: LEGACY_SAIL_EFF / (½ρA wu²).
export function legacyInternalPerNewton(area, windUnit) {
  const dyn = 0.5 * RHO_AIR * area * windUnit * windUnit;
  return LEGACY_SAIL_EFF / dyn;
}

// Residual multiplier on ½ρAV²C after the apparent-wind unit fix.
// 1 = the lift/drag tables and the corrected AWS, with no extra scale.
// With that, dev-mode close-hauled hike still saturates at about 6.6 m/s.
// 1.45 brings first full hike to about 5.5 m/s (target 5–6; Day 2017's
// 80 kg sailor starts depowering near 4.6 m/s / 9 kn, and this model has
// no sheet-spill, only cos²(heel)). Heel and the hull both see it.
export const SAIL_FORCE_SCALE = 1.45;

// Residuary multiplier. 1 is the Day & Nixon shaped curve (friction is
// never scaled). The old 1.55 covered that curve plus a foil-drag area
// and a separate induced-drag term. Those foil terms are gone: lift and
// drag now come from foil.js. What is left is the hull, and this hull
// has no sheet-spill once the crew is hiked out, so upwind speed runs
// past Day 2017 unless residuary is stiffened. 2.40 is that residual,
// fitted after the foils were made explicit. It is not a foil allowance.
export const HULL_DRAG_SCALE = 2.40;

// Pre-applyFinite force per newton. applyFinite multiplies by FORCE_PASSES
// and the body mass is in kilograms, so the integrated force is F_newton
// when this is 1/FORCE_PASSES.
export function internalForcePerNewton(forcePasses) {
  return 1 / forcePasses;
}

// Centreboard and rudder used to return the legacy internal unit.
// hydroToInternal is that bridge. The foils (foil.js) no longer use it.
export function hydroToInternal(area, windUnit, forcePasses) {
  return internalForcePerNewton(forcePasses) / legacyInternalPerNewton(area, windUnit);
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

// Bare hull only: ITTC friction on the published wetted area, plus the
// residuary curve. Foil profile and induced drag are not included.
export function hullResistanceNewtons(speedMs) {
  if (!(speedMs > 0)) return 0;
  const cdA = frictionalDragArea(speedMs) + residuaryDragArea(speedMs) * HULL_DRAG_SCALE;
  return 0.5 * RHO_WATER * speedMs * speedMs * cdA;
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
