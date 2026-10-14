// Headless runs of the main.js frame loop at a given simulation resolution.
// Used by test/sim-res.test.mjs and scripts/sim-res-check.mjs.
// Callers must install the DOM stubs before importing this module.
const { Boltzmann } = await import('../src/boltzmann.js');
const { trackBoats, amrParams } = await import('../src/domainTrack.js');
const { SAIL_LATTICE_COUPLING, Boat } = await import('../src/boat.js');
const { Map } = await import('../src/map.js');
const { FluidWind, ConstantWind } = await import('../src/wind.js');

export { Boltzmann, amrParams };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function fieldStats(bm) {
	let bad = 0, maxU = 0, maxDr = 0;
	for (let y = 1; y < bm.height - 1; y++) {
		for (let x = 1; x < bm.width - 1; x++) {
			const c = bm.cells[x + y * bm.width];
			if (c.barrier) continue;
			if (!Number.isFinite(c.ux) || !Number.isFinite(c.uy) || !Number.isFinite(c.rho)) { bad++; continue; }
			maxU = Math.max(maxU, Math.hypot(c.ux, c.uy));
			maxDr = Math.max(maxDr, Math.abs(c.rho - 1));
		}
	}
	return { bad, maxU, maxDr };
}

// One frame of main.js: boats, sail kicks (coupling × resolution²), tracking
// on stepping frames, advance_frame. Returns lattice ms and steps.
function frame(map, bm, boats, opts) {
	map.world.step(1 / 30);
	for (const boat of boats) {
		boat.physics_model_step();
		if (opts.energy !== false && boat.mainsail_force) {
			const eff = SAIL_LATTICE_COUPLING * bm.resolution * bm.resolution / (bm.velScale ?? 1);
			for (const seg of boat.getSailSegments()) {
				bm.apply_energy_segment(seg.x0, seg.y0, seg.x1, seg.y1, seg.fx * eff, seg.fy * eff);
			}
		}
	}
	const t0 = now();
	if (opts.amr !== false && bm.stepsDueThisFrame() > 0) trackBoats(bm, boats);
	const steps = bm.advance_frame();
	return { ms: now() - t0, steps };
}

// k is 1 / 2 / 4, or a fast-wind mode: '2f' (2 m cell, 1 step per frame),
// '2f34' (2 m cell, 1.2 steps per frame). Same table as main.js SIM_RES_MODES.
export const MODES = {
	1: { resolution: 1 }, 2: { resolution: 0.5 }, 4: { resolution: 0.25 },
	'2f': { resolution: 0.5, stepsPerFrame: 1 }, '2f34': { resolution: 0.5, stepsPerFrame: 1.2 }, '4f': { resolution: 0.25, stepsPerFrame: 1 },
};
// Map side for every world made after this call (75 = main.js default).
let MAP_SIDE = 75;
export function setMapSize(n) { MAP_SIDE = n; }
// Refinement layout for worlds made after this call: 'fixed' or 'auto'.
// 'auto' is the app and engine default; tests that pin main parity call
// setAmrMode('fixed').
let AMR_MODE = 'auto';
export function amrMode() { return AMR_MODE; }
// Cell-update budget for worlds made after this call (Infinity = off, the
// engine default; 'default' = the app's per-grid target).
let BUDGET = Infinity;
export function setBudget(n) { BUDGET = n; }
// Scenario 18 start positions (controls.js FLEET4), starboard close-hauled.
export const FLEET4 = [[14, -6], [24, -6], [19, -14], [29, -14]]
	.map(([x, y]) => [x, y, 5 * Math.PI / 4]);
export function setAmrMode(m) { AMR_MODE = m; }

export function makeWorld(k, wind = 15) {
	const bm = new Boltzmann(MAP_SIDE, MAP_SIDE, 1, 90, wind, undefined, 1);
	bm.amrMode = AMR_MODE === 'auto' ? 'auto' : 'fixed';
	bm.cellUpdateTarget = BUDGET;
	const m = MODES[k] || { resolution: 1 / k };
	if (k !== 1) bm.setResolution(m.resolution, m.stepsPerFrame);
	const map = new Map(MAP_SIDE, MAP_SIDE, 90, wind, bm, new FluidWind(bm), new ConstantWind(90, wind));
	map.physics_model_init();
	return { bm, map };
}

const speedOf = (b) => Math.hypot(b.physics_model.m_linearVelocity.x, b.physics_model.m_linearVelocity.y);

// Refined cells per boat level (mask cells, in each level's parent cells),
// coarsest first, summed over boats.
export function stackCells(bm) {
	const out = [];
	for (const top of bm.domains.filter(d => d.disk)) {
		let d = top, i = 0;
		while (d) {
			let n = 0;
			if (d.mask) for (let j = 0; j < d.mask.length; j++) n += d.mask[j] === 1;
			out[i] = (out[i] || 0) + n;
			d = d.domains[0]; i++;
		}
	}
	return out;
}

