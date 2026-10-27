// Landing room frame-time charts: SVG polylines + hover (same technique as
// boat-stats, via shared src/svg-chart.js). Bundled by build-app.mjs into
// dist-app/perf-charts.js as an IIFE exposing window.LandingPerfCharts.
import {
  SVG_NS, indexToX, xToIndex, agoLabel, bindSvgChartHover,
} from '../../src/svg-chart.js';

const W = 480, H = 72;
const BUDGET = 1000 / 30;

function yOf(ms, maxY) {
  return (H - 4) - (ms / maxY) * (H - 12);
}

export function createPerfChart(roomId) {
  const wrap = document.createElement('div');
  wrap.className = 'perf-chart-wrap';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-label', roomId + ' frame time');
  svg.classList.add('perf-chart');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', W); bg.setAttribute('height', H);
  bg.setAttribute('fill', '#f0f4fa');
  const budget = document.createElementNS(SVG_NS, 'line');
  budget.setAttribute('x1', 0); budget.setAttribute('x2', W);
  budget.setAttribute('stroke', '#c5d0de'); budget.setAttribute('stroke-width', '1');
  const lines = document.createElementNS(SVG_NS, 'g');
  lines.setAttribute('fill', 'none');
  lines.setAttribute('stroke', '#1565c0');
  lines.setAttribute('stroke-width', '1.25');
  const empty = document.createElementNS(SVG_NS, 'text');
  empty.setAttribute('x', 8); empty.setAttribute('y', H / 2 + 4);
  empty.setAttribute('fill', '#8a96a8');
  empty.setAttribute('font-size', '11');
  empty.setAttribute('font-family', 'system-ui,sans-serif');
  const mkLabel = (x, y, anchor = 'start') => {
    const el = document.createElementNS(SVG_NS, 'text');
    el.setAttribute('x', x); el.setAttribute('y', y);
    el.setAttribute('fill', '#8a96a8');
    el.setAttribute('font-size', '10');
    el.setAttribute('font-family', 'system-ui,sans-serif');
    el.setAttribute('text-anchor', anchor);
    return el;
  };
  const labMax = mkLabel(4, 12);
  const labMin = mkLabel(4, H - 4);
  const labAge = mkLabel(W - 4, H - 4, 'end');
  svg.append(bg, budget, lines, empty, labMax, labMin, labAge);
  const tip = document.createElement('div');
  tip.className = 'perf-tip';
  wrap.append(svg, tip);

  const model = { times: [], maxY: BUDGET * 1.2, sampleHz: 30 };

  const hover = bindSvgChartHover(svg, tip, (sx) => {
    const times = model.times;
    const n = times.length;
    if (n < 1) return null;
    const i = xToIndex(sx, n, W);
    const v = times[i];
    if (!Number.isFinite(v)) return null;
    const age = model.sampleHz > 0 ? (n - 1 - i) / model.sampleHz : (n - 1 - i);
    return {
      x: indexToX(i, n, W),
      y: yOf(Math.min(v, model.maxY), model.maxY),
      color: '#1565c0',
      text: `${v.toFixed(1)} ms · ${agoLabel(age)}`,
    };
  });

  function draw(room) {
    const times = room.times || [];
    model.times = times;
    model.sampleHz = room.sampleHz || 30;
    const maxY = Math.max(BUDGET * 1.2, ...times, 1);
    model.maxY = maxY;
    const yb = yOf(BUDGET, maxY);
    budget.setAttribute('y1', yb); budget.setAttribute('y2', yb);
    labMax.textContent = Math.round(maxY) + ' ms';
    labMin.textContent = '0';
    labAge.textContent = '−' + (room.windowS || 180) + 's';
    lines.textContent = '';
    if (times.length < 2) {
      empty.textContent = times.length ? '1 sample' : 'No samples yet (room idle)';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    const pts = [];
    let cur = [];
    const n = times.length;
    for (let i = 0; i < n; i++) {
      const v = times[i];
      if (!Number.isFinite(v)) {
        if (cur.length > 1) pts.push(cur.join(' '));
        cur = [];
        continue;
      }
      cur.push(indexToX(i, n, W).toFixed(1) + ',' + yOf(Math.min(v, maxY), maxY).toFixed(1));
    }
    if (cur.length > 1) pts.push(cur.join(' '));
    for (const p of pts) {
      const pl = document.createElementNS(SVG_NS, 'polyline');
      pl.setAttribute('points', p);
      lines.appendChild(pl);
    }
  }

  return { el: wrap, draw, destroy() { hover.destroy(); } };
}

if (typeof window !== 'undefined') window.LandingPerfCharts = { createPerfChart };
