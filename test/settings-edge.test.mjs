// Right-edge swipe opens and closes the mobile settings drawer. A touch that
// starts on the strip does not pan the race view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupDragLook } from '../src/drag-look.js';
import {
  EDGE_W, OPEN_PX, START_PX, axisIntent, inwardPx, outwardPx, shouldCommit, setupSettingsEdge,
} from '../src/settings-edge.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tt = (x, y) => [{ clientX: x, clientY: y, identifier: 1 }];

function fakeEl() {
  const h = {};
  const el = {
    style: {}, offsetWidth: 300, parentNode: null,
    addEventListener(t, f) { (h[t] ||= []).push(f); },
    closest() { return null; },
  };
  el.fire = (t, touches, target = el) => {
    let stopped = false, prevented = false;
    for (const f of h[t] || []) f({
      touches, target, cancelable: true,
      stopPropagation() { stopped = true; },
      preventDefault() { prevented = true; },
    });
    return { stopped, prevented };
  };
  return el;
}

test('thresholds: inward opens, a short drag cancels, a flick commits', () => {
  assert.equal(EDGE_W, 16);
  assert.equal(axisIntent(4, 0), null);
  assert.equal(axisIntent(-40, 4), 'x');
  assert.equal(axisIntent(4, 40), 'y');
  assert.equal(inwardPx(-90), 90);
  assert.equal(inwardPx(20), 0);
  assert.equal(outwardPx(90), 90);
  assert.equal(shouldCommit(OPEN_PX, 1000), true);
  assert.equal(shouldCommit(40, 1000), false);
  assert.equal(shouldCommit(START_PX * 2, 30), true);
  assert.equal(shouldCommit(5, 1), false);
});

test('the strip is 16px on the right, inside the safe area, and desktop hides it', () => {
  assert.match(html, /#settings_edge \{ display: none; \}/);
  assert.match(html, /\.bp-touch #settings_edge \{[\s\S]*?right: env\(safe-area-inset-right\); width: 16px/);
  assert.match(html, /\.bp-phone:not\(\.bp-phone-landscape\) body:not\(\.touch-on\) #settings_edge/);
  assert.match(html, /top: calc\(var\(--m-top\) \+ 104px\)/);
  assert.match(html, /settings-edge-debug/);
  assert.ok(!html.includes('id="touch_layout"'));
});

test('a left swipe past the threshold opens; a short one closes again', () => {
  const edge = fakeEl(), panel = fakeEl();
  let open = false;
  const opens = [];
  setupSettingsEdge({
    edge, panel, isOpen: () => open, setOpen: (v) => { open = v; opens.push(v); }, enabled: () => true, now: () => 0,
  });
  const start = edge.fire('touchstart', tt(390, 400));
  assert.equal(start.stopped, true);
  edge.fire('touchmove', tt(300, 404));
  assert.match(panel.style.transform, /translateX\(/);
  edge.fire('touchend', []);
  assert.deepEqual(opens, [true]);

  open = false; opens.length = 0;
  edge.fire('touchstart', tt(390, 400));
  edge.fire('touchmove', tt(360, 402));
  edge.fire('touchend', []);
  assert.equal(open, false);
  assert.deepEqual(opens, []);
  assert.equal(panel.style.transform, '');
});

test('a vertical move on the strip does not open the drawer', () => {
  const edge = fakeEl(), panel = fakeEl();
  let open = false;
  setupSettingsEdge({ edge, panel, isOpen: () => open, setOpen: (v) => { open = v; }, enabled: () => true, now: () => 0 });
  edge.fire('touchstart', tt(390, 200));
  edge.fire('touchmove', tt(388, 280));
  edge.fire('touchend', []);
  assert.equal(open, false);
});

test('an open drawer closes on a right swipe and stays for a short one', () => {
  const edge = fakeEl(), panel = fakeEl();
  let open = true;
  setupSettingsEdge({ edge, panel, isOpen: () => open, setOpen: (v) => { open = v; }, enabled: () => true, now: () => 0 });
  panel.fire('touchstart', tt(200, 300));
  panel.fire('touchmove', tt(300, 304));
  panel.fire('touchend', []);
  assert.equal(open, false);

  open = true;
  panel.fire('touchstart', tt(200, 300));
  panel.fire('touchmove', tt(230, 300));
  panel.fire('touchend', []);
  assert.equal(open, true);
});

test('a control inside the drawer is not treated as a close swipe', () => {
  const edge = fakeEl(), panel = fakeEl();
  let open = true;
  const input = { closest: () => input, parentNode: panel };
  setupSettingsEdge({ edge, panel, isOpen: () => open, setOpen: (v) => { open = v; }, enabled: () => true, now: () => 0 });
  panel.fire('touchstart', tt(40, 40), input);
  panel.fire('touchmove', tt(200, 40), input);
  panel.fire('touchend', []);
  assert.equal(open, true);
});

test('desktop does not open from the strip', () => {
  const edge = fakeEl(), panel = fakeEl();
  let open = false;
  setupSettingsEdge({ edge, panel, isOpen: () => open, setOpen: (v) => { open = v; }, enabled: () => false, now: () => 0 });
  edge.fire('touchstart', tt(390, 400));
  edge.fire('touchmove', tt(200, 400));
  edge.fire('touchend', []);
  assert.equal(open, false);
});

test('a strip swipe does not pan the race view', () => {
  const canvas = fakeEl();
  canvas.clientHeight = 800;
  const view = {
    camera_follow: true, camera_follow_target: { x: 1, y: 2 },
    camera_position_x: 5, camera_position_y: 6, camera_zoom: 30,
  };
  setupDragLook(view, { canvas, now: () => 0, raf: (f) => f() });
  const edge = fakeEl(), panel = fakeEl();
  setupSettingsEdge({ edge, panel, isOpen: () => false, setOpen() {}, enabled: () => true, now: () => 0 });
  edge.fire('touchstart', tt(400, 300));
  edge.fire('touchmove', tt(300, 300));
  assert.equal(view.camera_position_x, 5);
  assert.equal(view.camera_position_y, 6);
  assert.equal(view.camera_follow, true);
  canvas.fire('touchstart', tt(200, 200));
  canvas.fire('touchmove', tt(120, 200));
  assert.notEqual(view.camera_position_x, 5);
});
