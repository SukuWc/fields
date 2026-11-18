// Chat timestamps and rule lines (src/chat-log.js) and the cleared calls
// they come from (src/rule-toasts.js RuleCallTracker).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chatTimeOf, raceClockOf, chatBoatName, ruleChatText, RuleChatFeed, DEDUPE_S } from '../src/chat-log.js';
import { RuleCallTracker } from '../src/rule-toasts.js';

const boats = [{ id: 's0' }, { id: 's1' }];
const statics = { defs: [{ name: 'Ann' }, {}] };
const pair = [{ k: 'o', a: 's0', b: 's1', r: 'o', ln: [['10', 'f', '10']] }];

test('timestamps: race time like the race clock, else local HH:MM', () => {
  assert.equal(chatTimeOf({ rc: 133.4 }).text, '+2:13');
  assert.equal(chatTimeOf({ rc: -44.2 }).text, '−0:45');
  const at = new Date(2026, 10, 18, 9, 7, 30).getTime();
  assert.deepEqual(chatTimeOf({ at }), { text: '09:07', title: '09:07:30' });
  assert.match(chatTimeOf({ at, rc: 5 }).title, /^Race time \+0:05 · 09:07:30$/);
  assert.equal(chatTimeOf({}, at).text, '09:07', 'receive time without at');
  assert.equal(raceClockOf({ hud: { st: { clock: -3 } } }), -3);
  assert.equal(raceClockOf({ hud: {} }), null);
});

test('chat names: player name and number, else Boat n', () => {
  assert.equal(chatBoatName('s0', { boats }, statics), 'Ann #0');
  assert.equal(chatBoatName('s1', { boats }, statics), 'Boat 1');
  assert.equal(chatBoatName('zz', { boats }, statics), 'Boat zz');
});

test('penalty and cleared lines: boats, rule, penalty; deduped; stamped from the frame', () => {
  const tr = new RuleCallTracker();
  const feed = new RuleChatFeed();
  const frame = (ts, pen, extra = {}) => ({ boats, ts, ep: 1, hud: { st: { clock: ts - 60 } }, pen, ...extra });
  const step = (st) => feed.messages(tr.update(st), st, statics, 1000);
  assert.deepEqual(step(frame(0, { boats: [], cleared: [] })), []);
  step(frame(1, { boats: [], cleared: [] }, { pair }));
  const p = step(frame(1.5, { boats: [{ i: 's1', c: 1, ic: null }], cleared: [] }));
  assert.equal(p.length, 1);
  assert.equal(p[0].text, '⚑ Boat 1 · RRS 10 (port keeps clear of starboard) vs Ann #0 · one-turn penalty (tack + gybe)');
  assert.equal(p[0].rule, 'penalty');
  assert.equal(p[0].sys, true);
  assert.equal(p[0].rc, -58.5);
  assert.equal(chatTimeOf(p[0]).text, '−0:59');
  // same frame data again: nothing new
  assert.deepEqual(step(frame(1.6, { boats: [{ i: 's1', c: 1, ic: null }], cleared: [] })), []);
  // the CLEARED flash: one cleared line naming the rule, for as long as it shows
  const c = step(frame(8, { boats: [], cleared: [{ i: 's1', c: 0 }] }));
  assert.equal(c.length, 1);
  assert.equal(c[0].rule, 'cleared');
  assert.equal(c[0].text, '✓ Boat 1 cleared the RRS 10 penalty (turn done)');
  assert.deepEqual(step(frame(8.5, { boats: [], cleared: [{ i: 's1', c: 0 }] })), []);
  assert.deepEqual(step(frame(9, { boats: [], cleared: [] })), []);
});

test('two penalties, two turns in a row: two cleared calls; a finish drop is not a clear', () => {
  const tr = new RuleCallTracker();
  const f = (ts, pen) => tr.update({ boats, ts, ep: 1, pen });
  f(0, { boats: [], cleared: [] });
  const p = f(1, { boats: [{ i: 's0', c: 2, ic: ['31', 'g2'] }], cleared: [] });
  assert.equal(p.length, 1);
  assert.equal(p[0].count, 2);
  const c1 = f(5, { boats: [{ i: 's0', c: 1, ic: ['31', 'g2'] }], cleared: [{ i: 's0', c: 1 }] });
  assert.deepEqual(c1.map((x) => [x.kind, x.count, x.cleared]), [['cleared', 1, 'Rule 31']]);
  const c2 = f(6, { boats: [], cleared: [{ i: 's0', c: 0 }] });
  assert.deepEqual(c2.map((x) => [x.kind, x.count]), [['cleared', 0]], 'second turn while the flash still shows');
  f(10, { boats: [], cleared: [] });
  f(11, { boats: [{ i: 's1', c: 1, ic: ['Bd'] }], cleared: [] });
  assert.deepEqual(f(12, { boats: [], cleared: [] }), [], 'finish: count drops with no flash');
});

test('dedupe: the same incident within DEDUPE_S is one line; after a clear a new penalty is new', () => {
  const feed = new RuleChatFeed();
  const st = (ts) => ({ boats, ts, ep: 1 });
  const call = { kind: 'penalty', boat: 's1', other: 's0', code: '10', count: 1, ref: 'Rule 10', text: 'port keeps clear of starboard' };
  assert.equal(feed.messages([call], st(1), statics).length, 1);
  assert.equal(feed.messages([call], st(1 + DEDUPE_S - 1), statics).length, 0, 'tracker re-prime / repeat');
  assert.equal(feed.messages([{ kind: 'cleared', boat: 's1', other: null, code: null, count: 0, ref: 'Cleared', text: '', cleared: 'Rule 10' }], st(4), statics).length, 1);
  assert.equal(feed.messages([call], st(5), statics).length, 1, 'new penalty after the clear');
  assert.equal(feed.messages([call], st(5 + DEDUPE_S + 1), statics).length, 1, 'outside the window');
  assert.equal(feed.messages([call], { boats, ts: 5, ep: 2 }, statics).length, 1, 'new race (epoch)');
  assert.match(ruleChatText({ kind: 'penalty', boat: 's0', other: null, count: 2, ref: 'Penalty', text: '' }, st(0), statics), /^⚑ Ann #0 · Penalty · one-turn penalty \(tack \+ gybe\) · 2 pending$/);
});
