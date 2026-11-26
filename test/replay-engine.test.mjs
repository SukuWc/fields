// Replay seeking (src/replay-engine.js): keyframes every 300 ticks, seek
// forward by fast-forward and back by restoring a keyframe, the look-ahead
// scan, the memory budget, every recorded hash checked on the way
// (live race test/fixtures/replay-europe-1-mww066n9-1.json, 1968 ticks).
import './dom-stub.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ReplayEngine } from '../src/replay-engine.js';
import { KEYFRAME_EVERY_TICKS } from '../src/replay-engine.js';
import { createReplayWorker } from '../src/replay-worker-core.js';
import { SCAN_IDLE_MS } from '../src/replay-worker-core.js';

const RECORD = JSON.parse(fs.readFileSync(new URL('./fixtures/replay-europe-1-mww066n9-1.json', import.meta.url), 'utf8'));
const mute = (f) => { const l = console.log; const i = console.info; console.log = () => {}; console.info = () => {}; try { return f(); } finally { console.log = l; console.info = i; } };
const runSeek = (e) => { let f = null; while (e.seeking) f = mute(() => e.runSeek(1000)); return f; };

test('seek forward fast-forwards, seek back restores a keyframe, hashes OK all the way', () => {
  const e = mute(() => new ReplayEngine(RECORD, { scan: false }));
  assert.deepEqual(e.keyframes.map((k) => k.t), [0]);
  e.seek(950);
  assert.equal(e.seeking.start, 0, 'from the current position');
  const f = runSeek(e);
  assert.equal(e.t, 950);
  assert.ok(f && f.state, 'the target tick is presented');
  assert.deepEqual(e.keyframes.map((k) => k.t), [0, 300, 600, 900]);
  assert.equal(e.player.checked, 31);
  // Back: from the keyframe at 300.
  e.seek(420);
  assert.equal(e.seeking.start, 300);
  runSeek(e);
  assert.equal(e.t, 420);
  // Play on past a hash check.
  for (let i = 0; i < 40; i++) mute(() => e.play());
  assert.equal(e.t, 460);
  // Forward again, past the keyframes, from the one at 900.
  e.seek(1000);
  assert.equal(e.seeking.start, 900);
  runSeek(e);
  assert.equal(e.t, 1000);
  assert.equal(e.mismatch, null);
  assert.equal(e.status().mismatch, null);
  assert.ok(e.lastSeekMs >= 0);
});

test('speed plays 2 or 4 recorded ticks per call, presenting the last', () => {
  const e = mute(() => new ReplayEngine(RECORD, { scan: false }));
  e.setSpeed(4);
  const f = mute(() => e.play());
  assert.equal(e.t, 4);
  assert.ok(f.state);
  e.setSpeed(3);
  assert.equal(e.speed, 1);
});

test('the look-ahead scan fills keyframes to the end; a far seek then starts close by', () => {
  const e = mute(() => new ReplayEngine(RECORD));
  while (mute(() => e.runScan(1000))) { /* scan */ }
  assert.equal(e.scanDone, true);
  assert.equal(e.simulatedTo, RECORD.ticks);
  assert.deepEqual(e.keyframes.map((k) => k.t), [0, 300, 600, 900, 1200, 1500, 1800]);
  assert.equal(e.mismatch, null, 'the scan checks the hashes too');
  e.seek(1850);
  assert.equal(e.seeking.start, 1800);
  runSeek(e);
  assert.equal(e.t, 1850);
  // The rest plays to the final hash.
  while (!e.done) mute(() => e.play());
  assert.equal(e.player.finalHash.all, RECORD.finalHash.all);
  assert.equal(e.mismatch, null);
});

test('over the memory budget, every other keyframe goes and the spacing doubles', () => {
  // About 10 MB per keyframe here: a 25 MB budget keeps two.
  const e = mute(() => new ReplayEngine(RECORD, { scan: false, memoryMB: 25 }));
  e.seek(1300);
  runSeek(e);
  const ts = e.keyframes.map((k) => k.t);
  assert.ok(ts.length <= 3, String(ts));
  assert.equal(ts[0], 0);
  assert.ok(e.every > KEYFRAME_EVERY_TICKS);
  for (const t of ts) assert.equal(t % e.every, 0);
  e.seek(ts.at(-1) + 10);
  assert.equal(e.seeking.start, ts.at(-1));
  runSeek(e);
  assert.equal(e.mismatch, null);
});

test('worker messages: seek progress statuses, a cancel, ticks answered while seeking', async () => {
  const out = [];
  const queue = [];
  const on = createReplayWorker((m) => out.push(m), { schedule: (fn) => queue.push(fn) });
  const drain = (n = Infinity) => { while (queue.length && n-- > 0) mute(() => queue.shift()()); };
  mute(() => on({ type: 'init', record: RECORD, opts: { scan: false } }));
  assert.equal(out[0].type, 'status');
  assert.equal(out[1].type, 'info');
  assert.equal(out[1].info.mode, 'replay');
  mute(() => on({ type: 'seek', t: 400 }));
  assert.ok(out.at(-1).status.seeking);
  mute(() => on({ type: 'tick' }));
  assert.equal(out.at(-1).type, 'frame');
  assert.equal(out.at(-1).tick, true);
  assert.equal(out.at(-1).frame, null, 'nothing plays during a seek');
  drain(1);
  const progress = out.filter((m) => m.type === 'status' && m.status.seeking);
  assert.ok(progress.length >= 2);
  mute(() => on({ type: 'cancelSeek' }));
  assert.equal(out.at(-1).status.seeking, null);
  mute(() => on({ type: 'seek', t: 60 }));
  drain();
  const last = out.findLast((m) => m.type === 'frame');
  assert.ok(last.frame && last.frame.state, 'the landing tick is presented');
  assert.equal(last.status.t, 60);
  assert.equal(last.status.seeking, null);
  assert.equal(last.status.mismatch, null);
});

