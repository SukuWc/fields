import test from 'node:test';
import assert from 'node:assert/strict';
import { buzz, canVibrate, createHaptics, TackDetector, TACK_PATTERN, PENALTY_PATTERN } from '../src/haptics.js';
import { SETTINGS } from '../src/settings-registry.js';

const fakeNav = () => { const calls = []; return { calls, vibrate: (p) => { calls.push(p); return true; } }; };

test('no vibrate API: quietly does nothing', () => {
  assert.equal(canVibrate({}), false);
  assert.equal(canVibrate(undefined), false);
  assert.equal(buzz(30, {}), false);
  assert.equal(buzz(30, { vibrate() { throw new Error('blocked'); } }), false);
  const h = createHaptics({ nav: {} });
  h.onReadout({ boatId: 0, twa: 40 });
  assert.equal(h.onReadout({ boatId: 0, twa: -40 }), false);
  assert.equal(h.onOwnPenalty(), false);
});

test('tack is a sign change upwind, not a gybe', () => {
  const t = new TackDetector();
  assert.equal(t.update(0, 45), false);
  assert.equal(t.update(0, 20), false);
  assert.equal(t.update(0, -10), true);
  assert.equal(t.update(0, -150), false);
  assert.equal(t.update(0, 170), false); // gybe
  assert.equal(t.update(1, -40), false); // other boat: start over
});

test('buzzes on tack and penalty, honours the setting', () => {
  const nav = fakeNav();
  let on = true;
  const h = createHaptics({ nav, enabled: () => on });
  h.onReadout({ boatId: 0, twa: 40 });
  h.onReadout({ boatId: 0, twa: -40 });
  h.onOwnPenalty();
  assert.deepEqual(nav.calls, [TACK_PATTERN, PENALTY_PATTERN]);
  on = false;
  h.onReadout({ boatId: 0, twa: 40 });
  h.onOwnPenalty();
  assert.equal(nav.calls.length, 2);
});

test('vibrate is a player setting, on by default', () => {
  const s = SETTINGS.find((x) => x.id === 'vibrate');
  assert.ok(s);
  assert.equal(s.scope, 'player');
  assert.equal(s.type, 'bool');
  assert.equal(s.default, true);
});
