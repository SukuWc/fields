import { World, Edge, Vec2, Circle } from 'planck-js'
import planck, { random } from 'planck-js/dist/planck-with-testbed';
import Renderer, { Runner } from "planck-renderer";

import {fluid} from './fluid.js';


let field_draw = []

fluid.init()

let key_bind_list = []
let key_state = []

let keyboard_up = false;
let keyboard_down = false;
let keyboard_left = false;
let keyboard_right = false;

let polygons = [];
let edges= [];
let circles= [];

let arrows= [];

let forces= [];
let impulses= [];


let rudders= [];
let sails= [];
let guides= [];

let path_markers= [];



document.onkeydown = checkKeyPress;
document.onkeyup = checkKeyRelease;

document.getElementById("camera_follow").checked = false
document.getElementById("show_forces").checked = true
document.getElementById("show_field").checked = false

document.getElementById("show_forces").addEventListener("change", e => {

  map.input_show_forces(document.getElementById("show_forces").checked)

}); 

document.getElementById("scenario_selector").addEventListener("change", e => {

  console.log(document.getElementById("scenario_selector").value)  
  scenario_start(scenarios[document.getElementById("scenario_selector").value])

}); 

document.getElementById("scenario_restart").addEventListener("click", e => {

  console.log("restart")
  scenario_start(scenarios[document.getElementById("scenario_selector").value])

}); 

document.getElementById("show_field").addEventListener("change", e => {

  map.input_show_fields(document.getElementById("show_field").checked)

}); 


document.getElementById("camera_follow").addEventListener("change", e => {

  map.input_camera_follow(document.getElementById("camera_follow").checked)

}); 

document.getElementById("camera_zoom_in").addEventListener("click", e => {
  map.input_camera_zoom_relative(-2)
}); 

document.getElementById("camera_zoom_out").addEventListener("click", e => {
  map.input_camera_zoom_relative(+2)
}); 

document.getElementById("camera_move_left").addEventListener("click", e => {
  map.input_camera_move_relative(-5,0)
}); 
document.getElementById("camera_move_right").addEventListener("click", e => {
  map.input_camera_move_relative(5,0)
}); 
document.getElementById("camera_move_up").addEventListener("click", e => {
  map.input_camera_move_relative(0,5)
}); 
document.getElementById("camera_move_down").addEventListener("click", e => {
  map.input_camera_move_relative(0,-5)
}); 


function checkKeyPress(e) {

  e = e || window.event;

  key_state[e.keyCode] = true

    
  key_bind_list.forEach(bind => {

    if (bind.type === "KEYDOWN" && key_state[bind.activation_key] && (key_state[bind.prohibition_key] === false || key_state[bind.prohibition_key] === undefined)){

      bind.object[bind.input_handler]()

    }


  });

}


function checkKeyRelease(e) {

  e = e || window.event;

  key_state[e.keyCode] = false

}


function sum(a) {
  var s = 0;
  for (var i = 0; i < a.length; i++) s += a[i];
  return s;
} 

function degToRad(a) {
  return Math.PI / 180 * a;
}

function meanAngleDeg(a) {
  return 180 / Math.PI * Math.atan2(
      sum(a.map(degToRad).map(Math.sin)) / a.length,
      sum(a.map(degToRad).map(Math.cos)) / a.length
  );
}



class Map{
  constructor(world, direction, speed){

    this.world = world

    this.wind_direction = direction;  
    this.wind_speed = speed;

    this.show_forces = true;
    this.show_fields = false;

    this.camera_follow_target = undefined;
    this.camera_follow = false;
    this.camera_zoom = 30;
    this.camera_zoom_max = 70;
    this.camera_zoom_min = 10;
    
    this.camera_position_x = 0;
    this.camera_position_y = 0;

    this.camera_position_x_max = 30;
    this.camera_position_x_min = -30;

    this.camera_position_y_max = 30;
    this.camera_position_y_min = -30;

  }

  get_wind_speed(x, y){
  

    let v0 = fluid.get_field_velocity(x,y)
    let v1 = fluid.get_field_velocity(x-1,y)
    let v2 = fluid.get_field_velocity(x+1,y)
    let v3 = fluid.get_field_velocity(x,y-1)
    let v4 = fluid.get_field_velocity(x,y+1)

    let tws = 0
    tws += Math.sqrt(v0.x*v0.x + v0.y*v0.y)
    tws += Math.sqrt(v1.x*v1.x + v1.y*v1.y)
    tws += Math.sqrt(v2.x*v2.x + v2.y*v2.y)
    tws += Math.sqrt(v3.x*v3.x + v3.y*v3.y)
    tws += Math.sqrt(v4.x*v4.x + v4.y*v4.y)

    return tws/5*5.0;
  }

  get_wind_direction(x, y){
  

    let v0 = fluid.get_field_velocity(x,y)
    let v1 = fluid.get_field_velocity(x-1,y)
    let v2 = fluid.get_field_velocity(x+1,y)
    let v3 = fluid.get_field_velocity(x,y-1)
    let v4 = fluid.get_field_velocity(x,y+1)

    let angle_array = [Math.atan2(v0.x, v0.y)/Math.PI*180 + 270,
      Math.atan2(v1.x, v1.y)/Math.PI*180 + 270,
      Math.atan2(v2.x, v2.y)/Math.PI*180 + 270,
      Math.atan2(v3.x, v3.y)/Math.PI*180 + 270,
      Math.atan2(v4.x, v4.y)/Math.PI*180 + 270
    ]
    let twa = meanAngleDeg(angle_array)

    return twa;
  }

  set_camera_follow_target(obj){

    this.camera_follow_target = obj;
  }

  physics_model_step(){
    if (this.camera_follow === true && this.camera_follow_target !== undefined){

      this.camera_position_x = this.camera_follow_target.x
      this.camera_position_y = this.camera_follow_target.y

      if (this.camera_position_x>this.camera_position_x_max) {this.camera_position_x = this.camera_position_x_max}
      if (this.camera_position_y>this.camera_position_y_max) {this.camera_position_y = this.camera_position_y_max}
      if (this.camera_position_x<this.camera_position_x_min) {this.camera_position_x = this.camera_position_x_min}
      if (this.camera_position_y<this.camera_position_y_min) {this.camera_position_y = this.camera_position_y_min}

    }
  }

  input_show_fields(e){
    this.show_fields = e;
  }

