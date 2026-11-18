// Overlay draw order (src/draw-order.js, renderer.js): laylines, ladder
// lines, mark zone circles and the boundary draw over the field but under
// the flow tracers; hulls, marks and the other guides keep their order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ORDER_FIELD, ORDER_COURSE, ORDER_TRACERS, ORDER_TRAILS, ORDER_HULL, ORDER_HULL_FILL,
  ORDER_ROW_CIRCLE, ORDER_GUIDE, ORDER_RIBBON, ORDER_LABEL, LAYER_COURSE, guideOrder,
} from '../src/draw-order.js';
import { ladderGuidesFromState, laylineGuidesFromState } from '../src/ladder-lines.js';
import { boundaryGuides } from '../src/boundary.js';
import { courseGuidesFromState, COURSE_ACTIVATION_RADIUS_M } from '../src/course.js';
import { markGuides } from '../src/mark.js';
import { startGuidesFromState } from '../src/start.js';
import { finishGuidesFromState } from '../src/finish.js';

const renderer = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
const under = (o) => o > ORDER_FIELD && o < ORDER_TRACERS;

test('order constants: course < tracers < trails < hulls < guides; existing values unchanged', () => {
  assert.equal(ORDER_FIELD, 0);
  assert.ok(under(ORDER_COURSE));
  assert.equal(ORDER_TRACERS, 0.5);
  assert.equal(ORDER_TRAILS, 0.6);
  assert.equal(ORDER_HULL_FILL, 0.9);
  assert.equal(ORDER_HULL, 1);
  assert.equal(ORDER_ROW_CIRCLE, 1.15);
  assert.equal(ORDER_GUIDE, 2);
  assert.equal(ORDER_RIBBON, 3);
  assert.equal(ORDER_LABEL, 6);
});

test('ladder lines and laylines draw under the tracers', () => {
  const flat = [0, 0, 10, 10];
  const g = [...ladderGuidesFromState([flat, flat]), ...laylineGuidesFromState([flat])];
  assert.equal(g.length, 3);
  for (const r of g) {
    assert.equal(r.layer, LAYER_COURSE);
    assert.ok(under(guideOrder(r)), `order ${guideOrder(r)}`);
  }
});

test('boundary line, zone edge and hatching draw under the tracers', () => {
  const g = boundaryGuides({ x: 40, zone: 6, yMin: -20, yMax: 20 });
  assert.ok(g.length > 10);
  for (const r of g) assert.ok(under(guideOrder(r)), `order ${guideOrder(r)}`);
});

const R = COURSE_ACTIVATION_RADIUS_M;
const onZone = (r, c) => Math.abs(Math.hypot(r.x1 - c.x, r.y1 - c.y) - R) < 1e-6 && Math.abs(Math.hypot(r.x2 - c.x, r.y2 - c.y) - R) < 1e-6;

// Rounding rings: the pulsing ring (r 1.1–1.7 m) and the grey ✓ ring (1.3 m)
// around a buoy stay on top.
const isRing = (r, c) => {
  const d1 = Math.hypot(r.x1 - c.x, r.y1 - c.y), d2 = Math.hypot(r.x2 - c.x, r.y2 - c.y);
  return Math.abs(d1 - d2) < 1e-6 && d1 < 2;
};

test('next mark: zone circle, course line and rounding ray under the tracers; rounding ring on top', () => {
  const c = { x: 5, y: 30 }, m2 = { x: 5, y: -10 };
  const cs = { n: 2, anchors: [c, m2], gates: [null, null], sides: [0, 0], start: { x: 0, y: -20 }, fin: null, lapsFinite: false };
  const s = { c: [c, m2], waiting: false, display: 0, view: { index: 0, midDeg: 90, rounded: false }, rounded: [] };
  const segs = courseGuidesFromState(cs, s, 0).filter((r) => r.type === 'guide');
  const zone = segs.filter((r) => onZone(r, c));
  const ring = segs.filter((r) => isRing(r, c));
  const rest = segs.filter((r) => !onZone(r, c) && !isRing(r, c));
  assert.ok(zone.length >= 30, 'dashed zone circle');
  assert.ok(ring.length >= 30, 'pulsing ring');
  // Course line mark 1 → mark 2 (x = 5), start → mark 1, and the rounding ray
  // straight up from the mark (midDeg 90) to the zone edge.
  const ray = rest.filter((r) => Math.abs(r.x1 - c.x) < 1e-6 && Math.abs(r.x2 - c.x) < 1e-6 && r.y1 >= c.y && r.y2 >= c.y);
  const toNext = rest.filter((r) => Math.abs(r.x1 - c.x) < 1e-6 && r.y1 < c.y);
  const fromStart = rest.filter((r) => r.y1 < 0 && Math.abs(r.x1 - c.x) > 1e-6);
  assert.ok(ray.length > 0 && toNext.length > 0 && fromStart.length > 0);
  for (const r of [...zone, ...rest]) assert.ok(under(guideOrder(r)), `order ${guideOrder(r)}`);
  for (const r of ring) assert.equal(guideOrder(r), ORDER_GUIDE);
});

