// "Boat stats" panel (#boat_stats, a <details>): while open, samples the
// frame state STATS_SAMPLE_HZ times a second into a StatsBuffer
// (boat-stats.js) and draws one small canvas line chart per series per boat.
// Closed: no sampling, no drawing, buffers cleared. Remote room: only this
// client's own boat; local / worker: every boat, one section per boat id.
import { StatsBuffer, STATS_SERIES, boatsToShow } from './boat-stats.js';

const W = 260, H = 54;
const COLORS = { heading: '#7fb3ff', twa: '#ffcf5a', awa: '#7fe0a0', bs: '#ff8a80', vmg: '#d59cff' };

export function setupBoatStats({ remote = false, lockstep = () => false } = {}) {
  const root = document.getElementById('boat_stats');
  const body = document.getElementById('boat_stats_body');
  if (!root || !body) return { onFrame() {}, setOwnId() {} };
  const buf = new StatsBuffer();
  const sections = new Map();
  let ownId = null;
  let dirty = false;
  root.addEventListener('toggle', () => {
    if (!root.open) { buf.clear(); sections.clear(); body.textContent = ''; }
  });

  const section = (id) => {
    let s = sections.get(id);
    if (s) return s;
    const el = document.createElement('div');
    el.className = 'bs-boat';
    const h = document.createElement('div');
    h.className = 'bs-title';
    h.textContent = 'Boat ' + id;
    el.appendChild(h);
    const charts = {};
    for (const ser of STATS_SERIES) {
      const lab = document.createElement('div');
      lab.className = 'bs-label';
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      el.append(lab, c);
      charts[ser.key] = { lab, ctx: c.getContext('2d') };
    }
    body.appendChild(el);
    s = { el, charts };
    sections.set(id, s);
    return s;
  };

  const draw = () => {
    dirty = false;
    if (!root.open) return;
    const ids = buf.ids();
    for (const [id, s] of sections) if (!ids.includes(id)) { s.el.remove(); sections.delete(id); }
    if (!ids.length) { if (!body.textContent) body.textContent = remote ? 'Join with your boat to see its stats.' : 'No boats.'; return; }
    if (!sections.size) body.textContent = '';
    for (const id of ids) {
      const row = buf.series.get(id), s = section(id);
      const t1 = row.t[row.t.length - 1], t0 = t1 - buf.windowS;
      for (const ser of STATS_SERIES) {
        const v = row[ser.key], { lab, ctx } = s.charts[ser.key];
        const last = v[v.length - 1];
        lab.textContent = `${ser.label}: ${Number.isFinite(last) ? last.toFixed((ser.key === 'bs' || ser.key === 'vmg') ? 2 : 0) : '—'} ${ser.unit}`;
        let lo = ser.min, hi = ser.max;
        if (lo === null) { let m = 0.5; for (const x of v) if (Math.abs(x) > m) m = Math.abs(x); hi = Math.ceil(m * 2) / 2; lo = -hi; }
        else if (hi === null) { hi = 0.5; for (const x of v) if (x > hi) hi = x; hi = Math.ceil(hi * 2) / 2; }
        ctx.clearRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        const zy = H - ((Math.max(lo, Math.min(hi, 0)) - lo) / (hi - lo)) * H;
        ctx.moveTo(0, zy); ctx.lineTo(W, zy); ctx.stroke();
        ctx.strokeStyle = COLORS[ser.key];
        ctx.beginPath();
        let pen = false, prev = null;
        for (let i = 0; i < v.length; i++) {
          if (!Number.isFinite(v[i])) { pen = false; continue; }
          const x = ((row.t[i] - t0) / buf.windowS) * W;
          const y = H - ((v[i] - lo) / (hi - lo)) * H;
          // Angles: break the line where it wraps ±180°.
          if (pen && ser.max === 180 && Math.abs(v[i] - prev) > 180) pen = false;
          if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          pen = true; prev = v[i];
        }
        ctx.stroke();
      }
    }
  };

  return {
    setOwnId(id) { ownId = id; },
    // state: the frame's compact scene state; tS: seconds (state.ts sim time).
    onFrame(state) {
      if (!root.open || !state || !state.boats) return;
      const tS = Number.isFinite(state.ts) ? state.ts : performance.now() / 1000;
      if (buf.add(tS, boatsToShow(state.boats, { remote, ownId, lockstep: lockstep() })) && !dirty) {
        dirty = true;
        requestAnimationFrame(draw);
      }
    },
  };
}