  input_show_forces(e){
    this.show_forces = e;
  }

  input_camera_follow(e){

    this.camera_follow = e;

  }  
  
  input_camera_zoom_relative(e){
 
    this.camera_zoom += e;

    if (this.camera_zoom>this.camera_zoom_max) {this.camera_zoom = this.camera_zoom_max}
    if (this.camera_zoom<this.camera_zoom_min) {this.camera_zoom = this.camera_zoom_min}

  }

  input_camera_move_relative(dx, dy){
 
    this.camera_position_x += dx
    this.camera_position_y += dy

    if (this.camera_position_x>this.camera_position_x_max) {this.camera_position_x = this.camera_position_x_max}
    if (this.camera_position_y>this.camera_position_y_max) {this.camera_position_y = this.camera_position_y_max}
    if (this.camera_position_x<this.camera_position_x_min) {this.camera_position_x = this.camera_position_x_min}
    if (this.camera_position_y<this.camera_position_y_min) {this.camera_position_y = this.camera_position_y_min}

  }

}

class Boat{

  constructor(map, x, y, hull_angle){

    this.map = map;

    let pl = planck, Vec2 = pl.Vec2;

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

    this.hull_mass = 8; // was 6
    this.hull_shape = pl.Polygon([Vec2(0, -2.25), Vec2(-0.5, -1.25), Vec2(-0.75, -0.25),  Vec2(-0.75, 0.5),  Vec2(-0.5, 1.75), Vec2(0.5, 1.75),  Vec2(0.75, 0.5), Vec2(0.75, -0.25), Vec2(0.5, -1.25), Vec2(0, -2.25)])
   

    
    this.rudder_input = 0;
    this.motor_input = 0;


    this.rudder_angle = 0;
    this.rudder_angle_last = 0;
    this.rudder_angle_max = 60;
    this.rudder_position = 1.8
    this.rudder_lenght = 0.5



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
    this.autopilot_heading_target = 0;
    this.autopilot_heading_input = 0;

    this.autopilot_heading_best_vmg_1 = 60;
    this.autopilot_heading_best_vmg_2 = 160;

    this.autopilot_compensator_p = 0;
    this.autopilot_compensator_i = 0;
    this.autopilot_compensator_d = 0;

    this.autopilot_compensator_last_error = 0;
    this.autopilot_compensator_current_error = 0;
    this.autopilot_compensator_sum_error = 0;

    this.twa = 0;

    this.physics_model_init()

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

    document.getElementById("info").innerHTML = "Autopilot" + this.autopilot_enabled + "<br>"
    document.getElementById("info").innerHTML += "Heading Target" + this.autopilot_heading_target + "<br>"
    // calculate boat dynamics


    this.x = this.physics_model.m_xf.p.x;
    this.y = this.physics_model.m_xf.p.y;
    
    this.wind_speed = this.map.get_wind_speed(this.x, this.y)
    this.wind_direction = this.map.get_wind_direction(this.x, this.y)


    var angle = this.physics_model.getAngle();



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
    this.physics_model.applyForce(centerboard_f, centerboard_p, true);   
    forces.push({name: "centerboard", vector: centerboard_f, point: centerboard_p})

    document.getElementById("info").innerHTML += "q/d: "+ centerboard_AoA_degrees + "°<br>"; 
  



    // Calculate True wind and apparent wind
    let twa = (map.get_wind_direction(this.x, this.y) - angle/Math.PI*180 + 90 )

    let aw_vector = {}

    aw_vector.x = this.physics_model.m_linearVelocity.x + Math.cos(map.get_wind_direction(this.x, this.y) /180*Math.PI) * this.map.get_wind_speed(this.x, this.y);
    aw_vector.y = this.physics_model.m_linearVelocity.y + Math.sin(map.get_wind_direction(this.x, this.y) /180*Math.PI) * this.map.get_wind_speed(this.x, this.y);

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


    // fake motor

    if (this.motor_input === 1) {
      var f = this.physics_model.getWorldVector(Vec2(0.0, -0.3));
      var p = this.physics_model.getWorldPoint(Vec2(0.0, 2.0));
      this.physics_model.applyLinearImpulse(f, p, true);
    }  
    
    if (this.motor_input === -1) {
      var f = this.physics_model.getWorldVector(Vec2(0.0, 0.3));
      var p = this.physics_model.getWorldPoint(Vec2(0.0, 2.0));
      this.physics_model.applyLinearImpulse(f, p, true);
    }


    // rudder dynamics

 

    this.rudder_angle_last = this.rudder_angle;
    let pumpfactor = 0;

    const rudder_turn_rate = (1-Math.abs(d)>0)?1-Math.abs(d)+1:1;

    if (this.rudder_input === -1) {

      if (this.rudder_angle<this.rudder_angle_max){
        this.rudder_angle +=rudder_turn_rate
      }

      
      pumpfactor = 1.5* (this.rudder_angle-this.rudder_angle_last)*(this.rudder_angle-this.rudder_angle_last)*(this.rudder_angle-this.rudder_angle_last)
    } else if (this.rudder_input === 1) {
      
      if (this.rudder_angle>-this.rudder_angle_max){
        this.rudder_angle -=rudder_turn_rate
      }

      pumpfactor = 1.5* (this.rudder_angle-this.rudder_angle_last)*(this.rudder_angle-this.rudder_angle_last)*(this.rudder_angle-this.rudder_angle_last)
    }
    else{

      let dmod = d
      if (d>1){
        dmod = 1
      }
      if (d<-1){
        dmod = -1
      }

      this.rudder_angle = this.rudder_angle*(0.98-dmod/80)

    }
    
    if (this.autopilot_enabled){

      this.autopilot_compensator_p = 1 // 0.5
      this.autopilot_compensator_i = 0 // 0
      this.autopilot_compensator_d = 40 //  20

      let error = -(this.autopilot_heading_target - (-this.twa))

      this.autopilot_compensator_sum_error *=0.85
      this.autopilot_compensator_sum_error += error;

      if (error>180) {
        error-=360
      }
      if (error<-180) {
        error+=360
      }

      document.getElementById("info").innerHTML += "error: "+ Math.floor(error) + "°<br>"; 

      let comp_p = error * this.autopilot_compensator_p 
      let comp_i = this.autopilot_compensator_sum_error * this.autopilot_compensator_i 
      let comp_d = (error - this.autopilot_compensator_last_error) * this.autopilot_compensator_d

      

      this.rudder_angle_target = (comp_p + comp_i + comp_d)*Math.sign(d)

      if (this.rudder_angle_target>this.rudder_angle_max/2){
        this.rudder_angle_target = this.rudder_angle_max/2;
      }
      if (this.rudder_angle_target<-this.rudder_angle_max/2){
        this.rudder_angle_target = -this.rudder_angle_max/2;
      }

      this.rudder_angle += (this.rudder_angle_target - this.rudder_angle)/10


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

    this.physics_model.applyForce(rudder_f, rudder_p, true); 
    forces.push({name: "rudder", vector: rudder_f, point: rudder_p})


    document.getElementById("info").innerHTML += "TWA: "+Math.floor(twa) + "<br>";
    document.getElementById("info").innerHTML += "TWS: "+Math.floor(map.get_wind_speed(this.x, this.y)) + "<br>";
    document.getElementById("info").innerHTML += "AWA: "+Math.floor(awa) + "<br>";
    document.getElementById("info").innerHTML += "AWS: "+Math.floor(aws*10)/10 + "<br>";


    // Calculate boat speed and velocity made good

    let bs = Math.sqrt(this.physics_model.m_linearVelocity.x*this.physics_model.m_linearVelocity.x + this.physics_model.m_linearVelocity.y*this.physics_model.m_linearVelocity.y)
    let vmg = Math.cos(twa/180*Math.PI)*bs

    document.getElementById("info").innerHTML += "BS: "+ Math.floor( bs *10) /10 + "<br>"; 
    document.getElementById("info").innerHTML += "VMG: "+ Math.floor( vmg *10) /10 + "<br>"; 



    // JIB

    this.jib_boom_angle = this.awa*this.jib_boom_angle_factor;

    if (this.jib_boom_angle>this.jib_boom_angle_max) this.jib_boom_angle = this.jib_boom_angle_max;
    if (this.jib_boom_angle<-this.jib_boom_angle_max) this.jib_boom_angle = -this.jib_boom_angle_max;


    // MAINSAIL

    this.mainsail_boom_angle = this.awa*this.mainsail_boom_angle_factor;

    if (this.mainsail_boom_angle>this.mainsail_boom_angle_max) this.mainsail_boom_angle = this.mainsail_boom_angle_max;
    if (this.mainsail_boom_angle<-this.mainsail_boom_angle_max) this.mainsail_boom_angle = -this.mainsail_boom_angle_max;


    // calculate lookup index
    const lookup_index = Math.floor(Math.abs(this.mainsail_boom_angle-this.awa)/this.aero_lookup_resolution)
    const interpolator = Math.abs(this.mainsail_boom_angle-this.awa)/this.aero_lookup_resolution - lookup_index


    let c_drag = this.aero_drag_lookup[lookup_index]* (1-interpolator) + this.aero_drag_lookup[lookup_index+1] * (interpolator)
    let c_lift = this.aero_lift_lookup[lookup_index]* (1-interpolator) + this.aero_lift_lookup[lookup_index+1] * (interpolator)

    let sail_f_drag = {};
    let sail_f_lift = {};

    document.getElementById("info").innerHTML += "Cd: "+ Math.floor( c_drag *10) /10 + "<br>"; 
    document.getElementById("info").innerHTML += "Cl: "+ Math.floor( c_lift *10) /10 + "<br>"; 
    
    const sail_efficiency = 0.15

    sail_f_drag.x = Math.cos(angle+this.awa/180*Math.PI + Math.PI/2 )*aws*aws*c_drag*sail_efficiency
    sail_f_drag.y = Math.sin(angle+this.awa/180*Math.PI + Math.PI/2 )*aws*aws*c_drag*sail_efficiency
    
    sail_f_lift.x = -Math.sign(this.awa)*Math.cos(angle+(this.awa)/180*Math.PI )*aws*aws*c_lift*sail_efficiency
    sail_f_lift.y = -Math.sign(this.awa)*Math.sin(angle+(this.awa)/180*Math.PI )*aws*aws*c_lift*sail_efficiency

    let mainsail_f = {};

    mainsail_f.x = sail_f_drag.x  + sail_f_lift.x
    mainsail_f.y = sail_f_drag.y  + sail_f_lift.y


    var mainsail_p = this.physics_model.getWorldPoint(Vec2(0.0, this.center_of_lift));
    
    //this.physics_model.applyForce(mainsail_f, mainsail_p, true);   
    //forces.push({name: "mainsail", vector: mainsail_f, point: mainsail_p})
    
    this.physics_model.applyForce(sail_f_lift, mainsail_p, true); 
    this.physics_model.applyForce(sail_f_drag, mainsail_p, true); 
    forces.push({name: "mainsail", vector: sail_f_lift, point: mainsail_p})
    forces.push({name: "mainsail", vector: sail_f_drag, point: mainsail_p})

    this.power = Math.sqrt(mainsail_f.x*mainsail_f.x + mainsail_f.y*mainsail_f.y)
    this.power_direction = Math.atan2(mainsail_f.y, mainsail_f.x) / Math.PI * 180;

    
    document.getElementById("info").innerHTML += "Power: "+ Math.floor( this.power *10) /10 + "<br>"; 



    // Calculate DRAG
    var drag_f = {}
    drag_f.x = -(this.physics_model.m_linearVelocity.x)*bs
    drag_f.y = -(this.physics_model.m_linearVelocity.y)*bs


    var drag_p = this.physics_model.getWorldPoint(Vec2(0.0, 0));
    this.physics_model.applyForce(drag_f, drag_p, true);   
    //forces.push({name: "drag", vector: drag_f, point: drag_p})


    // clear inputs
    this.rudder_input = 0;
    this.motor_input = 0;

  }
  
  grephics_model_render(){


    // autopilot guide
    let a = {}

    let a_length = 2;
    if (this.autopilot_enabled){
      a_length = 10;
    }

    a.x1 = this.physics_model.getWorldPoint(Vec2(0.0, 0.0)).x;
    a.y1 = this.physics_model.getWorldPoint(Vec2(0.0, 0.0)).y;
    a.x2 = a.x1+Math.cos((this.wind_direction + this.autopilot_heading_target)/180*Math.PI)*a_length;
    a.y2 = a.y1+Math.sin((this.wind_direction + this.autopilot_heading_target)/180*Math.PI)*a_length;

    a.color = 0x556677

    guides.push(a)

    // wind indicator

    
    let wind_angle = (this.wind_direction)/180*Math.PI

    guides.push({ color: 0x554477, 
      x1: this.x + Math.cos(wind_angle)*3,
      y1: this.y + Math.sin(wind_angle)*3,
      x2: this.x + Math.cos(wind_angle)*5 + Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 + Math.sin(wind_angle+Math.PI/2)*0.5
    })

    guides.push({ color: 0x554477, 
      x1: this.x + Math.cos(wind_angle)*3,
      y1: this.y + Math.sin(wind_angle)*3,
      x2: this.x + Math.cos(wind_angle)*5 - Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 - Math.sin(wind_angle+Math.PI/2)*0.5
    })

    guides.push({ color: 0x554477, 
      x1: this.x + Math.cos(wind_angle)*4.75,
      y1: this.y + Math.sin(wind_angle)*4.75,
      x2: this.x + Math.cos(wind_angle)*5 - Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 - Math.sin(wind_angle+Math.PI/2)*0.5
    })    
    
    guides.push({ color: 0x554477, 
      x1: this.x + Math.cos(wind_angle)*4.75,
      y1: this.y + Math.sin(wind_angle)*4.75,
      x2: this.x + Math.cos(wind_angle)*5 + Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 + Math.sin(wind_angle+Math.PI/2)*0.5
    })

    wind_angle = (this.awa)/180*Math.PI + this.hull_angle - Math.PI/2

    guides.push({ color: 0x550077, 
      x1: this.x + Math.cos(wind_angle)*3,
      y1: this.y + Math.sin(wind_angle)*3,
      x2: this.x + Math.cos(wind_angle)*5 + Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 + Math.sin(wind_angle+Math.PI/2)*0.5
    })

    guides.push({ color: 0x550077, 
      x1: this.x + Math.cos(wind_angle)*3,
      y1: this.y + Math.sin(wind_angle)*3,
      x2: this.x + Math.cos(wind_angle)*5 - Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 - Math.sin(wind_angle+Math.PI/2)*0.5
    })

    guides.push({ color: 0x550077, 
      x1: this.x + Math.cos(wind_angle)*4.75,
      y1: this.y + Math.sin(wind_angle)*4.75,
      x2: this.x + Math.cos(wind_angle)*5 - Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 - Math.sin(wind_angle+Math.PI/2)*0.5
    })    
    
    guides.push({ color: 0x550077, 
      x1: this.x + Math.cos(wind_angle)*4.75,
      y1: this.y + Math.sin(wind_angle)*4.75,
      x2: this.x + Math.cos(wind_angle)*5 + Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 + Math.sin(wind_angle+Math.PI/2)*0.5
    })

    // rendering the rudder
    let r = {}

    r.x1 = this.physics_model.getWorldPoint(Vec2(0.0, this.rudder_position)).x;
    r.y1 = this.physics_model.getWorldPoint(Vec2(0.0, this.rudder_position)).y;
    r.x2 = r.x1+Math.cos(this.physics_model.getAngle() + Math.PI/2 +this.rudder_angle/180*Math.PI)*this.rudder_lenght;
    r.y2 = r.y1+Math.sin(this.physics_model.getAngle() + Math.PI/2 +this.rudder_angle/180*Math.PI)*this.rudder_lenght;

    rudders.push(r)

    // rendering the centerboard

    let e = {}
    
    e.x1 = this.physics_model.getWorldPoint(Vec2(0.0, this.centerboard_position + this.centerboard_length/2)).x;
    e.y1 = this.physics_model.getWorldPoint(Vec2(0.0, this.centerboard_position + this.centerboard_length/2)).y;
    e.x2 = this.physics_model.getWorldPoint(Vec2(0.0, this.centerboard_position - this.centerboard_length/2)).x;
    e.y2 = this.physics_model.getWorldPoint(Vec2(0.0, this.centerboard_position - this.centerboard_length/2)).y;

    rudders.push(e)

    // rendering the mainsail

    
    let mainsail = []

    mainsail[0] = {};
    mainsail[0].x = this.physics_model.getWorldPoint(Vec2(0.0, this.mainsail_leading_edge_position)).x;
    mainsail[0].y = this.physics_model.getWorldPoint(Vec2(0.0, this.mainsail_leading_edge_position)).y;

    let awa = this.mainsail_boom_angle/this.mainsail_boom_angle_factor


    this.mainsail_boom_angle_actual+= (this.mainsail_boom_angle-this.mainsail_boom_angle_actual)/30;

    let mainsail_fat1 = (this.mainsail_boom_length*0.05*Math.abs(this.awa)/30 < this.mainsail_boom_length/10)?this.mainsail_boom_length*0.05*Math.abs(this.awa)/30 :this.mainsail_boom_length/10;
    mainsail[1] = {};
    mainsail[1].x = mainsail[0].x + Math.cos(this.hull_angle+ Math.PI/2 + this.mainsail_boom_angle_actual /180*Math.PI) * this.mainsail_boom_length*0.25 +  Math.cos(this.hull_angle+ this.mainsail_boom_angle_actual /180*Math.PI)*-mainsail_fat1*Math.sign(this.mainsail_boom_angle_actual);
    mainsail[1].y = mainsail[0].y  +Math.sin(this.hull_angle+ Math.PI/2 + this.mainsail_boom_angle_actual /180*Math.PI) * this.mainsail_boom_length*0.25 +  Math.sin(this.hull_angle + this.mainsail_boom_angle_actual /180*Math.PI)*-mainsail_fat1*Math.sign(this.mainsail_boom_angle_actual);
    
    let mainsail_fat2 = mainsail_fat1;
    mainsail[2] = {};
    mainsail[2].x = mainsail[0].x + Math.cos(this.hull_angle + Math.PI/2 + this.mainsail_boom_angle_actual /180*Math.PI) * this.mainsail_boom_length*0.5 +  Math.cos(this.hull_angle + this.mainsail_boom_angle_actual /180*Math.PI)*-mainsail_fat2*Math.sign(this.mainsail_boom_angle_actual);
    mainsail[2].y = mainsail[0].y  +Math.sin(this.hull_angle + Math.PI/2 + this.mainsail_boom_angle_actual /180*Math.PI) * this.mainsail_boom_length*0.5 +  Math.sin(this.hull_angle + this.mainsail_boom_angle_actual /180*Math.PI)*-mainsail_fat2*Math.sign(this.mainsail_boom_angle_actual);

    mainsail[3] = {};
    mainsail[3].x = mainsail[0].x + Math.cos(this.hull_angle + Math.PI/2 + this.mainsail_boom_angle_actual /180*Math.PI) * this.mainsail_boom_length;
    mainsail[3].y = mainsail[0].y  +Math.sin(this.hull_angle + Math.PI/2 + this.mainsail_boom_angle_actual /180*Math.PI) * this.mainsail_boom_length;

    sails.push(mainsail)

    // RENDER JIB SHAPE


    this.jib_boom_angle_actual+= (this.jib_boom_angle-this.jib_boom_angle_actual)/20;

    let jib = []

    jib[0] = {};
    jib[0].x = this.physics_model.getWorldPoint(Vec2(0.0, this.jib_leading_edge_position)).x;
    jib[0].y = this.physics_model.getWorldPoint(Vec2(0.0, this.jib_leading_edge_position)).y;

    let jib_fat1 = (this.jib_boom_length*0.05*Math.abs(this.awa)/15 < this.jib_boom_length/3)?this.jib_boom_length*0.05*Math.abs(this.awa)/15 :this.jib_boom_length/3;
    jib[1] = {};
    jib[1].x = jib[0].x + Math.cos(this.hull_angle + Math.PI/2 + this.jib_boom_angle_actual /180*Math.PI) * this.jib_boom_length*0.25 +  Math.cos(this.hull_angle + this.jib_boom_angle_actual /180*Math.PI)*-jib_fat1*Math.sign(this.jib_boom_angle_actual);
    jib[1].y = jib[0].y  +Math.sin(this.hull_angle + Math.PI/2 + this.jib_boom_angle_actual /180*Math.PI) * this.jib_boom_length*0.25 +  Math.sin(this.hull_angle + this.jib_boom_angle_actual /180*Math.PI)*-jib_fat1*Math.sign(this.jib_boom_angle_actual);
    
    let jib_fat2 = jib_fat1;
    jib[2] = {};
    jib[2].x = jib[0].x + Math.cos(this.hull_angle + Math.PI/2 + this.jib_boom_angle_actual /180*Math.PI) * this.jib_boom_length*0.5 +  Math.cos(this.hull_angle + this.jib_boom_angle_actual /180*Math.PI)*-jib_fat2*Math.sign(this.jib_boom_angle_actual);
    jib[2].y = jib[0].y  +Math.sin(this.hull_angle + Math.PI/2 + this.jib_boom_angle_actual /180*Math.PI) * this.jib_boom_length*0.5 +  Math.sin(this.hull_angle + this.jib_boom_angle_actual /180*Math.PI)*-jib_fat2*Math.sign(this.jib_boom_angle_actual);

    jib[3] = {};
    jib[3].x = jib[0].x + Math.cos(this.hull_angle + Math.PI/2 + this.jib_boom_angle_actual /180*Math.PI) * this.jib_boom_length;
    jib[3].y = jib[0].y  +Math.sin(this.hull_angle + Math.PI/2 + this.jib_boom_angle_actual /180*Math.PI) * this.jib_boom_length;

    sails.push(jib);


  }
  


  input_rudder_left(){
    this.rudder_input = 1
    this.autopilot_enabled = false
  }
  input_rudder_right(){
    this.rudder_input = -1
    this.autopilot_enabled = false
  }

  input_motor_forward(){
    this.motor_input = 1
  }
  input_motor_reverse(){
    this.motor_input = -1
  }

  input_autopilot_enabled_toggle(){


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
    this.autopilot_heading_target *=-1
    this.autopilot_enabled = true
  }

  input_autopilot_heading_increase(){


    this.autopilot_enabled = true
    if (Math.abs(this.autopilot_heading_target)<175){
      if (this.autopilot_heading_target>0){
        this.autopilot_heading_target += 1
      } 
      else{
        this.autopilot_heading_target -= 1        
      }
    }

  }
  input_autopilot_heading_decrease(){

    this.autopilot_enabled = true
    if (Math.abs(this.autopilot_heading_target)>5){
      if (this.autopilot_heading_target>0){
        this.autopilot_heading_target -= 1
      } 
      else{
        this.autopilot_heading_target += 1        
      }
    }
    
  }


}

class Path{
  constructor(map, x, y, power){

    this.map = map
    this.power = power;
    this.x = x;
    this.y = y;
    this.age = 0;

  }

