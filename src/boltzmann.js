
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

// Functions to convert rgb to hex color string (from stackoverflow):
function componentToHex(c) {
	var hex = c.toString(16);
	return hex.length == 1 ? "0" + hex : hex;
}
function rgbToHex(r, g, b) {
	return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
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

		// The _ at the end of the variable name is used for easier search or replacement of names.
		// Create the arrays of fluid particle densities, etc. (using 1D arrays for speed):
		// To index into these arrays, use x + y*this.width, traversing rows first and then columns.
		this._n0_ = new Array(this.width*this.height);			// microscopic densities along each lattice direction
		this._nN_ = new Array(this.width*this.height);
		this._nS_ = new Array(this.width*this.height);
		this._nE_ = new Array(this.width*this.height);
		this._nW_ = new Array(this.width*this.height);
		this._nNE_ = new Array(this.width*this.height);
		this._nSE_ = new Array(this.width*this.height);
		this._nNW_ = new Array(this.width*this.height);
		this._nSW_ = new Array(this.width*this.height);
		this._ux_ = new Array(this.width*this.height);			// macroscopic velocity
		this._uy_ = new Array(this.width*this.height);
		this._rho_ = new Array(this.width*this.height);			// macroscopic density
		this._curl_ = new Array(this.width*this.height);	

		// Setup barrier
		this.barrier = new Array(this.width*this.height);		// boolean array of barrier locations

		// Initialize with no barriers:
		for (var y=0; y<this.height; y++) {
			for (var x=0; x<this.width; x++) {
				this.barrier[x+y*this.width] = false;


				// create circular wall
				let r = 5;

				(Math.pow(this.width/2 - x, 2) + Math.pow(this.height*0.75 - y, 2) < Math.pow(r, 2) )? this.barrier[x+y*this.width] = true : null


			}
		}
		
		this.running = false;						// will be true when running

		this.initFluid();		// initialize to steady rightward flow
		this.startStop();

		this.graphics_model_init()
	}


	// Function to initialize or re-initialize the fluid, based on speed slider setting:
	initFluid() {

		let hspeed = Math.cos(this.direction/180*Math.PI)*this.speed
		let vspeed = Math.sin(this.direction/180*Math.PI)*this.speed

		console.log(hspeed, vspeed)

		// Amazingly, if I nest the y loop inside the x loop, Firefox slows down by a factor of 20
		for (var y=0; y<this.height; y++) {
			for (var x=0; x<this.width; x++) {

				this.setEquil(x, y, hspeed, vspeed, 1);
				this._curl_[x+y*this.width] = 0.0;
			}
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
	

		}

		this.t_delta = new Date() - t_start;

		this.step_ready = true;


		var stable = true;
		for (var x=0; x<this.width; x++) {
			var index = x + (this.height/2)*this.width;	// look at middle row only
			if (this._rho_[index] <= 0) stable = false;
		}
		if (!stable) {
			window.alert("The simulation has become unstable due to excessive fluid speeds.");
			this.startStop();
			this.initFluid();
		}
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
			this.setEquil(x, 0, hspeed, vspeed, 1);
			this.setEquil(x, this.height-1, hspeed, vspeed, 1);
		}
		for (var y=1; y<this.height-1; y++) {
			this.setEquil(0, y, hspeed, vspeed, 1);
			this.setEquil(this.width-1, y, hspeed, vspeed, 1);
		}
	}

	// Collide particles within each cell (here's the physics!):
	collide() {
		
		var omega = 1 / (3*this.viscosity + 0.5);		// reciprocal of relaxation time
		for (var y=1; y<this.height-1; y++) {
			for (var x=1; x<this.width-1; x++) {
				var i = x + y*this.width;		// array index for this lattice site
				var thisrho = this._n0_[i] + this._nN_[i] + this._nS_[i] + this._nE_[i] + this._nW_[i] + this._nNW_[i] + this._nNE_[i] + this._nSW_[i] + this._nSE_[i];
				this._rho_[i] = thisrho;
				var thisux = (this._nE_[i] + this._nNE_[i] + this._nSE_[i] - this._nW_[i] - this._nNW_[i] - this._nSW_[i]) / thisrho;
				this._ux_[i] = thisux;
				var thisuy = (this._nN_[i] + this._nNE_[i] + this._nNW_[i] - this._nS_[i] - this._nSE_[i] - this._nSW_[i]) / thisrho;
				this._uy_[i] = thisuy
				var one9thrho = one9th * thisrho;		// pre-compute a bunch of stuff for optimization
				var one36thrho = one36th * thisrho;
				var ux3 = 3 * thisux;
				var uy3 = 3 * thisuy;
				var ux2 = thisux * thisux;
				var uy2 = thisuy * thisuy;
				var uxuy2 = 2 * thisux * thisuy;
				var u2 = ux2 + uy2;
				var u215 = 1.5 * u2;
				this._n0_[i]  += omega * (four9ths*thisrho * (1                        - u215) - this._n0_[i]);
				this._nE_[i]  += omega * (   one9thrho * (1 + ux3       + 4.5*ux2        - u215) - this._nE_[i]);
				this._nW_[i]  += omega * (   one9thrho * (1 - ux3       + 4.5*ux2        - u215) - this._nW_[i]);
				this._nN_[i]  += omega * (   one9thrho * (1 + uy3       + 4.5*uy2        - u215) - this._nN_[i]);
				this._nS_[i]  += omega * (   one9thrho * (1 - uy3       + 4.5*uy2        - u215) - this._nS_[i]);
				this._nNE_[i] += omega * (  one36thrho * (1 + ux3 + uy3 + 4.5*(u2+uxuy2) - u215) - this._nNE_[i]);
				this._nSE_[i] += omega * (  one36thrho * (1 + ux3 - uy3 + 4.5*(u2-uxuy2) - u215) - this._nSE_[i]);
				this._nNW_[i] += omega * (  one36thrho * (1 - ux3 + uy3 + 4.5*(u2-uxuy2) - u215) - this._nNW_[i]);
				this._nSW_[i] += omega * (  one36thrho * (1 - ux3 - uy3 + 4.5*(u2+uxuy2) - u215) - this._nSW_[i]);
			}
		}
		for (var y=1; y<this.height-2; y++) {
			this._nW_[this.width-1+y*this.width] = this._nW_[this.width-2+y*this.width];		// at right end, copy left-flowing densities from next row to the left
			this._nNW_[this.width-1+y*this.width] = this._nNW_[this.width-2+y*this.width];
			this._nSW_[this.width-1+y*this.width] = this._nSW_[this.width-2+y*this.width];
		}
	}

	// Move particles along their directions of motion:
	stream() {

		for (var y=this.height-2; y>0; y--) {			// first start in NW corner...
			for (var x=1; x<this.width-1; x++) {
				this._nN_[x+y*this.width] = this._nN_[x+(y-1)*this.width];			// move the north-moving particles
				this._nNW_[x+y*this.width] = this._nNW_[x+1+(y-1)*this.width];		// and the northwest-moving particles
			}
		}
		for (var y=this.height-2; y>0; y--) {			// now start in NE corner...
			for (var x=this.width-2; x>0; x--) {
				this._nE_[x+y*this.width] = this._nE_[x-1+y*this.width];			// move the east-moving particles
				this._nNE_[x+y*this.width] = this._nNE_[x-1+(y-1)*this.width];		// and the northeast-moving particles
			}
		}
		for (var y=1; y<this.height-1; y++) {			// now start in SE corner...
			for (var x=this.width-2; x>0; x--) {
				this._nS_[x+y*this.width] = this._nS_[x+(y+1)*this.width];			// move the south-moving particles
				this._nSE_[x+y*this.width] = this._nSE_[x-1+(y+1)*this.width];		// and the southeast-moving particles
			}
		}
		for (var y=1; y<this.height-1; y++) {				// now start in the SW corner...
			for (var x=1; x<this.width-1; x++) {
				this._nW_[x+y*this.width] = this._nW_[x+1+y*this.width];			// move the west-moving particles
				this._nSW_[x+y*this.width] = this._nSW_[x+1+(y+1)*this.width];		// and the southwest-moving particles
			}
		}

		
		const opacity = 0.70;
		const transparency = 1-opacity;
		for (var y=1; y<this.height-1; y++) {				// Now handle bounce-back from barriers
			for (var x=1; x<this.width-1; x++) {
				if (this.barrier[x+y*this.width]) {
					var index = x + y*this.width;
					this._nE_[x+1+y*this.width] = this._nE_[x+1+y*this.width]*transparency + this._nW_[index]*opacity;
					this._nW_[x-1+y*this.width] = this._nW_[x-1+y*this.width]*transparency + this._nE_[index]*opacity;
					this._nN_[x+(y+1)*this.width] = this._nN_[x+(y+1)*this.width]*transparency +  this._nS_[index]*opacity;
					this._nS_[x+(y-1)*this.width] = this._nS_[x+(y-1)*this.width]*transparency +  this._nN_[index]*opacity;
					this._nNE_[x+1+(y+1)*this.width] = this._nNE_[x+1+(y+1)*this.width]*transparency +  this._nSW_[index]*opacity;
					this._nNW_[x-1+(y+1)*this.width] = this._nNW_[x-1+(y+1)*this.width]*transparency +  this._nSE_[index]*opacity;
					this._nSE_[x+1+(y-1)*this.width] = this._nSE_[x+1+(y-1)*this.width]*transparency +  this._nNW_[index]*opacity;
					this._nSW_[x-1+(y-1)*this.width] = this._nSW_[x-1+(y-1)*this.width] *transparency +  this._nNE_[index]*opacity;


				}
			}
		}
	}

	// Set all densities in a cell to their equilibrium values for a given velocity and density:
	// (If density is omitted, it's left unchanged.)
	setEquil(x, y, newux, newuy, newrho) {
		var i = x + y*this.width;
		if (typeof newrho == 'undefined') {
			newrho = this._rho_[i];
		}
		var ux3 = 3 * newux;
		var uy3 = 3 * newuy;
		var ux2 = newux * newux;
		var uy2 = newuy * newuy;
		var uxuy2 = 2 * newux * newuy;
		var u2 = ux2 + uy2;
		var u215 = 1.5 * u2;
		this._n0_[i]  = four9ths * newrho * (1                              - u215);
		this._nE_[i]  =   one9th * newrho * (1 + ux3       + 4.5*ux2        - u215);
		this._nW_[i]  =   one9th * newrho * (1 - ux3       + 4.5*ux2        - u215);
		this._nN_[i]  =   one9th * newrho * (1 + uy3       + 4.5*uy2        - u215);
		this._nS_[i]  =   one9th * newrho * (1 - uy3       + 4.5*uy2        - u215);
		this._nNE_[i] =  one36th * newrho * (1 + ux3 + uy3 + 4.5*(u2+uxuy2) - u215);
		this._nSE_[i] =  one36th * newrho * (1 + ux3 - uy3 + 4.5*(u2-uxuy2) - u215);
		this._nNW_[i] =  one36th * newrho * (1 - ux3 + uy3 + 4.5*(u2-uxuy2) - u215);
		this._nSW_[i] =  one36th * newrho * (1 - ux3 - uy3 + 4.5*(u2+uxuy2) - u215);
		this._rho_[i] = newrho;
		this._ux_[i] = newux;
		this._uy_[i] = newuy;
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


	//	x += this.width/2;
	//	y += this.height/2

		let i = x + y*this.width;
	
		// F = m * a
		// a = F/m
		// dv/dt = F/m

		let vx = this._ux_[i]
		let vy = this._uy_[i]
		let m = this._rho_[i];

		let dvx = Math.cos(direction/180*Math.PI) * s / m * -1;
		let dvy = Math.sin(direction/180*Math.PI) * s / m * -1;
		
		this.setEquil(x,y, vx + dvx, vy + dvy)
		//this._nE_[i] = 0.1

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

		vx = this._ux_[x0 + y0*this.width]*s0 + this._ux_[x1 + y1*this.width]*s1 +  this._ux_[x2 + y2*this.width]*s2 +  this._ux_[x3 + y3*this.width]*s3
		vy = this._uy_[x0 + y0*this.width]*s0 + this._uy_[x1 + y1*this.width]*s1 +  this._uy_[x2 + y2*this.width]*s2 +  this._uy_[x3 + y3*this.width]*s3

		return {x: vx/4, y: vy/4}
	}

	paintTexture() {
		var cIndex=0;
		var contrast = Math.pow(1.2,Number(contrastSlider.value));
		var plotType = plotSelect.selectedIndex;
		if (plotType == 4) this.computeCurl();
		for (var y=0; y<this.height; y++) {
			for (var x=0; x<this.width; x++) {
				if (this.barrier[x+y*this.width]) {
					cIndex = nColors + 1;	// kludge for barrier color which isn't really part of color map
				} else {
					if (plotType == 0) {
						cIndex = Math.round(nColors * ((this._rho_[x+y*this.width]-1)*6*contrast + 0.5));
					} else if (plotType == 1) {
						cIndex = Math.round(nColors * (this._ux_[x+y*this.width]*2*contrast + 0.5));
					} else if (plotType == 2) {
						cIndex = Math.round(nColors * (this._uy_[x+y*this.width]*2*contrast + 0.5));
					} else if (plotType == 3) {
						var speed = Math.sqrt(this._ux_[x+y*this.width]*this._ux_[x+y*this.width] + this._uy_[x+y*this.width]*this._uy_[x+y*this.width]);
						cIndex = Math.round(nColors * (speed*4*contrast));
					} else {
						cIndex = Math.round(nColors * (this._curl_[x+y*this.width]*5*contrast + 0.5));
					}
					if (cIndex < 0) cIndex = 0;
					if (cIndex > nColors) cIndex = nColors;
				}

				let accent = false;
				if (this._curl_[x+y*this.width] > 0.005 || this._curl_[x+y*this.width] < -0.005) {
					accent = true;
				}

				this.colorSquare(x, y, redList[cIndex], greenList[cIndex], blueList[cIndex], accent);

			}
		}
	}

	// Color a grid square in the image data array, one pixel at a time (rgb each in range 0 to 255):
	colorSquare(x, y, r, g, b, accent) {

		if (this.texture === undefined){
			return
		}

		for(var i=0; i<this.oversampling; i++) {
			for(var j=0; j<this.oversampling; j++) {
				
				
				var ind = (x*this.oversampling+i + (y*this.oversampling+j)*this.width*this.oversampling) * 4;
				//var ind = (x + y*this.width) * 4;
				this.texture.image.data[ind+0] = r;
				this.texture.image.data[ind+1] = g;
				this.texture.image.data[ind+2] = b;
				this.texture.image.data[ind+3] = 255;

				if (accent === true){

					var accent_ind = (x*this.oversampling+0 + (y*this.oversampling+0)*this.width*this.oversampling) * 4;
					this.texture.image.data[accent_ind+0] = 255;
					this.texture.image.data[accent_ind+1] = 0;
					this.texture.image.data[accent_ind+2] = 0;
					this.texture.image.data[accent_ind+3] = 255;

				}
		
			}
		}
			

	}
	




	// Compute the curl (actually times 2) of the macroscopic velocity field, for plotting:
	computeCurl() {
		for (var y=1; y<this.height-1; y++) {			// interior sites only; leave edges set to zero
			for (var x=1; x<this.width-1; x++) {
				this._curl_[x+y*this.width] = this._uy_[x+1+y*this.width] - this._uy_[x-1+y*this.width] - this._ux_[x+(y+1)*this.width] + this._ux_[x+(y-1)*this.width];
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

