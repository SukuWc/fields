// Breakpoints (standardization PR 1–4): the one place the layout media
// queries live. setupLayout() mirrors each query as a class on <html>
// (bp-touch, bp-phone, bp-tablet, ...), and index.html styles against those
// classes instead of repeating the queries. Other modules import the query
// strings from here.

// Phone-size screen or a touch-only device of any size: the mobile chrome
// (top bar, readout strip, sheet, touch controls on by default).
export const TOUCH_UI_QUERY = '(max-width: 768px), (pointer: coarse) and (hover: none)';
// Mouse / trackpad screen wider than a phone.
export const DESKTOP_QUERY = '(min-width: 769px) and (hover: hover), (min-width: 769px) and (pointer: fine)';
// Touch-only device of at least 769 × 600 (plan M10).
export const TABLET_QUERY = '(pointer: coarse) and (hover: none) and (min-width: 769px) and (min-height: 600px)';
// Phone: narrow, or touch-only and short (a phone in landscape).
export const PHONE_QUERY = '(max-width: 768px), (pointer: coarse) and (hover: none) and (max-height: 599px)';
// Desktop zones (instrument panel, minimap box): desktop or tablet.
export const WIDE_QUERY = DESKTOP_QUERY + ', ' + TABLET_QUERY;
// Short landscape screen (any pointer).
export const SHORT_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px)';
// Phone in landscape: the one-row top bar and side sheet.
export const PHONE_LANDSCAPE_QUERY = '(max-width: 768px) and (orientation: landscape) and (max-height: 500px), (pointer: coarse) and (hover: none) and (orientation: landscape) and (max-height: 500px)';
// Touch-only pointer at any size.
export const COARSE_QUERY = '(hover: none) and (pointer: coarse)';

// Class on <html> -> query.
export const LAYOUT_CLASSES = {
  'bp-touch': TOUCH_UI_QUERY,
  'bp-desktop': DESKTOP_QUERY,
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