  physics_model_step(){

    let wdir = map.get_wind_direction(this.x, this.y)
    let wspe = -map.get_wind_speed(this.x, this.y)

    this.x += Math.cos(wdir/180*Math.PI)*wspe/100
    this.y += Math.sin(wdir/180*Math.PI)*wspe/100

    this.age++
  }

  graphics_model_render(){

    path_markers.push({x: this.x, y: this.y, power: this.power, age: this.age})

  }

}

function setup_world(){

  let pl = planck, Vec2 = pl.Vec2;
  
  let world = new World(Vec2(0, 0));

  let ground = world.createBody(Vec2(0.0, 0.0));

  let wallFD = {
    density: 0.0,
    restitution: 0.4,
  };

  // Left vertical
  ground.createFixture(pl.Edge(Vec2(-40.0, -40.0), Vec2(-40.0, 40.0)), wallFD);

  // Right vertical
  ground.createFixture(pl.Edge(Vec2(40.0, -40.0), Vec2(40.0, 40.0)), wallFD);

  // Top horizontal
  ground.createFixture(pl.Edge(Vec2(-40.0, 40.0), Vec2(40.0, 40.0)), wallFD);

  // Bottom horizontal
  ground.createFixture(pl.Edge(Vec2(-40.0, -40.0), Vec2(40.0, -40.0)), wallFD);

  return world;
} 


const canvas = document.querySelector('#test')

canvas.height = window.innerHeight;
canvas.width = window.innerWidth;

const ctx = canvas.getContext('2d')

ctx.translate(300, 0);

const options = {
  scale: 16,
  strokeStyle: {
    lineWidth:1/16,
    dynamic: 'white',
    static: 'white',
    kinematic: 'white',
  },
}

const world = setup_world();


// init world entities
world.createDynamicBody(Vec2(0.0, 14.5)).createFixture(Circle(0.5), 10.0);
world.createDynamicBody(Vec2(0.0, 20.0)).createFixture(Circle(5.0), 10.0);



const runner = new Runner(world, {
	// default settings
	speed: 1,
	fps: 60,
})


let map = new Map(world, 90, 5)
let scenario_descriptor = {}
let players = []
let paths = []

let physics_frame = 0;


function scenario_clear(){

  scenario_descriptor = {};
  key_bind_list = [];

  players.forEach(player => {
    player.physics_model_deinit()
  });
  players = [];
  physics_frame = 0;
  
}

function scenario_start(param){

  scenario_clear()

  scenario_descriptor = param
  
}

function autokeybind(players){

  key_bind_list = [];
  
  if (players[0] !== undefined){
    key_bind_list.push({type: "PRESSED", activation_key: 37, prohibition_key: 39, object: players[0], input_handler: players[0].input_rudder_left.name})   // Left
    key_bind_list.push({type: "PRESSED", activation_key: 39, prohibition_key: 37, object: players[0], input_handler: players[0].input_rudder_right.name})  // Right
    key_bind_list.push({type: "PRESSED", activation_key: 40, prohibition_key: 38, object: players[0], input_handler: players[0].input_autopilot_heading_increase.name})
    key_bind_list.push({type: "PRESSED", activation_key: 38, prohibition_key: 40, object: players[0], input_handler: players[0].input_autopilot_heading_decrease.name})
    key_bind_list.push({type: "KEYDOWN", activation_key: 32, prohibition_key: -1, object: players[0], input_handler: players[0].input_autopilot_enabled_toggle.name})
    key_bind_list.push({type: "KEYDOWN", activation_key: 13, prohibition_key: -1, object: players[0], input_handler: players[0].input_autopilot_tack_toggle.name})
  }

  if (players[1] !== undefined){
    key_bind_list.push({type: "PRESSED", activation_key: 65, prohibition_key: 68, object: players[1], input_handler: players[1].input_rudder_left.name})
    key_bind_list.push({type: "PRESSED", activation_key: 68, prohibition_key: 65, object: players[1], input_handler: players[1].input_rudder_right.name})
    key_bind_list.push({type: "PRESSED", activation_key: 83, prohibition_key: 87, object: players[1], input_handler: players[1].input_autopilot_heading_increase.name})
    key_bind_list.push({type: "PRESSED", activation_key: 87, prohibition_key: 83, object: players[1], input_handler: players[1].input_autopilot_heading_decrease.name})
    key_bind_list.push({type: "KEYDOWN", activation_key: 17, prohibition_key: -1, object: players[1], input_handler: players[0].input_autopilot_enabled_toggle.name})
    key_bind_list.push({type: "KEYDOWN", activation_key: 16, prohibition_key: -1, object: players[1], input_handler: players[0].input_autopilot_tack_toggle.name})
  }


}

let scenarios = []

scenarios[0] = []
scenarios[0] [0] = () => {players.push(new Boat(map, 10, -9, 5*Math.PI/4));}
scenarios[0] [1] = () => {console.log(1); players[0].input_autopilot_enabled_toggle();}
scenarios[0] [2] = () => {autokeybind(players);}

scenarios[1] = []
scenarios[1] [0] = () => {players.push(new Boat(map, 10, -9, 5*Math.PI/4)); players.push(new Boat(map, 15, -11.5, 5*Math.PI/4)); }
scenarios[1] [1] = () => {console.log(1); players[0].input_autopilot_enabled_toggle(); players[1].input_autopilot_enabled_toggle();}
scenarios[1] [2] = () => {autokeybind(players);}
scenarios[1] [1500] = () => {scenario_clear()}

scenarios[2] = []
scenarios[2] [0] = () => {players.push(new Boat(map, -10, -6, 3*Math.PI/4)); players.push(new Boat(map, 15, -11.5, 5*Math.PI/4)); }
scenarios[2] [1] = () => {console.log(1); players[0].input_autopilot_enabled_toggle(); players[1].input_autopilot_enabled_toggle();}
scenarios[2] [2] = () => {autokeybind(players);}
scenarios[2] [1500] = () => {scenario_clear()}

scenarios[3] = []
scenarios[3] [0] = () => {players.push(new Boat(map, -12, -6, 3*Math.PI/4)); players.push(new Boat(map, 18, -11.5, 5*Math.PI/4)); }
scenarios[3] [1] = () => {console.log(1); players[0].input_autopilot_enabled_toggle(); players[1].input_autopilot_enabled_toggle();}
scenarios[3] [2] = () => {autokeybind(players);}
scenarios[3] [300] = () => {players[0].input_autopilot_tack_toggle()}
scenarios[3] [1500] = () => {scenario_clear()}


scenario_start(scenarios[document.getElementById("scenario_selector").value]);


function HSVtoRGB(h, s, v) {
  var r, g, b, i, f, p, q, t;
  if (arguments.length === 1) {
      s = h.s, v = h.v, h = h.h;
  }
  i = Math.floor(h * 6);
  f = h * 6 - i;
  p = v * (1 - s);
  q = v * (1 - f * s);
  t = v * (1 - (1 - f) * s);
  switch (i % 6) {
      case 0: r = v, g = t, b = p; break;
      case 1: r = q, g = v, b = p; break;
      case 2: r = p, g = v, b = t; break;
      case 3: r = p, g = q, b = v; break;
      case 4: r = t, g = p, b = v; break;
      case 5: r = v, g = p, b = q; break;
  }
  return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
  };
}

