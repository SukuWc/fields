// Refinement budget: bm.cellUpdateTarget (cell updates per root step).
import './dom-stub.mjs';
// Pins the full pre-#86 stack: main-parity numbers and stack structure.
await import('./full-stack.mjs');
const H = await import('../scripts/sim-res-harness.mjs');
const D = await import('../src/domainTrack.js');
let failed = 0;
const check = (name, cond, detail) => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + detail : ''}`); };

// 1. Controller: holds in the band, rises / relaxes at most 2 % per step, clamps.
{
	const T = 1000;
	let s = { scale: 3, ratio: 0.85 };
	const held = D.updateBudgetScale(s, 850, T);
	check('in band (0.8..0.9) the scale holds', held.scale === 3, held.scale);
	let r = { scale: 1, ratio: 0 }, maxStep = 0;
	for (let i = 0; i < 400; i++) { const n = D.updateBudgetScale(r, 2000, T); maxStep = Math.max(maxStep, n.scale / r.scale); r = n; }
	check('over target the scale rises, ≤2 %/step, clamps at max', r.scale === D.BUDGET_MAX_SCALE && maxStep <= 1 + D.BUDGET_MAX_STEP + 1e-12, `${r.scale} step ${maxStep.toFixed(4)}`);
	for (let i = 0; i < 1000; i++) r = D.updateBudgetScale(r, 100, T);
	check('well under target the scale relaxes to exactly 1', r.scale === 1, r.scale);
	const bm = H.makeWorld(1).bm;
	check('default target 50k per 3-level stack (100k on 2f, 200k on 4f)', D.defaultCellUpdateTarget(bm) === 50000 && D.defaultCellUpdateTarget(H.makeWorld('2f').bm) === 100000 && D.defaultCellUpdateTarget(H.makeWorld('4f').bm) === 200000);
}

// 2. Single boat under the default target: bit-identical to no budget.
{
	H.setBudget('default');
	const r = H.scenario0(1);
	check(// Fixed 30 FPS: −49.4282 / 2.1290 → −49.3048 / 2.8465; #90 ring → −49.3557 / 2.8526;
	// #103 point true wind (Default, no force undo) → −49.3048 / 2.8465.
	// #127 rudder centres 3× faster, max 45° (autopilot rudder still 30°) → −49.0860 / 2.8319.
	'1 boat, default budget: unchanged (twa −49.0860 / bs 2.8319)',
		Math.abs(r.twa + 49.0860) < 1e-4 && Math.abs(r.bs - 2.8319) < 1e-4,
		`${r.twa.toFixed(4)} / ${r.bs.toFixed(4)}`);
}

// 3. cellUpdates = root + Σ domain cells × 2^level; 4 boats (scenario 18) stay under the default target.
{
	H.setBudget('default');
	const r = H.fleet(1, H.FLEET4, { frames: 400, series: true });
	const bm = r.bm;
	check('cellUpdates() equals bm.cellLoad recorded by trackBoats', bm.cellUpdates() === bm.cellLoad && bm.cellLoad > 0, bm.cellLoad);
	const tail = r.loadSeries.slice(300), T = D.defaultCellUpdateTarget(bm);
	check('4 boats Default, default target: load ≤ target after the start transient, scale > 1', Math.max(...tail) <= T && bm.curlScale > 1, `max ${Math.max(...tail)} / ${T} scale ${bm.curlScale.toFixed(2)}`);
	check('4 boats: no NaN, all boats keep a refinement stack', !r.bad && r.stack && Object.keys(r.stack).length > 0);
}

// 4. Target below the floors: scale pins at max, floors (finest disks + shells) kept, load = floors.
{
	H.setBudget(2000);
	const r = H.fleet(1, H.FLEET4.slice(0, 2), { frames: 300, series: true });
	H.setBudget(Infinity);
	const calm = r.loadSeries.at(-1);
	check('impossible target: scale pinned at max, load stays at the floors (>0 levels kept)',
		r.bm.curlScale === D.BUDGET_MAX_SCALE && calm > 15000 && r.bm.domains?.length !== 0 && !r.bad, `scale ${r.bm.curlScale} load ${calm}`);
}
// 5. Two boats (scenario 1 shadow) at the default target: identical to no budget.
{
	H.setBudget(Infinity); const off = H.scenario1(1);
	H.setBudget('default'); const on = H.scenario1(1);
	H.setBudget(Infinity);
	check('2 boats, default budget: shadow unchanged', on.tws0 === off.tws0 && on.tws1 === off.tws1, `${(on.tws0 - on.tws1).toFixed(4)}`);
}
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('all budget checks passed');
