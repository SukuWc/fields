// ms per tick vs maxLevel / boatRefineRadius, one boat, auto layout, 4.5 m/s.
// node --import ./test/register.mjs scripts/refine-cost-check.mjs [mode] [maxLevel|-] [radius|-]
import '../test/dom-stub.mjs';
const H = await import('./sim-res-harness.mjs');
const { trackBoats, amrParams } = await import('../src/domainTrack.js');
const { Boat, SAIL_LATTICE_COUPLING } = await import('../src/boat.js');
const [mode = '2f', ml = '-', rr = '-'] = process.argv.slice(2);
H.setBudget('default');
const { bm, map } = H.makeWorld(mode, 4.5);
if (ml !== '-') bm.maxLevel = Number(ml);
if (rr !== '-') bm.boatRefineRadius = Number(rr);
const boat = new Boat(map, ...H.FLEET4[0]);
const now = () => performance.now();
let ms = 0, n = 0, upd = 0;
for (let f = 0; f < 450; f++) {
	const t0 = now();
	if (f === 1) boat.input_autopilot_enabled_toggle();
	map.world.step(1 / 30);
	boat.physics_model_step();
	const eff = SAIL_LATTICE_COUPLING * bm.resolution * bm.resolution / bm.velScale;
	if (boat.mainsail_force) for (const s of boat.getSailSegments()) bm.apply_energy_segment(s.x0, s.y0, s.x1, s.y1, s.fx * eff, s.fy * eff);
	if (bm.stepsDueThisFrame() > 0) trackBoats(bm, [boat]);
	bm.advance_frame();
	if (f >= 150) { ms += now() - t0; n++; }
}
let depth = 0; for (let d = bm.domains.find((d) => d.disk); d; d = d.domains[0]) depth++;
const P = amrParams(bm);
console.log(JSON.stringify({ mode, maxLevel: ml, radius: rr, levels: P.levels.length, builtDepth: depth, worldR: P.levels.map((l) => l.worldRadius), msPerTick: +(ms / n).toFixed(2) }));
