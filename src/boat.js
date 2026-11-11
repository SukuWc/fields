import planck from 'planck-js';
import { aeroCoefficients } from './utils.js';
import {
  resetPenaltyManeuvers,
  updatePenaltyManeuvers,
  updateTackingState,
} from './rules.js';
import { WIND_UNIT_MPS, boatTrueWind } from './wind.js';
import { DINGHY_DEFAULTS, createHeelState, heelForceFactor, hullDragOffsetX, sailCeOffsetX, clrOffsetX, stepHeel } from './heel.js';
import { apparentWindAngleDeg, apparentWindMs, clewOffset, dinghyTotalMass, hullResistanceNewtons, internalForcePerNewton, jibBackwindStep, jibBoomForceLocal, LEGACY_DENSITY_MASS_KG, legacyInternalPerNewton, mainBoomForceLocal, sailAreas, sailDynamicNewtons, sailLiftDrag, yawInertia } from './dinghy-forces.js';
import { DAGGERBOARD, foilForceNewtons, RUDDER_BLADE } from './foil.js';

const wrap360 = (d) => ((d % 360) + 360) % 360;

// Instrument readout fields carried on every renderState (frame state.boats[i],
// same in local, worker and remote; numbers only, so the wire codec carries
// them unchanged):
//   aws_ms       apparent wind speed, m/s
//   tws_ms       true wind speed at the boat, m/s (last finite value; the
//                calm-water value before the first step)
//   heading_deg  compass bearing the bow points to, 0–360 (0 = north = +Y,
//                90 = east = +X, clockwise)
//   twd_deg      compass bearing the true wind comes FROM, 0–360
//   heel_deg     heel angle, degrees, signed: + = rolled to body-local +X
//                (heel.js); 0 before the first step
//   hike_pct     crew hike 0–100 (0 = on the centreline, 100 = full hike,
//                always on the windward side)
//   sail_eff_pct sail force remaining as %, heelForceFactor(phi)×100
//                (cos²(heel); 100 upright, 25 at 60°)
//   rudder_deg   signed rudder angle, degrees (boat.rudder_angle; positive
//                yaws clockwise when the boat has way on)
//   capsized     1 only while past the heel limit (absent otherwise)
//   jib_backwinded  1 while the jib is held sheeted on the old tack through
//                a slow head-to-wind (absent otherwise). The drawn jib boom
//                (jba) stays on that side; the mainsail boom does not.
// Raw angles (kept): ha / pa are math radians with the bow on local −Y, so
// the bow points at math angle ha − 90°; wd is the math angle (0 = +X,
// counter-clockwise) the wind comes from. Compass = 90° − math angle.
export function headingBearing(ha) { return wrap360(180 - ha * 180 / Math.PI); }
export function windFromBearing(wdMathDeg) { return wrap360(90 - wdMathDeg); }
function readoutFields(b) {
  const o = {};
  if (Number.isFinite(b._awsMs)) o.aws_ms = b._awsMs;
  const tws = Number.isFinite(b._twsMs) ? b._twsMs : (Number.isFinite(b.wind_speed) ? b.wind_speed * WIND_UNIT_MPS : 0);
  o.tws_ms = tws;
  if (Number.isFinite(b.hull_angle)) o.heading_deg = headingBearing(b.hull_angle);
  if (Number.isFinite(b.wind_direction)) o.twd_deg = windFromBearing(b.wind_direction);
  if (b.heel) {
    o.heel_deg = b.heel.phi * 180 / Math.PI;
    o.hike_pct = Math.abs(b.heel.hike) * 100;
    o.sail_eff_pct = heelForceFactor(b.heel.phi) * 100;
    if (b.heel.capsized) o.capsized = 1;
  }
  if (Number.isFinite(b.rudder_angle)) o.rudder_deg = b.rudder_angle;
  return o;
}
import {
  BEST_VMG_DOWNWIND_DEG,
  BEST_VMG_UPWIND_DEG,
  autopilotGuideTarget,
  boatGuides,
  penaltyTurnExitTarget,
} from './boat-draw.js';

// Lattice momentum per frame = sail reaction × SAIL_LATTICE_COUPLING.
//
// Planck applyForce integrates the sail force over dt = 1/30. Lattice velocity
// is the UI wind speed / 100, so the equal-and-opposite impulse is F×dt/100.
// 0.0003 is that exchange (1/30/100 is 0.000333). It moves the boat's own
// momentum, about one percent of the wind through the sail, and the speed
// plot does not show it.
//
// Before convective rescaling, level 2 applied 1/dx² on each of four substeps
// (64× this impulse) and level 1 applied 8×. That level-dependent kick was
// the wake on the plot, and it is not coming back. SAIL_WAKE_GAIN is one
// multiple of the same impulse on every grid. The sail is sampled once per
// cell of the finest level under it, and each sample is spread bilinearly
// onto the nodes around that point. The kick is still ×1/dx once per substep,
// so the physical momentum of a sample matches its share of the sail. Those
// nodes keep the field they stream; they are not overwritten with the coarse cell.
//
// 16 is the largest multiple that stays comfortable at wind 25: the near-sail
// speed peaks near 0.34, under the lattice's ~0.5 stability edge, and
// scenario 0 holds about −50°. 32 is a deeper wake, but wind 25 reaches
// |u| ≈ 0.49 and the heading drifts past −55°. At wind 15 the speed plot
// swings by about 0.07 (roughly 50 colormap steps off the freestream).
export const SAIL_WAKE_GAIN = 16;
export const SAIL_LATTICE_COUPLING = 0.0003 * SAIL_WAKE_GAIN;


let pl = planck, Vec2 = pl.Vec2;
// Stable boat id (scenario boats 's<n>'); a spawned boat uses its spawnId.
let _nextBoatUid = 1;

// Q/E penalty-turn autopilot. The rudder is a PD on the degrees left to a
// full circle (and the yaw rate), so it eases off as she comes round and
// stops on the starting heading instead of holding hard over to 360° and
// carrying on. Done once she is within PENALTY_TURN_DONE_DEG with the yaw
// rate under PENALTY_TURN_DONE_RATE_DEG_S; the heading autopilot then holds
// the starting heading. Gains are rudder degrees per degree of heading left
// (KP) and per degree/second of yaw rate (KD), tuned headlessly in
// scripts/penalty-turn-check.mjs for under ~1.5° of overshoot at 1–2.2 m/s.
// The circle does not clear anything itself: its tack and gybe do, through
// updatePenaltyManeuvers, so one circle clears exactly one penalty.
// One sim pass per 30 Hz tick (main.js). The boat model was tuned when every
// world step got LEGACY_PASSES_PER_TICK = 3 passes: forces from all three
// passes summed in planck's force accumulator, impulses landed three times,
// and per-pass blends and rates ran three times. These constants convert each
// per-pass term to one pass per tick with the same per-second behaviour.
export const LEGACY_PASSES_PER_TICK = 3;
const N = LEGACY_PASSES_PER_TICK;
// Ghost prediction inputs are sent at 1 mm/s, 1 mrad/s (small frames).
const r3 = (x) => Math.round(x * 1000) / 1000;
// Per-pass exponential blend a, applied N times: 1 - (1 - a)^N.
const blendN = (a) => 1 - Math.pow(1 - a, N);
export const WIND_SMOOTH_ALPHA = blendN(0.2);          // 0.488
export const PENALTY_RUDDER_BLEND = blendN(0.45);      // 0.834
export const AUTOPILOT_RUDDER_BLEND = blendN(0.1);     // 0.271 (was /10 per pass)
// Old D term: only the first of the three passes saw the heading change
// (the hull angle moves only at world.step), and its kick went through three
// /10 lags (0.1·0.9² = 0.081 of it reached the rudder in the tick). One pass
// with blend 0.271 needs D × 0.081 / 0.271 for the same rudder response.
export const AUTOPILOT_KD = 100 * (0.1 * 0.81) / AUTOPILOT_RUDDER_BLEND; // 29.9
export const AUTOPILOT_KP = 2;
// Integral gain stays 0 unless a dev-config Apply sets autopilot_ki.
export const AUTOPILOT_KI = 0;
export const AUTOPILOT_SUM_DECAY = Math.pow(0.85, N);
// Forces (applyForce accumulates until world.step) and impulses per tick.
export const FORCE_PASSES = N;

