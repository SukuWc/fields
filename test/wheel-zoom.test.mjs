// Wheel / trackpad zoom on the race view: pixel vs line deltas, the +/- step,
// cursor anchoring, follow staying on the boat, and preventDefault only when
// the canvas actually zooms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { View } from '../src/view.js';
import {
  LINE_PX, NOTCH_PX, NOTCH_STEP, MAX_EVENT_PX,
  wheelPixels, wheelZoomStep, applyWheelZoom, setupWheelZoom,
} from '../src/wheel-zoom.js';

function viewAt(zoom = 30) {
  const v = new View();
  v.camera_zoom = zoom;
  v.camera_zoom_min = 10;
  v.camera_zoom_max = 70;
  v.camera_position_x = 0;
  v.camera_position_y = 0;
  v.camera_follow = false;
  return v;
}

const rect = { left: 0, top: 0, width: 800, height: 600 };

test('deltaMode: pixels, lines and pages', () => {
  assert.equal(wheelPixels(100, 0, 600), 100);
  assert.equal(wheelPixels(3, 1, 600), 3 * LINE_PX);
  assert.equal(wheelPixels(1, 2, 600), 600);
  assert.equal(wheelPixels(NaN, 0, 600), 0);
});

test('one notch matches a +/- step and a burst is capped', () => {
  assert.equal(wheelZoomStep(NOTCH_PX), NOTCH_STEP);
  assert.equal(wheelZoomStep(-NOTCH_PX), -NOTCH_STEP);
  assert.equal(wheelZoomStep(10), 0.2);
  assert.equal(wheelZoomStep(0), 0);
  assert.equal(wheelZoomStep(10_000), MAX_EVENT_PX / NOTCH_PX * NOTCH_STEP);
  assert.equal(wheelZoomStep(-10_000), -MAX_EVENT_PX / NOTCH_PX * NOTCH_STEP);
});

test('wheel down zooms out, wheel up zooms in, and the limits hold', () => {
  const out = viewAt(30);
  applyWheelZoom(out, { deltaY: 100, rect, clientX: 400, clientY: 300 });
  assert.ok(out.camera_zoom > 30);
  const inn = viewAt(30);
  applyWheelZoom(inn, { deltaY: -100, rect, clientX: 400, clientY: 300 });
  assert.ok(inn.camera_zoom < 30);
  const hi = viewAt(70);
  applyWheelZoom(hi, { deltaY: 500, rect, clientX: 400, clientY: 300 });
  assert.equal(hi.camera_zoom, 70);
  const lo = viewAt(10);
  applyWheelZoom(lo, { deltaY: -500, rect, clientX: 400, clientY: 300 });
  assert.equal(lo.camera_zoom, 10);
});

test('follow off keeps the world point under the cursor', () => {
  const v = viewAt(30);
  // Cursor right of centre. Zooming in moves the camera toward that point.
  applyWheelZoom(v, { deltaY: -100, rect, clientX: 600, clientY: 300 });
  assert.ok(v.camera_position_x > 0);
  assert.equal(v.camera_position_y, 0);
  const centre = viewAt(30);
  applyWheelZoom(centre, { deltaY: -100, rect, clientX: 400, clientY: 300 });
  assert.equal(centre.camera_position_x, 0);
  assert.equal(centre.camera_position_y, 0);
});

test('follow on zooms but leaves the camera on the boat', () => {
  const v = viewAt(30);
  v.camera_follow = true;
  v.camera_position_x = 4;
  v.camera_position_y = -3;
  applyWheelZoom(v, { deltaY: -100, rect, clientX: 700, clientY: 100, follow: true });
  assert.ok(v.camera_zoom < 30);
  assert.equal(v.camera_position_x, 4);
  assert.equal(v.camera_position_y, -3);
});

test('the canvas listener zooms and blocks page scroll; a zero delta does not', () => {
  const v = viewAt(30);
  const listeners = {};
  const canvas = {
    getBoundingClientRect: () => rect,
    addEventListener(type, fn) { listeners[type] = fn; },
  };
  setupWheelZoom(v, canvas);
  let prevented = false;
  listeners.wheel({ deltaY: 100, deltaMode: 0, clientX: 400, clientY: 300, cancelable: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.ok(v.camera_zoom > 30);
  const before = v.camera_zoom;
  prevented = false;
  listeners.wheel({ deltaY: 0, deltaMode: 0, clientX: 400, clientY: 300, cancelable: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(v.camera_zoom, before);
  assert.equal(setupWheelZoom(v, null), null);
});
