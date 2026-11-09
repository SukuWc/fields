import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildScene } from '../src/scene-build.js';
import { boatColor } from '../src/boat-colors.js';
import { sceneDiff, geom } from './scene-diff.mjs';
import {
  rowCirclePoints,
  rowCircles,
  rowOutlineColors,
  rowPovId,
  ROW_CIRCLE_R,
  ROW_GREEN,
  ROW_RED,
  ROW_YELLOW,
} from '../src/row-outline.js';

test('player keeps clear: opponent red; player right of way: green', () => {
  const m = rowOutlineColors('me', [{ k: 'o', a: 'x', b: 'me' }, { k: 'o', a: 'me', b: 'y' }]);
  assert.equal(m.get('x'), ROW_RED);
  assert.equal(m.get('y'), ROW_GREEN);
});
test('Rule 15 window and both-tacking are yellow', () => {
  const m = rowOutlineColors('me', [{ k: '15', a: 'me', b: 'x' }, { k: 'b', a: 'y', b: 'me' }]);
  assert.equal(m.get('x'), ROW_YELLOW);
  assert.equal(m.get('y'), ROW_YELLOW);
});
test('room owed between the pair turns it yellow', () => {
  const m = rowOutlineColors('me', [{ k: 'o', a: 'x', b: 'me' }], [['me', 'x']]);
  assert.equal(m.get('x'), ROW_YELLOW);
});
test('pairs without the player, outside the gate, or no player: none', () => {
  assert.equal(rowOutlineColors('me', [{ k: 'o', a: 'x', b: 'y' }]).size, 0);
  assert.equal(rowOutlineColors('me', undefined, [['me', 'z']]).size, 0);
  assert.equal(rowOutlineColors(null, [{ k: 'o', a: 'me', b: 'x' }]).size, 0);
});

test('POV: own boat in multiplayer, boat 0 by id otherwise', () => {
  const boats = [{ id: 's7' }, { id: 0 }, { id: 'p1' }];
  assert.equal(rowPovId('p1', boats), 'p1');
  assert.equal(rowPovId(null, boats), 0);
  assert.equal(rowPovId(null, [{ id: 's3' }, { id: 's4' }]), 's3');
  assert.equal(rowPovId(null, []), null);
  const m = rowOutlineColors(rowPovId(null, boats), [{ k: 'o', a: 0, b: 's7' }]);
  assert.equal(m.get('s7'), ROW_GREEN);
});

// Enough drawing numbers that boatGuides stays finite, so an on/off scene
// diff is a real comparison. 'far' is not in a pair (outside the gate).
// List order is not id order.
function boat(id, x, y) {
  return {
    id, x, y, px: x, py: y, pa: 0.4, ha: 0.4, awa: 30, tw: 1.2, ap: 1, wd: 90,
    aht: -50, twa: 50, bv1: 50, bv2: 160, ra: 2, mba: 12, jba: 18, mf: 0, jf: 0, ph: 0, f: [],
  };
}
const BOATS = [
  boat('far', 80, -40),
  boat('me', 0, 1),
  boat('give', 6, 2),
  boat('row', -4, 3),
  boat('tack', 1, 8),
];
const DEF = { rp: -2, rl: 0.6, cp: 0.2, cl: 0.8, mle: 0.3, mbl: 2.2, jle: 1.4, jbl: 1.6 };
const PAIR = [
  { k: 'o', a: 'give', b: 'me', ln: [] },
  { k: 'o', a: 'me', b: 'row', ln: [] },
  { k: '15', a: 'me', b: 'tack', ln: [] },
];

function onCircle(c) {
  assert.equal(c.r, ROW_CIRCLE_R);
  assert.equal(c.r, 3);
  const pts = c.pts;
  assert.equal(pts[0], pts[pts.length - 2]);
  assert.equal(pts[1], pts[pts.length - 1]);
  for (let i = 0; i < pts.length; i += 2) {
    const d = Math.hypot(pts[i] - c.x, pts[i + 1] - c.y);
    assert.ok(Math.abs(d - 3) < 1e-9, `${c.id} point ${i / 2} radius ${d}`);
  }
}

test('circle radius is 3 m and the polyline lies on that circle', () => {
  const pts = rowCirclePoints(2, -5, 3);
  assert.equal(pts[0], 5);
  assert.equal(pts[1], -5);
  const circles = rowCircles(rowOutlineColors('me', PAIR), BOATS);
  assert.equal(circles.length, 3);
  for (const c of circles) onCircle(c);
});

test('circle colours follow the rule state, looked up by boat id', () => {
  const reversed = [...BOATS].reverse();
  const circles = rowCircles(rowOutlineColors('me', PAIR), reversed);
  const byId = new Map(circles.map((c) => [c.id, c]));
  assert.equal(byId.get('give').color, ROW_RED);
  assert.equal(byId.get('give').x, 6);
  assert.equal(byId.get('give').y, 2);
  assert.equal(byId.get('row').color, ROW_GREEN);
  assert.equal(byId.get('row').x, -4);
  assert.equal(byId.get('row').y, 3);
  assert.equal(byId.get('tack').color, ROW_YELLOW);
  assert.equal(byId.get('tack').x, 1);
  assert.equal(byId.get('tack').y, 8);
  // Same boats, opposite list order: still the boat's own position, not an index.
  const forward = rowCircles(rowOutlineColors('me', PAIR), BOATS);
  assert.deepEqual(
    forward.map((c) => [c.id, c.x, c.y, c.color]).sort(),
    circles.map((c) => [c.id, c.x, c.y, c.color]).sort(),
  );
});