// Depower toggle (X key, touch "Depower"): the sheets are eased fully. The
// boom angle ramps (0 → 1 over DEPOWER_RAMP_S) from trim toward lying along
// the apparent wind, limited by the boom max; lift and drag then come from
// the real angle of attack via the tables (upwind: AoA → 0, the sail luffs;
// dead downwind the boom is already at its limit, nothing changes). The
// lattice push uses mainsail_force, the sum of both sails in the legacy
// unit. The autopilot never changes it.
export const DEPOWER_RAMP_S = 0.5;
const DEPOWER_STEP = (1 / 30) / DEPOWER_RAMP_S;

// Sail flapping (visual only). A luffing sail is drawn with a travelling
// sine ripple: zero at the luff and leech, amplitude SAIL_FLAP_AMP_M (main) /
// SAIL_FLAP_JIB_AMP_M (jib) × luff amount × min(1, AWS / SAIL_FLAP_AWS_REF),
// at SAIL_FLAP_HZ. The luff amount is 1 − AoA / SAIL_FLAP_AOA_DEG from the
// main's actual angle of attack (1 at AoA 0, none from 12°), whatever the
// cause (depowered, in irons, eased too far). The
// phase counts graphics_model_render calls (one per 30 Hz tick), so the
// animation is deterministic. Nothing here feeds back into the physics.
export const SAIL_FLAP_HZ = 3;
export const SAIL_FLAP_AWS_REF = 15;
export const SAIL_FLAP_AOA_DEG = 12;
// The jib also flaps when running: it collapses in the main's shadow.
export const SAIL_FLAP_JIB_SHADOW_AWA_DEG = 150;

export const PENALTY_TURN_RUDDER_MAX = 50;
export const PENALTY_TURN_KP = 1.2;
export const PENALTY_TURN_KD = 1.6;
export const PENALTY_TURN_DONE_DEG = 2.5;
export const PENALTY_TURN_DONE_RATE_DEG_S = 10;
// Rudder kept on, in the direction still to turn, once the PD command drops
// below this. The boom yaw moment otherwise balances a few degrees of
// rudder and the circle parks just short of the start heading.
export const PENALTY_TURN_FINISH_RUDDER = 6;




/**
 * Rudder return-to-centre with no helm input: the per-pass decay factor
 * (0.98 - speed/80) is raised to this power, so the centring half-life is
 * 1/RUDDER_RETURN_SPEEDUP of the old one at every speed. Only when the
 * autopilot is off: autopilot steering keeps the old decay, and the
 * penalty-turn rudder is a separate branch, so both are unchanged.
 */
export const RUDDER_RETURN_SPEEDUP = 3;

/** Autopilot rudder limit. Was rudder_angle_max / 2 (60 / 2); pinned at 30° so
 *  the manual limit (rudder_angle_max) does not change autopilot tacks and
 *  bear-aways. A manual limit below 30° caps it too. */
export const AUTOPILOT_RUDDER_MAX = 30;

/** Manual helm hard-over, degrees each side (Boat.rudder_angle_max). Dev
 *  TOML rudder_max_deg (src/dev-config.js) sets it per boat within
 *  RUDDER_MAX_DEG_MIN..RUDDER_MAX_DEG_MAX. Was 45° (60° before that). The
 *  autopilot (AUTOPILOT_RUDDER_MAX) and penalty turns
 *  (PENALTY_TURN_RUDDER_MAX) keep their own limits, capped at this one. */
export const RUDDER_MAX_DEG = 60;
export const RUDDER_MAX_DEG_MIN = 10;
export const RUDDER_MAX_DEG_MAX = 90;

/** Autopilot heading-target change per sim tick while Up / Down is held (was 1°). */
export const AUTOPILOT_HEADING_STEP_DEG = 1.5;
// Sticky helm: max degrees the target may run ahead of the boat's heading.
export const AUTOPILOT_TURN_MAX_LEAD_DEG = 90;
export function wrapDeg180(a){ a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; }

export { BEST_VMG_DOWNWIND_DEG, BEST_VMG_UPWIND_DEG, autopilotSnapTarget } from './boat-draw.js';

export class Boat{

