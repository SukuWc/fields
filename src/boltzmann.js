
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


// One full LBM step (collide→stream→bounce→consolidate) on an arbitrary cell array.
// Module-level so all refinement levels can call it without passing the root Boltzmann around.
function collideAndStream(cells, omega) {
	for (let i = 0; i < cells.length; i++) cells[i].collide(omega);
	for (let i = 0; i < cells.length; i++) cells[i].stream();
	for (let i = 0; i < cells.length; i++) cells[i].bounce();
	for (let i = 0; i < cells.length; i++) cells[i].consolidate();
}


// Multi-domain AMR (Lagrava §3.5): a flat rectangular fine grid at 2× parent resolution.
// cx0, cy0, cx1, cy1 are corners in the PARENT grid's cell coordinates (exclusive on cx1/cy1).
// parent may be a Boltzmann instance (level-1 domain) or another RefinementDomain (level N+1).
// Each domain runs 2 fine sub-steps per 1 parent sub-step with its own omega_f (Eq. 24).
// Coarse↔fine coupling: Eq. 29 (parent→fine, non-eq rescaling) and Eq. 30/33
// (fine→parent, box-filter + non-eq rescaling).
// Temporal interpolation (Section 3.5): sub-step 1 uses the t-state ghost boundary
// (saved before the parent step); sub-step 2 uses the t+½ interpolation.
class RefinementDomain {

