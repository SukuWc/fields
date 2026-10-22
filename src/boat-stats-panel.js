// "Boat stats" panel (#boat_stats, a <details>): while open, samples the
// frame state STATS_SAMPLE_HZ times a second into a StatsBuffer
// (boat-stats.js) and draws one inline-SVG line chart per series (heading,
// TWA, AWA, boat speed, VMG), one polyline per boat in its boat colour
// (boat-colors.js, by index in state.boats) with a Boat <id> legend.
// Closed: no sampling, no drawing, buffers cleared. Remote room: only this
// client's own boat; local / worker: every boat.
import { StatsBuffer, STATS_SERIES, boatsToShow, seriesRange, polylinePoints } from './boat-stats.js';
import { boatColorCss, boatColorIndex } from './boat-colors.js';

const W = 260, H = 54;
const SVG = 'http://www.w3.org/2000/svg';

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
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('width', W); svg.setAttribute('height', H);
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.classList.add('bs-chart');
      const zero = document.createElementNS(SVG, 'line');
      zero.setAttribute('x1', 0); zero.setAttribute('x2', W);
      zero.setAttribute('stroke', 'rgba(255,255,255,0.15)');
      const lines = document.createElementNS(SVG, 'g');
      lines.setAttribute('fill', 'none'); lines.setAttribute('stroke-width', '1.4');
      svg.append(zero, lines);
      body.append(lab, svg);
      charts[ser.key] = { lab, zero, lines };
    }
  };
  root.addEventListener('toggle', () => {
    if (!root.open) { buf.clear(); body.textContent = ''; charts = null; }
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
      const { lab, zero, lines } = charts[ser.key];
      const rows = ids.map((id) => buf.series.get(id));
      const [lo, hi] = seriesRange(ser, rows.map((r) => r[ser.key]));
      const zy = H - ((Math.max(lo, Math.min(hi, 0)) - lo) / (hi - lo)) * H;
      zero.setAttribute('y1', zy); zero.setAttribute('y2', zy);
      const dec = ser.unit === 'm/s' ? 2 : 0;
      const last = rows.length === 1 ? rows[0][ser.key][rows[0][ser.key].length - 1] : NaN;
      lab.textContent = rows.length === 1 && Number.isFinite(last) ? `${ser.label}: ${last.toFixed(dec)} ${ser.unit}` : `${ser.label} (${ser.unit})`;
      lines.textContent = '';
      ids.forEach((id, k) => {
        const r = rows[k];
        for (const pts of polylinePoints(r.t, r[ser.key], { t1, windowS: buf.windowS, lo, hi, w: W, h: H, wrap: ser.max === 180 })) {
          const pl = document.createElementNS(SVG, 'polyline');
          pl.setAttribute('points', pts);
          pl.setAttribute('stroke', colorOf(id));
          lines.appendChild(pl);
        }
      });
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
