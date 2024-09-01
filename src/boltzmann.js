
var plotSelect = document.getElementById('plotSelect');
var contrastSlider = document.getElementById('contrastSlider');


var rafCheck = document.getElementById('rafCheck');

const four9ths = 4.0 / 9.0;					// abbreviations
const one9th = 1.0 / 9.0;
const one36th = 1.0 / 36.0;



// Set up the array of colors for plotting (mimicks matplotlib "jet" colormap):
// (Kludge: Index nColors+1 labels the color used for drawing barriers.)
var nColors = 400;							// there are actually nColors+2 colors
var hexColorList = new Array(nColors+2);
var redList = new Array(nColors+2);
var greenList = new Array(nColors+2);
var blueList = new Array(nColors+2);
for (var c=0; c<=nColors; c++) {
	var r, g, b;
	if (c < nColors/8) {
		r = 0; g = 0; b = Math.round(255 * (c + nColors/8) / (nColors/4));
	} else if (c < 3*nColors/8) {
		r = 0; g = Math.round(255 * (c - nColors/8) / (nColors/4)); b = 255;
	} else if (c < 5*nColors/8) {
		r = Math.round(255 * (c - 3*nColors/8) / (nColors/4)); g = 255; b = 255 - r;
	} else if (c < 7*nColors/8) {
		r = 255; g = Math.round(255 * (7*nColors/8 - c) / (nColors/4)); b = 0;
	} else {
		r = Math.round(255 * (9*nColors/8 - c) / (nColors/4)); g = 0; b = 0;
	}
	redList[c] = r; greenList[c] = g; blueList[c] = b;
	hexColorList[c] = rgbToHex(r, g, b);
}
redList[nColors+1] = 0; greenList[nColors+1] = 0; blueList[nColors+1] = 0;	// barriers are black
hexColorList[nColors+1] = rgbToHex(0, 0, 0);

function get_color(cIndex){

	if (cIndex < 0) cIndex = 0;
	if (cIndex > nColors) cIndex = nColors;

	return {red: redList[cIndex], green: greenList[cIndex], blue: blueList[cIndex]};
}

// Functions to convert rgb to hex color string (from stackoverflow):
function componentToHex(c) {
	var hex = c.toString(16);
	return hex.length == 1 ? "0" + hex : hex;
}
function rgbToHex(r, g, b) {
	return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}



class SimulationCell{

	constructor(parent, x, y, sub_mesh_depth, is_temporary){

		this.is_temporary = is_temporary;
		this.x = x;
		this.y = y;
		this.parent = parent;

		this.sub_mesh_depth = sub_mesh_depth; // 0 = boltzmann_root, 1 = simuation_cell, 2 = submesh_container

		this._n0_  = 0; 
		
		// microscopic densities along each lattice direction
		this._nN_  = 0;
		this._nS_  = 0;
		this._nE_  = 0;
		this._nW_  = 0;
		this._nNE_ = 0;
		this._nSE_ = 0;
		this._nNW_ = 0;
		this._nSW_ = 0;

		this._received_nN_  = 0;
		this._received_nS_  = 0;
		this._received_nE_  = 0;
		this._received_nW_  = 0;
		this._received_nNE_ = 0;
		this._received_nSE_ = 0;
		this._received_nNW_ = 0;
		this._received_nSW_ = 0;

		this._ux_  = 0; // macroscopic x velocity
		this._uy_  = 0; // macroscopic y velocity
		this._rho_ = 0; // macroscopic density
		this._curl_ = 0;

		this.barrier = false;
	
		this.child_00 = null;
		this.child_01 = null;
		this.child_10 = null;
		this.child_11 = null;
	}

	setCurl(curl) {
		this._curl_ = curl;
	}

