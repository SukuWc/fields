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

const { Boltzmann, unionMaskBorderLines, buildClosedDiskMask } = await import('../src/boltzmann.js');
const {
	trackBoats, DISK_RADIUS, DISK2_RADIUS, DISK3_RADIUS,
	MASK_CELL_CAP, MASK2_CELL_CAP, MASK3_CELL_CAP, normalizedCurl,
} = await import('../src/domainTrack.js');

const results = {};
let failed = 0;

function outlineCenter(domain, bm) {
	const lines = domain.worldBorderLines(bm).filter(s => !s.dim);
	if (!lines.length) return null;
	let sx = 0, sy = 0;
	for (const s of lines) { sx += s.x1; sy += s.y1; }
	return { x: sx / lines.length, y: sy / lines.length };
}

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
	const southSample = bm.get_field_velocity(0, -37.5);
	const nanSample = bm.get_field_velocity(NaN, 0);
	const boatCy = 75 / 2 + (-35.5);
	const cy = Math.round(boatCy);
	const cy0 = Math.max(1, cy - 20);
	const cy1 = Math.min(74, cy + 20);
	bm.addDomain(20, cy0, 55, cy1);
	bm.domains[0].setDisk(37.5, boatCy, 8);
	const southWithDomain = throwsAt(0, -37.5);
	const boatItself = throwsAt(0, -35.5);
	const inside = throwsAt(0, 0);
	results.oob = { southEdge, northEdge, southWithDomain, boatItself, inside, cy0, cy1 };
	check('edge wind sample does not throw', !southEdge && !northEdge && !southWithDomain && !inside && !boatItself);
	check('edge wind sample is finite', Number.isFinite(southSample.x) && Number.isFinite(southSample.y) && nanSample.x === 0 && nanSample.y === 0,
		`south=(${southSample.x}, ${southSample.y}) nan=(${nanSample.x}, ${nanSample.y})`);
}

function enclosedHole(domain) {
	if (!domain || !domain.mask) return false;
	const cw = domain.cx1 - domain.cx0;
	const ch = domain.cy1 - domain.cy0;
	const seen = new Uint8Array(cw * ch);
	const stack = [];
	const push = (i) => {
		if (i < 0 || i >= seen.length || seen[i] || domain.mask[i] === 1) return;
		seen[i] = 1;
		stack.push(i);
	};
	for (let x = 0; x < cw; x++) { push(x); push(x + (ch - 1) * cw); }
	for (let y = 0; y < ch; y++) { push(y * cw); push(cw - 1 + y * cw); }
	while (stack.length) {
		const i = stack.pop();
		const lx = i % cw;
		const ly = (i / cw) | 0;
		if (lx > 0) push(i - 1);
		if (lx + 1 < cw) push(i + 1);
		if (ly > 0) push(i - cw);
		if (ly + 1 < ch) push(i + cw);
	}
	for (let i = 0; i < seen.length; i++) if (domain.mask[i] !== 1 && !seen[i]) return true;
	return false;
}

