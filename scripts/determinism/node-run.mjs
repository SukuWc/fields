// Node side of the replay determinism harness: run it and print (or write)
// the per-tick hashes as JSON. Used by test/replay-determinism.test.mjs
// (separate-process check) and scripts/determinism/browsers.mjs (reference).
//   node --import ./test/register.mjs scripts/determinism/node-run.mjs --ticks 300 [--every 1] [--out file.json]
import '../../test/dom-stub.mjs';
import { writeFileSync } from 'node:fs';
import { createRun } from './harness.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const ticks = Number(arg('ticks', 300));
const every = Number(arg('every', 1));
const out = arg('out', null);
const quiet = console.log;
console.log = () => {};
const run = createRun({ ticks, every, now: () => performance.now() });
while (!run.done) {
  run.step(600);
  if (out) process.stderr.write(`node ${run.tick}/${ticks}\n`);
}
console.log = quiet;
const res = { engine: 'node', version: process.version, v8: process.versions.v8, ...run.result() };
if (out) writeFileSync(out, JSON.stringify(res));
else process.stdout.write(JSON.stringify(res));