  constructor(map, x, y, hull_angle){

    this.map = map;
    this.uid = 's' + (_nextBoatUid++);

    this.x = x;
    this.y = y;

    if (hull_angle != undefined){
      this.hull_angle = hull_angle;
    }
    else{
      this.hull_angle = Math.PI
    }

    this.wind_direction = 0;
    this.wind_speed = 0;
    this.wind_vx_smooth = 0;
    this.wind_vy_smooth = 0;

    this.hull_shape = pl.Polygon([Vec2(0, -2.25), Vec2(-0.5, -1.25), Vec2(-0.75, -0.25),  Vec2(-0.75, 0.5),  Vec2(-0.5, 1.75), Vec2(0.5, 1.75),  Vec2(0.75, 0.5), Vec2(0.75, -0.25), Vec2(0.5, -1.25), Vec2(0, -2.25)])
   

    
    this.rudder_input = 0;
    this.motor_input = 0;


    this.rudder_angle = 0;
    this.rudder_angle_last = 0;
    this.rudder_angle_max = RUDDER_MAX_DEG;
    this.rudder_position = 1.8
    this.rudder_lenght = 0.5

    this.forces = []

    this.mainsail_leading_edge_position = -0.8
    this.mainsail_boom_length = 2.2

    this.mainsail_boom_angle_max = 80
    this.mainsail_boom_angle_factor = 0.5
    this.mainsail_boom_angle = 0
    this.mainsail_boom_angle_actual = 0

    this.jib_leading_edge_position = -2
    this.jib_boom_length = 1.4

    this.jib_boom_angle_max = 55
    // Sheet fraction of AWA, same as the main. The jib used to ease to
    // 0.65·AWA for the drawing, when it made no force. That sheet sits
    // about 4° below the main, on the steep 10–15° part of this lift
    // table, and the lost drive moved full hike from about 5.3 m/s to
    // about 5.8 m/s. Upwind, a headsail is sheeted to about the same
    // angle of attack as the main. The jib still stops at 55° while the
    // main goes to 80°, so on a reach and a run its angle of attack is
    // its own.
    this.jib_boom_angle_factor = 0.5
    this.jib_boom_angle = 0
    this.jib_boom_angle_actual = 0
    // Backwinded jib through a tack (dinghy-forces.js jibBackwindStep). On unless a
    // caller turns it off to compare the same tack with the sheet released.
    this.jibBackwinded = false;
    this.jibBackwindArmed = false;
    this.jibBackwindEnabled = true;
    this._jibBackwind = null;

    this.centerboard_position = -0.15;
    this.centerboard_length   = 0.6
    //
    this.aero_lookup_resolution = 5 //degrees
    this.aero_lift_lookup = [  0, 0.025, 0.15, 0.9, 1.3, 1.46, 1.52, 1.51, 1.45, 1.41, 1.33, 1.16, 0.95, 0.82, 0.73, 0.6, 0.43, 0.34, 0.28, 0.28, 0.28]
    this.aero_drag_lookup = [0.15, 0.15, 0.15, 0.16, 0.172, 0.19, 0.22, 0.25, 0.29, 0.34, 0.4, 0.47, 0.55, 0.635, 0.73, 0.83, 0.95, 1.1, 1.28, 1.28, 1.28]


    this.physics_model = undefined;
    
    this.power = 0;
    this.power_direction = 0;

    this.autopilot_enabled = false;
    this.depowered = false;
    this.depower = 0;
    this.penalty_turn = null;
    this.autopilot_heading_target = 0;
    this.autopilot_heading_input = 0;

    // Named best-VMG constants (boat-draw.js). Not a polar lookup.
    this.autopilot_heading_best_vmg_1 = BEST_VMG_UPWIND_DEG;
    this.autopilot_heading_best_vmg_2 = BEST_VMG_DOWNWIND_DEG;

    this.autopilot_compensator_p = 0;
    this.autopilot_compensator_i = 0;
    this.autopilot_compensator_d = 0;
    // Live PID. Defaults are the old hardcoded PD (I = 0). Dev TOML Apply
    // writes these by boat id; the step below reads them.
    this.autopilot_kp = AUTOPILOT_KP;
    this.autopilot_ki = AUTOPILOT_KI;
    this.autopilot_kd = AUTOPILOT_KD;

    this.autopilot_compensator_last_error = 0;
    this.autopilot_compensator_current_error = 0;
    this.autopilot_compensator_sum_error = 0;

    // Dinghy heel (heel.js): Laser-like parameters and roll state.
    this.dinghy = DINGHY_DEFAULTS;
    this.heel = createHeelState();
    // Top-down CE leeward + CLR windward offsets (heel.js sailCeOffsetX /
    // clrOffsetX). On by default; set false to compare centreline application.
    this.ceLeewardOffset = true;

    this.twa = 0;
    // Rule 13. updateTackingState maintains these from Map.get_wind each step.
    this.tacking = false;
    this.tackingOnto = null;

    this.physics_model_init()

  }

  // Id the client matches per-boat statics by (ghost hull): spawnId or uid.
  get boatId() { return this.spawnId || this.uid; }

  // Hull outline in body-local coordinates (static: sent once in statics.hulls).
  hullDef() {
    const body = this.physics_model;
    const f = body && body.getFixtureList();
    if (!f) return null;
    const v = [];
    for (const q of f.getShape().m_vertices) v.push(q.x, q.y);
    const c = body.getLocalCenter();
    return { v, com: [c.x, c.y] };
  }

  physics_model_init(){

    let pl = planck, Vec2 = pl.Vec2;
    

    // Planck damping decays velocity by a fraction per second, so the
    // equivalent force is −c·m·v. 0.1 was tuned at the 26.625 kg hull.
    // Scale c down with 1/mass so that force stays the same newton drag
    // on the 139 kg boat; the hull resistance model is the real drag.
    // Angular damping stays 0.5: it decays yaw rate the same way, and the
    // yaw inertia was raised in proportion to the rudder torque.
    const linearDamping = 0.1 * LEGACY_DENSITY_MASS_KG / dinghyTotalMass(this.dinghy);
    let boat = this.map.world.createBody({
      type : 'dynamic',
      angularDamping : 0.5,
      linearDamping,
      position : Vec2(this.x, this.y),
      angle : this.hull_angle,
      allowSleep : false
    });

    // Density only locates the geometric centre. Mass and yaw inertia are
    // the real dinghy (hull + crew) in kilograms and kg·m².
    boat.createFixture(this.hull_shape, 1);
    const mass = dinghyTotalMass(this.dinghy);
    const center = boat.getLocalCenter();
    const r2 = center.x * center.x + center.y * center.y;
    // setMassData wants I about the local origin.
    boat.setMassData({ mass, center, I: yawInertia(this.dinghy) + mass * r2 });

    this.physics_model = boat;

  }

  physics_model_deinit(){
    this.map.world.destroyBody(this.physics_model)
  }


  physics_model_step(){

    this.forces = []
    this.telemetry = null;

    const body = this.physics_model;
    const px = body.m_xf.p.x;
    const py = body.m_xf.p.y;
    const bvx = body.m_linearVelocity.x;
    const bvy = body.m_linearVelocity.y;
    const bang = body.m_angularVelocity;
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      body.setTransform({ x: this._safeX || 0, y: this._safeY || 0 }, 0);
      body.setLinearVelocity({ x: 0, y: 0 });
      body.setAngularVelocity(0);
      this.wind_vx_smooth = 0;
      this.wind_vy_smooth = 0;
      this.x = body.m_xf.p.x;
      this.y = body.m_xf.p.y;
      return;
    }
    if (!Number.isFinite(bvx) || !Number.isFinite(bvy) || !Number.isFinite(bang)) {
      body.setLinearVelocity({ x: 0, y: 0 });
      body.setAngularVelocity(0);
    } else {
      this._safeX = px;
      this._safeY = py;
    }
    const applyFinite = (force, point) => {
      if (!force || !point) return;
      if (!Number.isFinite(force.x) || !Number.isFinite(force.y)) return;
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      body.applyForce({ x: force.x * FORCE_PASSES, y: force.y * FORCE_PASSES }, point, true);
    };

    // Readout data for this step (info.js boatTelemetryHtml formats it).
    // Keys are added in readout order; a step that bails out early has fewer.
    const tel = this.telemetry = {};
    tel.autopilot = this.autopilot_enabled;
    tel.headingTarget = this.autopilot_heading_target;
    if (this.depowered || this.depower > 0) tel.depowered = this.depowered;
    // One tick per pass: ramp toward the toggle state.
    if (this.depowered) this.depower = Math.min(1, this.depower + DEPOWER_STEP);
    else this.depower = Math.max(0, this.depower - DEPOWER_STEP);
    // calculate boat dynamics


    this.x = this.physics_model.m_xf.p.x;
    this.y = this.physics_model.m_xf.p.y;


    
    // True wind at the boat: centre sample + own-sail-force undo on 2f (wind.js boatTrueWind).
    // mainsail_force is still last tick's value here, which matches the wake already in the field.
    const wind_raw = boatTrueWind(this) || this.map.get_wind(this.x, this.y);
    const alpha = WIND_SMOOTH_ALPHA;
    // A single non-finite sample used to latch the smoother (NaN + finite = NaN)
    // and every later force stayed NaN. Keep the last finite wind instead.
    if (wind_raw && Number.isFinite(wind_raw.vx) && Number.isFinite(wind_raw.vy)) {
      this.wind_vx_smooth = alpha * wind_raw.vx + (1 - alpha) * this.wind_vx_smooth;
      this.wind_vy_smooth = alpha * wind_raw.vy + (1 - alpha) * this.wind_vy_smooth;
    }
    this.wind_speed     = Math.sqrt(this.wind_vx_smooth**2 + this.wind_vy_smooth**2) * 100 * 4;
    this.wind_direction = Math.atan2(this.wind_vy_smooth, this.wind_vx_smooth) / Math.PI * 180 + 180;

