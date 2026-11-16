// Gamepad poller: button and stick mapping onto boat actions, zoom repeat,
// release on disconnect / box off, pad slots.
import './dom-stub.mjs';
const { createGamepadPoller, connectedPads, STICK_DEADZONE, ZOOM_REPEAT_DELAY_MS, ZOOM_REPEAT_MS } = await import('../src/gamepad.js');

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

const pad = (pressed = [], axes = [0, 0]) => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })), axes });
function rig() {
  const log = [], zooms = [];
  const p = createGamepadPoller({ press: (a, d) => log.push([a, d]), zoom: (s) => zooms.push(s) });
  return { p, log, zooms };
}

{
  const { p, log } = rig();
  p.update(pad([0]), 0); p.update(pad([0]), 16); p.update(pad([]), 32);
  check('button 0 = autopilot (best VMG) down once, then up', JSON.stringify(log) === '[["autopilot",true],["autopilot",false]]', JSON.stringify(log));
}
{
  const { p, log } = rig();
  p.update(pad([2]), 0); p.update(pad([]), 16);
  check('button 2 = tack', JSON.stringify(log) === '[["tack",true],["tack",false]]');
}
{
  const { p, log } = rig();
  p.update(pad([1]), 0); p.update(pad([]), 16);
  check('button 1 = depower (no keyboard key, whatever the binding)', JSON.stringify(log) === '[["depower",true],["depower",false]]', JSON.stringify(log));
}
{
  const { p, log } = rig();
  p.update(pad([], [-1, 0]), 0);
  p.update(pad([], [-1, -0.9]), 16);
  p.update(pad([], [0.2, 0.2]), 32);
  check('stick left / up press left / up; inside the deadzone releases them', JSON.stringify(log) === '[["left",true],["up",true],["left",false],["up",false]]', JSON.stringify(log));
  const e = rig();
  e.p.update(pad([], [STICK_DEADZONE, 0]), 0);
  check('stick exactly at the deadzone does nothing', e.log.length === 0);
  const f = rig();
  f.p.update(pad([], [0.9, 0.9]), 0);
  check('stick right / down press right / down', JSON.stringify(f.log) === '[["right",true],["down",true]]');
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
{
  const a = { connected: true, id: 'a' }, b = { connected: true, id: 'b' }, c = { connected: true, id: 'c' };
  const slots = connectedPads([null, a, { connected: false }, b, c]);
  check('pad slots: connected pads in browser order, at most two', slots.length === 2 && slots[0] === a && slots[1] === b);
}

if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all gamepad checks passed');
