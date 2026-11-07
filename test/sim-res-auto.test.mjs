// Split from sim-res.test.mjs: section 9 (auto refinement), parallel under node --test.
// Simulation resolution setting (Default / x2 / x4 coarser root grid).
// Scaling: lattice U and ν fixed, root cell k = 1/resolution world units,
// resolution lattice steps per frame. See Boltzmann.setResolution.
import './dom-stub.mjs';
// Pins the full pre-#86 stack: main-parity numbers and stack structure.
await import('./full-stack.mjs');

const H = await import('../scripts/sim-res-harness.mjs');
const { Boltzmann, amrParams } = H;
const { SAIL_LATTICE_COUPLING } = await import('../src/boat.js');
const D = await import('../src/domainTrack.js');
const { FieldPainter } = await import('../src/fieldPainter.js');

let failed = 0;
function check(name, cond, detail) {
	const ok = !!cond;
	if (!ok) failed++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + detail : ''}`);
	return ok;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;


H.setAmrMode('fixed');
const KS = [1, 2, 4];
const INWAKE = [[12, -6, 5 * Math.PI / 4], [12, -13, 5 * Math.PI / 4]];

// --- 9. Holds in seconds, and ?amrMode=auto (finest disk + grading shell + curl) ---
{
	const holds = [[1, 1, 6], [0.5, 0.5, 3], [0.25, 0.25, 2], [0.5, 1, 6]]
		.map(([res, spf, want]) => ({ want, got: amrParams({ cellSize: 1 / res, stepsPerFrame: spf }).hold, secs: amrParams({ cellSize: 1 / res, stepsPerFrame: spf }).hold / (30 * spf) }));
	check('curl hold is ~0.2 s on every setting (Default / x2 / x4 / 2f)',
		holds.every(h => h.got === h.want && h.secs >= 0.19 && h.secs <= 0.27), holds.map(h => `${h.got} (${h.secs.toFixed(3)} s)`).join(' / '));
	const a1 = amrParams({ cellSize: 1, amrMode: 'auto' });
	const a2 = amrParams({ cellSize: 2, stepsPerFrame: 0.5, amrMode: 'auto' });
	check('auto: finest disk R2 fixed, coarser floors are the 3-cell grading shell',
		a1.auto && a1.levels.map(l => l.worldRadius).join() === '4.25,2.75,2' && a2.levels.map(l => l.worldRadius).join() === '7.25,4.25,2.75,2'
		&& a1.levels.every((l, i) => l.cap === amrParams({ cellSize: 1 }).levels[i].cap),
		`Default ${a1.levels.map(l => l.worldRadius).join('/')} · x2 ${a2.levels.map(l => l.worldRadius).join('/')}`);
	// Every refined child cell sits AUTO_SHELL − 1 own cells inside its parent's
	// refined region (one cell of lag allowed), unless that is off the window.
	const D_AUTO = D.AUTO_SHELL;
	const shellOk = (bm) => {
		let worst = Infinity;
		for (let D = bm.domains.find(d => d.disk); D && D.domains[0]; D = D.domains[0]) {
			const C = D.domains[0], ccw = C.cx1 - C.cx0;
			for (let ly = 0; ly < C.cy1 - C.cy0; ly++) for (let lx = 0; lx < ccw; lx++) {
				if (C.mask[lx + ly * ccw] !== 1) continue;
				for (let d = 1; d <= D_AUTO - 1; d++) for (const [ox, oy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
					const px = Math.floor(D.coarseX(C.cx0 + lx + ox)), py = Math.floor(D.coarseY(C.cy0 + ly + oy));
					if (px < D.cx0 + 1 || py < D.cy0 + 1 || px >= D.cx1 - 1 || py >= D.cy1 - 1) continue;
					if (!D._maskAt(px, py)) worst = Math.min(worst, d - 1);
				}
			}
		}
		return worst;
	};
	H.setAmrMode('auto');
	for (const k of [1, 2, '2f']) {
		const r = H.fleet(k, [[10, -9, 5 * Math.PI / 4]], { frames: 400 });
		const w = shellOk(r.bm);
		const reach = H.stackReach(r.bm, r.boats[0].x, r.boats[0].y);
		check(`auto ${k}: grading shell holds (≥ 2 own cells) and the wake is refined downstream`,
			w === Infinity && r.bad === 0 && reach.length >= 3 && reach[0] > 12 && r.stack[r.stack.length - 1] > 0,
			`margin ${w === Infinity ? '≥2' : w} reach ${reach.map(v => v.toFixed(1)).join('/')} cells ${r.stack.join('/')}`);
	}
	const s0 = H.scenario0(1);
	const wk = H.wakeShadow(1, INWAKE);
	check(// Fixed 30 FPS: −49.428 / 2.129 → −49.305 / 2.8465.
	// #90 (1 m ring): −49.3048 / 2.8465 → −49.3557 / 2.8526.
	// #103 point true wind (Default has no force undo): → −49.3048 / 2.8465.
	// Dinghy heel (crew holds 5°, sail force × cos²): → −49.3231 / 2.8330.
	// Sail CE leeward offset (weather helm via h·sinφ): → −47.5247 / 2.7094.
	// CE + CLR offsets (ceLateralHeight 0.5, clrDepth 0.5): → −48.9011 / 2.8087.
	// Sail AWS in m/s + hull drag (dinghy-forces.js): → −48.4890 / 2.2780.
	// Rigid body 139 kg: → −48.6747 / 2.4076.
	// Explicit foils + hull-drag offset: → −51.1980 / 2.4524.
	'auto Default scenario 0 pinned: twa −51.20, bs 2.452',
		near(s0.twa, -51.1980, 0.01) && near(s0.bs, 2.4524, 0.002), `twa=${s0.twa.toFixed(4)} bs=${s0.bs.toFixed(4)}`);
	H.setAmrMode('fixed');
	check('auto Default scenario 0 close-hauled and the in-wake shadow is at least the fixed one',
		s0.twa < -45 && s0.twa > -54 && s0.bs > 2.0 && s0.bs < 2.6 && wk.shadow > 0.4 && wk.overlapGap < 1e-12,
		`twa=${s0.twa.toFixed(2)} bs=${s0.bs.toFixed(3)} in-wake ${wk.shadow.toFixed(2)}`);
}

if (failed) {
	console.error(`${failed} check(s) failed`);
	process.exit(1);
}
console.log('all sim-res-auto checks passed');
