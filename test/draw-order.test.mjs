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

test('mark zone circles draw under the tracers; rings, course line and rounding ray keep ORDER_GUIDE', () => {
  const c = { x: 5, y: 30 };
  const cs = { n: 1, anchors: [c], gates: [null], sides: [0], start: { x: 0, y: -20 }, fin: null, lapsFinite: false };
  const s = { c: [c], waiting: false, display: 0, view: { index: 0, midDeg: 90, rounded: false }, rounded: [] };
  const segs = courseGuidesFromState(cs, s, 0).filter((r) => r.type === 'guide');
  const zone = segs.filter((r) => onZone(r, c));
  const rest = segs.filter((r) => !onZone(r, c));
  assert.ok(zone.length >= 30, 'dashed zone circle');
  for (const r of zone) assert.ok(under(guideOrder(r)));
  assert.ok(rest.length > 0);
  for (const r of rest) assert.equal(guideOrder(r), ORDER_GUIDE);
});

test('gate zone circles draw under the tracers too', () => {
  const a = { x: -4, y: 50 }, b = { x: 4, y: 50 };
  const cs = { n: 1, anchors: [{ x: 0, y: 50 }], gates: [[a, b]], sides: [0], start: { x: 0, y: -20 }, fin: null, lapsFinite: false };
  const s = { c: [[a, b]], waiting: false, display: 1, view: { index: 0, midDeg: 90, rounded: false }, rounded: [] };
  const segs = courseGuidesFromState(cs, s, 0).filter((r) => r.type === 'guide');
  for (const c of [a, b]) {
    const zone = segs.filter((r) => onZone(r, c));
    assert.ok(zone.length >= 30);
    for (const r of zone) assert.ok(under(guideOrder(r)));
  }
  for (const r of segs.filter((r) => !onZone(r, a) && !onZone(r, b))) assert.equal(guideOrder(r), ORDER_GUIDE);
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
