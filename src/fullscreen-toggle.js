// Fullscreen toggle for the mobile top bar.
//
// Enters or leaves fullscreen on the document element (the whole app, not a
// video). The call happens inside the button's click, so it keeps the user
// gesture. fullscreenchange / webkitfullscreenchange keep the icon in step
// when the browser leaves fullscreen on its own (Escape, gesture, OS).
// A rejected request stays out of fullscreen and does not throw.
//
// The button is hidden when this document cannot fullscreen: no
// requestFullscreen on the root element, or fullscreenEnabled === false.
// iPhone Safari has no element Fullscreen API (webkitRequestFullscreen is
// video-only there), so the button stays hidden instead of doing nothing.

export const ENTER_LABEL = 'Enter fullscreen';
export const EXIT_LABEL = 'Exit fullscreen';

export function fullscreenElement(doc = document) {
  return doc.fullscreenElement || doc.webkitFullscreenElement || null;
}

export function fullscreenAvailable(doc = document) {
  const root = doc.documentElement;
  if (!root) return false;
  const req = root.requestFullscreen || root.webkitRequestFullscreen;
  const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
  if (typeof req !== 'function' || typeof exit !== 'function') return false;
  if (typeof doc.fullscreenEnabled === 'boolean') return doc.fullscreenEnabled;
  if (typeof doc.webkitFullscreenEnabled === 'boolean') return doc.webkitFullscreenEnabled;
  return true;
}

// Must be called from a user gesture. Resolves { ok } and never rejects.
export function toggleAppFullscreen(doc = document) {
  const root = doc.documentElement;
  const req = root && (root.requestFullscreen || root.webkitRequestFullscreen);
  const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
  let pending;
  try {
    if (fullscreenElement(doc)) pending = exit.call(doc);
    else if (typeof req === 'function') pending = req.call(root);
    else return Promise.resolve({ ok: false, unsupported: true });
  } catch (error) {
    return Promise.resolve({ ok: false, error });
  }
  return Promise.resolve(pending).then(() => ({ ok: true }), (error) => ({ ok: false, error }));
}

export function setupFullscreenToggle(doc = document) {
  const btn = doc.getElementById('fullscreen_toggle');
  if (!btn) return null;
  if (!fullscreenAvailable(doc)) {
    btn.hidden = true;
    return { supported: false, button: btn };
  }
  btn.hidden = false;
  const sync = () => {
    const on = !!fullscreenElement(doc);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    const label = on ? EXIT_LABEL : ENTER_LABEL;
    btn.setAttribute('aria-label', label);
    btn.title = label;
  };
  sync();
  btn.addEventListener('click', () => { toggleAppFullscreen(doc).then(sync, sync); });
  doc.addEventListener('fullscreenchange', sync);
  doc.addEventListener('webkitfullscreenchange', sync);
  return { supported: true, button: btn, sync };
}