    var angle = this.physics_model.getAngle();
    this.angle = angle;


    this.hull_angle = angle;

    while (angle < -Math.PI){
        angle+=2*Math.PI
    }

    while (angle > Math.PI){
        angle-=2*Math.PI;
    }

    // direct (forward) component of velocity vector
    let d = this.physics_model.m_linearVelocity.x*Math.cos(angle-Math.PI/2) + this.physics_model.m_linearVelocity.y*Math.sin(angle-Math.PI/2) 
    
    // quadrature (sideways) component of velocity vector
    let q = this.physics_model.m_linearVelocity.x*Math.cos(angle) + this.physics_model.m_linearVelocity.y*Math.sin(angle) 

    // Centreboard: NACA 0012 finite wing (foil.js). Inflow is the hull
    // velocity at the board. Lift ⟂ inflow, drag ∥ inflow, in newtons,
    // then ÷ FORCE_PASSES like the sail. Applied at the CLR offset.
    const perN = internalForcePerNewton(FORCE_PASSES);
    const cb = foilForceNewtons({
      vBodyX: q,
      vBodyY: -d,
      bladeRad: 0,
      area: DAGGERBOARD.area,
      aspectRatio: DAGGERBOARD.effectiveAspect,
    });
    const clrX = (this.ceLeewardOffset && this.heel)
      ? clrOffsetX(this.heel.phi, this.dinghy) : 0;
    const centerboard_p = this.physics_model.getWorldPoint(Vec2(clrX, this.centerboard_position));
    const toWorld = (bodyVec) => this.physics_model.getWorldVector(Vec2(bodyVec.x * perN, bodyVec.y * perN));
    const cbLiftW = toWorld(cb.lift);
    const cbDragW = toWorld(cb.drag);
    applyFinite(cbLiftW, centerboard_p);
    applyFinite(cbDragW, centerboard_p);
    this._clrLocalX = clrX;
    this._clrPoint = centerboard_p;
    this._clrForce = { x: cbLiftW.x + cbDragW.x, y: cbLiftW.y + cbDragW.y };
    this._cbLift = cbLiftW;
    this._cbDrag = cbDragW;
    this.forces.push({ name: 'centerboard-lift', type: 'arrow', vector: cbLiftW, point: centerboard_p });
    this.forces.push({ name: 'centerboard-drag', type: 'arrow', vector: cbDragW, point: centerboard_p });

    tel.qd = cb.alpha * 180 / Math.PI;
  



    // Calculate True wind and apparent wind
    let twa = (this.wind_direction - angle/Math.PI*180 + 90 )

    const wind_rad = this.wind_direction / 180 * Math.PI;
    // Boat velocity is m/s. wind_speed is the internal unit (÷ WIND_UNIT_MPS
    // = m/s). apparentWindMs adds them in m/s; the old sum treated 1 m/s of
    // boat speed as one internal unit (0.3 m/s of wind) and under-stated AWS.
    const twsMsNow = this.wind_speed * WIND_UNIT_MPS;
    const awMs = apparentWindMs(this.physics_model.m_linearVelocity, wind_rad, twsMsNow);
    const awsMs = Math.hypot(awMs.x, awMs.y);
    // aws stays in the internal unit for telemetry and the flap amplitude.
    // It is now awsMs / WIND_UNIT_MPS, a true conversion, not the mixed sum.
    let aw_vector = awMs;
    // One apparent wind for the boat. Each sail's angle of attack is its
    // own boom against this angle.
    let awa = apparentWindAngleDeg(aw_vector, angle);
    let aws = awsMs / WIND_UNIT_MPS;

    if (twa>180){
      twa-=360
    }
    if (twa<-180){
      twa+=360
    }

    this.awa = awa;
    this.twa = twa;
    updateTackingState(this);


    // fake motor

    // Fixed impulses, scaled with mass so the speed kick matches the old
    // 26.625 kg hull. They are not sail forces.
    const impulseScale = dinghyTotalMass(this.dinghy) / LEGACY_DENSITY_MASS_KG;
    if (this.motor_input === 1) {
      var f = this.physics_model.getWorldVector(Vec2(0.0, -0.3 * FORCE_PASSES * impulseScale));
      var p = this.physics_model.getWorldPoint(Vec2(0.0, 2.0));
      this.physics_model.applyLinearImpulse(f, p, true);
    }  
    
    if (this.motor_input === -1) {
      var f = this.physics_model.getWorldVector(Vec2(0.0, 0.3 * FORCE_PASSES * impulseScale));
      var p = this.physics_model.getWorldPoint(Vec2(0.0, 2.0));
      this.physics_model.applyLinearImpulse(f, p, true);
    }

    // The penalty rudder needs flow. If she nearly stops (in irons on the way
    // around), give the same forward shove the motor key uses so the turn
    // can finish. It does not run while she already has way on.
    if (this.penalty_turn && d < 0.6) {
      const shove = this.physics_model.getWorldVector(Vec2(0.0, -0.35 * FORCE_PASSES * impulseScale));
      const shoveAt = this.physics_model.getWorldPoint(Vec2(0.0, 2.0));
      this.physics_model.applyLinearImpulse(shove, shoveAt, true);
    }


    // rudder dynamics

 

    this.rudder_angle_last = this.rudder_angle;

    const rudder_turn_rate = (1-Math.abs(d)>0)?1-Math.abs(d)+1:1;

    // Penalty-turn autopilot. Manual helm clears penalty_turn before this runs.
    if (this.penalty_turn && this.rudder_input !== 0) this.penalty_turn = null;

    if (this.penalty_turn) {
      this.autopilot_enabled = false;
      const target = this._penaltyTurnRudder(angle, d);
      this.rudder_angle += (target - this.rudder_angle) * PENALTY_RUDDER_BLEND;
    } else if (this.rudder_input === -1) {

      // N passes of +rate, clamped at the max (no overshoot).
      for (let i = 0; i < N && this.rudder_angle < this.rudder_angle_max; i++) this.rudder_angle = Math.min(this.rudder_angle + rudder_turn_rate, this.rudder_angle_max);
    } else if (this.rudder_input === 1) {
      
      for (let i = 0; i < N && this.rudder_angle > -this.rudder_angle_max; i++) this.rudder_angle = Math.max(this.rudder_angle - rudder_turn_rate, -this.rudder_angle_max);
    }
    else{

      let dmod = d
      if (d>1){
        dmod = 1
      }
      if (d<-1){
        dmod = -1
      }

      this.rudder_angle = this.rudder_angle * Math.pow(0.98 - dmod / 80, (this.autopilot_enabled ? 1 : RUDDER_RETURN_SPEEDUP) * N)

    }
    