runner.start(() => {

  // clear the array of displayed graphic elements
  forces = []; 
  rudders = [];
  guides = [];
  sails = [];
  path_markers = [];


  if (scenario_descriptor !== undefined){
    if (scenario_descriptor[physics_frame] !== undefined){
      console.log("Frame ", physics_frame)
      scenario_descriptor[physics_frame]()
    }
  
  }

  key_bind_list.forEach(bind => {

    if (bind.type === "PRESSED" && key_state[bind.activation_key] === true && (key_state[bind.prohibition_key] === false || key_state[bind.prohibition_key] === undefined)){

      bind.object[bind.input_handler]()
    }

  });

  map.set_camera_follow_target(players[0])
  map.physics_model_step();

  players.forEach(player => {

    player.physics_model_step();
    player.grephics_model_render();


    let p = {}

    let wind_angle = (player.awa)/180*Math.PI + player.hull_angle - Math.PI/2
    p.x = player.x + Math.cos(wind_angle)*(-1.2)   
    p.y = player.y + Math.sin(wind_angle)*(-1.2)   

    fluid.apply_energy(p.x, p.y, player.power_direction, player.power*0.75)


 
  });

  physics_frame++

  fluid.loop()


  var field = fluid.vectorField.field;
  for (let x=0; x<80; x++){

    let sum = 0;
    for (let y=0; y<80; y++){

      //console.log(x,y )
      //sum += Math.sqrt(field[x][y].vx*field[x][y].vx + field[x][y].vy*field[x][y].vy)

      let velocity = Math.floor(Math.sqrt(field[x][y].vx*field[x][y].vx + field[x][y].vy*field[x][y].vy)*50)


      let angle = Math.floor(Math.atan2(field[x][y].vy, field[x][y].vx)/Math.PI*180) + 270

      while(angle>360){
        angle-=360
      }          
      while(angle<0){
        angle+=360
      }


      let rgb;
      
      rgb = HSVtoRGB(angle/360,0.5,velocity/200)

      rgb = HSVtoRGB(angle/360,0.0,velocity/200)

      field_draw[x][y].material.color.setHex(  256*256*rgb.r + 256*rgb.g + rgb.b );

    }

  }


  if (map.show_fields){
    
    

    fluid.particles
    var cols = fluid.colors;
    var mf;
    var imaxspeed = 1 / fluid.maxParticleSpeed;

    var p, i = fluid.particleCount;
    while( i-- ){
      p = fluid.particles[ i ];

      mf = p.speed * imaxspeed;
      if( mf > 1 ) mf = 1;


      let g = {}
      g.x1 = p.ox / 10 -40
      g.y1 = p.oy / 10 -40
      g.x2 = p.x / 10 -40
      g.y2 = p.y / 10 -40
      g.color = 0xAAAAAA
      g.opacity = (50-Math.abs(50-p.age))/50

      guides.push(g)

    }

  }



  let paths_to_keep = []

  paths.forEach(path => {

    path.physics_model_step()
    path.graphics_model_render()

    if (path.age<250){
      paths_to_keep.push(path)
    }
  });

  paths = paths_to_keep;


},
() => {



}


) // start rendering world



