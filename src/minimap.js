// Minimap (UI overhaul PR 9, zone D, bottom left): the whole map at a
// glance. Client-only, the same in local, worker and remote mode:
//   statics (snapshot): course anchors / gates / finish, start line,
//     boundary { x, yMin, yMax }
//   frame state: boats by id (px / py, heading_deg), mark centres
//     (state.course.c), the next mark (state.course.view.index), wind
//     (the shown boat's twd_deg)
//   view (this client): the camera rectangle.
// Click (or drag) pans the camera there and turns Camera Follow off; the
// "Follow" button turns it back on. Redrawn at 5 Hz. No sim state is read.
import { boatColorCss, boatColorIndex } from './boat-colors.js';
import { instrumentBoat } from './instrument-readout.js';

import { PHONE_QUERY } from './layout.js';
// Phones only: a tablet keeps the desktop map (plan M10).
export const MINIMAP_COMPACT_QUERY = PHONE_QUERY;
export const MINIMAP_W = 320;
export const MINIMAP_H = 256;
const UPDATE_MS = 200;
const LAYLINE_DEG = 45; // tacking half-angle for the laylines (fixed)

export const xy = (p) => {
  if (!p) return null;
  if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) return [p[0], p[1]];
  if (Number.isFinite(p.x) && Number.isFinite(p.y)) return [p.x, p.y];
  return null;
};

// World (metres, map centred on 0, +y north) ↔ minimap pixels, letterboxed
// to keep the map's aspect.
export function minimapTransform(mapW, mapH, w = MINIMAP_W, h = MINIMAP_H, pad = 6) {
  const s = Math.min((w - 2 * pad) / mapW, (h - 2 * pad) / mapH);
  const ox = w / 2, oy = h / 2;
  return {
    s,
    toPx: (x, y) => [ox + x * s, oy - y * s],
    toWorld: (px, py) => [(px - ox) / s, (oy - py) / s],
    rect: [ox - (mapW / 2) * s, oy - (mapH / 2) * s, mapW * s, mapH * s],
  };
}

// Camera rectangle in world coordinates (renderer.js: 70° vertical FOV
// looking straight down from camera_zoom).
export function cameraRect(view, aspect) {
  const hh = view.camera_zoom * Math.tan(35 * Math.PI / 180);
  const hw = hh * aspect;
  return [view.camera_position_x - hw, view.camera_position_y - hh, 2 * hw, 2 * hh];
}

// Layline end points from a windward mark: two lines running downwind at
// ±LAYLINE_DEG either side of dead downwind. twdDeg: compass, wind from.
export function laylines(mark, twdDeg, len) {
  if (!mark || !Number.isFinite(twdDeg)) return [];
  // downwind of the mark (bearing twd + 180), opened by ±LAYLINE_DEG;
  // compass bearing → world: x = sin, y = cos
  return [-1, 1].map((sgn) => {
    const b = (twdDeg + 180 + sgn * LAYLINE_DEG) * Math.PI / 180;
    return [mark[0] + Math.sin(b) * len, mark[1] + Math.cos(b) * len];
  });
}

