// Two-finger pinch on #sim_canvas zooms the client camera the same way as
// the +/- buttons (view.camera_zoom is the camera Z; smaller = closer /
// zoomed in). Client-only: nothing is sent to the server, so local, worker
// and remote (?host=remote) all get it through the shared View.
//
// Single-finger touches are left alone so #touch_controls steering and
// desktop mouse stay unchanged. touch-action: none on the canvas (index.html)
// plus preventDefault on the two-finger gesture stops the browser from
// stealing the pinch for page zoom (including Safari).

/** Absolute zoom from a pinch: spread fingers → closer (smaller Z). */
export function pinchZoomAt(startZoom, startDist, dist, min, max) {
  if (!(startDist > 0) || !(dist > 0) || !Number.isFinite(startZoom)) return startZoom;
  let z = startZoom * (startDist / dist);
  if (Number.isFinite(max) && z > max) z = max;
  if (Number.isFinite(min) && z < min) z = min;
  return z;
}

function touchDist(a, b) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}

export function setupPinchZoom(view) {
  const canvas = document.getElementById('sim_canvas');
  if (!canvas || !view) return;

  let startDist = 0;
  let startZoom = 0;
  let pinching = false;

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) {
      if (e.touches.length < 2) pinching = false;
      return;
    }
    pinching = true;
    startDist = touchDist(e.touches[0], e.touches[1]);
    startZoom = view.camera_zoom;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (!pinching || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    const d = touchDist(e.touches[0], e.touches[1]);
    view.camera_zoom = pinchZoomAt(
      startZoom, startDist, d, view.camera_zoom_min, view.camera_zoom_max);
  }, { passive: false });

  const end = (e) => {
    if (!e.touches || e.touches.length < 2) pinching = false;
  };
  canvas.addEventListener('touchend', end, { passive: true });
  canvas.addEventListener('touchcancel', end, { passive: true });
}
