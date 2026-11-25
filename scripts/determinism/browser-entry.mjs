// Browser bundle entry for scripts/determinism/browsers.mjs: exposes the
// harness on window.__determinism (esbuild IIFE, no DOM needed).
import { createRun } from './harness.mjs';
import { installDeterministicMath } from './det-math.mjs';

let run = null;
window.__determinism = {
  start(opts) {
    console.log = () => {};
    if (opts.detMath) installDeterministicMath();
    run = createRun({ ...opts, now: () => performance.now() });
    return true;
  },
  step(n) { return run.step(n); },
  result() { return run.result(); },
};
