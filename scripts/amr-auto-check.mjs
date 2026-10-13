// Fixed rings vs ?amrMode=auto on one grid setting.
// node --import ./test/register.mjs scripts/amr-auto-check.mjs <k> [--timing]
import '../test/dom-stub.mjs';
const H = await import('./sim-res-harness.mjs');
const arg = process.argv[2] ?? '1';
const k = isNaN(+arg) ? arg : +arg;
const timing = process.argv.includes('--timing');
const ONE = [[10, -9, 5 * Math.PI / 4]];
const TWO = [[12, -6, 5 * Math.PI / 4], [15, -11.5, 5 * Math.PI / 4]];
const INWAKE = [[12, -6, 5 * Math.PI / 4], [12, -13, 5 * Math.PI / 4]];
for (const mode of ['fixed', 'auto']) {
	H.setAmrMode(mode);
	const row = { k: String(k), mode };
	if (timing) {
		// Interleave three repeats so box load hits both layouts alike.
		row.oneMs = []; row.twoMs = [];
		for (let r = 0; r < 3; r++) {
			row.oneMs.push(+H.fleet(k, ONE, { frames: 300, timing: true }).msPerFrame.toFixed(2));
			row.twoMs.push(+H.fleet(k, TWO, { frames: 300, timing: true }).msPerFrame.toFixed(2));
		}
	} else {
		const s0 = H.scenario0(k);
		Object.assign(row, { twa: +s0.twa.toFixed(3), bs: +s0.bs.toFixed(4), twaSpread: +s0.twaSpread.toFixed(2), stack: s0.stack });
		const f1 = H.fleet(k, ONE, { frames: 600 });
		const b = f1.boats[0];
		Object.assign(row, { reach: H.stackReach(f1.bm, b.x, b.y).map(v => +v.toFixed(1)), churn: +f1.churn.toFixed(1), twsJitter: +f1.twsJitter[0].toFixed(3) });
		const s1 = H.scenario1(k);
		const w = H.wakeShadow(k, INWAKE);
		Object.assign(row, { s1: +(s1.tws0 - s1.tws1).toFixed(3), inWake: +w.shadow.toFixed(3), gap: s1.overlapGap, bad: s1.bad });
	}
	console.log('ROW ' + JSON.stringify(row));
}