	convert_to_finer_mesh(is_temporary) {
		// prediction

		let x = this.x;
		let y = this.y;

		let root = this.parent;

		while (root.sub_mesh_depth > 0) {
			root = root.parent;
		}

		if (this.child_00 === null){

			let mesh_offset = Math.pow(1/2, this.sub_mesh_depth*2);

			this.child_00 = new SimulationCell(this, x-mesh_offset, y-mesh_offset, this.sub_mesh_depth+1, is_temporary);
			this.child_01 = new SimulationCell(this, x-mesh_offset, y+mesh_offset, this.sub_mesh_depth+1, is_temporary);
			this.child_10 = new SimulationCell(this, x+mesh_offset, y-mesh_offset, this.sub_mesh_depth+1, is_temporary);
			this.child_11 = new SimulationCell(this, x+mesh_offset, y+mesh_offset, this.sub_mesh_depth+1, is_temporary);
	

		}

		const prediciton_wights= [
			[-1/64, 1/8, 1/64],
			[1/8,   1,   -1/8],
			[1/64, -1/8, -1/64]
		  ];


		let ux00 = 0;
		let uy00 = 0;
		let rho00 = 0;

		let ux01 = 0;
		let uy01 = 0;
		let rho01 = 0;

		let ux10 = 0;
		let uy10 = 0;
		let rho10 = 0;

		let ux11 = 0;
		let uy11 = 0;
		let rho11 = 0;

		if (x !== Math.round(x)){
			// find cell is not implemented for submesh
			return;
		}


		for (let i = 0; i < 3; i++) {
			for (let j = 0; j < 3; j++) {

				ux00 += prediciton_wights[i][j] * root.find_cell(x-1+i, y-1+j)._ux_;
				uy00 += prediciton_wights[i][j] * root.find_cell(x-1+i, y-1+j)._uy_;
				rho00 += prediciton_wights[i][j] * root.find_cell(x-1+i, y-1+j)._rho_;

				// rot 90
				ux01 += prediciton_wights[2-j][i] * root.find_cell(x-1+i, y-1+j)._ux_;
				uy01 += prediciton_wights[2-j][i] * root.find_cell(x-1+i, y-1+j)._uy_;
				rho01 += prediciton_wights[2-j][i] * root.find_cell(x-1+i, y-1+j)._rho_;

				// rot 180 
				ux11 += prediciton_wights[2-i][2-j] * root.find_cell(x-1+i, y-1+j)._ux_;
				uy11 += prediciton_wights[2-i][2-j] * root.find_cell(x-1+i, y-1+j)._uy_;
				rho11 += prediciton_wights[2-i][2-j] * root.find_cell(x-1+i, y-1+j)._rho_;

				// rot 270
				ux10 += prediciton_wights[j][2-i] * root.find_cell(x-1+i, y-1+j)._ux_;
				uy10 += prediciton_wights[j][2-i] * root.find_cell(x-1+i, y-1+j)._uy_;
				rho10 += prediciton_wights[j][2-i] * root.find_cell(x-1+i, y-1+j)._rho_;

			}
			
		}
		this.child_00.setEquil(ux00, uy00, rho00);
		this.child_01.setEquil(ux01, uy01, rho01);
		this.child_10.setEquil(ux10, uy10, rho10);
		this.child_11.setEquil(ux11, uy11, rho11);


	}

	setEquil(newux, newuy, newrho) {

		if (typeof newrho == 'undefined') {
			newrho = this._rho_;
		}
		var ux3 = 3 * newux;
		var uy3 = 3 * newuy;
		var ux2 = newux * newux;
		var uy2 = newuy * newuy;
		var uxuy2 = 2 * newux * newuy;
		var u2 = ux2 + uy2;
		var u215 = 1.5 * u2;
		this._n0_  = four9ths * newrho * (1                              - u215);
		this._nE_  =   one9th * newrho * (1 + ux3       + 4.5*ux2        - u215);
		this._nW_  =   one9th * newrho * (1 - ux3       + 4.5*ux2        - u215);
		this._nN_  =   one9th * newrho * (1 + uy3       + 4.5*uy2        - u215);
		this._nS_  =   one9th * newrho * (1 - uy3       + 4.5*uy2        - u215);
		this._nNE_ =  one36th * newrho * (1 + ux3 + uy3 + 4.5*(u2+uxuy2) - u215);
		this._nSE_ =  one36th * newrho * (1 + ux3 - uy3 + 4.5*(u2-uxuy2) - u215);
		this._nNW_ =  one36th * newrho * (1 - ux3 + uy3 + 4.5*(u2-uxuy2) - u215);
		this._nSW_ =  one36th * newrho * (1 - ux3 - uy3 + 4.5*(u2+uxuy2) - u215);
		this._rho_ = newrho;
		this._ux_ = newux;
		this._uy_ = newuy;
	}