    if (this.autopilot_enabled){

      this.autopilot_compensator_p = this.autopilot_kp
      this.autopilot_compensator_i = this.autopilot_ki
      this.autopilot_compensator_d = this.autopilot_kd

      let error = -(this.autopilot_heading_target - (-this.twa))

      // N passes of ×0.85 then +error (same error each pass within a tick).
      this.autopilot_compensator_sum_error = this.autopilot_compensator_sum_error * AUTOPILOT_SUM_DECAY + error * (1 + 0.85 + 0.85 * 0.85);

      if (error>180) {
        error-=360
      }
      if (error<-180) {
        error+=360
      }

      tel.error = error;

      let comp_p = error * this.autopilot_compensator_p 
      let comp_i = this.autopilot_compensator_sum_error * this.autopilot_compensator_i 
      let comp_d = wrapDeg180(error - this.autopilot_compensator_last_error) * this.autopilot_compensator_d

      

      this.rudder_angle_target = (comp_p + comp_i + comp_d)*Math.sign(d)

      const autopilotMax = Math.min(AUTOPILOT_RUDDER_MAX, this.rudder_angle_max);
      if (this.rudder_angle_target>autopilotMax){
        this.rudder_angle_target = autopilotMax;
      }
      if (this.rudder_angle_target<-autopilotMax){
        this.rudder_angle_target = -autopilotMax;
      }

      this.rudder_angle += (this.rudder_angle_target - this.rudder_angle) * AUTOPILOT_RUDDER_BLEND


      this.autopilot_compensator_last_error = error;

    }
    else{
      this.autopilot_heading_target = - this.twa
      
      if (this.autopilot_heading_target > 180) {this.autopilot_heading_target -= 360} 
      if (this.autopilot_heading_target < -180) {this.autopilot_heading_target += 360} 
    }


  
    // Rudder: same foil model. Inflow includes the yaw-rate velocity at
    // the rudder stock (local +Y is aft). Blade angle is rudder_angle
    // (positive yaws clockwise). No sculling pump: the force is the steady
    // ½ρv² load at this angle.
    const omega = this.physics_model.m_angularVelocity;
    const rudder = foilForceNewtons({
      vBodyX: q - omega * this.rudder_position,
      vBodyY: -d,
      bladeRad: this.rudder_angle * Math.PI / 180,
      area: RUDDER_BLADE.area,
      aspectRatio: RUDDER_BLADE.effectiveAspect,
    });
    const rudder_p = this.physics_model.getWorldPoint(Vec2(0.0, this.rudder_position));
    const rudderLiftW = toWorld(rudder.lift);
    const rudderDragW = toWorld(rudder.drag);
    applyFinite(rudderLiftW, rudder_p);
    applyFinite(rudderDragW, rudder_p);
    this._rudderPoint = rudder_p;
    this._rudderLift = rudderLiftW;
    this._rudderDrag = rudderDragW;
    this.forces.push({ name: 'rudder-lift', type: 'arrow', vector: rudderLiftW, point: rudder_p });
    this.forces.push({ name: 'rudder-drag', type: 'arrow', vector: rudderDragW, point: rudder_p });

    tel.twa = twa;
    tel.tws = this.wind_speed * WIND_UNIT_MPS; // m/s; wind_speed is the internal unit
    tel.awa = awa;
    tel.aws = aws;
    // Readout in true m/s (renderState aws_ms / tws_ms). `aws` is the internal
    // unit of the apparent wind built in m/s (apparentWindMs), so × WIND_UNIT_MPS
    // recovers awsMs. Keep the last finite value so the frame always carries one.
    const awsMsRead = aws * WIND_UNIT_MPS;
    const twsMs = this.wind_speed * WIND_UNIT_MPS;
    if (Number.isFinite(awsMsRead)) this._awsMs = awsMsRead;
    if (Number.isFinite(twsMs)) this._twsMs = twsMs;


    // Calculate boat speed and velocity made good

    let bs = Math.sqrt(this.physics_model.m_linearVelocity.x*this.physics_model.m_linearVelocity.x + this.physics_model.m_linearVelocity.y*this.physics_model.m_linearVelocity.y)
    let vmg = Math.cos(twa/180*Math.PI)*bs

    tel.bs = bs;
    tel.vmg = vmg;



    // JIB. Trim follows the apparent wind. Through a tack, jibBackwindStep
    // remembers the sheet she had when the helm went on and, once the bow
    // is past head-to-wind and the rudder is still driving her around,
    // holds the jib there (dinghy-forces.js). The force below is the
    // ordinary sail force at that boom. The mainsail is not held.

    const clampBoom = (deg, max) => Math.max(-max, Math.min(max, deg));
    const jibTrim = clampBoom(this.awa * this.jib_boom_angle_factor, this.jib_boom_angle_max);
    const backwind = jibBackwindStep(this._jibBackwind, {
      twa: this.twa,
      boomTrim: jibTrim,
      rudderDeg: this.rudder_angle,
      depower: this.depower,
      enabled: this.jibBackwindEnabled !== false,
    });
    this._jibBackwind = backwind;
    this.jibBackwinded = backwind.backwinded;
    this.jibBackwindArmed = backwind.armed;
    this.jib_boom_angle = backwind.boom;


    // MAINSAIL

    this.mainsail_boom_angle = clampBoom(this.awa * this.mainsail_boom_angle_factor, this.mainsail_boom_angle_max);


    // Depower eases the sheets: the booms swing from trim toward lying along
    // the apparent wind, limited by the boom max. Forces come from the
    // resulting angle of attack through the lift/drag tables, so dead
    // downwind (boom already at its limit) nothing changes.
    if (this.depower > 0) {
      const k = this.depower;
      const ease = (trim, max) => trim + (Math.max(-max, Math.min(max, this.awa)) - trim) * k;
      this.mainsail_boom_angle = ease(this.mainsail_boom_angle, this.mainsail_boom_angle_max);
      this.jib_boom_angle = ease(this.jib_boom_angle, this.jib_boom_angle_max);
    }

    // Flap amplitude uses the boat apparent wind. Angles of attack are
    // stored with the sail forces below.
    this._aws = aws;

    // Heel reduces each sail by cos²(heel) (heel.js). Heel is last tick.
    // F_N = ½ρ A aws² C heelK, per sail (dinghy-forces.js). The body gets
    // each vector on that sail's sheeted boom, then ceLateralHeight·sinφ
    // to leeward; heel gets the summed side component in newtons at
    // ceHeight (not the boom); the wake gets the sum in the legacy unit.
    const areas = sailAreas(this.dinghy);
    const heelK = this.heel ? heelForceFactor(this.heel.phi) : 1;
    // Body +X walk. Added to the boom station, so an eased boom is already
    // off the centreline before heel moves the point any further to leeward.
    const leewardX = (this.ceLeewardOffset && this.heel)
      ? sailCeOffsetX(this.heel.phi, this.dinghy) : 0;
    // Both sails use the boat apparent wind, the free stream the sheets
    // are trimmed to. Yaw-rate velocity at each centre is not added. The
    // centres are about a metre apart, and a small yaw puts the two angles
    // of attack on different sides of this lift table's 10–15° rise; the
    // couple then rounds her up and a tack dies in irons (scenario 4).
    // The foils still include yaw-rate inflow.
    const oneSail = (boomDeg, area, boom) => {
      const local = { x: boom.x + leewardX, y: boom.y };
      const point = this.physics_model.getWorldPoint(Vec2(local.x, local.y));
      const aoa = Math.abs(boomDeg - awa);
      const aero = aeroCoefficients(aoa, this.aero_lift_lookup, this.aero_drag_lookup, this.aero_lookup_resolution);
      const sailK = sailDynamicNewtons(awsMs, heelK, area) * perN;
      const parts = sailLiftDrag(angle, awa, sailK, aero.lift, aero.drag);
      const total = { x: parts.lift.x + parts.drag.x, y: parts.lift.y + parts.drag.y };
      applyFinite(parts.lift, point);
      applyFinite(parts.drag, point);
      return { point, local, boom, ceY: local.y, aoa, awa, awsMs, cl: aero.lift, cd: aero.drag, lift: parts.lift, drag: parts.drag, total };
    };

