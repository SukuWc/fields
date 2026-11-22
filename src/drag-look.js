// Drag-to-look (mobile plan M11). A one-finger drag on the race view pans
// the camera with the finger and pauses follow; on release the camera eases
// back to the followed boat over ~300 ms and follow resumes. Two fingers
// stay a pinch zoom (pinch-zoom.js): a second finger ends the look without
// a snap. Drags that start on the steer zones or buttons never reach the
// canvas, so they never pan. Spectators (follow off) keep a plain pan with
// no snap-back. Touch only: desktop mouse is unchanged. Client-only.
//
// On phones and tablets (bp-touch / TOUCH_UI_QUERY), a double-tap on the
// race canvas toggles Camera Follow through the same #camera_follow control
// the settings checkbox and minimap Follow button use, so the UI stays in
// sync. Desktop layouts leave double-tap off.

import { TOUCH_UI_QUERY, matches } from './layout.js';

export const SNAP_MS = 300;
export const TAP_PX = 8;
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_PX = 28;
const FOV_DEG = 70; // renderer.js PerspectiveCamera, looking straight down

export function easeOutCubic(t) {
  const u = Math.min(1, Math.max(0, t));
  return 1 - (1 - u) ** 3;
}

// Camera position t (0..1) of the way back from `from` to `to`.
export function snapBackAt(from, to, t) {
  const k = easeOutCubic(t);
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

// World metres per CSS pixel on the water plane (z = 0).
export function worldPerPixel(zoom, cssHeight, fovDeg = FOV_DEG) {
  if (!(cssHeight > 0) || !Number.isFinite(zoom)) return 0;
  return (2 * zoom * Math.tan((fovDeg * Math.PI) / 360)) / cssHeight;
}

// Same path as minimap setFollow: flip the Player checkbox so its change
// handler and the Follow button stay aligned with view.camera_follow.
export function setCameraFollow(view, on, doc = typeof document !== 'undefined' ? document : null) {
  if (!view) return;
  const want = !!on;
  const f = doc && doc.getElementById ? doc.getElementById('camera_follow') : null;
  if (f && f.checked !== want) {
    f.checked = want;
    try { f.dispatchEvent(new Event('change', { bubbles: true })); } catch { /* no DOM Event */ }
  } else if (typeof view.input_camera_follow === 'function') {
    view.input_camera_follow(want);
  } else {
    view.camera_follow = want;
  }
}

export function setupDragLook(view, {
  canvas = document.getElementById('sim_canvas'),
  now = () => performance.now(),
  raf = (f) => requestAnimationFrame(f),
  // Phones + tablets (and narrow-desktop touch chrome). Override in tests.
  doubleTapEnabled = () => matches(TOUCH_UI_QUERY),
  doc = typeof document !== 'undefined' ? document : null,
} = {}) {
  if (!canvas || !view) return null;
  let drag = null; // { id, sx, sy, cx, cy, follow, moved }
  let anim = null;
  let lastTap = null; // { t, x, y } — first tap of a possible double-tap

  const target = () => view.camera_follow_target;
  function stopAnim() { anim = null; }
  function snapBack(fromPos) {
    const start = now();
    const token = {};
    anim = token;
    const step = () => {
      if (anim !== token) return;
      const tg = target();
      if (!tg) { view.camera_follow = true; anim = null; return; }
      const t = (now() - start) / SNAP_MS;
      const p = snapBackAt(fromPos, tg, t);
      view.camera_position_x = p.x; view.camera_position_y = p.y;
      if (view._clamp) view._clamp();
      if (t >= 1) { view.camera_follow = true; anim = null; return; }
      raf(step);
    };
    raf(step);
  }

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) {
      // Pinch: hand the gesture over and keep follow where the look left it.
      if (drag) { if (drag.follow) view.camera_follow = true; drag = null; }
      lastTap = null;
      return;
    }
    const t = e.touches[0];
    if (anim) stopAnim();
    drag = { id: t.identifier, sx: t.clientX, sy: t.clientY, cx: view.camera_position_x, cy: view.camera_position_y, follow: !!view.camera_follow || !!anim, moved: false };
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (!drag || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.identifier !== drag.id) return;
    const dx = t.clientX - drag.sx, dy = t.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < TAP_PX) return;
    if (!drag.moved) { drag.moved = true; view.camera_follow = false; lastTap = null; }
    const k = worldPerPixel(view.camera_zoom, canvas.clientHeight || window.innerHeight);
    view.camera_position_x = drag.cx - dx * k;
    view.camera_position_y = drag.cy + dy * k;
    if (view._clamp) view._clamp();
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  const end = (e) => {
    if (!drag || (e.touches && e.touches.length > 0)) return;
    const d = drag; drag = null;
    if (d.moved) {
      if (d.follow && target()) snapBack({ x: view.camera_position_x, y: view.camera_position_y });
      return;
    }
    // Stationary tap: maybe the second half of a double-tap.
    const t = now();
    const x = d.sx, y = d.sy;
    if (
      doubleTapEnabled()
      && lastTap
      && (t - lastTap.t) <= DOUBLE_TAP_MS
      && Math.hypot(x - lastTap.x, y - lastTap.y) <= DOUBLE_TAP_PX
    ) {
      lastTap = null;
      setCameraFollow(view, !view.camera_follow, doc);
      return;
    }
    lastTap = { t, x, y };
  };
  canvas.addEventListener('touchend', end, { passive: true });
  canvas.addEventListener('touchcancel', end, { passive: true });
  return {
    get dragging() { return !!(drag && drag.moved); },
    get easing() { return !!anim; },
    get lastTap() { return lastTap; },
  };
}