	calculate_curl(){
		
		let root = this.parent;

		while (root.sub_mesh_depth > 0) {
			root = root.parent;
		}


		let x = this.x;
		let y = this.y;

		const next_cell_distance = Math.pow(1/2, this.sub_mesh_depth-1);

		let cell_left = root.find_cell(x-next_cell_distance,y);
		let cell_right = root.find_cell(x+next_cell_distance,y);
		let cell_up = root.find_cell(x,y+next_cell_distance);
		let cell_down = root.find_cell(x,y-next_cell_distance);

		if (cell_left === null || cell_right === null || cell_up === null || cell_down === null) {

			this._curl_ = 0;
			return;
		}

		this._curl_ = cell_right._uy_ - cell_left._uy_ - cell_up._ux_ + cell_down._ux_;	

		[cell_left, cell_right, cell_up, cell_down].forEach((cell) => {
			if (cell.is_temporary === true){
				cell.parent.child_00 = null;
				cell.parent.child_01 = null;
				cell.parent.child_10 = null;
				cell.parent.child_11 = null;
			}
		})


		if (this.child_00 !== null) {

			this.child_00.calculate_curl();
			this.child_01.calculate_curl();
			this.child_10.calculate_curl();
			this.child_11.calculate_curl();
		}

	}

	collide(omega){

		let thisrho = this._n0_ + this._nN_ + this._nS_ + this._nE_ + this._nW_ + this._nNW_ + this._nNE_ + this._nSW_ + this._nSE_;
		this._rho_ = thisrho;
		let thisux = (this._nE_ + this._nNE_ + this._nSE_ - this._nW_ - this._nNW_ - this._nSW_) / thisrho;
		this._ux_ = thisux;
		let thisuy = (this._nN_ + this._nNE_ + this._nNW_ - this._nS_ - this._nSE_ - this._nSW_) / thisrho;
		this._uy_ = thisuy
		let one9thrho = one9th * thisrho;		// pre-compute a bunch of stuff for optimization
		let one36thrho = one36th * thisrho;
		let ux3 = 3 * thisux;
		let uy3 = 3 * thisuy;
		let ux2 = thisux * thisux;
		let uy2 = thisuy * thisuy;
		let uxuy2 = 2 * thisux * thisuy;
		let u2 = ux2 + uy2;
		let u215 = 1.5 * u2;
		this._n0_  += omega * (four9ths*thisrho * (1                        - u215) - this._n0_);
		this._nE_  += omega * (   one9thrho * (1 + ux3       + 4.5*ux2        - u215) - this._nE_);
		this._nW_  += omega * (   one9thrho * (1 - ux3       + 4.5*ux2        - u215) - this._nW_);
		this._nN_  += omega * (   one9thrho * (1 + uy3       + 4.5*uy2        - u215) - this._nN_);
		this._nS_  += omega * (   one9thrho * (1 - uy3       + 4.5*uy2        - u215) - this._nS_);
		this._nNE_ += omega * (  one36thrho * (1 + ux3 + uy3 + 4.5*(u2+uxuy2) - u215) - this._nNE_);
		this._nSE_ += omega * (  one36thrho * (1 + ux3 - uy3 + 4.5*(u2-uxuy2) - u215) - this._nSE_);
		this._nNW_ += omega * (  one36thrho * (1 - ux3 + uy3 + 4.5*(u2-uxuy2) - u215) - this._nNW_);
		this._nSW_ += omega * (  one36thrho * (1 - ux3 - uy3 + 4.5*(u2+uxuy2) - u215) - this._nSW_);

	}


	stream(){

		let root = this.parent;
		let x = this.x;
		let y = this.y;

		

		this._received_nN_ = root.find_cell(x,y-1)._nN_;			// move the north-moving particles
		this._received_nNW_ = root.find_cell(x+1,y-1)._nNW_;		// and the northwest-moving particles

		this._received_nE_ = root.find_cell(x-1,y)._nE_;			// move the east-moving particles
		this._received_nNE_ = root.find_cell(x-1,y-1)._nNE_;		// and the northeast-moving particles

		this._received_nS_ = root.find_cell(x,y+1)._nS_;			// move the south-moving particles
		this._received_nSE_ = root.find_cell(x-1,y+1)._nSE_;		// and the southeast-moving particles
		
		this._received_nW_ = root.find_cell(x+1,y)._nW_;			// move the west-moving particles
		this._received_nSW_ = root.find_cell(x+1,y+1)._nSW_;		// and the southwest-moving particles
	}

