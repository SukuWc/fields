// Open and close the mobile settings drawer from the right edge.
//
// The drawer slides in from the right. A thin strip on that edge (#settings_edge)
// starts an inward (left) swipe that follows the finger and snaps open or
// closed. While the drawer is open, a rightward swipe on the drawer itself
// closes it. The menu button and the backdrop tap still work.
//
// Touches that start on the strip stop at the strip: they are not the canvas,
// so drag-to-look never sees them, and the strip is placed clear of the steer
// zones. The strip is 16px wide and sits on the inner side of the safe-area
// inset, so a system back gesture in that inset is left to the OS. With a
// zero inset the outer 16px can still overlap a system edge gesture; the OS
// usually takes that one before the page sees it.
//
// Desktop (no .bp-touch) does not show the strip. ?settingsEdge=1 paints a
// yellow outline for screenshots only.

import { TOUCH_UI_QUERY } from './layout.js';

export const EDGE_W = 16;
export const START_PX = 10;
export const OPEN_PX = 80;
export const FLICK = 0.5;
export const SPRING_MS = 200;

// 'x' or 'y' once the finger has moved START_PX, else null.
export function axisIntent(dx, dy) {
  if (Math.hypot(dx, dy) < START_PX) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

// Open (inward, to the left) or close (outward, to the right) distance.
export function inwardPx(dx) { return Math.max(0, -dx); }
export function outwardPx(dx) { return Math.max(0, dx); }

export function shouldCommit(dist, ms) {
  return dist >= OPEN_PX || (ms > 0 && dist >= START_PX * 2 && dist / ms >= FLICK);
}

function interactive(target) {
  return !!(target && target.closest && target.closest('input, textarea, select, button, a, [role="slider"]'));
}

export function setupSettingsEdge({ edge, panel, isOpen, setOpen, enabled = () => true, now = () => performance.now() } = {}) {
  if (!edge || !panel || !setOpen) return null;
  let g = null;

  function width() { return panel.offsetWidth || 320; }
  function paint(shown, anim) {
    const w = width();
    const hidden = Math.max(0, w - Math.max(0, Math.min(w, shown)));
    panel.style.transition = anim ? 'transform ' + SPRING_MS + 'ms ease' : 'none';
    panel.style.visibility = 'visible';
    panel.style.transform = 'translateX(' + hidden + 'px)';
  }
  function clearPaint() {
    panel.style.transition = '';
    panel.style.visibility = '';
    panel.style.transform = '';
  }
  function finish(open) {
    clearPaint();
    if (isOpen() !== open) setOpen(open);
  }

  edge.addEventListener('touchstart', (e) => {
    if (!enabled() || isOpen() || e.touches.length !== 1) { g = null; return; }
    e.stopPropagation();
    const t = e.touches[0];
    g = { kind: 'open', x: t.clientX, y: t.clientY, t: now(), on: false, done: false };
  }, { passive: true });

  edge.addEventListener('touchmove', (e) => {
    if (!g || g.kind !== 'open' || g.done || !enabled() || e.touches.length !== 1) return;
    e.stopPropagation();
    const t = e.touches[0];
    const dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (!g.on) {
      const axis = axisIntent(dx, dy);
      if (!axis) return;
      if (axis !== 'x' || dx >= 0) { g.done = true; return; }
      g.on = true;
    }
    if (e.cancelable) e.preventDefault();
    g.d = inwardPx(dx);
    paint(g.d, false);
  }, { passive: false });

  panel.addEventListener('touchstart', (e) => {
    if (!enabled() || !isOpen() || e.touches.length !== 1 || interactive(e.target)) return;
    const t = e.touches[0];
    g = { kind: 'close', x: t.clientX, y: t.clientY, t: now(), on: false, done: false };
  }, { passive: true });

  panel.addEventListener('touchmove', (e) => {
    if (!g || g.kind !== 'close' || g.done || !enabled() || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (!g.on) {
      const axis = axisIntent(dx, dy);
      if (!axis) return;
      if (axis !== 'x' || dx <= 0) { g.done = true; return; }
      g.on = true;
    }
    if (e.cancelable) e.preventDefault();
    g.d = outwardPx(dx);
    paint(width() - g.d, false);
  }, { passive: false });

  const end = (e) => {
    if (e && e.stopPropagation && g && g.kind === 'open') e.stopPropagation();
    if (!g) return;
    const was = g; g = null;
    if (!was.on) { if (was.kind === 'open') clearPaint(); return; }
    const commit = shouldCommit(was.d || 0, now() - was.t);
    finish(was.kind === 'open' ? commit : !commit);
  };
  edge.addEventListener('touchend', end, { passive: true });
  edge.addEventListener('touchcancel', end, { passive: true });
  panel.addEventListener('touchend', end, { passive: true });
  panel.addEventListener('touchcancel', end, { passive: true });
  return { get active() { return !!(g && g.on); } };
}
