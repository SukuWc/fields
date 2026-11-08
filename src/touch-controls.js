// Touch controls for boat 1, docked to the bottom of the screen (35% of its height).
//
// Each button presses the same key code the keyboard uses for players[0]
// (see autokeybind in controls.js), through setVirtualKey, so the boat
// behaves exactly as with the keyboard. Hold buttons stay pressed while a
// finger is down (pointer capture, one pointer set per button, so several
// buttons can be held at once). Tap buttons press on touch and release on
// lift, like a key.
//
// Default: on for phones, small windows and touch-only devices (the same
// media query as the mobile settings menu), off otherwise. That device
// default is the checkbox's markup default, so the URL only carries
// touch=1 / touch=0 when it differs, and Reset settings returns to it.
// Precedence: ?touch= wins, then a saved player preference, then the device
// default. An explicit choice (URL, saved value, or a real click) is not
// replaced when the window is resized or the pointer type changes. A page
// with no explicit choice follows the media query, including across resize.

import { setVirtualKey } from './controls.js';
import { PREFS_KEY } from './player-prefs.js';

import { TOUCH_UI_QUERY, TABLET_QUERY, PHONE_QUERY } from './layout.js';
export { TABLET_QUERY, PHONE_QUERY };
export const TOUCH_DEFAULT_QUERY = TOUCH_UI_QUERY;
// Plan M10: a touch tablet (at least 769 x 600) gets the desktop zones and
// always the overlay controls; anything smaller is a phone.

// Overlay is the only touch layout (Classic removed 2026-11-05).
export const TOUCH_LAYOUTS = ['overlay'];
export function normalizeTouchLayout(v) { return 'overlay'; }

const STOP_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup', 'wheel', 'click', 'dblclick', 'contextmenu'];

// True when this load already chose Touch controls (query or saved pref).
export function touchChoiceIsExplicit(win = window) {
  try {
    if (new URLSearchParams(win.location && win.location.search || '').has('touch')) return true;
  } catch { /* no location */ }
  try {
    const raw = win.localStorage && win.localStorage.getItem(PREFS_KEY);
    const o = raw ? JSON.parse(raw) : null;
    if (o && Object.prototype.hasOwnProperty.call(o, 'touch')) return true;
  } catch { /* no storage or bad JSON */ }
  return false;
}

export function setupTouchControls(doc = document, win = window) {
  const box = doc.getElementById('touch');
  const panel = doc.getElementById('touch_controls');
  if (!box || !panel) return;

  const mq = win.matchMedia && win.matchMedia(TOUCH_DEFAULT_QUERY);
  const deviceDefault = !!(mq && mq.matches);
  box.defaultChecked = deviceDefault;
  box.checked = deviceDefault;

  const buttons = Array.from(panel.querySelectorAll('[data-key]'));
  const held = new Map(buttons.map((b) => [b, new Set()]));

  function release(button) {
    const pointers = held.get(button);
    if (!pointers.size) return;
    pointers.clear();
    button.classList.remove('pressed');
    setVirtualKey(Number(button.dataset.key), false);
  }

  for (const button of buttons) {
    const key = Number(button.dataset.key);
    const pointers = held.get(button);
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { button.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      const first = pointers.size === 0;
      pointers.add(e.pointerId);
      if (first) {
        button.classList.add('pressed');
        setVirtualKey(key, true);
      }
    });
    const up = (e) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size === 0) {
        button.classList.remove('pressed');
        setVirtualKey(key, false);
      }
    };
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);
  }

  // Nothing on the panel reaches the canvas or document-level listeners, and
  // no long-press menu, selection or double-tap zoom.
  for (const type of STOP_EVENTS) {
    panel.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === 'contextmenu' || type === 'dblclick' || type === 'touchstart' || type === 'touchmove') {
        if (e.cancelable) e.preventDefault();
      }
    }, { passive: false });
  }

  function apply(on) {
    doc.body.classList.toggle('touch-on', !!on);
    panel.hidden = !on;
    if (!on) buttons.forEach(release);
    // The canvas box changes; renderer.js resizes from it (ResizeObserver),
    // and a resize event covers browsers without one.
    win.dispatchEvent(new Event('resize'));
  }

  // Overlay-only: Classic grid is gone; every touch layout is the see-through
  // Overlay controls over a full-height map (phones, tablets, and the Touch
  // controls checkbox on larger screens). The panel stays hidden until apply().
  if (!doc.body.classList.contains('tc-overlay')) {
    doc.body.classList.add('tc-overlay');
    win.dispatchEvent(new Event('resize'));
  }

  // A real click pins the choice. URL restore and saved prefs also dispatch
  // change, but those are not trusted; they are pinned via touchChoiceIsExplicit.
  let pinned = touchChoiceIsExplicit(win);
  box.addEventListener('change', (e) => {
    if (e && e.isTrusted) pinned = true;
    apply(box.checked);
  });
  if (mq && mq.addEventListener) mq.addEventListener('change', () => {
    if (pinned) return;
    const on = !!mq.matches;
    if (box.checked === on) return;
    box.checked = on;
    apply(on);
  });
  win.addEventListener('blur', () => buttons.forEach(release));
  apply(box.checked);
  return { apply, get pinned() { return pinned; } };
}