test('rounded mark: grey ring stays on top', () => {
  const c = { x: 5, y: 30 }, m2 = { x: 5, y: -10 };
  const cs = { n: 2, anchors: [c, m2], gates: [null, null], sides: [0, 0], start: { x: 0, y: -20 }, fin: null, lapsFinite: false };
  const s = { c: [c, m2], waiting: false, display: 1, view: { index: 1, midDeg: 270, rounded: false }, rounded: [0] };
  const segs = courseGuidesFromState(cs, s, 0).filter((r) => r.type === 'guide');
  const ring = segs.filter((r) => isRing(r, c));
  assert.ok(ring.length >= 20);
  for (const r of ring) assert.equal(guideOrder(r), ORDER_GUIDE);
});

for (const state of ['next', 'passed', 'other']) {
  test(`gate (${state}): gate line and zone circles under the tracers; rings on top`, () => {
    const a = { x: -4, y: 50 }, b = { x: 4, y: 50 };
    const cs = { n: 1, anchors: [{ x: 0, y: 50 }], gates: [[a, b]], sides: [0], start: { x: 0, y: -20 }, fin: null, lapsFinite: false };
    const s = state === 'next'
      ? { c: [[a, b]], waiting: false, display: 1, view: { index: 0, midDeg: 90, rounded: false }, rounded: [] }
      : { c: [[a, b]], waiting: false, display: 1, view: { index: -1 }, rounded: state === 'passed' ? [0] : [] };
    const segs = courseGuidesFromState(cs, s, 0).filter((r) => r.type === 'guide');
    const gateLine = segs.filter((r) => Math.abs(r.y1 - 50) < 1e-6 && Math.abs(r.y2 - 50) < 1e-6 && Math.abs(r.x1) <= 4 && Math.abs(r.x2) <= 4 && !isRing(r, a) && !isRing(r, b));
    assert.ok(gateLine.length >= 3, 'dashed gate line');
    for (const r of gateLine) assert.ok(under(guideOrder(r)));
    for (const c of [a, b]) {
      for (const r of segs.filter((r) => onZone(r, c))) assert.ok(under(guideOrder(r)));
      for (const r of segs.filter((r) => isRing(r, c))) assert.equal(guideOrder(r), ORDER_GUIDE);
    }
    if (state === 'next') assert.ok(segs.some((r) => onZone(r, a)) && segs.some((r) => isRing(r, a)));
  });
}

const LINE = { a: { x: -16, y: -70 }, b: { x: 16, y: -70 }, len: 32, tx: 1, ty: 0, nx: 0, ny: 1, mid: { x: 0, y: -70 } };

for (const st of ['prestart', 'notStarted', 'ocs', 'started']) {
  test(`start line (${st}): dashes and side ticks under the tracers; labels unchanged`, () => {
    const g = startGuidesFromState(LINE, { st, t0: st === 'started' ? 1 : null, clock: 2 }, { x: 0, y: -60 }, 0);
    const segs = g.filter((r) => r.type === 'guide');
    const ticks = segs.filter((r) => Math.abs(r.x1 - r.x2) < 1e-6);
    assert.ok(segs.length - ticks.length >= 10, 'dashed line');
    assert.ok(ticks.length >= 10, 'side ticks');
    for (const r of segs) assert.ok(under(guideOrder(r)));
    assert.ok(g.some((r) => r.type === 'label'));
  });
}

test('finish line dashes under the tracers', () => {
  for (const next of [true, false]) {
    const segs = finishGuidesFromState(LINE, { next, labels: [] }, 0).filter((r) => r.type === 'guide');
    assert.ok(segs.length >= 10);
    for (const r of segs) assert.ok(under(guideOrder(r)));
  }
});

test('marks, hulls and other guides keep their order', () => {
  for (const r of markGuides(0, 0, 3, 3)) assert.equal(guideOrder(r), ORDER_GUIDE);
  assert.equal(guideOrder({ type: 'guide', color: 0xff0000 }), ORDER_GUIDE);
  assert.equal(guideOrder({ type: 'polyline', pts: [0, 0, 1, 1] }), ORDER_GUIDE);
  // Body outlines (boats and buoys) and the tracers.
  const fixture = renderer.match(/function createFixtureLine\(body\) \{([\s\S]*?)\n\}/)[1];
  assert.match(fixture, /line\.renderOrder = ORDER_HULL;/);
  assert.match(renderer, /tracerLines\.renderOrder = ORDER_TRACERS;/);
  assert.match(renderer, /fluidPlane\.renderOrder = ORDER_FIELD;/);
  // Pooled guide lines and polylines take the order of the guide they show.
  assert.equal((renderer.match(/line\.renderOrder = guideOrder\(r\);/g) || []).length, 2);
});

test('the field stays under every overlay: opaque, depth-tested; overlays skip depth', () => {
  assert.match(renderer, /planeMat\.transparent = false;/);
  assert.match(renderer, /planeMat\.depthTest = true;/);
  const mo = renderer.match(/function markOverlay\(material\) \{([\s\S]*?)\n\}/)[1];
  assert.match(mo, /material\.transparent = true;/);
  assert.match(mo, /material\.depthTest = false;/);
});
