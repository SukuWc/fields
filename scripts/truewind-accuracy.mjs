// True-wind measurement baseline on scenario 20 (one boat sweeps its TWA
// target through a full circle). Records, every 3 ticks (0.1 s), the boat's
// true-wind readings against the free stream and writes CSV + summary.md.
// Measurement only: the true-wind computation is not changed here.
//   node --import ./test/register.mjs scripts/truewind-accuracy.mjs [mode=2f] [outDir=out/truewind]
// Plot: scripts/truewind-plot.py <outDir> (needs matplotlib).
// Columns: smoothed = boat.wind_direction / wind_speed (what the autopilot
// and sail model use); raw = map.get_wind at the boat centre (HUD / rules);
// amb = map.get_wind 20 m abeam (control: the lattice away from the boat);
// true = the inlet (map.constantWind, the uniform free stream).
import './../test/dom-stub.mjs';
import fs from 'node:fs';
import path from 'node:path';
const { SimCore } = await import('../src/host.js');
const { WIND_UNIT_MPS } = await import('../src/wind.js');
const { TRUEWIND_SWEEP_STEP_DEG } = await import('../src/scenarios.js');

const mode = process.argv[2] || '2f';
const outDir = process.argv[3] || 'out/truewind';
const TICKS = 30 + 30 * (360 / TRUEWIND_SWEEP_STEP_DEG) + 120;
const SCENARIO = 20;

export function runSweep(simRes = '2f', ticks = TICKS) {
	const core = new SimCore({ mapW: 100, mapH: 200, simRes });
	const log = console.log; console.log = () => {};
	try { core.command({ type: 'restart', scenario: SCENARIO }); } finally { console.log = log; }
	const map = core.map, rows = [];
	let prevV = null;
	for (let t = 0; t < ticks; t++) {
		console.log = () => {};
		try { core.tick({ dt: 1 / 30, held: [] }); } finally { console.log = log; }
		const b = core.sim.players[0];
		if (!b || t % 3) continue;
		const v = b.physics_model.getLinearVelocity();
		const bs = Math.hypot(v.x, v.y);
		const ax = b.x + (b.x < 0 ? 20 : -20), amb = map.get_wind(ax, b.y);
		const raw = map.get_wind(b.x, b.y), tru = map.constantWind.getWind(b.x, b.y);
		const acc = prevV === null ? 0 : (bs - prevV) / 0.1;
		prevV = bs;
		rows.push({ tick: t, x: b.x, y: b.y, heading: b.angle * 180 / Math.PI, bs, acc, target: b.autopilot_heading_target, twa: b.twa,
			smDir: b.wind_direction, smTws: b.wind_speed * WIND_UNIT_MPS, rawDir: raw.direction, rawTws: raw.speed, ambDir: amb.direction, ambTws: amb.speed, trueDir: tru.direction, trueTws: tru.speed });
	}
	return rows;
}

const wrap = (d) => ((d + 540) % 360) - 180;
export function stats(a) {
	const n = a.length; if (!n) return null;
	const s = [...a].sort((p, q) => p - q), m = a.reduce((x, y) => x + y, 0) / n;
	const q = (p) => s[Math.min(n - 1, Math.floor(p * (n - 1) + 0.5))];
	const abs = a.map(Math.abs).sort((p, q) => p - q);
	return { n, mean: m, std: Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / n), rms: Math.sqrt(a.reduce((x, y) => x + y * y, 0) / n),
		maxAbs: abs[n - 1], p50abs: abs[Math.floor(0.5 * (n - 1))], p95abs: abs[Math.floor(0.95 * (n - 1))], p05: q(0.05), p50: q(0.5), p95: q(0.95) };
}
const corr = (a, b) => { const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
	let c = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return c / Math.sqrt(va * vb); };

