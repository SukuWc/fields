
var plotSelect = document.getElementById('plotSelect');
var contrastSlider = document.getElementById('contrastSlider');


var rafCheck = document.getElementById('rafCheck');

// Eq. 2: D2Q9 lattice weights — w_0=4/9 (rest), w_j=1/9 (axis-aligned), w_k=1/36 (diagonal)
// c_s^2 = 1/3 (lattice speed of sound squared)
const four9ths = 4.0 / 9.0;  // w_0
const one9th   = 1.0 / 9.0;  // w_j  (j = E, W, N, S)
const one36th  = 1.0 / 36.0; // w_k  (k = NE, NW, SE, SW)



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


		if (sub_mesh_depth == 3){

			//console.log("CREATE", x, y, sub_mesh_depth, is_temporary);
		}

		this.is_temporary = is_temporary;
		this.x = x;
		this.y = y;
		this.parent = parent;

		this.sub_mesh_depth = sub_mesh_depth; // 0 = boltzmann_root, 1 = simuation_cell, 2 = submesh_container

		this.f0  = 0; 
		
		// microscopic densities along each lattice direction
		this.fN  = 0;
		this.fS  = 0;
		this.fE  = 0;
		this.fW  = 0;
		this.fNE = 0;
		this.fSE = 0;
		this.fNW = 0;
		this.fSW = 0;

		this.fN_in  = 0;
		this.fS_in  = 0;
		this.fE_in  = 0;
		this.fW_in  = 0;
		this.fNE_in = 0;
		this.fSE_in = 0;
		this.fNW_in = 0;
		this.fSW_in = 0;

		this.ux  = 0; // macroscopic x velocity
		this.uy  = 0; // macroscopic y velocity
		this.rho = 0; // macroscopic density
		this.curl = 0;

		this.barrier = false;
	
		this.child_00 = null;
		this.child_01 = null;
		this.child_10 = null;
		this.child_11 = null;
	}

	find_child_cell(incoming_x_r, incoming_y_r){


		if (this.sub_mesh_depth == 2){

			//console.log("yeye", incoming_x_r, incoming_y_r)

		}

		if(incoming_x_r*4 === Math.round(incoming_x_r*4)){

			if (incoming_x_r < 0 && incoming_y_r < 0){
				return this.child_00;
			}
			else if (incoming_x_r > 0 && incoming_y_r < 0){
				return this.child_10;
			}
			else if (incoming_x_r < 0 && incoming_y_r > 0){
				return this.child_01;
			}
			else if (incoming_x_r > 0 && incoming_y_r > 0){
				return this.child_11;
			}

		}
		else{


			let x_i = Math.round(incoming_x_r*4);
			let y_i = Math.round(incoming_y_r*4);
	
			let x_r = (incoming_x_r*4-x_i)*1;
			let y_r = (incoming_y_r*4-y_i)*1;

			let base_cell = this;

			if (x_r !== 0){
				
				if (base_cell.child_00 == null){
					
					console.log("find_child_cell: convert", x_r, y_r)
					base_cell.convert_to_finer_mesh(true);
				}
	
				if (x_r < 0 && y_r < 0){
					return this.child_00.find_child_cell(x_r, y_r);
				}
				else if (x_r > 0 && y_r < 0){
					return this.child_10.find_child_cell(x_r, y_r);
				}
				else if (x_r < 0 && y_r > 0){
					return this.child_01.find_child_cell(x_r, y_r);
				}
				else if (x_r > 0 && y_r > 0){
					return this.child_11.find_child_cell(x_r, y_r);
				}
	
			}
	
			return base_cell;
			

		}
	
	
		return this;






		
	}

	setCurl(curl) {
		this.curl = curl;
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

		// if (x !== Math.round(x)){
		// 	// find cell is not implemented for submesh
		// 	//console.log("convert_to_finer_mesh: not implemented for submesh")
		// 	return;
		// }


		// Step size matches the grid spacing at this depth level:
		// depth 1 (base) → step 1, depth 2 (first submesh) → step 0.5, etc.
		const step = Math.pow(0.5, this.sub_mesh_depth - 1);

		for (let i = 0; i < 3; i++) {
			for (let j = 0; j < 3; j++) {

				const nx = x - step + i*step;
				const ny = y - step + j*step;
				const cell = root.find_cell(nx, ny);

				ux00  += prediciton_wights[i][j]     * cell.ux;
				uy00  += prediciton_wights[i][j]     * cell.uy;
				rho00 += prediciton_wights[i][j]     * cell.rho;

				// rot 90
				ux01  += prediciton_wights[2-j][i]   * cell.ux;
				uy01  += prediciton_wights[2-j][i]   * cell.uy;
				rho01 += prediciton_wights[2-j][i]   * cell.rho;

				// rot 180
				ux11  += prediciton_wights[2-i][2-j] * cell.ux;
				uy11  += prediciton_wights[2-i][2-j] * cell.uy;
				rho11 += prediciton_wights[2-i][2-j] * cell.rho;

				// rot 270
				ux10  += prediciton_wights[j][2-i]   * cell.ux;
				uy10  += prediciton_wights[j][2-i]   * cell.uy;
				rho10 += prediciton_wights[j][2-i]   * cell.rho;

			}

		}
		this.child_00.setEquil(ux00, uy00, rho00);
		this.child_01.setEquil(ux01, uy01, rho01);
		this.child_10.setEquil(ux10, uy10, rho10);
		this.child_11.setEquil(ux11, uy11, rho11);


	}

	setEquil(newux, newuy, newrho) {
		// Eq. 3: set all f_i to their equilibrium values for given (ux, uy, rho)
		if (typeof newrho == 'undefined') {
			newrho = this.rho;
		}
		const ux3   = 3 * newux;
		const uy3   = 3 * newuy;
		const ux2   = newux * newux;
		const uy2   = newuy * newuy;
		const uxuy2 = 2 * newux * newuy;
		const u2    = ux2 + uy2;
		const u215  = 1.5 * u2;
		this.f0  = four9ths * newrho * (1                              - u215);
		this.fE  =   one9th * newrho * (1 + ux3       + 4.5*ux2        - u215);
		this.fW  =   one9th * newrho * (1 - ux3       + 4.5*ux2        - u215);
		this.fN  =   one9th * newrho * (1 + uy3       + 4.5*uy2        - u215);
		this.fS  =   one9th * newrho * (1 - uy3       + 4.5*uy2        - u215);
		this.fNE =  one36th * newrho * (1 + ux3 + uy3 + 4.5*(u2+uxuy2) - u215);
		this.fSE =  one36th * newrho * (1 + ux3 - uy3 + 4.5*(u2-uxuy2) - u215);
		this.fNW =  one36th * newrho * (1 - ux3 + uy3 + 4.5*(u2-uxuy2) - u215);
		this.fSW =  one36th * newrho * (1 - ux3 - uy3 + 4.5*(u2+uxuy2) - u215);
		this.rho = newrho;
		this.ux  = newux;
		this.uy  = newuy;
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

			this.curl = 0;
			return;
		}

		this.curl = cell_right.uy - cell_left.uy - cell_up.ux + cell_down.ux;	

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

		// Eq. 4: rho = sum_i f_i
		const rho = this.f0 + this.fN + this.fS + this.fE + this.fW + this.fNW + this.fNE + this.fSW + this.fSE;
		this.rho = rho;

		// Eq. 5: rho*u = sum_i xi_i * f_i
		const ux = (this.fE + this.fNE + this.fSE - this.fW - this.fNW - this.fSW) / rho;
		const uy = (this.fN + this.fNE + this.fNW - this.fS - this.fSE - this.fSW) / rho;
		this.ux = ux;
		this.uy = uy;

		// Eq. 3: f_i^eq = w_i * rho * (1 + xi_i.u/c_s^2 + (xi_i.u)^2/(2*c_s^4) - u^2/(2*c_s^2))
		// With c_s^2 = 1/3: f_i^eq = w_i * rho * (1 + 3(xi.u) + 4.5(xi.u)^2 - 1.5|u|^2)
		// Eq. 15: f_i^out = f_i - omega * (f_i - f_i^eq)
		const one9thrho  = one9th  * rho;
		const one36thrho = one36th * rho;
		const ux3   = 3 * ux;
		const uy3   = 3 * uy;
		const ux2   = ux * ux;
		const uy2   = uy * uy;
		const uxuy2 = 2 * ux * uy;
		const u2    = ux2 + uy2;
		const u215  = 1.5 * u2;
		this.f0  += omega * (four9ths*rho    * (1                        - u215) - this.f0);
		this.fE  += omega * (one9thrho       * (1 + ux3       + 4.5*ux2        - u215) - this.fE);
		this.fW  += omega * (one9thrho       * (1 - ux3       + 4.5*ux2        - u215) - this.fW);
		this.fN  += omega * (one9thrho       * (1 + uy3       + 4.5*uy2        - u215) - this.fN);
		this.fS  += omega * (one9thrho       * (1 - uy3       + 4.5*uy2        - u215) - this.fS);
		this.fNE += omega * (one36thrho      * (1 + ux3 + uy3 + 4.5*(u2+uxuy2) - u215) - this.fNE);
		this.fSE += omega * (one36thrho      * (1 + ux3 - uy3 + 4.5*(u2-uxuy2) - u215) - this.fSE);
		this.fNW += omega * (one36thrho      * (1 - ux3 + uy3 + 4.5*(u2-uxuy2) - u215) - this.fNW);
		this.fSW += omega * (one36thrho      * (1 - ux3 - uy3 + 4.5*(u2+uxuy2) - u215) - this.fSW);

	}


	stream(){
		// Eq. 16 (pull scheme): f_i(x, t+1) = f_i^out(x - xi_i, t)
		// Each population is pulled from the upstream neighbour (opposite geographic direction).
		this.fN_in  = this.nbS.fN;   // xi_N  = (0,+1)  → upstream is south  (y-1)
		this.fS_in  = this.nbN.fS;   // xi_S  = (0,-1)  → upstream is north  (y+1)
		this.fE_in  = this.nbW.fE;   // xi_E  = (+1,0)  → upstream is west   (x-1)
		this.fW_in  = this.nbE.fW;   // xi_W  = (-1,0)  → upstream is east   (x+1)
		this.fNE_in = this.nbSW.fNE; // xi_NE = (+1,+1) → upstream is SW (x-1,y-1)
		this.fNW_in = this.nbSE.fNW; // xi_NW = (-1,+1) → upstream is SE (x+1,y-1)
		this.fSE_in = this.nbNW.fSE; // xi_SE = (+1,-1) → upstream is NW (x-1,y+1)
		this.fSW_in = this.nbNE.fSW; // xi_SW = (-1,-1) → upstream is NE (x+1,y+1)
	}

	bounce(){
		if (this.barrier) {
			// Half-way bounce-back: incoming population reverses direction and
			// is deposited in the geographic neighbour it would travel toward.
			this.nbE.fE_in   = this.fW_in;   // W→E: goes to east neighbour
			this.nbW.fW_in   = this.fE_in;   // E→W: goes to west neighbour
			this.nbN.fN_in   = this.fS_in;   // S→N: goes to north neighbour
			this.nbS.fS_in   = this.fN_in;   // N→S: goes to south neighbour
			this.nbNE.fNE_in = this.fSW_in;  // SW→NE: goes to NE neighbour
			this.nbNW.fNW_in = this.fSE_in;  // SE→NW: goes to NW neighbour
			this.nbSE.fSE_in = this.fNW_in;  // NW→SE: goes to SE neighbour
			this.nbSW.fSW_in = this.fNE_in;  // NE→SW: goes to SW neighbour
		}
	}

	consolidate(){

		this.fN  = this.fN_in  ;
		this.fS  = this.fS_in  ;
		this.fE  = this.fE_in  ;
		this.fW  = this.fW_in  ;
		this.fNE = this.fNE_in ;
		this.fSE = this.fSE_in ;
		this.fNW = this.fNW_in ;
		this.fSW = this.fSW_in ;

		this.fN_in  = 0;
		this.fS_in  = 0;
		this.fE_in  = 0;
		this.fW_in  = 0;
		this.fNE_in = 0;
		this.fSE_in = 0;
		this.fNW_in = 0;
		this.fSW_in = 0;


	}

	calculate_color(root, plot_type, contrast){



		if (this.sub_mesh_depth == 3){

			//console.log("DRAW", this.x, this.y, this.sub_mesh_depth);
		}

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
				color = get_color( Math.round(nColors * ((this.rho-1)*6*contrast + 0.5)));
			} else if (plot_type == 1) {
				color = get_color( Math.round(nColors * (this.ux*2*contrast + 0.5)));
			} else if (plot_type == 2) {
				color = get_color(Math.round(nColors * (this.uy*2*contrast + 0.5)));
			} else if (plot_type == 3) {
				var speed = Math.sqrt(this.ux*this.ux + this.uy*this.uy);
				color = get_color(Math.round(nColors * (speed*4*contrast)));
			} else {
				color = get_color(Math.round(nColors * (this.curl*this.sub_mesh_depth*5*contrast + 0.5)));
			}
			
		}

		if (this.sub_mesh_depth == 2){
			color = {red: color.red*0.75, green: color.green*0.75, blue: color.blue*0.75};
		}

		if (this.sub_mesh_depth == 3){
			color = {red: color.red/2, green: color.green/2, blue: color.blue/2};
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
		this.nu = 0.020;



		this.cells = new Array(this.width*this.height);
		for (var y=0; y<this.height; y++) {
			for (var x=0; x<this.width; x++) {
				this.cells[x+y*this.width] = new SimulationCell(this, x, y, 1);
			}
		}

		// Pre-computed list of interior cells (excludes 1-cell-wide border).
		// Used by collideAndStream to avoid recomputing loop bounds every step.
		this.interiorCells = [];
		for (var y=1; y<this.height-1; y++) {
			for (var x=1; x<this.width-1; x++) {
				this.interiorCells.push(this.cells[x + y*this.width]);
			}
		}

		// Cache geographic neighbour references on each interior cell.
		// Coordinate convention: x increases rightward, y increases upward (math coords).
		// nbN = geographic north (y+1), nbS = geographic south (y-1), etc.
		for (var y=1; y<this.height-1; y++) {
			for (var x=1; x<this.width-1; x++) {
				const cell = this.cells[x + y*this.width];
				cell.nbN  = this.cells[x     + (y+1)*this.width]; // north  (y+1)
				cell.nbS  = this.cells[x     + (y-1)*this.width]; // south  (y-1)
				cell.nbE  = this.cells[(x+1) +  y   *this.width]; // east   (x+1)
				cell.nbW  = this.cells[(x-1) +  y   *this.width]; // west   (x-1)
				cell.nbNE = this.cells[(x+1) + (y+1)*this.width]; // NE (x+1,y+1)
				cell.nbNW = this.cells[(x-1) + (y+1)*this.width]; // NW (x-1,y+1)
				cell.nbSE = this.cells[(x+1) + (y-1)*this.width]; // SE (x+1,y-1)
				cell.nbSW = this.cells[(x-1) + (y-1)*this.width]; // SW (x-1,y-1)
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

		this.paintTexture()
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


			return base_cell.find_child_cell(x_r, y_r);

			
		}

		return base_cell;
	}

	// Initialize all cells to global equilibrium at the configured wind velocity.
	// Eq. 3: sets f_i = f_i^eq(rho=1, u=u_wind) everywhere.
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


			// Eq. 10: omega for the root (coarse) grid level
			// Eq. 24 (Lagrava): fine-grid omega derived from coarse: omega_f = 2*omega_c / (4 - omega_c)
			const omega_c = 1 / (3*this.nu + 0.5);

			// One full LBM step on the root grid (Section 3.5, Lagrava: 1 coarse step)
			this.collideAndStream(this.interiorCells, omega_c);
			this.setBoundaries();

						// Initialize finer mesh at area of interest:
			for (var y=40; y<62; y++) {
				for (var x=30; x<52; x++) {

					this.find_cell(x,y).convert_to_finer_mesh();
				}
			}

			// Initialize finer mesh at area of interest:
			for (var y=45; y<51; y++) {
				for (var x=35; x<41; x++) {

					this.find_cell(x,y).child_00.convert_to_finer_mesh();
					this.find_cell(x,y).child_01.convert_to_finer_mesh();
					this.find_cell(x,y).child_10.convert_to_finer_mesh();
					this.find_cell(x,y).child_11.convert_to_finer_mesh();
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
		// 	if (this.rho[index] <= 0) stable = false;
		// }
		// if (!stable) {
		// 	window.alert("The simulation has become unstable due to excessive fluid speeds.");
		// 	this.startStop();
		// 	this.initFluid();
		// }


		this.paintTexture();

	}


	// One full LBM step (collide→stream→bounce→consolidate) on an arbitrary cell array.
	// omega: BGK relaxation frequency for this grid level (Eq. 10 / Eq. 24).
	// Neighbour references (nbN, nbS, ...) must be pre-cached on each cell.
	//
	// For AMR sub-cycling (Section 3.5, Lagrava): call once per coarse step for the root
	// grid (interiorCells, omega_c), and twice per coarse step for each fine sub-grid
	// (fineCells, omega_f). Fine-grid omega from Eq. 24: omega_f = 2*omega_c / (4 - omega_c).
	collideAndStream(cells, omega) {
		for (let i = 0; i < cells.length; i++) cells[i].collide(omega);
		for (let i = 0; i < cells.length; i++) cells[i].stream();
		for (let i = 0; i < cells.length; i++) cells[i].bounce();
		for (let i = 0; i < cells.length; i++) cells[i].consolidate();
	}

	// Enforce Dirichlet inlet/outlet BCs on all four edges: f_i = f_i^eq(rho=1, u=u_wind).
	// Eq. 3: equilibrium distribution used to prescribe the boundary state each step.
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

		const cell = this.find_cell(x, y);
		const vx = cell.ux;
		const vy = cell.uy;
		const m = cell.rho;

		const dvx = Math.cos(direction/180*Math.PI) * s / m * -1;
		const dvy = Math.sin(direction/180*Math.PI) * s / m * -1;

		cell.setEquil(vx + dvx, vy + dvy);

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

		vx = cell_0.ux*s0 + cell_1.ux*s1 +  cell_2.ux*s2 +  cell_3.ux*s3
		vy = cell_0.uy*s0 + cell_1.uy*s1 +  cell_2.uy*s2 +  cell_3.uy*s3

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

		const pixels_to_fill = this.oversampling * size;
		const _x_remainder = (x*this.oversampling - Math.round(x*this.oversampling)) / 2;
		const _y_remainder = (y*this.oversampling - Math.round(y*this.oversampling)) / 2;
		const offset = size < 1 ? 1 : 0;
		const _x_base = Math.round(x*this.oversampling) + Math.ceil(_x_remainder*this.oversampling) + offset;
		const _y_base = Math.round(y*this.oversampling) + Math.ceil(_y_remainder*this.oversampling) + offset;
		const rowWidth = this.width * this.oversampling;
		const data = this.texture.image.data;

		for(var i=0; i<pixels_to_fill; i++) {
			for(var j=0; j<pixels_to_fill; j++) {
				var ind = ((_x_base + i) + (_y_base + j) * rowWidth) * 4;
				data[ind]   = r;
				data[ind+1] = g;
				data[ind+2] = b;
				data[ind+3] = 255;
			}
		}
			

	}
	




	// Compute the curl (actually times 2) of the macroscopic velocity field, for plotting:
	computeCurl() {
		for (var y=1; y<this.height-1; y++) {			// interior sites only; leave edges set to zero
			for (var x=1; x<this.width-1; x++) {

				this.cells[x + y*this.width].calculate_curl();
			
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

