// One-boat mode comparison: cost (perf counters, tick jitter), scenario 0,
// wake deficit, trailing-boat wind loss, and a speed-field dump for a still.
// node --import ./test/register.mjs scripts/mode-compare.mjs <mode> [outdir]
import '../test/dom-stub.mjs';
import { writeFileSync } from 'fs';
const H = await import('./sim-res-harness.mjs');
const P = await import('./propagation.mjs');
const { trackBoats } = await import('../src/domainTrack.js');
const { Boat, SAIL_LATTICE_COUPLING } = await import('../src/boat.js');
const mode = isNaN(+process.argv[2]) ? process.argv[2] : +process.argv[2];
const out = process.argv[3] || '/workspace/mode-compare';
const now = () => performance.now();
H.setBudget('default');
const info = P.modeInfo(String(mode));
const ceil = { 1: 7.5, 2: 7.5, 4: 7.5, '2f': 15, '2f34': 18, '4f': 30 }[mode];
const res = { mode: String(mode), cell: info.cell, spf: info.spf, cs: +info.cs.toFixed(1), ceiling: ceil, perf: {} };
function run(wind, frames, dump) {
	const { bm, map } = H.makeWorld(mode, wind);
	const boat = new Boat(map, 10, -9, 5 * Math.PI / 4);
	const ticks = [];
	let bad = false;
	for (let f = 0; f < frames; f++) {
		if (f === 1) boat.input_autopilot_enabled_toggle();
		const t0 = now();
		map.world.step(1 / 30);
		boat.physics_model_step();
		const eff = SAIL_LATTICE_COUPLING * bm.resolution * bm.resolution / bm.velScale;
		if (boat.mainsail_force) for (const s of boat.getSailSegments()) bm.apply_energy_segment(s.x0, s.y0, s.x1, s.y1, s.fx * eff, s.fy * eff);
		const t1 = now();
		if (bm.stepsDueThisFrame() > 0) trackBoats(bm, [boat]);
		const t2 = now();
		bm.advance_frame();
		const t3 = now();
		bm.levelPerf.side(t2 - t1, t3 - t0);
		if (f >= 150) ticks.push({ field: t3 - t2, track: t2 - t1, total: t3 - t0, upd: bm.levelTick().updates.reduce((a, v) => a + (v || 0), 0) });
		if (f % 50 === 49) { const s = H.fieldStats(bm); if (s.bad || s.maxU > 0.6) bad = true; }
	}
	const avg = (k) => ticks.reduce((a, t) => a + t[k], 0) / ticks.length;
	const tot = ticks.map((t) => t.total).sort((a, b) => a - b);
	const m = avg('total');
	const sd = Math.sqrt(ticks.reduce((a, t) => a + (t.total - m) ** 2, 0) / ticks.length);
	const lp = bm.levelPerf.snapshot();
	const U = lp.updates.reduce((a, v) => a + v, 0);
	const r = { field: +avg('field').toFixed(2), track: +avg('track').toFixed(2), total: +m.toFixed(2), p95: +tot[Math.floor(0.95 * tot.length)].toFixed(1), max: +tot[tot.length - 1].toFixed(1), sd: +sd.toFixed(1),
		updPerTick: Math.round(avg('upd')), split: lp.updates.map((u) => +(100 * u / U).toFixed(1)), bad, twa: +boat.twa.toFixed(1), bs: +Math.hypot(boat.physics_model.m_linearVelocity.x, boat.physics_model.m_linearVelocity.y).toFixed(3) };
	if (dump) {
		// Speed field in a 48 × 48 m window centred on the boat, 0.25 m pixels, in m/s.
		const N = 192, half = 24, px = [];
		const fs = 400 * 0.3; // field sample → m/s (FIELD_TO_MPS)
		for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
			const v = bm.get_field_velocity(boat.x - half + (i + 0.5) * 0.25, boat.y + half - (j + 0.5) * 0.25);
			px.push(+(Math.hypot(v.x, v.y) * fs).toFixed(3));
		}
		writeFileSync(`${out}/field-${mode}.json`, JSON.stringify({ mode: String(mode), N, wind, px, boat: [boat.x, boat.y, boat.body ? 0 : 0] }));
	}
	return r;
}
for (const w of [...new Set([2, 4.5, 7.5, ceil])]) res.perf[w] = run(w, 450, w === 4.5);
const s0 = H.scenario0(mode);
res.s0 = { twa: +s0.twa.toFixed(2), bs: +s0.bs.toFixed(3), spread: +s0.twaSpread.toFixed(2) };
// Wake deficit behind one boat (node estimator not needed: field samples), same layout as earlier runs.
const spec = [[12, -6, 5 * Math.PI / 4], [15, -11.5, 5 * Math.PI / 4]];
const on = H.fleet(mode, [spec[0]], { frames: 450 }), off = H.fleet(mode, [spec[0]], { frames: 450, kick: [false] });
const b = on.boats[0], x = b.x, y = b.y, fs0 = off.bm.get_field_velocity(x, y), U0 = Math.hypot(fs0.x, fs0.y), ex = fs0.x / U0, ey = fs0.y / U0;
res.wake = {};
for (const d of [2, 5, 10, 20]) {
	let best = 0;
	for (let s = -3; s <= 3; s += 0.5) { const px = x + ex * d - ey * s, py = y + ey * d + ex * s; const a = on.bm.get_field_velocity(px, py), c = off.bm.get_field_velocity(px, py);
		best = Math.max(best, (c.x * ex + c.y * ey) - (a.x * ex + a.y * ey)); }
	res.wake[d] = +(100 * best / U0).toFixed(1);
}
const w = H.wakeShadow(mode, spec, { frames: 450 });
res.trailLoss = +(100 * w.shadow / w.off).toFixed(2);
// Real viscosity relative to 1 m on root / refined stack.
const { bm } = H.makeWorld(mode, 4.5);
const phys = (nu) => nu * bm.cellSize * bm.cellSize * bm.stepsPerFrame / 0.025;
res.nuRoot = +phys(bm.nu).toFixed(2); res.nuStack = +phys(bm.matchedNu).toFixed(2);
console.log('RESULT ' + JSON.stringify(res));
