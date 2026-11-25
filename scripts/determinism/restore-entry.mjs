// Browser bundle entry for scripts/determinism/browsers.mjs --restore:
// replays a recorded race (the live fixture) with ReplayStepper, takes
// snapshots (SimCore.snapshot) at the given ticks, then restores each one and
// steps on, checking every recorded hash after it. Exposed on
// window.__restore (esbuild IIFE, no DOM needed).
import { ReplayStepper } from '../../src/replay-stepper.js';

let job = null;

function* run(record, at, after) {
  const s = new ReplayStepper(record);
  const snaps = [];
  const t0 = performance.now();
  while (!s.done) {
    if (at.includes(s.t)) { const a = performance.now(); snaps.push({ t: s.t, snap: s.snapshot(), ms: performance.now() - a }); }
    s.step();
    if (s.t % 300 === 0) yield s.t;
  }
  const full = { finalHash: s.finalHash.all, firstMismatch: s.firstMismatch, checked: s.checked, msPerTick: (performance.now() - t0) / record.ticks };
  const restores = [];
  for (const { t, snap, ms } of snaps) {
    const a = performance.now();
    s.restore(snap);
    const restoreMs = performance.now() - a;
    const checked0 = s.checked;
    const until = after > 0 ? t + after : Infinity;
    const b = performance.now();
    let n = 0;
    while (!s.done && s.t < until) { s.step(); n++; if (s.t % 300 === 0) yield s.t; }
    restores.push({ t, snapshotMs: Math.round(ms), restoreMs: Math.round(restoreMs), msPerTick: Math.round(((performance.now() - b) / Math.max(1, n)) * 100) / 100, checked: s.checked - checked0, firstMismatch: s.firstMismatch, finalHash: s.finalHash ? s.finalHash.all : null });
  }
  return { full, restores };
}

window.__restore = {
  start(record, at, after) {
    console.log = () => {};
    console.info = () => {};
    job = { it: run(record, at, after), result: null };
    return true;
  },
  step() {
    const r = job.it.next();
    if (r.done) { job.result = r.value; return -1; }
    return r.value;
  },
  result() { return job.result; },
};