import * as THREE from '../node_modules/three/build/three.module.js';

let camera, scene, renderer, mesh;
let uniforms = {};

init();

function vertexShader() {
  return `
    varying vec3 vUv; 

    void main() {
      vUv = position; 

      vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * modelViewPosition; 
    }
  `
}

function fragmentShader() {
  return `
    uniform vec3 colorA; 
    uniform vec3 colorB; 
    uniform float time; 

    uniform float testarray[900]; 

    varying vec3 vUv;



    void main() {


      /*
      float windangle = 60.0; 

      float angle = (windangle/180.0)*3.141592;
    
      float distance =  sqrt(vUv.x*vUv.x + vUv.y*vUv.y);
    
      float alpha = atan(vUv.y, vUv.x);
    
      float phase = cos((angle - alpha))*distance;
    
      float d = 0.25*sin((phase/1.0+time/1.0));

      gl_FragColor = vec4(0.5+d, 0.5+d, 0.5+d, 1);

      */
      //float red = floor(vUv.x/10)%4*4 + floor(vUv.y/10)%4;


      float x = vUv.x + 15.0;
      float y = vUv.y + 15.0;

      int index_x = 0;
      if (x>0.0 && x<30.0){
        index_x = int(floor(x));
      }

      int index_y = 0;
      if (y>0.0 && y<30.0){
        index_y = int(floor(y));
      }

      int index = index_x*30 + index_y;


      float red = 0.0;

      for (int i=0; i<900; i++) {
        if (i == index) red = testarray[i];
      }


      gl_FragColor = vec4(red, red, red, 1);


    }
    `
}


