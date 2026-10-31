import planck from 'planck-js';
import { aeroCoefficients } from './utils.js';
import { resetPenaltyManeuvers, updatePenaltyManeuvers, updateTackingState } from './rules.js';
import { WIND_UNIT_MPS, boatTrueWind } from './wind.js';
import { boatGuides } from './boat-draw.js';

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
export const AUTOPILOT_SUM_DECAY = Math.pow(0.85, N);
// Forces (applyForce accumulates until world.step) and impulses per tick.
export const FORCE_PASSES = N;

// Depower toggle (X key, touch "Depower"): the sheets are eased fully. The
// boom angle ramps (0 → 1 over DEPOWER_RAMP_S) from trim toward lying along
// the apparent wind, limited by the boom max; lift and drag then come from
// the real angle of attack via the tables (upwind: AoA → 0, the sail luffs;
// dead downwind the boom is already at its limit, nothing changes). The
// lattice push uses mainsail_force. The autopilot never changes it.
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




/**
 * Rudder return-to-centre with no helm input: the per-pass decay factor
 * (0.98 - speed/80) is raised to this power, so the centring half-life is
 * 1/RUDDER_RETURN_SPEEDUP of the old one at every speed. Only when the
 * autopilot is off: autopilot steering keeps the old decay, and the
 * penalty-turn rudder is a separate branch, so both are unchanged.
 */
export const RUDDER_RETURN_SPEEDUP = 3;

/** Autopilot rudder limit. Was rudder_angle_max / 2 (60 / 2); pinned at 30° so
 *  the 60° → 45° manual limit does not slow autopilot tacks and bear-aways. */
export const AUTOPILOT_RUDDER_MAX = 30;

