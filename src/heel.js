// Dinghy heel: one roll degree of freedom per boat (no DOM, no planck).
//
// Sign convention: heel phi > 0 is the boat rolled toward her body-local +X
// side (the side a +X sail side force pushes her to). heel_deg on the frame
// carries that sign. The crew sits on the side opposite the heel moment
// (windward); hike is signed the same way as the moment it rights.
//
// Equations (SI, per tick, dt = 1/30 s split into HEEL_SUBSTEPS):
//   M_heel  = F_side · h_CE · cos(phi)                 heeling moment
//     F_side: sail force component perpendicular to the centreline, in N
//     (dinghy-forces.js sailDynamicNewtons). The rigid body integrates that
//     same vector in the internal unit (× internalForcePerNewton). Already
//     reduced by the heel factor below.
//   M_hull  = Δ · g · GZ(phi)                          hull form stability
//     Δ = boat (hull + rig) mass; GZ is a tabulated dinghy righting-arm
//     curve (odd in phi): small GM (~0.29 m), peak ~0.21 m at 50°,
//     vanishing at 90°.
//   M_crew  = m_crew · g · arm · hike · cos(phi)        crew righting moment
//   I·phi'' = M_heel − M_hull − M_crew − c·phi'
//   Integration: semi-implicit (symplectic) Euler on substeps; the damping
//   term is implicit (ω ← (ω + dt·M/I) / (1 + dt·c/I)), so it is stable for
//   any c at the tick rate.
//
// Automatic crew (no sail trim): each tick the crew aims for the hike that
// holds the target heel (HEEL_TARGET_DEG to leeward):
//   hike* = (M_heel − Δ g GZ(phi_t)) / (m_crew g arm cos phi)
//           + K_phi (phi − phi_t) + K_omega phi'
// clamped to [0, 1] on the windward side, and the actual hike moves toward
// it at most CREW_RATE (fraction per second), so tacks take time. Fully
// hiked and still overpowered, heel grows past the target.
//
// Sail force reduction: each sail sees only the wind component normal to the
// heeled mast, v·cos(phi), so dynamic pressure (and lift and drag at the
// same angle of attack) scale with cos²(phi). Equivalently the projected
// area seen by the horizontal wind is A·cos(phi) and the force on it tilts
// out of the horizontal plane by another cos(phi). boat.js applies
// heelForceFactor(phi) = cos²(phi) to both sails' lift and drag, so
// propulsion, the summed side force and the lattice wake momentum
// (mainsail_force, the sum) all see it. The roll moment uses that summed
// side force at this ceHeight.
//
// Top-down CE / CLR offsets (2D): each sail's force at sailCeOffsetX(phi) =
// ceLateralHeight·sin(phi) to leeward (same lateral station; the sails
// differ fore-and-aft); centreboard at clrOffsetX(phi) = −clrDepth·sin(phi)
// to windward. Heel roll still uses ceHeight (CE above CLR) on the summed
// side force. Each sail's apply point goes through planck applyForce, so
// the yaw moment is the two forces at their own centres. ceLateralHeight
// is tuned for slight weather helm with CLR on; it is not forced to equal
// ceHeight − clrDepth.
//
// Capsize: past HEEL_CAPSIZE_DEG the heel is clamped there (roll rate
// zeroed) and capsized = true; the flag clears once heel drops back below
// HEEL_CAPSIZE_CLEAR_DEG. Flag only: no righting manoeuvre.

export const DEG = Math.PI / 180;
export const G = 9.81;
export const RHO_AIR = 1.225;

// Laser-like defaults. Boat (hull + rig) 59 kg, crew 80 kg (ILCA 7 sailors
// ~75–85 kg), sail area 7.06 m² (ILCA 7), centre of effort ~2.5 m above the
// centre of lateral resistance (CE ~2.0 m above deck plus ~0.5 m to the
// centreboard's centre), crew CG at full hike ~1.0 m from the centreline
// (half beam 0.69 m plus the legs-out lean). Roll inertia: crew 80 kg at
// ~0.8 m plus hull/rig ~59 kg at ~0.5 m gives ~66; 80 kg·m² with added
// water mass. Damping ~0.9 of critical against the hull stiffness Δ g GM (hull
// plus centreboard and rudder roll damping).
export const DINGHY_DEFAULTS = Object.freeze({
  boatMass: 59,          // kg, hull + rig ("displacement" for the hull GZ)
  crewMass: 80,          // kg
  sailArea: 7.06,        // m², ILCA 7 total. Main + jib keep this sum.
  // Mainsail's share of sailArea. International 470 (470 Sailing,
  // https://www.470.org/en/about-the-470-2): mainsail 9.12 m², jib 3.58 m²
  // (12.70 m²; spinnaker excluded). Equals CLASS_470_MAIN_FRACTION in
  // dinghy-forces.js. The jib is the rest.
  mainAreaFraction: 9.12 / (9.12 + 3.58),
  ceHeight: 2.5,         // m, CE above CLR (roll lever only)
  clrDepth: 0.5,         // m, CLR below waterline; lateral CLR = −clrDepth·sinφ
  // Top-down CE height above waterline. Smaller than (ceHeight − clrDepth) so
  // weather helm stays slight once CLR also shifts; roll still uses ceHeight.
  ceLateralHeight: 0.5,  // m; lateral CE = ceLateralHeight·sinφ
  hikeArm: 1.0,          // m, crew CG off the centreline at full hike
  // Lateral shift of the immersed hull's drag centre at 90° of heel.
  // ILCA beam is 1.37 m (half-beam 0.685 m). Heeled, the centre of the
  // immersed section sits inboard of the deck edge; 0.40 m is about 0.6
  // of the half-beam. Offset = +hullDragLateral·sinφ, leeward, same sign
  // as the sail CE.
  hullDragLateral: 0.40,
  rollInertia: 80,       // kg·m²
  rollDamping: 200,      // N·m·s/rad
  targetHeelDeg: 5,      // crew holds this much heel to leeward
  crewRate: 1.0,         // hike fraction per second (centre to full: 1 s)
  crewGain: 2,           // extra hike per rad of heel error
  crewRateGain: 1.5,     // extra hike per rad/s of roll rate (crew anticipates)
  capsizeDeg: 65,
  capsizeClearDeg: 55,
  // GZ (m) at 0, 10, …, 90°.
  gzTable: Object.freeze([0, 0.05, 0.10, 0.15, 0.19, 0.21, 0.20, 0.15, 0.08, 0]),
});

