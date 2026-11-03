// Instrument panel Readout mode (src/instrument-readout.js): own boat by id,
// dashes (null) for what the frame does not carry, never guessed values.
import { instrumentBoat, readoutValues, formatReadout, READOUT_TILES } from '../src/instrument-readout.js';
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const boats = [
  { id: 's1', ha: 0, vx: 1, vy: 0, awa: 20, wd: 90, px: 0, py: 0 },
  { id: 's2', ha: Math.PI / 2, vx: 0, vy: 2, awa: -30, wd: 450, px: 10, py: 0 },
];
check('own boat by id, not index', instrumentBoat(boats, { ownId: 's2', remote: true }).id === 's2');
check('own id not in the frame: none', instrumentBoat(boats, { ownId: 'zz' }) === null);
check('local / worker without own boat: boat 0', instrumentBoat(boats).id === 's1');
check('server room spectator: none; lockstep: boat 0', instrumentBoat(boats, { remote: true }) === null && instrumentBoat(boats, { remote: true, lockstep: true }).id === 's1');

const state = {
  boats,
  course: { c: [{ x: 10, y: 40 }, [{ x: -5, y: 0 }, { x: 5, y: 0 }]] },
  hud: { tel: { tws: 45 }, co: { i: 1, gate: 1 }, own: { s2: { tel: { tws: 52 }, co: { i: 0, gate: 0 } } } },
};
const mine = readoutValues(state, { ownId: 's2', remote: true });
check('own boat: speed, TWD wrapped, own TWS (tenths → m/s)', near(mine.bs, 2) && mine.twd === 90 && near(mine.tws, 5.2), JSON.stringify(mine));
check('own boat: next mark from its own course progress', near(mine.next, 40) && mine.nextLabel === 'mark 1');
check('AWS is never filled (internal units in telemetry)', mine.aws === null);
const b0 = readoutValues(state, {});
check('boat 0 without own: scenario course (gate midpoint)', near(b0.next, 0) && b0.nextLabel === 'gate 2');
check('several boats, no own: scenario TWS is not attributed (dash)', b0.tws === null);
check('one boat: scenario telemetry is its own', near(readoutValues({ boats: [boats[0]], hud: { tel: { tws: 45 } } }).tws, 4.5));
check('no course in the frame: no next mark', readoutValues({ boats: [boats[0]] }).next === null);
check('spectator: no values', readoutValues(state, { remote: true }) === null);
check('dash for missing, fixed decimals', formatReadout('tws', null) === '–' && formatReadout('bs', 2.345) === '2.3' && formatReadout('twd', 359.6) === '0' && formatReadout('twa', -49.4) === '-49');
check('nine tiles incl. TWS / AWS / NEXT', READOUT_TILES.length === 9 && ['tws', 'aws', 'next'].every((k) => READOUT_TILES.some((t) => t.key === k)));

if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all instrument-readout checks passed');
process.exit(0);