	bounce(){
		
		let root = this.parent;
		let x = this.x;
		let y = this.y;


		if (this.barrier) {
			root.find_cell(x+1,y)._received_nE_ = this._received_nW_;
			root.find_cell(x-1,y)._received_nW_ = this._received_nE_;
			root.find_cell(x,y+1)._received_nN_ = this._received_nS_;
			root.find_cell(x,y-1)._received_nS_ = this._received_nN_;
			root.find_cell(x+1,y+1)._received_nNE_ = this._received_nSW_;
			root.find_cell(x-1,y+1)._received_nNW_ = this._received_nSE_;
			root.find_cell(x+1,y-1)._received_nSE_ = this._received_nNW_;
			root.find_cell(x-1,y-1)._received_nSW_ = this._received_nNE_;

		}
	}

	consolidate(){

		this._nN_  = this._received_nN_  ;
		this._nS_  = this._received_nS_  ;
		this._nE_  = this._received_nE_  ;
		this._nW_  = this._received_nW_  ;
		this._nNE_ = this._received_nNE_ ;
		this._nSE_ = this._received_nSE_ ;
		this._nNW_ = this._received_nNW_ ;
		this._nSW_ = this._received_nSW_ ;

		this._received_nN_  = 0;
		this._received_nS_  = 0;
		this._received_nE_  = 0;
		this._received_nW_  = 0;
		this._received_nNE_ = 0;
		this._received_nSE_ = 0;
		this._received_nNW_ = 0;
		this._received_nSW_ = 0;


	}

	calculate_color(root, plot_type, contrast){

		let color;

		if (this.barrier) {
			color = {red: 0, green: 0, blue: 0};	// kludge for barrier color which isn't really part of color map
		} else {
			if (plot_type == -1) {
				color = {red: 255/this.sub_mesh_depth, green: 255/this.sub_mesh_depth, blue: 255/this.sub_mesh_depth};
				if (this.x>this.parent.x){
					if (this.y>this.parent.y){
						
						color.red = 0;
					}
					else{
						color.green = 0;
					}
				}
				else{
					color.blue = 0;
				}
			}



			else if (plot_type == 0) {
				color = get_color( Math.round(nColors * ((this._rho_-1)*6*contrast + 0.5)));
			} else if (plot_type == 1) {
				color = get_color( Math.round(nColors * (this._ux_*2*contrast + 0.5)));
			} else if (plot_type == 2) {
				color = get_color(Math.round(nColors * (this._uy_*2*contrast + 0.5)));
			} else if (plot_type == 3) {
				var speed = Math.sqrt(this._ux_*this._ux_ + this._uy_*this._uy_);
				color = get_color(Math.round(nColors * (speed*4*contrast)));
			} else {
				color = get_color(Math.round(nColors * (this._curl_*this.sub_mesh_depth*5*contrast + 0.5)));
			}
			
		}

		root.colorSquare(this.x, this.y, Math.pow(0.5,this.sub_mesh_depth-1), color.red, color.green, color.blue);

		if (this.child_00 !== null){


			root.colorSquare(this.x, this.y, Math.pow(0.5,this.sub_mesh_depth-1), 0,0,0);

			this.child_00.calculate_color(root, plot_type, contrast);
			this.child_01.calculate_color(root, plot_type, contrast);
			this.child_10.calculate_color(root, plot_type, contrast);
			this.child_11.calculate_color(root, plot_type, contrast);
		}


	}
}



export class Boltzmann{

	constructor(width, height, resolution, direction, speed, texture, oversampling){

		this.oversampling = oversampling;

		this.texture = texture;
		this.resolution = resolution;

		this.width = width*this.resolution;
		this.height = height*this.resolution;
		this.direction = direction + 180;

		this.step_ready = false;
		this.t_delta = 0;

		// grid dimensions for simulation
		// width of plotted grid site in pixels

		this.speed = speed/100; // default speed 0.12


		//  kinematic viscosity coefficient in natural units
		this.viscosity = 0.020;



		this.cells = new Array(this.width*this.height);
		for (var y=0; y<this.height; y++) {
			for (var x=0; x<this.width; x++) {
				this.cells[x+y*this.width] = new SimulationCell(this, x, y, 1);
			}
		}


		// Initialize with no barriers:
		for (var y=0; y<this.height; y++) {
			for (var x=0; x<this.width; x++) {

				this.find_cell(x,y).barrier = false;

				// create circular wall
				let r = 5;

				if(Math.pow(this.width/2 - x, 2) + Math.pow(this.height*0.75 - y, 2) < Math.pow(r, 2) ){
					
					this.find_cell(x,y).barrier = true;
				}


			}
		}
		







		this.running = false;						// will be true when running

		this.initFluid();		// initialize to steady rightward flow
		this.startStop();

		this.graphics_model_init()
	}

