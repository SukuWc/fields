import { World, Edge, Vec2, Circle } from 'planck-js'
import planck from 'planck-js/dist/planck-with-testbed';
import Renderer, { Runner } from "planck-renderer";
import './field.js';

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

document.getElementById("show_forces").addEventListener("change", e => {

  map.input_show_forces(document.getElementById("show_forces").checked)

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


class Map{
  constructor(direction, speed){

    this.wind_direction = direction;  
    this.wind_speed = speed;

    this.show_forces = true;

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
  
    return this.wind_speed;
  }

  get_wind_direction(x, y){
  
    return this.wind_direction;
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

  constructor(map, x, y){

    this.map = map;

    let pl = planck, Vec2 = pl.Vec2;

    this.x = x;
    this.y = y;

    this.wind_direction = 0;
    this.wind_speed = 0;

    this.hull_mass = 6;
    this.hull_shape = pl.Polygon([Vec2(0, -2.25), Vec2(-0.5, -1.25), Vec2(-0.75, -0.25),  Vec2(-0.75, 0.5),  Vec2(-0.5, 1.75), Vec2(0.5, 1.75),  Vec2(0.75, 0.5), Vec2(0.75, -0.25), Vec2(0.5, -1.25), Vec2(0, -2.25)])
   
    this.hull_angle = 0;

    
    this.rudder_input = 0;
    this.motor_input = 0;


    this.rudder_angle = 0;
    this.rudder_angle_max = 60;
    this.rudder_position = 1.8
    this.rudder_lenght = 0.5

    this.centerboard_position = 0;
    this.centerboard_length   = 0.6

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

    this.center_of_lift = -0.025

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

  }

  physics_model_init(world){

    let pl = planck, Vec2 = pl.Vec2;
    
    console.log(world)

    let boat = world.createBody({
      type : 'dynamic',
      angularDamping : 0.5,
      linearDamping : 0.1,
      position : Vec2(this.x, this.y),
      angle : Math.PI,
      allowSleep : false
    });

    console.log(boat)

    boat.createFixture(this.hull_shape, this.hull_mass);

    this.physics_model = boat;

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
    var centerboard_p = this.physics_model.getWorldPoint(Vec2(0.0, 0));

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

    let pumpfactor = 0;

 

    if (this.rudder_input === -1) {

      if (this.rudder_angle<this.rudder_angle_max){
        this.rudder_angle +=0.5
        pumpfactor = 0.75
      }

    } else if (this.rudder_input === 1) {
      
      if (this.rudder_angle>-this.rudder_angle_max){
        this.rudder_angle -=0.5
        pumpfactor = -0.75
      }

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
      //pumpfactor = rudder_angle*-dmod/20

    }
    
    if (this.autopilot_enabled){

      this.autopilot_compensator_p = 0.5
      this.autopilot_compensator_i = 0
      this.autopilot_compensator_d = 20

      let error = -(this.autopilot_heading_target - (-this.twa))

      if (error>180) {
        error-=360
      }
      if (error<-180) {
        error+=360
      }

      document.getElementById("info").innerHTML += "error: "+ Math.floor(error) + "°<br>"; 

      let p = error * this.autopilot_compensator_p 
      let i = 0
      let d = (error - this.autopilot_compensator_last_error) * this.autopilot_compensator_d

      this.rudder_angle = p + i + d

      if (this.rudder_angle>this.rudder_angle_max/3){
        this.rudder_angle = this.rudder_angle_max/3;
      }
      if (this.rudder_angle<-this.rudder_angle_max/3){
        this.rudder_angle = -this.rudder_angle_max/3;
      }


      this.autopilot_compensator_last_error = error;

    }
    else{
      this.autopilot_heading_target = angle/Math.PI*180 + 180
      
      if (this.autopilot_heading_target > 180) {this.autopilot_heading_target -= 360} 
      if (this.autopilot_heading_target < -180) {this.autopilot_heading_target += 360} 
    }




    // calculate flow directuion under the rudder
    let angular_velocity = this.physics_model.m_angularVelocity;
    let q_rot = angular_velocity*this.rudder_lenght;
    let water_angle = Math.atan2(q+q_rot, Math.abs(d)) /Math.PI*180

    let rudder_force = 0;
    if (d>0){
      rudder_force = d*(this.rudder_angle+water_angle)/5;
    }
    else{
      rudder_force = d*(this.rudder_angle-water_angle)/5; 
    }

    rudder_force += pumpfactor*4

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

    this.jib_boom_angle = awa*this.jib_boom_angle_factor;

    if (this.jib_boom_angle>this.jib_boom_angle_max) this.jib_boom_angle = this.jib_boom_angle_max;
    if (this.jib_boom_angle<-this.jib_boom_angle_max) this.jib_boom_angle = -this.jib_boom_angle_max;


    // MAINSAIL

    this.mainsail_boom_angle = awa*this.mainsail_boom_angle_factor;

    if (this.mainsail_boom_angle>this.mainsail_boom_angle_max) this.mainsail_boom_angle = this.mainsail_boom_angle_max;
    if (this.mainsail_boom_angle<-this.mainsail_boom_angle_max) this.mainsail_boom_angle = -this.mainsail_boom_angle_max;


    let mainsail_f = {};

    mainsail_f.x = -aw_vector.x - Math.cos(angle + Math.PI/2 )*aws*1.0
    mainsail_f.y = -aw_vector.y - Math.sin(angle + Math.PI/2 )*aws*1.0


    mainsail_f.x *= Math.sqrt(Math.abs(twa)/100)*2*aws
    mainsail_f.y *= Math.sqrt(Math.abs(twa)/100)*2*aws


    if (isNaN(mainsail_f.x)){
      mainsail_f.x = 0;
    }
    if (isNaN(mainsail_f.y)){
      mainsail_f.y = 0;
    }
    

    var mainsail_p = this.physics_model.getWorldPoint(Vec2(0.0, this.center_of_lift));
    
    this.physics_model.applyForce(mainsail_f, mainsail_p, true);   
    forces.push({name: "mainsail", vector: mainsail_f, point: mainsail_p})

    this.power = Math.sqrt(mainsail_f.x*mainsail_f.x + mainsail_f.y*mainsail_f.y)
    this.power_direction = Math.atan2(mainsail_f.y, mainsail_f.x) / Math.PI * 180;

    
    document.getElementById("info").innerHTML += "Power: "+ Math.floor( this.power *10) /10 + "<br>"; 



    // Calculate DRAG
    var drag_f = {}
    drag_f.x = -(this.physics_model.m_linearVelocity.x)*bs
    drag_f.y = -(this.physics_model.m_linearVelocity.y)*bs


    var drag_p = this.physics_model.getWorldPoint(Vec2(0.0, 0));
    this.physics_model.applyForce(drag_f, drag_p, true);   
    forces.push({name: "drag", vector: drag_f, point: drag_p})


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


    // rendering the rudder
    let r = {}

    r.x1 = this.physics_model.getWorldPoint(Vec2(0.0, this.rudder_position)).x;
    r.y1 = this.physics_model.getWorldPoint(Vec2(0.0, this.rudder_position)).y;
    r.x2 = r.x1+Math.cos(this.physics_model.getAngle() + Math.PI/2 +this.rudder_angle/180*Math.PI)*this.rudder_lenght;
    r.y2 = r.y1+Math.sin(this.physics_model.getAngle() + Math.PI/2 +this.rudder_angle/180*Math.PI)*this.rudder_lenght;

    rudders.push(r)

    // rendering the centerboard

    let c = {}
    
    c.x1 = this.physics_model.getWorldPoint(Vec2(0.0, this.centerboard_position + this.centerboard_length/2)).x;
    c.y1 = this.physics_model.getWorldPoint(Vec2(0.0, this.centerboard_position + this.centerboard_length/2)).y;
    c.x2 = this.physics_model.getWorldPoint(Vec2(0.0, this.centerboard_position - this.centerboard_length/2)).x;
    c.y2 = this.physics_model.getWorldPoint(Vec2(0.0, this.centerboard_position - this.centerboard_length/2)).y;

    rudders.push(c)

    // rendering the mainsail

    
    let mainsail = []

    mainsail[0] = {};
    mainsail[0].x = this.physics_model.getWorldPoint(Vec2(0.0, this.mainsail_leading_edge_position)).x;
    mainsail[0].y = this.physics_model.getWorldPoint(Vec2(0.0, this.mainsail_leading_edge_position)).y;

    let awa = this.mainsail_boom_angle/this.mainsail_boom_angle_factor


    this.mainsail_boom_angle_actual+= (this.mainsail_boom_angle-this.mainsail_boom_angle_actual)/30;

    let mainsail_fat1 = (this.mainsail_boom_length*0.05*Math.abs(awa)/30 < this.mainsail_boom_length/10)?this.mainsail_boom_length*0.05*Math.abs(awa)/30 :this.mainsail_boom_length/10;
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

    let jib_fat1 = (this.jib_boom_length*0.05*Math.abs(awa)/15 < this.jib_boom_length/3)?this.jib_boom_length*0.05*Math.abs(awa)/15 :this.jib_boom_length/3;
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



let map = new Map(90, 5)

let players = []
let paths = []

players.push(new Boat(map, -2, 5))
//players.push(new Boat(map, 2, 5))

players.forEach(player => {
  player.physics_model_init(world);
});

// up 38 down 40 left 37 right 39

key_bind_list.push({type: "PRESSED", activation_key: 37, prohibition_key: 39, object: players[0], input_handler: players[0].input_rudder_left.name})   // Left
key_bind_list.push({type: "PRESSED", activation_key: 39, prohibition_key: 37, object: players[0], input_handler: players[0].input_rudder_right.name})  // Right

key_bind_list.push({type: "PRESSED", activation_key: 87, prohibition_key: 83, object: players[0], input_handler: players[0].input_motor_forward.name}) // W
key_bind_list.push({type: "PRESSED", activation_key: 83, prohibition_key: 87, object: players[0], input_handler: players[0].input_motor_reverse.name}) // S

key_bind_list.push({type: "PRESSED", activation_key: 40, prohibition_key: 38, object: players[0], input_handler: players[0].input_autopilot_heading_increase.name})
key_bind_list.push({type: "PRESSED", activation_key: 38, prohibition_key: 40, object: players[0], input_handler: players[0].input_autopilot_heading_decrease.name})

key_bind_list.push({type: "KEYDOWN", activation_key: 32, prohibition_key: -1, object: players[0], input_handler: players[0].input_autopilot_enabled_toggle.name})
key_bind_list.push({type: "KEYDOWN", activation_key: 13, prohibition_key: -1, object: players[0], input_handler: players[0].input_autopilot_tack_toggle.name})

//key_bind_list.push({activation_key: 65, prohibition_key: 68, object: players[1], input_handler: players[1].input_rudder_left.name})
//key_bind_list.push({activation_key: 68, prohibition_key: 65, object: players[1], input_handler: players[1].input_rudder_right.name})
//key_bind_list.push({activation_key: 87, prohibition_key: 83, object: players[1], input_handler: players[1].input_motor_forward.name})
//key_bind_list.push({activation_key: 83, prohibition_key: 87, object: players[1], input_handler: players[1].input_motor_reverse.name})


let physics_frame = 0;

runner.start(() => {

  // clear the array of displayed graphic elements
  forces = []; 
  rudders = [];
  guides = [];
  sails = [];
  path_markers = [];
  
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
  
    frame ++

    if (physics_frame%30 == 0){
      
      let power = player.power;
      if (power>256){power = 256} 

      paths.push(new Path(map, player.x, player.y, power))

      //console.log("Path",player.x, player.y)

    }
  
  });

  let paths_to_keep = []

  paths.forEach(path => {

    path.physics_model_step()
    path.graphics_model_render()

    if (path.age<250){
      paths_to_keep.push(path)
    }
  });

  paths = paths_to_keep;

  physics_frame++;

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
    varying vec3 vUv;
 

    void main() {

      float windangle = 60.0; 

      float angle = (windangle/180.0)*3.141592;
    
      float distance =  sqrt(vUv.x*vUv.x + vUv.y*vUv.y);
    
      float alpha = atan(vUv.y, vUv.x);
    
      float phase = cos((angle - alpha))*distance;
    
      float d = 0.25*sin((phase/1.0+time/1.0));


      gl_FragColor = vec4(0.5+d, 0.5+d, 0.5+d, 1);


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
    'time': {value: 1.0},
  }


	// let material = new THREE.MeshNormalMaterial();

  let material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    fragmentShader: fragmentShader(),
    vertexShader: vertexShader(),
  });

  // mesh = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), material);
	// scene.add( mesh );



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
    const material = new THREE.LineBasicMaterial( { color: color } );
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



  frame++;
  uniforms.time.value+=0.1;

  isFirstFrame = false;

	renderer.render( scene, camera );

}