if (process.argv[1] && process.argv[1].endsWith('truewind-accuracy.mjs')) {
	const rows = runSweep(mode);
	// Skip the first 1 s (smoother and field start-up).
	const R = rows.filter((r) => r.tick >= 30);
	for (const r of rows) { r.eSmDir = wrap(r.smDir - r.trueDir); r.eRawDir = wrap(r.rawDir - r.trueDir); r.eSmTws = r.smTws - r.trueTws; r.eRawTws = r.rawTws - r.trueTws; r.eAmbDir = wrap(r.ambDir - r.trueDir); r.eAmbTws = r.ambTws - r.trueTws; r.trueTwa = wrap(r.trueDir - r.heading + 90); }
	fs.mkdirSync(outDir, { recursive: true });
	const cols = Object.keys(rows[0]);
	fs.writeFileSync(path.join(outDir, `truewind-${mode}.csv`), [cols.join(','), ...rows.map((r) => cols.map((c) => +(+r[c]).toFixed(5)).join(','))].join('\n') + '\n');
	const f = (x, d = 2) => (x === undefined || x === null || !Number.isFinite(x) ? '—' : x.toFixed(d));
	const line = (name, s, u) => `| ${name} | ${s.n} | ${f(s.mean)} | ${f(s.std)} | ${f(s.rms)} | ${f(s.maxAbs)} | ${f(s.p50abs)} | ${f(s.p95abs)} | ${f(s.p05)} / ${f(s.p95)} | ${u} |`;
	const head = '| error | n | mean (bias) | std | RMS | max abs | p50 abs | p95 abs | p5 / p95 | unit |\n|---|---|---|---|---|---|---|---|---|---|';
	const out = [`# True-wind accuracy baseline — scenario ${SCENARIO}, ${mode}`, '',
		`Free stream ${f(R[0].trueTws)} m/s from ${f(R[0].trueDir, 1)}°. ${TICKS} ticks, sampled every 3 ticks, first 30 ticks skipped. Error = measured − true (direction wrapped to ±180°).`,
		`Step ${TRUEWIND_SWEEP_STEP_DEG}° per second. Boat speed ${f(Math.min(...R.map((r) => r.bs)))}–${f(Math.max(...R.map((r) => r.bs)))} m/s. Path x ${f(Math.min(...R.map((r) => r.x)), 1)}…${f(Math.max(...R.map((r) => r.x)), 1)}, y ${f(Math.min(...R.map((r) => r.y)), 1)}…${f(Math.max(...R.map((r) => r.y)), 1)} m.`, '',
		'## Overall', '', head,
		line('direction, smoothed (autopilot)', stats(R.map((r) => r.eSmDir)), '°'),
		line('direction, raw (HUD/rules)', stats(R.map((r) => r.eRawDir)), '°'),
		line('speed, smoothed', stats(R.map((r) => r.eSmTws)), 'm/s'),
		line('speed, raw', stats(R.map((r) => r.eRawTws)), 'm/s'),
		line('direction, field 20 m abeam (control)', stats(R.map((r) => r.eAmbDir)), '°'),
		line('speed, field 20 m abeam (control)', stats(R.map((r) => r.eAmbTws)), 'm/s'), '',
		'The control samples the field (map.get_wind) 20 m to the side of the boat, toward the map centre line: the undisturbed lattice wind there vs the inlet value.', ''];
	const binned = (title, key, edges, fmt) => {
		out.push(`## By ${title}`, '', '| bin | n | dir mean | dir std | dir RMS | raw dir RMS | TWS mean | TWS RMS | raw TWS RMS |', '|---|---|---|---|---|---|---|---|---|');
		for (let i = 0; i < edges.length - 1; i++) {
			const B = R.filter((r) => key(r) >= edges[i] && key(r) < edges[i + 1]);
			if (!B.length) { out.push(`| ${fmt(edges[i], edges[i + 1])} | 0 | | | | | | | |`); continue; }
			const d = stats(B.map((r) => r.eSmDir)), dr = stats(B.map((r) => r.eRawDir)), s = stats(B.map((r) => r.eSmTws)), sr = stats(B.map((r) => r.eRawTws));
			out.push(`| ${fmt(edges[i], edges[i + 1])} | ${B.length} | ${f(d.mean)} | ${f(d.std)} | ${f(d.rms)} | ${f(dr.rms)} | ${f(s.mean)} | ${f(s.rms)} | ${f(sr.rms)} |`);
		}
		out.push('');
	};
	binned('|true TWA| (30° bins, from the free stream and the hull heading)', (r) => Math.abs(r.trueTwa), [0, 30, 60, 90, 120, 150, 180.01], (a, b) => `${a}–${Math.round(b)}°`);
	binned('boat speed', (r) => r.bs, [0, 0.5, 1, 1.5, 2, 2.5, 3, 10], (a, b) => `${a}–${b} m/s`);
	binned('time (6 s windows)', (r) => r.tick / 30, [1, 7, 13, 19, 25, 31, 37, 43], (a, b) => `${a}–${b} s`);
	const k = (key) => R.map(key);
	out.push('## Correlations (Pearson r)', '', '| | boat speed | acceleration | |TWA| |', '|---|---|---|---|');
	for (const [n, e] of [['dir smoothed', (r) => r.eSmDir], ['|dir smoothed|', (r) => Math.abs(r.eSmDir)], ['dir raw', (r) => r.eRawDir], ['TWS smoothed', (r) => r.eSmTws], ['TWS raw', (r) => r.eRawTws]]) {
		out.push(`| ${n} | ${f(corr(k(e), k((r) => r.bs)))} | ${f(corr(k(e), k((r) => r.acc)))} | ${f(corr(k(e), k((r) => Math.abs(r.trueTwa))))} |`);
	}
	out.push('', `Drift: linear fit slope of the smoothed direction error over time: ${f(slope(k((r) => r.tick / 30), k((r) => r.eSmDir)), 3)} °/s; TWS ${f(slope(k((r) => r.tick / 30), k((r) => r.eSmTws)), 4)} m/s per s.`);
	fs.writeFileSync(path.join(outDir, `summary-${mode}.md`), out.join('\n') + '\n');
	console.log(out.join('\n'));
}
function slope(x, y) { const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let c = 0, v = 0; for (let i = 0; i < n; i++) { c += (x[i] - mx) * (y[i] - my); v += (x[i] - mx) ** 2; } return c / v; }
