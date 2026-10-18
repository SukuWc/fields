// Perturbation propagation matrix. A uniform field gets a small, localised
import "../test/dom-stub.mjs";
// perturbation; after exactly 30 frames (1 s at 30 Hz) we measure how far it
// went:
//   pulse  — Gaussian density bump (ρ = 1 + 0.01·g). The acoustic ring's
//            peak radial velocity is located on the downwind and upwind rays;
//            expected c_s ± U (c_s = Δx / (Δt √3)).
//   vortex — small Gaussian vortex (peak |u'| = 0.1 U_lat, or 0.01 at U = 0).
//            The centroid of ω² (curl of u − U) should move U · 1 s downwind.
// Refinement: off (root only), auto (curl-driven trackBoats, no boats), or
// forced (a 2-level box around the start point, no tracking).
// Callers must install the DOM stubs first (test/dom-stub.mjs).
const { Boltzmann, FRAME_HZ } = await import('../src/boltzmann.js');
const { trackBoats } = await import('../src/domainTrack.js');

export const MODES = {
	1: { resolution: 1 }, 2: { resolution: 0.5 }, 4: { resolution: 0.25 },
	'2f': { resolution: 0.5, stepsPerFrame: 1 }, '2f34': { resolution: 0.5, stepsPerFrame: 1.2 }, '4f': { resolution: 0.25, stepsPerFrame: 1 },
};
const FRAMES = 30;

// Physical constants of a mode: cell (m), lattice step (s), c_s (m/s), and
// the stable ceiling (lattice U 0.25) in m/s.
export function modeInfo(mode) {
	const m = MODES[mode];
	const cell = 1 / m.resolution, spf = m.stepsPerFrame ?? m.resolution;
	const dt = 1 / (FRAME_HZ * spf);
	return { cell, spf, dt, cs: cell / (dt * Math.sqrt(3)), ceiling: 0.25 * cell / dt };
}

function world(mode, wind, side, from = 90) {
	const m = MODES[mode];
	const bm = new Boltzmann(side, side, 1, from, wind, undefined, 1);
	bm.amrMode = 'auto';
	bm.setResolution(m.resolution, m.stepsPerFrame);
	bm.setWindSpeed(wind);
	return bm;
}

// Every level's cells with their world position, root first.
function eachCell(bm, fn) {
	const W = bm.width, Hh = bm.height, r = bm.resolution;
	for (let y = 1; y < Hh - 1; y++) for (let x = 1; x < W - 1; x++) {
		fn(bm.cells[x + y * W], (x + 0.5 - W / 2) / r, (y + 0.5 - Hh / 2) / r);
	}
	const walk = (ds) => { for (const d of ds) {
		for (let j = 0; j < d.height; j++) for (let i = 0; i < d.width; i++) {
			// Fine node i coincides with root node cx0_root + (i − 2)·dx
			// (coarseX / Eq. 34); a root node sits at continuous x + 0.5.
			const cx = d.cx0_root + (i - 2) * d.dx + 0.5, cy = d.cy0_root + (j - 2) * d.dx + 0.5;
			fn(d.cells[i + j * d.width], (cx - W / 2) / r, (cy - Hh / 2) / r);
		}
		walk(d.domains);
	} };
	walk(bm.domains);
}