    const mainBoomRad = this.mainsail_boom_angle * Math.PI / 180;
    const jibBoomRad = this.jib_boom_angle * Math.PI / 180;
    const mastY = this.mainsail_leading_edge_position;
    const tackY = this.jib_leading_edge_position;
    const mainClew = clewOffset(this.mainsail_boom_length, mainBoomRad);
    const jibClew = clewOffset(this.jib_boom_length, jibBoomRad);
    // Tack at the gooseneck / stem, head of the jib at the mast, clew at
    // the boom end. The force starts on that spar (dinghy-forces.js).
    this._mainTackLocal = { x: 0, y: mastY };
    this._jibTackLocal = { x: 0, y: tackY };
    this._jibHeadLocal = { x: 0, y: mastY };
    this._mainClewLocal = { x: mainClew.x, y: mastY + mainClew.y };
    this._jibClewLocal = { x: jibClew.x, y: tackY + jibClew.y };
    const main = oneSail(this.mainsail_boom_angle, areas.main, mainBoomForceLocal(mastY, this.mainsail_boom_length, mainBoomRad));
    const jib = oneSail(this.jib_boom_angle, areas.jib, jibBoomForceLocal(mastY, tackY, this.jib_boom_length, jibBoomRad));
    this._mainSail = main;
    this._jibSail = jib;
    this._sailAoaDeg = main.aoa;
    this._jibAoaDeg = jib.aoa;

    const mainsail_f = { x: main.total.x + jib.total.x, y: main.total.y + jib.total.y };
    const wm = Math.hypot(main.total.x, main.total.y);
    const wj = Math.hypot(jib.total.x, jib.total.y);
    const wt = wm + wj;
    // Combined CE for the magenta marker: force-weighted, so it sits
    // between the two boom points. Both already carry the leeward walk.
    this._sailCeLocalX = wt > 0
      ? (main.local.x * wm + jib.local.x * wj) / wt
      : main.local.x;
    this._mainCeLocalY = main.ceY;
    this._jibCeLocalY = jib.ceY;
    this._sailCePoint = wt > 0
      ? { x: (main.point.x * wm + jib.point.x * wj) / wt, y: (main.point.y * wm + jib.point.y * wj) / wt }
      : { x: main.point.x, y: main.point.y };

    // Area-weighted coefficients for the single Cl/Cd readout. Per-sail
    // values are on the telemetry as well.
    tel.cd = main.cd * areas.fraction + jib.cd * (1 - areas.fraction);
    tel.cl = main.cl * areas.fraction + jib.cl * (1 - areas.fraction);
    tel.mainCl = main.cl;
    tel.jibCl = jib.cl;
    tel.mainCd = main.cd;
    tel.jibCd = jib.cd;
    tel.mainAoa = main.aoa;
    tel.jibAoa = jib.aoa;

    this.power = Math.sqrt(mainsail_f.x * mainsail_f.x + mainsail_f.y * mainsail_f.y);
    this.power_direction = Math.atan2(mainsail_f.y, mainsail_f.x) / Math.PI * 180;
    // Body vector (newtons / FORCE_PASSES), the sum. Heel divides by perN.
    this._bodySailForce = { x: mainsail_f.x, y: mainsail_f.y };
    this._sailForcePerN = perN;
    // Lattice wake and the true-wind undo were tuned to one legacy internal
    // sail vector, not to the newton force on the 139 kg hull. The vector
    // is the sum of both sails; getSailSegments still lays it on the main.
    const legacyPerN = legacyInternalPerNewton(this.dinghy.sailArea, WIND_UNIT_MPS);
    const wake = legacyPerN / perN;
    this.mainsail_force = { x: mainsail_f.x * wake, y: mainsail_f.y * wake };
    tel.mainN = wm / perN;
    tel.jibN = wj / perN;
    tel.power = this.power;

    // Heel: summed sail side force (perpendicular to the centreline, body
    // +X) in N drives the roll DOF. Each sail's moment is that sail's side
    // force times the shared ceHeight; stepHeel applies the sum.
    // Forward (bow, local −Y) for the drive component, same axis as `d`.
    const fwdX = Math.sin(angle), fwdY = -Math.cos(angle);
    const fScale = 1 / perN;
    const sideOf = (f) => (f.x * Math.cos(angle) + f.y * Math.sin(angle)) * fScale;
    const driveOf = (f) => (f.x * fwdX + f.y * fwdY) * fScale;
    if (this.heel && Number.isFinite(mainsail_f.x) && Number.isFinite(mainsail_f.y)) {
      this.main_side_force_n = sideOf(main.total);
      this.jib_side_force_n = sideOf(jib.total);
      this.main_drive_force_n = driveOf(main.total);
      this.jib_drive_force_n = driveOf(jib.total);
      this.sail_side_force_n = this.main_side_force_n + this.jib_side_force_n;
      this.sail_drive_force_n = this.main_drive_force_n + this.jib_drive_force_n;
      stepHeel(this.heel, this.sail_side_force_n, 1 / 30, this.dinghy);
      tel.heel = this.heel.phi * 180 / Math.PI;
      tel.hike = Math.abs(this.heel.hike) * 100;
    }



    // Hull resistance in newtons, along −velocity, at the heeled drag
    // centre: +hullDragLateral·sinφ to leeward when ceLeewardOffset is on.
    var drag_f = {}
    const resistN = hullResistanceNewtons(bs);
    if (bs > 1e-4) {
      drag_f.x = -this.physics_model.m_linearVelocity.x / bs * resistN * perN;
      drag_f.y = -this.physics_model.m_linearVelocity.y / bs * resistN * perN;
    } else {
      drag_f.x = 0;
      drag_f.y = 0;
    }

    const dragX = (this.ceLeewardOffset && this.heel)
      ? hullDragOffsetX(this.heel.phi, this.dinghy) : 0;
    var drag_p = this.physics_model.getWorldPoint(Vec2(dragX, 0));
    this._dragLocalX = dragX;
    this._dragPoint = drag_p;
    applyFinite(drag_f, drag_p);   
    this.forces.push({name: "drag", type: "arrow", vector: drag_f, point: drag_p})

    // clear inputs
    this.rudder_input = 0;
    this.motor_input = 0;

