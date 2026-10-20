// Refinement settings (?maxLevel, ?boatRefineRadius; 'refine' room command):
// defaults are the old stack exactly, maxLevel sets the built depth, the
// radius sets the finest disk's area, values clamp per mode, and SimCore
// carries the setting into its room state.
import './dom-stub.mjs';
const H = await import('../scripts/sim-res-harness.mjs');
const { trackBoats, amrParams } = await import('../src/domainTrack.js');
const { Boat } = await import('../src/boat.js');
const { SimCore } = await import('../src/host.js');
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };
const wr = (p) => p.levels.map((l) => l.worldRadius).join('/');

// 1. Defaults: the stack before the settings existed (sim-res.test pins the same values).
const WANT = { auto: { 1: '4.25/2.75/2', 2: '7.25/4.25/2.75/2', 4: '13.25/7.25/4.25/2.75/2' }, fixed: { 1: '8/4/2', 2: '12/8/4/2', 4: '20/12/8/4/2' } };
for (const amrMode of ['auto', 'fixed']) for (const k of [1, 2, 4]) {
	const a = amrParams({ cellSize: k, amrMode });
	const b = amrParams({ cellSize: k, amrMode, maxLevel: null, boatRefineRadius: null });
	check(`${amrMode} cell ${k}: default stack unchanged`, wr(a) === WANT[amrMode][k] && JSON.stringify(a) === JSON.stringify(b), wr(a));
}

// 2. Clamping per mode.
{
	const p = (o) => amrParams({ cellSize: 2, amrMode: 'auto', ...o });
	check('maxLevel clamps to 1..mode depth (2f: 4, 4f: 5, 1 m: 3)', p({ maxLevel: 9 }).levels.length === 4 && p({ maxLevel: -3 }).levels.length === 1
		&& amrParams({ cellSize: 4, maxLevel: 9 }).levels.length === 5 && amrParams({ cellSize: 1, maxLevel: 9 }).levels.length === 3);
	check('radius clamps to 0.5..16 m and ≥ 2 finest parent cells', p({ boatRefineRadius: 0.1 }).boatRefineRadius === 0.5 && p({ boatRefineRadius: 99 }).boatRefineRadius === 16
		&& p({ maxLevel: 1, boatRefineRadius: 0.5 }).boatRefineRadius === 4);
	check('fixed rings stay outside a larger finest disk', amrParams({ cellSize: 2, amrMode: 'fixed', boatRefineRadius: 10 }).levels.every((l, i, L) => i === L.length - 1 || l.worldRadius > L[i + 1].worldRadius));
}

// 3. Built tree: depth follows maxLevel, finest area follows the radius.
function run(mode, set) {
	const { bm, map } = H.makeWorld(mode, 4.5);
	Object.assign(bm, set);
	const boat = new Boat(map, ...H.FLEET4[0]);
	for (let f = 0; f < 8; f++) { map.world.step(1 / 30); boat.physics_model_step(); if (bm.stepsDueThisFrame() > 0) trackBoats(bm, [boat]); bm.advance_frame(); }
	let depth = 0, finest = null;
	for (let d = bm.domains.find((x) => x.disk); d; d = d.domains[0]) { depth++; finest = d; }
	const area = finest && finest.mask ? finest.mask.reduce((a, v) => a + (v ? 1 : 0), 0) * (finest.dx * 2 / bm.resolution) ** 2 : 0;
	return { depth, area, cells: bm.cellUpdates() };
}
for (const mode of ['2f', '4f']) {
	const full = amrParams({ cellSize: mode === '4f' ? 4 : 2 }).levels.length;
	const d0 = run(mode, {}), d2 = run(mode, { maxLevel: 2 });
	check(`${mode}: default builds ${full} levels, maxLevel 2 builds 2 and costs less`, d0.depth === full && d2.depth === 2 && d2.cells < d0.cells, `${d0.depth}/${d2.depth} cells ${d0.cells}/${d2.cells}`);
	const r4 = run(mode, { boatRefineRadius: 4 });
	check(`${mode}: radius 4 m refines about 4x the finest area of 2 m`, r4.area > 3 * d0.area && r4.area < 5 * d0.area && r4.cells > d0.cells, `${d0.area.toFixed(1)} → ${r4.area.toFixed(1)} m²`);
}

// 4. SimCore: the command rebuilds, lands in the room state, null resets.
{
	const core = new SimCore({ mapW: 50, mapH: 100 });
	const st0 = JSON.stringify(core.settings.refine);
	const r = core.command({ type: 'refine', maxLevel: 2, boatRefineRadius: 3 });
	const same = core.command({ type: 'refine', maxLevel: 2 });
	const back = core.command({ type: 'refine', maxLevel: null, boatRefineRadius: null });
	check('SimCore refine: default null, rebuilds, in settings, idempotent, resets', st0 === '{"maxLevel":null,"boatRefineRadius":null}' && r.rebuilt && !same.rebuilt && back.rebuilt
		&& JSON.stringify(core.settings.refine) === st0 && amrParams(core.bm).levels.length === 4, JSON.stringify(core.settings.refine));
}
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all refine-settings checks passed');
