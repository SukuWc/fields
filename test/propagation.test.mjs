// Perturbation propagation matrix (scripts/propagation.mjs): after exactly
// 30 frames, a vortex blob is carried U·t downwind and a density pulse's
// acoustic ring sits at (c_s ± U)·t, on every simRes mode, wind 0–10 m/s plus
// ~96% of the fast modes' ceiling, refinement off / auto / forced.
// t is the fluid time actually stepped: 1 s except x4 (7 of 7.5 steps,
// 0.933 s); the table also prints the error against a nominal 1 s.
//
// Tolerances. Advection: |err| ≤ max(15 %, 0.3 root cell). The blob has
// σ = 1.5 root cells, so its ω² centroid resolves to a fraction of a cell
// (0.3 cell = 1.2 m at 4 m), and 15 % covers BGK dispersion up to Mach ~0.6
// and the refinement-interface pass. Lateral drift ≤ 0.3 cell. Acoustic
// (informational, loose): the ring's peak is read at root-node spacing, so
// |err| ≤ max(10 %, 1.5 cells); the upwind front is not asserted above the
// lattice-U 0.25 ceiling (wind 10 m/s on 1 m / x2 / x4).
import './dom-stub.mjs';
const P = await import('../scripts/propagation.mjs');

let failed = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
	if (!ok) failed++;
};
const rows = [];
// npm test runs a fast subset (wind 0 and 5 m/s, refinement off / auto);
// PROP_FULL=1 or scripts/propagation.mjs runs the full matrix.
const FULL = !!process.env.PROP_FULL;
for (const mode of Object.keys(P.MODES)) for (const w of P.winds(mode).filter((w) => FULL || w === 0 || w === 5)) for (const refine of FULL ? ['off', 'auto', 'forced'] : ['off', 'auto']) {
	const info = P.modeInfo(mode);
	const p = P.run(mode, w, 'pulse', refine), v = P.run(mode, w, 'vortex', refine);
	const tag = `${mode} ${w} m/s ${refine}`;
	check(`${tag}: finite field`, !p.bad && !v.bad);
	const expA = w * v.t, errA = v.travel - expA;
	check(`${tag}: vortex advected U·t`, Math.abs(errA) <= Math.max(0.15 * expA, 0.3 * info.cell) && Math.abs(v.lateral) <= 0.3 * info.cell,
		`${v.travel.toFixed(2)} m vs ${expA.toFixed(2)} (lateral ${v.lateral.toFixed(2)})`);
	const expD = (info.cs + w) * p.t, expU = (info.cs - w) * p.t;
	const tolA = (e) => Math.max(0.1 * e, 1.5 * info.cell);
	check(`${tag}: acoustic fronts ≈ (c_s ± U)·t`, Math.abs(p.down - expD) <= tolA(expD) && (p.ULat > 0.25 || Math.abs(p.up - expU) <= tolA(expU)),
		`down ${p.down.toFixed(1)}/${expD.toFixed(1)} up ${p.up.toFixed(1)}/${expU.toFixed(1)}`);
	rows.push({ mode, w, refine, p, v, info });
}
if (process.argv.includes('--table')) {
	const pct = (m, e) => (e ? (100 * (m - e) / e).toFixed(1) + '%' : '—');
	console.log('\n| mode | wind m/s | refine | steps | U_lat | downwind front m (meas / exp / err) | upwind front m | vortex travel m (meas / exp 1 s / err) | exp at actual t |');
	console.log('|---|---|---|---|---|---|---|---|---|');
	for (const { mode, w, refine, p, v } of rows) {
		console.log(`| ${mode} | ${w} | ${refine} | ${p.steps} | ${p.ULat.toFixed(3)} | ${p.down.toFixed(1)} / ${p.expDown.toFixed(1)} / ${pct(p.down, p.expDown)} | ${p.up.toFixed(1)} / ${p.expUp.toFixed(1)} / ${pct(p.up, p.expUp)} | ${v.travel.toFixed(2)} / ${w} / ${pct(v.travel, w)} | ${v.expT.toFixed(2)} |`);
	}
}
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all propagation checks passed');
