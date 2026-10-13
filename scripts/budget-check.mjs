// Refinement budget (bm.cellUpdateTarget) checks on one grid setting.
// node --import ./test/register.mjs scripts/budget-check.mjs <k> [--quick]
// Measures amrMode auto (the default). Budget 'default' = the app's per-grid
// target (domainTrack.defaultCellUpdateTarget), 'off' = Infinity.
import '../test/dom-stub.mjs';
const H = await import('./sim-res-harness.mjs');
const { defaultCellUpdateTarget } = await import('../src/domainTrack.js');
const arg = process.argv[2] ?? '1';
const k = isNaN(+arg) ? arg : +arg;
const frames = process.argv.includes('--quick') ? 450 : 900;
const out = { k: String(k), amrMode: H.amrMode() };
{ const { bm } = H.makeWorld(k); out.target = defaultCellUpdateTarget(bm); }
const stats = (r, target) => {
	const L = r.loadSeries.slice(300), S = r.scaleSeries.slice(300);
	return {
		ms: +r.msPerFrame.toFixed(1), meanLoad: Math.round(L.reduce((a, b) => a + b, 0) / L.length), maxLoad: Math.max(...L),
		peakAll: Math.max(...r.loadSeries), overPct: Number.isFinite(target) ? +(100 * L.filter(v => v > target).length / L.length).toFixed(1) : 0,
		scale: [+Math.min(...S).toFixed(2), +Math.max(...S).toFixed(2), +S.at(-1).toFixed(2)],
		series: r.loadSeries.filter((_, i) => i % 100 === 0), scaleSeries: r.scaleSeries.filter((_, i) => i % 100 === 0).map(v => +v.toFixed(2)),
	};
};
for (const b of ['off', 'default']) {
	H.setBudget(b === 'off' ? Infinity : 'default');
	const r = H.fleet(k, H.FLEET4, { frames, series: true, timing: true });
	out[`fleet4_${b}`] = stats(r, b === 'off' ? Infinity : out.target);
	const s0 = H.scenario0(k);
	out[`s0_${b}`] = { twa: s0.twa, bs: s0.bs };
	const s1 = H.scenario1(k);
	out[`s1_${b}`] = +(s1.tws0 - s1.tws1).toFixed(3);
}
console.log('BUDGET ' + JSON.stringify(out));
