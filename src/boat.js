import planck, { random } from 'planck-js/dist/planck-with-testbed';


let pl = planck, Vec2 = pl.Vec2;




export class Boat{

  constructor(map, x, y, hull_angle){

    this.map = map;

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

    this.hull_mass = 6; // was 6
    this.hull_shape = pl.Polygon([Vec2(0, -2.25), Vec2(-0.5, -1.25), Vec2(-0.75, -0.25),  Vec2(-0.75, 0.5),  Vec2(-0.5, 1.75), Vec2(0.5, 1.75),  Vec2(0.75, 0.5), Vec2(0.75, -0.25), Vec2(0.5, -1.25), Vec2(0, -2.25)])
   

    
    this.rudder_input = 0;
    this.motor_input = 0;


    this.rudder_angle = 0;
    this.rudder_angle_last = 0;
    this.rudder_angle_max = 60;
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

    this.forces = []

    document.getElementById("info").innerHTML = "Autopilot" + this.autopilot_enabled + "<br>"
    document.getElementById("info").innerHTML += "Heading Target" + this.autopilot_heading_target + "<br>"
    // calculate boat dynamics


    this.x = this.physics_model.m_xf.p.x;
    this.y = this.physics_model.m_xf.p.y;
    
    this.wind_speed = this.map.get_wind_speed(this.x, this.y)
    this.wind_direction = this.map.get_wind_direction(this.x, this.y)

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
    this.physics_model.applyForce(centerboard_f, centerboard_p, true);   

    this.forces.push({name: "centerboard", type: "arrow", vector: centerboard_f, point: centerboard_p})

    document.getElementById("info").innerHTML += "q/d: "+ centerboard_AoA_degrees + "°<br>"; 
  



    // Calculate True wind and apparent wind
    let twa = (this.map.get_wind_direction(this.x, this.y) - angle/Math.PI*180 + 90 )

    let aw_vector = {}

    aw_vector.x = this.physics_model.m_linearVelocity.x + Math.cos(this.map.get_wind_direction(this.x, this.y) /180*Math.PI) * this.map.get_wind_speed(this.x, this.y);
    aw_vector.y = this.physics_model.m_linearVelocity.y + Math.sin(this.map.get_wind_direction(this.x, this.y) /180*Math.PI) * this.map.get_wind_speed(this.x, this.y);

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

      this.autopilot_compensator_p = 2 // 0.5
      this.autopilot_compensator_i = 0 // 0
      this.autopilot_compensator_d = 100 //  20

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
    this.forces.push({name: "rudder", type: "arrow", vector: rudder_f, point: rudder_p})

    document.getElementById("info").innerHTML += "TWA: "+Math.floor(twa) + "<br>";
    document.getElementById("info").innerHTML += "TWS: "+Math.floor(this.map.get_wind_speed(this.x, this.y)) + "<br>";
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
    
    
    this.physics_model.applyForce(sail_f_lift, mainsail_p, true); 
    this.physics_model.applyForce(sail_f_drag, mainsail_p, true); 

    this.forces.push({name: "mainsail", type: "arrow", vector: sail_f_lift, point: mainsail_p})
    this.forces.push({name: "mainsail", type: "arrow", vector: sail_f_drag, point: mainsail_p})

    this.power = Math.sqrt(mainsail_f.x*mainsail_f.x + mainsail_f.y*mainsail_f.y)
    this.power_direction = Math.atan2(mainsail_f.y, mainsail_f.x) / Math.PI * 180;

    
    document.getElementById("info").innerHTML += "Power: "+ Math.floor( this.power *10) /10 + "<br>"; 



    // Calculate DRAG
    var drag_f = {}
    drag_f.x = -(this.physics_model.m_linearVelocity.x)*bs
    drag_f.y = -(this.physics_model.m_linearVelocity.y)*bs


    var drag_p = this.physics_model.getWorldPoint(Vec2(0.0, 0));
    this.physics_model.applyForce(drag_f, drag_p, true);   
    this.forces.push({name: "drag", type: "arrow", vector: drag_f, point: drag_p})

    // clear inputs
    this.rudder_input = 0;
    this.motor_input = 0;

  }
  
