
var plotSelect = document.getElementById('plotSelect');
var contrastSlider = document.getElementById('contrastSlider');


var rafCheck = document.getElementById('rafCheck');

// Eq. 2: D2Q9 lattice weights — w_0=4/9 (rest), w_j=1/9 (axis-aligned), w_k=1/36 (diagonal)
// c_s^2 = 1/3 (lattice speed of sound squared)
const four9ths = 4.0 / 9.0;  // w_0
const one9th   = 1.0 / 9.0;  // w_j  (j = E, W, N, S)
const one36th  = 1.0 / 36.0; // w_k  (k = NE, NW, SE, SW)

// Rest equilibrium, used when a parent cell is missing during ghost injection
// so the interpolant never reads properties off undefined.
const ZERO_CELL = {
	ux: 0, uy: 0, rho: 1,
	f0: four9ths,
	fE: one9th, fW: one9th, fN: one9th, fS: one9th,
	fNE: one36th, fNW: one36th, fSE: one36th, fSW: one36th,
};

// Round a refinement box onto the parent grid and reject empty, inverted, or
// non-finite corners. A boat past the wall used to pass cx1 < cx0, and
// `new Array(negative)` threw while building the level-2 domain.
function normalizeDomainBox(cx0, cy0, cx1, cy1) {
	cx0 = Math.round(cx0);
	cy0 = Math.round(cy0);
	cx1 = Math.round(cx1);
	cy1 = Math.round(cy1);
	if (!Number.isInteger(cx0) || !Number.isInteger(cy0) || !Number.isInteger(cx1) || !Number.isInteger(cy1)) return null;
	if (!(cx1 > cx0 && cy1 > cy0)) return null;
	const width = (cx1 - cx0) * 2 + 2;
	const height = (cy1 - cy0) * 2 + 2;
	if (width < 4 || height < 4 || width * height > 2e6) return null;
	return { cx0, cy0, cx1, cy1 };
}

