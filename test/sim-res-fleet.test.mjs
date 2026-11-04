// Split from sim-res.test.mjs: section 6 two-boat flow and wind shadow, so the slow
// multi-boat sections run in parallel under node --test. Same checks, same pins.
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

// --- 6. Two boats: one flow where their grids overlap, and a wind shadow ---
// Same-depth grids of different boats are synced on coincident fluid nodes
// after every root step (Boltzmann._syncBoatOverlaps). Without that the
// downwind boat's grids never saw the upwind wake, and the scenario-1 number
// (1.16 / 0.40 / 0.07) was mostly the two grids disagreeing.
const S1 = [[12, -6, 5 * Math.PI / 4], [15, -11.5, 5 * Math.PI / 4]];
const INWAKE = [[12, -6, 5 * Math.PI / 4], [12, -13, 5 * Math.PI / 4]];
const s1 = {}, wk = {};
for (const k of KS) {
	const on = H.scenario1(k);
	const off = H.scenario1(k, { frames: 150, energy: false }); // freestream check: 150 frames (last 100 averaged) is enough
	s1[k] = on.tws0 - on.tws1;
	// Floor 0.1 → 0.08 with dinghy heel: at 15 m/s the boats are overpowered
	// and heeled, sail force × cos²(heel) weakens the wake (x4 0.13 → 0.10).
	check(`x${k} scenario 1 grids carry one flow; leeward boat sails in less wind`,
		on.overlapGap < 1e-12 && s1[k] > 0.08 && near(off.tws0, 15, 1e-6) && near(off.tws1, 15, 1e-6) && on.bad === 0 && on.maxU < 0.3,
		`windward ${on.tws0.toFixed(2)} leeward ${on.tws1.toFixed(2)} gap=${on.overlapGap.toExponential(1)}`);
	const w = H.wakeShadow(k, INWAKE);
	wk[k] = w.shadow;
	check(`x${k} boat directly downwind loses wind to the upwind sail`, w.shadow > (k === 4 ? 0.05 : 0.2) && w.overlapGap < 1e-12 && w.bad === 0,
		`TWS ${w.off.toFixed(2)} → ${w.on.toFixed(2)} (shadow ${w.shadow.toFixed(2)})`);
}
check('scenario 1 and in-wake shadows on x2 / x4 come close to Default',
	// #90: the boat reads true wind as a 1 m ring mean; the x4 in-wake shadow fell 0.12 → 0.06 (floor 0.2 × Default; per-boat floors 0.05 x4, 0.2 else).
	// Fixed 30 FPS: the x4 in-wake shadow fell 0.20 → 0.12 (the field advects 3× less per boat length); x4 floor 0.35 × Default.
	[2, 4].every(k => Math.abs(s1[k] - s1[1]) < 0.15 && wk[k] > (k === 4 ? 0.2 : 0.6) * wk[1]),
	`s1 ${KS.map(k => s1[k].toFixed(2)).join(' / ')} · in-wake ${KS.map(k => wk[k].toFixed(2)).join(' / ')}`);

if (failed) {
	console.error(`${failed} check(s) failed`);
	process.exit(1);
}
console.log('all sim-res-fleet checks passed');
