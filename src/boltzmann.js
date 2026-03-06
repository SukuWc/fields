
var plotSelect = document.getElementById('plotSelect');
var contrastSlider = document.getElementById('contrastSlider');


var rafCheck = document.getElementById('rafCheck');

// Eq. 2: D2Q9 lattice weights — w_0=4/9 (rest), w_j=1/9 (axis-aligned), w_k=1/36 (diagonal)
// c_s^2 = 1/3 (lattice speed of sound squared)
const four9ths = 4.0 / 9.0;  // w_0
const one9th   = 1.0 / 9.0;  // w_j  (j = E, W, N, S)
const one36th  = 1.0 / 36.0; // w_k  (k = NE, NW, SE, SW)

// Eq. 3: f_i^eq = w_i * rho * (1 + 3(xi.u) + 4.5(xi.u)^2 - 1.5|u|^2)
function computeEquil(ux, uy, rho) {
	const ux3   = 3 * ux;
	const uy3   = 3 * uy;
	const ux2   = ux * ux;
	const uy2   = uy * uy;
	const uxuy2 = 2 * ux * uy;
	const u2    = ux2 + uy2;
	const u215  = 1.5 * u2;
	return {
		f0:  four9ths * rho * (1                              - u215),
		fE:    one9th * rho * (1 + ux3       + 4.5*ux2        - u215),
		fW:    one9th * rho * (1 - ux3       + 4.5*ux2        - u215),
		fN:    one9th * rho * (1 + uy3       + 4.5*uy2        - u215),
		fS:    one9th * rho * (1 - uy3       + 4.5*uy2        - u215),
		fNE:  one36th * rho * (1 + ux3 + uy3 + 4.5*(u2+uxuy2) - u215),
		fSE:  one36th * rho * (1 + ux3 - uy3 + 4.5*(u2-uxuy2) - u215),
		fNW:  one36th * rho * (1 - ux3 + uy3 + 4.5*(u2-uxuy2) - u215),
		fSW:  one36th * rho * (1 - ux3 - uy3 + 4.5*(u2+uxuy2) - u215),
	};
}



// Set up the array of colors for plotting (mimicks matplotlib "jet" colormap):
// (Kludge: Index nColors+1 labels the color used for drawing barriers.)
var nColors = 400;							// there are actually nColors+2 colors
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
}
redList[nColors+1] = 0; greenList[nColors+1] = 0; blueList[nColors+1] = 0;	// barriers are black

function get_color(cIndex){

	if (cIndex < 0) cIndex = 0;
	if (cIndex > nColors) cIndex = nColors;

	return {red: redList[cIndex], green: greenList[cIndex], blue: blueList[cIndex]};
}


class SimulationCell {

	constructor() {
		this.f0  = 0;

		// Eq. 2: microscopic distribution functions along each D2Q9 lattice direction
		this.fN  = 0;
		this.fS  = 0;
		this.fE  = 0;
		this.fW  = 0;
		this.fNE = 0;
		this.fSE = 0;
		this.fNW = 0;
		this.fSW = 0;

		// Incoming buffers (written by stream/bounce, committed by consolidate)
		this.fN_in  = 0;
		this.fS_in  = 0;
		this.fE_in  = 0;
		this.fW_in  = 0;
		this.fNE_in = 0;
		this.fSE_in = 0;
		this.fNW_in = 0;
		this.fSW_in = 0;

		// Eq. 4/5: macroscopic fields (updated each collide step)
		this.ux  = 0; // x-velocity
		this.uy  = 0; // y-velocity
		this.rho = 0; // density
		this.curl = 0;

		this.barrier = false;

		// Geographic neighbour references — set by Boltzmann or RefinementDomain after construction.
		// nbN = north (y+1), nbS = south (y-1), nbE = east (x+1), nbW = west (x-1), etc.
		this.nbN = null; this.nbS = null; this.nbE = null; this.nbW = null;
		this.nbNE = null; this.nbNW = null; this.nbSE = null; this.nbSW = null;
	}

	setCurl(curl) {
		this.curl = curl;
	}

	setEquil(newux, newuy, newrho) {
		// Eq. 3: set all f_i to their equilibrium values for given (ux, uy, rho)
		if (typeof newrho == 'undefined') {
			newrho = this.rho;
		}
		const eq = computeEquil(newux, newuy, newrho);
		this.f0  = eq.f0;
		this.fN  = eq.fN;  this.fS  = eq.fS;
		this.fE  = eq.fE;  this.fW  = eq.fW;
		this.fNE = eq.fNE; this.fSE = eq.fSE;
		this.fNW = eq.fNW; this.fSW = eq.fSW;
		this.rho = newrho;
		this.ux  = newux;
		this.uy  = newuy;
	}

	calculate_curl() {
		// curl = ∂uy/∂x - ∂ux/∂y, finite difference over cached geographic neighbours
		this.curl = this.nbE.uy - this.nbW.uy - this.nbN.ux + this.nbS.ux;
	}

