// Landing admin helpers: default TOML for Reset (same as in-game room panel)
// and list reconciliation that keeps textarea focus across room refreshes.
// Bundled by build-app.mjs into dist-app/room-admin.js as an IIFE on
// window.LandingRoomAdmin.
import { defaultRoomConfig, stringifyRoomConfig } from '../../src/room-config.js';

export function defaultToml(mapW, mapH) {
  return stringifyRoomConfig(defaultRoomConfig(mapW, mapH));
}

/** Read map_width_m / map_height_m from TOML text (line-oriented; no full parse). */
export function mapDimsFromToml(text) {
  let mapW = NaN;
  let mapH = NaN;
  for (const line of String(text || '').split(/\r?\n/)) {
    let m = /^\s*map_width_m\s*=\s*(-?\d+(?:\.\d+)?)\s*(?:#.*)?$/.exec(line);
    if (m) mapW = Number(m[1]);
    m = /^\s*map_height_m\s*=\s*(-?\d+(?:\.\d+)?)\s*(?:#.*)?$/.exec(line);
    if (m) mapH = Number(m[1]);
  }
  return { mapW, mapH };
}

/**
 * Make parent's children match `next` (same nodes, same order) without
 * calling replaceChildren when already correct — so focused textareas
 * inside keep focus and scrollTop. Returns true if the DOM was mutated.
 */
export function syncListChildren(parent, next) {
  const want = Array.from(next);
  const cur = Array.from(parent.children);
  if (cur.length === want.length && cur.every((el, i) => el === want[i])) {
    return false;
  }

  const active = typeof document !== 'undefined' ? document.activeElement : null;
  let restore = null;
  if (
    active &&
    typeof active === 'object' &&
    want.some((el) => el === active || (typeof el.contains === 'function' && el.contains(active)))
  ) {
    restore = {
      el: active,
      start: active.selectionStart,
      end: active.selectionEnd,
      scrollTop: active.scrollTop,
    };
  }

  for (const el of cur) {
    if (!want.includes(el)) el.remove();
  }

  for (let i = 0; i < want.length; i++) {
    const node = want[i];
    if (parent.children[i] !== node) {
      parent.insertBefore(node, parent.children[i] || null);
    }
  }

  if (restore && restore.el.isConnected !== false) {
    try {
      if (typeof restore.el.focus === 'function') restore.el.focus({ preventScroll: true });
      if (typeof restore.start === 'number' && typeof restore.el.selectionStart === 'number') {
        restore.el.selectionStart = restore.start;
        restore.el.selectionEnd = restore.end;
      }
      if (typeof restore.scrollTop === 'number') restore.el.scrollTop = restore.scrollTop;
    } catch (_) { /* non-focusable / stub */ }
  }
  return true;
}

if (typeof window !== 'undefined') {
  window.LandingRoomAdmin = { defaultToml, mapDimsFromToml, syncListChildren };
}