  graphics_model_render(){

    let graphics = []

    this.forces.forEach(force => {
      
      graphics.push({ color: 0x00ff00, type: "force",
        x1: force.point.x,
        y1: force.point.y,
        x2: force.point.x + force.vector.x/10,
        y2: force.point.y + force.vector.y/10 
      })

    });


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
    a.type = "autopilot"

    graphics.push(a)

    // wind indicator

    
    let wind_angle = (this.wind_direction)/180*Math.PI

    graphics.push({ color: 0x554477, type: "guide",
      x1: this.x + Math.cos(wind_angle)*3,
      y1: this.y + Math.sin(wind_angle)*3,
      x2: this.x + Math.cos(wind_angle)*5 + Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 + Math.sin(wind_angle+Math.PI/2)*0.5
    })

    graphics.push({ color: 0x554477, type: "guide",
      x1: this.x + Math.cos(wind_angle)*3,
      y1: this.y + Math.sin(wind_angle)*3,
      x2: this.x + Math.cos(wind_angle)*5 - Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 - Math.sin(wind_angle+Math.PI/2)*0.5
    })

    graphics.push({ color: 0x554477, type: "guide",
      x1: this.x + Math.cos(wind_angle)*4.75,
      y1: this.y + Math.sin(wind_angle)*4.75,
      x2: this.x + Math.cos(wind_angle)*5 - Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 - Math.sin(wind_angle+Math.PI/2)*0.5
    })    
    
    graphics.push({ color: 0x554477, type: "guide",
      x1: this.x + Math.cos(wind_angle)*4.75,
      y1: this.y + Math.sin(wind_angle)*4.75,
      x2: this.x + Math.cos(wind_angle)*5 + Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 + Math.sin(wind_angle+Math.PI/2)*0.5
    })

    wind_angle = (this.awa)/180*Math.PI + this.hull_angle - Math.PI/2

    graphics.push({ color: 0x550077, type: "guide",
      x1: this.x + Math.cos(wind_angle)*3,
      y1: this.y + Math.sin(wind_angle)*3,
      x2: this.x + Math.cos(wind_angle)*5 + Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 + Math.sin(wind_angle+Math.PI/2)*0.5
    })

    graphics.push({ color: 0x550077, type: "guide",
      x1: this.x + Math.cos(wind_angle)*3,
      y1: this.y + Math.sin(wind_angle)*3,
      x2: this.x + Math.cos(wind_angle)*5 - Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 - Math.sin(wind_angle+Math.PI/2)*0.5
    })

    graphics.push({ color: 0x550077, type: "guide",
      x1: this.x + Math.cos(wind_angle)*4.75,
      y1: this.y + Math.sin(wind_angle)*4.75,
      x2: this.x + Math.cos(wind_angle)*5 - Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 - Math.sin(wind_angle+Math.PI/2)*0.5
    })    
    
    graphics.push({ color: 0x550077, type: "guide",
      x1: this.x + Math.cos(wind_angle)*4.75,
      y1: this.y + Math.sin(wind_angle)*4.75,
      x2: this.x + Math.cos(wind_angle)*5 + Math.cos(wind_angle+Math.PI/2)*0.5,
      y2: this.y + Math.sin(wind_angle)*5 + Math.sin(wind_angle+Math.PI/2)*0.5
    })

    // rendering the rudder

    graphics.push({ color: 0x550000, type: "hydro",
      x1: this.physics_model.getWorldPoint(Vec2(0.0, this.rudder_position)).x,
      y1: this.physics_model.getWorldPoint(Vec2(0.0, this.rudder_position)).y,
      x2: this.physics_model.getWorldPoint(Vec2(0.0, this.rudder_position)).x + Math.cos(this.physics_model.getAngle() + Math.PI/2 +this.rudder_angle/180*Math.PI)*this.rudder_lenght,
      y2: this.physics_model.getWorldPoint(Vec2(0.0, this.rudder_position)).y + Math.sin(this.physics_model.getAngle() + Math.PI/2 +this.rudder_angle/180*Math.PI)*this.rudder_lenght
    })

    // rendering the centerboard


    graphics.push({ color: 0x550000, type: "hydro",
      x1: this.physics_model.getWorldPoint(Vec2(0.0, this.centerboard_position + this.centerboard_length/2)).x,
      y1: this.physics_model.getWorldPoint(Vec2(0.0, this.centerboard_position + this.centerboard_length/2)).y,
      x2: this.physics_model.getWorldPoint(Vec2(0.0, this.centerboard_position - this.centerboard_length/2)).x,
      y2: this.physics_model.getWorldPoint(Vec2(0.0, this.centerboard_position - this.centerboard_length/2)).y
    })


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

    graphics.push({ color: 0x8866ff, type: "sail",
      x1: mainsail[0].x,
      y1: mainsail[0].y,
      x2: mainsail[1].x,
      y2: mainsail[1].y
    })

    graphics.push({ color: 0x8866ff, type: "sail",
      x1: mainsail[1].x,
      y1: mainsail[1].y,
      x2: mainsail[2].x,
      y2: mainsail[2].y
    })    
    
    graphics.push({ color: 0x8866ff, type: "sail",
      x1: mainsail[2].x,
      y1: mainsail[2].y,
      x2: mainsail[3].x,
      y2: mainsail[3].y
    })

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

    graphics.push({ color: 0x8866ff, type: "sail",
      x1: jib[0].x,
      y1: jib[0].y,
      x2: jib[1].x,
      y2: jib[1].y
    })

    graphics.push({ color: 0x8866ff, type: "sail",
      x1: jib[1].x,
      y1: jib[1].y,
      x2: jib[2].x,
      y2: jib[2].y
    })    
    
    graphics.push({ color: 0x8866ff, type: "sail",
      x1: jib[2].x,
      y1: jib[2].y,
      x2: jib[3].x,
      y2: jib[3].y
    })


    return graphics
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
