// Gamepad poller: button and stick mapping onto the keyboard keys, zoom
// repeat, release on disconnect / box off.
import { createGamepadPoller, STICK_DEADZONE, ZOOM_REPEAT_DELAY_MS, ZOOM_REPEAT_MS } from '../src/gamepad.js';

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

const pad = (pressed = [], axes = [0, 0]) => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })), axes });
function rig(depowerKey = 88) {
  const log = [], zooms = [];
  const p = createGamepadPoller({ setKey: (k, d) => log.push([k, d]), zoom: (s) => zooms.push(s), depowerKey: () => depowerKey });
  return { p, log, zooms };
}

{
  const { p, log } = rig();
  p.update(pad([0]), 0); p.update(pad([0]), 16); p.update(pad([]), 32);
  check('button 0 = Space (autopilot, best VMG) down once, then up', JSON.stringify(log) === '[[32,true],[32,false]]', JSON.stringify(log));
}
{
  const { p, log } = rig();
  p.update(pad([2]), 0); p.update(pad([]), 16);
  check('button 2 = Enter (tack)', JSON.stringify(log) === '[[13,true],[13,false]]');
}
{
  const r = rig(88);
  r.p.update(pad([1]), 0);
  check('button 1 = depower key, X with one player', JSON.stringify(r.log) === '[[88,true]]');
  const r2 = rig(191);
  r2.p.update(pad([1]), 0); r2.p.update(pad([]), 16);
  check('button 1 = / with two players, released with the same key', JSON.stringify(r2.log) === '[[191,true],[191,false]]');
}
{
  const { p, log } = rig();
  p.update(pad([], [-1, 0]), 0);
  p.update(pad([], [-1, -0.9]), 16);
  p.update(pad([], [0.2, 0.2]), 32);
  check('stick left / up press arrows; inside the deadzone releases them', JSON.stringify(log) === '[[37,true],[38,true],[37,false],[38,false]]', JSON.stringify(log));
  const e = rig();
  e.p.update(pad([], [STICK_DEADZONE, 0]), 0);
  check('stick exactly at the deadzone does nothing', e.log.length === 0);
  const f = rig();
  f.p.update(pad([], [0.9, 0.9]), 0);
  check('stick right / down press → and ↓', JSON.stringify(f.log) === '[[39,true],[40,true]]');
}
{
  const { p, zooms } = rig();
  p.update(pad([4]), 0);
  p.update(pad([4]), ZOOM_REPEAT_DELAY_MS - 1);
  p.update(pad([4]), ZOOM_REPEAT_DELAY_MS);
  p.update(pad([4]), ZOOM_REPEAT_DELAY_MS + ZOOM_REPEAT_MS);
  p.update(pad([]), 1000);
  p.update(pad([5]), 1016);
  check('button 4 zooms in (-2) once, repeating after the delay; button 5 zooms out (+2)', JSON.stringify(zooms) === '[-2,-2,-2,2]', JSON.stringify(zooms));
}
{
  const { p, log } = rig();
  p.update(pad([0, 1], [-1, 1]), 0);
  const n = log.length;
  p.update(null, 16);
  const rel = log.slice(n);
  check('no pad (disconnect / box off) releases everything held', rel.length === 4 && rel.every(([, d]) => d === false) && new Set(rel.map(([k]) => k)).size === 4, JSON.stringify(rel));
}

if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all gamepad checks passed');
