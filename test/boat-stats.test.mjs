// Boat stats panel data (src/boat-stats.js): samples from the compact boat
// state, which boats a client shows, and the rolling buffer (rate, window,
// boats added / removed by id).
import { boatSample, boatsToShow, StatsBuffer, wrap180, seriesRange, polylinePoints, STATS_SERIES, formatStatValue, latestValues } from '../src/boat-stats.js';
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

const boats = [{ id: 's1', ha: 0 }, { id: 's2', ha: 0 }, { id: 's3', ha: 0 }];
check('local / worker: every boat', boatsToShow(boats).map((b) => b.id).join() === 's1,s2,s3');
check('server room: only the own boat, by id', boatsToShow(boats, { remote: true, ownId: 's2' }).map((b) => b.id).join() === 's2');
check('server room, spectating: none; lockstep without own boat: all', boatsToShow(boats, { remote: true }).length === 0 && boatsToShow(boats, { remote: true, lockstep: true }).length === 3);

{
	const buf = new StatsBuffer({ windowS: 60, sampleHz: 4 });
	let taken = 0;
	for (let i = 0; i <= 30 * 90; i++) if (buf.add(i / 30, i < 30 * 70 ? boats : boats.slice(1))) taken++;
	const r = buf.series.get('s2');
	check('4 samples a second (90 s at 30 Hz offered)', taken === 361, `${taken}`);
	check('window keeps the last 60 s only', r.t[0] >= 90 - 60 && r.t[r.t.length - 1] === 90 && r.t.length <= 241 && r.t.length >= 239, `${r.t.length} samples, ${r.t[0]}…${r.t[r.t.length - 1]}`);
	check('a boat that leaves is dropped, the others stay (by id)', buf.ids().join() === 's2,s3');
	buf.add(91, [...boats.slice(1), { id: 's9', ha: 0 }]);
	check('a new boat gets its own series', buf.ids().join() === 's2,s3,s9' && buf.series.get('s9').t.length === 1);
	buf.add(5, boats);
	check('time going back (restart) clears the buffers', buf.ids().join() === 's1,s2,s3' && buf.series.get('s1').t.length === 1);
}

// Charts: ranges and SVG polylines.
{
	const ser = (k) => STATS_SERIES.find((x) => x.key === k);
	check('ranges: angles fixed, speed 0..max, VMG ±max', seriesRange(ser('twa'), [[1]]).join() === '-180,180' && seriesRange(ser('bs'), [[1.2], [2.1]]).join() === '0,2.5' && seriesRange(ser('vmg'), [[-1.7, 0.3]]).join() === '-2,2');
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
// numeric readout
{
  const byKey = Object.fromEntries(STATS_SERIES.map((s) => [s.key, s]));
  check('format angle', formatStatValue(byKey.twa, -42.6) === '-43°');
  check('format speed m/s', formatStatValue(byKey.bs, 1.234) === '1.23 m/s');
  check('format vmg m/s', formatStatValue(byKey.vmg, -0.5) === '-0.50 m/s');
  check('format missing', formatStatValue(byKey.bs, NaN) === '–');
  const buf = new StatsBuffer();
  buf.add(0, [b0, { ...b0, id: 's2', vx: 0, vy: 0 }]);
  buf.add(1, [b0, { ...b0, id: 's2', vx: 3, vy: 4 }]);
  const lv = latestValues(buf, 'bs');
  check('latest per boat in id order', lv.length === 2 && lv[0].id === 's1' && lv[1].id === 's2');
  check('latest is newest sample', near(lv[1].v, 5) && near(lv[0].v, 2.5), JSON.stringify(lv));
  check('latest unknown id is NaN', Number.isNaN(latestValues(buf, 'bs', ['zz'])[0].v));
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

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all boat-stats checks passed');