// --- 8. Scenario 0 stays on the autopilot heading with a settled speed ---
// Open water only: the hull meets the map wall later and that is a separate limit.
{
	const { Map } = await import('../src/map.js');
	const { Boat } = await import('../src/boat.js');
	const { FluidWind, ConstantWind } = await import('../src/wind.js');
	const bm = new Boltzmann(75, 75, 1, 90, 15, undefined, 1);
	const map = new Map(75, 75, 90, 15, bm, new FluidWind(bm), new ConstantWind(90, 15));
	map.physics_model_init();
	const boat = new Boat(map, 10, -9, 5 * Math.PI / 4);
	let bmMs = 0;
	let diskOff = 0;
	const N = 600;
	let bsAt500 = 0;
	let floorMissing = 0;
	let floorMissing2 = 0;
	let floorMissing3 = 0;
	let holes = 0;
	let holes2 = 0;
	let holes3 = 0;
	let maxCells = 0;
	let maxCells2 = 0;
	let maxCells3 = 0;
	let maxExtra = 0;
	let maxExtra2 = 0;
	let maxExtra3 = 0;
	let maxAdded = 0;
	let maxAdded2 = 0;
	let maxAdded3 = 0;
	let maxNorm = 0;
	let maxNormDown = 0;
	let maxNormUp = 0;
	let maxNormOutside = 0;
	let sizeChanged = 0;
	let prevWorld = null;
	let prevExtra2 = null;
	let prevExtra3 = null;
	let tracked = null;
	let trackedW = 0;
	let trackedH = 0;
	let tracked2W = 0;
	let tracked3W = 0;
	let sizeChanged2 = 0;
	let sizeChanged3 = 0;
	const coverage = (domain, radius) => {
		if (!domain || !domain.mask || !domain.disk) return null;
		const floor = buildClosedDiskMask(
			domain.cx0, domain.cy0, domain.cx1, domain.cy1,
			domain.disk.cx, domain.disk.cy, radius,
			(cx, cy) => domain._parentAllows(cx, cy),
		);
		const cw = domain.cx1 - domain.cx0;
		const ch = domain.cy1 - domain.cy0;
		let missing = 0;
		let n = 0;
		const extra = new Set();
		for (let ly = 0; ly < ch; ly++) {
			for (let lx = 0; lx < cw; lx++) {
				const i = lx + ly * cw;
				const key = (domain.cx0 + lx) + ',' + (domain.cy0 + ly);
				if (floor[i] === 1 && domain.mask[i] !== 1) missing++;
				if (domain.mask[i] !== 1) continue;
				n++;
				if (floor[i] !== 1) extra.add(key);
			}
		}
		return { missing, n, extra };
	};
	for (let frame = 0; frame < N; frame++) {
		if (frame === 1) boat.input_autopilot_enabled_toggle();
		map.world.step(1 / 30);
		boat.physics_model_step();
		if (boat.mainsail_force) {
			for (const seg of boat.getSailSegments()) {
				bm.apply_energy_segment(seg.x0, seg.y0, seg.x1, seg.y1, seg.fx * 0.0003, seg.fy * 0.0003);
			}
		}
		trackBoats(bm, [boat]);
		const level1 = bm.domains[0];
		const boatCx = bm.width / 2 + boat.x;
		const boatCy = bm.height / 2 + boat.y;
		const floor = buildClosedDiskMask(
			level1.cx0, level1.cy0, level1.cx1, level1.cy1,
			boatCx, boatCy, DISK_RADIUS, null,
		);
		const world = new Set();
		const floorWorld = new Set();
		const cw = level1.cx1 - level1.cx0;
		const ch = level1.cy1 - level1.cy0;
		for (let ly = 0; ly < ch; ly++) {
			for (let lx = 0; lx < cw; lx++) {
				const cx = level1.cx0 + lx;
				const cy = level1.cy0 + ly;
				const key = cx + ',' + cy;
				if (floor[lx + ly * cw] === 1) floorWorld.add(key);
				if (level1.mask[lx + ly * cw] !== 1) continue;
				world.add(key);
			}
		}
		for (const key of floorWorld) if (!world.has(key)) floorMissing++;
		if (enclosedHole(level1)) holes++;
		if (world.size > maxCells) maxCells = world.size;
		const extra = world.size - floorWorld.size;
		if (extra > maxExtra) maxExtra = extra;
		if (level1 !== tracked) {
			tracked = level1;
			trackedW = cw;
			trackedH = ch;
			prevWorld = null;
		} else if (cw !== trackedW || ch !== trackedH) {
			sizeChanged++;
		}
		if (prevWorld) {
			let added = 0;
			for (const key of world) if (!prevWorld.has(key) && !floorWorld.has(key)) added++;
			if (added > maxAdded) maxAdded = added;
		}
		prevWorld = world;
		for (let ly = 0; ly < ch; ly++) {
			const cy = level1.cy0 + ly;
			for (let lx = 0; lx < cw; lx++) {
				const cx = level1.cx0 + lx;
				if (floor[lx + ly * cw] === 1) continue;
				const norm = normalizedCurl(bm.cells[cx + cy * bm.width].curl, bm.speed);
				if (norm > maxNorm) maxNorm = norm;
				if (cy + 0.5 < boatCy) { if (norm > maxNormDown) maxNormDown = norm; }
				else if (norm > maxNormUp) maxNormUp = norm;
				if (level1.mask[lx + ly * cw] !== 1 && norm > maxNormOutside) maxNormOutside = norm;
			}
		}
		const level2 = level1.domains[0];
		const level3 = level2 && level2.domains[0];
		const cov2 = coverage(level2, DISK2_RADIUS);
		const cov3 = coverage(level3, DISK3_RADIUS);
		if (!cov2) floorMissing2++;
		else {
			floorMissing2 += cov2.missing;
			if (cov2.n > maxCells2) maxCells2 = cov2.n;
			if (cov2.extra.size > maxExtra2) maxExtra2 = cov2.extra.size;
			if (level2.cx1 - level2.cx0 !== tracked2W && tracked2W !== 0) sizeChanged2++;
			tracked2W = level2.cx1 - level2.cx0;
			if (prevExtra2) {
				let added = 0;
				for (const key of cov2.extra) if (!prevExtra2.has(key)) added++;
				if (added > maxAdded2) maxAdded2 = added;
			}
			prevExtra2 = cov2.extra;
		}
		if (!cov3) floorMissing3++;
		else {
			floorMissing3 += cov3.missing;
			if (cov3.n > maxCells3) maxCells3 = cov3.n;
			if (cov3.extra.size > maxExtra3) maxExtra3 = cov3.extra.size;
			if (level3.cx1 - level3.cx0 !== tracked3W && tracked3W !== 0) sizeChanged3++;
			tracked3W = level3.cx1 - level3.cx0;
			if (prevExtra3) {
				let added = 0;
				for (const key of cov3.extra) if (!prevExtra3.has(key)) added++;
				if (added > maxAdded3) maxAdded3 = added;
			}
			prevExtra3 = cov3.extra;
		}
		if (enclosedHole(level2)) holes2++;
		if (enclosedHole(level3)) holes3++;
		const c1 = outlineCenter(level1, bm);
		const c2 = level2 ? outlineCenter(level2, bm) : null;
		const c3 = level3 ? outlineCenter(level3, bm) : null;
		const off1 = c1 ? Math.hypot(c1.x - boat.x, c1.y - boat.y) : Infinity;
		const off2 = c2 ? Math.hypot(c2.x - boat.x, c2.y - boat.y) : Infinity;
		const off3 = c3 ? Math.hypot(c3.x - boat.x, c3.y - boat.y) : Infinity;
		if (off1 > diskOff) diskOff = off1;
		if (off2 > diskOff) diskOff = off2;
		if (off3 > diskOff) diskOff = off3;
		const a = Date.now();
		bm.physics_model_step();
		bmMs += Date.now() - a;
		if (frame === 500) bsAt500 = Math.hypot(boat.physics_model.m_linearVelocity.x, boat.physics_model.m_linearVelocity.y);
	}
	const twa = boat.twa;
	const bs = Math.hypot(boat.physics_model.m_linearVelocity.x, boat.physics_model.m_linearVelocity.y);
	const st = fieldStats(bm);
	const stepMs = bmMs / N;
	const l2 = bm.domains[0].domains[0];
	const l3 = l2 && l2.domains[0];
	results.scenario0 = {
		twa, bs, tws: boat.wind_speed, stepMs, maxU: st.maxU, bad: st.bad, bsAt500,
		maxCells, maxExtra, maxAdded, floorMissing, holes, sizeChanged,
		maxCells2, maxExtra2, maxAdded2, floorMissing2, holes2, sizeChanged2,
		maxCells3, maxExtra3, maxAdded3, floorMissing3, holes3, sizeChanged3,
		maxNorm, maxNormDown, maxNormUp, maxNormOutside,
	};
	check('scenario 0 heading near 45°', Math.abs(twa) >= 40 && Math.abs(twa) <= 55, `twa = ${twa.toFixed(1)}`);
	check('scenario 0 speed settled', bs > 1.8 && bs < 2.8 && Math.abs(bs - bsAt500) < 0.15,
		`bs = ${bs.toFixed(3)} (at 500: ${bsAt500.toFixed(3)})`);
	check('scenario 0 wind still blowing', boat.wind_speed > 12 && st.bad === 0 && st.maxU < 0.3 && st.maxU > 0.1,
		`TWS = ${boat.wind_speed.toFixed(2)}, max|u| = ${st.maxU.toExponential(2)}, bad = ${st.bad}`);
	check('scenario 0 step stays cheap', stepMs < 12, `mean step ${stepMs.toFixed(2)} ms`);
	check('scenario 0 keeps nested level-2 and level-3 grids',
		bm.domains[0].disk && bm.domains[0].domains.length === 1 && !!(l2 && l3 && l2.domains.length === 1)
		&& bm.domains.slice(1).every(d => !d.disk));
	check('scenario 0 disk outlines stay on the boat', diskOff < 1,
		`max outline offset = ${diskOff.toExponential(2)} world units`);
	const boatCx = bm.width / 2 + boat.x, boatCy = bm.height / 2 + boat.y;
	const underDisk = bm.domains[0].containsCoarse(boatCx, boatCy);
	const fx = 1 + (boatCx - bm.domains[0].cx0) * 2, fy = 1 + (boatCy - bm.domains[0].cy0) * 2;
	const underFine = l2 && l2.containsCoarse(fx, fy);
	const f2x = l2 ? 1 + (fx - l2.cx0) * 2 : NaN, f2y = l2 ? 1 + (fy - l2.cy0) * 2 : NaN;
	const underL3 = l3 && l3.containsCoarse(f2x, f2y);
	check('scenario 0 boat stays under every disk floor', underDisk && underFine && underL3,
		`level1=${underDisk} level2=${underFine} level3=${underL3}`);
	check('scenario 0 disks stay closed', !bm.domains[0].hasDiagonalOnlyContact()
		&& l2 && !l2.hasDiagonalOnlyContact() && l3 && !l3.hasDiagonalOnlyContact());
	check('scenario 0 disk floors stay refined', floorMissing === 0 && floorMissing2 === 0 && floorMissing3 === 0,
		`missing L1=${floorMissing} L2=${floorMissing2} L3=${floorMissing3}`);
	check('scenario 0 masks have no enclosed hole', holes === 0 && holes2 === 0 && holes3 === 0,
		`frames L1=${holes} L2=${holes2} L3=${holes3}`);
	check('scenario 0 window sizes stay fixed', sizeChanged === 0 && sizeChanged2 === 0 && sizeChanged3 === 0,
		`changes L1=${sizeChanged} L2=${sizeChanged2} L3=${sizeChanged3}`);
	check('scenario 0 wake masks stay inside their cell caps',
		maxCells <= MASK_CELL_CAP + 16 && maxCells2 <= MASK2_CELL_CAP + 16 && maxCells3 <= MASK3_CELL_CAP + 16,
		`cells L1=${maxCells} L2=${maxCells2} L3=${maxCells3}`);
	check('scenario 0 wakes add at most one layer per frame',
		maxAdded <= 96 && maxAdded2 <= 128 && maxAdded3 <= 128,
		`additions L1=${maxAdded} L2=${maxAdded2} L3=${maxAdded3} extra L2=${maxExtra2} L3=${maxExtra3}`);
	let maxCurl = 0, minS = Infinity, maxS = 0;
	const d2 = bm.domains[0].domains[0];
	for (let fj = 1; fj < d2.height - 1; fj++) {
		for (let fi = 1; fi < d2.width - 1; fi++) {
			if (d2._role[fi + fj * d2.width] !== 1) continue;
			const c = d2.cells[fi + fj * d2.width];
			const wx = d2.cx0_root + (fi - 1) * d2.dx - bm.width / 2;
			const wy = d2.cy0_root + (fj - 1) * d2.dx - bm.height / 2;
			if (Math.hypot(wx - boat.x, wy - boat.y) > 8) continue;
			const speed = Math.hypot(c.ux, c.uy);
			minS = Math.min(minS, speed);
			maxS = Math.max(maxS, speed);
			if (Number.isFinite(c.curl)) maxCurl = Math.max(maxCurl, Math.abs(c.curl));
		}
	}
	results.scenario0.wake = { maxCurl, minS, maxS };
	check('scenario 0 wake is visible under the disk', maxCurl > 0.02 && (maxS - minS) > 0.015,
		`|curl| = ${maxCurl.toExponential(3)}, speed ${minS.toFixed(3)}–${maxS.toFixed(3)}`);
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
	bm.domains[0].setDisk(24, 24, 8);
	bm.domains[0].addDomain(16, 16, 48, 48);
	bm.domains[0].domains[0].setDisk(25, 25, 6);
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
	const { FluidWind, ConstantWind } = await import('../src/wind.js');
	const bm = new Boltzmann(75, 75, 1, 90, 15, undefined, 1);
	const map = new Map(75, 75, 90, 15, bm, new FluidWind(bm), new ConstantWind(90, 15));
	map.physics_model_init();
	const boat = new Boat(map, 10, -9, 5 * Math.PI / 4);
	// Same initial window main.js would place on the boat at (10, −9): the sail
	// sits in the middle of level 2, not on the coarse grid outside it.
	bm.addDomain(28, 9, 68, 49);
	const boatCx0 = 75 / 2 + 10, boatCy0 = 75 / 2 - 9;
	bm.domains[0].setDisk(boatCx0, boatCy0, 8);
	bm.domains[0].addDomain(20, 20, 60, 60);
	const fx0 = 1 + (boatCx0 - bm.domains[0].cx0) * 2;
	const fy0 = 1 + (boatCy0 - bm.domains[0].cy0) * 2;
	bm.domains[0].domains[0].setDisk(fx0, fy0, 8);
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

// --- 10. Disk mask: closure, overlap, uniform walk, shear ---
{
	const bm = make(64, 64, 15);
	bm.addDomain(8, 12, 48, 52);
	const d = bm.domains[0];
	let cx = 28, cy = 32;
	d.setDisk(cx, cy, 10);
	d.addDomain(22, 22, 62, 62);
	const child = d.domains[0];
	const fi = 1 + (cx - d.cx0) * 2;
	const fj = 1 + (cy - d.cy0) * 2;
	child.setDisk(fi, fj, 8);
	const lines = d.worldBorderLines(bm);
	const circle = lines.filter(s => !s.dim).length;
	const stair = lines.filter(s => s.dim).length;
	results.diskDraw = { circle, stair, mask: d.maskCount(), child: child.maskCount() };
	check('disk outline is a circle plus a staircase', circle >= 32 && stair > 8,
		`circle=${circle} stair=${stair}`);
	check('closed disk has no diagonal-only contact', !d.hasDiagonalOnlyContact() && !child.hasDiagonalOnlyContact());
	const counts = d.overlapCounts();
	check('disk boundary classifies edge and corner nodes', counts.edge > 0 && counts.corner > 0 && counts.fluid > 0,
		`fluid=${counts.fluid} edge=${counts.edge} corner=${counts.corner}`);
	// Several centers, including half-cell offsets that rasterize checkerboard steps.
	let closed = true;
	for (const [ox, oy, r] of [[0, 0, 9], [0.5, 0.2, 11], [0.3, 0.7, 7.5], [1.2, -0.4, 13]]) {
		d.setDisk(cx + ox, cy + oy, r);
		if (d.hasDiagonalOnlyContact()) closed = false;
	}
	d.setDisk(cx, cy, 10);
	check('closed mask stays free of diagonal contacts', closed);
	const area = d.maskCount();
	check('closure does not fill the window', area > 250 && area < 450, `mask cells = ${area}`);

	const { ux, uy } = windOf(bm);
	for (let i = 0; i < 20; i++) bm.physics_model_step();
	const stat = maxDeviation(bm, ux, uy);
	results.diskUniformStatic = stat;
	check('uniform wind, static disk', stat.dr < 1e-12 && stat.du < 1e-12,
		`|ρ−1| = ${stat.dr.toExponential(3)}, |u−uwind| = ${stat.du.toExponential(3)}`);

	for (let i = 0; i < 8; i++) {
		bm.shiftDomain(0, 1, 0);
		cx += 1;
		d.setDisk(cx, cy, 10);
		const fi2 = 1 + (cx - d.cx0) * 2;
		const fj2 = 1 + (cy - d.cy0) * 2;
		child.setDisk(fi2, fj2, 8);
		bm.physics_model_step();
	}
	const walked = maxDeviation(bm, ux, uy);
	results.diskUniformWalk = walked;
	check('uniform wind, walking disk', walked.dr < 1e-12 && walked.du < 1e-12,
		`|ρ−1| = ${walked.dr.toExponential(3)}, |u−uwind| = ${walked.du.toExponential(3)}`);
	check('walking disk stays closed', !d.hasDiagonalOnlyContact() && !child.hasDiagonalOnlyContact());
	check('nested disk survived the walk', d.domains[0] === child);
}

{
	// Pending sail kick survives a one-cell shift of a disk, then still sits on a fluid node.
	const bm = make(48, 48, 0);
	bm.addDomain(8, 8, 40, 40);
	const d = bm.domains[0];
	d.setDisk(24, 24, 8);
	const fi = 1 + (24 - d.cx0) * 2;
	const fj = 1 + (24 - d.cy0) * 2;
	d.pendingInjections.push({ fi, fj, fx: 0, fy: 0.02 });
	bm.shiftDomain(0, 1, 0);
	d.setDisk(25, 24, 8);
	const inj = d.pendingInjections[0];
	results.pendingShift = inj;
	check('pending injection survives a disk shift', d.pendingInjections.length === 1 && inj && d._isFluid(inj.fi, inj.fj),
		inj ? `fi=${inj.fi} fj=${inj.fj} fluid=${d._isFluid(inj.fi, inj.fj)}` : 'missing');
}

{
	// Two boats: union of masks, finest level wins, later sibling wins a tie.
	const bm = make(64, 64, 0);
	bm.addDomain(10, 16, 50, 56);
	bm.addDomain(10, 16, 50, 56);
	const a = bm.domains[0];
	const b = bm.domains[1];
	a.setDisk(28, 36, 8);
	b.setDisk(34, 36, 8);
	b.addDomain(20, 20, 60, 60);
	const overlap = 31; // coarse cell in both disks, and inside b's level-2 window
	const onlyA = 22;
	const onlyB = 40;
	b.domains[0].setDisk(1 + (overlap - b.cx0) * 2, 1 + (36 - b.cy0) * 2, 6);
	results.overlap = {
		a: a.levelAt(overlap, 36),
		b: b.levelAt(overlap, 36),
		aOwns: a._ownsWrite(overlap, 36),
		bOwns: b._ownsWrite(overlap, 36),
		onlyA: a._maskAt(onlyA, 36) && !b._maskAt(onlyA, 36),
		onlyB: b._maskAt(onlyB, 36) && !a._maskAt(onlyB, 36),
		sample: bm._finestDomain(overlap + 0.2, 36.2) === b,
	};
	check('overlap is the union of the two disks', results.overlap.onlyA && results.overlap.onlyB && a._maskAt(overlap, 36) && b._maskAt(overlap, 36));
	check('finest disk wins the overlap', results.overlap.b === 2 && results.overlap.a === 1 && !results.overlap.aOwns && results.overlap.bOwns && results.overlap.sample,
		JSON.stringify(results.overlap));
	// Same level, no child: the later domain writes.
	const bm2 = make(48, 48, 0);
	bm2.addDomain(8, 8, 40, 40);
	bm2.addDomain(8, 8, 40, 40);
	bm2.domains[0].setDisk(22, 24, 6);
	bm2.domains[1].setDisk(26, 24, 6);
	const tie = 24;
	check('same level, later disk writes', bm2.domains[1]._ownsWrite(tie, 24) && !bm2.domains[0]._ownsWrite(tie, 24)
		&& bm2._finestDomain(tie + 0.1, 24.1) === bm2.domains[1]);
}

// The level-1 window (28, 9) is not square in world space. Mapping the inner
// disk's Y through cx0_root used to draw it at world y = 10 while the boat
// was at y = -9.
{
	const bm = make(75, 75, 0);
	const boatX = 10, boatY = -9;
	const boatCx = 75 / 2 + boatX, boatCy = 75 / 2 + boatY;
	bm.addDomain(28, 9, 68, 49);
	bm.domains[0].setDisk(boatCx, boatCy, 8);
	const fx = 1 + (boatCx - 28) * 2, fy = 1 + (boatCy - 9) * 2;
	bm.domains[0].addDomain(20, 20, 60, 60);
	bm.domains[0].domains[0].setDisk(fx, fy, 8);
	const c1 = outlineCenter(bm.domains[0], bm);
	const c2 = outlineCenter(bm.domains[0].domains[0], bm);
	const e1 = Math.hypot(c1.x - boatX, c1.y - boatY);
	const e2 = Math.hypot(c2.x - boatX, c2.y - boatY);
	check('asymmetric window keeps both disks on the boat', e1 < 1e-9 && e2 < 1e-9,
		`offsets ${e1.toExponential(2)}, ${e2.toExponential(2)}`);
	// Boat leaves the window (restart). Replacing it once must not leave a second ring.
	bm.addDomain(2, 2, 30, 30);
	check('stray domain is present before retarget', bm.domains.length === 2);
	const nx = Math.round(boatCx), ny = Math.round(boatCy);
	const level1 = bm.replaceDomain(0, nx - 20, ny - 20, nx + 20, ny + 20);
	bm.domains.length = 1;
	bm._rebuildInteriorCells();
	level1.setDisk(boatCx, boatCy, 8);
	const nfx = 1 + (boatCx - level1.cx0) * 2, nfy = 1 + (boatCy - level1.cy0) * 2;
	const fi = Math.round(nfx), fj = Math.round(nfy);
	level1.replaceDomain(0, fi - 20, fj - 20, fi + 20, fj + 20);
	level1.domains[0].setDisk(nfx, nfy, 8);
	const d1 = outlineCenter(level1, bm);
	const d2 = outlineCenter(level1.domains[0], bm);
	check('retarget leaves one pair of disks on the boat', bm.domains.length === 1
		&& level1.domains.length === 1
		&& Math.hypot(d1.x - boatX, d1.y - boatY) < 1e-9
		&& Math.hypot(d2.x - boatX, d2.y - boatY) < 1e-9);
	// Slide the window and keep the mask center on a moving boat.
	let slideOff = 0;
	for (let step = 0; step < 6; step++) {
		const x = boatX - step * 0.4, y = boatY + step * 0.3;
		const cx = 75 / 2 + x, cy = 75 / 2 + y;
		level1.shiftBy(bm, -1, 0);
		level1.setDisk(cx, cy, 8);
		const sfx = 1 + (cx - level1.cx0) * 2, sfy = 1 + (cy - level1.cy0) * 2;
		const child = level1.domains[0];
		if (sfx < child.cx0 || sfy < child.cy0 || sfx >= child.cx1 || sfy >= child.cy1) {
			const sfi = Math.round(sfx), sfj = Math.round(sfy);
			level1.replaceDomain(0, sfi - 20, sfj - 20, sfi + 20, sfj + 20);
		}
		level1.domains[0].setDisk(sfx, sfy, 8);
		const p1 = outlineCenter(level1, bm);
		const p2 = outlineCenter(level1.domains[0], bm);
		slideOff = Math.max(slideOff, Math.hypot(p1.x - x, p1.y - y), Math.hypot(p2.x - x, p2.y - y));
	}
	check('sliding window keeps both disk centers on the boat', slideOff < 1e-9,
		`max offset ${slideOff.toExponential(2)}`);
}

{
	const ySample = 32;
	const xSample = 24;
	const bare = make(64, 64, 0);
	const uxAt = imposeShear(bare);
	for (let i = 0; i < 30; i++) bare.physics_model_step();
	const bare30 = shearStats(bare, null);

	function outsideDisk(bm, domain) {
		let mass = 0, outRho = 0;
		for (let y = 0; y < bm.height; y++) {
			for (let x = 0; x < bm.width; x++) {
				const c = bm.cells[x + y * bm.width];
				mass += c.rho - 1;
				if (!domain._maskAt(x, y)) outRho = Math.max(outRho, Math.abs(c.rho - 1));
			}
		}
		return { mass, outRho };
	}

	const bm = make(64, 64, 0);
	imposeShear(bm);
	bm.addDomain(12, 16, 52, 56);
	let cx = 32, cy = 36;
	bm.domains[0].setDisk(cx, cy, 10);
	bm.physics_model_step();
	const ux1 = bm.cells[xSample + ySample * bm.width].ux;
	const uxErr = Math.abs(ux1 - uxAt(ySample));
	results.shearDiskUx1 = { ux: ux1, err: uxErr };
	check('shear disk interior ux after 1 step', uxErr < 1e-4,
		`ux = ${ux1.toExponential(6)}, |ux−analytic| = ${uxErr.toExponential(3)}`);

	for (let i = 0; i < 29; i++) bm.physics_model_step();
	const st = outsideDisk(bm, bm.domains[0]);
	results.shearDiskStatic30 = st;
	check('shear disk outside density after 30 steps', st.outRho < bare30.outRho * 1.05 + 2e-4,
		`max |ρ−1| outside = ${st.outRho.toExponential(3)} (bare ${bare30.outRho.toExponential(3)})`);
	check('shear disk mass drift after 30 steps', Math.abs(st.mass) < 0.02,
		`Σ(ρ−1) = ${st.mass.toExponential(3)} (bare ${bare30.mass.toExponential(3)})`);

	const walk = make(64, 64, 0);
	imposeShear(walk);
	walk.addDomain(8, 20, 48, 60);
	let wcx = 28, wcy = 40;
	walk.domains[0].setDisk(wcx, wcy, 10);
	let walkOut = 0;
	let walkMass = 0;
	for (let i = 0; i < 10; i++) {
		walk.shiftDomain(0, 1, 0);
		wcx += 1;
		walk.domains[0].setDisk(wcx, wcy, 10);
		walk.physics_model_step();
		const s = outsideDisk(walk, walk.domains[0]);
		walkOut = Math.max(walkOut, s.outRho);
		walkMass = s.mass;
	}
	results.shearDiskWalk = { walkOut, walkMass, bare: bare30.outRho };
	// A flat edge on this shear stays within ~2e-4 of the bare run. The staircase
	// is a longer interface, so the outside density sits a little higher (7.5e-4
	// here) and still far under the old one-cell move, which reached 2.5e-3.
	check('shear walking disk stays quiet', walkOut < 1e-3 && Math.abs(walkMass) < 0.03,
		`max |ρ−1| outside = ${walkOut.toExponential(3)}, Σ(ρ−1) = ${walkMass.toExponential(3)} (bare ${bare30.outRho.toExponential(3)})`);
}

function segKey(s) {
	const r = (v) => Math.round(v * 1e6) / 1e6;
	const a = r(s.x1) + ',' + r(s.y1);
	const b = r(s.x2) + ',' + r(s.y2);
	return a < b ? a + '|' + b : b + '|' + a;
}

function stairKeys(domain, bm) {
	return domain.worldBorderLines(bm).filter(s => s.dim).map(segKey);
}

function unionKeys(domains, bm) {
	return unionMaskBorderLines(domains, bm).map(segKey);
}

// True when every union edge is an edge of some member, and the counts match
// exactly (no shared border) or the union is a strict subset (shared border dropped).
function borderRelation(domains, bm) {
	const own = [];
	for (const d of domains) own.push(...stairKeys(d, bm));
	const uni = unionKeys(domains, bm);
	const have = new Map();
	for (const k of own) have.set(k, (have.get(k) || 0) + 1);
	let subset = true;
	for (const k of uni) {
		const n = have.get(k) || 0;
		if (n <= 0) subset = false;
		else have.set(k, n - 1);
	}
	return { own: own.length, uni: uni.length, subset, merged: uni.length < own.length };
}

function maskShare(a, b) {
	if (!a || !b || !a.mask || !b.mask || Math.abs(a.dx - b.dx) > 1e-9) return false;
	const ka = new Set();
	const fill = (domain, into) => {
		const cw = domain.cx1 - domain.cx0;
		const s = domain.dx * 2;
		for (let ly = 0; ly < domain.cy1 - domain.cy0; ly++) {
			for (let lx = 0; lx < cw; lx++) {
				if (domain.mask[lx + ly * cw] !== 1) continue;
				const rx = Math.round(domain._rootX(domain.cx0 + lx) / s);
				const ry = Math.round(domain._rootY(domain.cy0 + ly) / s);
				into.add(rx + ',' + ry);
			}
		}
	};
	fill(a, ka);
	const cw = b.cx1 - b.cx0;
	const s = b.dx * 2;
	for (let ly = 0; ly < b.cy1 - b.cy0; ly++) {
		for (let lx = 0; lx < cw; lx++) {
			if (b.mask[lx + ly * cw] !== 1) continue;
			const rx = Math.round(b._rootX(b.cx0 + lx) / s);
			const ry = Math.round(b._rootY(b.cy0 + ly) / s);
			if (ka.has(rx + ',' + ry)) return true;
		}
	}
	return false;
}

// --- 11. Union staircase: one border where disks overlap, islands where they do not ---
{
	const bm = make(75, 75, 0);
	function place(cx, cy, r) {
		const x0 = Math.max(1, Math.round(cx) - 20);
		const y0 = Math.max(1, Math.round(cy) - 20);
		bm.addDomain(x0, y0, Math.min(bm.width - 1, Math.round(cx) + 20), Math.min(bm.height - 1, Math.round(cy) + 20));
		const d = bm.domains[bm.domains.length - 1];
		d.setDisk(cx, cy, r);
		return d;
	}
	const farA = place(20, 38, 8);
	const farB = place(55, 38, 8);
	const one = borderRelation([farA], bm);
	const apart = borderRelation([farA, farB], bm);
	check('one disk union stair matches that disk', one.subset && one.own === one.uni && one.own > 8,
		`own=${one.own} uni=${one.uni}`);
	check('apart disks keep two staircase islands', apart.subset && !apart.merged && apart.uni === apart.own && !maskShare(farA, farB),
		`own=${apart.own} uni=${apart.uni}`);

	bm.domains.length = 0;
	bm._rebuildInteriorCells();
	const nearA = place(30, 38, 10);
	const nearB = place(36, 38, 10);
	const close = borderRelation([nearA, nearB], bm);
	check('overlapping disks merge to one staircase', close.subset && close.merged && maskShare(nearA, nearB),
		`own=${close.own} uni=${close.uni}`);

	// Level 2, same two separations, in root space.
	function nest(parent, cx, cy, r) {
		const fx = 1 + (cx - parent.cx0) * 2;
		const fy = 1 + (cy - parent.cy0) * 2;
		const fi = Math.round(fx), fj = Math.round(fy);
		parent.addDomain(Math.max(1, fi - 20), Math.max(1, fj - 20), Math.min(parent.width - 1, fi + 20), Math.min(parent.height - 1, fj + 20));
		const child = parent.domains[parent.domains.length - 1];
		child.setDisk(fx, fy, r);
		return child;
	}
	bm.domains.length = 0;
	bm._rebuildInteriorCells();
	const p1 = place(20, 38, 8);
	const p2 = place(55, 38, 8);
	const c1 = nest(p1, 20, 38, 8);
	const c2 = nest(p2, 55, 38, 8);
	const l2apart = borderRelation([c1, c2], bm);
	check('apart level-2 disks keep two islands', l2apart.subset && !l2apart.merged && !maskShare(c1, c2),
		`own=${l2apart.own} uni=${l2apart.uni}`);

	bm.domains.length = 0;
	bm._rebuildInteriorCells();
	const q1 = place(30, 38, 8);
	const q2 = place(36, 38, 8);
	const d1 = nest(q1, 30, 38, 8);
	const d2 = nest(q2, 36, 38, 8);
	const l2close = borderRelation([d1, d2], bm);
	check('overlapping level-2 disks merge', l2close.subset && l2close.merged && maskShare(d1, d2),
		`own=${l2close.own} uni=${l2close.uni}`);
}

// A skipped boat must not donate its slot to the next boat.
{
	const bm = make(75, 75, 0);
	const refused = bm.replaceDomain(-1, 8, 8, 28, 28);
	check('negative domain index is refused', refused === null && bm.domains.length === 0 && bm.domains[-1] === undefined);
	const boats = [{ x: NaN, y: 0 }, { x: 5, y: -4 }];
	trackBoats(bm, boats);
	const kept = bm.domains[0];
	const keptCx = kept && kept.disk ? kept.disk.cx : NaN;
	check('skipped boat does not take a domain slot', bm.domains.length === 1 && Number.isFinite(keptCx));
	boats[0].x = -8;
	boats[0].y = 6;
	trackBoats(bm, boats);
	const second = bm.domains[1];
	check('recovered boat does not steal the other window', bm.domains.length === 2 && second === kept && second.disk.cx === keptCx,
		`len=${bm.domains.length} same=${second === kept}`);
	const child = bm.domains[0].replaceDomain(-1, 4, 4, 16, 16);
	check('negative child index is refused', child === null && bm.domains[0].domains.length === 1);
}

// --- 12. Scenarios 1–3: two boats, disks on each hull, union border follows the masks ---
{
	const { Map } = await import('../src/map.js');
	const { Boat } = await import('../src/boat.js');
	const { FluidWind, ConstantWind } = await import('../src/wind.js');

	function fleet(starts, frames) {
		const bm = new Boltzmann(75, 75, 1, 90, 15, undefined, 1);
		const map = new Map(75, 75, 90, 15, bm, new FluidWind(bm), new ConstantWind(90, 15));
		map.physics_model_init();
		const boats = starts.map(([x, y, h]) => new Boat(map, x, y, h));
		let maxOff = 0;
		for (let frame = 0; frame < frames; frame++) {
			if (frame === 1) for (const b of boats) b.input_autopilot_enabled_toggle();
			map.world.step(1 / 30);
			for (const b of boats) {
				b.physics_model_step();
				if (b.mainsail_force) {
					for (const seg of b.getSailSegments()) {
						bm.apply_energy_segment(seg.x0, seg.y0, seg.x1, seg.y1, seg.fx * 0.0003, seg.fy * 0.0003);
					}
				}
			}
			trackBoats(bm, boats);
			for (let i = 0; i < boats.length; i++) {
				const level1 = bm.domains[i];
				const c1 = level1 ? outlineCenter(level1, bm) : null;
				const c2 = level1 && level1.domains[0] ? outlineCenter(level1.domains[0], bm) : null;
				const o1 = c1 ? Math.hypot(c1.x - boats[i].x, c1.y - boats[i].y) : Infinity;
				const o2 = c2 ? Math.hypot(c2.x - boats[i].x, c2.y - boats[i].y) : Infinity;
				maxOff = Math.max(maxOff, o1, o2);
			}
			bm.physics_model_step();
		}
		return { bm, boats, maxOff };
	}

	function borderFollowsMasks(bm, label) {
		const a = bm.domains[0], b = bm.domains[1];
		const l1 = borderRelation([a, b], bm);
		const l2 = borderRelation([a.domains[0], b.domains[0]], bm);
		const share1 = maskShare(a, b);
		const share2 = maskShare(a.domains[0], b.domains[0]);
		check(label + ' level-1 border is the mask union', l1.subset && l1.merged === share1,
			`share=${share1} own=${l1.own} uni=${l1.uni}`);
		check(label + ' level-2 border is the mask union', l2.subset && l2.merged === share2,
			`share=${share2} own=${l2.own} uni=${l2.uni}`);
		let saw = 0, finestOk = true;
		const cw = a.cx1 - a.cx0;
		for (let ly = 0; ly < a.cy1 - a.cy0; ly++) {
			for (let lx = 0; lx < cw; lx++) {
				if (!a.mask || a.mask[lx + ly * cw] !== 1) continue;
				const cx = a.cx0 + lx, cy = a.cy0 + ly;
				if (!b._maskAt(cx, cy)) continue;
				saw++;
				const la = a.levelAt(cx, cy), lb = b.levelAt(cx, cy);
				const expect = lb > la ? b : a; // tie: later sibling (b) wins; a only when strictly finer
				if (lb === la) {
					if (bm._finestDomain(cx + 0.2, cy + 0.2) !== b || !b._ownsWrite(cx, cy)) finestOk = false;
				} else if (bm._finestDomain(cx + 0.2, cy + 0.2) !== expect || !expect._ownsWrite(cx, cy)) {
					finestOk = false;
				}
			}
		}
		return { saw, finestOk, share1, share2 };
	}

	const s1 = fleet([[12, -6, 5 * Math.PI / 4], [15, -11.5, 5 * Math.PI / 4]], 40);
	const st1 = fieldStats(s1.bm);
	const ov1 = borderFollowsMasks(s1.bm, 'scenario 1');
	results.scenario1 = { off: s1.maxOff, saw: ov1.saw, share1: ov1.share1, share2: ov1.share2, maxU: st1.maxU, bad: st1.bad };
	check('scenario 1 has two boats and two level-2 grids', s1.bm.domains.length >= 2
		&& s1.bm.domains[0].disk && s1.bm.domains[1].disk
		&& s1.bm.domains[0].domains.length === 1 && s1.bm.domains[1].domains.length === 1
		&& s1.bm.domains.slice(2).every(d => !d.disk));
	check('scenario 1 disk centers stay on each boat', s1.maxOff < 1, `max offset ${s1.maxOff.toExponential(2)}`);
	check('scenario 1 disks overlap and the finest writes', ov1.share1 && ov1.share2 && ov1.saw > 0 && ov1.finestOk,
		`shared=${ov1.saw} finest=${ov1.finestOk}`);
	check('scenario 1 fleet stays finite', st1.bad === 0 && st1.maxU < 1, `max|u|=${st1.maxU.toExponential(2)} bad=${st1.bad}`);

	const s2 = fleet([[-10, -6, 3 * Math.PI / 4], [15, -11.5, 5 * Math.PI / 4]], 50);
	const st2 = fieldStats(s2.bm);
	const ov2 = borderFollowsMasks(s2.bm, 'scenario 2');
	const dist2 = Math.hypot(s2.boats[0].x - s2.boats[1].x, s2.boats[0].y - s2.boats[1].y);
	results.scenario2 = { off: s2.maxOff, dist: dist2, share1: ov2.share1, share2: ov2.share2, maxU: st2.maxU, bad: st2.bad };
	check('scenario 2 has a domain on each boat', s2.bm.domains.length >= 2
		&& s2.bm.domains[0].disk && s2.bm.domains[1].disk
		&& s2.bm.domains[0].domains.length === 1 && s2.bm.domains[1].domains.length === 1
		&& s2.bm.domains.slice(2).every(d => !d.disk));
	check('scenario 2 disk centers stay on each boat', s2.maxOff < 1, `max offset ${s2.maxOff.toExponential(2)}`);
	check('scenario 2 level-2 islands are separate', !ov2.share2, `dist=${dist2.toFixed(2)}`);
	check('scenario 2 fleet stays finite', st2.bad === 0 && st2.maxU < 1, `max|u|=${st2.maxU.toExponential(2)} bad=${st2.bad}`);

	const s3 = fleet([[-3, -3, 3 * Math.PI / 4], [18, -11.5, 5 * Math.PI / 4]], 40);
	const st3 = fieldStats(s3.bm);
	const ov3 = borderFollowsMasks(s3.bm, 'scenario 3');
	const dist3 = Math.hypot(s3.boats[0].x - s3.boats[1].x, s3.boats[0].y - s3.boats[1].y);
	results.scenario3 = { off: s3.maxOff, dist: dist3, share1: ov3.share1, share2: ov3.share2, maxU: st3.maxU, bad: st3.bad };
	check('scenario 3 has a domain on each boat', s3.bm.domains.length >= 2
		&& s3.bm.domains[0].disk && s3.bm.domains[1].disk
		&& s3.bm.domains[0].domains.length === 1 && s3.bm.domains[1].domains.length === 1
		&& s3.bm.domains.slice(2).every(d => !d.disk));
	check('scenario 3 disk centers stay on each boat', s3.maxOff < 1, `max offset ${s3.maxOff.toExponential(2)}`);
	check('scenario 3 level-2 islands are separate', !ov3.share2, `dist=${dist3.toFixed(2)}`);
	check('scenario 3 fleet stays finite', st3.bad === 0 && st3.maxU < 1, `max|u|=${st3.maxU.toExponential(2)} bad=${st3.bad}`);
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