	calculate_index(x,y){
		return x + y*this.width;
	}

	find_cell(x, y){

		let x_i = Math.round(x);
		let y_i = Math.round(y);

		let x_r = (x-x_i)*1;
		let y_r = (y-y_i)*1;

		let base_cell = this.cells[x_i + y_i*this.width];


		if (x != Math.round(x)){

			if (base_cell.child_00 == null){
				//return base_cell;
				base_cell.convert_to_finer_mesh(true);
			}

			if (x_r < 0 && y_r < 0){
				return base_cell.child_00;
			}
			else if (x_r > 0 && y_r < 0){
				return base_cell.child_10;
			}
			else if (x_r < 0 && y_r > 0){
				return base_cell.child_01;
			}
			else if (x_r > 0 && y_r > 0){
				return base_cell.child_11;
			}
			
		}

		return base_cell;
	}

	// Function to initialize or re-initialize the fluid, based on speed slider setting:
	initFluid() {

		let hspeed = Math.cos(this.direction/180*Math.PI)*this.speed
		let vspeed = Math.sin(this.direction/180*Math.PI)*this.speed

		console.log(hspeed, vspeed)

		// Amazingly, if I nest the y loop inside the x loop, Firefox slows down by a factor of 20
		for (var y=0; y<this.height; y++) {
			for (var x=0; x<this.width; x++) {

				this.find_cell(x,y).setEquil(hspeed, vspeed, 1);
				this.find_cell(x,y).setCurl(0.0);}
		}

	}

	// Function to start or pause the simulation:
	startStop() {
		this.running = !this.running;
		if (this.running) {
			this.physics_model_step();
		}
	}


	// Simulate function executes a bunch of steps and then schedules another call to itself:
	physics_model_step() {

		let t_start = new Date()

		for(let i=0; i<1; i++){


			this.setBoundaries();
			this.collide();
			this.stream();
			this.bounce();
			this.consolidate();

						// Initialize finer mesh at area of interest:
			for (var y=30; y<52; y++) {
				for (var x=30; x<52; x++) {

					this.find_cell(x,y).convert_to_finer_mesh();
				}
			}

			//this.find_cell(10,10).child_00.convert_to_finer_mesh();

			this.computeCurl();


	

		}

		this.t_delta = new Date() - t_start;

		this.step_ready = true;

		// var stable = true;
		// for (var x=0; x<this.width; x++) {
		// 	var index = x + (this.height/2)*this.width;	// look at middle row only
		// 	if (this._rho_[index] <= 0) stable = false;
		// }
		// if (!stable) {
		// 	window.alert("The simulation has become unstable due to excessive fluid speeds.");
		// 	this.startStop();
		// 	this.initFluid();
		// }


		this.graphics_model_init();

	}

	graphics_model_init(){

		this.graphics_model_step()
	}

	graphics_model_step(){

		this.paintTexture();

		if (this.running) {
			if (rafCheck.checked) {
				requestAnimFrame(this.graphics_model_step_handler.bind(this));	// let browser schedule next frame
			} else {
				window.setTimeout(this.graphics_model_step_handler.bind(this), 10);	// schedule next frame asap (nominally 1 ms but always more)
			}
		}

	}

	graphics_model_step_handler(){

		this.graphics_model_step()

	}

	// Set the fluid variables at the boundaries, according to the current slider value:
	setBoundaries() {

		let hspeed = Math.cos(this.direction/180*Math.PI)*this.speed
		let vspeed = Math.sin(this.direction/180*Math.PI)*this.speed

		for (var x=0; x<this.width; x++) {

			this.find_cell(x,0).setEquil(hspeed, vspeed, 1);
			this.find_cell(x,this.height-1).setEquil(hspeed, vspeed, 1);
		}
		for (var y=1; y<this.height-1; y++) {

			this.find_cell(0,y).setEquil(hspeed, vspeed, 1);
			this.find_cell(this.width-1,y).setEquil(hspeed, vspeed, 1);
		}
	}

