import test from 'node:test';
import assert from 'node:assert/strict';
import {
  easeOutCubic, snapBackAt, worldPerPixel, setupDragLook, setCameraFollow,
  SNAP_MS, DOUBLE_TAP_MS, DOUBLE_TAP_PX, TAP_PX,
} from '../src/drag-look.js';

test('ease-out runs 0 → 1 and clamps', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(-1), 0);
  assert.equal(easeOutCubic(2), 1);
  assert.ok(easeOutCubic(0.5) > 0.5);
  for (let t = 0.1; t <= 1; t += 0.1) assert.ok(easeOutCubic(t) >= easeOutCubic(t - 0.1));
});

test('snap-back moves from the look position to the boat', () => {
  const a = { x: 10, y: -4 }, b = { x: 0, y: 0 };
  assert.deepEqual(snapBackAt(a, b, 0), a);
  assert.deepEqual(snapBackAt(a, b, 1), b);
  const m = snapBackAt(a, b, 0.5);
  assert.ok(m.x < 10 && m.x > 0 && m.y > -4 && m.y < 0);
  assert.equal(SNAP_MS, 300);
});

test('world per pixel follows zoom and height', () => {
  assert.equal(worldPerPixel(30, 0), 0);
  const k = worldPerPixel(30, 700);
  assert.ok(Math.abs(k - (2 * 30 * Math.tan(35 * Math.PI / 180)) / 700) < 1e-12);
  assert.ok(worldPerPixel(60, 700) > k);
});

function fakeCanvas() {
  const h = {};
  return { clientHeight: 700, addEventListener: (t, f) => { h[t] = f; }, fire: (t, touches) => h[t]({ touches, cancelable: true, preventDefault() {} }) };
}
const touch = (x, y, id = 1) => ({ identifier: id, clientX: x, clientY: y });

test('one-finger drag pans, release eases back and resumes follow', () => {
  const view = { camera_follow: true, camera_follow_target: { x: 0, y: 0 }, camera_zoom: 30, camera_position_x: 0, camera_position_y: 0 };
  const c = fakeCanvas();
  let t = 0; const q = [];
  const dl = setupDragLook(view, { canvas: c, now: () => t, raf: (f) => q.push(f), doubleTapEnabled: () => false });
  c.fire('touchstart', [touch(100, 100)]);
  c.fire('touchmove', [touch(200, 150)]);
  assert.equal(view.camera_follow, false);
  assert.ok(view.camera_position_x < 0 && view.camera_position_y > 0);
  assert.ok(dl.dragging);
  c.fire('touchend', []);
  assert.ok(dl.easing);
  for (t = 0; t <= SNAP_MS + 20; t += 20) { const f = q.shift(); if (f) f(); }
  assert.equal(view.camera_follow, true);
  assert.equal(view.camera_position_x, 0);
  assert.equal(view.camera_position_y, 0);
});

test('a tap does not pan; spectators keep the pan with no snap-back', () => {
  const view = { camera_follow: false, camera_follow_target: undefined, camera_zoom: 30, camera_position_x: 5, camera_position_y: 5 };
  const c = fakeCanvas();
  const q = [];
  setupDragLook(view, { canvas: c, now: () => 0, raf: (f) => q.push(f), doubleTapEnabled: () => false });
  c.fire('touchstart', [touch(100, 100)]);
  c.fire('touchmove', [touch(103, 102)]);
  assert.equal(view.camera_position_x, 5);
  c.fire('touchmove', [touch(160, 100)]);
  c.fire('touchend', []);
  assert.ok(view.camera_position_x < 5);
  assert.equal(q.length, 0);
  assert.equal(view.camera_follow, false);
});

test('a second finger hands over to pinch and keeps follow', () => {
  const view = { camera_follow: true, camera_follow_target: { x: 0, y: 0 }, camera_zoom: 30, camera_position_x: 0, camera_position_y: 0 };
  const c = fakeCanvas();
  setupDragLook(view, { canvas: c, now: () => 0, raf: () => {}, doubleTapEnabled: () => false });
  c.fire('touchstart', [touch(100, 100)]);
  c.fire('touchmove', [touch(150, 100)]);
  c.fire('touchstart', [touch(150, 100), touch(300, 300, 2)]);
  c.fire('touchmove', [touch(160, 100), touch(310, 300, 2)]);
  assert.equal(view.camera_follow, true);
});

test('double-tap thresholds are small enough not to fight a drag', () => {
  assert.equal(DOUBLE_TAP_MS, 320);
  assert.equal(DOUBLE_TAP_PX, 28);
  assert.ok(DOUBLE_TAP_PX > TAP_PX);
});

test('setCameraFollow flips the checkbox when present, else the view', () => {
  const view = { camera_follow: false, input_camera_follow(v) { this.camera_follow = v; } };
  setCameraFollow(view, true, null);
  assert.equal(view.camera_follow, true);
  const events = [];
  const box = {
    checked: false,
    dispatchEvent(ev) { events.push(ev.type); this.checked = true; return true; },
  };
  const doc = { getElementById(id) { return id === 'camera_follow' ? box : null; } };
  view.camera_follow = false;
  setCameraFollow(view, true, doc);
  assert.equal(box.checked, true);
  assert.deepEqual(events, ['change']);
});