// Farthest refined cell of each level from (wx, wy), in world units, for the
// stack whose root window contains that point. Shows how far the wake reaches.
export function stackReach(bm, wx, wy) {
	const out = [];
	for (const top of bm.domains.filter(d => d.disk)) {
		let d = top, parent = bm, i = 0, any = false;
		while (d) {
			const cw = d.cx1 - d.cx0;
			let far = 0;
			for (let ly = 0; ly < d.cy1 - d.cy0; ly++) for (let lx = 0; lx < cw; lx++) {
				if (d.mask && d.mask[lx + ly * cw] !== 1) continue;
				const c = d.cx0 + lx + 0.5, r = d.cy0 + ly + 0.5;
				const rx = parent === bm ? c : parent.fineToRootX(c);
				const ry = parent === bm ? r : parent.fineToRootY(r);
				const x = (rx - bm.width / 2) / bm.resolution, y = (ry - bm.height / 2) / bm.resolution;
				far = Math.max(far, Math.hypot(x - wx, y - wy));
			}
			if (i === 0 && far > 80) break;
			out[i] = far; any = true;
			parent = d; d = d.domains[0]; i++;
		}
		if (any && out.length) return out;
	}
	return out;
}

// Scenario 0: one boat close-hauled on autopilot.
export function scenario0(k, { frames = 600, amr = true, energy = true } = {}) {
	const { bm, map } = makeWorld(k);
	const boat = new Boat(map, 10, -9, 5 * Math.PI / 4);
	let ms = 0, steps = 0, bsAt500 = 0, twaMin = Infinity, twaMax = -Infinity, tws = 0, twsN = 0;
	for (let f = 0; f < frames; f++) {
		if (f === 1) boat.input_autopilot_enabled_toggle();
		const r = frame(map, bm, [boat], { amr, energy });
		ms += r.ms; steps += r.steps;
		if (f === 500) bsAt500 = speedOf(boat);
		if (f >= frames - 100) {
			twaMin = Math.min(twaMin, boat.twa); twaMax = Math.max(twaMax, boat.twa);
			tws += boat.wind_speed; twsN++;
		}
	}
	const st = fieldStats(bm);
	// Boat stack depth and the finest world cell at the boat.
	let depth = 0;
	for (let d = bm.domains[0]; d; d = d.domains[0]) depth++;
	const finestStep = bm._worldStepAt(boat.x, boat.y);
	return {
		k, amr, depth, finestStep, twa: boat.twa, twaSpread: twaMax - twaMin, bs: speedOf(boat), bsAt500,
		tws: tws / twsN, msPerFrame: ms / frames, msPerStep: steps ? ms / steps : 0, steps,
		cells: bm.width * bm.height, stack: stackCells(bm), ...st, capHits: bm.capHits, domains: bm.domains.length,
	};
}

// Fleet run: boats [x, y, heading], autopilot on at frame 1, optional
// tack per boat at a frame. TWS of each boat over the last 100 frames.
// kick[i] false turns boat i's sail push off (to isolate another boat's wake).
export function fleet(k, boatsSpec, { frames = 300, kick = null, tacks = {}, amr = true, timing = false, series = false } = {}) {
	const opts_series = series;
	const { bm, map } = makeWorld(k);
	const boats = boatsSpec.map(([x, y, h]) => new Boat(map, x, y, h));
	const tws = boats.map(() => 0);
	let n = 0, maxU = 0, bad = 0, minGap = Infinity, fieldMs = 0, churn = 0, churnN = 0, prevStack = null;
	const twsSeries = boats.map(() => []);
	const loadSeries = [], scaleSeries = [];
	for (let f = 0; f < frames; f++) {
		if (f === 1) boats.forEach(b => b.input_autopilot_enabled_toggle());
		for (const [i, at] of Object.entries(tacks)) if (f === at) boats[i].input_autopilot_tack_toggle();
		map.world.step(1 / 30);
		boats.forEach((b, i) => {
			b.physics_model_step();
			if ((!kick || kick[i]) && b.mainsail_force) {
				const eff = SAIL_LATTICE_COUPLING * bm.resolution * bm.resolution / (bm.velScale ?? 1);
				for (const seg of b.getSailSegments()) bm.apply_energy_segment(seg.x0, seg.y0, seg.x1, seg.y1, seg.fx * eff, seg.fy * eff);
			}
		});
		const t0 = now();
		if (amr && bm.stepsDueThisFrame() > 0) trackBoats(bm, boats);
		bm.advance_frame();
		if (timing && f >= 50) fieldMs += now() - t0;
		if (opts_series) { loadSeries.push(bm.cellUpdates()); scaleSeries.push(bm.curlScale); }
		if (f >= frames - 100) { boats.forEach((b, i) => { tws[i] += b.wind_speed; twsSeries[i].push(b.wind_speed); }); n++; }
		if (f >= frames - 200) {
			const st = stackCells(bm);
			if (prevStack) { churn += st.reduce((a, v, j) => a + Math.abs(v - (prevStack[j] || 0)), 0); churnN++; }
			prevStack = st;
		}
		if (!timing && f % 25 === 24) {
			const st = fieldStats(bm);
			maxU = Math.max(maxU, st.maxU); bad += st.bad;
			minGap = Math.min(minGap, overlapGap(bm));
		}
	}
	const extra = { loadSeries, scaleSeries };
	const twsJitter = twsSeries.map(a => { let d = 0; for (let j = 1; j < a.length; j++) d = Math.max(d, Math.abs(a[j] - a[j - 1])); return d; });
	return { ...extra, k, bm, boats, tws: tws.map(t => t / n), twsJitter, churn: churnN ? churn / churnN : 0, stack: stackCells(bm), maxU, bad, msPerFrame: fieldMs / Math.max(1, frames - 50), overlapGap: minGap === Infinity ? 0 : -minGap };
}

