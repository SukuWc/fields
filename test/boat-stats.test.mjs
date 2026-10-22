// Boat stats panel data (src/boat-stats.js): samples from the compact boat
// state, which boats a client shows, and the rolling buffer (rate, window,
// boats added / removed by id).
import { boatSample, boatsToShow, StatsBuffer, wrap180 } from '../src/boat-stats.js';
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
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all boat-stats checks passed');
