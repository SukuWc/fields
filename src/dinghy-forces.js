// Sail force and hull resistance in newtons, shared by the heel model and
// the rigid body. No DOM.
//
// Apparent wind must be built in one unit. Boat velocity is m/s (world
// metres, 30 Hz). Wind inside the sail model is the internal unit
// (WIND_UNIT_MPS = 0.3 m/s). Adding those two vectors counts 1 m/s of
// boat speed as 0.3 m/s of wind, so upwind AWS — and therefore sail
// force — is low. Callers pass both in m/s (apparentWindMs).
//
// Each sail, then the sum:
//   F_N = ½ ρ_air A aws² C cos²(heel) · SAIL_FORCE_SCALE
// A and C belong to that sail. Both sails use the boat's apparent wind
// (boat.js); each boom makes its own angle of attack. The areas add up
// to sailArea, so a rig whose sails see the same coefficients produces
// the calibrated total.
// The heel DOF takes the sum of the side components in newtons (one
// ceHeight, so the heeling moment is the sum of the two moments). Boom
// height is not that lever. The rigid body mass is hull + crew in
// kilograms. In the top-down plane each sail's force starts on that
// sail's sheeted boom and then walks ceLateralHeight·sinφ to leeward
// (heel.js sailCeOffsetX), so the yaw moment is the rigid-body moment
// of those two forces. applyForce is multiplied by FORCE_PASSES,
// therefore each vector passed in is F_N / FORCE_PASSES
// (internalForcePerNewton). Foil lift and drag are computed in src/foil.js
// and converted the same way. The lattice wake stays on the legacy
// internal vector of the sum, on the mainsail segment.
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

// International 470 class association, "About the 470"
// (https://www.470.org/en/about-the-470-2): mainsail 9.12 m², jib 3.58 m²,
// stated total 12.70 m². The spinnaker (13.00 m²) is not part of this rig.
// DINGHY_DEFAULTS.mainAreaFraction is this ratio. sailArea stays 7.06 m²
// (ILCA 7), the area the polars and the full-hike wind were calibrated on;
// only the split changes.
export const CLASS_470_MAIN_M2 = 9.12;
export const CLASS_470_JIB_M2 = 3.58;
export const CLASS_470_MAIN_FRACTION = CLASS_470_MAIN_M2 / (CLASS_470_MAIN_M2 + CLASS_470_JIB_M2);

// No jib-to-main slot factor. Gentry, "The Aerodynamics of Sail
// Interaction" (Proceedings of the 3rd AIAA Symposium on the
// Aero/Hydronautics of Sailing, 1971), showed the slot is not a Venturi
// speed-up with one multiplier: the jib's upwash changes the main's
// angle of attack, and that needs a flow model this rig does not have.
// Both sails use the boat's one lift and drag table.

export function sailAreas(p = DINGHY_DEFAULTS) {
  const fraction = p.mainAreaFraction;
  const main = p.sailArea * fraction;
  return { main, jib: p.sailArea - main, fraction };
}

// Chordwise station of a triangular sail's centre of area, measured from
// the tack / gooseneck toward the clew. A mainsail's head and tack are
// both the mast in plan view, so this fraction lands on the boom.
// Larsson & Eliasson, Principles of Yacht Design, take that centre of
// area as the centre of effort. Boom angle 0 sheets the clew dead aft
// (body +Y). boat.js then adds ceLateralHeight·sinφ to leeward of the
// boom point; that walk is not part of the station on the spar.
export const SAIL_CE_CHORD_FRACTION = 1 / 3;

// Clew offset from the tack / gooseneck, body axes. +Y is aft. A positive
// boom angle swings the clew toward −X (the formula the sail drawing uses).
export function clewOffset(boomLength, boomRad) {
  return {
    x: -Math.sin(boomRad) * boomLength,
    y: Math.cos(boomRad) * boomLength,
  };
}

// Point on a boom. fraction 0 is the tack / gooseneck, 1 is the clew.
// The spar is the straight tack-to-clew line, not the cambered cloth.
export function boomStation(originX, originY, boomLength, boomRad, fraction) {
  const along = clewOffset(boomLength, boomRad);
  return {
    x: originX + along.x * fraction,
    y: originY + along.y * fraction,
  };
}

// Orthogonal projection of a plan point onto a boom segment. The result
// stays on the spar (fraction clamped to [0, 1]).
export function projectOntoBoom(point, originX, originY, boomLength, boomRad) {
  const dir = clewOffset(boomLength, boomRad);
  const len2 = dir.x * dir.x + dir.y * dir.y;
  if (!(len2 > 0) || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return { x: originX, y: originY, fraction: 0 };
  }
  let fraction = ((point.x - originX) * dir.x + (point.y - originY) * dir.y) / len2;
  if (fraction < 0) fraction = 0;
  if (fraction > 1) fraction = 1;
  return {
    x: originX + dir.x * fraction,
    y: originY + dir.y * fraction,
    fraction,
  };
}

