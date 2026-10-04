// Headless checks for the AMR coupling (steps 1–5).
// Stubs the DOM bits boltzmann.js touches at import time.
globalThis.document = {
	getElementById: () => ({ value: '0', selectedIndex: 3, addEventListener() {} }),
};
globalThis.window = globalThis;

const { Boltzmann } = await import('../src/boltzmann.js');

const results = {};
let failed = 0;

function check(name, cond, detail) {
	const ok = !!cond;
	if (!ok) failed++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + detail : ''}`);
	return ok;
}

function sumF(cell) {
	return cell.f0 + cell.fN + cell.fS + cell.fE + cell.fW
		+ cell.fNE + cell.fNW + cell.fSE + cell.fSW;
}

function maxMacroGap(bm) {
	let gap = 0;
	const visit = (cells) => {
		for (const c of cells) gap = Math.max(gap, Math.abs(c.rho - sumF(c)));
	};
	visit(bm.cells);
	const walk = (domains) => {
		for (const d of domains) {
			visit(d.cells);
			walk(d.domains);
		}
	};
	walk(bm.domains);
	return gap;
}

function windOf(bm) {
	const edge = bm.cells[0];
	return { ux: edge.ux, uy: edge.uy };
}

function maxDeviation(bm, ux0, uy0) {
	let dr = 0, du = 0;
	const acc = (c) => {
		dr = Math.max(dr, Math.abs(c.rho - 1));
		du = Math.max(du, Math.abs(c.ux - ux0), Math.abs(c.uy - uy0));
	};
	for (const c of bm.cells) acc(c);
	const walk = (domains) => {
		for (const d of domains) {
			for (const c of d.cells) acc(c);
			walk(d.domains);
		}
	};
	walk(bm.domains);
	return { dr, du };
}

function make(w, h, speed) {
	return new Boltzmann(w, h, 1, 90, speed, undefined, 1);
}

// --- 1. Stored macros match populations after a step ---
{
	const bm = make(32, 32, 0);
	const cx = 16, cy = 16;
	for (let y = 0; y < bm.height; y++) {
		for (let x = 0; x < bm.width; x++) {
			const r = Math.hypot(x - cx, y - cy);
			const rho = 1 + 0.05 * Math.exp(-r * r / 18);
			bm.cells[x + y * bm.width].setEquil(0, 0, rho);
		}
	}
	bm.physics_model_step();
	const gap = maxMacroGap(bm);
	results.macroGap = gap;
	check('macros match populations after one step', gap < 1e-12, `max |ρ−Σf| = ${gap.toExponential(3)}`);
}

// --- 2. Coincident fine node matches the parent at init ---
{
	const bm = make(32, 32, 0);
	const cx = 16, cy = 16;
	for (let y = 0; y < bm.height; y++) {
		for (let x = 0; x < bm.width; x++) {
			const r = Math.hypot(x - cx, y - cy);
			bm.cells[x + y * bm.width].setEquil(0, 0, 1 + 0.05 * Math.exp(-r * r / 18));
		}
	}
	bm.addDomain(8, 8, 24, 24);
	const d = bm.domains[0];
	let gap = 0;
	for (let cy = d.cy0; cy < d.cy1; cy++) {
		for (let cx = d.cx0; cx < d.cx1; cx++) {
			const parent = bm.cells[cx + cy * bm.width];
			const fi = 1 + (cx - d.cx0) * 2;
			const fj = 1 + (cy - d.cy0) * 2;
			const fine = d.cells[fi + fj * d.width];
			gap = Math.max(gap, Math.abs(sumF(fine) - sumF(parent)), Math.abs(fine.ux - parent.ux), Math.abs(fine.uy - parent.uy));
		}
	}
	results.coincidentGap = gap;
	check('coincident fine node matches parent', gap < 1e-10, `max |Δ| = ${gap.toExponential(3)}`);
}

// --- 3. Covered node is collided before the outside pull ---
{
	const bm = make(40, 40, 0);
	const cx0 = 10, cy = 20;
	bm.addDomain(cx0, 10, 30, 30);
	const cell = bm.cells[cx0 + cy * bm.width];
	cell.fE += 0.01;
	cell.fW += 0.01;
	cell.fN -= 0.01;
	cell.fS -= 0.01;
	const omega = 1 / (3 * bm.nu + 0.5);
	const fWpre = cell.fW;
	const feqW = 1 / 9;
	const fWpost = fWpre + omega * (feqW - fWpre);
	bm.physics_model_step();
	const outside = bm.cells[(cx0 - 1) + cy * bm.width];
	const missPost = Math.abs(outside.fW - fWpost);
	const missPre = Math.abs(outside.fW - fWpre);
	results.donorMissPost = missPost;
	results.donorMissPre = missPre;
	check('outside fW matches post-collision donor', missPost < 1e-12, `|fW−fWpost| = ${missPost.toExponential(3)}, |fW−fWpre| = ${missPre.toExponential(3)}`);
}

// --- 4. Uniform wind, static and walking, with a level-2 child ---
{
	const bm = make(64, 64, 15);
	const { ux, uy } = windOf(bm);
	bm.addDomain(12, 16, 36, 40);
	bm.domains[0].addDomain(12, 12, 36, 36);
	for (let i = 0; i < 20; i++) bm.physics_model_step();
	const stat = maxDeviation(bm, ux, uy);
	results.uniformStatic = stat;
	check('uniform wind, static domain', stat.dr < 1e-12 && stat.du < 1e-12,
		`|ρ−1| = ${stat.dr.toExponential(3)}, |u−uwind| = ${stat.du.toExponential(3)}`);

	for (let i = 0; i < 8; i++) {
		bm.shiftDomain(0, 1, 0);
		bm.physics_model_step();
	}
	const walked = maxDeviation(bm, ux, uy);
	results.uniformWalk = walked;
	check('uniform wind, walking domain', walked.dr < 1e-12 && walked.du < 1e-12,
		`|ρ−1| = ${walked.dr.toExponential(3)}, |u−uwind| = ${walked.du.toExponential(3)}`);
	check('level-2 child survived the walk', bm.domains[0].domains.length === 1,
		`children = ${bm.domains[0].domains.length}`);
}

// --- 5. Linear shear: static, one step, and a one-cell walk ---
function imposeShear(bm) {
	const ymid = (bm.height - 1) / 2;
	const uxAt = (y) => 0.002 * (y - ymid);
	for (let y = 0; y < bm.height; y++) {
		const ux = uxAt(y);
		for (let x = 0; x < bm.width; x++) bm.cells[x + y * bm.width].setEquil(ux, 0, 1);
	}
	bm.setBoundaries = function () {
		for (let x = 0; x < this.width; x++) {
			this.cells[x + 0 * this.width].setEquil(uxAt(0), 0, 1);
			this.cells[x + (this.height - 1) * this.width].setEquil(uxAt(this.height - 1), 0, 1);
		}
		for (let y = 1; y < this.height - 1; y++) {
			const ux = uxAt(y);
			this.cells[0 + y * this.width].setEquil(ux, 0, 1);
			this.cells[(this.width - 1) + y * this.width].setEquil(ux, 0, 1);
		}
	};
	return uxAt;
}

function shearStats(bm, domain) {
	let mass = 0, outRho = 0;
	for (let y = 0; y < bm.height; y++) {
		for (let x = 0; x < bm.width; x++) {
			const c = bm.cells[x + y * bm.width];
			mass += c.rho - 1;
			const inside = domain && x >= domain.cx0 && x < domain.cx1 && y >= domain.cy0 && y < domain.cy1;
			if (!inside) outRho = Math.max(outRho, Math.abs(c.rho - 1));
		}
	}
	return { mass, outRho };
}

{
	const ySample = 32; // ux = 0.002*(32-31.5) = 0.001
	const xSample = 24;

	const bare = make(64, 64, 0);
	const uxAt = imposeShear(bare);
	bare.physics_model_step();
	const bareUx1 = bare.cells[xSample + ySample * bare.width].ux;
	for (let i = 0; i < 29; i++) bare.physics_model_step();
	const bare30 = shearStats(bare, null);
	results.shearBare = { ux1: bareUx1, analytic: uxAt(ySample), mass30: bare30.mass, outRho30: bare30.outRho };

	const bm = make(64, 64, 0);
	imposeShear(bm);
	bm.addDomain(16, 16, 48, 48);
	bm.physics_model_step();
	const ux1 = bm.cells[xSample + ySample * bm.width].ux;
	const uxErr = Math.abs(ux1 - uxAt(ySample));
	const uxVsBare = Math.abs(ux1 - bareUx1);
	results.shearUx1 = { ux: ux1, err: uxErr, vsBare: uxVsBare };
	check('shear interior ux after 1 step', uxErr < 1e-4 && uxVsBare < 1e-4,
		`ux = ${ux1.toExponential(6)}, |ux−analytic| = ${uxErr.toExponential(3)}, |ux−bare| = ${uxVsBare.toExponential(3)}`);

	for (let i = 0; i < 29; i++) bm.physics_model_step();
	const st = shearStats(bm, bm.domains[0]);
	results.shearStatic30 = st;
	// The bare solver on this shear already reaches ~5e-4. The gate is "matches that
	// baseline". The previous coupling sat at 7.4e-4 outside and drifted mass by 0.23.
	check('shear outside density after 30 steps', st.outRho < bare30.outRho * 1.05,
		`max |ρ−1| outside = ${st.outRho.toExponential(3)} (bare ${bare30.outRho.toExponential(3)})`);
	check('shear mass drift after 30 steps', Math.abs(st.mass) < 0.02 && Math.abs(st.mass) < Math.abs(bare30.mass) * 2,
		`Σ(ρ−1) = ${st.mass.toExponential(3)} (bare ${bare30.mass.toExponential(3)})`);

	const walk = make(64, 64, 0);
	imposeShear(walk);
	walk.addDomain(12, 20, 36, 44);
	let walkOut = 0;
	for (let i = 0; i < 10; i++) {
		walk.shiftDomain(0, 1, 0);
		walk.physics_model_step();
		walkOut = Math.max(walkOut, shearStats(walk, walk.domains[0]).outRho);
	}
	results.shearWalkOut = walkOut;
	// Previous one-cell moveDomain walk on the same shear reached 2.5e-3 outside.
	check('shear walking rectangle stays quiet', walkOut < bare30.outRho + 2e-4,
		`max |ρ−1| outside during walk = ${walkOut.toExponential(3)} (bare ${bare30.outRho.toExponential(3)})`);
}

// --- 6. Level-2 marker survives a parent shift at the slid index ---
{
	const bm = make(64, 64, 0);
	bm.addDomain(10, 10, 40, 40);
	const level1 = bm.domains[0];
	level1.addDomain(10, 10, 40, 40);
	const level2 = level1.domains[0];
	const marker = level2.cells[20 + 20 * level2.width];
	marker.setEquil(0, 0.05, 1.02);
	const before = level2.cx0;
	bm.shiftDomain(0, 1, 0);
	const landed = level2.cells[16 + 20 * level2.width];
	results.level2 = {
		sameObject: level1.domains[0] === level2,
		childCount: level1.domains.length,
		cx0: level2.cx0,
		cx0Before: before,
		level1cx0: level1.cx0,
		rho: landed.rho,
		uy: landed.uy,
	};
	check('level-2 object carried, not reallocated', level1.domains.length === 1 && level1.domains[0] === level2);
	check('level-2 parent-index origin unchanged', level2.cx0 === before, `cx0 ${before} → ${level2.cx0}`);
	check('level-2 marker at fi=16', Math.abs(landed.rho - 1.02) < 1e-12 && Math.abs(landed.uy - 0.05) < 1e-12,
		`ρ = ${landed.rho}, uy = ${landed.uy}`);
}

// --- 7. Diagnostic: coarse get_field_velocity is still unclamped. Not fixed here. ---
{
	const bm = make(75, 75, 0);
	const throwsAt = (x, y) => {
		try { bm.get_field_velocity(x, y); return false; }
		catch { return true; }
	};
	// A 5×5 wind sample of radius 2 around a boat on the south wall (y = -35.5)
	// includes world y = -37.5. That index is off the grid and throws.
	const southEdge = throwsAt(0, -37.5);
	const northEdge = throwsAt(0, 37.5);
	// Domain placed the way main.js places it for that boat: clamped to cell 1,
	// so the off-grid sample is still on the coarse path.
	const boatCy = 75 / 2 + (-35.5);
	const cy = Math.round(boatCy);
	const cy0 = Math.max(1, cy - 20);
	const cy1 = Math.min(74, cy + 20);
	bm.addDomain(20, cy0, 55, cy1);
	const southWithDomain = throwsAt(0, -37.5);
	const boatItself = throwsAt(0, -35.5);
	const inside = throwsAt(0, 0);
	results.oob = { southEdge, northEdge, southWithDomain, boatItself, inside, cy0, cy1 };
	console.log(`INFO  get_field_velocity OOB: south edge throws=${southEdge}, north edge throws=${northEdge}, south edge with wall-clamped domain throws=${southWithDomain}, boat on the wall throws=${boatItself}, interior sample throws=${inside}`);
	check('sample inside a domain does not throw', !inside && !boatItself);
}

console.log('MEASUREMENTS ' + JSON.stringify(results));
if (failed) {
	console.error(`${failed} check(s) failed`);
	process.exit(1);
}
console.log('all checks passed');