export const HEEL_SUBSTEPS = 4;

// Righting arm GZ(phi) in m, odd in phi, linear between 10° table points,
// zero beyond 90° (a dinghy past 90° has no positive stability).
export function gz(phi, table = DINGHY_DEFAULTS.gzTable) {
  const s = Math.sign(phi);
  const d = Math.abs(phi) / DEG;
  if (d >= 90) return 0;
  const i = Math.floor(d / 10);
  const t = d / 10 - i;
  return s * (table[i] + (table[i + 1] - table[i]) * t);
}

export function heelForceFactor(phi) {
  const c = Math.cos(phi);
  return c * c;
}

// Top-down leeward CE offset (m, body-local +X): sail force application
// point at ceLateralHeight·sin(φ). φ > 0 → +X (leeward).
export function sailCeOffsetX(phi, p = DINGHY_DEFAULTS) {
  return p.ceLateralHeight * Math.sin(phi);
}

// Top-down windward CLR offset (m, body-local +X): centreboard force
// application point moves to −z_CLR·sin(φ). φ > 0 → −X (windward).
export function clrOffsetX(phi, p = DINGHY_DEFAULTS) {
  return -p.clrDepth * Math.sin(phi);
}

// Top-down leeward offset of hull drag (m, body-local +X). φ > 0 → +X.
export function hullDragOffsetX(phi, p = DINGHY_DEFAULTS) {
  return p.hullDragLateral * Math.sin(phi);
}

export function createHeelState() {
  return { phi: 0, omega: 0, hike: 0, capsized: false, mHeel: 0, mHull: 0, mCrew: 0 };
}

export function heelMoment(fSideN, phi, p = DINGHY_DEFAULTS) {
  return fSideN * p.ceHeight * Math.cos(phi);
}
export function hullMoment(phi, p = DINGHY_DEFAULTS) {
  return p.boatMass * G * gz(phi, p.gzTable);
}
export function crewMoment(hike, phi, p = DINGHY_DEFAULTS) {
  return p.crewMass * G * p.hikeArm * hike * Math.cos(phi);
}

// Hike the crew aims for (signed, |·| ≤ 1, on the windward side).
export function crewTarget(mHeel, phi, p = DINGHY_DEFAULTS, omega = 0) {
  const side = mHeel >= 0 ? 1 : -1;
  const phiT = side * p.targetHeelDeg * DEG;
  const full = p.crewMass * G * p.hikeArm * Math.max(0.2, Math.cos(phi));
  let h = (mHeel - hullMoment(phiT, p)) / full + p.crewGain * (phi - phiT) + p.crewRateGain * omega;
  h *= side;                       // magnitude on the windward side
  h = Math.max(0, Math.min(1, h));
  return side * h;
}

// Advance one tick. fSideN: sail side force (N, body +X positive) this tick.
export function stepHeel(st, fSideN, dt, p = DINGHY_DEFAULTS) {
  if (!Number.isFinite(fSideN)) fSideN = 0;
  // Crew moves toward its target at a finite rate.
  const mh0 = heelMoment(fSideN, st.phi, p);
  const want = crewTarget(mh0, st.phi, p, st.omega);
  const dh = p.crewRate * dt;
  st.hike += Math.max(-dh, Math.min(dh, want - st.hike));
  const n = HEEL_SUBSTEPS, h = dt / n;
  for (let k = 0; k < n; k++) {
    const mH = heelMoment(fSideN, st.phi, p);
    const mR = hullMoment(st.phi, p) + crewMoment(st.hike, st.phi, p);
    st.omega = (st.omega + h * (mH - mR) / p.rollInertia) / (1 + h * p.rollDamping / p.rollInertia);
    st.phi += h * st.omega;
  }
  const lim = p.capsizeDeg * DEG;
  if (Math.abs(st.phi) >= lim) {
    st.phi = Math.sign(st.phi) * lim;
    st.omega = 0;
    st.capsized = true;
  } else if (st.capsized && Math.abs(st.phi) < p.capsizeClearDeg * DEG) {
    st.capsized = false;
  }
  if (!Number.isFinite(st.phi) || !Number.isFinite(st.omega)) { st.phi = 0; st.omega = 0; }
  st.mHeel = heelMoment(fSideN, st.phi, p);
  st.mHull = hullMoment(st.phi, p);
  st.mCrew = crewMoment(st.hike, st.phi, p);
  return st;
}
