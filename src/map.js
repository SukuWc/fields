import planck, { random } from 'planck-js/dist/planck-with-testbed';
import { World, Circle } from 'planck-js'
import { meanAngleDeg } from './utils.js';

let pl = planck, Vec2 = pl.Vec2;



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

	get_wind(x, y){
		// Spatially average velocity vectors over a grid within WIND_SAMPLE_RADIUS world units.
		// Averaging vectors before deriving speed/direction avoids angle wraparound issues.
		const WIND_SAMPLE_RADIUS = 2; // world units
		const WIND_SAMPLE_STEP   = 1; // world units between samples

		let vx = 0, vy = 0, n = 0;
		for (let dx = -WIND_SAMPLE_RADIUS; dx <= WIND_SAMPLE_RADIUS; dx += WIND_SAMPLE_STEP) {
			for (let dy = -WIND_SAMPLE_RADIUS; dy <= WIND_SAMPLE_RADIUS; dy += WIND_SAMPLE_STEP) {
				const v = this.bm.get_field_velocity(x + dx, y + dy);
				vx += v.x; vy += v.y; n++;
			}
		}
		vx /= n; vy /= n;

		const speed     = Math.sqrt(vx*vx + vy*vy) * 100 * 4;
		const direction = Math.atan2(vy, vx) / Math.PI * 180 + 180;

		return { speed, direction, vx, vy };
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