// Mainsail plan centroid. Head and tack are both the mast, so the centre
// of area already lies on the boom, one third of the way from the
// gooseneck to the clew (Larsson & Eliasson, Principles of Yacht Design,
// take that centre of area as the centre of effort). The sheeted boom is
// the pose: an eased boom puts this point outboard, not on the centreline.
// No extra aft shift. The old mainCeBalanceAft station (area-weighted rig
// centre at body y = −0.05 with both booms amidships) was there to keep
// the pre-split rudder; the boom point does not restore it.
export function mainBoomForceLocal(mastY, boomLength, boomRad) {
  return boomStation(0, mastY, boomLength, boomRad, SAIL_CE_CHORD_FRACTION);
}

// Jib plan centroid: average of tack (stem, the boom's forward end), head
// (mast) and clew (boom end). The head is not on the foot, so this point
// sits inboard of the jib boom once the boom is eased.
export function jibCentroidLocal(tackY, mastY, boomLength, boomRad) {
  const clew = clewOffset(boomLength, boomRad);
  return {
    x: clew.x / 3,
    y: (tackY + mastY + (tackY + clew.y)) / 3,
  };
}

// Where the jib force starts: the centroid dropped perpendicularly onto
// the jib boom (the foot, tack to clew — the spar jib_boom_length draws).
// Amidships the centroid already lies on that spar. Eased, the projection
// stays on the segment; this rig's 1.2 m luff and 1.4 m foot keep it
// there for |boom| ≤ 90°, and the clamp holds it on the spar otherwise.
export function jibBoomForceLocal(mastY, tackY, boomLength, boomRad) {
  return projectOntoBoom(jibCentroidLocal(tackY, mastY, boomLength, boomRad), 0, tackY, boomLength, boomRad);
}

// Apparent-wind angle in the boat's convention: degrees, +/−180, 0 = from
// the bow. `aw` is the from-vector from apparentWindMs. `hullAngleRad` is
// the wrapped hull angle boat.js uses for this.awa.
export function apparentWindAngleDeg(aw, hullAngleRad) {
  let awa = Math.atan2(aw.y, aw.x) * 180 / Math.PI - hullAngleRad * 180 / Math.PI + 90;
  if (awa > 180) awa -= 360;
  if (awa < -180) awa += 360;
  return awa;
}

// Backed jib on a slow tack. The boom normally tracks half the apparent
// wind (boat.js), so through head-to-wind the jib arrives amidships and
// luffs. A real sheet stays cleated. Left on the old side once the bow is
// past head-to-wind, the sail fills from the wrong side: angle of attack
// is the angle between that chord and the apparent wind, and sailLiftDrag
// already resolves the force (lift perpendicular to the apparent wind,
// signed by which side the wind is on, drag downwind). The jib's centre
// of effort is forward of the centre of lateral resistance (Larsson &
// Eliasson, Principles of Yacht Design — the same centre jibBoomForceLocal
// uses), so that transverse force yaws the bow off onto the new tack.
// Marchaj, Aero-Hydrodynamics of Sailing, treats a sail aback the same
// way: the aerodynamic force at the angle between chord and wind, applied
// forward of the lateral resistance. Bethwaite, High Performance Sailing,
// holds the old headsail sheet through a light-air tack and lets it go
// once the bow has borne away or the boat has way on again. A tack that
// still has speed does not hold it.
//
// Gates measured on this hull in dev mode (uniform wind from +Y):
//   An autopilot tack at 8 m/s true wind bottoms near 1.0 m/s and about
//   20°/s, so it never enters. Scenario 6 crosses near 1.2 m/s and 15°/s.
//   Scenario 3 crosses near 0.74 m/s and 8°/s, which is the stall this
//   hold is for.
// Enter only within 12° of head-to-wind. Further off, the new sheet should
// fill; hauling the boom back would fight a tack that is already through
// (scenario 6 is down to 0.76 m/s by 24° true-wind angle, still turning).
export const JIB_BACKWIND_ENTER_TWA_DEG = 12;
export const JIB_BACKWIND_ENTER_SPEED_MPS = 0.85;
export const JIB_BACKWIND_ENTER_YAW_DEG_S = 12;
// Borne away enough for the new sheet, short of this sim's 40° close-hauled
// Rule 13 gate, or steerage way back (rudder foil force is usable again).
export const JIB_BACKWIND_RELEASE_TWA_DEG = 30;
export const JIB_BACKWIND_RELEASE_SPEED_MPS = 1.2;
// A sheet this close to the centreline does not back; it is already luffing.
export const JIB_BACKWIND_MIN_SHEET_DEG = 8;
// Remember the boom once she is at least this far off the wind, and stop
// updating inside it, so the held angle is the working sheet as she enters
// the tack rather than the luff at head-to-wind.
export const JIB_BACKWIND_MEMORY_TWA_DEG = 38;

