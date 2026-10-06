// Coarse–fine edge against Lagrava et al. 2012 (Eq. 29, 33, 34, 38, 39).
// The cubic runs along the interface on decomposed f_neq. A shear u_y(x)
// is then exact on a vertical edge; interpolating across that shear is not.
globalThis.document = {
	getElementById: () => ({
		value: '0', selectedIndex: 3, checked: true, innerHTML: '', textContent: '', style: {},
		addEventListener() {}, appendChild() {},
	}),
	getElementsByTagName: () => [],
	createElement: () => ({ addEventListener() {}, appendChild() {}, style: {} }),
	body: { appendChild() {} },
	currentScript: null,
};
globalThis.window = globalThis;
globalThis.addEventListener = globalThis.addEventListener || (() => {});

const { Boltzmann, fineIndex } = await import('../src/boltzmann.js');

const four9ths = 4 / 9, one9th = 1 / 9, one36th = 1 / 36;
const POP = ['f0', 'fE', 'fW', 'fN', 'fS', 'fNE', 'fNW', 'fSE', 'fSW'];
const C = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const WT = [four9ths, one9th, one9th, one9th, one9th, one36th, one36th, one36th, one36th];

let failed = 0;
function check(name, cond, detail) {
	const ok = !!cond;
	if (!ok) failed++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

function feq(ux, uy, rho) {
	const ux3 = 3 * ux, uy3 = 3 * uy;
	const ux2 = ux * ux, uy2 = uy * uy, uxuy2 = 2 * ux * uy;
	const u2 = ux2 + uy2, u215 = 1.5 * u2;
	const r1 = one9th * rho, r36 = one36th * rho;
	return {
		f0: four9ths * rho * (1 - u215),
		fE: r1 * (1 + ux3 + 4.5 * ux2 - u215),
		fW: r1 * (1 - ux3 + 4.5 * ux2 - u215),
		fN: r1 * (1 + uy3 + 4.5 * uy2 - u215),
		fS: r1 * (1 - uy3 + 4.5 * uy2 - u215),
		fNE: r36 * (1 + ux3 + uy3 + 4.5 * (u2 + uxuy2) - u215),
		fNW: r36 * (1 - ux3 + uy3 + 4.5 * (u2 - uxuy2) - u215),
		fSE: r36 * (1 + ux3 - uy3 + 4.5 * (u2 - uxuy2) - u215),
		fSW: r36 * (1 - ux3 - uy3 + 4.5 * (u2 + uxuy2) - u215),
	};
}

function fneqFromStrain(ux, uy, rho, Sxy, omega) {
	const cs2 = 1 / 3;
	const eq = feq(ux, uy, rho);
	const out = {};
	for (let i = 0; i < 9; i++) {
		const cx = C[i][0], cy = C[i][1];
		const Qs = 2 * cx * cy * Sxy;
		const neq = -WT[i] * rho / (cs2 * omega) * Qs;
		out[POP[i]] = eq[POP[i]] + neq;
	}
	return out;
}

function cubic38(a, b, c, d) {
	return (9 / 16) * (b + c) - (1 / 16) * (a + d);
}

function make(w, h) {
	const bm = new Boltzmann(w, h, 1, 90, 25, undefined, 1);
	bm.domains.length = 0;
	return bm;
}

function paintShear(bm, uyOfX, omega) {
	for (let y = 0; y < bm.height; y++) {
		for (let x = 0; x < bm.width; x++) {
			const uy = uyOfX(x);
			const ym = uyOfX(x - 1), yp = uyOfX(x + 1);
			const Sxy = 0.5 * (yp - ym) / 2;
			const pops = fneqFromStrain(0, uy, 1, Sxy, omega);
			const cell = bm.cells[x + y * bm.width];
			for (const k of POP) cell[k] = pops[k];
			cell.rho = 1;
			cell.ux = 0;
			cell.uy = uy;
		}
	}
}

// Tangential paper reconstruction: decompose, cubic along y at fixed x, Eq. 29.
function paperAlongY(bm, x, iy, omegaC, omegaF) {
	const scale = omegaC / (2 * omegaF);
	const nodes = [iy - 1, iy, iy + 1, iy + 2].map(y => bm.cells[x + y * bm.width]);
	const interp = (g) => cubic38(g(nodes[0]), g(nodes[1]), g(nodes[2]), g(nodes[3]));
	const rho = interp(c => c.rho);
	const ux = interp(c => c.ux);
	const uy = interp(c => c.uy);
	const eq = feq(ux, uy, rho);
	const out = { rho, ux, uy };
	for (const k of POP) {
		const fneq = interp(c => c[k] - feq(c.ux, c.uy, c.rho)[k]);
		out[k] = eq[k] + scale * fneq;
	}
	return out;
}

// The old bug: cubic across x of the raw populations, f_neq taken afterwards.
function acrossXFormula(bm, ix, iy, omegaC, omegaF) {
	const scale = omegaC / (2 * omegaF);
	const nodes = [ix - 1, ix, ix + 1, ix + 2].map(x => bm.cells[x + iy * bm.width]);
	const interp = (g) => cubic38(g(nodes[0]), g(nodes[1]), g(nodes[2]), g(nodes[3]));
	const rho = interp(c => c.rho);
	const ux = interp(c => c.ux);
	const uy = interp(c => c.uy);
	const eq = feq(ux, uy, rho);
	let maxNeq = 0;
	for (const k of POP) {
		const fI = interp(c => c[k]);
		const paperNeq = interp(c => c[k] - feq(c.ux, c.uy, c.rho)[k]);
		maxNeq = Math.max(maxNeq, Math.abs((fI - eq[k]) - paperNeq));
	}
	return { uy, maxNeq };
}

function maxPopErr(cell, ref) {
	let m = 0;
	for (const k of POP) m = Math.max(m, Math.abs(cell[k] - ref[k]));
	return m;
}

{
	const bm = make(32, 32);
	const omegaC = 1 / (3 * bm.nu + 0.5);
	const omegaF = 2 * omegaC / (4 - omegaC);
	bm.addDomain(10, 10, 22, 22);
	const d = bm.domains[0];
	check('fine ω matches Eq. 24', Math.abs(d.omega_f - omegaF) < 1e-12 && Math.abs(d.omega_c - omegaC) < 1e-12,
		`ω_f=${d.omega_f}`);
	check('overlap is one coarse cell and symmetric',
		d.width === (22 - 10) * 2 + 3
		&& Math.abs(d.coarseX(0) - 9) < 1e-12
		&& Math.abs(d.coarseX(d.width - 1) - 22) < 1e-12
		&& Math.abs(d.coarseX(fineIndex(d.cx0, 10)) - 10) < 1e-12);
	const west = d._ghostLoc.filter(g => g.fi === 0);
	const east = d._ghostLoc.filter(g => g.fi === d.width - 1);
	check('outer lines are imposed on both sides', west.length === d.height && east.length === d.height,
		`west=${west.length} east=${east.length}`);
	let bothHalf = 0;
	for (const g of d._ghostLoc) if ((g.fi % 2) === 1 && (g.fj % 2) === 1) bothHalf++;
	check('a rectangle has no diagonal ghost', bothHalf === 0, `both-half=${bothHalf}`);

	bm.domains.length = 0;
	bm.addDomain(8, 8, 24, 24);
	const disk = bm.domains[0];
	disk.setDisk(16, 16, 6);
	let diskBoth = 0;
	for (const g of disk._ghostLoc) if ((g.fi % 2) === 1 && (g.fj % 2) === 1) diskBoth++;
	const counts = disk.overlapCounts();
	check('a disk staircase has no 2D-cubic ghost',
		diskBoth === 0 && counts.edge > 0 && counts.corner > 0 && !disk.hasDiagonalOnlyContact(),
		`both-half=${diskBoth} edge=${counts.edge} corner=${counts.corner}`);
}

{
	const U = 0.25;
	const delta = 0.72;
	const uyOf = (x) => U * Math.tanh((x - 16) / delta);
	const bm = make(40, 40);
	bm.addDomain(8, 8, 28, 28);
	const d = bm.domains[0];
	paintShear(bm, uyOf, d.omega_c);
	// West outer line x = 7, halfway along y at 16.5. Shear is constant on that line.
	const fi = 0;
	const fj = fineIndex(d.cy0, 16.5);
	d._injectGhostCell(bm, fi, fj, true);
	const ghost = d.cells[fi + fj * d.width];
	const iy = 16;
	const paper = paperAlongY(bm, 7, iy, d.omega_c, d.omega_f);
	const err = maxPopErr(ghost, paper);
	check('tangential inject matches decomposed f_neq', err < 1e-12 && Math.abs(ghost.uy - uyOf(7)) < 1e-12,
		`|Δf|=${err.toExponential(2)} uy=${ghost.uy.toExponential(3)}`);
	// The across-shear cubic still invents f_neq. This is the quantity the
	// old west ghost (halfway in x) used to write. It must stay large, so a
	// regression that points the cubic through the layer fails the test above.
	const across = acrossXFormula(bm, 15, 16, d.omega_c, d.omega_f);
	check('across-shear f_neq error stays visible to the test', across.maxNeq > 1e-3,
		`|Δf_neq|=${across.maxNeq.toExponential(3)} uyErr=${(across.uy - uyOf(15.5)).toExponential(3)}`);
}

{
	const bm = make(32, 32);
	bm.addDomain(8, 8, 24, 24);
	const d = bm.domains[0];
	const cx = 8, cy = 16;
	const fi0 = fineIndex(d.cx0, cx);
	const fj0 = fineIndex(d.cy0, cy);
	const w = d.width;
	let fluidStencil = true;
	for (let dj = -1; dj <= 1; dj++) {
		for (let di = -1; di <= 1; di++) {
			if (d._role[(fi0 + di) + (fj0 + dj) * w] !== 1) fluidStencil = false;
		}
	}
	const ghostFi = fi0 - 2;
	check('rim filter stencil is evolved nodes, ghost is outside it',
		fluidStencil && ghostFi >= 0 && d._role[ghostFi + fj0 * w] !== 1,
		`fi0=${fi0} ghostFi=${ghostFi}`);

	const Sxy = 0.04;
	for (let dj = -1; dj <= 1; dj++) {
		for (let di = -1; di <= 1; di++) {
			const cell = d.cells[(fi0 + di) + (fj0 + dj) * w];
			const pops = fneqFromStrain(0, 0.02, 1, Sxy, d.omega_f);
			for (const k of POP) cell[k] = pops[k];
			cell.rho = 1; cell.ux = 0; cell.uy = 0.02;
		}
	}
	d._restrictCell(bm, cx, cy);
	const before = POP.map(k => bm.cells[cx + cy * bm.width][k]);
	const ghost = d.cells[ghostFi + fj0 * w];
	for (const k of POP) ghost[k] = 0.25;
	ghost.rho = 3; ghost.ux = 0.4; ghost.uy = -0.4;
	d._restrictCell(bm, cx, cy);
	let moved = 0;
	const coarse = bm.cells[cx + cy * bm.width];
	for (let i = 0; i < POP.length; i++) moved = Math.max(moved, Math.abs(coarse[POP[i]] - before[i]));
	check('restriction does not read the imposed ghost', moved < 1e-15, `|Δf|=${moved.toExponential(2)}`);

	const deep = bm.cells[16 + 16 * bm.width];
	const rim = bm.cells[cx + cy * bm.width];
	check('deep interior is not streamed and the overlap ring is',
		!bm.streamCells.includes(deep) && bm.streamCells.includes(rim));
}

{
	const U = 0.25;
	const delta = 0.72;
	const uyOf = (x) => U * Math.tanh((x - 20) / delta);
	const bm = make(48, 48);
	const omega = 1 / (3 * bm.nu + 0.5);
	paintShear(bm, uyOf, omega);
	bm.setBoundaries = function () {
		for (let x = 0; x < this.width; x++) {
			const pops = fneqFromStrain(0, uyOf(x), 1, 0, omega);
			for (const edge of [0, this.height - 1]) {
				const cell = this.cells[x + edge * this.width];
				for (const k of POP) cell[k] = pops[k];
				cell.rho = 1; cell.ux = 0; cell.uy = uyOf(x);
			}
		}
		for (let y = 1; y < this.height - 1; y++) {
			for (const edge of [0, this.width - 1]) {
				const pops = fneqFromStrain(0, uyOf(edge), 1, 0, omega);
				const cell = this.cells[edge + y * this.width];
				for (const k of POP) cell[k] = pops[k];
				cell.rho = 1; cell.ux = 0; cell.uy = uyOf(edge);
			}
		}
	};
	const bare = make(48, 48);
	bare.domains.length = 0;
	paintShear(bare, uyOf, omega);
	bare.setBoundaries = bm.setBoundaries;
	bm.addDomain(12, 12, 36, 36);
	bm.domains[0].setDisk(24, 24, 8);
	let worst = 0, maxU = 0, bad = 0;
	for (let frame = 0; frame < 40; frame++) {
		bare.physics_model_step();
		bm.physics_model_step();
	}
	const d = bm.domains[0];
	for (let y = 1; y < bm.height - 1; y++) {
		for (let x = 1; x < bm.width - 1; x++) {
			const c = bm.cells[x + y * bm.width];
			const a = bare.cells[x + y * bm.width];
			if (!Number.isFinite(c.ux) || !Number.isFinite(c.uy) || !Number.isFinite(c.rho)) { bad++; continue; }
			maxU = Math.max(maxU, Math.hypot(c.ux, c.uy));
			if (d._maskAt(x, y)) continue;
			worst = Math.max(worst, Math.abs(c.uy - a.uy), Math.abs(c.rho - a.rho));
		}
	}
	check('tanh shear across a disk stays near the bare lattice', bad === 0 && worst < 0.05 && maxU < 0.5,
		`bad=${bad} outside|Δ|=${worst.toExponential(3)} max|u|=${maxU.toExponential(3)}`);
}

if (failed) {
	console.error(`${failed} check(s) failed`);
	process.exit(1);
}
console.log('all edge-transition checks passed');
