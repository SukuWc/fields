// Landing admin helpers: default TOML for Reset (same as in-game room panel)
// and list reconciliation that keeps textarea focus across room refreshes,
// plus the per-room replay links (GET /api/replays, apps/server/replays.js).
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

/** Max replay links per room card (the server keeps the last three races). */
export const REPLAY_LINKS_MAX = 3;

function clockOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** Race length as m:ss (h:mm:ss from an hour), e.g. 65.6 → "1:06". */
export function formatRaceLength(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + sec : m + ':' + sec;
}

/** Bytes with thousands separators, e.g. 14599 → "14,599 B". */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' B';
}

/**
 * Replay links for one room card from the /api/replays list (newest first):
 * up to REPLAY_LINKS_MAX of this room's races as { id, href, text, title }, e.g.
 * "Replay 12:50 · 1:06 · 14,599 B · suku" (start time in the viewer's time
 * zone, race length, record size).
 * api: the ?api= server prefix ('' = same origin). clock(iso): the time label.
 */
export function replayLinksFor(replays, roomId, { api = '', clock = clockOf } = {}) {
  const out = [];
  for (const r of Array.isArray(replays) ? replays : []) {
    if (!r || r.room !== roomId || typeof r.id !== 'string') continue;
    const parts = ['Replay'];
    const at = clock(r.startedAt);
    if (at) parts[0] += ' ' + at;
    const len = formatRaceLength(r.durationS);
    if (len) parts.push(len);
    const size = formatBytes(r.bytes);
    if (size) parts.push(size);
    if (Array.isArray(r.players) && r.players.length) parts.push(r.players.join(', '));
    const title = [len && 'length ' + len, size && 'size ' + size].filter(Boolean).join(', ');
    out.push({ id: r.id, href: api + '/play/?replay=' + encodeURIComponent(r.id), text: parts.join(' · '), title });
    if (out.length >= REPLAY_LINKS_MAX) break;
  }
  return out;
}

/**
 * Fill a card's replay box with links (anchors with class "replay"). Leaves
 * the DOM alone when the links are unchanged (data-key), so the 5 s room
 * poll does not touch it; hidden when there are none. Returns true if it
 * changed the DOM.
 */
export function syncReplayLinks(box, links, doc = document) {
  const key = links.map((l) => l.id + '|' + l.text + '|' + (l.title || '')).join('\n');
  if (box.dataset.key === key) return false;
  box.dataset.key = key;
  const nodes = links.map((l) => {
    const a = doc.createElement('a');
    a.className = 'replay';
    a.href = l.href;
    a.textContent = l.text;
    if (l.title) a.title = l.title;
    return a;
  });
  box.replaceChildren(...nodes);
  box.hidden = links.length === 0;
  return true;
}

if (typeof window !== 'undefined') {
  window.LandingRoomAdmin = { defaultToml, mapDimsFromToml, syncListChildren, replayLinksFor, syncReplayLinks };
}