let frame = 0;



function init() {

	camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 0.01, 85 );
	camera.position.z = 60;
	camera.position.y = 20;
	scene = new THREE.Scene();

 
  
  uniforms = {
    colorB: {type: 'vec3', value: new THREE.Color(0x665555)},
    colorA: {type: 'vec3', value: new THREE.Color(0x555566)},
    'time': {value: 1.0}
  }
 /*
	// let material = new THREE.MeshNormalMaterial();

  let material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    fragmentShader: fragmentShader(),
    vertexShader: vertexShader(),
  });

  mesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), material);

  //new THREE.Mesh(new THREE.PlaneGeometry(30, 30), material);
	scene.add( mesh );
  */
  for (let x=0; x<80; x++){
    field_draw[x] = []

    for (let y=0; y<80; y++){

      field_draw[x][y] = {}
      
      const geometry = new THREE.PlaneGeometry( 1, 1 );

      field_draw[x][y].material = new THREE.MeshBasicMaterial( {color: 0xffff00, side: THREE.DoubleSide} );
      field_draw[x][y].material.needsUpdate = true


      //needsUpdate

      let plane = new THREE.Mesh( geometry, field_draw[x][y].material );
      plane.position.x = x-40
      plane.position.y = y-40
      scene.add( plane);

    }

  }

	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setAnimationLoop( animation );
	document.body.appendChild( renderer.domElement );

}

