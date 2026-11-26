// Sim snapshots (src/sim-snapshot.js, SimCore.snapshot / restore,
// ReplayStepper.snapshot / restore): a race restored at any tick steps on to
// exactly the recorded hashes of the live sailzone.app race
// (test/fixtures/replay-europe-1-mww066n9-1.json), the same snapshot can be
// restored again after the copy ran on, and with hash version 2 a replay may
// skip presenting (step({ draw: false })) without changing a hash.
// Browsers: scripts/determinism/browsers.mjs --restore.
import './dom-stub.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ReplayStepper } from '../src/replay-stepper.js';
import { hashCoreState } from '../src/state-hash.js';
import { Mulberry32 } from '../src/gusts.js';
import { mulberry32 } from '../src/gusts.js';
import { deepCopy } from '../src/sim-snapshot.js';

const RECORD = JSON.parse(fs.readFileSync(new URL('./fixtures/replay-europe-1-mww066n9-1.json', import.meta.url), 'utf8'));
const mute = (f) => { const l = console.log; const i = console.info; console.log = () => {}; console.info = () => {}; try { return f(); } finally { console.log = l; console.info = i; } };
const SNAP_AT = [1, 450, 1200, 1500];

// One pass over the live race: snapshots at SNAP_AT, and the version-2
// hashes of the same ticks (a version-2 copy of the record for the draw test).
const pass = mute(() => {
  const s = new ReplayStepper(RECORD);
  const snaps = new Map();
  const v2 = [];
  while (!s.done) {
    if (SNAP_AT.includes(s.t)) snaps.set(s.t, s.snapshot());
    s.step();
    if (s.t % 30 === 0 && s.t < RECORD.ticks) v2.push({ t: s.t, all: hashCoreState(s.core, 2).all });
  }
  return { s, snaps, v2, final2: hashCoreState(s.core, 2).all };
});

test('the full run still reproduces the live race', () => {
  assert.equal(pass.s.firstMismatch, null);
  assert.equal(pass.s.finalHash.all, RECORD.finalHash.all);
});

test('restored at several ticks, the race steps on to the recorded hashes', () => {
  const want = new Map(RECORD.hashes.map((h) => [h.t, h.all]));
  for (const t of SNAP_AT) {
    const s = mute(() => new ReplayStepper(RECORD));
    mute(() => s.restore(pass.snaps.get(t)));
    assert.equal(s.t, t);
    // Three hash checks after the restore (the whole rest from the last one).
    const until = t === SNAP_AT[SNAP_AT.length - 1] ? RECORD.ticks + 1 : t + 90;
    let checks = 0;
    while (!s.done && s.t < until) {
      mute(() => s.step());
      if (want.has(s.t) && s.t % 30 === 0) { checks++; assert.equal(s.hashes[s.hashes.length - 1].all, want.get(s.t), `restore at ${t}, hash at ${s.t}`); }
    }
    assert.ok(checks >= 2, `checked after the restore at ${t}`);
    assert.equal(s.firstMismatch, null, `restore at ${t}`);
    if (s.done) assert.equal(s.finalHash.all, RECORD.finalHash.all);
  }
});

test('a snapshot stays unchanged while its copy runs on, so it restores again', () => {
  const s = pass.s;
  const snap = pass.snaps.get(1200);
  const at = (n) => mute(() => { s.restore(snap); for (let i = 0; i < n; i++) s.step(); return hashCoreState(s.core).all; });
  const a = at(60);
  const b = at(60);
  assert.equal(a, b);
  assert.equal(s.firstMismatch, null);
});

test('hash version 2: skipping the presentation keeps every hash; version 1 keeps presenting', () => {
  const v2 = { ...RECORD, hashVersion: 2, hashes: pass.v2.filter((h) => h.t <= 600), ticks: 600, finalHash: null };
  const s = mute(() => new ReplayStepper(v2));
  assert.equal(s.canSkipDraw, true);
  let frames = 0;
  while (!s.done) { const f = mute(() => s.step({ draw: false })); if (f && f.state) frames++; }
  assert.equal(frames, 0, 'no scene state built');
  assert.equal(s.checked, 20);
  assert.equal(s.firstMismatch, null);
  assert.equal(new ReplayStepper(RECORD).canSkipDraw, false);
});

test('Mulberry32 keeps its state on the object and matches the function form', () => {
  const g = new Mulberry32(30);
  const f = mulberry32(30);
  for (let i = 0; i < 5; i++) assert.equal(g.next(), f());
  const c = deepCopy(g);
  assert.notEqual(c, g);
  assert.equal(c.next(), g.next());
});

test('deepCopy keeps prototypes, shared refs, cycles, typed arrays, Map, hidden fields and key order', () => {
  class P { constructor() { this.z = 1; this.a = 2; } sum() { return this.z + this.a; } }
  const p = new P();
  Object.defineProperty(p, '_h', { value: { n: 3 }, writable: true, configurable: true, enumerable: false });
  const shared = { v: new Float64Array([-0, NaN, 1.5]) };
  const root = { p, list: [p, shared], m: new Map([[p, shared]]), shared };
  root.self = root;
  const c = deepCopy(root);
  assert.equal(c.p.sum(), 3);
  assert.deepEqual(Object.keys(c.p), ['z', 'a']);
  assert.equal(c.p._h.n, 3);
  assert.notEqual(c.p._h, p._h);
  assert.equal(c.list[0], c.p);
  assert.equal(c.m.get(c.p), c.shared);
  assert.equal(c.self, c);
  assert.ok(Object.is(c.shared.v[0], -0));
  assert.ok(Number.isNaN(c.shared.v[1]));
  assert.notEqual(c.shared.v, shared.v);
});
