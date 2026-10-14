import { FixedStepLoop } from '../src/loop.js';
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'ok    ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const world = { steps: 0, step(dt) { this.steps++; this.dt = dt; } };
const loop = new FixedStepLoop(world, { tickHz: 30, maxCatchUp: 4, now: () => 0, raf: () => 1, caf: () => {} });
let ticks = 0, frames = 0;
// 60 Hz display for 10 s: 300 ticks, 600 frames
for (let i = 0; i < 600; i++) loop.advance(1 / 60, () => ticks++, () => frames++);
check('60 Hz display gives 30 ticks per second', Math.abs(ticks - 300) <= 1, `ticks=${ticks}`);
check('world.step gets 1/30', world.dt === 1 / 30);
check('frame callback once per animation frame', frames === 600);
ticks = 0;
for (let i = 0; i < 1200; i++) loop.advance(1 / 120, () => ticks++);
check('120 Hz display still gives 30 ticks per second', Math.abs(ticks - 300) <= 1, `ticks=${ticks}`);
ticks = 0;
const n = loop.advance(0.5, () => ticks++);
check('catch-up is capped per frame', n === 4 && ticks === 4);
check('time beyond the cap is dropped', loop._acc < loop.dt, `droppedMs=${loop.droppedMs.toFixed(0)}`);
if (failed) { console.log(failed + ' check(s) failed'); process.exit(1); }
