// Scenario 20 (true-wind sweep) runs headless and the boat completes a full
// circle: the hull turns through ≥ 360°, she gets back under way after head
// to wind, and stays well inside the 100 × 200 map. No accuracy assertion
// (scripts/truewind-accuracy.mjs is the measurement).
import './dom-stub.mjs';
const { runSweep } = await import('../scripts/truewind-accuracy.mjs');
const { scenarioFits } = await import('../src/map-size.js');
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };
const rows = runSweep('2f');
let turn = 0;
for (let i = 1; i < rows.length; i++) turn += ((rows[i].heading - rows[i - 1].heading + 540) % 360) - 180;
const last = rows[rows.length - 1];
const finite = rows.every((r) => [r.x, r.y, r.bs, r.smDir, r.rawDir].every(Number.isFinite));
check('scenario 20 fits the 100 × 200 map, not 50 × 100', scenarioFits(20, '100x200') && !scenarioFits(20, '50x100'));
check('the hull turns through a full circle', Math.abs(turn) >= 360, `${turn.toFixed(0)}°`);
check('she is under way again after head to wind', last.bs > 1, `${last.bs.toFixed(2)} m/s`);
check('the path stays inside the walls with a small margin, all values finite', finite && rows.every((r) => Math.abs(r.x) < 40 && Math.abs(r.y) < 90));
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all truewind-sweep checks passed');
