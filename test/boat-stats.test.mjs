// Boat sample + chart helpers (src/boat-stats.js): samples from the compact
// boat state, chart ranges and polylines; boat colours; svg-chart math. The
// floating Boat stats panel (boat-stats-panel.js, #boat_stats) is removed.
import { readFileSync, existsSync } from 'node:fs';
import * as boatStats from '../src/boat-stats.js';
const { boatSample, wrap180, seriesRange, polylinePoints } = boatStats;
import { valueToY, indexToX, xToIndex, timeToX, xToTime, nearestTimeIndex, valuesPolylinePoints, agoLabel } from '../src/svg-chart.js';
import { BOAT_COLORS, boatColor, boatColorCss, boatColorIndex } from '../src/boat-colors.js';
import { TRAIL_COLORS } from '../src/boat-trails.js';
import './dom-stub.mjs';
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const b0 = { id: 's1', ha: 5 * Math.PI / 4, vx: 1.5, vy: -2, awa: 30, wd: 90 };
const s = boatSample(b0);
check('sample: heading wraps to ±180, speed = |v|', near(s.heading, -135) && near(s.bs, 2.5));
check('sample: TWA = wd − heading + 90 (boat.js), wrapped', near(s.twa, wrap180(90 - 225 + 90)) && near(s.twa, -45));
check('sample: AWA passes through; missing fields give NaN, no ha → null', s.awa === 30 && Number.isNaN(boatSample({ id: 'x', ha: 0 }).twa) && boatSample({ id: 'x' }) === null);

check('VMG: bs·cos(TWA) (+ upwind), tel vmg wins if present', near(s.vmg, 2.5 * Math.cos(-Math.PI / 4)) && boatSample({ ...b0, vmg: -1.2 }).vmg === -1.2 && boatSample({ ...b0, wd: 180 + 225 - 90 }).vmg < 0);

// Charts: ranges and SVG polylines.
{
	const ang = { min: -180, max: 180 }, spd = { min: 0, max: null }, vmg = { min: null, max: null };
	check('ranges: angles fixed, speed 0..max, VMG ±max', seriesRange(ang, [[1]]).join() === '-180,180' && seriesRange(spd, [[1.2], [2.1]]).join() === '0,2.5' && seriesRange(vmg, [[-1.7, 0.3]]).join() === '-2,2');
	const pl = polylinePoints([0, 1, 2, 3, 4], [170, 179, -179, NaN, -170], { t1: 4, windowS: 4, lo: -180, hi: 180, w: 40, h: 36, wrap: true });
	check('polylines break at ±180 wraps and gaps', pl.length === 1 && pl[0] === '0.0,1.0 10.0,0.1', JSON.stringify(pl));
}

// Boat colours: one palette, by index in the frame's boat list.
{
	const want = [0x2f80ff, 0xff3b30, 0x2fd06a, 0xff8c1a, 0xa45cff, 0x2fe0e0, 0xffd02f, 0xff4fd8];
	check('palette: blue, red, green, orange, purple, cyan, yellow, magenta', BOAT_COLORS.join() === want.join() && TRAIL_COLORS === BOAT_COLORS);
	check('palette cycles; css form', boatColor(8) === want[0] && boatColor(10) === want[2] && boatColorCss(1) === '#ff3b30');
	// The host builds state.boats (sim player order); local, worker and remote
	// clients get the same list (here: the same frame through a JSON round
	// trip, as the worker / WebSocket deliver it), so the same colours by id.
	const frame = { boats: [{ id: 's1' }, { id: 'b3' }, { id: 'b7' }], bc: [null, 0x123456, null] };
	const local = boatColorIndex(frame.boats), remote = boatColorIndex(JSON.parse(JSON.stringify(frame)).boats);
	check('same boat → same colour in every mode, spawn colour ignored', [...local].every(([id, i]) => remote.get(id) === i) && boatColor(local.get('b3')) === 0xff3b30);
}


// Shared SVG chart helpers (src/svg-chart.js).
{
	check('valueToY: lo→h, hi→0, mid→h/2', valueToY(0, 0, 10, 40) === 40 && valueToY(10, 0, 10, 40) === 0 && valueToY(5, 0, 10, 40) === 20);
	check('indexToX / xToIndex round-trip', xToIndex(indexToX(3, 7, 100), 7, 100) === 3 && xToIndex(0, 5, 50) === 0 && xToIndex(50, 5, 50) === 4);
	check('timeToX / xToTime', near(xToTime(timeToX(8, 10, 10, 100), 10, 10, 100), 8) && near(timeToX(0, 10, 10, 100), 0));
	check('nearestTimeIndex', nearestTimeIndex([1, 2, 5, 9], 4) === 2 && nearestTimeIndex([], 1) === -1);
	const vp = valuesPolylinePoints([0, 5, NaN, 10], { lo: 0, hi: 10, w: 30, h: 20 });
	check('valuesPolylinePoints splits on NaN (singleton dropped)', vp.length === 1 && vp[0].split(' ').length === 2, JSON.stringify(vp));
	check('agoLabel', agoLabel(0) === 'now' && agoLabel(0.5) === '0.50s ago' && agoLabel(12.3) === '12.3s ago');
}

// Legacy Boat stats panel removed: no module, markup, CSS or wiring left.
{
	const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
	const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
	check('boat-stats-panel.js is gone', !existsSync(new URL('../src/boat-stats-panel.js', import.meta.url)));
	check('no #boat_stats markup or CSS, no Boat stats button', !html.includes('boat_stats') && !/>Boat stats</.test(html));
	check('main.js no longer wires the panel', !/boat-stats-panel|setupBoatStats|boatStats\./.test(main));
	check('panel-only exports removed', ['StatsBuffer', 'boatsToShow', 'STATS_SERIES', 'formatStatValue', 'latestValues'].every((k) => !(k in boatStats)));
}

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all boat-stats checks passed');