	calculate_color(plot_type, contrast) {
		// Returns {red, green, blue} — caller handles positioning and colorSquare.
		if (this.barrier) return {red: 0, green: 0, blue: 0};
		if (plot_type === 0) return get_color(Math.round(nColors * ((this.rho-1)*6*contrast + 0.5)));
		if (plot_type === 1) return get_color(Math.round(nColors * (this.ux*2*contrast + 0.5)));
		if (plot_type === 2) return get_color(Math.round(nColors * (this.uy*2*contrast + 0.5)));
		if (plot_type === 3) {
			const speed = Math.sqrt(this.ux*this.ux + this.uy*this.uy);
			return get_color(Math.round(nColors * (speed*4*contrast)));
		}
		return get_color(Math.round(nColors * (this.curl*5*contrast + 0.5)));
	}

	collide(omega) {

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
		this.f0  += omega * (four9ths*rho    * (1                              - u215) - this.f0);
		this.fE  += omega * (one9thrho       * (1 + ux3       + 4.5*ux2        - u215) - this.fE);
		this.fW  += omega * (one9thrho       * (1 - ux3       + 4.5*ux2        - u215) - this.fW);
		this.fN  += omega * (one9thrho       * (1 + uy3       + 4.5*uy2        - u215) - this.fN);
		this.fS  += omega * (one9thrho       * (1 - uy3       + 4.5*uy2        - u215) - this.fS);
		this.fNE += omega * (one36thrho      * (1 + ux3 + uy3 + 4.5*(u2+uxuy2) - u215) - this.fNE);
		this.fSE += omega * (one36thrho      * (1 + ux3 - uy3 + 4.5*(u2-uxuy2) - u215) - this.fSE);
		this.fNW += omega * (one36thrho      * (1 - ux3 + uy3 + 4.5*(u2-uxuy2) - u215) - this.fNW);
		this.fSW += omega * (one36thrho      * (1 - ux3 - uy3 + 4.5*(u2+uxuy2) - u215) - this.fSW);

	}

