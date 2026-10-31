// Gamepad input (PlayStation pad, standard mapping), behind the "Gamepad"
// checkbox (?gamepad=1, default off). The pad presses the same keys the
// keyboard does, through setVirtualKey, so the boat behaves exactly as with
// the keyboard (player 1: the arrows side of the layout in controls.js).
//
//   button 0 (Cross)    autopilot, snapping to the best-VMG heading (Space)
//   button 1 (Circle)   sails ease: depower toggle (X, or / with two players)
//   button 2 (Square)   tack (Enter)
//   button 4 (L1)       zoom in         button 5 (R1)  zoom out
//   left stick          arrow keys: left / right helm, up / down heading target
//
// createGamepadPoller is pure (the pad and the actions are passed in) so a
// test can drive it; setupGamepad wires it to the DOM and navigator.

import { setVirtualKey, zoomCamera, depowerKeyCode } from './controls.js';

export const PAD_AUTOPILOT = 0;
export const PAD_EASE = 1;
export const PAD_TACK = 2;
export const PAD_ZOOM_IN = 4;
export const PAD_ZOOM_OUT = 5;
export const STICK_DEADZONE = 0.45;
export const ZOOM_REPEAT_DELAY_MS = 400;
export const ZOOM_REPEAT_MS = 120;
const KEY_LEFT = 37, KEY_UP = 38, KEY_RIGHT = 39, KEY_DOWN = 40, KEY_SPACE = 32, KEY_ENTER = 13;

// actions: { setKey(code, down), zoom(step), depowerKey() }.
export function createGamepadPoller(actions) {
  const pressedKeys = new Map(); // pad button index -> key code it holds down
  const stick = { [KEY_LEFT]: false, [KEY_RIGHT]: false, [KEY_UP]: false, [KEY_DOWN]: false };
  const zoomHeld = { [PAD_ZOOM_IN]: null, [PAD_ZOOM_OUT]: null }; // button -> next repeat time
  const down = (pad, i) => !!(pad.buttons[i] && pad.buttons[i].pressed);

  function button(pad, i, keyFor) {
    const held = pressedKeys.get(i);
    if (down(pad, i)) {
      if (held === undefined) { const key = keyFor(); pressedKeys.set(i, key); actions.setKey(key, true); }
    } else if (held !== undefined) {
      pressedKeys.delete(i);
      actions.setKey(held, false);
    }
  }

  function zoom(pad, i, step, now) {
    if (!down(pad, i)) { zoomHeld[i] = null; return; }
    if (zoomHeld[i] === null) { actions.zoom(step); zoomHeld[i] = now + ZOOM_REPEAT_DELAY_MS; return; }
    if (now >= zoomHeld[i]) { actions.zoom(step); zoomHeld[i] = now + ZOOM_REPEAT_MS; }
  }

  function setStick(key, on) {
    if (stick[key] === on) return;
    stick[key] = on;
    actions.setKey(key, on);
  }

  return {
    // pad: a Gamepad ({ buttons, axes }) or null (none, or the box is off:
    // everything this poller holds is released).
    update(pad, now = 0) {
      if (!pad) {
        for (const [, key] of pressedKeys) actions.setKey(key, false);
        pressedKeys.clear();
        for (const key of Object.keys(stick)) setStick(Number(key), false);
        zoomHeld[PAD_ZOOM_IN] = zoomHeld[PAD_ZOOM_OUT] = null;
        return;
      }
      button(pad, PAD_AUTOPILOT, () => KEY_SPACE);
      button(pad, PAD_EASE, () => actions.depowerKey());
      button(pad, PAD_TACK, () => KEY_ENTER);
      zoom(pad, PAD_ZOOM_IN, -2, now);
      zoom(pad, PAD_ZOOM_OUT, +2, now);
      const x = pad.axes[0] || 0, y = pad.axes[1] || 0;
      setStick(KEY_LEFT, x < -STICK_DEADZONE);
      setStick(KEY_RIGHT, x > STICK_DEADZONE);
      setStick(KEY_UP, y < -STICK_DEADZONE);
      setStick(KEY_DOWN, y > STICK_DEADZONE);
    },
  };
}

export function setupGamepad() {
  const box = document.getElementById('gamepad');
  if (!box || !navigator.getGamepads) return;
  const poller = createGamepadPoller({ setKey: setVirtualKey, zoom: zoomCamera, depowerKey: depowerKeyCode });
  let timer = null;
  const firstPad = () => {
    for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    return null;
  };
  const apply = () => {
    if (box.checked && timer === null) timer = setInterval(() => poller.update(firstPad(), performance.now()), 1000 / 60);
    if (!box.checked && timer !== null) { clearInterval(timer); timer = null; poller.update(null); }
  };
  box.addEventListener('change', apply);
  window.addEventListener('gamepaddisconnected', () => poller.update(null));
  apply();
}