// One sheeting decision. `prev` is the last return value (or null).
// `sample`: { twa, awa, boomTrim, speedMs, yawDegS, depower, enabled }.
// `boomTrim` is the boom that would follow the apparent wind this step.
// The sheet is held only once `awa` is on the opposite side of the
// remembered boom. True wind can cross a step or two before apparent
// wind; holding through that gap oversheets the jib on the side the
// wind is still on, and that weather helm fights the tack.
// Returns { memory, held, backwinded, armed, boom }. `boom` is degrees,
// the same sign convention as boat.js (positive apparent wind, positive
// boom, clew to body −X). No force is computed here.
export function jibBackwindStep(prev, sample) {
  const p = prev && typeof prev === 'object' ? prev : null;
  let memory = p && Number.isFinite(p.memory) ? p.memory : 0;
  let held = p && Number.isFinite(p.held) ? p.held : 0;
  let backwinded = !!(p && p.backwinded);
  let armed = !p || p.armed !== false;
  const twa = sample.twa;
  const boomTrim = sample.boomTrim;
  const speed = sample.speedMs;
  const yaw = Math.abs(sample.yawDegS || 0);
  const depower = sample.depower || 0;
  const enabled = sample.enabled !== false;
  if (!Number.isFinite(twa) || !Number.isFinite(boomTrim) || !Number.isFinite(speed)) {
    return { memory, held: 0, backwinded: false, armed, boom: Number.isFinite(boomTrim) ? boomTrim : 0 };
  }
  const absTwa = Math.abs(twa);
  const twaSign = Math.sign(twa) || 0;
  const easing = depower > 0;
  // Working sheet on the tack she is sailing. Freeze it once she heads
  // up inside MEMORY_TWA, and don't record a sheet that is being eased.
  if (!easing && absTwa >= JIB_BACKWIND_MEMORY_TWA_DEG && absTwa <= 120
      && twaSign !== 0 && Math.sign(boomTrim) === twaSign
      && Math.abs(boomTrim) >= JIB_BACKWIND_MIN_SHEET_DEG) {
    memory = boomTrim;
  }
  // Armed again only once that remembered sheet belongs to the tack she
  // is on. A release in the middle of the same crossing does not re-back.
  if (absTwa >= JIB_BACKWIND_MEMORY_TWA_DEG && twaSign !== 0 && twaSign === Math.sign(memory)) armed = true;
  const memSign = Math.sign(memory);
  const opposite = memSign !== 0 && twaSign !== 0 && twaSign !== memSign;
  const awaSign = Number.isFinite(sample.awa) ? Math.sign(sample.awa) : 0;
  // Wind on the wrong side of the remembered sheet. A sub-degree flicker
  // is not a filled sail.
  const windAback = awaSign !== 0 && memSign !== 0 && awaSign !== memSign && Math.abs(sample.awa) >= 0.5;
  const slow = speed < JIB_BACKWIND_ENTER_SPEED_MPS && yaw < JIB_BACKWIND_ENTER_YAW_DEG_S;
  const inWindow = opposite && absTwa <= JIB_BACKWIND_ENTER_TWA_DEG;
  if (backwinded) {
    // Sign 0 is head-to-wind: keep the sheet. Releasing on that sample
    // would drop the back every time the bow kissed the wind. She has
    // fallen back only once the old tack is a real angle again.
    const heldSign = Math.sign(held);
    const fellBack = twaSign !== 0 && heldSign !== 0 && twaSign === heldSign
      && absTwa >= JIB_BACKWIND_ENTER_TWA_DEG;
    if (!enabled || easing || heldSign === 0 || absTwa >= JIB_BACKWIND_RELEASE_TWA_DEG
        || speed >= JIB_BACKWIND_RELEASE_SPEED_MPS || fellBack) {
      backwinded = false;
    }
  }
  if (enabled && !backwinded && armed && !easing && inWindow && slow && windAback
      && Math.abs(memory) >= JIB_BACKWIND_MIN_SHEET_DEG) {
    backwinded = true;
    held = memory;
    armed = false;
  }
  return {
    memory,
    held: backwinded ? held : 0,
    backwinded,
    armed,
    boom: backwinded ? held : boomTrim,
  };
}

// World-frame lift and drag of one sail. `sailK` is newtons per unit C in
// the pre-applyFinite unit (sailDynamicNewtons × internalForcePerNewton).
// Drag is down the apparent wind; lift is perpendicular, signed by AWA.
// A backed jib uses this unchanged: the boom stays on the old side, so
// the angle of attack is large and the apparent wind is on the wrong
// side of the chord. The sign of the lift follows the wind, which is the
// direction a sail held aback is pushed.
export function sailLiftDrag(hullAngleRad, awaDeg, sailK, cl, cd) {
  const awaRad = awaDeg * Math.PI / 180;
  const drag = {
    x: Math.cos(hullAngleRad + awaRad + Math.PI / 2) * sailK * cd,
    y: Math.sin(hullAngleRad + awaRad + Math.PI / 2) * sailK * cd,
  };
  const sgn = Math.sign(awaDeg);
  const lift = {
    x: -sgn * Math.cos(hullAngleRad + awaRad) * sailK * cl,
    y: -sgn * Math.sin(hullAngleRad + awaRad) * sailK * cl,
  };
  return { lift, drag };
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