test('double-tap on a phone/tablet layout toggles Camera Follow', () => {
  const view = {
    camera_follow: false,
    camera_follow_target: { x: 0, y: 0 },
    camera_zoom: 30,
    camera_position_x: 0,
    camera_position_y: 0,
    input_camera_follow(v) { this.camera_follow = v; },
  };
  const c = fakeCanvas();
  let t = 0;
  setupDragLook(view, { canvas: c, now: () => t, raf: () => {}, doubleTapEnabled: () => true });
  c.fire('touchstart', [touch(120, 200)]);
  c.fire('touchend', []);
  assert.equal(view.camera_follow, false);
  t = 200;
  c.fire('touchstart', [touch(125, 204)]);
  c.fire('touchend', []);
  assert.equal(view.camera_follow, true);
  t = 500;
  c.fire('touchstart', [touch(130, 200)]);
  c.fire('touchend', []);
  t = 700;
  c.fire('touchstart', [touch(128, 202)]);
  c.fire('touchend', []);
  assert.equal(view.camera_follow, false);
});

test('a slow second tap or a distant second tap does not toggle', () => {
  const view = {
    camera_follow: true,
    camera_follow_target: { x: 0, y: 0 },
    camera_zoom: 30,
    camera_position_x: 0,
    camera_position_y: 0,
    input_camera_follow(v) { this.camera_follow = v; },
  };
  const c = fakeCanvas();
  let t = 0;
  setupDragLook(view, { canvas: c, now: () => t, raf: () => {}, doubleTapEnabled: () => true });
  c.fire('touchstart', [touch(100, 100)]);
  c.fire('touchend', []);
  t = DOUBLE_TAP_MS + 40;
  c.fire('touchstart', [touch(100, 100)]);
  c.fire('touchend', []);
  assert.equal(view.camera_follow, true);

  t = 1000;
  c.fire('touchstart', [touch(100, 100)]);
  c.fire('touchend', []);
  t = 1100;
  c.fire('touchstart', [touch(100 + DOUBLE_TAP_PX + 5, 100)]);
  c.fire('touchend', []);
  assert.equal(view.camera_follow, true);
});

test('a pan between taps clears the double-tap window', () => {
  const view = {
    camera_follow: false,
    camera_follow_target: { x: 0, y: 0 },
    camera_zoom: 30,
    camera_position_x: 0,
    camera_position_y: 0,
    input_camera_follow(v) { this.camera_follow = v; },
  };
  const c = fakeCanvas();
  let t = 0;
  const q = [];
  setupDragLook(view, { canvas: c, now: () => t, raf: (f) => q.push(f), doubleTapEnabled: () => true });
  c.fire('touchstart', [touch(100, 100)]);
  c.fire('touchend', []);
  t = 50;
  c.fire('touchstart', [touch(100, 100)]);
  c.fire('touchmove', [touch(180, 100)]);
  c.fire('touchend', []);
  t = 100;
  c.fire('touchstart', [touch(110, 100)]);
  c.fire('touchend', []);
  assert.equal(view.camera_follow, false);
});

test('desktop (doubleTapEnabled false) ignores double-tap', () => {
  const view = {
    camera_follow: false,
    camera_follow_target: { x: 0, y: 0 },
    camera_zoom: 30,
    camera_position_x: 0,
    camera_position_y: 0,
    input_camera_follow(v) { this.camera_follow = v; },
  };
  const c = fakeCanvas();
  let t = 0;
  setupDragLook(view, { canvas: c, now: () => t, raf: () => {}, doubleTapEnabled: () => false });
  c.fire('touchstart', [touch(100, 100)]);
  c.fire('touchend', []);
  t = 100;
  c.fire('touchstart', [touch(100, 100)]);
  c.fire('touchend', []);
  assert.equal(view.camera_follow, false);
});

test('a grab on the autopilot button between taps is not a double-tap', async () => {
  const { setupAutopilotHandle } = await import('../src/autopilot-handle.js');
  const view = {
    camera_follow: true, camera_follow_target: { x: 0, y: 0 }, camera_zoom: 30,
    camera_position_x: 0, camera_position_y: 0,
    input_camera_follow(v) { this.camera_follow = v; },
  };
  const c = fakeCanvas();
  let t = 0;
  setupDragLook(view, { canvas: c, now: () => t, raf: () => {}, doubleTapEnabled: () => true });
  const h = {};
  const btn = { hidden: true, style: {}, dataset: {}, setPointerCapture() {}, releasePointerCapture() {}, addEventListener: (k, f) => { h[k] = f; }, removeEventListener() {} };
  const ctl = setupAutopilotHandle(view, {
    doc: null, button: btn, canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 700 }) },
    getCamera: () => null, getBoat: () => ({ ap: 1 }), command: () => {},
  });
  const pe = { pointerId: 7, pointerType: 'touch', cancelable: true, preventDefault() {}, stopPropagation() {} };
  c.fire('touchstart', [touch(120, 200)]);
  c.fire('touchend', []);
  t = 100;
  h.pointerdown(pe); h.pointerup(pe);
  t = 200;
  c.fire('touchstart', [touch(122, 202)]);
  c.fire('touchend', []);
  assert.equal(view.camera_follow, true);
  ctl.dispose();
});
