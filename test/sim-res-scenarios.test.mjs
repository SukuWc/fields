// Split from sim-res.test.mjs: section 6 scenarios 2 and 3 (parallel under node --test).
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

for (const [name, spec, tacks] of [
	['scenario 2', [[-10, -6, 3 * Math.PI / 4], [15, -11.5, 5 * Math.PI / 4]], {}],
	['scenario 3', [[-3, -3, 3 * Math.PI / 4], [18, -11.5, 5 * Math.PI / 4]], { 0: 350 }],
]) {
	for (const k of KS) {
		const r = H.fleet(k, spec, { frames: 500, tacks });
		check(`x${k} ${name} stays finite with one flow`, r.bad === 0 && r.maxU < 0.3 && r.overlapGap < 1e-12
			&& r.boats.every(b => Number.isFinite(b.x) && b.wind_speed > 10),
			`max|u|=${r.maxU.toFixed(3)} TWS ${r.tws.map(t => t.toFixed(2)).join(' / ')}`);
	}
}

if (failed) {
	console.error(`${failed} check(s) failed`);
	process.exit(1);
}
console.log('all sim-res-scenarios checks passed');
