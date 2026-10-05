// Headless checks for the AMR coupling (steps 1–5).
// Stubs the DOM bits boltzmann.js touches at import time.
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

// --- 7. Edge wind samples are clamped to the lattice. A probe past the wall used to throw. ---
{
	const bm = make(75, 75, 0);
	const throwsAt = (x, y) => {
		try { bm.get_field_velocity(x, y); return false; }
		catch { return true; }
	};
	// A 5×5 wind sample of radius 2 around a boat on the south wall (y = -35.5)
	// includes world y = -37.5. That index is off the grid; the sample is clamped.
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

// --- 8. Scenario 0 stays on the autopilot heading with a settled speed ---
// Open water only: the hull meets the map wall later and that is a separate limit.
{
	const { Map } = await import('../src/map.js');
	const { Boat } = await import('../src/boat.js');
	const HALF = 20, THRESH = 1;
	const toward = (px, py, d, gw, gh) => {
		const cx = (d.cx0 + d.cx1) / 2, cy = (d.cy0 + d.cy1) / 2;
		let dcx = 0, dcy = 0;
		if (px - cx > THRESH) dcx = 1; else if (cx - px > THRESH) dcx = -1;
		else if (py - cy > THRESH) dcy = 1; else if (cy - py > THRESH) dcy = -1;
		if (d.cx0 + dcx < 1 || d.cx1 + dcx > gw - 1) dcx = 0;
		if (d.cy0 + dcy < 1 || d.cy1 + dcy > gh - 1) dcy = 0;
		return { dcx, dcy };
	};
	const bm = new Boltzmann(75, 75, 1, 90, 15, undefined, 1);
	const map = new Map(75, 75, 90, 15, bm);
	map.physics_model_init();
	const boat = new Boat(map, 10, -9, 5 * Math.PI / 4);
	let bmMs = 0;
	const N = 600;
	let bsAt500 = 0;
	for (let frame = 0; frame < N; frame++) {
		if (frame === 1) boat.input_autopilot_enabled_toggle();
		map.world.step(1 / 30);
		boat.physics_model_step();
		if (boat.mainsail_force) {
			for (const seg of boat.getSailSegments()) {
				bm.apply_energy_segment(seg.x0, seg.y0, seg.x1, seg.y1, seg.fx * 0.0003, seg.fy * 0.0003);
			}
		}
		const boatCx = bm.width / 2 + boat.x, boatCy = bm.height / 2 + boat.y;
		let shifted = false;
		if (bm.domains.length === 0) {
			const cx = Math.round(boatCx), cy = Math.round(boatCy);
			bm.addDomain(Math.max(1, cx - HALF), Math.max(1, cy - HALF), Math.min(bm.width - 1, cx + HALF), Math.min(bm.height - 1, cy + HALF));
		} else {
			const step = toward(boatCx, boatCy, bm.domains[0], bm.width, bm.height);
			if (step.dcx || step.dcy) { bm.shiftDomain(0, step.dcx, step.dcy); shifted = true; }
		}
		const level1 = bm.domains[0];
		const fx = 1 + (boatCx - level1.cx0) * 2, fy = 1 + (boatCy - level1.cy0) * 2;
		if (level1.domains.length === 0) {
			const fi = Math.round(fx), fj = Math.round(fy);
			level1.addDomain(Math.max(1, fi - HALF), Math.max(1, fj - HALF), Math.min(level1.width - 1, fi + HALF), Math.min(level1.height - 1, fj + HALF));
		} else if (!shifted) {
			const d2 = level1.domains[0];
			const step2 = toward(fx, fy, d2, level1.width, level1.height);
			if (step2.dcx || step2.dcy) { d2.shiftBy(level1, step2.dcx, step2.dcy); level1._rebuildInteriorCells(); }
		}
		const a = Date.now();
		bm.physics_model_step();
		bmMs += Date.now() - a;
		if (frame === 500) bsAt500 = Math.hypot(boat.physics_model.m_linearVelocity.x, boat.physics_model.m_linearVelocity.y);
	}
	const twa = boat.twa;
	const bs = Math.hypot(boat.physics_model.m_linearVelocity.x, boat.physics_model.m_linearVelocity.y);
	const st = fieldStats(bm);
	const stepMs = bmMs / N;
	results.scenario0 = { twa, bs, tws: boat.wind_speed, stepMs, maxU: st.maxU, bad: st.bad, bsAt500 };
	check('scenario 0 heading near 45°', Math.abs(twa) >= 40 && Math.abs(twa) <= 55, `twa = ${twa.toFixed(1)}`);
	check('scenario 0 speed settled', bs > 1.8 && bs < 2.8 && Math.abs(bs - bsAt500) < 0.15,
		`bs = ${bs.toFixed(3)} (at 500: ${bsAt500.toFixed(3)})`);
	check('scenario 0 wind still blowing', boat.wind_speed > 12 && st.bad === 0 && st.maxU < 0.3 && st.maxU > 0.1,
		`TWS = ${boat.wind_speed.toFixed(2)}, max|u| = ${st.maxU.toExponential(2)}, bad = ${st.bad}`);
	check('scenario 0 step stays cheap', stepMs < 12, `mean step ${stepMs.toFixed(2)} ms`);
	check('scenario 0 keeps a single level-2 grid', bm.domains[0].domains.length === 1);
}

// --- 9. Sail momentum reaches the refined field and stays bounded ---
// setEquil used to stack the kick on a cell that never streamed (the wake ran
// away). The moment strip then dropped a kick that missed the coincident node,
// so the plotted field stayed at the freestream. Exact difference on that node,
// once per fine substep, must leave a wake.
{
	const uy0 = -0.15;
	const bm = new Boltzmann(48, 48, 1, 90, 15, undefined, 1);
	bm.addDomain(12, 12, 36, 36);
	bm.domains[0].addDomain(16, 16, 48, 48);
	let j0 = 0;
	for (const c of bm.cells) j0 += c.rho * (c.uy - uy0);
	bm.apply_energy(0, 0, 0, 0.05);
	bm.physics_model_step();
	let j1 = 0, maxU = 0, maxCurl = 0, bad = 0;
	const acc = (c) => {
		if (!Number.isFinite(c.ux) || !Number.isFinite(c.uy) || !Number.isFinite(c.rho)) { bad++; return; }
		maxU = Math.max(maxU, Math.hypot(c.ux, c.uy));
		if (Number.isFinite(c.curl)) maxCurl = Math.max(maxCurl, Math.abs(c.curl));
	};
	for (const c of bm.cells) { j1 += c.rho * (c.uy - uy0); acc(c); }
	const walk = (ds) => { for (const d of ds) { for (const c of d.cells) acc(c); walk(d.domains); } };
	walk(bm.domains);
	const rootJy = j1 - j0;
	results.impulse = { rootJy, maxU, maxCurl, bad };
	check('impulse survives restriction', rootJy > 0.05 && rootJy < 0.5, `coarse ΣρΔuy = ${rootJy.toExponential(3)}`);
	check('impulse wake is bounded', bad === 0 && maxU < 1 && maxCurl > 0.05, `max|u| = ${maxU.toExponential(3)}, max|curl| = ${maxCurl.toExponential(3)}`);
}
{
	const { Map } = await import('../src/map.js');
	const { Boat } = await import('../src/boat.js');
	const bm = new Boltzmann(75, 75, 1, 90, 15, undefined, 1);
	const map = new Map(75, 75, 90, 15, bm);
	map.physics_model_init();
	const boat = new Boat(map, 10, -9, 5 * Math.PI / 4);
	// Same initial window main.js would place on the boat at (10, −9): the sail
	// sits in the middle of level 2, not on the coarse grid outside it.
	bm.addDomain(28, 9, 68, 49);
	bm.domains[0].addDomain(20, 20, 60, 60);
	const N = 80;
	for (let frame = 0; frame < N; frame++) {
		if (frame === 1) boat.input_autopilot_enabled_toggle();
		map.world.step(1 / 30);
		boat.physics_model_step();
		if (boat.mainsail_force) {
			for (const seg of boat.getSailSegments()) {
				bm.apply_energy_segment(seg.x0, seg.y0, seg.x1, seg.y1, seg.fx * 0.0003, seg.fy * 0.0003);
			}
		}
		bm.physics_model_step();
	}
	let minS = Infinity, maxS = 0, maxCurl = 0, maxU = 0, bad = 0;
	const consider = (c, wx, wy) => {
		if (!Number.isFinite(c.ux) || !Number.isFinite(c.uy) || !Number.isFinite(c.rho)) { bad++; return; }
		const speed = Math.hypot(c.ux, c.uy);
		maxU = Math.max(maxU, speed);
		if (Math.hypot(wx - boat.x, wy - boat.y) > 8) return;
		minS = Math.min(minS, speed);
		maxS = Math.max(maxS, speed);
		if (Number.isFinite(c.curl)) maxCurl = Math.max(maxCurl, Math.abs(c.curl));
	};
	for (let j = 0; j < bm.height; j++) {
		for (let i = 0; i < bm.width; i++) consider(bm.cells[i + j * bm.width], i - bm.width / 2, j - bm.height / 2);
	}
	const walk = (ds) => {
		for (const d of ds) {
			for (let fj = 0; fj < d.height; fj++) {
				for (let fi = 0; fi < d.width; fi++) {
					consider(d.cells[fi + fj * d.width],
						d.cx0_root + (fi - 1) * d.dx - bm.width / 2,
						d.cy0_root + (fj - 1) * d.dx - bm.height / 2);
				}
			}
			walk(d.domains);
		}
	};
	walk(bm.domains);
	results.boatWake = { minS, maxS, maxCurl, maxU, bad };
	check('boat energy leaves a wake', maxCurl > 0.02 && (maxS - minS) > 0.015,
		`near-boat |curl| = ${maxCurl.toExponential(3)}, speed ${minS.toFixed(3)}–${maxS.toFixed(3)}`);
	check('boat wake stays bounded', bad === 0 && maxU < 1, `max|u| = ${maxU.toExponential(3)}, bad = ${bad}`);
}

function fieldStats(bm) {
	let maxU = 0, bad = 0;
	const acc = (c) => {
		if (!Number.isFinite(c.rho) || !Number.isFinite(c.ux) || !Number.isFinite(c.uy)) { bad++; return; }
		maxU = Math.max(maxU, Math.hypot(c.ux, c.uy));
	};
	for (const c of bm.cells) acc(c);
	const walk = (ds) => { for (const d of ds) { for (const c of d.cells) acc(c); walk(d.domains); } };
	walk(bm.domains);
	return { maxU, bad };
}

console.log('MEASUREMENTS ' + JSON.stringify(results));
if (failed) {
	console.error(`${failed} check(s) failed`);
	process.exit(1);
}
console.log('all checks passed');