let isFirstFrame = true;



function animation( time ) {




  camera.position.x = map.camera_position_x
  camera.position.y = map.camera_position_y
  camera.position.z = map.camera_zoom
  //console.log(angle, d)


  for (let element of circles){
    scene.remove(element)
    element.geometry.dispose();
    element.material.dispose();
    element = undefined;

  }

  for (let element of polygons){
    scene.remove(element)
    element.geometry.dispose();
    element.material.dispose();
    element = undefined;

  }

  for (let element of edges){
    scene.remove(element)
    element.geometry.dispose();
    element.material.dispose();
    element = undefined;

  }

  // arrows work differently, they don't need dispose
  for (let element of arrows){
    scene.remove(element)
    //element.geometry.dispose();
    //element.material.dispose();
    element = undefined;

  }  



  impulses= [];

  polygons = [];
  edges= [];
  circles= [];
  
  arrows= [];


  for (let body = world.getBodyList(); body; body = body.getNext()) {
    for (
      let fixture = body.getFixtureList();
      fixture;
      fixture = fixture.getNext()
    ) {

      if (body.render && body.render.hidden) {
        continue;
      }

      if (body.render && body.render.stroke) {
        //ctx.strokeStyle = body.render.stroke;
      } else if (body.isDynamic()) {
        //ctx.strokeStyle = options.strokeStyle.dynamic;
      } else if (body.isKinematic()) {
        //ctx.strokeStyle = options.strokeStyle.kinematic;
      } else if (body.isStatic()) {
        //ctx.strokeStyle = options.strokeStyle.static;
      }

      const type = fixture.getType();
      const shape = fixture.getShape();

      
      if (type === "circle") {
        
        const radius = shape.m_radius;
        const pos = body.getPosition();

        let points = []

        for (let i = 0; i<360; i+=10){

          let angle = i/180*Math.PI

          let x = radius*Math.cos(angle) + pos.x 
          let y = radius*Math.sin(angle) + pos.y


          points.push( new THREE.Vector3(x, y, 0) );


        }
        points.push(points[0])

        const geometry = new THREE.BufferGeometry().setFromPoints( points );
        const material = new THREE.LineBasicMaterial( { color: 0x00ff00 } );
        circles.push(new THREE.Line( geometry, material ))
        scene.add( circles[circles.length -1]);



      }
      if (type === "edge") {

        
        let points = []
        const v1 = shape.m_vertex1;
        const v2 = shape.m_vertex2;

        let x1 = v1.x + body.m_xf.p.x
        let y1 = v1.y + body.m_xf.p.y       
        
        let x2 = v2.x + body.m_xf.p.x
        let y2 = v2.y + body.m_xf.p.y 

        points.push( new THREE.Vector3(x1, y1, 0) );
        points.push( new THREE.Vector3(x2, y2, 0) );


        const geometry = new THREE.BufferGeometry().setFromPoints( points );
        const material = new THREE.LineBasicMaterial( { color: 0xff0000 } );
        edges.push(new THREE.Line( geometry, material ))
        scene.add( edges[edges.length -1]);

      }
      if (type === "polygon") {

        let vertices = shape.m_vertices;
        vertices.push(vertices[0]);

        let points = []

        for (const v of vertices) {
          //console.log(v.x, v.y)

          //let angle = fixture.getAngle()*180/Math.PI - 90;
          let angle = body.getAngle() + Math.PI;
          let com  = body.getLocalCenter()


         // o.x = v.x + com.x
         // o.y = v.y + com.y

          let x = (v.x+com.x)*Math.cos(angle) + (v.y-com.y)*Math.sin(angle);
          let y = (v.x+com.x)*Math.sin(angle) - (v.y-com.y)*Math.cos(angle);
          let z = 0;


          x += fixture.m_body.c_position.c.x
          y += fixture.m_body.c_position.c.y
          
          points.push( new THREE.Vector3(x,y,z) );
        }

        const geometry = new THREE.BufferGeometry().setFromPoints( points );
        const material = new THREE.LineBasicMaterial( { color: 0x0000ff } );
        polygons.push(new THREE.Line( geometry, material ))
        scene.add( polygons[polygons.length -1]);

        
      }
      if (type === 'chain') {
        
      }

    }
  }

  // for (let joint = this.world.getJointList(); joint; joint = joint.getNext()) {
  //   ctx.save();
  //   ctx.scale(this.options.scale, this.options.scale)
  //   this.drawJoint(joint)
  //   ctx.restore()
  // }

  // render forces

  // ARROW HELPER


  if (map.show_forces){

    for (const f of forces){


      var arrow = new THREE.ArrowHelper(
        // first argument is the direction
        new THREE.Vector3(f.vector.x, f.vector.y, 0).normalize(),
        // second argument is the origin
        new THREE.Vector3(f.point.x, f.point.y, 0),
        // length
        Math.sqrt(f.vector.x*f.vector.x + f.vector.y*f.vector.y)/5,
        // color
        0x00ff00);

      scene.add(arrow);
    
      arrows.push(arrow)

    }

  }


  for (const r of rudders){

    let points = []
    
    points.push( new THREE.Vector3(r.x1, r.y1, 0) );
    points.push( new THREE.Vector3(r.x2, r.y2, 0) );


    const geometry = new THREE.BufferGeometry().setFromPoints( points );
    const material = new THREE.LineBasicMaterial( { color: 0xff0000 } );
    edges.push(new THREE.Line( geometry, material ))
    scene.add( edges[edges.length -1]);


  }
  
  for (const r of guides){

    let points = []
    
    points.push( new THREE.Vector3(r.x1, r.y1, 0) );
    points.push( new THREE.Vector3(r.x2, r.y2, 0) );


    const geometry = new THREE.BufferGeometry().setFromPoints( points );

    let color = r.color
    if (color === undefined){
      color = 0xff0000
    }

    let options;
    let opacity;
    let transparent;


    let  material

    if (r.opacity !== undefined){
      transparent = true,
      opacity = r.opacity    
      material = new THREE.LineBasicMaterial( { color: color, transparent: transparent, opacity: opacity } );
    }
    else{ 
      material = new THREE.LineBasicMaterial( { color: color } );
    }


    edges.push(new THREE.Line( geometry, material ))
    scene.add( edges[edges.length -1]);


  }
  for (const s of sails){

    let points = []
    
    for (let i = 0; i<s.length; i++){

      points.push( new THREE.Vector3(s[i].x, s[i].y, 0) );

    }

    const geometry = new THREE.BufferGeometry().setFromPoints( points );
    const material = new THREE.LineBasicMaterial( { color: 0x00ffff } );
    edges.push(new THREE.Line( geometry, material ))
    scene.add( edges[edges.length -1]);

  }


  for (const p of path_markers){

    if (p.age<20 ) continue;

    let points = []

    let radius = 2+p.age/100;


    let strength = p.power*5 - p.age;



    if (strength>256){
      strength = 256
    }
    if (strength<0){
      strength = 0
    }

    strength=Math.floor(strength)
    

    let color = (strength)*256*256 + (strength)*256 + (strength)

    for (let i = 0; i<360; i+=10){

      let angle = i/180*Math.PI

      let x = radius*Math.cos(angle) + p.x 
      let y = radius*Math.sin(angle) + p.y


      points.push( new THREE.Vector3(x, y, 0) );


    }
    points.push(points[0])

    const geometry = new THREE.BufferGeometry().setFromPoints( points );
    const material = new THREE.LineBasicMaterial( { color: color } );

    circles.push(new THREE.Line( geometry, material ))
    scene.add( circles[circles.length -1]);


  }

  var field = fluid.vectorField.field;




  frame++;

  isFirstFrame = false;

	renderer.render( scene, camera );

}