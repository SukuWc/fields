// Breakpoints (standardization PR 1–4): the one place the layout media
// queries live. setupLayout() mirrors each query as a class on <html>
// (bp-touch, bp-phone, bp-tablet, ...), and index.html styles against those
// classes instead of repeating the queries. Other modules import the query
// strings from here.

// Append a media condition to every comma-separated part of a query list.
const and = (query, cond) => query.split(',').map((q) => q.trim() + ' and ' + cond).join(', ');

// Mouse / trackpad (hover or fine pointer).
const MOUSE = ['(hover: hover)', '(pointer: fine)'];
// Narrow desktop window (769–999 px wide, mouse): too narrow for the desktop
// three-column HUD, so it falls back to the tablet layout (phone layout when
// it is also shorter than 600 px), the same as a touch device of that size.
export const NARROW_DESKTOP_QUERY = MOUSE.map((m) => '(min-width: 769px) and (max-width: 999px) and ' + m).join(', ');
// Real touch device or phone-size screen (no narrow-desktop fallback): used
// for defaults that depend on the device rather than the layout, such as
// Touch controls being on by default.
export const TOUCH_DEVICE_QUERY = '(max-width: 768px), (pointer: coarse) and (hover: none)';

// Phone-size screen, a touch-only device of any size, or a narrow desktop
// window: the mobile chrome (top bar, readout strip / sheet).
export const TOUCH_UI_QUERY = TOUCH_DEVICE_QUERY + ', ' + NARROW_DESKTOP_QUERY;
// Mouse / trackpad screen at least 1000 px wide: the desktop three-column HUD.
export const DESKTOP_QUERY = MOUSE.map((m) => '(min-width: 1000px) and ' + m).join(', ');
// Desktop narrower than 1158 px: the minimap column would drop under 160 px
// next to a full-width instrument panel, so the minimap collapses into a
// button (desktop-hud.js) and the panel keeps the room.
export const DESKTOP_COMPACT_QUERY = and(DESKTOP_QUERY, '(max-width: 1157px)');
// Touch-only device of at least 769 × 600 (plan M10), or a narrow desktop window of that height.
export const TABLET_QUERY = '(pointer: coarse) and (hover: none) and (min-width: 769px) and (min-height: 600px), ' + and(NARROW_DESKTOP_QUERY, '(min-height: 600px)');
// Phone: narrow, or touch-only and short (a phone in landscape), or a short narrow desktop window.
export const PHONE_QUERY = '(max-width: 768px), (pointer: coarse) and (hover: none) and (max-height: 599px), ' + and(NARROW_DESKTOP_QUERY, '(max-height: 599px)');
// Desktop zones (instrument panel, minimap box): desktop or tablet.
export const WIDE_QUERY = DESKTOP_QUERY + ', ' + TABLET_QUERY;
// Short landscape screen (any pointer).
export const SHORT_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px)';
// Phone in landscape: the one-row top bar and side sheet.
export const PHONE_LANDSCAPE_QUERY = '(max-width: 768px) and (orientation: landscape) and (max-height: 500px), (pointer: coarse) and (hover: none) and (orientation: landscape) and (max-height: 500px), ' + and(NARROW_DESKTOP_QUERY, '(orientation: landscape) and (max-height: 500px)');
// Touch-only pointer at any size.
export const COARSE_QUERY = '(hover: none) and (pointer: coarse)';

// Class on <html> -> query.
export const LAYOUT_CLASSES = {
  'bp-touch': TOUCH_UI_QUERY,
  'bp-desktop': DESKTOP_QUERY,
  'bp-desktop-compact': DESKTOP_COMPACT_QUERY,
  'bp-tablet': TABLET_QUERY,
  'bp-phone': PHONE_QUERY,
  'bp-wide': WIDE_QUERY,
  'bp-short-landscape': SHORT_LANDSCAPE_QUERY,
  'bp-phone-landscape': PHONE_LANDSCAPE_QUERY,
  'bp-coarse': COARSE_QUERY,
};

export function matches(query, win = typeof window !== 'undefined' ? window : null) {
  return !!(win && typeof win.matchMedia === 'function' && win.matchMedia(query).matches);
}

// Classes that apply for a matcher (query -> boolean).
export function layoutClasses(match) {
  return Object.keys(LAYOUT_CLASSES).filter((c) => match(LAYOUT_CLASSES[c]));
}

export function setupLayout(win = typeof window !== 'undefined' ? window : null) {
  if (!win || !win.document || typeof win.matchMedia !== 'function') return;
  const root = win.document.documentElement;
  const apply = () => {
    for (const [c, q] of Object.entries(LAYOUT_CLASSES)) root.classList.toggle(c, win.matchMedia(q).matches);
    root.classList.add('bp-ready');
  };
  for (const q of Object.values(LAYOUT_CLASSES)) {
    const m = win.matchMedia(q);
    if (m.addEventListener) m.addEventListener('change', apply);
  }
  apply();
}

setupLayout();
