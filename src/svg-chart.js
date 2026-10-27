// Shared SVG line-chart helpers (landing frame-time graphs + boat-stats panel).
// DOM-free math lives here; bindSvgChartHover attaches pointer readout.
export const SVG_NS = 'http://www.w3.org/2000/svg';

export function valueToY(v, lo, hi, h) {
  if (!(hi > lo)) return h / 2;
  const clamped = Math.max(lo, Math.min(hi, v));
  return h - ((clamped - lo) / (hi - lo)) * h;
}

// Evenly spaced samples (landing): index 0..n-1 across width w.
export function indexToX(i, n, w) {
  if (n <= 1) return w / 2;
  return (i / (n - 1)) * w;
}

export function xToIndex(x, n, w) {
  if (n <= 0) return -1;
  if (n === 1) return 0;
  return Math.max(0, Math.min(n - 1, Math.round((x / w) * (n - 1))));
}

// Time window [t1 − windowS, t1] across width w (boat-stats).
export function timeToX(t, t1, windowS, w) {
  return ((t - (t1 - windowS)) / windowS) * w;
}

export function xToTime(x, t1, windowS, w) {
  return (t1 - windowS) + (x / w) * windowS;
}

export function nearestTimeIndex(tArr, t) {
  if (!tArr || !tArr.length) return -1;
  let best = 0, bestD = Math.abs(tArr[0] - t);
  for (let i = 1; i < tArr.length; i++) {
    const d = Math.abs(tArr[i] - t);
    if (d < bestD) { best = i; bestD = d; }
  }
  return best;
}

// One continuous polyline from evenly spaced values; NaN starts a new segment.
export function valuesPolylinePoints(values, { lo, hi, w, h }) {
  const out = [];
  let cur = [];
  const n = values.length;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      if (cur.length > 1) out.push(cur.join(' '));
      cur = [];
      continue;
    }
    cur.push(indexToX(i, n, w).toFixed(1) + ',' + valueToY(v, lo, hi, h).toFixed(1));
  }
  if (cur.length > 1) out.push(cur.join(' '));
  return out;
}

export function agoLabel(ageS) {
  if (!(ageS >= 0)) return '';
  if (ageS < 0.05) return 'now';
  if (ageS < 1) return ageS.toFixed(2) + 's ago';
  if (ageS < 60) return ageS.toFixed(1) + 's ago';
  return (ageS / 60).toFixed(1) + 'm ago';
}

// tipEl: absolutely positioned HTMLElement next to the svg (or null to skip).
// getHit(svgX, svgY) → null | { x, y, text } in SVG user units + tip string.
export function bindSvgChartHover(svg, tipEl, getHit) {
  const guide = document.createElementNS(SVG_NS, 'line');
  guide.setAttribute('stroke', 'currentColor');
  guide.setAttribute('stroke-opacity', '0.45');
  guide.setAttribute('stroke-width', '1');
  guide.style.display = 'none';
  const mark = document.createElementNS(SVG_NS, 'circle');
  mark.setAttribute('r', '3.5');
  mark.setAttribute('fill', '#1565c0');
  mark.setAttribute('stroke', '#fff');
  mark.setAttribute('stroke-width', '1.5');
  mark.style.display = 'none';
  const overlay = document.createElementNS(SVG_NS, 'g');
  overlay.classList.add('svg-chart-hover');
  overlay.append(guide, mark);
  svg.appendChild(overlay);

  const toSvgX = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const w = vb && vb.width ? vb.width : (svg.width.baseVal.value || rect.width);
    return ((clientX - rect.left) / rect.width) * w;
  };

  const clear = () => {
    guide.style.display = 'none';
    mark.style.display = 'none';
    if (tipEl) tipEl.classList.remove('on');
  };

  const onMove = (e) => {
    const hit = getHit(toSvgX(e.clientX));
    if (!hit) { clear(); return; }
    const vb = svg.viewBox.baseVal;
    const h = vb && vb.height ? vb.height : (svg.height.baseVal.value || 54);
    guide.setAttribute('x1', hit.x); guide.setAttribute('x2', hit.x);
    guide.setAttribute('y1', 0); guide.setAttribute('y2', h);
    guide.style.display = '';
    if (Number.isFinite(hit.y)) {
      mark.setAttribute('cx', hit.x); mark.setAttribute('cy', hit.y);
      mark.style.display = '';
      if (hit.color) mark.setAttribute('fill', hit.color);
    } else mark.style.display = 'none';
    if (tipEl) {
      tipEl.textContent = hit.text;
      const rect = svg.getBoundingClientRect();
      const parent = tipEl.offsetParent || tipEl.parentElement;
      const pref = parent ? parent.getBoundingClientRect() : rect;
      tipEl.style.left = (e.clientX - pref.left) + 'px';
      tipEl.style.top = (rect.top - pref.top) + 'px';
      tipEl.classList.add('on');
    }
  };

  svg.addEventListener('mousemove', onMove);
  svg.addEventListener('mouseleave', clear);
  svg.style.cursor = 'crosshair';
  return { clear, overlay, destroy() {
    svg.removeEventListener('mousemove', onMove);
    svg.removeEventListener('mouseleave', clear);
    overlay.remove();
    clear();
  } };
}
