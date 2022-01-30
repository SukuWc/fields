var barrierList = [
	{name:"Short line", 
	locations:[
	12,15,
	12,16,
	12,17,
	12,18,
	12,19,
	12,20,
	12,21,
	12,22,
	12,23]}
];




// Global variables:	
var canvas = document.getElementById('theCanvas');
var context = canvas.getContext('2d');
var image = context.createImageData(canvas.width, canvas.height);		// for direct pixel manipulation (faster than fillRect)
for (var i=3; i<image.data.length; i+=4) image.data[i] = 255;			// set all alpha values to opaque


												// width of plotted grid site in pixels
var xdim = canvas.width;			// grid dimensions for simulation
var ydim = canvas.height;

var plotSelect = document.getElementById('plotSelect');
var contrastSlider = document.getElementById('contrastSlider');


var rafCheck = document.getElementById('rafCheck');
var running = false;						// will be true when running

var four9ths = 4.0 / 9.0;					// abbreviations
var one9th = 1.0 / 9.0;
var one36th = 1.0 / 36.0;

// Create the arrays of fluid particle densities, etc. (using 1D arrays for speed):
// To index into these arrays, use x + y*xdim, traversing rows first and then columns.
var n0 = new Array(xdim*ydim);			// microscopic densities along each lattice direction
var nN = new Array(xdim*ydim);
var nS = new Array(xdim*ydim);
var nE = new Array(xdim*ydim);
var nW = new Array(xdim*ydim);
var nNE = new Array(xdim*ydim);
var nSE = new Array(xdim*ydim);
var nNW = new Array(xdim*ydim);
var nSW = new Array(xdim*ydim);
var rho = new Array(xdim*ydim);			// macroscopic density
var ux = new Array(xdim*ydim);			// macroscopic velocity
var uy = new Array(xdim*ydim);
var curl = new Array(xdim*ydim);
var barrier = new Array(xdim*ydim);		// boolean array of barrier locations

// Initialize with no barriers:
for (var y=0; y<ydim; y++) {
	for (var x=0; x<xdim; x++) {
		barrier[x+y*xdim] = false;
	}
}

