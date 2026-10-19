// 4 m fast-wind default (simRes 4f) measurements, one process, sequential.
// node --import ./test/register.mjs scripts/fast4-check.mjs [part]
import '../test/dom-stub.mjs';
const H = await import('./sim-res-harness.mjs');
const part = process.argv[2] || 'all';
const log = (k, v) => console.log('F4 ' + k + ' ' + JSON.stringify(v));
const r2 = x => +x.toFixed(4);
if (part === 'all' || part === 'boat') {
	for (const k of ['4f', 1]) {
		const { bm } = H.makeWorld(k);
		const s0 = H.scenario0(k);
		log('s0 ' + k, { velScale: bm.velScale, nu: bm.nu, matchedNu: bm.matchedNu, levels: H.amrParams(bm).levels.length, twa: r2(s0.twa), bs: r2(s0.bs), tws: r2(s0.tws), msPerFrame: +s0.msPerFrame.toFixed(1) });
		const s1 = H.scenario1(k); log('s1 ' + k, { tws0: r2(s1.tws0), tws1: r2(s1.tws1), diff: r2(s1.tws0 - s1.tws1) });
		H.setBudget('default');
		const f1 = H.fleet(k, H.FLEET4.slice(0, 1), { frames: 300, timing: true });
		const f4 = H.fleet(k, H.FLEET4, { frames: 300, timing: true });
		H.setBudget(Infinity);
		log('fleet ' + k, { ms1: +f1.msPerFrame.toFixed(1), ms4: +f4.msPerFrame.toFixed(1), twa4: f4.boats.map(b => +b.twa.toFixed(1)) });
	}
}
if (part === 'all' || part === 'barrier') {
	for (const [k, w] of [['4f', 30], [1, 7.5], ['2f', 15]]) {
		const b = H.barrier(k, w, { frames: 900, amr: true });
		log('barrier ' + k + ' ' + w, { diverge: b.diverge, worstU: r2(b.worstU), endU: r2(b.endU), bad: b.bad, islands: b.islands });
	}
}