	stream() {
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

	bounce() {
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

	consolidate() {
		this.fN  = this.fN_in;
		this.fS  = this.fS_in;
		this.fE  = this.fE_in;
		this.fW  = this.fW_in;
		this.fNE = this.fNE_in;
		this.fSE = this.fSE_in;
		this.fNW = this.fNW_in;
		this.fSW = this.fSW_in;

		this.fN_in  = 0;
		this.fS_in  = 0;
		this.fE_in  = 0;
		this.fW_in  = 0;
		this.fNE_in = 0;
		this.fSE_in = 0;
		this.fNW_in = 0;
		this.fSW_in = 0;
	}
}


// Multi-domain AMR (Lagrava §3.5): a flat rectangular fine grid at 2× coarse resolution.
// cx0, cy0, cx1, cy1 are corners in coarse grid integer coordinates (exclusive on cx1/cy1).
// Each domain runs 2 fine sub-steps per 1 coarse step with its own omega_f (Eq. 24).
// Coarse↔fine coupling: Eq. 29 (coarse→fine, non-eq rescaling) and Eq. 30/33
// (fine→coarse, box-filter + non-eq rescaling).
// Temporal interpolation (Section 3.5): sub-step 1 uses the t-state ghost boundary
// (saved before the coarse step); sub-step 2 uses the t+½ interpolation.
class RefinementDomain {

	constructor(boltzmann, cx0, cy0, cx1, cy1) {
		this.cx0 = cx0;
		this.cy0 = cy0;
		this.cx1 = cx1;
		this.cy1 = cy1;

		// Fine grid: 2 fine cells per coarse cell + 1-cell ghost border on each side.
		// Ghost border cells (fi=0, fi=width-1, fj=0, fj=height-1) will eventually
		// receive values from the coarse grid via coarse→fine coupling (Eq. 29).
		this.width  = (cx1 - cx0) * 2 + 2;
		this.height = (cy1 - cy0) * 2 + 2;

		// Eq. 10: omega_c = 1 / (3*nu + 0.5)
		// Eq. 24 (Lagrava): omega_f = 2*omega_c / (4 - omega_c)
		this.omega_c = 1 / (3 * boltzmann.nu + 0.5);
		this.omega_f = 2 * this.omega_c / (4 - this.omega_c);

		// Allocate cells
		this.cells = new Array(this.width * this.height);
		for (let k = 0; k < this.cells.length; k++) {
			this.cells[k] = new SimulationCell();
		}

		// Cache geographic neighbour references for interior fine cells.
		// Ghost border cells are excluded from interiorCells but their neighbours
		// are still valid (they point to other cells within this domain).
		this.interiorCells = [];
		for (let fj = 1; fj < this.height - 1; fj++) {
			for (let fi = 1; fi < this.width - 1; fi++) {
				const cell = this.cells[fi + fj * this.width];
				cell.nbN  = this.cells[fi       + (fj+1) * this.width];
				cell.nbS  = this.cells[fi       + (fj-1) * this.width];
				cell.nbE  = this.cells[(fi+1)   + fj     * this.width];
				cell.nbW  = this.cells[(fi-1)   + fj     * this.width];
				cell.nbNE = this.cells[(fi+1)   + (fj+1) * this.width];
				cell.nbNW = this.cells[(fi-1)   + (fj+1) * this.width];
				cell.nbSE = this.cells[(fi+1)   + (fj-1) * this.width];
				cell.nbSW = this.cells[(fi-1)   + (fj-1) * this.width];
				this.interiorCells.push(cell);
			}
		}

		// Eq. 3: initialize all cells to equilibrium at coarse wind speed
		const hspeed = Math.cos(boltzmann.direction / 180 * Math.PI) * boltzmann.speed;
		const vspeed = Math.sin(boltzmann.direction / 180 * Math.PI) * boltzmann.speed;
		for (let k = 0; k < this.cells.length; k++) {
			this.cells[k].setEquil(hspeed, vspeed, 1);
		}

		// Flat list of ghost border cells for temporal interpolation.
		// These are the cells at fi=0, fi=width-1, fj=0, fj=height-1.
		this.ghostCells = [];
		for (let fi = 0; fi < this.width; fi++) {
			this.ghostCells.push(this.cells[fi + 0                    * this.width]);
			this.ghostCells.push(this.cells[fi + (this.height-1)      * this.width]);
		}
		for (let fj = 1; fj < this.height - 1; fj++) {
			this.ghostCells.push(this.cells[0               + fj * this.width]);
			this.ghostCells.push(this.cells[(this.width-1)  + fj * this.width]);
		}

		// Snapshot buffer: 9 populations per ghost cell, stores the t-state for
		// temporal interpolation (sub-step 1 uses t, sub-step 2 uses t+½).
		this.ghostSnapshot = new Float64Array(this.ghostCells.length * 9);
	}

	// Section 3.5 (Lagrava): coarse→fine injection, 2 fine sub-steps, fine→coarse averaging.
	// Eq. 29 rescaling applied on injection; Eq. 30/33 applied on averaging.
	// Temporal interpolation: sub-step 1 uses the t-state saved in ghostSnapshot;
	// sub-step 2 uses the t+½ interpolation (0.5*t + 0.5*(t+1)).
	step(boltzmann) {
		// Sub-step 1: restore ghost boundary to t-state (saved before coarse step ran)
		this._restoreGhostFromSnapshot();
		boltzmann.collideAndStream(this.interiorCells, this.omega_f);

		// Sub-step 2: inject t+1 coarse state, then interpolate to t+½ (Section 3.5)
		this.injectFromCoarse(boltzmann);
		this._interpolateGhostCells(0.5); // 0.5*(t-snapshot) + 0.5*(t+1) = t+½
		boltzmann.collideAndStream(this.interiorCells, this.omega_f);

		this.averageToCoarse(boltzmann);
	}

	// Section 3.5 (Lagrava): capture t-state ghost boundary BEFORE the coarse step runs.
	// Injects from coarse into ghost cells (Eq. 29) and snapshots the resulting populations.
	// Must be called in Boltzmann.physics_model_step() before collideAndStream on root grid.
	saveCoarseBoundary(boltzmann) {
		this.injectFromCoarse(boltzmann);
		for (let k = 0; k < this.ghostCells.length; k++) {
			const g    = this.ghostCells[k];
			const base = k * 9;
			this.ghostSnapshot[base+0] = g.f0;
			this.ghostSnapshot[base+1] = g.fN;
			this.ghostSnapshot[base+2] = g.fS;
			this.ghostSnapshot[base+3] = g.fE;
			this.ghostSnapshot[base+4] = g.fW;
			this.ghostSnapshot[base+5] = g.fNE;
			this.ghostSnapshot[base+6] = g.fNW;
			this.ghostSnapshot[base+7] = g.fSE;
			this.ghostSnapshot[base+8] = g.fSW;
		}
	}

	// Restore ghost cells to the t-state populations saved by saveCoarseBoundary.
	// Used before sub-step 1 so the fine grid sees the t-state boundary.
	_restoreGhostFromSnapshot() {
		for (let k = 0; k < this.ghostCells.length; k++) {
			const g    = this.ghostCells[k];
			const base = k * 9;
			g.f0  = this.ghostSnapshot[base+0];
			g.fN  = this.ghostSnapshot[base+1];
			g.fS  = this.ghostSnapshot[base+2];
			g.fE  = this.ghostSnapshot[base+3];
			g.fW  = this.ghostSnapshot[base+4];
			g.fNE = this.ghostSnapshot[base+5];
			g.fNW = this.ghostSnapshot[base+6];
			g.fSE = this.ghostSnapshot[base+7];
			g.fSW = this.ghostSnapshot[base+8];
		}
	}

	// Interpolate ghost cells between the t-snapshot and their current (t+1) values.
	// alpha=0 → pure t-state, alpha=0.5 → t+½ (Section 3.5 temporal interpolation).
	_interpolateGhostCells(alpha) {
		const beta = 1 - alpha;
		for (let k = 0; k < this.ghostCells.length; k++) {
			const g    = this.ghostCells[k];
			const base = k * 9;
			g.f0  = beta * this.ghostSnapshot[base+0] + alpha * g.f0;
			g.fN  = beta * this.ghostSnapshot[base+1] + alpha * g.fN;
			g.fS  = beta * this.ghostSnapshot[base+2] + alpha * g.fS;
			g.fE  = beta * this.ghostSnapshot[base+3] + alpha * g.fE;
			g.fW  = beta * this.ghostSnapshot[base+4] + alpha * g.fW;
			g.fNE = beta * this.ghostSnapshot[base+5] + alpha * g.fNE;
			g.fNW = beta * this.ghostSnapshot[base+6] + alpha * g.fNW;
			g.fSE = beta * this.ghostSnapshot[base+7] + alpha * g.fSE;
			g.fSW = beta * this.ghostSnapshot[base+8] + alpha * g.fSW;
		}
	}

	// Coarse→fine: fill ghost border cells using cubic spatial interpolation (Eq. 38/39)
	// of coarse populations and macroscopic fields. Ghost cell (fi, fj) maps to coarse coord
	// cx = cx0 + (fi-1)*0.5, cy = cy0 + (fj-1)*0.5. Cells at half-integer positions use
	// Eq. 38 (centered 4-point) or Eq. 39 (one-sided 3-point) along each axis.
	injectFromCoarse(boltzmann) {
		for (let fi = 0; fi < this.width; fi++) {
			this._injectGhostCell(boltzmann, fi, 0);
			this._injectGhostCell(boltzmann, fi, this.height - 1);
		}
		for (let fj = 1; fj < this.height - 1; fj++) {
			this._injectGhostCell(boltzmann, 0, fj);
			this._injectGhostCell(boltzmann, this.width - 1, fj);
		}
	}

	_injectGhostCell(boltzmann, fi, fj) {
		const cx = this.cx0 + (fi - 1) * 0.5;
		const cy = this.cy0 + (fj - 1) * 0.5;

		const icx = Math.floor(cx);
		const icy = Math.floor(cy);

		const W = boltzmann.width;
		const H = boltzmann.height;
		const get = (x, y) => boltzmann.cells[Math.max(0, Math.min(x, W-1)) + Math.max(0, Math.min(y, H-1)) * W];

		// halfX/halfY: true when this fine cell sits at a half-integer coarse coordinate
		// (fi even → cx is half-integer; fj even → cy is half-integer).
		const halfX = (fi % 2 === 0);
		const halfY = (fj % 2 === 0);

		// Eq. 38: centered 4-point cubic at x = ix+0.5 along a coarse row/column.
		//   g(x) = (9/16)(g(x−h)+g(x+h)) − (1/16)(g(x−3h)+g(x+3h)),  h = half coarse spacing
		//   → neighbours: ix−1, ix, ix+1, ix+2
		// Eq. 39: one-sided 3-point cubic when the outer neighbour is unavailable.
		//   right-biased (left boundary): g = (3/8)g(ix) + (3/4)g(ix+1) − (1/8)g(ix+2)
		//   left-biased  (right boundary): g = (3/8)g(ix+1) + (3/4)g(ix) − (1/8)g(ix−1)
		const interpX = (fn, ix, iy) => {
			if (ix - 1 >= 0 && ix + 2 <= W - 1) // Eq. 38: centered
				return (9/16)*(fn(get(ix,iy)) + fn(get(ix+1,iy))) - (1/16)*(fn(get(ix-1,iy)) + fn(get(ix+2,iy)));
			if (ix - 1 < 0)                      // Eq. 39: right-biased
				return (3/8)*fn(get(ix,iy)) + (3/4)*fn(get(ix+1,iy)) - (1/8)*fn(get(ix+2,iy));
			return                               // Eq. 39: left-biased
				(3/8)*fn(get(ix+1,iy)) + (3/4)*fn(get(ix,iy)) - (1/8)*fn(get(ix-1,iy));
		};
		const interpY = (fn, ix, iy) => {
			if (iy - 1 >= 0 && iy + 2 <= H - 1) // Eq. 38: centered
				return (9/16)*(fn(get(ix,iy)) + fn(get(ix,iy+1))) - (1/16)*(fn(get(ix,iy-1)) + fn(get(ix,iy+2)));
			if (iy - 1 < 0)                      // Eq. 39: right-biased
				return (3/8)*fn(get(ix,iy)) + (3/4)*fn(get(ix,iy+1)) - (1/8)*fn(get(ix,iy+2));
			return                               // Eq. 39: left-biased
				(3/8)*fn(get(ix,iy+1)) + (3/4)*fn(get(ix,iy)) - (1/8)*fn(get(ix,iy-1));
		};
		// Separable 2D: cubic in x for each needed y-row, then cubic in y over those results.
		const interpXY = (fn) => {
			const gX = (iy) => interpX(fn, icx, iy);
			if (icy - 1 >= 0 && icy + 2 <= H - 1) // Eq. 38: centered in y
				return (9/16)*(gX(icy) + gX(icy+1)) - (1/16)*(gX(icy-1) + gX(icy+2));
			if (icy - 1 < 0)                        // Eq. 39: right-biased in y
				return (3/8)*gX(icy) + (3/4)*gX(icy+1) - (1/8)*gX(icy+2);
			return                                  // Eq. 39: left-biased in y
				(3/8)*gX(icy+1) + (3/4)*gX(icy) - (1/8)*gX(icy-1);
		};

		// Select scheme: Eq. 34 (direct copy) when coincident, 1D or 2D cubic otherwise.
		const interp = (!halfX && !halfY) ? (fn) => fn(get(icx, icy))    // Eq. 34
		             : (!halfY)           ? (fn) => interpX(fn, icx, icy) // 1D cubic in x
		             : (!halfX)           ? (fn) => interpY(fn, icx, icy) // 1D cubic in y
		             :                      interpXY;                      // 2D separable cubic

		// Interpolate macroscopic fields and all 9 populations from the coarse grid.
		const ux  = interp(c => c.ux);
		const uy  = interp(c => c.uy);
		const rho = interp(c => c.rho);
		const f0_c  = interp(c => c.f0);
		const fN_c  = interp(c => c.fN);
		const fS_c  = interp(c => c.fS);
		const fE_c  = interp(c => c.fE);
		const fW_c  = interp(c => c.fW);
		const fNE_c = interp(c => c.fNE);
		const fNW_c = interp(c => c.fNW);
		const fSE_c = interp(c => c.fSE);
		const fSW_c = interp(c => c.fSW);

		// Eq. 3: equilibrium at interpolated macroscopic fields
		const { f0: feq0, fN: feqN, fS: feqS, fE: feqE, fW: feqW,
		        fNE: feqNE, fNW: feqNW, fSE: feqSE, fSW: feqSW } = computeEquil(ux, uy, rho);

		// Eq. 29: f_{i,f} = f_i^eq + (ω_c / 2ω_f) * f_i^neq_c
		//         f_i^neq_c = f_{i,c} - f_i^eq(ρ_c, u_c)
		const scale = this.omega_c / (2 * this.omega_f);
		const ghost = this.cells[fi + fj * this.width];
		ghost.f0  = feq0  + scale * (f0_c  - feq0);
		ghost.fN  = feqN  + scale * (fN_c  - feqN);
		ghost.fS  = feqS  + scale * (fS_c  - feqS);
		ghost.fE  = feqE  + scale * (fE_c  - feqE);
		ghost.fW  = feqW  + scale * (fW_c  - feqW);
		ghost.fNE = feqNE + scale * (fNE_c - feqNE);
		ghost.fNW = feqNW + scale * (fNW_c - feqNW);
		ghost.fSE = feqSE + scale * (fSE_c - feqSE);
		ghost.fSW = feqSW + scale * (fSW_c - feqSW);
		ghost.ux  = ux;
		ghost.uy  = uy;
		ghost.rho = rho;
	}

	// Fine→coarse: box-filter average the 4 fine cells covering each coarse cell,
	// then apply non-equilibrium rescaling (Eq. 30/33).
	averageToCoarse(boltzmann) {
		const scale = (2 * this.omega_f) / this.omega_c; // Eq. 30 rescaling factor

		for (let cy = this.cy0; cy < this.cy1; cy++) {
			for (let cx = this.cx0; cx < this.cx1; cx++) {
				const fi0 = 1 + (cx - this.cx0) * 2;
				const fj0 = 1 + (cy - this.cy0) * 2;

				const f00 = this.cells[ fi0      +  fj0      * this.width];
				const f10 = this.cells[(fi0 + 1) +  fj0      * this.width];
				const f01 = this.cells[ fi0      + (fj0 + 1) * this.width];
				const f11 = this.cells[(fi0 + 1) + (fj0 + 1) * this.width];

				// Eq. 33: box-filter average of fine populations
				const f0_avg  = (f00.f0  + f10.f0  + f01.f0  + f11.f0)  * 0.25;
				const fN_avg  = (f00.fN  + f10.fN  + f01.fN  + f11.fN)  * 0.25;
				const fS_avg  = (f00.fS  + f10.fS  + f01.fS  + f11.fS)  * 0.25;
				const fE_avg  = (f00.fE  + f10.fE  + f01.fE  + f11.fE)  * 0.25;
				const fW_avg  = (f00.fW  + f10.fW  + f01.fW  + f11.fW)  * 0.25;
				const fNE_avg = (f00.fNE + f10.fNE + f01.fNE + f11.fNE) * 0.25;
				const fNW_avg = (f00.fNW + f10.fNW + f01.fNW + f11.fNW) * 0.25;
				const fSE_avg = (f00.fSE + f10.fSE + f01.fSE + f11.fSE) * 0.25;
				const fSW_avg = (f00.fSW + f10.fSW + f01.fSW + f11.fSW) * 0.25;

				// Eq. 4/5: macroscopic fields from averaged populations
				const rho = f0_avg + fN_avg + fS_avg + fE_avg + fW_avg +
				            fNE_avg + fNW_avg + fSE_avg + fSW_avg;
				const ux  = (fE_avg + fNE_avg + fSE_avg - fW_avg - fNW_avg - fSW_avg) / rho;
				const uy  = (fN_avg + fNE_avg + fNW_avg - fS_avg - fSE_avg - fSW_avg) / rho;

				// Eq. 3: equilibrium at averaged macroscopic fields
				const { f0: feq0, fN: feqN, fS: feqS, fE: feqE, fW: feqW,
				        fNE: feqNE, fNW: feqNW, fSE: feqSE, fSW: feqSW } = computeEquil(ux, uy, rho);

				// Eq. 30: f_{i,c} = f_i^eq + (2ω_f / ω_c) * f_i^neq_avg
				//         f_i^neq_avg = f_i^avg - f_i^eq(ρ_avg, u_avg)
				const coarse = boltzmann.cells[cx + cy * boltzmann.width];
				coarse.f0  = feq0  + scale * (f0_avg  - feq0);
				coarse.fN  = feqN  + scale * (fN_avg  - feqN);
				coarse.fS  = feqS  + scale * (fS_avg  - feqS);
				coarse.fE  = feqE  + scale * (fE_avg  - feqE);
				coarse.fW  = feqW  + scale * (fW_avg  - feqW);
				coarse.fNE = feqNE + scale * (fNE_avg - feqNE);
				coarse.fNW = feqNW + scale * (fNW_avg - feqNW);
				coarse.fSE = feqSE + scale * (fSE_avg - feqSE);
				coarse.fSW = feqSW + scale * (fSW_avg - feqSW);
				coarse.rho = rho;
				coarse.ux  = ux;
				coarse.uy  = uy;
			}
		}
	}

	// Paint fine cells onto the shared texture, overwriting the coarse cells in this region.
	// Fine cell (fi, fj) has coarse coordinate x = cx0 + (fi-1)*0.5, y = cy0 + (fj-1)*0.5.
	// Debug: dimmed to 75% brightness so the domain boundary is visible.
	paintTexture(boltzmann, plot_type, contrast) {
		for (let fj = 1; fj < this.height - 1; fj++) {
			for (let fi = 1; fi < this.width - 1; fi++) {
				const cell = this.cells[fi + fj * this.width];
				const color = cell.calculate_color(plot_type, contrast);
				const cx = this.cx0 + (fi - 1) * 0.5;
				const cy = this.cy0 + (fj - 1) * 0.5;
				boltzmann.colorSquare(cx, cy, 0.5, color.red * 0.75, color.green * 0.75, color.blue * 0.75);
			}
		}
	}
}


export class Boltzmann {

	constructor(width, height, resolution, direction, speed, texture, oversampling) {

		this.oversampling = oversampling;

		this.texture = texture;
		this.resolution = resolution;

		this.width = width * this.resolution;
		this.height = height * this.resolution;
		this.direction = direction + 180;

		this.step_ready = false;
		this.t_delta = 0;

		this.speed = speed / 100; // default speed 0.12

		// Kinematic viscosity coefficient in natural units
		this.nu = 0.020;

		// Fine refinement domains (multi-domain AMR, Lagrava §3.5).
		// Add domains via addDomain(cx0, cy0, cx1, cy1).
		this.domains = [];

		// Allocate root grid cells
		this.cells = new Array(this.width * this.height);
		for (var y = 0; y < this.height; y++) {
			for (var x = 0; x < this.width; x++) {
				this.cells[x + y * this.width] = new SimulationCell();
			}
		}

		// Pre-computed list of interior cells (excludes 1-cell-wide border).
		// Used by collideAndStream to avoid recomputing loop bounds every step.
		this.interiorCells = [];
		for (var y = 1; y < this.height - 1; y++) {
			for (var x = 1; x < this.width - 1; x++) {
				this.interiorCells.push(this.cells[x + y * this.width]);
			}
		}

		// Cache geographic neighbour references on each interior cell.
		// Coordinate convention: x increases rightward, y increases upward (math coords).
		// nbN = geographic north (y+1), nbS = geographic south (y-1), etc.
		for (var y = 1; y < this.height - 1; y++) {
			for (var x = 1; x < this.width - 1; x++) {
				const cell = this.cells[x + y * this.width];
				cell.nbN  = this.cells[x     + (y+1) * this.width]; // north  (y+1)
				cell.nbS  = this.cells[x     + (y-1) * this.width]; // south  (y-1)
				cell.nbE  = this.cells[(x+1) +  y    * this.width]; // east   (x+1)
				cell.nbW  = this.cells[(x-1) +  y    * this.width]; // west   (x-1)
				cell.nbNE = this.cells[(x+1) + (y+1) * this.width]; // NE (x+1,y+1)
				cell.nbNW = this.cells[(x-1) + (y+1) * this.width]; // NW (x-1,y+1)
				cell.nbSE = this.cells[(x+1) + (y-1) * this.width]; // SE (x+1,y-1)
				cell.nbSW = this.cells[(x-1) + (y-1) * this.width]; // SW (x-1,y-1)
			}
		}

		// Initialize barriers
		for (var y = 0; y < this.height; y++) {
			for (var x = 0; x < this.width; x++) {
				this.cells[x + y * this.width].barrier = false;

				// Circular wall obstacle
				const r = 5;
				if (Math.pow(this.width/2 - x, 2) + Math.pow(this.height*0.75 - y, 2) < Math.pow(r, 2)) {
					this.cells[x + y * this.width].barrier = true;
				}
			}
		}

		this.running = false;

		this.initFluid();
		this.startStop();
		this.paintTexture();
	}

	// Add a rectangular fine refinement domain in coarse grid coordinates.
	// cx0, cy0: top-left corner; cx1, cy1: bottom-right corner (exclusive).
	addDomain(cx0, cy0, cx1, cy1) {
		this.domains.push(new RefinementDomain(this, cx0, cy0, cx1, cy1));
	}

	// Initialize all cells to global equilibrium at the configured wind velocity.
	// Eq. 3: sets f_i = f_i^eq(rho=1, u=u_wind) everywhere.
	initFluid() {
		const hspeed = Math.cos(this.direction / 180 * Math.PI) * this.speed;
		const vspeed = Math.sin(this.direction / 180 * Math.PI) * this.speed;

		console.log(hspeed, vspeed);

		// Amazingly, if I nest the y loop inside the x loop, Firefox slows down by a factor of 20
		for (var y = 0; y < this.height; y++) {
			for (var x = 0; x < this.width; x++) {
				this.cells[x + y * this.width].setEquil(hspeed, vspeed, 1);
				this.cells[x + y * this.width].setCurl(0.0);
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

		const t_start = new Date();

		// Eq. 10: omega_c = 1 / (3*nu + 0.5)  (coarse grid relaxation frequency)
		// Eq. 24 (Lagrava): omega_f = 2*omega_c / (4 - omega_c)  (fine grid, per domain)
		const omega_c = 1 / (3 * this.nu + 0.5);

		// Section 3.5 (Lagrava): save t-state ghost boundaries BEFORE the coarse step,
		// so sub-step 1 of each domain can use the correct t-state (temporal interpolation).
		for (let d = 0; d < this.domains.length; d++) {
			this.domains[d].saveCoarseBoundary(this);
		}

		// 1 coarse step (Eq. 15→16→bounce-back→consolidate→boundary):
		this.collideAndStream(this.interiorCells, omega_c);
		this.setBoundaries();

		for (let d = 0; d < this.domains.length; d++) {
			this.domains[d].step(this);
		}

		this.computeCurl();

		this.t_delta = new Date() - t_start;
		this.step_ready = true;

		this.paintTexture();
	}

	// One full LBM step (collide→stream→bounce→consolidate) on an arbitrary cell array.
	// omega: BGK relaxation frequency for this grid level (Eq. 10 / Eq. 24).
	// Neighbour references (nbN, nbS, ...) must be pre-cached on each cell.
	//
	// For AMR sub-cycling (Section 3.5, Lagrava): call once per coarse step for the root
	// grid (interiorCells, omega_c), and twice per coarse step for each fine sub-grid
	// (domain.interiorCells, omega_f). Fine-grid omega from Eq. 24: omega_f = 2*omega_c / (4 - omega_c).
	collideAndStream(cells, omega) {
		for (let i = 0; i < cells.length; i++) cells[i].collide(omega);
		for (let i = 0; i < cells.length; i++) cells[i].stream();
		for (let i = 0; i < cells.length; i++) cells[i].bounce();
		for (let i = 0; i < cells.length; i++) cells[i].consolidate();
	}

	// Enforce Dirichlet inlet/outlet BCs on all four edges: f_i = f_i^eq(rho=1, u=u_wind).
	// Eq. 3: equilibrium distribution used to prescribe the boundary state each step.
	setBoundaries() {
		const hspeed = Math.cos(this.direction / 180 * Math.PI) * this.speed;
		const vspeed = Math.sin(this.direction / 180 * Math.PI) * this.speed;

		for (var x = 0; x < this.width; x++) {
			this.cells[x + 0                     * this.width].setEquil(hspeed, vspeed, 1);
			this.cells[x + (this.height-1)        * this.width].setEquil(hspeed, vspeed, 1);
		}
		for (var y = 1; y < this.height - 1; y++) {
			this.cells[0                + y * this.width].setEquil(hspeed, vspeed, 1);
			this.cells[(this.width - 1) + y * this.width].setEquil(hspeed, vspeed, 1);
		}
	}

	apply_energy(pushX, pushY, direction, strength) {

		document.getElementById("wind_info").innerHTML = "dir: " + direction + "stre : " + strength + "<br>";

		let x = this.width/2  + Math.floor(pushX * this.resolution);
		let y = this.height/2 + Math.floor(pushY * this.resolution);

		const x0 = Math.floor(x);
		const y0 = Math.floor(y);
		const x1 = x0 + 1;
		const y1 = y0;
		const x2 = x0;
		const y2 = y0 + 1;
		const x3 = x0 + 1;
		const y3 = y0 + 1;

		const hf = x - x0;
		const vf = y - y0;

		const s0 = (1-hf) * (1-vf);
		const s1 =   hf   * (1-vf);
		const s2 = (1-hf) *   vf;
		const s3 =   hf   *   vf;

		const x_array = [x0, x1, x2, x3];
		const y_array = [y0, y1, y2, y3];
		const s_array = [s0, s1, s2, s3];

		this.apply_force_to_cell(x_array[0], y_array[0], direction, s_array[0] * strength);
	}

	apply_force_to_cell(x, y, direction, s) {
		// F = m * a  →  dv = F/m * dt

		const cell = this.cells[x + y * this.width];
		const vx = cell.ux;
		const vy = cell.uy;
		const m  = cell.rho;

		const dvx = Math.cos(direction / 180 * Math.PI) * s / m * -1;
		const dvy = Math.sin(direction / 180 * Math.PI) * s / m * -1;

		cell.setEquil(vx + dvx, vy + dvy);
	}

	get_field_velocity(x, y) {
		x = this.width/2  + Math.floor(x * this.resolution);
		y = this.height/2 + Math.floor(y * this.resolution);

		const x0 = Math.floor(x);
		const y0 = Math.floor(y);
		const x1 = x0 + 1;
		const y1 = y0;
		const x2 = x0;
		const y2 = y0 + 1;
		const x3 = x0 + 1;
		const y3 = y0 + 1;

		const hf = x - x0;
		const vf = y - y0;

		const s0 = (1-hf) * (1-vf);
		const s1 =   hf   * (1-vf);
		const s2 = (1-hf) *   vf;
		const s3 =   hf   *   vf;

		const cell_0 = this.cells[x0 + y0 * this.width];
		const cell_1 = this.cells[x1 + y1 * this.width];
		const cell_2 = this.cells[x2 + y2 * this.width];
		const cell_3 = this.cells[x3 + y3 * this.width];

		const vx = cell_0.ux*s0 + cell_1.ux*s1 + cell_2.ux*s2 + cell_3.ux*s3;
		const vy = cell_0.uy*s0 + cell_1.uy*s1 + cell_2.uy*s2 + cell_3.uy*s3;

		return {x: vx/4, y: vy/4};
	}

	paintTexture() {
		if (this.texture === undefined) return;

		const contrast = Math.pow(1.2, Number(contrastSlider.value));
		const plotType = plotSelect.selectedIndex;

		// Paint coarse grid
		for (var y = 0; y < this.height; y++) {
			for (var x = 0; x < this.width; x++) {
				const cell  = this.cells[x + y * this.width];
				const color = cell.calculate_color(plotType, contrast);
				this.colorSquare(x, y, 1, color.red, color.green, color.blue);
			}
		}

		// Paint fine domains on top (overwrite coarse cells in each domain's region)
		for (let d = 0; d < this.domains.length; d++) {
			this.domains[d].paintTexture(this, plotType, contrast);
		}
	}

	// Color a grid square in the image data array, one pixel at a time (rgb each in range 0 to 255):
	colorSquare(x, y, size, r, g, b) {

		if (this.texture === undefined) return;

		const pixels_to_fill = this.oversampling * size;
		const _x_remainder = (x*this.oversampling - Math.round(x*this.oversampling)) / 2;
		const _y_remainder = (y*this.oversampling - Math.round(y*this.oversampling)) / 2;
		const offset = size < 1 ? 1 : 0;
		const _x_base = Math.round(x*this.oversampling) + Math.ceil(_x_remainder*this.oversampling) + offset;
		const _y_base = Math.round(y*this.oversampling) + Math.ceil(_y_remainder*this.oversampling) + offset;
		const rowWidth = this.width * this.oversampling;
		const data = this.texture.image.data;

		for (var i = 0; i < pixels_to_fill; i++) {
			for (var j = 0; j < pixels_to_fill; j++) {
				var ind = ((_x_base + i) + (_y_base + j) * rowWidth) * 4;
				data[ind]   = r;
				data[ind+1] = g;
				data[ind+2] = b;
				data[ind+3] = 255;
			}
		}
	}

	// Compute the curl of the macroscopic velocity field for plotting:
	computeCurl() {
		for (var y = 1; y < this.height - 1; y++) {
			for (var x = 1; x < this.width - 1; x++) {
				this.cells[x + y * this.width].calculate_curl();
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
