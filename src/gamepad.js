// Gamepad input (PlayStation pad, standard mapping), behind the "Gamepad"
// checkbox (?gamepad=1, default off). Each pad drives the boat chosen for it
// in Settings → Player → Input mapping (controls.js setPadAction / the input
// map: pad 1 → boat 1, pad 2 → boat 2 by default; with one boat bound both
// drive it). Pads send boat actions, not keyboard keys, so a pad keeps its
// boat whatever the keyboard is mapped to.
//
//   button 0 (Cross)    autopilot, snapping to the best-VMG heading
//   button 1 (Circle)   sails ease: depower toggle
//   button 2 (Square)   tack
//   button 4 (L1)       zoom in         button 5 (R1)  zoom out
//   left stick          left / right helm, up / down heading target
//
// "Gamepad 1" / "Gamepad 2" are the first and second connected pads in the
// browser's pad order (navigator.getGamepads()); further pads are ignored.
//
// createGamepadPoller is pure (the pad and the actions are passed in) so a
// test can drive it; setupGamepad wires one poller per pad slot to the DOM
// and navigator.

import { setPadAction, zoomCamera, MAX_PADS } from './controls.js';

export const PAD_AUTOPILOT = 0;
export const PAD_EASE = 1;
export const PAD_TACK = 2;
export const PAD_ZOOM_IN = 4;
export const PAD_ZOOM_OUT = 5;
export const STICK_DEADZONE = 0.45;
export const ZOOM_REPEAT_DELAY_MS = 400;
export const ZOOM_REPEAT_MS = 120;
// Pad button index -> boat action (controls.js PAD_ONESHOT).
export const PAD_BUTTON_ACTIONS = Object.freeze({ [PAD_AUTOPILOT]: 'autopilot', [PAD_EASE]: 'depower', [PAD_TACK]: 'tack' });

// actions: { press(action, down), zoom(step) }. action: 'autopilot', 'tack',
// 'depower' (one-shot on press) or 'left' / 'right' / 'up' / 'down' (held).
export function createGamepadPoller(actions) {
  const pressed = new Set(); // pad button indices held down
  const stick = { left: false, right: false, up: false, down: false };
  const zoomHeld = { [PAD_ZOOM_IN]: null, [PAD_ZOOM_OUT]: null }; // button -> next repeat time
  const down = (pad, i) => !!(pad.buttons[i] && pad.buttons[i].pressed);

  function button(pad, i) {
    const action = PAD_BUTTON_ACTIONS[i];
    if (down(pad, i)) {
      if (!pressed.has(i)) { pressed.add(i); actions.press(action, true); }
    } else if (pressed.has(i)) {
      pressed.delete(i);
      actions.press(action, false);
    }
  }

  function zoom(pad, i, step, now) {
    if (!down(pad, i)) { zoomHeld[i] = null; return; }
    if (zoomHeld[i] === null) { actions.zoom(step); zoomHeld[i] = now + ZOOM_REPEAT_DELAY_MS; return; }
    if (now >= zoomHeld[i]) { actions.zoom(step); zoomHeld[i] = now + ZOOM_REPEAT_MS; }
  }

  function setStick(action, on) {
    if (stick[action] === on) return;
    stick[action] = on;
    actions.press(action, on);
  }

  return {
    // pad: a Gamepad ({ buttons, axes }) or null (none, or the box is off:
    // everything this poller holds is released).
    update(pad, now = 0) {
      if (!pad) {
        for (const i of pressed) actions.press(PAD_BUTTON_ACTIONS[i], false);
        pressed.clear();
        for (const a of Object.keys(stick)) setStick(a, false);
        zoomHeld[PAD_ZOOM_IN] = zoomHeld[PAD_ZOOM_OUT] = null;
        return;
      }
      for (const i of Object.keys(PAD_BUTTON_ACTIONS)) button(pad, Number(i));
      zoom(pad, PAD_ZOOM_IN, -2, now);
      zoom(pad, PAD_ZOOM_OUT, +2, now);
      const x = pad.axes[0] || 0, y = pad.axes[1] || 0;
      setStick('left', x < -STICK_DEADZONE);
      setStick('right', x > STICK_DEADZONE);
      setStick('up', y < -STICK_DEADZONE);
      setStick('down', y > STICK_DEADZONE);
    },
  };
}

// The connected pads in browser order, at most MAX_PADS (slot i = Gamepad i + 1).
export function connectedPads(list, max = MAX_PADS) {
  const out = [];
  for (const p of list || []) if (p && p.connected && out.length < max) out.push(p);
  return out;
}

export function setupGamepad() {
  const box = document.getElementById('gamepad');
  if (!box || !navigator.getGamepads) return;
  const pollers = Array.from({ length: MAX_PADS }, (_, slot) => createGamepadPoller({
    press: (action, down) => setPadAction(slot, action, down),
    zoom: zoomCamera,
  }));
  let timer = null;
  const poll = () => {
    const pads = connectedPads(navigator.getGamepads());
    pollers.forEach((p, i) => p.update(pads[i] || null, performance.now()));
  };
  const releaseAll = () => pollers.forEach((p) => p.update(null));
  const apply = () => {
    if (box.checked && timer === null) timer = setInterval(poll, 1000 / 60);
    if (!box.checked && timer !== null) { clearInterval(timer); timer = null; releaseAll(); }
  };
  box.addEventListener('change', apply);
  // Slots shift when a pad goes: release everything, the next poll re-presses.
  window.addEventListener('gamepaddisconnected', releaseAll);
  apply();
}
