// Per-level perf tallies (Boltzmann.levelTick / levelPerf, perf panel):
// per-level cell updates per tick sum to cellUpdates() × steps run (the
// budget's load readout), each level matches its own stepped cells × 2^L,
// and level times are non-negative and add up to at most the field time.
import './dom-stub.mjs';
const H = await import('../scripts/sim-res-harness.mjs');
const { levelTableLines } = await import('../src/perf-overlay.js');
const { perfStats } = await import('../src/present.js');
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };
const { trackBoats } = await import('../src/domainTrack.js');
const { Boat } = await import('../src/boat.js');
for (const mode of ['4f', 1, 4]) {
	const { bm, map } = H.makeWorld(mode, 4.5);
	const boats = H.FLEET4.map(([x, y]) => new Boat(map, x, y, 5 * Math.PI / 4));
	let okSum = true, okLvl = true, okMs = true, detail = '';
	for (let f = 0; f < 60; f++) {
		map.world.step(1 / 30);
		boats.forEach((b) => b.physics_model_step());
		if (bm.stepsDueThisFrame() > 0) trackBoats(bm, boats);
		const load = bm.cellUpdates();
		// Per-level stepped cells before the step (the step keeps the tree).
		const per = [bm.streamCells.length];
		const walk = (ds, d) => { for (const x of ds) { per[d] = (per[d] || 0) + x.streamCells.length * (1 << d); walk(x.domains, d + 1); } };
		walk(bm.domains, 1);
		const n = bm.advance_frame();
		const t = bm.levelTick();
		const sum = t.updates.reduce((a, v) => a + (v || 0), 0);
		if (sum !== load * n) { okSum = false; detail = `f${f}: ${sum} vs ${load}×${n}`; }
		for (let i = 0; i < per.length; i++) if ((t.updates[i] || 0) !== per[i] * n) okLvl = false;
		const ms = t.ms.reduce((a, v) => a + (v || 0), 0);
		if (t.ms.some((v) => v < -1e-6) || ms > bm.field_ms * n + 1e-6 + 0.5) okMs = false;
	}
	check(`${mode}: per-level updates sum to cellUpdates() × steps`, okSum, detail);
	check(`${mode}: each level = its stepped cells × 2^L × steps`, okLvl);
	check(`${mode}: level times non-negative, within field time`, okMs);
	const st = perfStats(bm, map);
	const lines = levelTableLines(st);
	check(`${mode}: perf table has a row per level`, st.levelPerf && lines.length === 2 + st.levelPerf.updates.length, lines.join(' | '));
}
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all level-perf checks passed');