function latticeCell(cells, width, height, i, j) {
	if (!Number.isInteger(i) || !Number.isInteger(j)) return undefined;
	if (!Number.isInteger(width) || !Number.isInteger(height)) return undefined;
	if (i < 0 || j < 0 || i >= width || j >= height) return undefined;
	return cells[i + j * width];
}

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
		if (!Number.isFinite(newux) || !Number.isFinite(newuy) || !Number.isFinite(newrho)) {
			return;
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
		if (!this.nbE || !this.nbW || !this.nbN || !this.nbS) return;
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

		// Eq. 5 divides by rho. rho <= 0 (or a NaN population) makes ux/uy NaN,
		// and the next stream copies that into the neighbours. Reset the cell
		// to rest equilibrium instead of publishing a non-finite velocity.
		if (!(rho > 1e-6) || !Number.isFinite(rho)) {
			this.setEquil(0, 0, 1);
			return;
		}
		this.rho = rho;

		// Eq. 5: rho*u = sum_i xi_i * f_i
		const ux = (this.fE + this.fNE + this.fSE - this.fW - this.fNW - this.fSW) / rho;
		const uy = (this.fN + this.fNE + this.fNW - this.fS - this.fSE - this.fSW) / rho;
		if (!Number.isFinite(ux) || !Number.isFinite(uy)) {
			this.setEquil(0, 0, 1);
			return;
		}
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

		// Streaming replaced f. Stored macros must match the post-stream populations
		// or the next coarse→fine split treats the advected equilibrium as f_neq.
		this.recomputeMacros();
	}

	// Eq. 4/5: ρ = Σ f_i, ρu = Σ ξ_i f_i. Call after any write to the populations.
	recomputeMacros() {
		const rho = this.f0 + this.fN + this.fS + this.fE + this.fW
		          + this.fNE + this.fNW + this.fSE + this.fSW;
		this.rho = rho;
		if (rho > 1e-30) {
			this.ux = (this.fE + this.fNE + this.fSE - this.fW - this.fNW - this.fSW) / rho;
			this.uy = (this.fN + this.fNE + this.fNW - this.fS - this.fSE - this.fSW) / rho;
		} else {
			this.ux = 0;
			this.uy = 0;
		}
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

const POP_KEYS = ['f0','fN','fS','fE','fW','fNE','fNW','fSE','fSW'];

// D2Q9 directions and weights, used to strip mass and momentum out of a filtered f_neq
// so the restriction keeps the coincident node's ρ and u (Lagrava §3.3: do not filter them).
const NEQ_DIRS = [
	['f0',  0,  0, four9ths],
	['fE',  1,  0, one9th],
	['fW', -1,  0, one9th],
	['fN',  0,  1, one9th],
	['fS',  0, -1, one9th],
	['fNE', 1,  1, one36th],
	['fNW',-1,  1, one36th],
	['fSE', 1, -1, one36th],
	['fSW',-1, -1, one36th],
];

// NEQ_DIRS order. One buffer for the whole restriction so a 40² window does not
// allocate an object per cell (that allocation dropped the browser to a few fps).
const NEQ_CX = NEQ_DIRS.map(d => d[1]);
const NEQ_CY = NEQ_DIRS.map(d => d[2]);
const NEQ_W  = NEQ_DIRS.map(d => d[3]);
const NEQ_ACC = new Float64Array(9);

// f_i^neq = f_i - f_i^eq(ρ, u), added into acc. Eq. 3 for the equilibrium.
function addNeq(cell, acc) {
	const ux = cell.ux, uy = cell.uy, rho = cell.rho;
	const ux3 = 3 * ux, uy3 = 3 * uy;
	const ux2 = ux * ux, uy2 = uy * uy;
	const uxuy2 = 2 * ux * uy;
	const u2 = ux2 + uy2;
	const u215 = 1.5 * u2;
	const r1 = one9th * rho;
	const r36 = one36th * rho;
	acc[0] += cell.f0  - four9ths * rho * (1 - u215);
	acc[1] += cell.fE  - r1 * (1 + ux3 + 4.5 * ux2 - u215);
	acc[2] += cell.fW  - r1 * (1 - ux3 + 4.5 * ux2 - u215);
	acc[3] += cell.fN  - r1 * (1 + uy3 + 4.5 * uy2 - u215);
	acc[4] += cell.fS  - r1 * (1 - uy3 + 4.5 * uy2 - u215);
	acc[5] += cell.fNE - r36 * (1 + ux3 + uy3 + 4.5 * (u2 + uxuy2) - u215);
	acc[6] += cell.fNW - r36 * (1 - ux3 + uy3 + 4.5 * (u2 - uxuy2) - u215);
	acc[7] += cell.fSE - r36 * (1 + ux3 - uy3 + 4.5 * (u2 - uxuy2) - u215);
	acc[8] += cell.fSW - r36 * (1 - ux3 - uy3 + 4.5 * (u2 + uxuy2) - u215);
}

// Exact difference method (Kupershtokh): Δf_i = f_i^eq(ρ, u+Δu) − f_i^eq(ρ, u).
// Adds momentum (fx, fy) = ρ Δu and leaves f_neq untouched. setEquil would replace
// the populations and stack a new equilibrium on top of the old velocity.
function addMomentum(cell, fx, fy) {
	if (!cell || !Number.isFinite(fx) || !Number.isFinite(fy)) return;
	const rho = cell.rho;
	// Eq. 5. A collapsed or non-finite density used to publish NaN macros.
	if (!(rho > 1e-6) || !Number.isFinite(rho)) return;
	if (!Number.isFinite(cell.ux) || !Number.isFinite(cell.uy)) return;
	if (fx === 0 && fy === 0) return;
	const ux = cell.ux, uy = cell.uy;
	const nux = ux + fx / rho, nuy = uy + fy / rho;
	if (!Number.isFinite(nux) || !Number.isFinite(nuy)) return;
	const a = computeEquil(ux, uy, rho);
	const b = computeEquil(nux, nuy, rho);
	cell.f0  += b.f0  - a.f0;
	cell.fN  += b.fN  - a.fN;
	cell.fS  += b.fS  - a.fS;
	cell.fE  += b.fE  - a.fE;
	cell.fW  += b.fW  - a.fW;
	cell.fNE += b.fNE - a.fNE;
	cell.fNW += b.fNW - a.fNW;
	cell.fSE += b.fSE - a.fSE;
	cell.fSW += b.fSW - a.fSW;
	cell.ux = nux;
	cell.uy = nuy;
}

// Parent nodes sit on odd fine indices (1, 3, 5, …). Snapping the sail sample onto
// that node is what makes the impulse survive restriction: ρ and u are copied from
// the coincident node only, so a kick on a halfway fine node is stripped.
function snapToNode(i, n) {
	// Last interior coincident node is n-3 (n-1 is the ghost, n-2 is the halfway node).
	let s = (i & 1) ? i : i - 1;
	if (s < 1) s = 1;
	const maxNode = n - 3;
	if (s > maxNode) s = maxNode;
	return s;
}

// Remove Σ f_neq and Σ ξ f_neq. w_i and w_i * 3 ξ_i are the D2Q9 mass/momentum modes.
function stripNeqAcc(acc) {
	let dm = 0, jx = 0, jy = 0;
	for (let i = 0; i < 9; i++) {
		dm += acc[i];
		jx += NEQ_CX[i] * acc[i];
		jy += NEQ_CY[i] * acc[i];
	}
	for (let i = 0; i < 9; i++) {
		acc[i] -= NEQ_W[i] * (dm + 3 * (NEQ_CX[i] * jx + NEQ_CY[i] * jy));
	}
}

// Overlap roles for fine nodes. Edge and corner are the mask-boundary ghosts
// the existing 1D / 2D cubic writes; fluid nodes are the ones the fine step advances.
const ROLE_FLUID = 1;
const ROLE_EDGE = 2;
const ROLE_CORNER = 3;

function masksEqual(a, b) {
	if (!a || !b || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

// Rasterize a disk on the parent lattice and close diagonal-only contacts.
// A 2×2 that is only a checkerboard has no shared edge, so the 1D cubic
// (Eq. 38/39) would have nothing to run along. Promoting the empty cell
// closer to the disk center removes that contact. Cells `allow` rejects
// stay empty, so a nested disk cannot grow outside its parent mask.
function buildClosedDiskMask(cx0, cy0, cx1, cy1, centerX, centerY, radius, allow) {
	const cw = cx1 - cx0;
	const ch = cy1 - cy0;
	const mask = new Uint8Array(cw * ch);
	const r2 = radius * radius;
	for (let ly = 0; ly < ch; ly++) {
		for (let lx = 0; lx < cw; lx++) {
			const cx = cx0 + lx;
			const cy = cy0 + ly;
			if (allow && !allow(cx, cy)) continue;
			const dx = cx + 0.5 - centerX;
			const dy = cy + 0.5 - centerY;
			if (dx * dx + dy * dy <= r2) mask[lx + ly * cw] = 1;
		}
	}
	const at = (x, y) => (x >= 0 && y >= 0 && x < cw && y < ch) ? mask[x + y * cw] : 0;
	let guard = cw * ch + 1;
	while (guard-- > 0) {
		let changed = false;
		for (let y = 0; y < ch - 1; y++) {
			for (let x = 0; x < cw - 1; x++) {
				const a = at(x, y), b = at(x + 1, y), c = at(x, y + 1), d = at(x + 1, y + 1);
				let holes = null;
				if (a && d && !b && !c) holes = [[x + 1, y], [x, y + 1]];
				else if (b && c && !a && !d) holes = [[x, y], [x + 1, y + 1]];
				if (!holes) continue;
				let best = null, bestD = Infinity;
				for (let h = 0; h < holes.length; h++) {
					const hx = holes[h][0], hy = holes[h][1];
					const cx = cx0 + hx, cy = cy0 + hy;
					if (allow && !allow(cx, cy)) continue;
					const ddx = cx + 0.5 - centerX;
					const ddy = cy + 0.5 - centerY;
					const dist = ddx * ddx + ddy * ddy;
					if (dist < bestD) { bestD = dist; best = holes[h]; }
				}
				if (!best) continue;
				mask[best[0] + best[1] * cw] = 1;
				changed = true;
			}
		}
		if (!changed) break;
	}
	return mask;
}


// Multi-domain AMR (Lagrava §3.5): a flat rectangular fine grid at 2× parent resolution.
// cx0, cy0, cx1, cy1 are corners in the PARENT grid's cell coordinates (exclusive on cx1/cy1).
// The rectangle is the reusable allocation. setDisk() turns on a per-cell mask so the
// refined region is a circle on that lattice; null mask keeps the whole rectangle.
// parent may be a Boltzmann instance (level-1 domain) or another RefinementDomain (level N+1).
// Each domain runs 2 fine sub-steps per 1 parent sub-step with its own omega_f (Eq. 24).
// Coarse↔fine coupling: Eq. 29 (parent→fine, non-eq rescaling) and Eq. 30
// (fine→parent). Eq. 33 filters f_neq only, on a centered fine-grid stencil;
// ρ and u are taken from the coincident fine node and are not filtered.
// With a mask, that coupling runs on the staircase boundary (edge ghosts use the
// 1D cubic, corner ghosts the separable 2D cubic) instead of only the rectangle ring.
// Temporal interpolation (Section 3.5): sub-step 1 uses the t-state ghost boundary
// (saved before the parent step); sub-step 2 rebuilds f from ρ, u and f_neq
// interpolated between t and t+1.
//
// Overlap rule (two boats): the refined region is the union of the masks. Where
// disks overlap, the finest level writes the parent node and is the sampler /
// forcer. Same level: the later domain in `domains` wins, so there is one writer.
class RefinementDomain {

	constructor(parent, cx0, cy0, cx1, cy1) {
		this.parent = parent;
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

		// mask === null: every cell of the rectangle is refined (steps 1–5).
		// setDisk() installs the per-cell disk inside this same allocation.
		this.mask = null;
		this.disk = null;
		this._role = null;
		this.fluidCells = this._allInteriorCells;
		this._ghostLoc = [];

		// Energy injections from apply_energy(), re-applied before each fine sub-step.
		this.pendingInjections = [];

		// Ghost ring + fluid set. With no mask the ghosts are the rectangular border.
		this._classifyNodes();
	}

	// Section 3.5 (Lagrava): coarse→fine injection, 2 fine sub-steps, fine→coarse averaging.
	// Eq. 29 rescaling applied on injection; Eq. 30/33 applied on averaging.
	// Temporal interpolation: sub-step 1 uses the t-state saved in ghostSnapshot;
	// sub-step 2 uses the t+½ interpolation (0.5*t + 0.5*(t+1)).
	step(parent) {
		// Sub-step 1: restore t-state ghost boundary, inject energy, run.
		// Inject before the step so the perturbation is present when collide runs.
		// fluidCells is every node inside the mask (the whole rectangle when no
		// disk is set), including nodes a child will overwrite. Colliding them
		// lets a neighbour pull post-collision populations; averageToCoarse
		// then replaces the masked parent nodes.
		for (const inj of this.pendingInjections) {
			this._applyForceFineCell(inj.fi, inj.fj, inj.fx, inj.fy);
		}
		this._restoreGhostFromSnapshot();
		collideAndStream(this.fluidCells, this.omega_f);

		// Run child domains for this sub-interval (this domain is now at t+½)
		for (const child of this.domains) {
			child.saveCoarseBoundary(this);
			child.step(this);
		}

		// Sub-step 2: inject t+1 parent state, interpolate ρ, u, f_neq to t+½, run.
		// Re-inject so the boat wake persists through the second sub-step (§3.5).
		// pendingInjections is NOT cleared here — Boltzmann.physics_model_step clears it
		// after all domain steps, so recursive child calls also see the injections.
		this.injectFromCoarse(parent);
		this._interpolateGhostCells(0.5); // t+½ from ρ, u, f_neq at t and t+1
		for (const inj of this.pendingInjections) {
			this._applyForceFineCell(inj.fi, inj.fj, inj.fx, inj.fy);
		}
		collideAndStream(this.fluidCells, this.omega_f);

		// Run child domains for this sub-interval (this domain is now at t+1)
		for (const child of this.domains) {
			child.saveCoarseBoundary(this);
			child.step(this);
		}

		// Ghosts were left at t+½. The restriction stencil reads them, so rebuild
		// the pure t+1 boundary first (Lagrava §3.5 step 3, then step 4).
		this.injectFromCoarse(parent);
		this.averageToCoarse(parent);
	}

	// Section 3.5 (Lagrava): capture t-state ghost boundary BEFORE the parent step runs.
	// Injects from parent into ghost cells (Eq. 29) and snapshots the resulting populations.
	// Must be called before the parent's collideAndStream for correct temporal interpolation.
	saveCoarseBoundary(parent) {
		this.injectFromCoarse(parent);
		for (let k = 0; k < this.ghostCells.length; k++) {
			const g    = this.ghostCells[k];
			const base = k * 12;
			this.ghostSnapshot[base+0] = g.f0;
			this.ghostSnapshot[base+1] = g.fN;
			this.ghostSnapshot[base+2] = g.fS;
			this.ghostSnapshot[base+3] = g.fE;
			this.ghostSnapshot[base+4] = g.fW;
			this.ghostSnapshot[base+5] = g.fNE;
			this.ghostSnapshot[base+6] = g.fNW;
			this.ghostSnapshot[base+7] = g.fSE;
			this.ghostSnapshot[base+8] = g.fSW;
			this.ghostSnapshot[base+9]  = g.rho;
			this.ghostSnapshot[base+10] = g.ux;
			this.ghostSnapshot[base+11] = g.uy;
		}
	}

	// Restore ghost cells to the t-state populations saved by saveCoarseBoundary.
	// Used before sub-step 1 so the fine grid sees the t-state boundary.
	_restoreGhostFromSnapshot() {
		for (let k = 0; k < this.ghostCells.length; k++) {
			const g    = this.ghostCells[k];
			const base = k * 12;
			g.f0  = this.ghostSnapshot[base+0];
			g.fN  = this.ghostSnapshot[base+1];
			g.fS  = this.ghostSnapshot[base+2];
			g.fE  = this.ghostSnapshot[base+3];
			g.fW  = this.ghostSnapshot[base+4];
			g.fNE = this.ghostSnapshot[base+5];
			g.fNW = this.ghostSnapshot[base+6];
			g.fSE = this.ghostSnapshot[base+7];
			g.fSW = this.ghostSnapshot[base+8];
			g.rho = this.ghostSnapshot[base+9];
			g.ux  = this.ghostSnapshot[base+10];
			g.uy  = this.ghostSnapshot[base+11];
		}
	}

	// Section 3.5: linear interpolation of ρ, u and f_neq, then rebuild f.
	// Blending the populations directly is not the same, because f_eq is quadratic in u.
	// alpha=0 → pure t-state, alpha=0.5 → t+½. Current ghost populations are the t+1 state.
	_interpolateGhostCells(alpha) {
		const beta = 1 - alpha;
		for (let k = 0; k < this.ghostCells.length; k++) {
			const g    = this.ghostCells[k];
			const base = k * 12;
			const rhoT = this.ghostSnapshot[base+9];
			const uxT  = this.ghostSnapshot[base+10];
			const uyT  = this.ghostSnapshot[base+11];
			const feqT = computeEquil(uxT, uyT, rhoT);
			const feq1 = computeEquil(g.ux, g.uy, g.rho);
			const rho = beta * rhoT + alpha * g.rho;
			const ux  = beta * uxT  + alpha * g.ux;
			const uy  = beta * uyT  + alpha * g.uy;
			const feq = computeEquil(ux, uy, rho);
			for (let p = 0; p < POP_KEYS.length; p++) {
				const key = POP_KEYS[p];
				const fneq = beta * (this.ghostSnapshot[base+p] - feqT[key]) + alpha * (g[key] - feq1[key]);
				g[key] = feq[key] + fneq;
			}
			g.rho = rho;
			g.ux  = ux;
			g.uy  = uy;
		}
	}

	// Coarse→fine: fill ghost border cells using cubic spatial interpolation (Eq. 38/39)
	// of coarse populations and macroscopic fields. Ghost cell (fi, fj) maps to coarse coord
	// cx = cx0 + (fi-1)*0.5, cy = cy0 + (fj-1)*0.5. Cells at half-integer positions use
	// Eq. 38 (centered 4-point) or Eq. 39 (one-sided 3-point) along each axis.
	injectFromCoarse(parent) {
		const locs = this._ghostLoc;
		for (let k = 0; k < locs.length; k++) {
			this._injectGhostCell(parent, locs[k].fi, locs[k].fj);
		}
	}

	_injectGhostCell(parent, fi, fj) {
		const cx = this.cx0 + (fi - 1) * 0.5;
		const cy = this.cy0 + (fj - 1) * 0.5;

		const icx = Math.floor(cx);
		const icy = Math.floor(cy);

		const W = parent.width;
		const H = parent.height;
		// A NaN index makes every comparison false, so an unclamped read is
		// cells[NaN] and the interpolant throws on .ux. Missing cells (and
		// non-finite indexes) fall back to rest equilibrium.
		const get = (x, y) => {
			if (!Number.isFinite(x) || !Number.isFinite(y) || !(W > 0) || !(H > 0)) return ZERO_CELL;
			const ix = Math.max(0, Math.min(W - 1, x));
			const iy = Math.max(0, Math.min(H - 1, y));
			if (!Number.isFinite(ix) || !Number.isFinite(iy)) return ZERO_CELL;
			return parent.cells[ix + iy * W] || ZERO_CELL;
		};

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
			// Eq. 39: left-biased. The expression must stay on the return line;
			// a newline after return is a semicolon and yields undefined.
			return (3/8)*fn(get(ix+1,iy)) + (3/4)*fn(get(ix,iy)) - (1/8)*fn(get(ix-1,iy));
		};
		const interpY = (fn, ix, iy) => {
			if (iy - 1 >= 0 && iy + 2 <= H - 1) // Eq. 38: centered
				return (9/16)*(fn(get(ix,iy)) + fn(get(ix,iy+1))) - (1/16)*(fn(get(ix,iy-1)) + fn(get(ix,iy+2)));
			if (iy - 1 < 0)                      // Eq. 39: right-biased
				return (3/8)*fn(get(ix,iy)) + (3/4)*fn(get(ix,iy+1)) - (1/8)*fn(get(ix,iy+2));
			// Eq. 39: left-biased. Keep this on the return line (see interpX).
			return (3/8)*fn(get(ix,iy+1)) + (3/4)*fn(get(ix,iy)) - (1/8)*fn(get(ix,iy-1));
		};
		// Separable 2D: cubic in x for each needed y-row, then cubic in y over those results.
		const interpXY = (fn) => {
			const gX = (iy) => interpX(fn, icx, iy);
			if (icy - 1 >= 0 && icy + 2 <= H - 1) // Eq. 38: centered in y
				return (9/16)*(gX(icy) + gX(icy+1)) - (1/16)*(gX(icy-1) + gX(icy+2));
			if (icy - 1 < 0)                        // Eq. 39: right-biased in y
				return (3/8)*gX(icy) + (3/4)*gX(icy+1) - (1/8)*gX(icy+2);
			// Eq. 39: left-biased in y. Keep this on the return line (see interpX).
			return (3/8)*gX(icy+1) + (3/4)*gX(icy) - (1/8)*gX(icy-1);
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

		const ghost = this.cells[fi + fj * this.width];
		if (!ghost) return;
		if (!Number.isFinite(ux) || !Number.isFinite(uy) || !Number.isFinite(rho)
			|| !Number.isFinite(f0_c) || !Number.isFinite(fN_c) || !Number.isFinite(fS_c)
			|| !Number.isFinite(fE_c) || !Number.isFinite(fW_c)
			|| !Number.isFinite(fNE_c) || !Number.isFinite(fNW_c)
			|| !Number.isFinite(fSE_c) || !Number.isFinite(fSW_c)) {
			ghost.setEquil(0, 0, 1);
			return;
		}

		// Eq. 3: equilibrium at interpolated macroscopic fields
		const { f0: feq0, fN: feqN, fS: feqS, fE: feqE, fW: feqW,
		        fNE: feqNE, fNW: feqNW, fSE: feqSE, fSW: feqSW } = computeEquil(ux, uy, rho);

		// Eq. 29: f_{i,f} = f_i^eq + (ω_c / 2ω_f) * f_i^neq_c
		//         f_i^neq_c = f_{i,c} - f_i^eq(ρ_c, u_c)
		const scale = this.omega_c / (2 * this.omega_f);
		ghost.f0  = feq0  + scale * (f0_c  - feq0);
		ghost.fN  = feqN  + scale * (fN_c  - feqN);
		ghost.fS  = feqS  + scale * (fS_c  - feqS);
		ghost.fE  = feqE  + scale * (fE_c  - feqE);
		ghost.fW  = feqW  + scale * (fW_c  - feqW);
		ghost.fNE = feqNE + scale * (fNE_c - feqNE);
		ghost.fNW = feqNW + scale * (fNW_c - feqNW);
		ghost.fSE = feqSE + scale * (fSE_c - feqSE);
		ghost.fSW = feqSW + scale * (fSW_c - feqSW);
		// Moments of the written populations. For a coincident node with consistent
		// parent macros these equal the parent moments (f_neq has zero moments).
		ghost.recomputeMacros();
	}

	// Fine→coarse. ρ and u come from the coincident fine node (cell-vertex, unfiltered).
	// f_neq is averaged on the centered D2Q9 stencil (Eq. 33: one coarse cell wide)
	// and then rescaled (Eq. 30). Mass and momentum are stripped from the averaged
	// f_neq so the filter cannot shift ρ or u the way the old north-east 2×2 did.
	averageToCoarse(parent) {
		for (let cy = this.cy0; cy < this.cy1; cy++) {
			for (let cx = this.cx0; cx < this.cx1; cx++) {
				if (!this._maskAt(cx, cy)) continue;
				// Union of masks; finest level (else the later sibling) writes.
				if (!this._ownsWrite(cx, cy)) continue;
				this._restrictCell(parent, cx, cy);
			}
		}
	}

	_restrictCell(parent, cx, cy) {
		const fi0 = 1 + (cx - this.cx0) * 2;
		const fj0 = 1 + (cy - this.cy0) * 2;
		// Eq. 5. A missing coincident node, or one whose density has collapsed,
		// must not be written onto the parent: dividing by that rho is what
		// turns one bad fine cell into a NaN coarse cell.
		const center = latticeCell(this.cells, this.width, this.height, fi0, fj0);
		if (!center) return;
		const rho = center.rho;
		const ux  = center.ux;
		const uy  = center.uy;
		if (!(rho > 1e-6) || !Number.isFinite(rho)) return;
		if (!Number.isFinite(ux) || !Number.isFinite(uy)) return;
		const coarse = latticeCell(parent.cells, parent.width, parent.height, cx, cy);
		if (!coarse) return;

		// Eq. 33: average f_neq over the fine-grid D2Q9 neighbourhood (width = one coarse cell).
		const acc = NEQ_ACC;
		acc.fill(0);
		let n = 0;
		const w = this.width, h = this.height;
		for (let dj = -1; dj <= 1; dj++) {
			const fj = fj0 + dj;
			if (fj < 0 || fj >= h) continue;
			for (let di = -1; di <= 1; di++) {
				const fi = fi0 + di;
				const cell = latticeCell(this.cells, w, h, fi, fj);
				if (!cell || !(cell.rho > 1e-6) || !Number.isFinite(cell.rho)) continue;
				if (!Number.isFinite(cell.ux) || !Number.isFinite(cell.uy)) continue;
				addNeq(cell, acc);
				n++;
			}
		}
		if (n === 0) return;
		const inv = 1 / n;
		for (let i = 0; i < 9; i++) acc[i] *= inv;
		stripNeqAcc(acc);

		// Eq. 3 at the coincident node, Eq. 30: f_c = f_eq + (2 ω_f / ω_c) f_neq_filtered
		const ux3 = 3 * ux, uy3 = 3 * uy;
		const ux2 = ux * ux, uy2 = uy * uy;
		const uxuy2 = 2 * ux * uy;
		const u2 = ux2 + uy2;
		const u215 = 1.5 * u2;
		const r1 = one9th * rho;
		const r36 = one36th * rho;
		const scale = (2 * this.omega_f) / this.omega_c;
		coarse.f0  = four9ths * rho * (1 - u215)                       + scale * acc[0];
		coarse.fE  = r1 * (1 + ux3 + 4.5 * ux2 - u215)                 + scale * acc[1];
		coarse.fW  = r1 * (1 - ux3 + 4.5 * ux2 - u215)                 + scale * acc[2];
		coarse.fN  = r1 * (1 + uy3 + 4.5 * uy2 - u215)                 + scale * acc[3];
		coarse.fS  = r1 * (1 - uy3 + 4.5 * uy2 - u215)                 + scale * acc[4];
		coarse.fNE = r36 * (1 + ux3 + uy3 + 4.5 * (u2 + uxuy2) - u215) + scale * acc[5];
		coarse.fNW = r36 * (1 - ux3 + uy3 + 4.5 * (u2 - uxuy2) - u215) + scale * acc[6];
		coarse.fSE = r36 * (1 + ux3 - uy3 + 4.5 * (u2 - uxuy2) - u215) + scale * acc[7];
		coarse.fSW = r36 * (1 - ux3 - uy3 + 4.5 * (u2 + uxuy2) - u215) + scale * acc[8];
		// ρ and u are the coincident node's, unfiltered. f_neq was stripped of moments,
		// so these match the populations just written.
		coarse.rho = rho;
		coarse.ux = ux;
		coarse.uy = uy;
	}

	// Add a child refinement domain in this domain's cell coordinates.
	addDomain(cx0, cy0, cx1, cy1) {
		const box = normalizeDomainBox(cx0, cy0, cx1, cy1);
		if (!box) return;
		this.domains.push(new RefinementDomain(this, box.cx0, box.cy0, box.cx1, box.cy1));
		this._rebuildInteriorCells();
	}

	// Swap the child at `index` for a new window. Used when a boat is outside the
	// allocation: crawling one cell per frame would leave the old staircase behind.
	// A negative index used to write `domains[-1]` (`-1 < length`) and leave a hole.
	replaceDomain(index, cx0, cy0, cx1, cy1) {
		const box = normalizeDomainBox(cx0, cy0, cx1, cy1);
		if (!box || !Number.isInteger(index) || index < 0) return null;
		const domain = new RefinementDomain(this, box.cx0, box.cy0, box.cx1, box.cy1);
		if (index < this.domains.length) this.domains[index] = domain;
		else this.domains.push(domain);
		this._rebuildInteriorCells();
		return domain;
	}

	// Slide this window by (dcx, dcy) parent cells. Same allocation: fluid parcels stay
	// on the root grid, the window origin moves, and every child is carried along.
	// Refuses a step that would enter the parent's Dirichlet frame.
	shiftBy(parent, dcx, dcy) {
		dcx = Math.trunc(dcx);
		dcy = Math.trunc(dcy);
		if (!dcx && !dcy) return;
		if (this.cx0 + dcx < 1 || this.cy0 + dcy < 1) return;
		if (this.cx1 + dcx > parent.width - 1 || this.cy1 + dcy > parent.height - 1) return;

		const parentCell = (parent instanceof RefinementDomain) ? parent.dx : 1;
		const rootDx = dcx * parentCell;
		const rootDy = dcy * parentCell;

		// Finest first: a leaving coincident node is restricted before its storage slides away.
		for (const child of this.domains) child._restrictCascade(rootDx, rootDy);
		this._restrictLeaving(parent, rootDx, rootDy);
		this._slideAndRebuild(parent, rootDx, rootDy, true);
		for (const child of this.domains) child._slideCascade(rootDx, rootDy, false);
		this._rebuildInteriorCells();
	}

	_restrictCascade(rootDx, rootDy) {
		for (const child of this.domains) child._restrictCascade(rootDx, rootDy);
		this._restrictLeaving(this.parent, rootDx, rootDy);
	}

	// moveOrigin is true for the window that was asked to move. Carried children keep
	// their parent-index origin and only slide storage, so they follow the parent in world space.
	_slideCascade(rootDx, rootDy, moveOrigin) {
		this._slideAndRebuild(this.parent, rootDx, rootDy, moveOrigin);
		for (const child of this.domains) child._slideCascade(rootDx, rootDy, false);
		this._rebuildInteriorCells();
	}

	_indexDelta(rootD) {
		return Math.round(rootD / this.dx);
	}

	// A fine index is still a copy source when its destination index stays inside the array.
	_indexKept(i, delta, n) {
		const ni = i - delta;
		return ni >= 0 && ni < n;
	}

	_restrictLeaving(parent, rootDx, rootDy) {
		const di = this._indexDelta(rootDx);
		const dj = this._indexDelta(rootDy);
		for (let cy = this.cy0; cy < this.cy1; cy++) {
			for (let cx = this.cx0; cx < this.cx1; cx++) {
				if (!this._maskAt(cx, cy)) continue;
				const fi = 1 + (cx - this.cx0) * 2;
				const fj = 1 + (cy - this.cy0) * 2;
				if (this._indexKept(fi, di, this.width) && this._indexKept(fj, dj, this.height)) continue;
				if (!this._ownsWrite(cx, cy)) continue;
				this._restrictCell(parent, cx, cy);
			}
		}
	}

	_syncRootOrigin(parent) {
		if (parent instanceof RefinementDomain) {
			this.cx0_root = parent.cx0_root + (this.cx0 - 1) * parent.dx;
			this.cy0_root = parent.cy0_root + (this.cy0 - 1) * parent.dx;
		} else {
			this.cx0_root = this.cx0;
			this.cy0_root = this.cy0;
		}
	}

	_packCell(cell) {
		return {
			f0: cell.f0, fN: cell.fN, fS: cell.fS, fE: cell.fE, fW: cell.fW,
			fNE: cell.fNE, fNW: cell.fNW, fSE: cell.fSE, fSW: cell.fSW,
			rho: cell.rho, ux: cell.ux, uy: cell.uy, barrier: cell.barrier,
		};
	}

	_unpackCell(cell, src) {
		cell.f0  = src.f0;
		cell.fN  = src.fN;  cell.fS  = src.fS;
		cell.fE  = src.fE;  cell.fW  = src.fW;
		cell.fNE = src.fNE; cell.fNW = src.fNW;
		cell.fSE = src.fSE; cell.fSW = src.fSW;
		cell.rho = src.rho; cell.ux  = src.ux; cell.uy = src.uy;
		cell.barrier = src.barrier;
	}

	// Same overlap rule as the constructor: a fine cell is a barrier if any parent cell it overlaps is.
	_setBarrierFromParent(parent, fi, fj) {
		const cx = this.cx0 + (fi - 1) * 0.5;
		const cy = this.cy0 + (fj - 1) * 0.5;
		const bx0 = Math.max(0, Math.floor(cx));
		const by0 = Math.max(0, Math.floor(cy));
		const bx1 = Math.min(parent.width  - 1, Math.ceil(cx));
		const by1 = Math.min(parent.height - 1, Math.ceil(cy));
		let isBarrier = false;
		for (let by = by0; by <= by1 && !isBarrier; by++) {
			for (let bx = bx0; bx <= bx1; bx++) {
				const pcell = latticeCell(parent.cells, parent.width, parent.height, bx, by);
				if (pcell && pcell.barrier) isBarrier = true;
			}
		}
		this.cells[fi + fj * this.width].barrier = isBarrier;
	}

	// new[fi] = old[fi+di]: the parcel now under the shifted window. Cells with no source
	// are filled from the parent (Eq. 29). Pending sail impulses move with their cell.
	_slideAndRebuild(parent, rootDx, rootDy, moveOrigin) {
		const di = this._indexDelta(rootDx);
		const dj = this._indexDelta(rootDy);
		const snap = new Array(this.cells.length);
		for (let k = 0; k < this.cells.length; k++) snap[k] = this._packCell(this.cells[k]);

		if (moveOrigin) {
			const parentCell = (parent instanceof RefinementDomain) ? parent.dx : 1;
			const dcx = Math.round(rootDx / parentCell);
			const dcy = Math.round(rootDy / parentCell);
			this.cx0 += dcx; this.cy0 += dcy;
			this.cx1 += dcx; this.cy1 += dcy;
		}
		this._syncRootOrigin(parent);

		for (let fj = 0; fj < this.height; fj++) {
			for (let fi = 0; fi < this.width; fi++) {
				const si = fi + di;
				const sj = fj + dj;
				const dst = this.cells[fi + fj * this.width];
				if (si >= 0 && sj >= 0 && si < this.width && sj < this.height) {
					this._unpackCell(dst, snap[si + sj * this.width]);
				} else {
					this._injectGhostCell(parent, fi, fj);
					this._setBarrierFromParent(parent, fi, fj);
				}
			}
		}

		const kept = [];
		for (const inj of this.pendingInjections) {
			const fi = inj.fi - di;
			const fj = inj.fj - dj;
			if (fi >= 1 && fj >= 1 && fi < this.width - 1 && fj < this.height - 1) {
				kept.push({ fi, fj, fx: inj.fx, fy: inj.fy });
			}
		}
		this.pendingInjections = kept;
		// Mask bits follow the parcels. Barrier flags are re-read from the parent
		// so a slid window does not keep the flag of the cell it used to cover.
		this._slideMask(di, dj, moveOrigin);
		this._refreshBarriers(parent);
		this._classifyNodes();
		this._retargetInjections();
	}

	// Storage slides by (di, dj) fine nodes, which is (di/2, dj/2) parent cells.
	// next[local] = old[local + delta] keeps each mask bit on the same world cell.
	// The disk center is a parent coordinate: it is unchanged when this window's
	// own origin moves, and it follows the parent index change when a parent slide
	// carries this grid (moveOrigin false).
	_slideMask(di, dj, moveOrigin) {
		if (!this.mask) return;
		const dpx = Math.round(di / 2);
		const dpy = Math.round(dj / 2);
		if (!dpx && !dpy) return;
		const cw = this.cx1 - this.cx0;
		const ch = this.cy1 - this.cy0;
		const next = new Uint8Array(cw * ch);
		for (let ly = 0; ly < ch; ly++) {
			const oy = ly + dpy;
			if (oy < 0 || oy >= ch) continue;
			for (let lx = 0; lx < cw; lx++) {
				const ox = lx + dpx;
				if (ox < 0 || ox >= cw) continue;
				next[lx + ly * cw] = this.mask[ox + oy * cw];
			}
		}
		this.mask = next;
		if (this.disk && !moveOrigin) {
			this.disk.cx -= dpx;
			this.disk.cy -= dpy;
		}
	}

	_refreshBarriers(parent) {
		for (let fj = 0; fj < this.height; fj++) {
			for (let fi = 0; fi < this.width; fi++) {
				this._setBarrierFromParent(parent, fi, fj);
			}
		}
	}

	// Translate a child onto (cx0, cy0) one parent cell at a time. The rectangle size
	// stays what it was: a size change would reallocate and drop nested grids.
	// Non-finite or inverted corners are dropped before that size check.
	moveDomain(index, cx0, cy0, cx1, cy1) {
		const box = normalizeDomainBox(cx0, cy0, cx1, cy1);
		const d = this.domains[index];
		if (!box || !d) return;
		cx0 = box.cx0; cy0 = box.cy0; cx1 = box.cx1; cy1 = box.cy1;
		if ((cx1 - cx0) !== (d.cx1 - d.cx0) || (cy1 - cy0) !== (d.cy1 - d.cy0)) return;
		let guard = Math.abs(cx0 - d.cx0) + Math.abs(cy0 - d.cy0) + 2;
		while ((d.cx0 !== cx0 || d.cy0 !== cy0) && guard-- > 0) {
			const dcx = Math.sign(cx0 - d.cx0);
			const dcy = Math.sign(cy0 - d.cy0);
			const ox = d.cx0, oy = d.cy0;
			d.shiftBy(this, dcx, dcy);
			if (d.cx0 === ox && d.cy0 === oy) break;
		}
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
	// Nodes outside the disk are left to the parent paint, so the staircase shows.
	paintTexture(boltzmann, plot_type, contrast) {
		for (let fj = 1; fj < this.height - 1; fj++) {
			for (let fi = 1; fi < this.width - 1; fi++) {
				if (this._role && this._role[fi + fj * this.width] !== ROLE_FLUID) continue;
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

	// Parent-cell coordinate → root coarse coordinate, one axis at a time.
	// The two origins differ once a nested window is not square in world space
	// (level 1 at coarse (28, 9) puts level 2's cx0_root 19 cells above cy0_root).
	// Mapping Y through cx0_root drew that disk as a second ring off the boat.
	_rootX(c) {
		return this.cx0_root + (c - this.cx0) * (this.dx * 2);
	}

	_rootY(c) {
		return this.cy0_root + (c - this.cy0) * (this.dx * 2);
	}

	// Smooth circle of the disk, plus the dim staircase of mask edges.
	// No disk: the four rectangle segments, as before.
	worldBorderLines(boltzmann) {
		const toWorld = (cx, cy) => ({
			x: (cx - boltzmann.width  / 2) / boltzmann.resolution,
			y: (cy - boltzmann.height / 2) / boltzmann.resolution,
		});
		if (!this.disk) {
			const cx1_root = this.cx0_root + (this.width  - 2) * this.dx;
			const cy1_root = this.cy0_root + (this.height - 2) * this.dx;
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
		const segs = [];
		const n = 64;
		const ccx = this._rootX(this.disk.cx);
		const ccy = this._rootY(this.disk.cy);
		const rr = this.disk.radius * this.dx * 2;
		for (let i = 0; i < n; i++) {
			const a0 = (i / n) * Math.PI * 2;
			const a1 = ((i + 1) / n) * Math.PI * 2;
			const p0 = toWorld(ccx + Math.cos(a0) * rr, ccy + Math.sin(a0) * rr);
			const p1 = toWorld(ccx + Math.cos(a1) * rr, ccy + Math.sin(a1) * rr);
			segs.push({ x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y, dim: false });
		}
		if (this.mask) {
			const cw = this.cx1 - this.cx0;
			for (let ly = 0; ly < this.cy1 - this.cy0; ly++) {
				for (let lx = 0; lx < cw; lx++) {
					if (this.mask[lx + ly * cw] !== 1) continue;
					const cx = this.cx0 + lx;
					const cy = this.cy0 + ly;
					const x0 = this._rootX(cx);
					const y0 = this._rootY(cy);
					const x1 = this._rootX(cx + 1);
					const y1 = this._rootY(cy + 1);
					const edge = (xa, ya, xb, yb) => {
						const p = toWorld(xa, ya);
						const q = toWorld(xb, yb);
						segs.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, dim: true });
					};
					if (!this._maskAt(cx, cy + 1)) edge(x0, y1, x1, y1);
					if (!this._maskAt(cx, cy - 1)) edge(x0, y0, x1, y0);
					if (!this._maskAt(cx + 1, cy)) edge(x1, y0, x1, y1);
					if (!this._maskAt(cx - 1, cy)) edge(x0, y0, x0, y1);
				}
			}
		}
		return segs;
	}

	// True when the parent cell under (cx, cy) is refined. A null mask is the
	// whole rectangle. Continuous coordinates use the cell that owns them:
	// the half-open square [cx, cx+1) × [cy, cy+1).
	_maskAt(cx, cy) {
		if (cx < this.cx0 || cy < this.cy0 || cx >= this.cx1 || cy >= this.cy1) return false;
		if (!this.mask) return true;
		const cw = this.cx1 - this.cx0;
		return this.mask[(cx - this.cx0) + (cy - this.cy0) * cw] === 1;
	}

	// A level-2 cell is a fine index of its parent. It may be refined only
	// where that parent node sits inside the parent disk.
	_parentAllows(cx, cy) {
		const parent = this.parent;
		if (!(parent instanceof RefinementDomain) || !parent.mask) return true;
		const px = parent.cx0 + (cx - 1) * 0.5;
		const py = parent.cy0 + (cy - 1) * 0.5;
		if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
		return parent._maskAt(Math.floor(px), Math.floor(py));
	}

	// Install a disk centered at (centerX, centerY) with `radius` in parent cells.
	// The rectangle allocation does not change. Cells that leave the mask are
	// restricted once; cells that enter are filled from the parent (Eq. 29).
	setDisk(centerX, centerY, radius) {
		if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !(radius > 0)) return;
		const next = buildClosedDiskMask(
			this.cx0, this.cy0, this.cx1, this.cy1,
			centerX, centerY, radius,
			(cx, cy) => this._parentAllows(cx, cy),
		);
		this.disk = { cx: centerX, cy: centerY, radius };
		if (this.mask && masksEqual(this.mask, next)) return;

		const cw = this.cx1 - this.cx0;
		const parent = this.parent;
		const entered = [];
		for (let cy = this.cy0; cy < this.cy1; cy++) {
			for (let cx = this.cx0; cx < this.cx1; cx++) {
				const on = next[(cx - this.cx0) + (cy - this.cy0) * cw] === 1;
				const wasOn = this._maskAt(cx, cy);
				if (wasOn && !on && this._ownsWrite(cx, cy)) this._restrictCell(parent, cx, cy);
				else if (!wasOn && on) entered.push({ cx, cy });
			}
		}
		this.mask = next;
		for (let i = 0; i < entered.length; i++) {
			this._injectCoarseCell(parent, entered[i].cx, entered[i].cy);
		}
		this._classifyNodes();
		this._retargetInjections();
	}

	_injectCoarseCell(parent, cx, cy) {
		const fi0 = 1 + (cx - this.cx0) * 2;
		const fj0 = 1 + (cy - this.cy0) * 2;
		for (let dj = 0; dj <= 1; dj++) {
			for (let di = 0; di <= 1; di++) {
				const fi = fi0 + di;
				const fj = fj0 + dj;
				if (fi >= 0 && fj >= 0 && fi < this.width && fj < this.height) {
					this._injectGhostCell(parent, fi, fj);
				}
			}
		}
	}

	// Fluid nodes lie in a masked cell's square [cx, cx+1) × [cy, cy+1).
	// Every other node that streams into one of those is a ghost: edge (1D cubic
	// or a coincident copy) or corner (both axes half-integer, separable 2D cubic).
	// A null mask reproduces the old interior set and the rectangular ghost ring.
	_classifyNodes() {
		const w = this.width;
		const h = this.height;
		const role = new Uint8Array(w * h);
		const fluidAt = (fi, fj) => {
			const px = this.cx0 + (fi - 1) * 0.5;
			const py = this.cy0 + (fj - 1) * 0.5;
			return this._maskAt(Math.floor(px), Math.floor(py));
		};
		for (let fj = 0; fj < h; fj++) {
			for (let fi = 0; fi < w; fi++) {
				if (fluidAt(fi, fj)) role[fi + fj * w] = ROLE_FLUID;
			}
		}
		const fluid = [];
		const ghosts = [];
		const locs = [];
		for (let fj = 0; fj < h; fj++) {
			for (let fi = 0; fi < w; fi++) {
				const k = fi + fj * w;
				if (role[k] === ROLE_FLUID) {
					fluid.push(this.cells[k]);
					continue;
				}
				let touch = false;
				for (let dj = -1; dj <= 1 && !touch; dj++) {
					for (let di = -1; di <= 1; di++) {
						if (!di && !dj) continue;
						const ni = fi + di;
						const nj = fj + dj;
						if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
						if (role[ni + nj * w] === ROLE_FLUID) { touch = true; break; }
					}
				}
				if (!touch) continue;
				const halfX = (fi % 2 === 0);
				const halfY = (fj % 2 === 0);
				role[k] = (halfX && halfY) ? ROLE_CORNER : ROLE_EDGE;
				ghosts.push(this.cells[k]);
				locs.push({ fi, fj });
			}
		}
		this._role = role;
		this.fluidCells = fluid;
		this.ghostCells = ghosts;
		this._ghostLoc = locs;
		// Snapshot buffer per ghost: 9 populations + rho, ux, uy.
		// Sub-step 1 restores t; sub-step 2 interpolates ρ, u and f_neq (§3.5).
		this.ghostSnapshot = new Float64Array(ghosts.length * 12);
	}

	_isFluid(fi, fj) {
		if (fi < 0 || fj < 0 || fi >= this.width || fj >= this.height || !this._role) return false;
		return this._role[fi + fj * this.width] === ROLE_FLUID;
	}

	_nearestFluidCoincident(fi, fj) {
		let best = null;
		let bestD = Infinity;
		const w = this.width;
		for (let j = 1; j < this.height - 1; j += 2) {
			for (let i = 1; i < w - 1; i += 2) {
				if (this._role[i + j * w] !== ROLE_FLUID) continue;
				const d = (i - fi) * (i - fi) + (j - fj) * (j - fj);
				if (d < bestD) { bestD = d; best = { fi: i, fj: j }; }
			}
		}
		return best;
	}

	_retargetInjections() {
		if (!this.pendingInjections.length) return;
		const kept = [];
		for (const inj of this.pendingInjections) {
			let fi = inj.fi;
			let fj = inj.fj;
			if (!this._isFluid(fi, fj)) {
				const alt = this._nearestFluidCoincident(fi, fj);
				if (!alt) continue;
				fi = alt.fi;
				fj = alt.fj;
			}
			kept.push({ fi, fj, fx: inj.fx, fy: inj.fy });
		}
		this.pendingInjections = kept;
	}

	// 0 outside the mask, 1 on this disk only, higher when a nested disk covers it.
	levelAt(cx, cy) {
		if (!this.containsCoarse(cx, cy)) return 0;
		const fi = 1 + (cx - this.cx0) * 2;
		const fj = 1 + (cy - this.cy0) * 2;
		let level = 1;
		for (const child of this.domains) {
			const cl = child.levelAt(fi, fj);
			if (cl > 0 && cl + 1 > level) level = cl + 1;
		}
		return level;
	}

	// Finest overlapping disk writes. Same level: the later sibling writes.
	_ownsWrite(cx, cy) {
		const siblings = this.parent && this.parent.domains;
		if (!siblings) return true;
		const mine = this.levelAt(cx, cy);
		if (mine <= 0) return false;
		const idx = siblings.indexOf(this);
		for (let i = 0; i < siblings.length; i++) {
			if (i === idx) continue;
			const other = siblings[i].levelAt(cx, cy);
			if (other > mine || (other === mine && i > idx)) return false;
		}
		return true;
	}

	// True when some 2×2 in the mask touches only on a diagonal.
	hasDiagonalOnlyContact() {
		if (!this.mask) return false;
		const cw = this.cx1 - this.cx0;
		const ch = this.cy1 - this.cy0;
		for (let y = 0; y < ch - 1; y++) {
			for (let x = 0; x < cw - 1; x++) {
				const a = this.mask[x + y * cw];
				const b = this.mask[x + 1 + y * cw];
				const c = this.mask[x + (y + 1) * cw];
				const d = this.mask[x + 1 + (y + 1) * cw];
				if ((a && d && !b && !c) || (b && c && !a && !d)) return true;
			}
		}
		return false;
	}

	overlapCounts() {
		let fluid = 0, edge = 0, corner = 0;
		const role = this._role;
		if (!role) return { fluid, edge, corner };
		for (let i = 0; i < role.length; i++) {
			if (role[i] === ROLE_FLUID) fluid++;
			else if (role[i] === ROLE_EDGE) edge++;
			else if (role[i] === ROLE_CORNER) corner++;
		}
		return { fluid, edge, corner };
	}

	maskCount() {
		if (!this.mask) return (this.cx1 - this.cx0) * (this.cy1 - this.cy0);
		let n = 0;
		for (let i = 0; i < this.mask.length; i++) if (this.mask[i]) n++;
		return n;
	}

	// Returns true when a continuous parent coordinate falls inside the mask.
	containsCoarse(cx_cont, cy_cont) {
		if (!Number.isFinite(cx_cont) || !Number.isFinite(cy_cont)) return false;
		if (cx_cont < this.cx0 || cy_cont < this.cy0 || cx_cont >= this.cx1 || cy_cont >= this.cy1) return false;
		return this._maskAt(Math.floor(cx_cont), Math.floor(cy_cont));
	}

	// Bilinear interpolation of fine-grid velocity at a coordinate in the PARENT's cell space.
	// Delegates to the finest child disk that contains the point.
	getVelocityAt(cx_cont, cy_cont) {
		if (!Number.isFinite(cx_cont) || !Number.isFinite(cy_cont) ||
		    !Number.isFinite(this.cx0) || !Number.isFinite(this.cy0)) {
			return { x: 0, y: 0 };
		}
		const fi_f = 1 + (cx_cont - this.cx0) * 2;
		const fj_f = 1 + (cy_cont - this.cy0) * 2;
		if (!Number.isFinite(fi_f) || !Number.isFinite(fj_f)) return { x: 0, y: 0 };
		const child = this._finestChild(fi_f, fj_f);
		if (child) return child.getVelocityAt(fi_f, fj_f);
		const fi0 = Math.max(1, Math.min(this.width  - 2, Math.floor(fi_f)));
		const fj0 = Math.max(1, Math.min(this.height - 2, Math.floor(fj_f)));
		const fi1 = Math.min(this.width  - 2, fi0 + 1);
		const fj1 = Math.min(this.height - 2, fj0 + 1);
		const hf = fi_f - fi0;
		const vf = fj_f - fj0;
		const c00 = latticeCell(this.cells, this.width, this.height, fi0, fj0);
		const c10 = latticeCell(this.cells, this.width, this.height, fi1, fj0);
		const c01 = latticeCell(this.cells, this.width, this.height, fi0, fj1);
		const c11 = latticeCell(this.cells, this.width, this.height, fi1, fj1);
		if (!c00 || !c10 || !c01 || !c11) return { x: 0, y: 0 };
		const vx = c00.ux*(1-hf)*(1-vf) + c10.ux*hf*(1-vf) + c01.ux*(1-hf)*vf + c11.ux*hf*vf;
		const vy = c00.uy*(1-hf)*(1-vf) + c10.uy*hf*(1-vf) + c01.uy*(1-hf)*vf + c11.uy*hf*vf;
		if (!Number.isFinite(vx) || !Number.isFinite(vy)) return { x: 0, y: 0 };
		return { x: vx / 4, y: vy / 4 };
	}

	_finestChild(cx, cy) {
		let best = null;
		let bestLevel = 0;
		for (const child of this.domains) {
			const level = child.levelAt(cx, cy);
			if (level > 0 && level >= bestLevel) { best = child; bestLevel = level; }
		}
		return best;
	}

	// Apply an energy impulse at a coordinate in the PARENT's cell space.
	// Delegates to the finest child disk that contains the point.
	// The impulse is stored and added once per fine substep (exact difference),
	// on the coincident node restriction will copy. It is not applied here:
	// an immediate setEquil stacked on top of the per-substep kicks (5× on a
	// nested grid) and wiped f_neq.
	applyEnergyAt(cx_cont, cy_cont, fx, fy) {
		if (!Number.isFinite(cx_cont) || !Number.isFinite(cy_cont)) return;
		if (!Number.isFinite(fx) || !Number.isFinite(fy)) return;
		const fi_f = 1 + (cx_cont - this.cx0) * 2;
		const fj_f = 1 + (cy_cont - this.cy0) * 2;
		const child = this._finestChild(fi_f, fj_f);
		if (child) { child.applyEnergyAt(fi_f, fj_f, fx, fy); return; }
		let fi = snapToNode(Math.max(1, Math.min(this.width  - 2, Math.round(fi_f))), this.width);
		let fj = snapToNode(Math.max(1, Math.min(this.height - 2, Math.round(fj_f))), this.height);
		if (!this._isFluid(fi, fj)) {
			const alt = this._nearestFluidCoincident(fi, fj);
			if (!alt) return;
			fi = alt.fi;
			fj = alt.fj;
		}
		this.pendingInjections.push({ fi, fj, fx, fy });
	}

	// Once per fine substep. (fx, fy) is the momentum of this sample. Dividing by
	// the cell area dx² is the velocity kick the speed and curl plots show, on the
	// coincident node restriction copies. A level-2 root step has four substeps,
	// so the parent receives about four times the sample (fy = 0.05 → coarse
	// Σ ρΔuy ≈ 0.22) instead of the ~0.017 left when the kick sat on a halfway
	// node and the moment strip threw it away. The kick is streamed, so it does
	// not pile up on one cell the way setEquil did.
	_applyForceFineCell(fi, fj, fx, fy) {
		const cell = latticeCell(this.cells, this.width, this.height, fi, fj);
		if (!cell) return;
		const s = 1 / (this.dx * this.dx);
		addMomentum(cell, fx * s, fy * s);
	}

}


// Outer staircase of the union of masks at one refinement depth.
// Overlapping boats share cells, so the edge between them is dropped and one
// outline remains. Boats that do not touch keep a separate island each.
// Cells are keyed in root-grid units of this level's parent span (dx*2:
// 1 on level 1, 1/2 on level 2) so two windows agree on the same coarse cell.
export function unionMaskBorderLines(domains, boltzmann) {
	const toWorld = (cx, cy) => ({
		x: (cx - boltzmann.width  / 2) / boltzmann.resolution,
		y: (cy - boltzmann.height / 2) / boltzmann.resolution,
	});
	const groups = new Map();
	for (const domain of domains) {
		if (!domain) continue;
		const span = domain.dx * 2;
		if (!(span > 0)) continue;
		const bucket = span.toFixed(6);
		if (!groups.has(bucket)) groups.set(bucket, []);
		groups.get(bucket).push(domain);
	}
	const segs = [];
	for (const group of groups.values()) {
		const occupied = new Map();
		for (const domain of group) {
			const span = domain.dx * 2;
			const visit = (cx, cy) => {
				const rx = Math.round(domain._rootX(cx) / span);
				const ry = Math.round(domain._rootY(cy) / span);
				const key = rx + ',' + ry;
				if (occupied.has(key)) return;
				occupied.set(key, {
					rx, ry,
					x0: domain._rootX(cx),
					y0: domain._rootY(cy),
					x1: domain._rootX(cx + 1),
					y1: domain._rootY(cy + 1),
				});
			};
			if (!domain.mask) {
				for (let cy = domain.cy0; cy < domain.cy1; cy++) {
					for (let cx = domain.cx0; cx < domain.cx1; cx++) visit(cx, cy);
				}
			} else {
				const cw = domain.cx1 - domain.cx0;
				for (let ly = 0; ly < domain.cy1 - domain.cy0; ly++) {
					for (let lx = 0; lx < cw; lx++) {
						if (domain.mask[lx + ly * cw] !== 1) continue;
						visit(domain.cx0 + lx, domain.cy0 + ly);
					}
				}
			}
		}
		const edge = (xa, ya, xb, yb) => {
			const p = toWorld(xa, ya);
			const q = toWorld(xb, yb);
			segs.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, dim: true });
		};
		for (const cell of occupied.values()) {
			if (!occupied.has((cell.rx) + ',' + (cell.ry + 1))) edge(cell.x0, cell.y1, cell.x1, cell.y1);
			if (!occupied.has((cell.rx) + ',' + (cell.ry - 1))) edge(cell.x0, cell.y0, cell.x1, cell.y0);
			if (!occupied.has((cell.rx + 1) + ',' + cell.ry)) edge(cell.x1, cell.y0, cell.x1, cell.y1);
			if (!occupied.has((cell.rx - 1) + ',' + cell.ry)) edge(cell.x0, cell.y0, cell.x0, cell.y1);
		}
	}
	return segs;
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
	// Covered coarse nodes stay in _allInteriorCells so the pull stream reads
	// post-collision populations; averageToCoarse overwrites them afterward.
	addDomain(cx0, cy0, cx1, cy1) {
		const box = normalizeDomainBox(cx0, cy0, cx1, cy1);
		if (!box) return;
		this.domains.push(new RefinementDomain(this, box.cx0, box.cy0, box.cx1, box.cy1));
		this._rebuildInteriorCells();
	}

	// Replace domain `index`, or append if it does not exist yet. A boat that has
	// left the window uses this once; sliding the old disk across the map leaves
	// its outline behind. Index -1 is refused so it cannot land on `domains[-1]`.
	replaceDomain(index, cx0, cy0, cx1, cy1) {
		const box = normalizeDomainBox(cx0, cy0, cx1, cy1);
		if (!box || !Number.isInteger(index) || index < 0) return null;
		const domain = new RefinementDomain(this, box.cx0, box.cy0, box.cx1, box.cy1);
		if (index < this.domains.length) this.domains[index] = domain;
		else this.domains.push(domain);
		this._rebuildInteriorCells();
		return domain;
	}

	// Slide domain `index` by (dcx, dcy) coarse cells. In place: level-2 children are carried.
	shiftDomain(index, dcx, dcy) {
		const d = this.domains[index];
		if (!d) return;
		d.shiftBy(this, dcx, dcy);
		this._rebuildInteriorCells();
	}

	// Translate a domain onto (cx0, cy0) one coarse cell at a time, keeping its size.
	// A different width or height is ignored so a nested grid is never dropped.
	moveDomain(index, cx0, cy0, cx1, cy1) {
		const box = normalizeDomainBox(cx0, cy0, cx1, cy1);
		const d = this.domains[index];
		if (!box || !d) return;
		cx0 = box.cx0; cy0 = box.cy0; cx1 = box.cx1; cy1 = box.cy1;
		if ((cx1 - cx0) !== (d.cx1 - d.cx0) || (cy1 - cy0) !== (d.cy1 - d.cy0)) return;
		let guard = Math.abs(cx0 - d.cx0) + Math.abs(cy0 - d.cy0) + 2;
		while ((d.cx0 !== cx0 || d.cy0 !== cy0) && guard-- > 0) {
			const dcx = Math.sign(cx0 - d.cx0);
			const dcy = Math.sign(cy0 - d.cy0);
			const ox = d.cx0, oy = d.cy0;
			d.shiftBy(this, dcx, dcy);
			if (d.cx0 === ox && d.cy0 === oy) break;
		}
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

		// 1 coarse step (Eq. 15→16→bounce-back→consolidate→boundary).
		// Covered nodes are included: the pull stream reads their post-collision f.
		// Each domain's averageToCoarse replaces those nodes after the fine sub-steps.
		this.collideAndStream(this._allInteriorCells, omega_c);
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

	// Finest disk that covers this parent coordinate. Same level: the later
	// domain wins, matching _ownsWrite. See the overlap rule on RefinementDomain.
	_finestDomain(cx, cy) {
		let best = null;
		let bestLevel = 0;
		for (let d = 0; d < this.domains.length; d++) {
			const level = this.domains[d].levelAt(cx, cy);
			if (level > 0 && level >= bestLevel) { best = this.domains[d]; bestLevel = level; }
		}
		return best;
	}

	// Apply a force vector (fx, fy) to the fluid at world position (wx, wy).
	// Routes to the finest mask that contains the point, not the rectangle alone.
	apply_energy(wx, wy, fx, fy) {
		if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(fx) || !Number.isFinite(fy)) return;
		const cx_cont = this.width/2  + wx * this.resolution;
		const cy_cont = this.height/2 + wy * this.resolution;
		const best = this._finestDomain(cx_cont, cy_cont);
		if (best) { best.applyEnergyAt(cx_cont, cy_cont, fx, fy); return; }
		const x = Math.max(1, Math.min(this.width  - 2, Math.round(cx_cont)));
		const y = Math.max(1, Math.min(this.height - 2, Math.round(cy_cont)));
		this.apply_force_to_cell(x, y, fx, fy);
	}

	// Distribute a total force (fx, fy) evenly along a world-space line segment.
	// Steps at the finest grid cell size so every cell along the sail span is hit once.
	apply_energy_segment(x0, y0, x1, y1, fx, fy) {
		if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return;
		if (!Number.isFinite(fx) || !Number.isFinite(fy)) return;
		const dx = x1 - x0;
		const dy = y1 - y0;
		const length = Math.sqrt(dx*dx + dy*dy);
		if (!(length > 1e-9)) return;

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
		const cell = latticeCell(this.cells, this.width, this.height, x, y);
		if (!cell) return;
		addMomentum(cell, fx, fy);
	}

	get_field_velocity(worldX, worldY) {
		// NaN comparisons are all false, so a non-finite probe would skip the
		// clamp below and read cells[NaN].ux. Return a zero sample instead.
		if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) {
			return { x: 0, y: 0 };
		}
		const cx_cont = this.width/2  + worldX * this.resolution;
		const cy_cont = this.height/2 + worldY * this.resolution;
		const best = this._finestDomain(cx_cont, cy_cont);
		if (best) return best.getVelocityAt(cx_cont, cy_cont);

		let x = this.width/2  + Math.floor(worldX * this.resolution);
		let y = this.height/2 + Math.floor(worldY * this.resolution);

		// The ±2 world-unit wind stencil (and the mouse probe) can land past the
		// outer cells. An unclamped index is undefined there — negative y underflows
		// the array, and y past the last row walks off the end (positive x wraps
		// into the next row). Pinning to the edge cell leaves in-range samples
		// unchanged: those already have floor(x) in [0, width-2].
		let x0 = Math.floor(x);
		let y0 = Math.floor(y);
		let hf = x - x0;
		let vf = y - y0;
		if (x0 < 0) { x0 = 0; hf = 0; }
		if (y0 < 0) { y0 = 0; vf = 0; }
		if (x0 > this.width - 2)  { x0 = Math.max(0, this.width  - 2); hf = 1; }
		if (y0 > this.height - 2) { y0 = Math.max(0, this.height - 2); vf = 1; }

		const x1 = x0 + 1;
		const y1 = y0;
		const x2 = x0;
		const y2 = y0 + 1;
		const x3 = x0 + 1;
		const y3 = y0 + 1;

		const s0 = (1-hf) * (1-vf);
		const s1 =   hf   * (1-vf);
		const s2 = (1-hf) *   vf;
		const s3 =   hf   *   vf;

		const cell_0 = latticeCell(this.cells, this.width, this.height, x0, y0);
		const cell_1 = latticeCell(this.cells, this.width, this.height, x1, y1);
		const cell_2 = latticeCell(this.cells, this.width, this.height, x2, y2);
		const cell_3 = latticeCell(this.cells, this.width, this.height, x3, y3);
		if (!cell_0 || !cell_1 || !cell_2 || !cell_3) return { x: 0, y: 0 };

		const vx = cell_0.ux*s0 + cell_1.ux*s1 + cell_2.ux*s2 + cell_3.ux*s3;
		const vy = cell_0.uy*s0 + cell_1.uy*s1 + cell_2.uy*s2 + cell_3.uy*s3;
		if (!Number.isFinite(vx) || !Number.isFinite(vy)) return { x: 0, y: 0 };

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
		const curlGrid = (cells, w, h) => {
			for (let y = 1; y < h - 1; y++) {
				for (let x = 1; x < w - 1; x++) cells[x + y * w].calculate_curl();
			}
		};
		curlGrid(this.cells, this.width, this.height);
		const walk = (ds) => {
			for (const d of ds) {
				curlGrid(d.cells, d.width, d.height);
				walk(d.domains);
			}
		};
		walk(this.domains);
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
