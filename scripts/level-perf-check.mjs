// Per-level cell updates vs time, 2f (default) and 4f, auto refinement, wind 4.5 m/s.
// node --import ./test/register.mjs scripts/level-perf-check.mjs
import '../test/dom-stub.mjs';
const H = await import('./sim-res-harness.mjs');
const { trackBoats } = await import('../src/domainTrack.js');
const { Boat, SAIL_LATTICE_COUPLING } = await import('../src/boat.js');
const { perfStats } = await import('../src/present.js');
const { levelTableLines } = await import('../src/perf-overlay.js');
const now = () => performance.now();
for (const mode of ['2f', '4f']) for (const n of [1, 4]) {
	H.setBudget('default');
	const { bm, map } = H.makeWorld(mode, 4.5);
	const boats = H.FLEET4.slice(0, n).map(([x, y]) => new Boat(map, x, y, 5 * Math.PI / 4));
	for (let f = 0; f < 450; f++) {
		const t0 = now();
		if (f === 1) boats.forEach((b) => b.input_autopilot_enabled_toggle());
		map.world.step(1 / 30);
		boats.forEach((b) => {
			b.physics_model_step();
			const eff = SAIL_LATTICE_COUPLING * bm.resolution * bm.resolution / bm.velScale;
			if (b.mainsail_force) for (const s of b.getSailSegments()) bm.apply_energy_segment(s.x0, s.y0, s.x1, s.y1, s.fx * eff, s.fy * eff);
		});
		const t1 = now();
		if (bm.stepsDueThisFrame() > 0) trackBoats(bm, boats);
		const t2 = now();
		bm.advance_frame();
		bm.levelPerf.side(t2 - t1, now() - t0);
	}
	const st = perfStats(bm, map), lp = st.levelPerf;
	console.log(`\n${n} boat(s), ${mode}, auto, 4.5 m/s`);
	console.log(levelTableLines(st).join('\n'));
	const U = lp.updates.reduce((a, v) => a + v, 0), T = lp.ms.reduce((a, v) => a + v, 0);
	const xs = lp.updates.map((u) => u / U), ys = lp.ms.map((m) => m / T);
	const mx = xs.reduce((a, v) => a + v, 0) / xs.length, my = ys.reduce((a, v) => a + v, 0) / ys.length;
	let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
	console.log(`correlation %upd vs %time r = ${(sxy / Math.sqrt(sxx * syy)).toFixed(3)}; mean ns/update ${Math.round(1e6 * T / U)}`);
}