export function setupMinimap({ view, getMapSize, remote = false, lockstep = () => false } = {}, doc = document) {
  const root = doc.getElementById('minimap');
  if (!root || !view) return { onFrame() {}, setOwnId() {} };
  const cv = root.querySelector('canvas');
  const followBtn = root.querySelector('.mm-follow');
  const ctx = cv.getContext('2d');
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  cv.width = MINIMAP_W * dpr; cv.height = MINIMAP_H * dpr;
  let ownId = null, lastState = null, lastStatics = null, last = 0;
  const follow = () => doc.getElementById('camera_follow');
  const setFollow = (on) => {
    const f = follow();
    if (f && f.checked !== on) { f.checked = on; f.dispatchEvent(new Event('change', { bubbles: true })); }
    else view.input_camera_follow(on);
    syncFollowBtn();
  };
  const syncFollowBtn = () => { if (followBtn) followBtn.setAttribute('aria-pressed', view.camera_follow ? 'true' : 'false'); };
  if (followBtn) followBtn.addEventListener('click', () => { setFollow(!view.camera_follow); draw(); });
  const panTo = (e) => {
    const [mw, mh] = getMapSize();
    const r = cv.getBoundingClientRect();
    const t = minimapTransform(mw, mh);
    const [x, y] = t.toWorld(((e.clientX - r.left) / r.width) * MINIMAP_W, ((e.clientY - r.top) / r.height) * MINIMAP_H);
    if (view.camera_follow) setFollow(false);
    view.camera_position_x = Math.max(view.camera_position_x_min, Math.min(view.camera_position_x_max, x));
    view.camera_position_y = Math.max(view.camera_position_y_min, Math.min(view.camera_position_y_max, y));
    draw();
  };
  // Phones (plan M8): the round map only opens the full map; panning
  // happens in the opened map. Same media query as the mobile layout.
  const compactQ = window.matchMedia ? window.matchMedia(MINIMAP_COMPACT_QUERY) : null;
  const closeBtn = root.querySelector('.mm-close');
  const setOpen = (on) => { root.classList.toggle('mm-open', on); draw(); };
  if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(false); });
  // Open on click (after the finger lifts) so the same tap cannot land on
  // the opened map's close button.
  cv.addEventListener('click', () => { if (compactQ && compactQ.matches && !root.classList.contains('mm-open')) setOpen(true); });
  let dragging = false;
  cv.addEventListener('pointerdown', (e) => {
    if (compactQ && compactQ.matches && !root.classList.contains('mm-open')) return; // opens on click, below

    dragging = true; cv.setPointerCapture?.(e.pointerId); panTo(e);
  });
  cv.addEventListener('pointermove', (e) => { if (dragging) panTo(e); });
  const end = () => { dragging = false; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);

  function draw() {
    const [mw, mh] = getMapSize();
    const t = minimapTransform(mw, mh);
    const P = (p) => t.toPx(p[0], p[1]);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
    ctx.fillStyle = 'rgba(30, 60, 140, 0.55)';
    ctx.fillRect(...t.rect);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    ctx.strokeRect(...t.rect);
    const st = lastStatics || {};
    const s = lastState || {};
    // boundary
    if (st.boundary && Number.isFinite(st.boundary.x)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([3, 3]);
      for (const sx of [-1, 1]) {
        const a = P([sx * st.boundary.x, Number.isFinite(st.boundary.yMin) ? st.boundary.yMin : -mh / 2]);
        const b = P([sx * st.boundary.x, Number.isFinite(st.boundary.yMax) ? st.boundary.yMax : mh / 2]);
        ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    const line = (L, color) => {
      const a = xy(L && L.a), b = xy(L && L.b);
      if (!a || !b) return;
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(...P(a)); ctx.lineTo(...P(b)); ctx.stroke();
    };
    line(st.start, '#ffffff');
    line(st.finish, '#ffc400');
    // course: mark centres from the frame, else anchors from the snapshot
    const cs = st.course;
    const live = s.course && Array.isArray(s.course.c) ? s.course.c : null;
    const marks = [];
    if (cs || live) {
      const n = cs ? cs.n : live.length;
      for (let i = 0; i < n; i++) {
        const c = live ? live[i] : null;
        const g = cs && cs.gates ? cs.gates[i] : null;
        if (Array.isArray(c) && c.length === 2 && typeof c[0] === 'object' && c[0] !== null && !Number.isFinite(c[0])) {
          marks.push({ pts: [xy(c[0]), xy(c[1])].filter(Boolean) });
        } else if (g) marks.push({ pts: [xy(g[0]), xy(g[1])].filter(Boolean) });
        else marks.push({ pts: [xy(c) || xy(cs && cs.anchors ? cs.anchors[i] : null)].filter(Boolean) });
      }
      const mid = (m) => (m.pts.length === 2 ? [(m.pts[0][0] + m.pts[1][0]) / 2, (m.pts[0][1] + m.pts[1][1]) / 2] : m.pts[0]);
      // course line
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath();
      const startMid = cs && xy(cs.start && cs.start.mid);
      const pts = marks.map(mid).filter(Boolean);
      if (startMid) pts.unshift(startMid);
      if (cs && cs.fin && xy(cs.fin) && cs.lapsFinite) pts.push(xy(cs.fin));
      pts.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
      ctx.stroke(); ctx.setLineDash([]);
      // laylines on the next mark
      const next = s.course && s.course.view ? s.course.view.index : null;
      const me = lastState ? instrumentBoat(lastState.boats, { ownId, remote, lockstep: lockstep() }) : null;
      const twd = me && Number.isFinite(me.twd_deg) ? me.twd_deg : (s.boats && s.boats[0] && Number.isFinite(s.boats[0].twd_deg) ? s.boats[0].twd_deg : null);
      if (Number.isInteger(next) && marks[next]) {
        const m = mid(marks[next]);
        ctx.strokeStyle = 'rgba(255,196,0,0.7)'; ctx.lineWidth = 1;
        for (const e of laylines(m, twd, Math.max(mw, mh))) { ctx.beginPath(); ctx.moveTo(...P(m)); ctx.lineTo(...P(e)); ctx.stroke(); }
      }
      marks.forEach((m, i) => {
        for (const p of m.pts) {
          ctx.fillStyle = i === next ? '#ffc400' : '#ff8a00';
          ctx.strokeStyle = '#0b1747'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(...P(p), i === next ? 4 : 3, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        }
      });
    }
    // camera rectangle
    const cr = cameraRect(view, window.innerWidth / Math.max(1, window.innerHeight));
    const [x0, y0] = P([cr[0], cr[1] + cr[3]]);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, cr[2] * t.s, cr[3] * t.s);
    // boats by id
    const boats = (s.boats || []).filter((b) => b && b.id != null);
    const me = lastState ? instrumentBoat(boats, { ownId, remote, lockstep: lockstep() }) : null;
    const colors = boatColorIndex(boats);
    for (const b of boats) {
      const p = xy([Number.isFinite(b.px) ? b.px : b.x, Number.isFinite(b.py) ? b.py : b.y]);
      if (!p) continue;
      const [px, py] = P(p);
      const own = me && me.id === b.id;
      const r = own ? 5 : 3.5;
      ctx.fillStyle = boatColorCss(colors.get(b.id));
      ctx.beginPath(); ctx.arc(px, py, r, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = own ? '#ffc400' : '#0b1747'; ctx.lineWidth = own ? 2 : 1; ctx.stroke();
      if (Number.isFinite(b.heading_deg)) {
        const a = b.heading_deg * Math.PI / 180;
        ctx.strokeStyle = own ? '#ffc400' : '#ffffff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.sin(a) * (r + 6), py - Math.cos(a) * (r + 6)); ctx.stroke();
      }
    }
    // wind arrow (top right): blowing towards
    if (Number.isFinite(twdOf(s))) {
      const a = (twdOf(s) + 180) * Math.PI / 180, cx = MINIMAP_W - 16, cy = 16;
      const dx = Math.sin(a) * 9, dy = -Math.cos(a) * 9;
      ctx.strokeStyle = '#7fd3ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - dx, cy - dy); ctx.lineTo(cx + dx, cy + dy); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 2.5, 0, 2 * Math.PI); ctx.fillStyle = '#7fd3ff'; ctx.fill();
    }
    syncFollowBtn();
  }
  const twdOf = (s) => {
    const me = s && s.boats ? instrumentBoat(s.boats, { ownId, remote, lockstep: lockstep() }) : null;
    const b = me || (s && s.boats && s.boats[0]);
    return b && Number.isFinite(b.twd_deg) ? b.twd_deg : NaN;
  };
  draw();
  return {
    setOwnId(id) { ownId = id || null; },
    onFrame(state, statics) {
      lastState = state; if (statics) lastStatics = statics;
      const now = performance.now();
      if (now - last < UPDATE_MS) return;
      last = now; draw();
    },
  };
}
