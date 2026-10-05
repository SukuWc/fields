import planck, { random } from 'planck-js/dist/planck-with-testbed';
import { World, Circle } from 'planck-js'
import { meanAngleDeg } from './utils.js';
import { FluidWind, ConstantWind } from './wind.js';

let pl = planck, Vec2 = pl.Vec2;



export class Map{
	constructor(width, height, direction, speed, boltzmann, fluidWind, constantWind){
	
		this.bm = boltzmann
		// Active wind source. Boats only call get_wind(); setDevMode swaps this.
		// Callers that only pass the lattice (the headless checks) still sample
		// the fluid. main.js passes the two providers explicitly.
		this.fluidWind = fluidWind || new FluidWind(boltzmann)
		this.constantWind = constantWind || new ConstantWind(direction, speed)
		this.wind = this.fluidWind
		this.devMode = false
		this.world = undefined
	

		this.width = width
		this.height = height

		this.wind_direction = direction;  
		this.wind_speed = speed;
	
		this.show_forces = false;
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

	// Single wind seam. Returns { speed, direction, vx, vy } from the active provider.
	get_wind(x, y){
		return this.wind.getWind(x, y)
	}

	// Replace the active provider without changing dev mode. setDevMode resets
	// the provider to the built-in constant or fluid wind.
	setWindProvider(provider){
		this.wind = provider
	}

	// Dev mode: boats read ConstantWind, and the physics loop skips the fluid sim.
	setDevMode(enabled){
		this.devMode = !!enabled
		this.wind = this.devMode ? this.constantWind : this.fluidWind
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