	// Collide particles within each cell (here's the physics!):
	collide() {
		
		var omega = 1 / (3*this.viscosity + 0.5);		// reciprocal of relaxation time
		
		for (var y=1; y<this.height-1; y++) {
			for (var x=1; x<this.width-1; x++) {

				this.find_cell(x,y).collide(omega);
			}
		}

		// for (var y=1; y<this.height-2; y++) {

		// 	let index_from = this.width-2+y*this.width;
		// 	let index_to = this.width-1+y*this.width;

		// 	this._nW_[index_to] = this._nW_[index_from];		// at right end, copy left-flowing densities from next row to the left
		// 	this._nNW_[index_to] = this._nNW_[index_from];
		// 	this._nSW_[index_to] = this._nSW_[index_from];
		// }
	}

	// Move particles along their directions of motion:
	stream() {


		// stream the particles across the grid
		for (var y=1; y<this.height-1; y++) {
			for (var x=1; x<this.width-1; x++) {

				this.find_cell(x,y).stream();
			}
		}

	}

	bounce(){

		// bounce particles off barriers
		for (var y=1; y<this.height-1; y++) {
			for (var x=1; x<this.width-1; x++) {

				this.find_cell(x,y).bounce();
			}
		}

	}
	consolidate() {

		for (var y=0; y<this.height; y++) {
			for (var x=0; x<this.width; x++) {

				this.find_cell(x,y).consolidate();
			}
		}


	}
	// Set all densities in a cell to their equilibrium values for a given velocity and density:
	// (If density is omitted, it's left unchanged.)
	setEquil(index, newux, newuy, newrho) {

		if (typeof newrho == 'undefined') {
			newrho = this._rho_[index];
		}
		var ux3 = 3 * newux;
		var uy3 = 3 * newuy;
		var ux2 = newux * newux;
		var uy2 = newuy * newuy;
		var uxuy2 = 2 * newux * newuy;
		var u2 = ux2 + uy2;
		var u215 = 1.5 * u2;
		this._n0_[index]  = four9ths * newrho * (1                              - u215);
		this._nE_[index]  =   one9th * newrho * (1 + ux3       + 4.5*ux2        - u215);
		this._nW_[index]  =   one9th * newrho * (1 - ux3       + 4.5*ux2        - u215);
		this._nN_[index]  =   one9th * newrho * (1 + uy3       + 4.5*uy2        - u215);
		this._nS_[index]  =   one9th * newrho * (1 - uy3       + 4.5*uy2        - u215);
		this._nNE_[index] =  one36th * newrho * (1 + ux3 + uy3 + 4.5*(u2+uxuy2) - u215);
		this._nSE_[index] =  one36th * newrho * (1 + ux3 - uy3 + 4.5*(u2-uxuy2) - u215);
		this._nNW_[index] =  one36th * newrho * (1 - ux3 + uy3 + 4.5*(u2-uxuy2) - u215);
		this._nSW_[index] =  one36th * newrho * (1 - ux3 - uy3 + 4.5*(u2+uxuy2) - u215);
		this._rho_[index] = newrho;
		this._ux_[index] = newux;
		this._uy_[index] = newuy;
	}


	apply_energy(pushX, pushY, direction, strength){

		document.getElementById("wind_info").innerHTML = "dir: " + direction + "stre : " + strength + "<br>"

		//console.log("Apply")
		// translate the position to field coordinates

		let x = this.width/2 + Math.floor(pushX*this.resolution)
		let y = this.height/2 + Math.floor(pushY*this.resolution)

		// distribute the applied energy into the nearest 4 field elements.

		let x0, x1, x2, x3
		let y0, y1, y2, y3
		let s0, s1, s2, s3
		
		x0 = Math.floor(x)
		y0 = Math.floor(y)

		x1 = x0 + 1
		y1 = y0

		x2 = x0
		y2 = y0 + 1

		x3 = x0 + 1
		y3 = y0 + 1

		let hf = x-x0
		let vf = y-y0

		s0 = (1-hf)*(1-vf)
		s1 = (hf)*(1-vf)
		s2 = (1-hf)*(vf)
		s3 = (hf)*(vf)

		let x_array = [x0, x1, x2, x3]
		let y_array = [y0, y1, y2, y3]
		let s_array = [s0, s1, s2, s3]


		for (let i=0; i<1; i++){

			this.apply_force_to_cell(x_array[i], y_array[i], direction, s_array[i]*strength)


		}

	}