// One run. Returns measured distances (m) after 30 frames.
export function run(mode, wind, kind, refine, { y0 = 0, raw = false, from = 90 } = {}) {
	const info = modeInfo(mode);
	const reach = kind === 'pulse' ? info.cs + wind : wind;
	const sigma = 1.5 * info.cell;
	// Map: fronts plus 4σ and 3 cells of margin each way stay off the edges
	// (a square, so any wind direction fits).
	const side = Math.ceil((2 * (reach + 4 * sigma) + 6 * info.cell + 20) / info.cell) * info.cell;
	const bm = world(mode, wind, side, from);
	const U = bm.speed;
	// Flow (downwind) unit vector in world = lattice axes: from + 180°.
	const fr = (from + 180) * Math.PI / 180, ex = Math.cos(fr), ey = Math.sin(fr);
	const free = bm.get_field_velocity(0, y0);
	if (refine === 'forced') {
		// Two nested boxes centred on the start, ±(reach/2 + 3σ) world m.
		const half = Math.max(3, Math.round((reach / 2 + 3 * sigma) / info.cell));
		const c = Math.round(bm.width / 2), cy = Math.round(bm.height / 2 + y0 / info.cell);
		bm.addDomain(c - half, cy - half, c + half, cy + half);
		const d = bm.domains[0], h2 = Math.max(4, half);
		d.addDomain(2 + half - h2 / 2, 2 + half - h2 / 2, 2 + half + h2 / 2, 2 + half + h2 / 2);
	}
	const amp = kind === 'pulse' ? 0.01 : (U > 0 ? 0.1 * U : 0.01);
	const ux0 = Math.cos(bm.direction / 180 * Math.PI) * U, uy0 = Math.sin(bm.direction / 180 * Math.PI) * U;
	eachCell(bm, (cell, wx, wy) => {
		const dx = wx, dy = wy - y0, r2 = dx * dx + dy * dy, g = Math.exp(-r2 / (2 * sigma * sigma));
		if (g < 1e-6) return;
		if (kind === 'pulse') cell.setEquil(ux0, uy0, 1 + amp * g);
		else {
			// u_θ = amp · (r/σ) · e^{½} · g peaks at r = σ with |u'| = amp.
			const k = amp * Math.exp(0.5) * g / sigma;
			cell.setEquil(ux0 - k * dy, uy0 + k * dx, 1);
		}
	});
	let steps = 0;
	for (let f = 0; f < FRAMES; f++) {
		if (refine === 'auto' && bm.stepsDueThisFrame() > 0) trackBoats(bm, []);
		steps += bm.advance_frame();
	}
	const t = steps * info.dt; // fluid time actually simulated
	const out = { mode, wind, from, kind, refine, steps, t, cs: info.cs, side, ULat: U, levels: depth(bm) };
	let bad = false;
	eachCell(bm, (c) => { if (!Number.isFinite(c.rho) || !Number.isFinite(c.ux)) bad = true; });
	out.bad = bad;
	const h = Math.min(info.cell / 4, 0.5);
	// get_field_velocity maps a refined point with fineIndex(cx0, cx_cont),
	// which puts fine node 2 at continuous cx0 while the root's own lookup
	// puts root node cx0 at cx0 + 0.5: inside refinement the sample is half a
	// root cell off on both axes. sample() undoes that so the physics is
	// measured; opts.raw keeps the engine's lookup to show the offset.
	const half = 0.5 / bm.resolution;
	const sample = raw ? (x, y) => bm.get_field_velocity(x, y) : (x, y) => {
		const cx = bm.width / 2 + x * bm.resolution, cy = bm.height / 2 + y * bm.resolution;
		return bm._finestDomain(cx, cy) ? bm.get_field_velocity(x - half, y - half) : bm.get_field_velocity(x, y);
	};
	if (kind === 'pulse') {
		// Peak outward radial Δu along rays at grid angles 0, 45, …, 315°.
		// Expected: a circle of radius c_s·t centred at the start + U·t:
		// r(φ) = U t cos φ + √((c_s t)² − (U t sin φ)²), φ = ray vs flow.
		const ray = (ang) => {
			const cx = Math.cos(ang), cy = Math.sin(ang);
			let best = -Infinity, at = NaN;
			for (let s = 2 * sigma; s < side / 2 - 2 * info.cell; s += h) {
				const v = sample(cx * s, y0 + cy * s);
				const radial = cx * (v.x - free.x) + cy * (v.y - free.y);
				if (radial > best) { best = radial; at = s; }
			}
			return at;
		};
		out.rays = [];
		const ct = info.cs * t, ut = wind * t;
		for (let k = 0; k < 8; k++) {
			const ang = k * Math.PI / 4, cphi = Math.cos(ang) * ex + Math.sin(ang) * ey;
			const sphi = Math.sqrt(Math.max(0, 1 - cphi * cphi));
			out.rays.push({ deg: k * 45, meas: ray(ang), exp: ut * cphi + Math.sqrt(Math.max(0, ct * ct - ut * ut * sphi * sphi)) });
		}
		// Downwind / upwind along the flow itself (1 s nominal, as before).
		const along = (sgn) => {
			let best = -Infinity, at = NaN;
			for (let s = 2 * sigma; s < side / 2 - 2 * info.cell; s += h) {
				const v = sample(sgn * ex * s, y0 + sgn * ey * s);
				const radial = sgn * (ex * (v.x - free.x) + ey * (v.y - free.y));
				if (radial > best) { best = radial; at = s; }
			}
			return at;
		};
		out.down = along(1); out.up = along(-1);
		out.expDown = info.cs + wind; out.expUp = info.cs - wind;
		// Isotropy: mean axis-ray / diagonal-ray error vs expected (%).
		const e = (r) => (r.meas - r.exp) / r.exp;
		out.axisErr = 100 * [0, 2, 4, 6].reduce((a, k) => a + e(out.rays[k]), 0) / 4;
		out.diagErr = 100 * [1, 3, 5, 7].reduce((a, k) => a + e(out.rays[k]), 0) / 4;
	} else {
		// ω² centroid in a square window around start … 1.5× expected travel.
		const mx = ex * 0.75 * wind, my = y0 + ey * 0.75 * wind, hw = 0.75 * wind + 5 * sigma;
		const v = (x, y) => { const s = sample(x, y); return [s.x - free.x, s.y - free.y]; };
		let sw = 0, sy = 0, sx = 0;
		for (let y = my - hw; y <= my + hw; y += h) for (let x = mx - hw; x <= mx + hw; x += h) {
			const a = v(x + h, y), b = v(x - h, y), c = v(x, y + h), d = v(x, y - h);
			const w = (a[1] - b[1] - c[0] + d[0]) / (2 * h);
			const w2 = w * w; sw += w2; sy += w2 * y; sx += w2 * x;
		}
		const dx = sw > 0 ? sx / sw : NaN, dy = sw > 0 ? sy / sw - y0 : NaN;
		out.travel = dx * ex + dy * ey;            // along the flow
		out.lateral = -dx * ey + dy * ex;          // cross-flow (left +)
		out.dirErr = wind > 0 ? Math.atan2(out.lateral, out.travel) * 180 / Math.PI : 0;
		out.exp = wind * 1;
		out.expT = wind * t;
	}
	return out;
}

