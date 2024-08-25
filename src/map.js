import planck, { random } from 'planck-js/dist/planck-with-testbed';


import { World, Circle } from 'planck-js'
let pl = planck, Vec2 = pl.Vec2;


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
  


export class Map{
	constructor(width, height, direction, speed, boltzmann){
	
		this.bm = boltzmann
		this.world = undefined
	

		this.width = width
		this.height = height

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
	
	physics_model_init(){

		this.world =  new World(Vec2(0, 0));
	  
		let ground = this.world.createBody(Vec2(0.0, 0.0));
	  
		let wallFD = {
		  density: 0.0,
		  restitution: 0.4,
		};

	  
		// Left vertical
		ground.createFixture(pl.Edge(Vec2(-this.width/2+2, -this.height/2+2), Vec2(-this.width/2+2, this.height/2-2)), wallFD);
	  
		// Right vertical
		ground.createFixture(pl.Edge(Vec2(this.width/2-2, -this.height/2+2), Vec2(this.width/2-2, this.height/2-2)), wallFD);
	  
		// Top horizontal
		ground.createFixture(pl.Edge(Vec2(-this.width/2+2, this.height/2-2), Vec2(this.width/2-2, this.height/2-2)), wallFD);
	  
		// Bottom horizontal
		ground.createFixture(pl.Edge(Vec2(-this.width/2+2, -this.height/2+2), Vec2(this.width/2-2, -this.height/2+2)), wallFD);

		// init world entities
		this.world.createDynamicBody(Vec2(0.0, 14.5)).createFixture(Circle(0.5), 10.0);
		this.world.createDynamicBody(Vec2(0.0, 20.0)).createFixture(Circle(5.0), 10.0);
		

	}

	get_wind_speed(x, y){
	
	
		let v0 = this.bm.get_field_velocity(x,y)
		let v1 = this.bm.get_field_velocity(x-1,y)
		let v2 = this.bm.get_field_velocity(x+1,y)
		let v3 = this.bm.get_field_velocity(x,y-1)
		let v4 = this.bm.get_field_velocity(x,y+1)
	
		let tws = 0
		tws += Math.sqrt(v0.x*v0.x + v0.y*v0.y)
		tws += Math.sqrt(v1.x*v1.x + v1.y*v1.y)
		tws += Math.sqrt(v2.x*v2.x + v2.y*v2.y)
		tws += Math.sqrt(v3.x*v3.x + v3.y*v3.y)
		tws += Math.sqrt(v4.x*v4.x + v4.y*v4.y)
	
		return tws/5*100*4;
	}
	
	get_wind_direction(x, y){
	
	
		let v0 = this.bm.get_field_velocity(x,y)
		let v1 = this.bm.get_field_velocity(x-1,y)
		let v2 = this.bm.get_field_velocity(x+1,y)
		let v3 = this.bm.get_field_velocity(x,y-1)
		let v4 = this.bm.get_field_velocity(x,y+1)
	
		let angle_array = [Math.atan2(v0.y, v0.x)/Math.PI*180 + 180,
		Math.atan2(v1.y, v1.x)/Math.PI*180 + 180,
		Math.atan2(v2.y, v2.x)/Math.PI*180 + 180,
		Math.atan2(v3.y, v3.x)/Math.PI*180 + 180,
		Math.atan2(v4.y, v4.x)/Math.PI*180 + 180 
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
