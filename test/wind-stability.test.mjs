// Barrier street across the UI wind range, refinement off, then refine-anywhere
// at wind 25. UI wind W is lattice inlet speed U = W/100. ν = 0.020 let W = 25
// diverge near frame 700; ν = 0.025 has to keep W = 5..25 smooth for 1500 frames.
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
const { trackBoats, FIELD_CELL_CAP, FIELD_DOMAIN_MAX, SEED_MIN } = await import('../src/domainTrack.js');

let failed = 0;
function check(name, cond, detail) {
	const ok = !!cond;
	if (!ok) failed++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + detail : ''}`);
	return ok;
}

// Upstream of the barrier (flow is toward −Y) plus a checkerboard inner product
// of speed. Neighbour-difference energy is the mean |Δspeed| between a cell and
// the one above it. A colormap cannot hide a cell-scale alternation: that shows
// up here as checker ~ O(U) and upNeigh ~ O(U).
function fieldNoise(bm) {
	const w = bm.width;
	const cx = w / 2, cy = bm.height / 2;
	let bad = 0, maxU = 0, maxDr = 0;
	let upDiff = 0, upN = 0, cb = 0, farN = 0;
	let edgeDiff = 0, edgeN = 0;
	const masked = (x, y) => {
		for (let i = 0; i < bm.domains.length; i++) {
			const d = bm.domains[i];
			if (d._maskAt && d._maskAt(x, y)) return true;
		}
		return false;
	};
	for (let y = 2; y < bm.height - 2; y++) {
		for (let x = 2; x < w - 2; x++) {
			const c = bm.cells[x + y * w];
			if (c.barrier) continue;
			if (!Number.isFinite(c.ux) || !Number.isFinite(c.uy) || !Number.isFinite(c.rho)) { bad++; continue; }
			const s = Math.hypot(c.ux, c.uy);
			if (s > maxU) maxU = s;
			const dr = Math.abs(c.rho - 1);
			if (dr > maxDr) maxDr = dr;
			if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > 18 * 18) {
				farN++;
				cb += s * (((x + y) & 1) ? -1 : 1);
			}
			if (y > cy + 22) {
				const n = bm.cells[x + (y + 1) * w];
				if (!n.barrier && Number.isFinite(n.ux)) {
					upDiff += Math.abs(s - Math.hypot(n.ux, n.uy));
					upN++;
				}
			}
			if (masked(x, y)) continue;
			if (masked(x + 1, y) || masked(x - 1, y) || masked(x, y + 1) || masked(x, y - 1)) {
				const n = bm.cells[x + 1 + y * w];
				if (!n.barrier && Number.isFinite(n.ux)) {
					edgeDiff += Math.abs(s - Math.hypot(n.ux, n.uy));
					edgeN++;
				}
			}
		}
	}
	let islands = 0, cells = 0;
	for (let i = 0; i < bm.domains.length; i++) {
		const d = bm.domains[i];
		if (d.disk) continue;
		islands++;
		if (!d.mask) continue;
		for (let k = 0; k < d.mask.length; k++) if (d.mask[k] === 1) cells++;
	}
	return {
		bad, maxU, maxDr,
		checker: farN ? cb / farN : 0,
		upNeigh: upN ? upDiff / upN : 0,
		edgeNeigh: edgeN ? edgeDiff / edgeN : 0,
		islands, cells,
	};
}

function run(ui, track, frames) {
	const bm = new Boltzmann(75, 75, 1, 90, ui, undefined, 1);
	bm.setBarriers(true);
	const worst = { bad: 0, maxU: 0, maxDr: 0, upNeigh: 0, checker: 0, edgeNeigh: 0, islands: 0, cells: 0 };
	// Cell indices. The barrier is centred on width/2 = 37.5, so 37 is the
	// column through the obstacle. Twelve cells downstream is inside the street.
	const px = 37;
	const py = 25;
	let uyMin = Infinity, uyMax = -Infinity;
	let diverge = null;
	for (let frame = 1; frame <= frames; frame++) {
		if (track) trackBoats(bm, []);
		bm.physics_model_step();
		if (frame % 25 !== 0 && frame !== frames) continue;
		const st = fieldNoise(bm);
		worst.bad += st.bad;
		if (st.maxU > worst.maxU) worst.maxU = st.maxU;
		if (st.maxDr > worst.maxDr) worst.maxDr = st.maxDr;
		if (st.upNeigh > worst.upNeigh) worst.upNeigh = st.upNeigh;
		if (Math.abs(st.checker) > Math.abs(worst.checker)) worst.checker = st.checker;
		if (st.edgeNeigh > worst.edgeNeigh) worst.edgeNeigh = st.edgeNeigh;
		worst.islands = st.islands;
		worst.cells = st.cells;
		if (frame >= 400) {
			const c = bm.cells[px + py * bm.width];
			if (c.uy < uyMin) uyMin = c.uy;
			if (c.uy > uyMax) uyMax = c.uy;
		}
		if (!diverge && (st.bad > 0 || st.maxU > 1 || st.maxDr > 0.5)) diverge = frame;
	}
	worst.diverge = diverge;
	worst.shed = Number.isFinite(uyMin) ? uyMax - uyMin : 0;
	worst.nu = bm.nu;
	const end = fieldNoise(bm);
	worst.endU = end.maxU;
	worst.endDr = end.maxDr;
	worst.endUp = end.upNeigh;
	worst.endChecker = end.checker;
	worst.endEdge = end.edgeNeigh;
	return worst;
}

// The first frames after the barrier appears carry a compressible startup
// pulse (max|ρ−1| about 0.34 at wind 25). Divergence is a later blowup to
// |u| ~ 10^3 and |ρ−1| ~ 10^14, so the run bound stays well under that.
// The settled field is what has to be smooth.
const survived = (st) => st.diverge === null && st.bad === 0 && st.maxU < 0.6 && st.maxDr < 0.5;
const settled = (st) => st.endU < 0.55 && st.endDr < 0.25 && st.endUp < 0.005 && Math.abs(st.endChecker) < 0.01;

const winds = [5, 8, 10, 12, 15, 18, 20, 25];
const sweep = {};
for (const ui of winds) {
	const st = run(ui, false, 1500);
	sweep[ui] = st;
	check(`barrier wind ${ui} stays smooth for 1500 frames`, survived(st) && settled(st),
		`div=${st.diverge} max|u|=${st.maxU.toFixed(3)} end|u|=${st.endU.toFixed(3)} max|ρ−1|=${st.maxDr.toFixed(3)} end|ρ−1|=${st.endDr.toFixed(3)} endUp=${st.endUp.toExponential(2)} endCb=${st.endChecker.toExponential(2)}`);
}

const at25 = sweep[25];
// One downstream probe. The settled street moves uy by a couple of hundredths;
// the freestream neighbour difference is ~4e-4, so this is the wake, not noise.
check('wind 25 still sheds', at25.shed > 0.01, `Δuy=${at25.shed.toFixed(4)}`);
check('viscosity is the 0.025 that cleared the sweep', Math.abs(at25.nu - 0.025) < 1e-12, `ν=${at25.nu}`);

const on = run(25, true, 1500);
check('wind 25 refine-anywhere stays smooth for 1500 frames', survived(on) && settled(on) && on.islands >= 1
	&& on.cells >= SEED_MIN && on.cells <= FIELD_CELL_CAP * FIELD_DOMAIN_MAX,
	`div=${on.diverge} end|u|=${on.endU.toFixed(3)} end|ρ−1|=${on.endDr.toFixed(3)} endUp=${on.endUp.toExponential(2)} islands=${on.islands} cells=${on.cells}`);
check('curl island edge does not speckle the freestream', on.endUp < 0.005 && on.endEdge < 0.08
	&& Math.abs(on.endU - at25.endU) < 0.1,
	`edgeNeigh=${on.endEdge.toExponential(2)} upNeigh=${on.endUp.toExponential(2)} end|u| on=${on.endU.toFixed(3)} off=${at25.endU.toFixed(3)}`);

if (failed) {
	console.error(`${failed} check(s) failed`);
	process.exit(1);
}
console.log('all wind-stability checks passed');
