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
// media query as the mobile settings menu), off otherwise. The default is
// read once at startup and stored as the checkbox's markup default, so the
// URL only carries touch=1 / touch=0 when it differs from this device's
// default, and Reset settings returns to it.

import { setVirtualKey } from './controls.js';

export const TOUCH_DEFAULT_QUERY = '(max-width: 768px), (pointer: coarse) and (hover: none)';
// Plan M10: a touch tablet (at least 769 x 600) gets the desktop zones and
// always the overlay controls; anything smaller is a phone.
export const TABLET_QUERY = '(pointer: coarse) and (hover: none) and (min-width: 769px) and (min-height: 600px)';
export const PHONE_QUERY = '(max-width: 768px), (pointer: coarse) and (hover: none) and (max-height: 599px)';

export const TOUCH_LAYOUTS = ['classic', 'overlay'];
export function normalizeTouchLayout(v) { return TOUCH_LAYOUTS.includes(v) ? v : 'classic'; }

const STOP_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup', 'wheel', 'click', 'dblclick', 'contextmenu'];

export function setupTouchControls() {
  const box = document.getElementById('touch');
  const panel = document.getElementById('touch_controls');
  if (!box || !panel) return;

  const deviceDefault = !!(window.matchMedia && window.matchMedia(TOUCH_DEFAULT_QUERY).matches);
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
    document.body.classList.toggle('touch-on', on);
    panel.hidden = !on;
    if (!on) buttons.forEach(release);
    // The canvas box changes; renderer.js resizes from it (ResizeObserver),
    // and a resize event covers browsers without one.
    window.dispatchEvent(new Event('resize'));
  }

  // Layout (plan M6): 'classic' panel under the map or 'overlay' over a
  // full-height map. Saved / restored with the other player prefs
  // (settings-registry 'touch_layout'; also ?touch_layout=overlay).
  const layoutSel = document.getElementById('touch_layout');
  const tabletQ = window.matchMedia ? window.matchMedia(TABLET_QUERY) : null;
  function applyLayout() {
    const overlay = normalizeTouchLayout(layoutSel && layoutSel.value) === 'overlay' || !!(tabletQ && tabletQ.matches);
    if (document.body.classList.contains('tc-overlay') === overlay) return;
    document.body.classList.toggle('tc-overlay', overlay);
    window.dispatchEvent(new Event('resize'));
  }
  if (layoutSel) { layoutSel.addEventListener('change', applyLayout); layoutSel.addEventListener('input', applyLayout); }
  if (tabletQ && tabletQ.addEventListener) tabletQ.addEventListener('change', applyLayout);
  applyLayout();

  box.addEventListener('change', () => apply(box.checked));
  window.addEventListener('blur', () => buttons.forEach(release));
  apply(box.checked);
}