    // Tack and gybe detection for the pending penalty. Hand-sailed and Q/E
    // turns both clear through this, never through the circle itself.
    updatePenaltyManeuvers(this);

  }

  // Rudder angle for the Q/E circle this step. `heading` is the hull angle
  // (radians) and `d` the forward speed. Positive rudder_angle yaws clockwise
  // (hull angle decreases) while she has way on, so the sign flips with d.
  // Progress is the short-way heading change summed per step; the turn ends
  // on the starting heading and hands the helm to the heading autopilot.
  _penaltyTurnRudder(heading, d) {
    const turn = this.penalty_turn;
    let delta = (heading - turn.lastHeading) % (2 * Math.PI);
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    turn.lastHeading = heading;
    turn.progressDeg += delta * 180 / Math.PI;

    // Degrees still to turn, counter-clockwise positive. Negative once past.
    const error = turn.dir * 360 - turn.progressDeg;
    const rateDeg = this.physics_model.getAngularVelocity() * 180 / Math.PI;

    if (Math.abs(error) <= PENALTY_TURN_DONE_DEG && Math.abs(rateDeg) <= PENALTY_TURN_DONE_RATE_DEG_S) {
      this._finishPenaltyTurn();
      return this.rudder_angle;
    }

    let yawCommand = PENALTY_TURN_KP * error - PENALTY_TURN_KD * rateDeg;
    // Sail force on the boom leaves a yaw moment the old centreline CE did
    // not. Near the end of the circle the D term flips the rudder every step,
    // and the P term alone (about 3° at a 3° error) cannot beat that moment,
    // so she parks a few degrees short and the turn never ends. Damping may
    // shrink the command but not reverse it while she is outside the done
    // window, and a few degrees of rudder stay on in the direction still to
    // turn until she is inside it.
    if (Math.abs(error) > PENALTY_TURN_DONE_DEG) {
      if (yawCommand * error < 0) yawCommand = 0;
      if (Math.abs(yawCommand) < PENALTY_TURN_FINISH_RUDDER) yawCommand = PENALTY_TURN_FINISH_RUDDER * Math.sign(error);
    }
    let target = -yawCommand * (d < 0 ? -1 : 1);
    const penaltyMax = Math.min(PENALTY_TURN_RUDDER_MAX, this.rudder_angle_max);
    if (target > penaltyMax) target = penaltyMax;
    if (target < -penaltyMax) target = -penaltyMax;
    return target;
  }

  // Back on the starting heading: the heading autopilot holds it. Its target
  // is -TWA, so the starting heading is expressed against the current wind.
  _finishPenaltyTurn() {
    const turn = this.penalty_turn;
    this.penalty_turn = null;
    const target = penaltyTurnExitTarget(this.wind_direction, turn.startHeading);
    this.autopilot_heading_target = target;
    let error = -(target + this.twa);
    error = ((error + 180) % 360 + 360) % 360 - 180;
    this.autopilot_compensator_last_error = error;
    this.autopilot_compensator_sum_error = 0;
    this.autopilot_enabled = true;
  }

  _cancelPenaltyTurn() {
    this.penalty_turn = null;
  }

  _startPenaltyTurn(dir) {
    if (this.penalty_turn && this.penalty_turn.dir === dir) return;
    this.autopilot_enabled = false;
    const heading = this.physics_model.getAngle();
    this.penalty_turn = { dir, startHeading: heading, lastHeading: heading, progressDeg: 0 };
    // The circle supplies its own tack and gybe; an earlier lone maneuver
    // does not pair with its first crossing.
    resetPenaltyManeuvers(this);
  }
  
  // Drawing state for this tick (boat-draw.js). Advances the visual
  // smoothing once per call (boom angles, flap phase), as the old
  // graphics_model_render did; nothing here feeds back into the physics.
  renderState(view) {
    const body = this.physics_model;
    const p = body.getPosition();
    // Sail flapping (visual): luff amount, amplitude scale and tick phase.
    this._flapTick = (this._flapTick || 0) + 1;
    const aoaLuff = Number.isFinite(this._sailAoaDeg) ? Math.max(0, 1 - this._sailAoaDeg / SAIL_FLAP_AOA_DEG) : 0;
    const flapScale = aoaLuff * Math.min(1, (this._aws || 0) / SAIL_FLAP_AWS_REF);
    const flapPhase = 2 * Math.PI * SAIL_FLAP_HZ * this._flapTick / 30;
    this.sailFlap = flapScale;
    // Jib: its own AoA, or collapsed in the main's shadow when running
    // (|AWA| from SAIL_FLAP_JIB_SHADOW_AWA_DEG, full by +20°), the latter only
    // while eased: scaled by the depower ramp. Visual only.
    const jibAoaLuff = Number.isFinite(this._jibAoaDeg) ? Math.max(0, 1 - this._jibAoaDeg / SAIL_FLAP_AOA_DEG) : 0;
    const shadow = Number.isFinite(this.awa) ? Math.max(0, Math.min(1, (Math.abs(this.awa) - SAIL_FLAP_JIB_SHADOW_AWA_DEG) / 20)) : 0;
    this.jibFlap = Math.max(jibAoaLuff, shadow * (this.depower || 0)) * Math.min(1, (this._aws || 0) / SAIL_FLAP_AWS_REF);
    this.mainsail_boom_angle_actual += (this.mainsail_boom_angle - this.mainsail_boom_angle_actual) / 30;
    this.jib_boom_angle_actual += (this.jib_boom_angle - this.jib_boom_angle_actual) / 20;
    const f = [];
    for (const force of this.forces) f.push(force.point.x, force.point.y, force.vector.x, force.vector.y);
    const lv = body.getLinearVelocity();
    const s = {
      x: this.x, y: this.y, px: p.x, py: p.y, pa: body.getAngle(), ha: this.hull_angle,
      id: this.boatId, vx: r3(lv.x), vy: r3(lv.y), w: r3(body.getAngularVelocity()),
      awa: this.awa, tw: Math.atan2(this.wind_vy_smooth, this.wind_vx_smooth),
      ap: this.autopilot_enabled ? 1 : 0, wd: this.wind_direction, aht: this.autopilot_heading_target,
      twa: this.twa, bv1: this.autopilot_heading_best_vmg_1, bv2: this.autopilot_heading_best_vmg_2,
      ra: this.rudder_angle, mba: this.mainsail_boom_angle_actual, jba: this.jib_boom_angle_actual,
      ...(this.jibBackwinded ? { jib_backwinded: 1 } : {}),
      mf: flapScale, jf: this.jibFlap, ph: flapPhase, f,
      ...readoutFields(this),
    };
    // CE / CLR application points for the debug overlay (boat-draw.js).
    // ce is the force-weighted rig centre (magenta). mce / jce are the
    // per-sail centres; ml/md and jl/jd are that sail's lift and drag in
    // the same pre-applyFinite unit as the green force arrows.
    const finiteVec = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.y);
    const putSail = (sail, ceKey, liftKey, dragKey) => {
      if (!sail || !finiteVec(sail.point) || !finiteVec(sail.lift) || !finiteVec(sail.drag)) return;
      s[ceKey] = [sail.point.x, sail.point.y];
      s[liftKey] = [sail.lift.x, sail.lift.y];
      s[dragKey] = [sail.drag.x, sail.drag.y];
    };
    putSail(this._mainSail, 'mce', 'ml', 'md');
    putSail(this._jibSail, 'jce', 'jl', 'jd');
    if (this._sailCePoint
        && Number.isFinite(this._sailCePoint.x) && Number.isFinite(this._sailCePoint.y)) {
      s.ce = [this._sailCePoint.x, this._sailCePoint.y];
      if (Number.isFinite(this._sailCeLocalX)) s.cex = this._sailCeLocalX;
      if (this.mainsail_force && Number.isFinite(this.mainsail_force.x) && Number.isFinite(this.mainsail_force.y)) {
        s.sf = [this.mainsail_force.x, this.mainsail_force.y];
      }
    }
    if (this._clrPoint
        && Number.isFinite(this._clrPoint.x) && Number.isFinite(this._clrPoint.y)) {
      s.clr = [this._clrPoint.x, this._clrPoint.y];
      if (Number.isFinite(this._clrLocalX)) s.clrx = this._clrLocalX;
      if (this._cbLift && Number.isFinite(this._cbLift.x)) s.cbl = [this._cbLift.x, this._cbLift.y];
      if (this._cbDrag && Number.isFinite(this._cbDrag.x)) s.cbd = [this._cbDrag.x, this._cbDrag.y];
    }
    if (this._dragPoint
        && Number.isFinite(this._dragPoint.x) && Number.isFinite(this._dragPoint.y)) {
      s.hd = [this._dragPoint.x, this._dragPoint.y];
      if (Number.isFinite(this._dragLocalX)) s.hdx = this._dragLocalX;
    }
    if (this._rudderPoint
        && Number.isFinite(this._rudderPoint.x) && Number.isFinite(this._rudderPoint.y)) {
      s.rd = [this._rudderPoint.x, this._rudderPoint.y];
      if (this._rudderLift && Number.isFinite(this._rudderLift.x)) s.rdl = [this._rudderLift.x, this._rudderLift.y];
      if (this._rudderDrag && Number.isFinite(this._rudderDrag.x)) s.rdd = [this._rudderDrag.x, this._rudderDrag.y];
    }
    return s;
  }

  // Static drawing numbers (boat-draw.js boatGuides).
  renderDef() {
    return {
      rp: this.rudder_position, rl: this.rudder_lenght, cp: this.centerboard_position, cl: this.centerboard_length,
      mle: this.mainsail_leading_edge_position, mbl: this.mainsail_boom_length,
      jle: this.jib_leading_edge_position, jbl: this.jib_boom_length,
    };
  }

  graphics_model_render(view) {
    return boatGuides(this.renderState(view), this.renderDef());
  }
  


  // Returns world-space line segments for the lattice wake. The impulse is
  // the sum of both sails (mainsail_force), laid along the mainsail. The
  // true-wind undo was fitted to that one vector.
  getSailSegments() {
    const angle   = this.hull_angle;
    const segments = [];

    if (this.mainsail_force) {
      const boomRad = this.mainsail_boom_angle / 180 * Math.PI;
      const bow  = this.physics_model.getWorldPoint(planck.Vec2(0.0, -2.25));
      const mast = this.physics_model.getWorldPoint(planck.Vec2(0.0, this.mainsail_leading_edge_position));
      segments.push({
        x0: bow.x, y0: bow.y,
        x1: mast.x + Math.cos(angle + Math.PI/2 + boomRad) * this.mainsail_boom_length,
        y1: mast.y + Math.sin(angle + Math.PI/2 + boomRad) * this.mainsail_boom_length,
        fx: -this.mainsail_force.x,
        fy: -this.mainsail_force.y,
      });
    }

    return segments;
  }

  // Manual helm limit, degrees each side. Out-of-range or non-numeric
  // values are refused (false) and leave the boat as it was. A rudder
  // already past a lowered limit is brought back inside it.
  setRudderMax(deg) {
    if (typeof deg !== 'number' || !Number.isFinite(deg) || deg < RUDDER_MAX_DEG_MIN || deg > RUDDER_MAX_DEG_MAX) return false;
    this.rudder_angle_max = deg;
    if (this.rudder_angle > deg) this.rudder_angle = deg;
    if (this.rudder_angle < -deg) this.rudder_angle = -deg;
    return true;
  }

  input_rudder_left(){
    this.rudder_input = 1
    this.autopilot_enabled = false
    this._cancelPenaltyTurn()
  }
  input_rudder_right(){
    this.rudder_input = -1
    this.autopilot_enabled = false
    this._cancelPenaltyTurn()
  }

  input_motor_forward(){
    this.motor_input = 1
  }
  input_motor_reverse(){
    this.motor_input = -1
  }

  input_autopilot_enabled_toggle(){
    this._cancelPenaltyTurn()
    // The dashed guide's snap of the current autopilot angle, engaged or not.
    this.autopilot_heading_target = autopilotGuideTarget({
      ap: 0,
      aht: this.autopilot_heading_target,
      twa: this.twa,
      bv1: this.autopilot_heading_best_vmg_1,
      bv2: this.autopilot_heading_best_vmg_2,
    });
    this.autopilot_enabled = true;
  }  
  input_autopilot_tack_toggle(){
    this._cancelPenaltyTurn()
    this.autopilot_heading_target *=-1
    this.autopilot_enabled = true
  }

  input_penalty_turn_cw(){
    this._startPenaltyTurn(-1)
  }

  input_depower_toggle(){
    this.depowered = !this.depowered;
  }

  input_penalty_turn_ccw(){
    this._startPenaltyTurn(1)
  }

  // Held Up / Down (and boat 2's W / S): the target moves
  // AUTOPILOT_HEADING_STEP_DEG per sim tick (1.5° = 45°/s at 30 Hz), kept
  // within 5°..175° off the wind on its current tack. Scripted scenarios pass
  // step 1 so their degree-per-frame scripts are unchanged.
  input_autopilot_heading_increase(step = AUTOPILOT_HEADING_STEP_DEG){
    this._cancelPenaltyTurn()
    this.autopilot_enabled = true
    const t = this.autopilot_heading_target
    if (Math.abs(t) < 175){
      const m = Math.min(175, Math.abs(t) + step)
      this.autopilot_heading_target = t > 0 ? m : -m
    }
  }
  // Sticky-autopilot helm (Left / Right with the "Sticky autopilot" setting):
  // dir -1 (Left) turns her counter-clockwise like left rudder, +1 (Right)
  // clockwise, by moving the heading target (-TWA, so CCW raises it). No
  // 5..175° clamp: the target wraps through ±180 (dead downwind) and 0 (head
  // to wind), so holding Left / Right tacks and gybes continuously. The
  // autopilot error is wrapped to ±180 (shortest way); the target never leads
  // the boat by more than AUTOPILOT_TURN_MAX_LEAD_DEG in the turn direction,
  // so shortest way is always the held direction (no reversing at the wrap).
  // Engages the autopilot. Up / Down keep their clamped behaviour.
  input_autopilot_turn(dir, step = AUTOPILOT_HEADING_STEP_DEG){
    this._cancelPenaltyTurn()
    if (!this.autopilot_enabled) {
      this.autopilot_enabled = true
      this.autopilot_heading_target = wrapDeg180(-this.twa)
    }
    const sgn = dir < 0 ? 1 : -1
    const lead = wrapDeg180(this.autopilot_heading_target - (-this.twa)) * sgn
    const room = AUTOPILOT_TURN_MAX_LEAD_DEG - lead
    if (room <= 0) return
    this.autopilot_heading_target = wrapDeg180(this.autopilot_heading_target + sgn * Math.min(step, room))
  }
  input_autopilot_heading_decrease(step = AUTOPILOT_HEADING_STEP_DEG){
    this._cancelPenaltyTurn()
    this.autopilot_enabled = true
    const t = this.autopilot_heading_target
    if (Math.abs(t) > 5){
      const m = Math.max(5, Math.abs(t) - step)
      this.autopilot_heading_target = t > 0 ? m : -m
    }
  }

}
