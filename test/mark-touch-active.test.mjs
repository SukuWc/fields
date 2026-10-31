// Rule 31 touches count only on the boat's own next mark / gate ends /
// start or finish line ends (mark-touch.js activeTouchMarks).
import { Course, Gate } from '../src/course.js';
import { recordMarkTouches, activeTouchMarks, resetMarkTouches } from '../src/mark-touch.js';

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed++;
};
const mk = (name, x, y) => ({ markName: name, x, y, radius: 0.5 });
const w = mk('w', 0, 60), gl = mk('gl', -8, -40), gr = mk('gr', 8, -40);
const rc = mk('RC', 16, -70), pin = mk('pin', -16, -70);
const all = [w, gl, gr, rc, pin];
const course = new Course([w, new Gate(gl, gr), w], { laps: 1, start: { x: 0, y: -70 }, finish: { committee: rc, pin, mid: { x: 0, y: -70 } } });
const fakeSeq = { line: { committee: rc, pin } };
// Boat as a small square hull; place it on a mark to touch.
const boatAt = (id, m) => ({ id, x: m.x, y: m.y, hull: [{ x: m.x - 1, y: m.y - 1 }, { x: m.x + 1, y: m.y - 1 }, { x: m.x + 1, y: m.y + 1 }, { x: m.x - 1, y: m.y + 1 }] });
const touch = (boat, mark, k) => {
  resetMarkTouches();
  course.progressFor(boat).seed(k);
  const opts = { simTime: 1, nowMs: 0, exonerate: () => false, activeMarks: (b) => activeTouchMarks(course, fakeSeq, b) };
  return recordMarkTouches([boat], [mark], opts).length;
};
check('leg 1: touch windward -> penalty', touch(boatAt(1, w), w, 0) === 1);
check('leg 1: touch gate end -> no penalty', touch(boatAt(2, gl), gl, 0) === 0);
check('leg 1: touch RC -> no penalty', touch(boatAt(3, rc), rc, 0) === 0);
check('leg 2: touch gate left -> penalty', touch(boatAt(4, gl), gl, 1) === 1);
check('leg 2: touch gate right -> penalty', touch(boatAt(5, gr), gr, 1) === 1);
check('leg 2: touch windward -> no penalty', touch(boatAt(6, w), w, 1) === 0);
check('leg 3: touch windward again -> penalty', touch(boatAt(7, w), w, 2) === 1);
check('finish leg: touch pin -> penalty', touch(boatAt(8, pin), pin, 3) === 1);
check('finish leg: touch windward -> no penalty', touch(boatAt(9, w), w, 3) === 0);
// Per boat: two boats on different legs touching the same buoy.
resetMarkTouches();
const a = boatAt(10, gl), b = boatAt(11, gl);
course.progressFor(a).seed(1); course.progressFor(b).seed(0);
const ch = recordMarkTouches([a, b], [gl], { nowMs: 0, exonerate: () => false, activeMarks: (x) => activeTouchMarks(course, fakeSeq, x) });
check('per boat: only the boat whose next is the gate is charged', ch.length === 1 && ch[0].boat.id === 10);
// No course -> every mark counts (old behaviour).
resetMarkTouches();
check('no course: any touch counts', recordMarkTouches([boatAt(12, w)], [w], { nowMs: 0, exonerate: () => false, activeMarks: () => activeTouchMarks(null, null, null) }).length === 1);
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all passed');
