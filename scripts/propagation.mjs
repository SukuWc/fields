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

function world(mode, wind, side) {
	const m = MODES[mode];
	const bm = new Boltzmann(side, side, 1, 90, wind, undefined, 1);
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
export function run(mode, wind, kind, refine, { y0 = 0, raw = false } = {}) {
	const info = modeInfo(mode);
	const reach = kind === 'pulse' ? info.cs + wind : wind;
	const sigma = 1.5 * info.cell;
	// Map: fronts plus 4σ and 3 cells of margin each way stay off the edges.
	const side = Math.ceil((2 * (reach + 4 * sigma) + 6 * info.cell + 20) / info.cell) * info.cell;
	const bm = world(mode, wind, side);
	const U = bm.speed; // lattice inlet, flow along −Y (wind from +Y)
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
	const out = { mode, wind, kind, refine, steps, t, cs: info.cs, side, ULat: U, levels: depth(bm) };
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
		// Peak outward radial Δu along each ray, beyond 2σ.
		const ray = (sgn) => {
			let best = -Infinity, at = NaN;
			for (let s = 2 * sigma; s < side / 2 - 2 * info.cell; s += h) {
				const v = sample(0, y0 + sgn * s);
				const radial = sgn * (v.y - free.y);
				if (radial > best) { best = radial; at = s; }
			}
			return at;
		};
		out.down = ray(-1); out.up = ray(+1);
		out.expDown = info.cs + wind; out.expUp = info.cs - wind;
	} else {
		// ω² centroid in a window covering start → 1.5× expected travel.
		const lo = y0 - 1.5 * wind - 5 * sigma, hi = y0 + 5 * sigma, wx = 5 * sigma;
		const v = (x, y) => { const s = sample(x, y); return [s.x - free.x, s.y - free.y]; };
		let sw = 0, sy = 0, sx = 0;
		for (let y = lo; y <= hi; y += h) for (let x = -wx; x <= wx; x += h) {
			const a = v(x + h, y), b = v(x - h, y), c = v(x, y + h), d = v(x, y - h);
			const w = (a[1] - b[1] - c[0] + d[0]) / (2 * h);
			const w2 = w * w; sw += w2; sy += w2 * y; sx += w2 * x;
		}
		out.travel = sw > 0 ? y0 - sy / sw : NaN; // downwind (−Y) is positive
		out.lateral = sw > 0 ? sx / sw : NaN;
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

// CLI: node --import ./test/register.mjs scripts/propagation.mjs [modes...]
if (process.argv[1] && process.argv[1].endsWith('propagation.mjs')) {
	const modes = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MODES);
	for (const mode of modes) for (const w of winds(mode)) for (const refine of ['off', 'auto', 'forced']) {
		const p = run(mode, w, 'pulse', refine), v = run(mode, w, 'vortex', refine);
		const pct = (m, e) => e ? (100 * (m - e) / e).toFixed(1) : '—';
		console.log(JSON.stringify({ mode, w, refine, steps: p.steps, ULat: +p.ULat.toFixed(3), lv: [p.levels, v.levels],
			down: [+p.down.toFixed(2), +p.expDown.toFixed(2), pct(p.down, p.expDown)],
			up: [+p.up.toFixed(2), +p.expUp.toFixed(2), pct(p.up, p.expUp)],
			adv: [+v.travel.toFixed(2), v.exp, pct(v.travel, v.exp), +v.expT.toFixed(2)], lat: +v.lateral.toFixed(2), bad: p.bad || v.bad }));
	}
}