	apply_force_to_cell(x, y, direction, s) {

	
		// F = m * a
		// a = F/m
		// dv/dt = F/m0

		let vx = this.find_cell(x, y)._ux_;
		let vy = this.find_cell(x, y)._uy_;
		let m = this.find_cell(x, y)._rho_;

		let dvx = Math.cos(direction/180*Math.PI) * s / m * -1;
		let dvy = Math.sin(direction/180*Math.PI) * s / m * -1;
		
		this.find_cell(x, y).setEquil(vx + dvx, vy + dvy)

	}

	apply_energy_to_cell(x, y, direction, s) {


		let mirror_angle = direction + 270 // 0...359.999
		
		if (mirror_angle>360){
			mirror_angle-=360
		}
		
		document.getElementById("wind_info").innerHTML = "mirror_angle: " + mirror_angle + "<br>"
  


		const directions = [this._nE_, this._nNE_, this._nN_, this._nNW_, this._nW_, this._nSW_, this._nS_, this._nSE_]

		
		document.getElementById("wind_info").innerHTML += JSON.stringify(direction) + "<br>"
		
		let component_x = [0, 0, 0, 0, 0, 0, 0, 0]
		let component_y = [0, 0, 0, 0, 0, 0, 0, 0]
		let mirrored_angle = [0, 0, 0, 0, 0, 0, 0, 0]
		let source_angle = [0, 0, 0, 0, 0, 0, 0, 0]

		for (let i=0; i<8; i++){

			const nu = 0.1*s //transfer efficiency

			const index = (Math.floor(mirror_angle/45)+1+i)%8

			source_angle[i] = index*45
			mirrored_angle[i] = mirror_angle - (source_angle[i]-mirror_angle)

			if (mirrored_angle[i]>360){
				mirrored_angle[i]-=360;
			}

			if (mirrored_angle[i]<0){
				mirrored_angle[i]+=360;
			}

			// calculate energy taken from the array
			component_x[i] = Math.cos(mirrored_angle[i] /180*Math.PI) * directions[index][x + y*this.width] * nu
			component_y[i] = Math.sin(mirrored_angle[i] /180*Math.PI) * directions[index][x + y*this.width] * nu

		
			// take the energy from the array
			directions[index][x + y*this.width] *= (1-nu)
		}

		

		for (let i=0; i<8; i++){

			const index = (Math.floor(mirrored_angle[i]/45)+1+i)%8
			let u, v;

			if (index%2 == 0){

				if (Math.abs(component_x[i])>Math.abs(component_y[i])){
					u = component_x[i]-component_y[i]
					v = component_y[i]*Math.SQRT2
				}
				else{
					u = component_y[i]-component_x[i]
					v = component_x[i]*Math.SQRT2
				}

			}
			else{

				if (Math.abs(component_x[i])>Math.abs(component_y[i])){
					u = component_y[i]*Math.SQRT2
					v = component_x[i]-component_y[i]
				}
				else{
					u = component_x[i]*Math.SQRT2
					v = component_y[i]-component_x[i]
				}

			}


			directions[index][x + y*this.width] += u
			directions[(index+1)%8][x + y*this.width] += v

			let u2 = u*10000
			let v2 = v*10000


			document.getElementById("wind_info").innerHTML += "sou: " + source_angle[i] +  " mirr: "+Math.floor(mirrored_angle[i])+ "<br>"
			document.getElementById("wind_info").innerHTML += "u: " + Math.floor(u2) +  " v: "+ Math.floor(v2) + "<br>"

		}



	}
	get_field_velocity(x, y){



		x = this.width/2 + Math.floor(x*this.resolution)
		y = this.height/2 + Math.floor(y*this.resolution)


		// distribute the applied energy into the nearest 4 field elements.

		let x0, x1, x2, x3
		let y0, y1, y2, y3
		let s0, s1, s2, s3
		
		x0 = Math.floor(x)
		y0 = Math.floor(y)

		x1 = x0 + 1
		y1 = y0

		x2 = x0
		y2 = y0 + 1

		x3 = x0 + 1
		y3 = y0 + 1


		let hf = x-x0
		let vf = y-y0

		//console.log(hf, vf)

		s0 = (1-hf)*(1-vf)
		s1 = (hf)*(1-vf)
		s2 = (1-hf)*(vf)
		s3 = (hf)*(vf)

		let vx = 0;
		let vy = 0;

		let cell_0 = this.find_cell(x0, y0)
		let cell_1 = this.find_cell(x1, y1)
		let cell_2 = this.find_cell(x2, y2)
		let cell_3 = this.find_cell(x3, y3)

		vx = cell_0._ux_*s0 + cell_1._ux_*s1 +  cell_2._ux_*s2 +  cell_3._ux_*s3
		vy = cell_0._uy_*s0 + cell_1._uy_*s1 +  cell_2._uy_*s2 +  cell_3._uy_*s3

		return {x: vx/4, y: vy/4}
	}