/** Autopilot heading-target change per sim tick while Up / Down is held (was 1°). */
export const AUTOPILOT_HEADING_STEP_DEG = 1.5;

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

    this.hull_mass = 6; // was 6
    this.hull_shape = pl.Polygon([Vec2(0, -2.25), Vec2(-0.5, -1.25), Vec2(-0.75, -0.25),  Vec2(-0.75, 0.5),  Vec2(-0.5, 1.75), Vec2(0.5, 1.75),  Vec2(0.75, 0.5), Vec2(0.75, -0.25), Vec2(0.5, -1.25), Vec2(0, -2.25)])
   

    
    this.rudder_input = 0;
    this.motor_input = 0;


    this.rudder_angle = 0;
    this.rudder_angle_last = 0;
    this.rudder_angle_max = 45; // was 60
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
    this.jib_boom_angle_factor = 0.65
    this.jib_boom_angle = 0
    this.jib_boom_angle_actual = 0

    this.center_of_lift = -0.05

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

    this.autopilot_heading_best_vmg_1 = 50;
    this.autopilot_heading_best_vmg_2 = 160;

    this.autopilot_compensator_p = 0;
    this.autopilot_compensator_i = 0;
    this.autopilot_compensator_d = 0;

    this.autopilot_compensator_last_error = 0;
    this.autopilot_compensator_current_error = 0;
    this.autopilot_compensator_sum_error = 0;

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
    

    let boat = this.map.world.createBody({
      type : 'dynamic',
      angularDamping : 0.5,
      linearDamping : 0.1,
      position : Vec2(this.x, this.y),
      angle : this.hull_angle,
      allowSleep : false
    });

    boat.createFixture(this.hull_shape, this.hull_mass);

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

    // calculate centerboard dynamics
    let centerboard_AoA_degrees = Math.atan2(q, Math.abs(d)) * 180 / Math.PI

    if (centerboard_AoA_degrees>90){
      centerboard_AoA_degrees -= 180
    }
    else if (centerboard_AoA_degrees<-90){
      centerboard_AoA_degrees += 180
    }

    let centerboard_force = -centerboard_AoA_degrees * Math.abs(d)*Math.abs(d) *2;

    if (centerboard_force>150){
      centerboard_force = 150
    }
    else if (centerboard_force<-150){
      centerboard_force = -150
    }

    //var f = boat.getWorldVector(Vec2(-q*100, 0)); 
    var centerboard_f = this.physics_model.getWorldVector(Vec2(centerboard_force, 0));
    var centerboard_p = this.physics_model.getWorldPoint(Vec2(0.0, this.centerboard_position));

    // centerboard
    applyFinite(centerboard_f, centerboard_p);   

    this.forces.push({name: "centerboard", type: "arrow", vector: centerboard_f, point: centerboard_p})

    tel.qd = centerboard_AoA_degrees;
  



    // Calculate True wind and apparent wind
    let twa = (this.wind_direction - angle/Math.PI*180 + 90 )

    const wind_rad = this.wind_direction / 180 * Math.PI;
    let aw_vector = {}

    aw_vector.x = this.physics_model.m_linearVelocity.x + Math.cos(wind_rad) * this.wind_speed;
    aw_vector.y = this.physics_model.m_linearVelocity.y + Math.sin(wind_rad) * this.wind_speed;

    let awa = Math.atan2(aw_vector.y, aw_vector.x)/Math.PI*180 - angle/Math.PI*180 + 90 ;
    let aws = Math.sqrt(aw_vector.x*aw_vector.x + aw_vector.y*aw_vector.y)

    if (awa>180){
      awa-=360
    }
    if (awa<-180){
      awa+=360
    }

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

    if (this.motor_input === 1) {
      var f = this.physics_model.getWorldVector(Vec2(0.0, -0.3 * FORCE_PASSES));
      var p = this.physics_model.getWorldPoint(Vec2(0.0, 2.0));
      this.physics_model.applyLinearImpulse(f, p, true);
    }  
    
    if (this.motor_input === -1) {
      var f = this.physics_model.getWorldVector(Vec2(0.0, 0.3 * FORCE_PASSES));
      var p = this.physics_model.getWorldPoint(Vec2(0.0, 2.0));
      this.physics_model.applyLinearImpulse(f, p, true);
    }

    // The penalty rudder needs flow. If she nearly stops (in irons on the way
    // around), give the same forward shove the motor key uses so the turn
    // can finish. It does not run while she already has way on.
    if (this.penalty_turn && d < 0.6) {
      const shove = this.physics_model.getWorldVector(Vec2(0.0, -0.35 * FORCE_PASSES));
      const shoveAt = this.physics_model.getWorldPoint(Vec2(0.0, 2.0));
      this.physics_model.applyLinearImpulse(shove, shoveAt, true);
    }


    // rudder dynamics

 

    this.rudder_angle_last = this.rudder_angle;
    let pumpfactor = 0;

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
      // The pump term was per pass (cube of a one-pass step), summed over N
      // passes by FORCE_PASSES: use the per-pass step here.
      const stepPerPass = (this.rudder_angle - this.rudder_angle_last) / N;
      pumpfactor = 1.5 * stepPerPass * stepPerPass * stepPerPass
    } else if (this.rudder_input === 1) {
      
      for (let i = 0; i < N && this.rudder_angle > -this.rudder_angle_max; i++) this.rudder_angle = Math.max(this.rudder_angle - rudder_turn_rate, -this.rudder_angle_max);
      const stepPerPass = (this.rudder_angle - this.rudder_angle_last) / N;
      pumpfactor = 1.5 * stepPerPass * stepPerPass * stepPerPass
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

      this.autopilot_compensator_p = AUTOPILOT_KP // 0.5
      this.autopilot_compensator_i = 0 // 0
      this.autopilot_compensator_d = AUTOPILOT_KD // 100 at 3 passes/tick

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
      let comp_d = (error - this.autopilot_compensator_last_error) * this.autopilot_compensator_d

      

      this.rudder_angle_target = (comp_p + comp_i + comp_d)*Math.sign(d)

      if (this.rudder_angle_target>AUTOPILOT_RUDDER_MAX){
        this.rudder_angle_target = AUTOPILOT_RUDDER_MAX;
      }
      if (this.rudder_angle_target<-AUTOPILOT_RUDDER_MAX){
        this.rudder_angle_target = -AUTOPILOT_RUDDER_MAX;
      }

      this.rudder_angle += (this.rudder_angle_target - this.rudder_angle) * AUTOPILOT_RUDDER_BLEND


      this.autopilot_compensator_last_error = error;

    }
    else{
      this.autopilot_heading_target = - this.twa
      
      if (this.autopilot_heading_target > 180) {this.autopilot_heading_target -= 360} 
      if (this.autopilot_heading_target < -180) {this.autopilot_heading_target += 360} 
    }


  
    // calculate flow directuion under the rudder
    let angular_velocity = this.physics_model.m_angularVelocity;
    let q_rot = angular_velocity*this.rudder_lenght;
    let water_angle = Math.atan2(-q+q_rot, Math.abs(d)) /Math.PI*180

    let rudder_force = 0;
    if (d>0){
      rudder_force = d*(this.rudder_angle+water_angle)/7;
    }
    else{
      rudder_force = d*(this.rudder_angle-water_angle)/7; 
    }

    rudder_force += pumpfactor*2

    let rudder_p = this.physics_model.getWorldPoint(Vec2(0.0, this.rudder_position))
    let rudder_f = {}

    rudder_f.x = Math.cos(angle +this.rudder_angle/180*Math.PI)* rudder_force;
    rudder_f.y = Math.sin(angle +this.rudder_angle/180*Math.PI)* rudder_force;

    applyFinite(rudder_f, rudder_p); 
    this.forces.push({name: "rudder", type: "arrow", vector: rudder_f, point: rudder_p})

    tel.twa = twa;
    tel.tws = this.wind_speed * WIND_UNIT_MPS; // m/s; wind_speed is the internal unit
    tel.awa = awa;
    tel.aws = aws;


    // Calculate boat speed and velocity made good

    let bs = Math.sqrt(this.physics_model.m_linearVelocity.x*this.physics_model.m_linearVelocity.x + this.physics_model.m_linearVelocity.y*this.physics_model.m_linearVelocity.y)
    let vmg = Math.cos(twa/180*Math.PI)*bs

    tel.bs = bs;
    tel.vmg = vmg;



    // JIB

    this.jib_boom_angle = this.awa*this.jib_boom_angle_factor;

    if (this.jib_boom_angle>this.jib_boom_angle_max) this.jib_boom_angle = this.jib_boom_angle_max;
    if (this.jib_boom_angle<-this.jib_boom_angle_max) this.jib_boom_angle = -this.jib_boom_angle_max;


    // MAINSAIL

    this.mainsail_boom_angle = this.awa*this.mainsail_boom_angle_factor;

    if (this.mainsail_boom_angle>this.mainsail_boom_angle_max) this.mainsail_boom_angle = this.mainsail_boom_angle_max;
    if (this.mainsail_boom_angle<-this.mainsail_boom_angle_max) this.mainsail_boom_angle = -this.mainsail_boom_angle_max;


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

    const aero = aeroCoefficients(
      Math.abs(this.mainsail_boom_angle - this.awa),
      this.aero_lift_lookup,
      this.aero_drag_lookup,
      this.aero_lookup_resolution
    );
    let c_drag = aero.drag;
    let c_lift = aero.lift;
    // Visual only (sail flapping): angle of attack and AWS of this step.
    this._sailAoaDeg = Math.abs(this.mainsail_boom_angle - this.awa);
    this._jibAoaDeg = Math.abs(this.jib_boom_angle - this.awa);
    this._aws = aws;

    let sail_f_drag = {};
    let sail_f_lift = {};

    tel.cd = c_drag;
    tel.cl = c_lift;
    
    const sail_efficiency = 0.15/3 // was 0.35

    sail_f_drag.x = Math.cos(angle+this.awa/180*Math.PI + Math.PI/2 )*aws*aws*c_drag*sail_efficiency
    sail_f_drag.y = Math.sin(angle+this.awa/180*Math.PI + Math.PI/2 )*aws*aws*c_drag*sail_efficiency
    
    sail_f_lift.x = -Math.sign(this.awa)*Math.cos(angle+(this.awa)/180*Math.PI )*aws*aws*c_lift*sail_efficiency
    sail_f_lift.y = -Math.sign(this.awa)*Math.sin(angle+(this.awa)/180*Math.PI )*aws*aws*c_lift*sail_efficiency

    let mainsail_f = {};

    mainsail_f.x = sail_f_drag.x  + sail_f_lift.x
    mainsail_f.y = sail_f_drag.y  + sail_f_lift.y


    var mainsail_p = this.physics_model.getWorldPoint(Vec2(0.0, this.center_of_lift));
    
    
    applyFinite(sail_f_lift, mainsail_p);
    applyFinite(sail_f_drag, mainsail_p); 

    this.forces.push({name: "mainsail", type: "arrow", vector: sail_f_lift, point: mainsail_p})
    this.forces.push({name: "mainsail", type: "arrow", vector: sail_f_drag, point: mainsail_p})

    this.power = Math.sqrt(mainsail_f.x*mainsail_f.x + mainsail_f.y*mainsail_f.y)
    this.power_direction = Math.atan2(mainsail_f.y, mainsail_f.x) / Math.PI * 180;
    this.mainsail_force = { x: mainsail_f.x, y: mainsail_f.y };

    
    tel.power = this.power;



    // Calculate DRAG
    var drag_f = {}
    drag_f.x = -(this.physics_model.m_linearVelocity.x)*bs
    drag_f.y = -(this.physics_model.m_linearVelocity.y)*bs


    var drag_p = this.physics_model.getWorldPoint(Vec2(0.0, 0));
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

    const yawCommand = PENALTY_TURN_KP * error - PENALTY_TURN_KD * rateDeg;
    let target = -yawCommand * (d < 0 ? -1 : 1);
    if (target > PENALTY_TURN_RUDDER_MAX) target = PENALTY_TURN_RUDDER_MAX;
    if (target < -PENALTY_TURN_RUDDER_MAX) target = -PENALTY_TURN_RUDDER_MAX;
    return target;
  }

  // Back on the starting heading: the heading autopilot holds it. Its target
  // is -TWA, so the starting heading is expressed against the current wind.
  _finishPenaltyTurn() {
    const turn = this.penalty_turn;
    this.penalty_turn = null;
    let target = -(this.wind_direction - turn.startHeading * 180 / Math.PI + 90);
    target = ((target + 180) % 360 + 360) % 360 - 180;
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
      ra: this.rudder_angle, mba: this.mainsail_boom_angle_actual, jba: this.jib_boom_angle_actual,
      mf: flapScale, jf: this.jibFlap, ph: flapPhase, f,
    };
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
  


  // Returns world-space line segments for each sail with the aerodynamic reaction
  // force (equal and opposite to the force on the boat) as {x0,y0,x1,y1,fx,fy}.
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

    if (this.autopilot_heading_target < 0){

      if (this.autopilot_heading_target > -90){
        this.autopilot_heading_target = -this.autopilot_heading_best_vmg_1
      }
      else{
        this.autopilot_heading_target = -this.autopilot_heading_best_vmg_2
      }

    }
    else{
      if (this.autopilot_heading_target < 90){
        this.autopilot_heading_target = this.autopilot_heading_best_vmg_1
      }
      else{
        this.autopilot_heading_target = this.autopilot_heading_best_vmg_2
      }
    }


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
  // clockwise, by moving the heading target. The target is -TWA, so a CCW turn
  // raises it: on a positive target that is the Up / Down increase (bear
  // away), on a negative one the decrease (head up). Same step and 5..175°
  // clamp, so she never tacks or gybes through it. Engages the autopilot.
  input_autopilot_turn(dir){
    const ccw = dir < 0;
    if (ccw === (this.autopilot_heading_target >= 0)) this.input_autopilot_heading_increase()
    else this.input_autopilot_heading_decrease()
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
