// Instrument panel, Readout mode (UI overhaul PR 5): the numbers, no DOM.
//
// Client-only: everything comes from the frame's compact scene state
// (state.boats, state.hud, state.course), the same in local, worker and
// remote mode. The boat shown is found by id, never by array index:
//   - this client's own player boat (spawnBoat id) when it has one;
//   - otherwise, outside a server room (local / worker, or remote lockstep),
//     boat 0 (the page's own boat there);
//   - a spectator in a server room gets none (every tile a dash).
// A value the frame does not carry for that boat is null (drawn as a dash),
// never guessed:
//   HDG / TWD  compass bearings 0–360 (0 = N, clockwise; TWD = wind from)
//         from the boat's heading_deg / twd_deg (sim PR #151)
//   TWS / AWS  the boat's tws_ms / aws_ms (m/s); TWS falls back to the
//         boat's own telemetry (hud.own[id].tel) on older frames
//   NEXT  the boat's next_mark_dist_m (the leaderboard's leg distance, so
//         the two match); straight line to the next mark only when the
//         frame has no such field (older servers)
//   FIN   the boat's to_finish_m (dash on a looping course or without a
//         leaderboard)
//   HEEL  the boat's heel_deg magnitude (sim heel.js; the sign is the side)
//   HIKE  the boat's hike_pct, 0–100 (crew from centreline to full hike)
import { boatSample, wrap180 } from './boat-stats.js';

export const READOUT_TILES = [
  { key: 'heading', label: 'HDG', unit: '°' },
  { key: 'bs', label: 'BSP', unit: 'm/s' },
  { key: 'vmg', label: 'VMG', unit: 'm/s' },
  { key: 'twa', label: 'TWA', unit: '°' },
  { key: 'twd', label: 'TWD', unit: '°' },
  { key: 'tws', label: 'TWS', unit: 'm/s' },
  { key: 'awa', label: 'AWA', unit: '°' },
  { key: 'aws', label: 'AWS', unit: 'm/s' },
  { key: 'next', label: 'NEXT', unit: 'm' },
  { key: 'fin', label: 'FIN', unit: 'm' },
  { key: 'heel', label: 'HEEL', unit: '°' },
  { key: 'hike', label: 'HIKE', unit: '%' },
];

const fin = (v) => (Number.isFinite(v) ? v : null);
const wrap360 = (d) => ((d % 360) + 360) % 360;

// The boat this client's instruments show, or null.
export function instrumentBoat(boats, { ownId = null, remote = false, lockstep = false } = {}) {
  const list = (boats || []).filter((b) => b && b.id !== undefined && b.id !== null);
  if (ownId !== null && ownId !== undefined) return list.find((b) => b.id === ownId) || null;
  if (remote && !lockstep) return null;
  return list[0] || null;
}

function centre(c) {
  const xy = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? [p.x, p.y] : Array.isArray(p) && Number.isFinite(p[0]) ? [p[0], p[1]] : null);
  if (Array.isArray(c) && c.length === 2 && typeof c[0] === 'object' && c[0] !== null) {
    const a = xy(c[0]); const d = xy(c[1]);
    if (a && d) return [(a[0] + d[0]) / 2, (a[1] + d[1]) / 2];
  }
  return xy(c);
}

// { heading, bs, vmg, twa, twd, tws, awa, aws, next, nextLabel, boatId }
// (numbers or null), or null when there is no boat to show.
export function readoutValues(state, opts = {}) {
  if (!state) return null;
  const boats = state.boats || [];
  const b = instrumentBoat(boats, opts);
  if (!b) return null;
  const s = boatSample(b);
  const h = state.hud || {};
  const own = opts.ownId != null && h.own ? h.own[opts.ownId] : null;
  const isFirst = boats.length > 0 && boats[0] && boats[0].id === b.id;
  const tel = own ? own.tel : (boats.length === 1 ? h.tel : null);
  const co = own ? own.co : (isFirst && opts.ownId == null ? h.co : null);
  const out = {
    boatId: b.id,
    heading: Number.isFinite(b.heading_deg) ? wrap360(b.heading_deg) : null,
    bs: s ? fin(s.bs) : null,
    vmg: s ? fin(s.vmg) : null,
    twa: s ? fin(s.twa) : null,
    twd: Number.isFinite(b.twd_deg) ? wrap360(b.twd_deg) : null,
    tws: Number.isFinite(b.tws_ms) ? b.tws_ms : (tel && Number.isFinite(tel.tws) ? tel.tws / 10 : null),
    awa: s ? fin(s.awa) : null,
    aws: Number.isFinite(b.aws_ms) ? b.aws_ms : null,
    fin: Number.isFinite(b.to_finish_m) ? b.to_finish_m : null,
    heel: Number.isFinite(b.heel_deg) ? Math.abs(b.heel_deg) : null,
    hike: Number.isFinite(b.hike_pct) ? b.hike_pct : null,
    next: null,
    nextLabel: null,
  };
  if (co) {
    if (co.w) out.nextLabel = 'start';
    else if (co.done) out.nextLabel = co.fin ? 'finish' : 'done';
    else if (Number.isInteger(co.i)) {
      out.nextLabel = (co.gate ? 'gate ' : 'mark ') + (co.i + 1);
      const c = centre(state.course && state.course.c ? state.course.c[co.i] : null);
      const bx = Number.isFinite(b.px) ? b.px : b.x; const by = Number.isFinite(b.py) ? b.py : b.y;
      if (c && Number.isFinite(bx) && Number.isFinite(by)) out.next = Math.hypot(c[0] - bx, c[1] - by);
    }
  }
  // leaderboard leg distance wins (also before the start: to the line)
  if ('next_mark_dist_m' in b) out.next = fin(b.next_mark_dist_m);
  return out;
}

// Tile text: value with fixed decimals, or the dash.
export function formatReadout(key, v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  if (key === 'bs' || key === 'vmg' || key === 'tws' || key === 'aws') return v.toFixed(1);
  if (key === 'next' || key === 'fin' || key === 'hike' || key === 'heel') return String(Math.round(v));
  if (key === 'twa' || key === 'awa') return String(Math.round(wrap180(v)));
  return String(Math.round(wrap360(v)) % 360);
}
