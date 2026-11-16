// Chart mode hover (instrument panel): a mouse over a strip shows a vertical
// crosshair at the nearest sample on every strip (they share one time axis),
// a dot on each line there, and a tooltip with the hovered strip's values
// and the sample's age ("BSP 2.1 · VMG 1.4 m/s · 12.4s ago"). The tooltip is
// placed inside the panel (above the strip, else below, clamped to the
// panel's box). Mouse leave hides it. Touch: press and hold a strip
// (HOLD_MS without moving) to show it, drag to scrub; a quick swipe still
// scrolls the strips, release hides it. Values: instrument-chart.js
// chartHoverAt; refresh() repaints under a still pointer after a redraw.
import { SVG_NS } from './svg-chart.js';

export const HOLD_MS = 300;
const HOLD_SLOP_PX = 8;

// strips: [{ st, svg, row }]; hitAt(st, x) → chartHoverAt result or null.
// w: the strips' viewBox width.
export function bindChartHover({ root, chartsEl, strips, hitAt, w, doc = document, win = typeof window !== 'undefined' ? window : null }) {
  const tip = doc.createElement('div');
  tip.className = 'instr-tip';
  tip.setAttribute('role', 'status');
  root.appendChild(tip);
  for (const s of strips) {
    const g = doc.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'instr-hover');
    g.style.display = 'none';
    const line = doc.createElementNS(SVG_NS, 'line');
    line.setAttribute('y1', '0'); line.setAttribute('y2', '1000');
    line.setAttribute('stroke', 'rgba(255,255,255,0.7)'); line.setAttribute('stroke-width', '1');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    g.appendChild(line);
    // dots: zero-length round-capped lines stay round under preserveAspectRatio="none"
    const dots = s.st.lines.map((l) => {
      const d = doc.createElementNS(SVG_NS, 'line');
      d.setAttribute('stroke', l.color); d.setAttribute('stroke-width', '6'); d.setAttribute('stroke-linecap', 'round');
      d.setAttribute('vector-effect', 'non-scaling-stroke');
      g.appendChild(d);
      return d;
    });
    s.svg.appendChild(g);
    s.hover = { g, line, dots };
  }

  let active = -1, lastX = null, holding = false, holdTimer = null, start = null;
  const stripAt = (target) => {
    const row = target && target.closest ? target.closest('.instr-strip') : null;
    return row ? strips.findIndex((s) => s.row === row) : -1;
  };
  const hide = () => {
    active = -1; lastX = null;
    for (const s of strips) s.hover.g.style.display = 'none';
    tip.classList.remove('on');
  };
  const paint = (k, clientX) => {
    const s = strips[k];
    const rect = s.svg.getBoundingClientRect();
    if (!(rect.width > 0)) { hide(); return; }
    const hit = hitAt(s.st, ((clientX - rect.left) / rect.width) * w);
    if (!hit) { hide(); return; }
    active = k; lastX = clientX;
    for (const o of strips) {
      const h = o === s ? hit : hitAt(o.st, hit.x);
      const { g, line, dots } = o.hover;
      if (!h) { g.style.display = 'none'; continue; }
      line.setAttribute('x1', h.x); line.setAttribute('x2', h.x);
      h.values.forEach((p, j) => {
        const d = dots[j];
        if (!d) return;
        d.style.display = Number.isFinite(p.y) ? '' : 'none';
        d.setAttribute('x1', h.x); d.setAttribute('x2', h.x);
        d.setAttribute('y1', Number.isFinite(p.y) ? p.y : 0); d.setAttribute('y2', Number.isFinite(p.y) ? p.y : 0);
      });
      g.style.display = '';
    }
    tip.textContent = hit.text;
    tip.classList.add('on');
    const box = root.getBoundingClientRect();
    const tw = tip.offsetWidth || 0, th = tip.offsetHeight || 0;
    const pos = tipPosition({ box, strip: rect, clientX, tw, th });
    tip.style.left = pos.left + 'px';
    tip.style.top = pos.top + 'px';
  };

  chartsEl.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      if (holding) { const k = active >= 0 ? active : stripAt(e.target); if (k >= 0) paint(k, e.clientX); return; }
      if (holdTimer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > HOLD_SLOP_PX) { clearTimeout(holdTimer); holdTimer = null; }
      return;
    }
    const k = stripAt(e.target);
    if (k < 0) hide(); else paint(k, e.clientX);
  });
  chartsEl.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') hide(); });
  chartsEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const k = stripAt(e.target);
    if (k < 0) return;
    start = { x: e.clientX, y: e.clientY };
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { holdTimer = null; holding = true; paint(k, start.x); }, HOLD_MS);
  });
  const endTouch = (e) => {
    if (e.pointerType !== 'touch') return;
    clearTimeout(holdTimer); holdTimer = null;
    if (holding) { holding = false; hide(); }
  };
  chartsEl.addEventListener('pointerup', endTouch);
  chartsEl.addEventListener('pointercancel', endTouch);
  // While holding, a drag scrubs instead of scrolling the strips.
  chartsEl.addEventListener('touchmove', (e) => { if (holding && e.cancelable) e.preventDefault(); }, { passive: false });
  chartsEl.addEventListener('contextmenu', (e) => { if (holding) e.preventDefault(); });

  return {
    tip,
    hide,
    isActive: () => active >= 0,
    // repaint at the last pointer x (after the strips redraw); off unless hovering
    refresh() { if (active >= 0 && lastX !== null) paint(active, lastX); },
  };
}

// Tooltip box (px, relative to the panel): centred on the pointer, above the
// strip if it fits, else below it, always inside the panel.
export function tipPosition({ box, strip, clientX, tw, th, pad = 4 }) {
  const maxLeft = Math.max(pad, box.width - tw - pad);
  const left = Math.max(pad, Math.min(maxLeft, clientX - box.left - tw / 2));
  let top = strip.top - box.top - th - 2;
  if (top < pad) top = strip.bottom - box.top + 2;
  if (top + th > box.height - pad) top = Math.max(pad, box.height - th - pad);
  return { left: Math.round(left), top: Math.round(top) };
}