test('look-ahead scan jumps a lagging scanner to the latest keyframe', () => {
  const e = mute(() => new ReplayEngine(RECORD));
  mute(() => { while (!e.scanner || e.scanner.t < 40) e.runScan(1000); });
  const behind = e.scanner.t;
  assert.ok(behind < 300, 'scanner still early, got ' + behind);
  e.seek(1200);
  runSeek(e);
  assert.equal(e.t, 1200);
  assert.ok(e.scanner.t === behind, 'seek does not itself move the scanner');
  mute(() => e.runScan(20));
  assert.ok(e.scanner.t >= 1200, `scanner jumped from ${behind} to ${e.scanner.t}`);
  assert.equal(e.mismatch, null);
});

test('the worker runs the look-ahead scan only while playback is paused', () => {
  let now = 0;
  let nid = 0;
  const timers = [];
  const schedule = (fn, ms = 0) => {
    const id = ++nid;
    timers.push({ id, at: now + (ms || 0), fn });
    return id;
  };
  const cancelSchedule = (id) => {
    const i = timers.findIndex((x) => x.id === id);
    if (i >= 0) timers.splice(i, 1);
  };
  const runDue = () => {
    let n = 0;
    for (;;) {
      const i = timers.reduce((best, t, idx) => (t.at <= now && (best < 0 || t.at < timers[best].at) ? idx : best), -1);
      if (i < 0) break;
      if (++n > 10000) throw new Error('timer loop');
      const job = timers.splice(i, 1)[0];
      mute(() => job.fn());
    }
  };
  const out = [];
  const on = createReplayWorker((m) => out.push(m), { schedule, cancelSchedule, now: () => now, scanIdleMs: SCAN_IDLE_MS, scanChunkMs: 1000 });
  mute(() => on({ type: 'init', record: RECORD, opts: { scan: true } }));
  assert.equal(timers.length, 0, 'init does not arm a scan while playing');
  // Play ticks must not start the look-ahead scan, even if they arrive slowly.
  for (let i = 0; i < 20; i++) {
    mute(() => on({ type: 'tick' }));
    now += 33;
    runDue();
  }
  const mid = out.filter((m) => m.status).at(-1).status;
  assert.ok(mid.t >= 20, 'played ticks, t=' + mid.t);
  assert.equal(mid.simulatedTo, mid.t, `scan ran during play: t=${mid.t} simulatedTo=${mid.simulatedTo}`);
  // Pause arms the look-ahead scan; it must not have been scheduled while playing.
  assert.equal(timers.length, 0, 'no scan armed during play');
  mute(() => on({ type: 'paused', on: true }));
  assert.ok(timers.length >= 1, 'pause arms a scan');
  mute(() => timers.shift().fn());
  // A scan chunk only posts status every STATUS_EVERY_MS; ask for a fresh one.
  mute(() => on({ type: 'speed', n: 1 }));
  const idle = out.filter((m) => m.status).at(-1).status;
  assert.ok(idle.simulatedTo > idle.t, `scan should run once paused, t=${idle.t} simulatedTo=${idle.simulatedTo}`);
});

const RECORD_LONG = JSON.parse(fs.readFileSync(new URL('./fixtures/replay-europe-1-mwxq7pem-1.json', import.meta.url), 'utf8'));

test('a live race that once failed mid-hash after a scrub now matches through the old fail window', () => {
  const e = mute(() => new ReplayEngine(RECORD_LONG, { scan: false }));
  while (e.t < 1500 && !e.done) mute(() => e.play());
  assert.equal(e.mismatch, null, e.mismatch && ('mismatch at ' + e.mismatch.t));
  assert.ok(e.player.checked >= 50, 'checked ' + e.player.checked);
});

test('randomized seek, pause-scan and play sequences leave no hash mismatch', () => {
  let a = 0xA5F3C109;
  const rnd = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  for (const rec of [RECORD, RECORD_LONG]) {
    const e = mute(() => new ReplayEngine(rec, { scan: true }));
    const cap = Math.min(rec.ticks, rec === RECORD_LONG ? 1600 : rec.ticks);
    for (let i = 0; i < 40; i++) {
      const r = rnd();
      if (r < 0.4) {
        const n = 1 + (rnd() * 40 | 0);
        for (let j = 0; j < n && e.t < cap && !e.done; j++) mute(() => e.play());
      } else if (r < 0.6) {
        const t0 = Date.now();
        while (!e.scanDone && Date.now() - t0 < 30) mute(() => e.runScan(20));
      } else {
        e.seek((rnd() * (cap + 1)) | 0);
        while (e.seeking) mute(() => e.runSeek(1000));
      }
      assert.equal(e.mismatch, null, rec.id + ' mismatch at t=' + (e.mismatch && e.mismatch.t) + ' op ' + i);
    }
  }
});
