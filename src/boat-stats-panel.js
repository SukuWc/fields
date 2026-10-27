// "Boat stats" panel (#boat_stats, a <details>): while open, samples the
// frame state STATS_SAMPLE_HZ times a second into a StatsBuffer
// (boat-stats.js) and draws one inline-SVG line chart per series (heading,
// TWA, AWA, boat speed, VMG), one polyline per boat in its boat colour
// (boat-colors.js, by index in state.boats) with a Boat <id> legend.
// Closed: no sampling, no drawing, buffers cleared. Remote room: only this
// client's own boat; local / worker: every boat. Hover shows all boats'
// values at the pointer time (shared svg-chart hover helpers).
import { StatsBuffer, STATS_SERIES, boatsToShow, seriesRange, polylinePoints, formatStatValue, latestValues } from './boat-stats.js';
import { boatColorCss, boatColorIndex } from './boat-colors.js';
import { SVG_NS, valueToY, xToTime, nearestTimeIndex, agoLabel, bindSvgChartHover } from './svg-chart.js';

const W = 260, H = 54;

export function setupBoatStats({ remote = false, lockstep = () => false } = {}) {
  const root = document.getElementById('boat_stats');
  const body = document.getElementById('boat_stats_body');
  if (!root || !body) return { onFrame() {}, setOwnId() {} };
  const buf = new StatsBuffer();
  let ownId = null, dirty = false, colorIdx = new Map(), charts = null;
  const legend = document.createElement('div');
  legend.className = 'bs-legend';
  const empty = document.createElement('div');
  empty.className = 'bs-empty';

  const build = () => {
    body.textContent = '';
    body.append(empty, legend);
    charts = {};
    for (const ser of STATS_SERIES) {
      const lab = document.createElement('div');
      lab.className = 'bs-label';
      const vals = document.createElement('div');
      vals.className = 'bs-values';
      const wrap = document.createElement('div');
      wrap.className = 'bs-chart-wrap';
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('width', W); svg.setAttribute('height', H);
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.classList.add('bs-chart');
      const zero = document.createElementNS(SVG_NS, 'line');
      zero.setAttribute('x1', 0); zero.setAttribute('x2', W);
      zero.setAttribute('stroke', 'rgba(255,255,255,0.15)');
      const lines = document.createElementNS(SVG_NS, 'g');
      lines.setAttribute('fill', 'none'); lines.setAttribute('stroke-width', '1.4');
      svg.append(zero, lines);
      const tip = document.createElement('div');
      tip.className = 'bs-tip';
      wrap.append(svg, tip);
      body.append(lab, vals, wrap);
      const model = { ser, lo: 0, hi: 1, t1: 0, ids: [], rows: [] };
      const hover = bindSvgChartHover(svg, tip, (sx) => {
        const { lo, hi, t1, ids, rows } = model;
        if (!ids.length) return null;
        const t = xToTime(sx, t1, buf.windowS, W);
        const parts = [];
        let yMark = NaN, colorMark = null;
        for (let k = 0; k < ids.length; k++) {
          const id = ids[k];
          const r = rows[k];
          const i = nearestTimeIndex(r.t, t);
          if (i < 0) continue;
          const v = r[ser.key][i];
          parts.push(`Boat ${id}: ${formatStatValue(ser, v)}`);
          if (!Number.isFinite(yMark) && Number.isFinite(v)) {
            yMark = valueToY(v, lo, hi, H);
            colorMark = colorOf(id);
          }
        }
        if (!parts.length) return null;
        const age = Math.max(0, t1 - t);
        return {
          x: Math.max(0, Math.min(W, sx)),
          y: yMark,
          color: colorMark,
          text: `${parts.join(' · ')} · ${agoLabel(age)}`,
        };
      });
      charts[ser.key] = { lab, vals, zero, lines, model, hover };
    }
  };
  root.addEventListener('toggle', () => {
    if (!root.open) {
      if (charts) for (const c of Object.values(charts)) c.hover.destroy();
      buf.clear(); body.textContent = ''; charts = null;
    }
  });

  const colorOf = (id) => boatColorCss(colorIdx.has(id) ? colorIdx.get(id) : 0);
  const draw = () => {
    dirty = false;
    if (!root.open) return;
    if (!charts) build();
    const ids = buf.ids();
    empty.textContent = ids.length ? '' : remote ? 'Join with your boat to see its stats.' : 'No boats.';
    legend.textContent = '';
    for (const id of ids) {
      const it = document.createElement('span');
      it.className = 'bs-key';
      it.style.color = colorOf(id);
      it.textContent = '\u25A0 Boat ' + id;
      legend.appendChild(it);
    }
    const t1 = Math.max(...ids.map((id) => { const t = buf.series.get(id).t; return t[t.length - 1]; }), 0);
    for (const ser of STATS_SERIES) {
      const { lab, vals, zero, lines, model } = charts[ser.key];
      const rows = ids.map((id) => buf.series.get(id));
      const [lo, hi] = seriesRange(ser, rows.map((r) => r[ser.key]));
      const zy = valueToY(0, lo, hi, H);
      zero.setAttribute('y1', zy); zero.setAttribute('y2', zy);
      lab.textContent = `${ser.label} (${ser.unit})`;
      vals.textContent = '';
      for (const { id, v } of latestValues(buf, ser.key, ids)) {
        const it = document.createElement('span');
        it.className = 'bs-val';
        it.style.color = colorOf(id);
        it.textContent = `Boat ${id}: ${formatStatValue(ser, v)}`;
        vals.appendChild(it);
      }
      lines.textContent = '';
      ids.forEach((id, k) => {
        const r = rows[k];
        for (const pts of polylinePoints(r.t, r[ser.key], { t1, windowS: buf.windowS, lo, hi, w: W, h: H, wrap: ser.max === 180 })) {
          const pl = document.createElementNS(SVG_NS, 'polyline');
          pl.setAttribute('points', pts);
          pl.setAttribute('stroke', colorOf(id));
          lines.appendChild(pl);
        }
      });
      model.ser = ser; model.lo = lo; model.hi = hi; model.t1 = t1; model.ids = ids; model.rows = rows;
    }
  };

  return {
    setOwnId(id) { ownId = id; },
    // state: the frame's compact scene state; tS: seconds (state.ts sim time).
    onFrame(state) {
      if (!root.open || !state || !state.boats) return;
      colorIdx = boatColorIndex(state.boats);
      const tS = Number.isFinite(state.ts) ? state.ts : performance.now() / 1000;
      if (buf.add(tS, boatsToShow(state.boats, { remote, ownId, lockstep: lockstep() })) && !dirty) {
        dirty = true;
        requestAnimationFrame(draw);
      }
    },
  };
}