	paintTexture() {
		var cIndex=0;


		var contrast = Math.pow(1.2,Number(contrastSlider.value));
		var plotType = plotSelect.selectedIndex;


		for (var y=0; y<this.height; y++) {
			for (var x=0; x<this.width; x++) {

				let cell = this.find_cell(x,y);

				cell.calculate_color(this, plotType, contrast);

				//this.colorSquare(x, y, Math.pow(0.5,this.find_cell(x,y).sub_mesh_depth-1), redList[cIndex], greenList[cIndex], blueList[cIndex]);

				// let last_cell = this.find_cell(x,y)

				// for (let i = 0; i < this.oversampling; i++) {
				// 	if (last_cell.child_00 !== null) {
				// 		this.colorSquare(last_cell.child_00.x, last_cell.child_00.y, 0.5, 255, 0, 0);
				// 		this.colorSquare(last_cell.child_01.x, last_cell.child_01.y, 0.5, 0,255,0);
				// 		this.colorSquare(last_cell.child_10.x, last_cell.child_10.y, 0.5, 0, 0, 255);
				// 		this.colorSquare(last_cell.child_11.x, last_cell.child_11.y, 0.5, 0, 0, 0);

				// 		if (last_cell.child_00.child_00 !== null) {
				// 			this.colorSquare(last_cell.child_00.child_00.x, last_cell.child_00.child_00.y, 0.25, 255, 0, 0);
				// 			this.colorSquare(last_cell.child_00.child_01.x, last_cell.child_00.child_01.y, 0.25, 0,255,0);
				// 			this.colorSquare(last_cell.child_00.child_10.x, last_cell.child_00.child_10.y, 0.25, 0, 0, 255);
				// 			this.colorSquare(last_cell.child_00.child_11.x, last_cell.child_00.child_11.y, 0.25, 0, 0, 0);
				// 		}
				// 	}else{
				// 		break;
				// 	}
				// }

			}
		}
	}

	// Color a grid square in the image data array, one pixel at a time (rgb each in range 0 to 255):
	colorSquare(x, y, size, r, g, b) {

		if (this.texture === undefined){
			return
		}

		let pixels_to_fill = this.oversampling*size

		for(var i=0; i<pixels_to_fill; i++) {
			for(var j=0; j<pixels_to_fill; j++) {
				

				let _x_remainder = (x*this.oversampling-Math.round(x*this.oversampling))/2
				let _y_remainder = (y*this.oversampling-Math.round(y*this.oversampling))/2

				let _x = Math.round(x*this.oversampling)+i + Math.ceil(_x_remainder*this.oversampling) + (size<1?1:0)
				let _y = Math.round(y*this.oversampling)+j + Math.ceil(_y_remainder*this.oversampling) + (size<1	?1:0)

				var ind = (_x + (_y)*this.width*this.oversampling) * 4;
				//var ind = (x + y*this.width) * 4;
				this.texture.image.data[ind+0] = r;
				this.texture.image.data[ind+1] = g;
				this.texture.image.data[ind+2] = b;
				this.texture.image.data[ind+3] = 255;
		
			}
		}
			

	}
	




	// Compute the curl (actually times 2) of the macroscopic velocity field, for plotting:
	computeCurl() {
		for (var y=1; y<this.height-1; y++) {			// interior sites only; leave edges set to zero
			for (var x=1; x<this.width-1; x++) {

				this.find_cell(x,y).calculate_curl();
			
			}
		}
	}



}

// Mysterious gymnastics that are apparently useful for better cross-browser animation timing:
window.requestAnimFrame = (function(callback) {
	return 	window.requestAnimationFrame || 
		window.webkitRequestAnimationFrame || 
		window.mozRequestAnimationFrame || 
		window.oRequestAnimationFrame || 
		window.msRequestAnimationFrame ||
		function(callback) {
			window.setTimeout(callback, 1);		// second parameter is time in ms
		};
})();

