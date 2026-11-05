import test from 'node:test';
import assert from 'node:assert/strict';
import { swipeIntent, closeDistance, shouldClose, setupSheetSwipe, CLOSE_PX } from '../src/sheet-swipe.js';

test('intent: down closes a bottom sheet, right closes a side sheet', () => {
  assert.equal(swipeIntent(false, 0, 4), null);
  assert.equal(swipeIntent(false, 2, 30), 'close');
  assert.equal(swipeIntent(false, 0, -30), 'other');
  assert.equal(swipeIntent(false, 30, 5), 'other');
  assert.equal(swipeIntent(true, 30, 5), 'close');
  assert.equal(swipeIntent(true, -30, 5), 'other');
  assert.equal(swipeIntent(true, 5, 30), 'other');
  assert.equal(closeDistance(false, 9, -5), 0);
  assert.equal(closeDistance(true, 40, 0), 40);
});

test('release: far enough or a flick closes', () => {
  assert.ok(shouldClose(CLOSE_PX, 1000));
  assert.ok(!shouldClose(40, 1000));
  assert.ok(shouldClose(40, 50));
  assert.ok(!shouldClose(5, 1));
});

function fakeSheet() {
  const h = {};
  const s = { style: {}, addEventListener: (t, f) => { h[t] = f; } };
  s.fire = (t, touches, target = s) => { let p = false; h[t]({ touches, target, cancelable: true, preventDefault() { p = true; } }); return p; };
  return s;
}
const tt = (x, y) => [{ clientX: x, clientY: y }];

test('swipe down closes the bottom sheet; a short one springs back', () => {
  const s = fakeSheet(); let closed = 0, t = 0;
  setupSheetSwipe(s, { isSide: () => false, close: () => closed++, now: () => t });
  s.fire('touchstart', tt(100, 100));
  assert.ok(s.fire('touchmove', tt(100, 140)));
  assert.match(s.style.transform, /translateY\(40px\)/);
  t = 1000; s.fire('touchmove', tt(100, 200)); s.fire('touchend', []);
  assert.equal(closed, 1);
  s.fire('touchstart', tt(100, 100)); t = 3000; s.fire('touchmove', tt(100, 130)); t = 5000; s.fire('touchend', []);
  assert.equal(closed, 1); assert.equal(s.style.transform, '');
});

test('scrolled pane and upward moves keep scrolling', () => {
  const s = fakeSheet(); let closed = 0;
  setupSheetSwipe(s, { isSide: () => false, close: () => closed++, now: () => 0 });
  const pane = { parentNode: s, scrollHeight: 900, clientHeight: 300, scrollTop: 50 };
  s.fire('touchstart', tt(100, 100), pane);
  assert.ok(!s.fire('touchmove', tt(100, 200), pane));
  s.fire('touchend', []);
  s.fire('touchstart', tt(100, 300));
  assert.ok(!s.fire('touchmove', tt(100, 200)));
  s.fire('touchend', []);
  assert.equal(closed, 0);
});

test('side sheet closes on a right swipe, not on a vertical one', () => {
  const s = fakeSheet(); let closed = 0;
  setupSheetSwipe(s, { isSide: () => true, close: () => closed++, now: () => 0 });
  s.fire('touchstart', tt(100, 100)); s.fire('touchmove', tt(100, 220)); s.fire('touchend', []);
  assert.equal(closed, 0);
  s.fire('touchstart', tt(100, 100)); s.fire('touchmove', tt(220, 104));
  assert.match(s.style.transform, /translateX\(120px\)/);
  s.fire('touchend', []);
  assert.equal(closed, 1);
});
