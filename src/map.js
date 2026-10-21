import planck from 'planck-js';
import { World, Circle } from 'planck-js'
import { meanAngleDeg } from './utils.js';
import { FluidWind, ConstantWind, ringWindSample } from './wind.js';

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
	
		// Camera and view flags live in the client's View (view.js).
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

		// init world entities. Two stray circles at fixed world positions
		// (near the map centre on every map size; scenarios are laid out round them).
		this.world.createDynamicBody(Vec2(0.0, 14.5)).createFixture(Circle(0.5), 10.0);
		this.world.createDynamicBody(Vec2(0.0, 20.0)).createFixture(Circle(5.0), 10.0);
		

	}

	// Single wind seam. Returns { speed, direction, vx, vy } from the active provider.
	get_wind(x, y){
		return this.wind.getWind(x, y)
	}

	// Boat true wind: mean vector of a 1 m, 20-point ring (wind.js ringWindSample).
	get_wind_ring(x, y, r, n){
		return ringWindSample((px, py) => this.wind.getWind(px, py), x, y, r, n)
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
}