function depth(bm) {
	let n = 0, lvl = bm.domains;
	while (lvl.length) { n++; lvl = lvl.flatMap(d => d.domains); }
	return n;
}

export function winds(mode) {
	const base = [0, 2, 5, 10];
	const { ceiling } = modeInfo(mode);
	return ceiling > 10 ? [...base, Math.round(ceiling * 0.96)] : base;
}

// CLI: node --import ./test/register.mjs scripts/propagation.mjs [--from=90,45,22.5] [modes...]
if (process.argv[1] && process.argv[1].endsWith('propagation.mjs')) {
	const args = process.argv.slice(2);
	const fa = args.find((a) => a.startsWith('--from='));
	const froms = fa ? fa.slice(7).split(',').map(Number) : [90];
	const ms = args.filter((a) => !a.startsWith('--'));
	const modes = ms.length ? ms : Object.keys(MODES);
	const r2 = (x) => +x.toFixed(2);
	for (const from of froms) for (const mode of modes) for (const w of winds(mode)) for (const refine of ['off', 'auto', 'forced']) {
		const p = run(mode, w, 'pulse', refine, { from }), v = run(mode, w, 'vortex', refine, { from });
		const pct = (m, e) => e ? (100 * (m - e) / e).toFixed(1) : '—';
		console.log(JSON.stringify({ from, mode, w, refine, steps: p.steps, ULat: +p.ULat.toFixed(3), lv: [p.levels, v.levels],
			down: [r2(p.down), r2(p.expDown), pct(p.down, p.expDown)],
			up: [r2(p.up), r2(p.expUp), pct(p.up, p.expUp)],
			axisErr: r2(p.axisErr), diagErr: r2(p.diagErr),
			adv: [r2(v.travel), r2(v.expT), pct(v.travel, v.expT)], lat: r2(v.lateral), dirErr: r2(v.dirErr), bad: p.bad || v.bad }));
	}
}