	constructor(parent, cx0, cy0, cx1, cy1) {
		this.cx0 = cx0;
		this.cy0 = cy0;
		this.cx1 = cx1;
		this.cy1 = cy1;

		// Fine grid: 2 fine cells per parent cell + 1-cell ghost border on each side.
		// Ghost border cells (fi=0, fi=width-1, fj=0, fj=height-1) receive values from
		// the parent grid via parent→fine coupling (Eq. 29).
		this.width  = (cx1 - cx0) * 2 + 2;
		this.height = (cy1 - cy0) * 2 + 2;

		// Eq. 24: omega_c for this domain = parent's effective omega.
		// Recursive application: level-1 uses root omega_c; level-2 uses level-1 omega_f; etc.
		this.omega_c = (parent instanceof RefinementDomain) ? parent.omega_f : 1 / (3 * parent.nu + 0.5);
		this.omega_f = 2 * this.omega_c / (4 - this.omega_c);

		// Cell size and top-left corner in ROOT coarse grid coordinates.
		// Used by paintTexture and worldBorderLines at any depth.
		// Level-1 (parent = Boltzmann): dx = 0.5, origin = (cx0, cy0) in root coarse coords.
		// Level-N (parent = RefinementDomain): dx = parent.dx * 0.5, origin mapped from parent.
		if (parent instanceof RefinementDomain) {
			this.dx       = parent.dx * 0.5;
			this.cx0_root = parent.cx0_root + (cx0 - 1) * parent.dx;
			this.cy0_root = parent.cy0_root + (cy0 - 1) * parent.dx;
		} else {
			this.dx       = 0.5;
			this.cx0_root = cx0;
			this.cy0_root = cy0;
		}

		// Child refinement domains (level N+1 relative to this domain).
		this.domains = [];

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
		this._allInteriorCells = [...this.interiorCells];

		// Propagate barrier flags from the parent grid into fine cells.
		// A fine cell is a barrier if any parent cell it overlaps is a barrier.
		for (let fj = 1; fj < this.height - 1; fj++) {
			for (let fi = 1; fi < this.width - 1; fi++) {
				const cx = cx0 + (fi - 1) * 0.5;
				const cy = cy0 + (fj - 1) * 0.5;
				const bx0 = Math.max(0, Math.floor(cx));
				const by0 = Math.max(0, Math.floor(cy));
				const bx1 = Math.min(parent.width  - 1, Math.ceil(cx));
				const by1 = Math.min(parent.height - 1, Math.ceil(cy));
				let isBarrier = false;
				outer: for (let by = by0; by <= by1; by++) {
					for (let bx = bx0; bx <= bx1; bx++) {
						if (parent.cells[bx + by * parent.width].barrier) {
							isBarrier = true;
							break outer;
						}
					}
				}
				this.cells[fi + fj * this.width].barrier = isBarrier;
			}
		}

		// Initialize every cell from the parent grid using the same cubic interpolation +
		// non-eq rescaling as ghost injection (Eq. 29). This ensures the fine grid starts
		// consistent with the coarse flow state, preventing shockwaves when a domain is
		// created or moved to a new position.
		for (let fj = 0; fj < this.height; fj++) {
			for (let fi = 0; fi < this.width; fi++) {
				this._injectGhostCell(parent, fi, fj);
			}
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

		// Energy injections from apply_energy(), re-applied before each fine sub-step.
		this.pendingInjections = [];
	}

	// Section 3.5 (Lagrava): coarse→fine injection, 2 fine sub-steps, fine→coarse averaging.
	// Eq. 29 rescaling applied on injection; Eq. 30/33 applied on averaging.
	// Temporal interpolation: sub-step 1 uses the t-state saved in ghostSnapshot;
	// sub-step 2 uses the t+½ interpolation (0.5*t + 0.5*(t+1)).
	step(parent) {
		// Sub-step 1: restore t-state ghost boundary, inject energy, run.
		// Inject before the step so the perturbation is present when collide runs.
		for (const inj of this.pendingInjections) {
			this._applyForceFineCell(inj.fi, inj.fj, inj.fx, inj.fy);
		}
		this._restoreGhostFromSnapshot();
		collideAndStream(this.interiorCells, this.omega_f);

		// Run child domains for this sub-interval (this domain is now at t+½)
		for (const child of this.domains) {
			child.saveCoarseBoundary(this);
			child.step(this);
		}

		// Sub-step 2: inject t+1 parent state, interpolate to t+½, inject energy again, run.
		// Re-inject so the boat wake persists through the second sub-step (§3.5).
		// pendingInjections is NOT cleared here — Boltzmann.physics_model_step clears it
		// after all domain steps, so recursive child calls also see the injections.
		this.injectFromCoarse(parent);
		this._interpolateGhostCells(0.5); // 0.5*(t-snapshot) + 0.5*(t+1) = t+½
		for (const inj of this.pendingInjections) {
			this._applyForceFineCell(inj.fi, inj.fj, inj.fx, inj.fy);
		}
		collideAndStream(this.interiorCells, this.omega_f);

		// Run child domains for this sub-interval (this domain is now at t+1)
		for (const child of this.domains) {
			child.saveCoarseBoundary(this);
			child.step(this);
		}

		this.averageToCoarse(parent);
	}

	// Section 3.5 (Lagrava): capture t-state ghost boundary BEFORE the parent step runs.
	// Injects from parent into ghost cells (Eq. 29) and snapshots the resulting populations.
	// Must be called before the parent's collideAndStream for correct temporal interpolation.
	saveCoarseBoundary(parent) {
		this.injectFromCoarse(parent);
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
	injectFromCoarse(parent) {
		for (let fi = 0; fi < this.width; fi++) {
			this._injectGhostCell(parent, fi, 0);
			this._injectGhostCell(parent, fi, this.height - 1);
		}
		for (let fj = 1; fj < this.height - 1; fj++) {
			this._injectGhostCell(parent, 0, fj);
			this._injectGhostCell(parent, this.width - 1, fj);
		}
	}

	_injectGhostCell(parent, fi, fj) {
		const cx = this.cx0 + (fi - 1) * 0.5;
		const cy = this.cy0 + (fj - 1) * 0.5;

		const icx = Math.floor(cx);
		const icy = Math.floor(cy);

		const W = parent.width;
		const H = parent.height;
		const get = (x, y) => parent.cells[Math.max(0, Math.min(x, W-1)) + Math.max(0, Math.min(y, H-1)) * W];

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
	averageToCoarse(parent) {
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
				const coarse = parent.cells[cx + cy * parent.width];
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

	// Add a child refinement domain in this domain's cell coordinates.
	addDomain(cx0, cy0, cx1, cy1) {
		this.domains.push(new RefinementDomain(this, cx0, cy0, cx1, cy1));
		this._rebuildInteriorCells();
	}

	// Replace a child domain at index, preserving overlapping cell state.
	moveDomain(index, cx0, cy0, cx1, cy1) {
		const old = this.domains[index];
		const nd  = new RefinementDomain(this, cx0, cy0, cx1, cy1);

		for (let fj = 1; fj < nd.height - 1; fj++) {
			for (let fi = 1; fi < nd.width - 1; fi++) {
				const cx = cx0 + (fi - 1) * 0.5;
				const cy = cy0 + (fj - 1) * 0.5;
				if (cx >= old.cx0 && cx < old.cx1 && cy >= old.cy0 && cy < old.cy1) {
					const fi_o = 1 + (cx - old.cx0) * 2;
					const fj_o = 1 + (cy - old.cy0) * 2;
					const src = old.cells[fi_o + fj_o * old.width];
					const dst = nd.cells[fi   + fj   * nd.width];
					dst.f0  = src.f0;
					dst.fN  = src.fN;  dst.fS  = src.fS;
					dst.fE  = src.fE;  dst.fW  = src.fW;
					dst.fNE = src.fNE; dst.fNW = src.fNW;
					dst.fSE = src.fSE; dst.fSW = src.fSW;
					dst.rho = src.rho; dst.ux  = src.ux; dst.uy  = src.uy;
				}
			}
		}

		this.domains[index] = nd;
		this._rebuildInteriorCells();
	}

	_rebuildInteriorCells() {
		const dominated = new Set();
		for (const d of this.domains) {
			for (let y = d.cy0; y < d.cy1; y++) {
				for (let x = d.cx0; x < d.cx1; x++) {
					dominated.add(this.cells[x + y * this.width]);
				}
			}
		}
		this.interiorCells = this._allInteriorCells.filter(cell => !dominated.has(cell));
	}

	// Paint fine cells onto the shared texture, then recursively paint child domains on top.
	// Uses cx0_root + (fi-1)*dx for position and dx for size — works at any refinement depth.
	paintTexture(boltzmann, plot_type, contrast) {
		for (let fj = 1; fj < this.height - 1; fj++) {
			for (let fi = 1; fi < this.width - 1; fi++) {
				const cell = this.cells[fi + fj * this.width];
				const color = cell.calculate_color(plot_type, contrast);
				const cx = this.cx0_root + (fi - 1) * this.dx;
				const cy = this.cy0_root + (fj - 1) * this.dx;
				boltzmann.colorSquare(cx, cy, this.dx, color.red, color.green, color.blue);
			}
		}
		for (const child of this.domains) {
			child.paintTexture(boltzmann, plot_type, contrast);
		}
	}

	// Returns the domain boundary as four world-space line segments {x1,y1,x2,y2}.
	// Uses cx0_root/cy0_root and dx — works at any refinement depth.
	worldBorderLines(boltzmann) {
		const cx1_root = this.cx0_root + (this.width  - 2) * this.dx;
		const cy1_root = this.cy0_root + (this.height - 2) * this.dx;
		const toWorld = (cx, cy) => ({
			x: (cx - boltzmann.width  / 2) / boltzmann.resolution,
			y: (cy - boltzmann.height / 2) / boltzmann.resolution,
		});
		const tl = toWorld(this.cx0_root, this.cy0_root);
		const tr = toWorld(cx1_root,      this.cy0_root);
		const br = toWorld(cx1_root,      cy1_root);
		const bl = toWorld(this.cx0_root, cy1_root);
		return [
			{ x1: tl.x, y1: tl.y, x2: tr.x, y2: tr.y },
			{ x1: tr.x, y1: tr.y, x2: br.x, y2: br.y },
			{ x1: br.x, y1: br.y, x2: bl.x, y2: bl.y },
			{ x1: bl.x, y1: bl.y, x2: tl.x, y2: tl.y },
		];
	}

	// Returns true when a continuous coarse coordinate falls inside this domain.
	containsCoarse(cx_cont, cy_cont) {
		return cx_cont >= this.cx0 && cx_cont < this.cx1 &&
		       cy_cont >= this.cy0 && cy_cont < this.cy1;
	}

	// Bilinear interpolation of fine-grid velocity at a coordinate in the PARENT's cell space.
	// cx_cont/cy_cont are in parent cell coords; converted to continuous fine index internally.
	// Delegates to child domains if the point falls inside one (recursive).
	getVelocityAt(cx_cont, cy_cont) {
		const fi_f = 1 + (cx_cont - this.cx0) * 2;
		const fj_f = 1 + (cy_cont - this.cy0) * 2;
		for (const child of this.domains) {
			if (child.containsCoarse(fi_f, fj_f)) return child.getVelocityAt(fi_f, fj_f);
		}
		const fi0 = Math.max(1, Math.min(this.width  - 2, Math.floor(fi_f)));
		const fj0 = Math.max(1, Math.min(this.height - 2, Math.floor(fj_f)));
		const fi1 = Math.min(this.width  - 2, fi0 + 1);
		const fj1 = Math.min(this.height - 2, fj0 + 1);
		const hf = fi_f - fi0;
		const vf = fj_f - fj0;
		const c00 = this.cells[fi0 + fj0 * this.width];
		const c10 = this.cells[fi1 + fj0 * this.width];
		const c01 = this.cells[fi0 + fj1 * this.width];
		const c11 = this.cells[fi1 + fj1 * this.width];
		const vx = c00.ux*(1-hf)*(1-vf) + c10.ux*hf*(1-vf) + c01.ux*(1-hf)*vf + c11.ux*hf*vf;
		const vy = c00.uy*(1-hf)*(1-vf) + c10.uy*hf*(1-vf) + c01.uy*(1-hf)*vf + c11.uy*hf*vf;
		return { x: vx / 4, y: vy / 4 };
	}

	// Apply an energy impulse at a coordinate in the PARENT's cell space.
	// Delegates to the deepest child domain that contains the point (recursive),
	// so energy always goes to the finest available grid level.
	applyEnergyAt(cx_cont, cy_cont, fx, fy) {
		const fi_f = 1 + (cx_cont - this.cx0) * 2;
		const fj_f = 1 + (cy_cont - this.cy0) * 2;
		for (const child of this.domains) {
			if (child.containsCoarse(fi_f, fj_f)) {
				child.applyEnergyAt(fi_f, fj_f, fx, fy);
				return;
			}
		}
		const fi = Math.max(1, Math.min(this.width  - 2, Math.round(fi_f)));
		const fj = Math.max(1, Math.min(this.height - 2, Math.round(fj_f)));
		this.pendingInjections.push({ fi, fj, fx, fy });
		this._applyForceFineCell(fi, fj, fx, fy);
	}

	_applyForceFineCell(fi, fj, fx, fy) {
		const cell = this.cells[fi + fj * this.width];
		cell.setEquil(cell.ux + fx / cell.rho, cell.uy + fy / cell.rho);
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
		// Full interior set before any domain exclusions — used to rebuild interiorCells
		// when domains are added or moved.
		this._allInteriorCells = [...this.interiorCells];

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

				// No barriers
			}
		}

		this.running = false;

		this.initFluid();
		this.startStop();
		this.paintTexture();
	}

	// Add a rectangular fine refinement domain in coarse grid coordinates.
	// cx0, cy0: top-left corner; cx1, cy1: bottom-right corner (exclusive).
	// Coarse cells covered by the domain are removed from interiorCells — they are
	// evolved by the fine grid and written back via averageToCoarse, so running the
	// coarse collide+stream on them would be wasted work and inconsistent with the
	// multi-domain approach (Lagrava Fig. 3).
	addDomain(cx0, cy0, cx1, cy1) {
		this.domains.push(new RefinementDomain(this, cx0, cy0, cx1, cy1));
		this._rebuildInteriorCells();
	}

	// Replace an existing domain at index with a new one at the given coarse coordinates.
	// Cells that overlap with the old domain are copied directly so fine-grid structure
	// (wakes, pressure variation) is preserved. Only the newly exposed strip is
	// initialised from the coarse grid, keeping the shockwave minimal.
	moveDomain(index, cx0, cy0, cx1, cy1) {
		const old = this.domains[index];
		const nd  = new RefinementDomain(this, cx0, cy0, cx1, cy1);

		for (let fj = 1; fj < nd.height - 1; fj++) {
			for (let fi = 1; fi < nd.width - 1; fi++) {
				const cx = cx0 + (fi - 1) * 0.5;
				const cy = cy0 + (fj - 1) * 0.5;
				if (cx >= old.cx0 && cx < old.cx1 && cy >= old.cy0 && cy < old.cy1) {
					const fi_o = 1 + (cx - old.cx0) * 2;
					const fj_o = 1 + (cy - old.cy0) * 2;
					const src = old.cells[fi_o + fj_o * old.width];
					const dst = nd.cells[fi   + fj   * nd.width];
					dst.f0  = src.f0;
					dst.fN  = src.fN;  dst.fS  = src.fS;
					dst.fE  = src.fE;  dst.fW  = src.fW;
					dst.fNE = src.fNE; dst.fNW = src.fNW;
					dst.fSE = src.fSE; dst.fSW = src.fSW;
					dst.rho = src.rho; dst.ux  = src.ux; dst.uy  = src.uy;
				}
			}
		}

		this.domains[index] = nd;
		this._rebuildInteriorCells();
	}

	// Recompute interiorCells from the full pre-exclusion set, removing cells covered
	// by any current domain. Called after addDomain/moveDomain.
	_rebuildInteriorCells() {
		const dominated = new Set();
		for (const d of this.domains) {
			for (let y = d.cy0; y < d.cy1; y++) {
				for (let x = d.cx0; x < d.cx1; x++) {
					dominated.add(this.cells[x + y * this.width]);
				}
			}
		}
		this.interiorCells = this._allInteriorCells.filter(cell => !dominated.has(cell));
	}

	// Enable or disable a circular barrier obstacle at the grid centre.
	// Radius is in coarse cells; fine domains pick up the flag via their constructor.
	setBarriers(enabled) {
		const cx = this.width  / 2;
		const cy = this.height / 2;
		const r2 = 6 * 6; // radius 6 coarse cells ≈ 3 world units
		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				const dx = x - cx, dy = y - cy;
				this.cells[x + y * this.width].barrier = enabled && (dx*dx + dy*dy <= r2);
			}
		}
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

		// Clear pending injections for all domains after all sub-steps are done.
		// Must happen here (not inside step()) so recursive child calls at any level
		// still see the injections when they run their own sub-steps.
		function clearInjections(domains) {
			for (const d of domains) { d.pendingInjections.length = 0; clearInjections(d.domains); }
		}
		clearInjections(this.domains);

		this.computeCurl();

		this.t_delta = new Date() - t_start;
		this.step_ready = true;

		this.paintTexture();
	}