// Create a simple linear "wall" barrier (intentionally a little offset from center):
var barrierSize = 16;
for (var y=(ydim/2)-barrierSize; y<=(ydim/2)+barrierSize; y++) {
	var x = Math.round(ydim/3);
	barrier[x+y*xdim] = true;
}

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

	constructor(width, height, direction, speed){

		this.width = width;
		this.height = height;
		this.direction = direction;
		this.speed = speed;

		// legacy constants
		this.width = xdim
		this.height = ydim
		this.speed = 0.12;

		this.direction = 45;

		//  kinematic viscosity coefficient in natural units
		this.viscosity = 0.020;

		
		
		this.initFluid();		// initialize to steady rightward flow
		this.startStop();
	}


	// Function to initialize or re-initialize the fluid, based on speed slider setting:
	initFluid() {

		let hspeed = Math.cos(this.direction/180*Math.PI)*this.speed
		let vspeed = Math.sin(this.direction/180*Math.PI)*this.speed

		console.log(hspeed, vspeed)

		// Amazingly, if I nest the y loop inside the x loop, Firefox slows down by a factor of 20
		for (var y=0; y<this.height; y++) {
			for (var x=0; x<this.width; x++) {

				setEquil(x, y, hspeed, vspeed, 1);
				curl[x+y*this.width] = 0.0;
			}
		}

		paintCanvas();
	}

	// Function to start or pause the simulation:
	startStop() {
		running = !running;
		if (running) {
			this.physics_model_step();
		}
	}


	// Simulate function executes a bunch of steps and then schedules another call to itself:
	physics_model_step() {

		this.setBoundaries();

		this.collide();
		stream();



		paintCanvas();

		var stable = true;
		for (var x=0; x<this.width; x++) {
			var index = x + (this.height/2)*this.width;	// look at middle row only
			if (rho[index] <= 0) stable = false;
		}
		if (!stable) {
			window.alert("The simulation has become unstable due to excessive fluid speeds.");
			this.startStop();
			this.initFluid();
		}

		if (running) {
			if (rafCheck.checked) {
				requestAnimFrame(this.physics_model_step_handler.bind(this));	// let browser schedule next frame
			} else {
				window.setTimeout(this.physics_model_step_handler.bind(this), 1);	// schedule next frame asap (nominally 1 ms but always more)
			}
		}
	}

	physics_model_step_handler(){
		this.physics_model_step()
	}

	// Set the fluid variables at the boundaries, according to the current slider value:
	setBoundaries() {

		let hspeed = Math.cos(this.direction/180*Math.PI)*this.speed
		let vspeed = Math.sin(this.direction/180*Math.PI)*this.speed

		for (var x=0; x<this.width; x++) {
			setEquil(x, 0, hspeed, vspeed, 1);
			setEquil(x, this.height-1, hspeed, vspeed, 1);
		}
		for (var y=1; y<this.height-1; y++) {
			setEquil(0, y, hspeed, vspeed, 1);
			setEquil(this.width-1, y, hspeed, vspeed, 1);
		}
	}

	// Collide particles within each cell (here's the physics!):
	collide() {
		
		var omega = 1 / (3*this.viscosity + 0.5);		// reciprocal of relaxation time
		for (var y=1; y<ydim-1; y++) {
			for (var x=1; x<xdim-1; x++) {
				var i = x + y*xdim;		// array index for this lattice site
				var thisrho = n0[i] + nN[i] + nS[i] + nE[i] + nW[i] + nNW[i] + nNE[i] + nSW[i] + nSE[i];
				rho[i] = thisrho;
				var thisux = (nE[i] + nNE[i] + nSE[i] - nW[i] - nNW[i] - nSW[i]) / thisrho;
				ux[i] = thisux;
				var thisuy = (nN[i] + nNE[i] + nNW[i] - nS[i] - nSE[i] - nSW[i]) / thisrho;
				uy[i] = thisuy
				var one9thrho = one9th * thisrho;		// pre-compute a bunch of stuff for optimization
				var one36thrho = one36th * thisrho;
				var ux3 = 3 * thisux;
				var uy3 = 3 * thisuy;
				var ux2 = thisux * thisux;
				var uy2 = thisuy * thisuy;
				var uxuy2 = 2 * thisux * thisuy;
				var u2 = ux2 + uy2;
				var u215 = 1.5 * u2;
				n0[i]  += omega * (four9ths*thisrho * (1                        - u215) - n0[i]);
				nE[i]  += omega * (   one9thrho * (1 + ux3       + 4.5*ux2        - u215) - nE[i]);
				nW[i]  += omega * (   one9thrho * (1 - ux3       + 4.5*ux2        - u215) - nW[i]);
				nN[i]  += omega * (   one9thrho * (1 + uy3       + 4.5*uy2        - u215) - nN[i]);
				nS[i]  += omega * (   one9thrho * (1 - uy3       + 4.5*uy2        - u215) - nS[i]);
				nNE[i] += omega * (  one36thrho * (1 + ux3 + uy3 + 4.5*(u2+uxuy2) - u215) - nNE[i]);
				nSE[i] += omega * (  one36thrho * (1 + ux3 - uy3 + 4.5*(u2-uxuy2) - u215) - nSE[i]);
				nNW[i] += omega * (  one36thrho * (1 - ux3 + uy3 + 4.5*(u2-uxuy2) - u215) - nNW[i]);
				nSW[i] += omega * (  one36thrho * (1 - ux3 - uy3 + 4.5*(u2+uxuy2) - u215) - nSW[i]);
			}
		}
		for (var y=1; y<ydim-2; y++) {
			nW[xdim-1+y*xdim] = nW[xdim-2+y*xdim];		// at right end, copy left-flowing densities from next row to the left
			nNW[xdim-1+y*xdim] = nNW[xdim-2+y*xdim];
			nSW[xdim-1+y*xdim] = nSW[xdim-2+y*xdim];
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







// Move particles along their directions of motion:
function stream() {

	for (var y=ydim-2; y>0; y--) {			// first start in NW corner...
		for (var x=1; x<xdim-1; x++) {
			nN[x+y*xdim] = nN[x+(y-1)*xdim];			// move the north-moving particles
			nNW[x+y*xdim] = nNW[x+1+(y-1)*xdim];		// and the northwest-moving particles
		}
	}
	for (var y=ydim-2; y>0; y--) {			// now start in NE corner...
		for (var x=xdim-2; x>0; x--) {
			nE[x+y*xdim] = nE[x-1+y*xdim];			// move the east-moving particles
			nNE[x+y*xdim] = nNE[x-1+(y-1)*xdim];		// and the northeast-moving particles
		}
	}
	for (var y=1; y<ydim-1; y++) {			// now start in SE corner...
		for (var x=xdim-2; x>0; x--) {
			nS[x+y*xdim] = nS[x+(y+1)*xdim];			// move the south-moving particles
			nSE[x+y*xdim] = nSE[x-1+(y+1)*xdim];		// and the southeast-moving particles
		}
	}
	for (var y=1; y<ydim-1; y++) {				// now start in the SW corner...
		for (var x=1; x<xdim-1; x++) {
			nW[x+y*xdim] = nW[x+1+y*xdim];			// move the west-moving particles
			nSW[x+y*xdim] = nSW[x+1+(y+1)*xdim];		// and the southwest-moving particles
		}
	}
	for (var y=1; y<ydim-1; y++) {				// Now handle bounce-back from barriers
		for (var x=1; x<xdim-1; x++) {
			if (barrier[x+y*xdim]) {
				var index = x + y*xdim;
				nE[x+1+y*xdim] = nW[index];
				nW[x-1+y*xdim] = nE[index];
				nN[x+(y+1)*xdim] = nS[index];
				nS[x+(y-1)*xdim] = nN[index];
				nNE[x+1+(y+1)*xdim] = nSW[index];
				nNW[x-1+(y+1)*xdim] = nSE[index];
				nSE[x+1+(y-1)*xdim] = nNW[index];
				nSW[x-1+(y-1)*xdim] = nNE[index];


			}
		}
	}
}



// Set all densities in a cell to their equilibrium values for a given velocity and density:
// (If density is omitted, it's left unchanged.)
function setEquil(x, y, newux, newuy, newrho) {
	var i = x + y*xdim;
	if (typeof newrho == 'undefined') {
		newrho = rho[i];
	}
	var ux3 = 3 * newux;
	var uy3 = 3 * newuy;
	var ux2 = newux * newux;
	var uy2 = newuy * newuy;
	var uxuy2 = 2 * newux * newuy;
	var u2 = ux2 + uy2;
	var u215 = 1.5 * u2;
	n0[i]  = four9ths * newrho * (1                              - u215);
	nE[i]  =   one9th * newrho * (1 + ux3       + 4.5*ux2        - u215);
	nW[i]  =   one9th * newrho * (1 - ux3       + 4.5*ux2        - u215);
	nN[i]  =   one9th * newrho * (1 + uy3       + 4.5*uy2        - u215);
	nS[i]  =   one9th * newrho * (1 - uy3       + 4.5*uy2        - u215);
	nNE[i] =  one36th * newrho * (1 + ux3 + uy3 + 4.5*(u2+uxuy2) - u215);
	nSE[i] =  one36th * newrho * (1 + ux3 - uy3 + 4.5*(u2-uxuy2) - u215);
	nNW[i] =  one36th * newrho * (1 - ux3 + uy3 + 4.5*(u2-uxuy2) - u215);
	nSW[i] =  one36th * newrho * (1 - ux3 - uy3 + 4.5*(u2+uxuy2) - u215);
	rho[i] = newrho;
	ux[i] = newux;
	uy[i] = newuy;
}


// "Drag" the fluid in a direction determined by the mous* (or touch) motion:
// (The drag affects a "circle", 5 px in diameter, centered on the given coordinates.)
function apply_energy(pushX, pushY, pushUX, pushUY) {
	// First make sure we're not too close to edge:
	var margin = 3;
	if ((pushX > margin) && (pushX < xdim-1-margin) && (pushY > margin) && (pushY < ydim-1-margin)) {
		for (var dx=-1; dx<=1; dx++) {
			setEquil(pushX+dx, pushY+2, pushUX, pushUY);
			setEquil(pushX+dx, pushY-2, pushUX, pushUY);
		}
		for (var dx=-2; dx<=2; dx++) {
			for (var dy=-1; dy<=1; dy++) {
				setEquil(pushX+dx, pushY+dy, pushUX, pushUY);
			}
		}
	}
}


// Paint the canvas:
function paintCanvas() {
	var cIndex=0;
	var contrast = Math.pow(1.2,Number(contrastSlider.value));
	var plotType = plotSelect.selectedIndex;
	//var pixelGraphics = pixelCheck.checked;
	if (plotType == 4) computeCurl();
	for (var y=0; y<ydim; y++) {
		for (var x=0; x<xdim; x++) {
			if (barrier[x+y*xdim]) {
				cIndex = nColors + 1;	// kludge for barrier color which isn't really part of color map
			} else {
				if (plotType == 0) {
					cIndex = Math.round(nColors * ((rho[x+y*xdim]-1)*6*contrast + 0.5));
				} else if (plotType == 1) {
					cIndex = Math.round(nColors * (ux[x+y*xdim]*2*contrast + 0.5));
				} else if (plotType == 2) {
					cIndex = Math.round(nColors * (uy[x+y*xdim]*2*contrast + 0.5));
				} else if (plotType == 3) {
					var speed = Math.sqrt(ux[x+y*xdim]*ux[x+y*xdim] + uy[x+y*xdim]*uy[x+y*xdim]);
					cIndex = Math.round(nColors * (speed*4*contrast));
				} else {
					cIndex = Math.round(nColors * (curl[x+y*xdim]*5*contrast + 0.5));
				}
				if (cIndex < 0) cIndex = 0;
				if (cIndex > nColors) cIndex = nColors;
			}

			colorSquare(x, y, redList[cIndex], greenList[cIndex], blueList[cIndex]);

		}
	}

	context.putImageData(image, 0, 0);		// blast image to the screen


}

// Color a grid square in the image data array, one pixel at a time (rgb each in range 0 to 255):
function colorSquare(x, y, r, g, b) {
//function colorSquare(x, y, cIndex) {		// for some strange reason, this version is quite a bit slower on Chrome
	//var r = redList[cIndex];
	//var g = greenList[cIndex];
	//var b = blueList[cIndex];
	var flippedy = ydim - y - 1;			// put y=0 at the bottom
	for (var py=flippedy; py<(flippedy+1); py++) {
		for (var px=x; px<(x+1); px++) {
			var index = (px + py*image.width) * 4;
			image.data[index+0] = r;
			image.data[index+1] = g;
			image.data[index+2] = b;
		}
	}
}

// Compute the curl (actually times 2) of the macroscopic velocity field, for plotting:
function computeCurl() {
	for (var y=1; y<ydim-1; y++) {			// interior sites only; leave edges set to zero
		for (var x=1; x<xdim-1; x++) {
			curl[x+y*xdim] = uy[x+1+y*xdim] - uy[x-1+y*xdim] - ux[x+(y+1)*xdim] + ux[x+(y-1)*xdim];
		}
	}
}

