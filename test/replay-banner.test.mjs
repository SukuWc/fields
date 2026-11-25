// Replay timeline banner (src/replay-banner.js) against a tiny fake DOM and
// a fake host: scrub bar, shaded simulated part, seek progress, speeds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupReplayBanner } from '../src/replay-banner.js';
import { fmtTicks } from '../src/replay-banner.js';
import { seekText } from '../src/replay-banner.js';

class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.attrs = {};
    this.listeners = {}; this.hidden = false; this.textContent = '';
  }
  set style(v) { this._style = typeof v === 'object' ? v : {}; }
  get style() { return this._style; }
  append(...c) { this.children.push(...c); }
  appendChild(c) { this.children.push(c); return c; }
  insertBefore(c, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; }
  replaceChildren(...c) { this.children = c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  fire(t, e = {}) { for (const fn of this.listeners[t] || []) fn({ stopPropagation() {}, ...e }); }
  blur() {}
  find(pred) {
    if (pred(this)) return this;
    for (const c of this.children) { const f = c.find && c.find(pred); if (f) return f; }
    return null;
  }
}
const doc = () => ({ createElement: (t) => new El(t), head: new El('head'), body: new El('body') });
const byId = (d, id) => d.body.find((e) => e.id === id);

function fakeHost(st0) {
  const calls = [];
  let fn = null;
  const host = {
    paused: false,
    st: { id: 'x', room: 'Europe 1', players: ['suku'], t: 300, ticks: 1968, checked: 10, total: 66, done: false, paused: false, speed: 1, seeking: null, simulatedTo: 1099, keyframes: [0, 300, 600, 900], ...st0 },
    status() { return this.st; },
    onStatus(f) { fn = f; f(this.st); },
    emit(patch) { this.st = { ...this.st, ...patch }; fn(this.st); },
    setPaused(p) { calls.push(['pause', p]); this.paused = p; },
    setSpeed(n) { calls.push(['speed', n]); },
    seek(t) { calls.push(['seek', t]); },
    cancelSeek() { calls.push(['cancel']); },
  };
  return { host, calls };
}

test('time format and seek text', () => {
  assert.equal(fmtTicks(0), '0:00');
  assert.equal(fmtTicks(30 * 192), '3:12');
  assert.equal(fmtTicks(1968), '1:05');
  assert.equal(seekText({ seeking: { from: 0, to: 30 * 460, at: 30 * 192, start: 0 } }), 'Simulating 3:12 → 7:40');
  assert.equal(seekText({ seeking: null }), '');
});

test('timeline shows time, the simulated part and keyframes; scrubbing seeks', () => {
  const d = doc();
  const { host, calls } = fakeHost();
  setupReplayBanner(host, d);
  assert.equal(byId(d, 'replay_time').textContent, '0:10');
  assert.equal(byId(d, 'replay_total').textContent, '1:05');
  assert.match(byId(d, 'replay_status').textContent, /^hashes OK 10\/66$/);
  const line = byId(d, 'replay_timeline');
  const sim = line.find((e) => e.className === 'simulated');
  assert.equal(sim.style.width, (100 * 1099 / 1968) + '%');
  assert.equal(line.find((e) => e.className === 'kf') !== null, true);
  const range = byId(d, 'replay_scrub');
  assert.equal(range.max, '1968');
  range.value = '1500';
  range.fire('input');
  assert.equal(byId(d, 'replay_time').textContent, '0:50', 'shows the dragged time');
  host.emit({ t: 310 });
  assert.equal(range.value, '1500', 'a status does not move the thumb while dragging');
  range.fire('change');
  assert.deepEqual(calls.at(-1), ['seek', 1500]);
  host.emit({ t: 311 });
  assert.equal(range.value, '1500', 'the thumb waits at the target until the seek starts');
  host.emit({ t: 311, seeking: { from: 311, to: 1500, at: 900, start: 900 } });
  host.emit({ t: 1500, seeking: null });
  host.emit({ t: 1501 });
  assert.equal(range.value, '1501', 'then follows playback again');
});

test('seek progress row with Cancel; speeds; Play at the end starts over', () => {
  const d = doc();
  const { host, calls } = fakeHost();
  const bar = setupReplayBanner(host, d);
  assert.equal(byId(d, 'replay_seek').style.display, 'none');
  host.emit({ seeking: { from: 300, to: 30 * 460, at: 30 * 192, start: 0 } });
  assert.equal(bar.dataset.state, 'seeking');
  assert.equal(byId(d, 'replay_seek').style.display, 'flex');
  assert.equal(byId(d, 'replay_status').style.display, 'none', 'the progress replaces the status');
  assert.equal(byId(d, 'replay_seek_text').textContent, 'Simulating 3:12 → 7:40');
  assert.equal(byId(d, 'replay_time').textContent, '7:40', 'the thumb sits at the target');
  byId(d, 'replay_seek_cancel').fire('click');
  assert.deepEqual(calls.at(-1), ['cancel']);
  host.emit({ seeking: null });
  assert.equal(byId(d, 'replay_seek').style.display, 'none');
  const speed = byId(d, 'replay_speed');
  const four = speed.children.find((b) => b.dataset.speed === '4');
  four.fire('click');
  assert.deepEqual(calls.at(-1), ['speed', 4]);
  host.emit({ speed: 4 });
  assert.equal(four.getAttribute('aria-pressed'), 'true');
  assert.equal(speed.children[0].getAttribute('aria-pressed'), 'false');
  const play = byId(d, 'replay_pause');
  play.fire('click');
  assert.deepEqual(calls.at(-1), ['pause', true]);
  host.emit({ done: true, t: 1968 });
  assert.equal(play.textContent, 'Replay');
  play.fire('click');
  assert.deepEqual(calls.slice(-2), [['seek', 0], ['pause', false]]);
});
