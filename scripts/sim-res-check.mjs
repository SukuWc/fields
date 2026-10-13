// Performance table for the Simulation resolution setting: scenario 0,
// 600 frames, AMR on and off. ms covers tracking + lattice steps (no paint).
// node --import ./test/register.mjs scripts/sim-res-check.mjs
import '../test/dom-stub.mjs';
const H = await import('./sim-res-harness.mjs');
// Measures the default layout (amrMode auto); pass --fixed for the fixed rings.
if (process.argv.includes('--fixed')) H.setAmrMode('fixed');
console.log(`amrMode: ${H.amrMode()}`);
const rows = [];
for (const amr of [true, false]) {
	for (const k of [1, 2, 4]) {
		H.scenario0(k, { frames: 60, amr }); // warm-up
		const runs = [H.scenario0(k, { frames: 600, amr }), H.scenario0(k, { frames: 600, amr })];
		const r = runs[1];
		const msF = (runs[0].msPerFrame + runs[1].msPerFrame) / 2;
		const msS = (runs[0].msPerStep + runs[1].msPerStep) / 2;
		rows.push({ setting: k === 1 ? 'Default' : `x${k}`, amr, cells: r.cells, msPerStep: +msS.toFixed(2), msPerFrame: +msF.toFixed(2), twa: +r.twa.toFixed(2), bs: +r.bs.toFixed(3), tws: +r.tws.toFixed(2) });
	}
}
console.table(rows);
console.log(JSON.stringify(rows));
