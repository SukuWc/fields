// Instrument panel Chart mode data (src/instrument-chart.js).
import { ChartBuffer, CHART_STRIPS, stripPolylines } from '../src/instrument-chart.js';
let n = 0;
const check = (name, ok) => { if (!ok) throw new Error('failed: ' + name); n++; };
const v = (id, bs) => ({ boatId: id, bs, vmg: bs / 2, twa: 40, twd: 350, heading: 10 });
const b = new ChartBuffer({ windowS: 120 });
let taken = 0;
for (let i = 0; i < 60; i++) if (b.add(i / 60, v('a', 2))) taken++; // 1 s at 60 fps
check('samples at 5 Hz of sim time', taken === 5);
b.add(1.2, null);
check('missing boat is a NaN gap', Number.isNaN(b.last('bs')));
b.add(10, v('a', 3));
check('sim time jump inserts a gap', Number.isNaN(b.bs[b.bs.length - 2]) && b.last('bs') === 3);
b.add(10.2, v('b', 3));
check('other boat id clears', b.t.length === 1);
b.add(5, v('b', 1));
check('time backwards clears', b.t.length === 1 && b.t[0] === 5);
const c = new ChartBuffer({ windowS: 120 });
for (let i = 0; i <= 200 * 5; i++) c.add(i / 5, v('a', 1));
check('buffer keeps the longest window', c.t[0] >= 200 - 120 - 1e-9);
const p = stripPolylines(c, CHART_STRIPS[0], { windowS: 30, w: 300, h: 40 });
check('speed strip has bs and vmg lines', p.lines.length === 2 && p.lines[0].pts.length === 1);
const first = Number(p.lines[0].pts[0].split(' ')[0].split(',')[0]);
check('30 s window starts at the left edge', Math.abs(first) < 0.5);
c.add(201, { boatId: 'a', bs: 1, vmg: 1, twa: NaN, twd: 350, heading: 10 });
check('twd keeps wrap range', stripPolylines(c, CHART_STRIPS[2], { windowS: 60, w: 300, h: 40 }).hi === 360);
console.log(`all ${n} instrument-chart checks passed`);