	// Delegates to the module-level collideAndStream function (defined before RefinementDomain).
	// Kept as a method so existing call sites on Boltzmann instances continue to work.
	collideAndStream(cells, omega) { collideAndStream(cells, omega); }

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

	// Apply a force vector (fx, fy) to the fluid at world position (wx, wy).
	// Routes to the finest domain that contains the point.
	apply_energy(wx, wy, fx, fy) {
		const cx_cont = this.width/2  + wx * this.resolution;
		const cy_cont = this.height/2 + wy * this.resolution;
		for (let d = 0; d < this.domains.length; d++) {
			if (this.domains[d].containsCoarse(cx_cont, cy_cont)) {
				this.domains[d].applyEnergyAt(cx_cont, cy_cont, fx, fy);
				return;
			}
		}
		const x = Math.max(1, Math.min(this.width  - 2, Math.round(cx_cont)));
		const y = Math.max(1, Math.min(this.height - 2, Math.round(cy_cont)));
		this.apply_force_to_cell(x, y, fx, fy);
	}

	// Distribute a total force (fx, fy) evenly along a world-space line segment.
	// Steps at the finest grid cell size so every cell along the sail span is hit once.
	apply_energy_segment(x0, y0, x1, y1, fx, fy) {
		const dx = x1 - x0;
		const dy = y1 - y0;
		const length = Math.sqrt(dx*dx + dy*dy);
		if (length < 1e-9) return;

		// Step size = world size of the finest available cell
		let minDx = 1;
		const walkDx = (domains) => { for (const d of domains) { minDx = Math.min(minDx, d.dx); walkDx(d.domains); } };
		walkDx(this.domains);
		const step = minDx / this.resolution;

		const ux = dx / length;
		const uy = dy / length;

		let t = 0;
		while (t < length) {
			const actualStep = Math.min(step, length - t);
			const wx = x0 + ux * (t + actualStep * 0.5);
			const wy = y0 + uy * (t + actualStep * 0.5);
			this.apply_energy(wx, wy, fx * actualStep / length, fy * actualStep / length);
			t += step;
		}
	}

	apply_force_to_cell(x, y, fx, fy) {
		const cell = this.cells[x + y * this.width];
		cell.setEquil(cell.ux + fx / cell.rho, cell.uy + fy / cell.rho);
	}

	get_field_velocity(worldX, worldY) {
		const cx_cont = this.width/2  + worldX * this.resolution;
		const cy_cont = this.height/2 + worldY * this.resolution;
		for (let d = 0; d < this.domains.length; d++) {
			if (this.domains[d].containsCoarse(cx_cont, cy_cont)) {
				return this.domains[d].getVelocityAt(cx_cont, cy_cont);
			}
		}
		let x = this.width/2  + Math.floor(worldX * this.resolution);
		let y = this.height/2 + Math.floor(worldY * this.resolution);

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
		const _x_base = Math.round(x * this.oversampling);
		const _y_base = Math.round(y * this.oversampling);
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
