// Swipe-to-close for the leaderboard / chat sheet (mobile plan, after M11).
//
// Bottom sheet (portrait): swipe down closes it. Side sheet (landscape):
// swipe right closes it. The sheet follows the finger and either closes or
// springs back on release. A swipe only starts when it heads the closing way,
// and in the bottom sheet only when the pane under the finger is scrolled to
// the top (or the finger starts on the handle / tabs), so scrolling the
// leaderboard or the chat log works as before. Sheet touches never reach the
// canvas (mobile-sheet.js stops them), so drag-to-look is not affected.

export const START_PX = 10;     // movement before the gesture picks a direction
export const CLOSE_PX = 80;     // distance that closes on release
export const CLOSE_SPEED = 0.5; // or a flick of this many px / ms
export const SPRING_MS = 180;

// Distance along the closing direction (down, or right for a side sheet).
export function closeDistance(side, dx, dy) { return Math.max(0, side ? dx : dy); }

// Gesture direction once it moved START_PX: 'close', 'other' (a scroll or a
// sideways move: leave it to the browser) or null (not yet decided).
export function swipeIntent(side, dx, dy) {
  if (Math.hypot(dx, dy) < START_PX) return null;
  const along = side ? dx : dy, across = side ? dy : dx;
  return along > 0 && Math.abs(along) > Math.abs(across) ? 'close' : 'other';
}

export function shouldClose(dist, ms) {
  return dist >= CLOSE_PX || (ms > 0 && dist >= START_PX * 2 && dist / ms >= CLOSE_SPEED);
}

function scrolledPane(target, sheet) {
  for (let el = target; el && el !== sheet; el = el.parentNode) {
    if (el.scrollHeight > el.clientHeight + 1 && el.scrollTop > 0) return el;
  }
  return null;
}

// isSide(): true while the sheet is the landscape side sheet. close(): close it.
export function setupSheetSwipe(sheet, { isSide, close, now = () => performance.now() }) {
  let g = null;
  const setT = (d, side, anim) => {
    sheet.style.transition = anim ? 'transform ' + SPRING_MS + 'ms ease-out' : 'none';
    sheet.style.transform = d ? (side ? 'translateX(' + d + 'px)' : 'translateY(' + d + 'px)') : '';
  };
  sheet.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { if (g && g.on) setT(0, g.side, true); g = null; return; }
    const t = e.touches[0];
    const side = !!isSide();
    // Bottom sheet: a pane scrolled away from the top scrolls first.
    const blocked = !side && !!scrolledPane(e.target, sheet);
    g = { x: t.clientX, y: t.clientY, t: now(), side, blocked, on: false, done: false };
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!g || g.done || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (!g.on) {
      const i = swipeIntent(g.side, dx, dy);
      // A downward move at the top cannot scroll: hold it before the browser
      // claims the gesture, so later moves stay cancelable.
      if (!i) { if (!g.side && !g.blocked && dy > 0 && dy >= Math.abs(dx) && e.cancelable) e.preventDefault(); return; }
      if (i !== 'close' || g.blocked) { g.done = true; return; }
      g.on = true;
    }
    if (e.cancelable) e.preventDefault();
    g.d = closeDistance(g.side, dx, dy);
    setT(g.d, g.side, false);
  }, { passive: false });
  const end = () => {
    if (!g) return;
    const was = g; g = null;
    if (!was.on) return;
    if (shouldClose(was.d || 0, now() - was.t)) { setT(0, was.side, false); close(); }
    else setT(0, was.side, true);
  };
  sheet.addEventListener('touchend', end, { passive: true });
  sheet.addEventListener('touchcancel', end, { passive: true });
  return { get active() { return !!(g && g.on); } };
}