// Largest population mismatch between coincident fluid nodes of two boats'
// same-depth grids (returned negated so min() keeps the worst). 0 = one flow.
function overlapGap(bm) {
	let worst = 0;
	let level = bm.domains.filter(d => d.disk);
	while (level.length > 1) {
		for (let a = 0; a < level.length; a++) for (let b = a + 1; b < level.length; b++) {
			const A = level[a], B = level[b];
			if (A.dx !== B.dx) continue;
			const ox = Math.round((A.cx0_root - B.cx0_root) / A.dx);
			const oy = Math.round((A.cy0_root - B.cy0_root) / A.dx);
			for (let fj = 0; fj < A.height; fj++) for (let fi = 0; fi < A.width; fi++) {
				const gi = fi + ox, gj = fj + oy;
				if (!A._isFluid(fi, fj) || !B._isFluid(gi, gj)) continue;
				const ca = A.cells[fi + fj * A.width], cb = B.cells[gi + gj * B.width];
				worst = Math.max(worst, Math.abs(ca.fN - cb.fN), Math.abs(ca.fE - cb.fE), Math.abs(ca.fNE - cb.fNE));
			}
		}
		level = level.flatMap(d => d.domains);
	}
	return -worst;
}

// Scenario 1: boat 1 clear astern and to leeward of boat 0.
export function scenario1(k, { frames = 300, energy = true } = {}) {
	const r = fleet(k, [[12, -6, 5 * Math.PI / 4], [15, -11.5, 5 * Math.PI / 4]], { frames, kick: energy ? null : [false, false] });
	return { k, energy, tws0: r.tws[0], tws1: r.tws[1], maxU: r.maxU, bad: r.bad, overlapGap: r.overlapGap };
}

// Wind shadow from the upwind boat alone: the downwind boat's TWS with the
// upwind boat's sail push on minus off (downwind boat's own push on in both).
export function wakeShadow(k, spec, opts = {}) {
	const on = fleet(k, spec, opts);
	const off = fleet(k, spec, { ...opts, kick: [false, true] });
	return { k, on: on.tws[1], off: off.tws[1], shadow: off.tws[1] - on.tws[1], maxU: on.maxU, bad: on.bad, overlapGap: on.overlapGap };
}

// Barrier at the map centre, no boats. Frame loop with tracking (refine
// anywhere) or without.
export function barrier(k, wind, { frames = 1500, amr = false } = {}) {
	const { bm } = makeWorld(k, wind);
	bm.setBarriers(true);
	let diverge = null, worstU = 0, worstDr = 0, islands = 0, ms = 0, steps = 0;
	for (let f = 1; f <= frames; f++) {
		const t0 = now();
		if (amr && bm.stepsDueThisFrame() > 0) trackBoats(bm, []);
		steps += bm.advance_frame();
		ms += now() - t0;
		if (f % 25 && f !== frames) continue;
		const st = fieldStats(bm);
		if (f >= 300) { worstU = Math.max(worstU, st.maxU); worstDr = Math.max(worstDr, st.maxDr); }
		if (!diverge && (st.bad > 0 || st.maxU > 1 || st.maxDr > 0.5)) diverge = f;
		islands = Math.max(islands, bm.domains.length);
	}
	const end = fieldStats(bm);
	return { k, wind, amr, diverge, worstU, worstDr, endU: end.maxU, endDr: end.maxDr, bad: end.bad, islands, msPerFrame: ms / frames, steps, bm };
}