test('no circle outside active range, on the POV boat, or for a missing id', () => {
  const colors = rowOutlineColors('me', PAIR);
  const circles = rowCircles(colors, BOATS);
  const ids = circles.map((c) => c.id);
  assert.deepEqual(ids.filter((id) => id === 'far' || id === 'me'), []);
  assert.equal(rowCircles(colors, [{ id: 'me', x: 0, y: 0 }]).length, 0);
  assert.equal(rowCircles(new Map([['gone', ROW_RED]]), BOATS).length, 0);
  assert.equal(rowCircles(colors, [{ id: 'give' }]).length, 0);
  // px/py when x/y are absent (still by id).
  const px = rowCircles(new Map([['give', ROW_RED]]), [{ id: 'row', px: 9, py: 9 }, { id: 'give', px: 1.5, py: -2.5 }]);
  assert.equal(px.length, 1);
  assert.equal(px[0].id, 'give');
  assert.equal(px[0].x, 1.5);
  assert.equal(px[0].y, -2.5);
  assert.equal(px[0].r, 3);
});

test('room owed paints the in-range circle yellow and adds nobody outside the gate', () => {
  const colors = rowOutlineColors('me', [{ k: 'o', a: 'x', b: 'me' }], [['me', 'x'], ['me', 'z']]);
  const circles = rowCircles(colors, [{ id: 'me', x: 0, y: 0 }, { id: 'x', x: 5, y: 0 }, { id: 'z', x: 30, y: 0 }]);
  assert.equal(circles.length, 1);
  assert.equal(circles[0].id, 'x');
  assert.equal(circles[0].color, ROW_YELLOW);
  assert.equal(circles[0].r, 3);
});

const STATICS = { bodies: [], defs: BOATS.map(() => ({ ...DEF })) };

test('enabling the setting does not change hull geometry or hull colours', () => {
  const state = { boats: BOATS, pair: PAIR, br: [['me', 'give']] };
  const off = buildScene(state, STATICS, { show_row_outline: false }, 'me');
  const on = buildScene(state, STATICS, { show_row_outline: true }, 'me');
  assert.equal(sceneDiff(geom(off), geom(on)), 0);
  assert.equal(off.rowCircles, undefined);
  assert.equal(off.rowOutline, undefined);
  assert.equal(on.rowOutline, undefined);
  assert.equal(on.rowCircles.length, 3);
  // Room owed turns the red pair yellow; the boat outside the gate is still absent.
  assert.equal(on.rowCircles.find((c) => c.id === 'give').color, ROW_YELLOW);
  assert.equal(on.rowCircles.find((c) => c.id === 'far'), undefined);
  assert.equal(on.rowCircles.find((c) => c.id === 'me'), undefined);
  for (const c of on.rowCircles) assert.equal(c.r, 3);

  const renderer = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
  const hullStart = renderer.indexOf('function renderHullFills');
  const hullEnd = renderer.indexOf('function renderRowCircles');
  const hull = renderer.slice(hullStart, hullEnd);
  assert.ok(hullStart > 0 && hullEnd > hullStart);
  assert.match(hull, /function renderHullFills\(\)/);
  assert.match(hull, /trailColorOf\(g\.i\)/);
  assert.match(hull, /boatColor\(g\.i\)/);
  assert.doesNotMatch(hull, /white|ROW_NONE|0xffffff|\[1,\s*1,\s*1\]/);
  assert.match(renderer, /renderHullFills\(\);/);
  assert.doesNotMatch(renderer, /renderHullFills\([^)]/);
  assert.match(renderer, /renderRowCircles\(sceneData\.rowCircles\)/);
  assert.match(renderer, /new Line2|fatLine\(/);
  assert.doesNotMatch(renderer, /rowOutline|ROW_NONE/);
  for (let i = 0; i < BOATS.length; i++) assert.notEqual(boatColor(i), 0xffffff);
});

test('single-player POV is boat 0 by id, and only that boat\'s opponents are circled', () => {
  const boats = [{ id: 's7', x: 3, y: 4 }, { id: 0, x: 0, y: 0 }, { id: 'p1', x: 9, y: 1 }];
  const scene = buildScene(
    { boats, pair: [{ k: 'o', a: 0, b: 's7', ln: [] }, { k: 'o', a: 'p1', b: 's7', ln: [] }] },
    { bodies: [], defs: [{}, {}, {}] },
    { show_row_outline: true },
    null,
  );
  assert.equal(scene.rowCircles.length, 1);
  assert.equal(scene.rowCircles[0].id, 's7');
  assert.equal(scene.rowCircles[0].color, ROW_GREEN);
  assert.equal(scene.rowCircles[0].x, 3);
  assert.equal(scene.rowCircles[0].y, 4);
  assert.equal(scene.rowCircles[0].r, 3);
});
