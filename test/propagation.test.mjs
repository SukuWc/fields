// Perturbation propagation matrix (scripts/propagation.mjs): after exactly
// 30 frames, a vortex blob is carried U·t downwind and a density pulse's
// acoustic ring sits at radius c_s·t around the start + U·t, on every simRes
// mode, wind 0–10 m/s plus ~96 % of the fast modes' ceiling, refinement
// off / auto / forced, and wind from 90° (grid axis), 45° (diagonal) and
// 22.5°. t is the fluid time actually stepped: 1 s except x4 (7 of 7.5
// steps, 0.933 s).
//
// The vortex position is the ω² centroid over grid nodes, each on the finest
// grid that owns it (nodeCentroid), so no cross-level resampling enters it.
//
// Tolerances. Advection along the flow: |err| ≤ max(10 %, 0.15 root cell).
// The blob has σ = 1.5 root cells; the worst measured case is 4f at 2 m/s
// with auto refinement (−19…−23 %, 0.46 m = 0.12 cell) and 4f at 2 m/s
// unrefined (−11 %: BGK at τ ≈ 0.509 on a 1.5-cell blob). Cross-flow drift
// ≤ max(5 % of the travel (≈ 3° of direction), 0.15 root cell). Acoustic
// (loose): mean error of the 4 axis rays and of the 4 diagonal rays each
// ≤ max(10 %, 1.5 cells / radius) and their difference (isotropy) ≤ 10
// points; not asserted above the lattice-U 0.25 ceiling (10 m/s on 1 m /
// x2 / x4), where the plain BGK upwind/diagonal front breaks down.
//
// npm test runs a fast subset (wind 0 and 5 m/s, refinement off / auto,
// wind 90° and 45°); PROP_FULL=1 runs the full matrix.
import './dom-stub.mjs';
const P = await import('../scripts/propagation.mjs');

let failed = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
	if (!ok) failed++;
};
const FULL = !!process.env.PROP_FULL;
for (const from of FULL ? [90, 45, 22.5] : [90, 45])
for (const mode of Object.keys(P.MODES)) for (const w of P.winds(mode).filter((w) => FULL || w === 0 || w === 5)) for (const refine of FULL ? ['off', 'auto', 'forced'] : ['off', 'auto']) {
	const info = P.modeInfo(mode);
	const p = P.run(mode, w, 'pulse', refine, { from }), v = P.run(mode, w, 'vortex', refine, { from });
	const tag = `${mode} ${w} m/s from ${from}° ${refine}`;
	check(`${tag}: finite field`, !p.bad && !v.bad);
	const expA = w * v.t, errA = v.travelN - expA;
	check(`${tag}: vortex advected U·t along the wind`,
		Math.abs(errA) <= Math.max(0.10 * expA, 0.15 * info.cell) && Math.abs(v.lateralN) <= Math.max(0.05 * expA, 0.15 * info.cell),
		`${v.travelN.toFixed(2)} m vs ${expA.toFixed(2)} (cross ${v.lateralN.toFixed(2)}, ${v.dirErrN.toFixed(1)}°)`);
	if (p.ULat > 0.25) continue;
	const R = p.rays[0].exp, tol = Math.max(10, 100 * 1.5 * info.cell / R);
	check(`${tag}: acoustic ring ≈ c_s·t around the advected start, isotropic`,
		Math.abs(p.axisErr) <= tol && Math.abs(p.diagErr) <= tol && Math.abs(p.axisErr - p.diagErr) <= 10,
		`axis ${p.axisErr.toFixed(1)} % diag ${p.diagErr.toFixed(1)} %`);
}
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all propagation checks passed');
