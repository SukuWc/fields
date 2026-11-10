// Mouse-wheel / trackpad zoom on the race view.
//
// There was no wheel listener: the page itself does not scroll (the document
// is pinned), and zoom was only the +/- buttons, = / − and W / S, plus a
// two-finger pinch on touch. An unmodified wheel over #sim_canvas now zooms
// the same camera (smaller Z = closer). Wheel down zooms out, wheel up zooms
// in, one ~100 px notch matching one +/- step. deltaMode lines are 16 px and
// pages are the canvas height; a single event is capped so a trackpad fling
// or a ctrl-pinch burst is not a jump.
//
// With camera follow off, the zoom stays anchored on the point under the
// cursor. With follow on, the boat stays centred (the next frame snaps the
// camera there anyway). preventDefault runs only for a wheel the canvas
// handles, so settings, chat, the leaderboard and other scrollable panels
// keep scrolling. Touch pinch is unchanged.

import { worldPerPixel } from './drag-look.js';

export const LINE_PX = 16;
export const NOTCH_PX = 100;
export const NOTCH_STEP = 2;
export const MAX_EVENT_PX = 240;

export function wheelPixels(delta, deltaMode, pagePx) {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * LINE_PX;
  if (deltaMode === 2) return delta * (Number.isFinite(pagePx) ? pagePx : 0);
  return delta;
}

// Signed camera step (positive = zoom out), same scale as the +/- buttons.
export function wheelZoomStep(pixels) {
  if (!Number.isFinite(pixels) || pixels === 0) return 0;
  const capped = Math.max(-MAX_EVENT_PX, Math.min(MAX_EVENT_PX, pixels));
  return capped / NOTCH_PX * NOTCH_STEP;
}

// Zoom, then (when not following) keep the world point under the cursor.
// ox/oy are CSS pixels from the canvas centre, +x right, +y down.
export function applyWheelZoom(view, { deltaY, deltaMode = 0, clientX = 0, clientY = 0, rect = null, follow = false } = {}) {
  const page = rect && rect.height > 0 ? rect.height : 0;
  const step = wheelZoomStep(wheelPixels(deltaY, deltaMode, page));
  if (!step || !view) return false;
  const h = page;
  const anchor = follow !== true && h > 0 && rect;
  let ox = 0, oy = 0, worldX = view.camera_position_x, worldY = view.camera_position_y;
  if (anchor) {
    ox = clientX - (rect.left + rect.width / 2);
    oy = clientY - (rect.top + rect.height / 2);
    const mpp = worldPerPixel(view.camera_zoom, h);
    worldX = view.camera_position_x + ox * mpp;
    worldY = view.camera_position_y - oy * mpp;
  }
  const before = view.camera_zoom;
  view.input_camera_zoom_relative(step);
  if (anchor && view.camera_zoom !== before) {
    const mpp = worldPerPixel(view.camera_zoom, h);
    view.camera_position_x = worldX - ox * mpp;
    view.camera_position_y = worldY + oy * mpp;
    if (view._clamp) view._clamp();
  }
  return true;
}

export function setupWheelZoom(view, canvas = document.getElementById('sim_canvas')) {
  if (!view || !canvas) return null;
  const onWheel = (e) => {
    const rect = canvas.getBoundingClientRect();
    const handled = applyWheelZoom(view, {
      deltaY: e.deltaY,
      deltaMode: e.deltaMode || 0,
      clientX: e.clientX,
      clientY: e.clientY,
      rect,
      follow: view.camera_follow,
    });
    if (handled && e.cancelable) e.preventDefault();
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  return { onWheel };
}
