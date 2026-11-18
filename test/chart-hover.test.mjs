// Chart mode hover (instrument-chart.js chartHoverAt, instrument-chart-hover.js):
// nearest sample under the pointer, values and labels as the strip shows them,
// tooltip kept inside the panel, mouse / touch handling on a stand-in DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ChartBuffer, CHART_STRIPS, chartHoverAt, formatChartValue } from '../src/instrument-chart.js';
import { bindChartHover, tipPosition, HOLD_MS, HOLD_SLOP_PX, LINGER_MS } from '../src/instrument-chart-hover.js';

const strip = (k) => CHART_STRIPS.find((s) => s.key === k);
const sample = (i) => ({ boatId: 'b', bs: i / 10, vmg: 1, tws: 4, aws: NaN, twa: -40, twd: 90.4, heading: 359.6 });

function filled(n = 100) { // 20 s at 5 Hz, t = 0..19.8
  const b = new ChartBuffer();
  for (let i = 0; i < n; i++) b.add(i * 0.2, sample(i));
  return b;
}

test('chartHoverAt: nearest sample in the shown window, x of that sample, age', () => {
  const b = filled();
  const opts = { windowS: 20, w: 300, h: 34 };
  const right = chartHoverAt(b, strip('speed'), { ...opts, x: 300 });
  assert.equal(right.i, 99);
  assert.equal(right.age, 0);
  assert.ok(Math.abs(right.x - 300) < 1e-9);
  const left = chartHoverAt(b, strip('speed'), { ...opts, x: 0 });
  assert.equal(left.i, 0, 'oldest sample inside [t1 − 20 s, t1]');
  assert.equal(chartHoverAt(b, strip('speed'), { windowS: 19, w: 300, h: 34, x: 0 }).i, 5, 'samples before the window are skipped');
  const mid = chartHoverAt(b, strip('speed'), { ...opts, x: 150 });
  assert.ok(Math.abs(mid.t - 9.8) < 0.11, String(mid.t));
  assert.ok(Math.abs(mid.age - 10) < 0.11);
  // pointer outside the svg clamps to the ends
  assert.equal(chartHoverAt(b, strip('speed'), { ...opts, x: 999 }).i, 99);
  // 60 s window, only 20 s of data on the right: the left part snaps to the oldest sample
  assert.equal(chartHoverAt(b, strip('speed'), { windowS: 60, w: 300, h: 34, x: 10 }).i, 0);
});

test('chartHoverAt: per-line values, labels, colours and y; text matches the strip units', () => {
  const b = filled();
  const h = chartHoverAt(b, strip('speed'), { windowS: 20, w: 300, h: 34, x: 300 });
  assert.deepEqual(h.values.map((v) => v.label), ['BSP', 'VMG']);
  assert.deepEqual(h.values.map((v) => v.color), ['#ffffff', '#ffc400']);
  assert.ok(Math.abs(h.values[0].v - 9.9) < 1e-9);
  assert.equal(h.text, 'BSP 9.9 · VMG 1.0 m/s · now');
  assert.ok(h.values.every((v) => v.y >= 0 && v.y <= 34));
  const wind = chartHoverAt(b, strip('wind'), { windowS: 20, w: 300, h: 34, x: 150 });
  assert.match(wind.text, /^TWS 4\.0 · AWS – · ROOM WS – m\/s · 10\.0s ago$/);
  assert.ok(Number.isNaN(wind.values[1].y), 'missing value: no dot');
  assert.equal(chartHoverAt(b, strip('heading'), { windowS: 20, w: 300, h: 34, x: 300 }).text, 'HDG 360 ° · now');
  assert.equal(formatChartValue(strip('twa'), -40.4), '-40');
});

test('chartHoverAt: empty buffer gives nothing', () => {
  assert.equal(chartHoverAt(new ChartBuffer(), strip('speed'), { windowS: 60, w: 300, h: 34, x: 100 }), null);
});

test('tipPosition: above the strip, else below, always inside the panel', () => {
  const box = { left: 100, top: 500, width: 600, height: 150 };
  // room above
  assert.deepEqual(tipPosition({ box, strip: { top: 600, bottom: 630 }, clientX: 400, tw: 120, th: 20 }), { left: 240, top: 78 });
  // pointer near the left / right edges: clamped
  assert.equal(tipPosition({ box, strip: { top: 600, bottom: 630 }, clientX: 101, tw: 120, th: 20 }).left, 4);
  assert.equal(tipPosition({ box, strip: { top: 600, bottom: 630 }, clientX: 699, tw: 120, th: 20 }).left, 476);
  // no room above: below the strip
  assert.equal(tipPosition({ box, strip: { top: 510, bottom: 540 }, clientX: 400, tw: 120, th: 20 }).top, 42);
  // no room either way: clamped to the bottom edge
  const p = tipPosition({ box: { left: 0, top: 0, width: 300, height: 60 }, strip: { top: 10, bottom: 50 }, clientX: 150, tw: 100, th: 20 });
  assert.ok(p.top >= 4 && p.top + 20 <= 56, JSON.stringify(p));
});

// Stand-in DOM for bindChartHover.
function el(tag, extra = {}) {
  const listeners = {};
  const classes = new Set();
  const attrs = {};
  const kids = [];
  const node = {
    tag, style: {}, textContent: '', offsetWidth: 120, offsetHeight: 20, kids,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: (k) => attrs[k] ?? null,
    appendChild(c) { kids.push(c); c.parent = node; return c; },
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    fire(t, e) { for (const fn of listeners[t] || []) fn({ type: t, preventDefault() { this.prevented = true; }, cancelable: true, ...e }); },
    closest(sel) { let n = node; while (n) { if (sel === '.instr-strip' && n.isRow) return n; n = n.parent; } return null; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    ...extra,
  };
  return node;
}
function harness() {
  const doc = { createElement: (t) => el(t), createElementNS: (ns, t) => el(t) };
  const root = el('section', { getBoundingClientRect: () => ({ left: 0, top: 500, width: 600, height: 150, right: 600, bottom: 650 }) });
  const chartsEl = el('div');
  const strips = ['speed', 'wind'].map((k, j) => {
    const row = el('div', { isRow: true });
    const svg = el('svg', { getBoundingClientRect: () => ({ left: j * 300, top: 600, width: 300, height: 30, right: j * 300 + 300, bottom: 630 }) });
    row.appendChild(svg);
    chartsEl.appendChild(row);
    return { st: strip(k), row, svg };
  });
  const b = filled();
  const hover = bindChartHover({ root, chartsEl, strips, w: 300, doc, hitAt: (st, x) => chartHoverAt(b, st, { windowS: 20, w: 300, h: 34, x }) });
  return { root, chartsEl, strips, hover };
}

test('bindChartHover: mouse move shows the crosshair on every strip and the tooltip; leave hides', () => {
  const h = harness();
  assert.equal(h.hover.tip.classList.contains('on'), false);
  h.chartsEl.fire('pointermove', { pointerType: 'mouse', clientX: 150, clientY: 610, target: h.strips[0].svg });
  assert.ok(h.hover.tip.classList.contains('on'));
  assert.match(h.hover.tip.textContent, /^BSP \d\.\d · VMG 1\.0 m\/s · 10\.0s ago$/);
  for (const s of h.strips) assert.equal(s.hover.g.style.display, '', 'crosshair on ' + s.st.key);
  const x = Number(h.strips[1].hover.line.getAttribute('x1'));
  assert.equal(x, Number(h.strips[0].hover.line.getAttribute('x1')), 'same sample on both strips');
  assert.equal(h.strips[1].hover.dots[1].style.display, 'none', 'AWS missing: no dot');
  assert.equal(h.hover.tip.style.top, '78px');
  h.chartsEl.fire('pointerleave', { pointerType: 'mouse' });
  assert.equal(h.hover.tip.classList.contains('on'), false);
  assert.ok(h.strips.every((s) => s.hover.g.style.display === 'none'));
});

const touch = (target, x, y = 610, id = 1) => ({ target, touches: [{ identifier: id, clientX: x, clientY: y }], changedTouches: [{ identifier: id, clientX: x, clientY: y }] });
const lift = (target, x, id = 1) => ({ target, touches: [], changedTouches: [{ identifier: id, clientX: x, clientY: 610 }] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('touch: a swipe (moved past the slop before the hold) scrolls, no tooltip', async () => {
  const h = harness();
  const svg = h.strips[0].svg;
  h.chartsEl.fire('touchstart', touch(svg, 100));
  let prevented = false;
  h.chartsEl.fire('touchmove', { ...touch(svg, 100 + HOLD_SLOP_PX + 5), preventDefault() { prevented = true; } });
  await wait(HOLD_MS + 50);
  assert.equal(h.hover.tip.classList.contains('on'), false);
  assert.equal(prevented, false, 'the swipe is left to the browser');
  h.chartsEl.fire('touchend', lift(svg, 115));
});

test('touch: press and hold within the slop shows it; drag scrubs (no scroll); release lingers then hides', async () => {
  const h = harness();
  const svg = h.strips[0].svg;
  h.chartsEl.fire('touchstart', touch(svg, 100));
  h.chartsEl.fire('touchmove', touch(svg, 100 + HOLD_SLOP_PX - 2)); // finger jitter
  await wait(HOLD_MS + 50);
  assert.ok(h.hover.tip.classList.contains('on'), 'hold shows the tooltip');
  let prevented = false;
  h.chartsEl.fire('touchmove', { ...touch(svg, 300), preventDefault() { prevented = true; } });
  assert.ok(prevented, 'drag scrubs instead of scrolling while held');
  assert.match(h.hover.tip.textContent, /now$/);
  // the browser's own touch pointer stream may be cancelled: ignored now
  h.chartsEl.fire('pointercancel', { pointerType: 'touch' });
  assert.ok(h.hover.tip.classList.contains('on'), 'pointercancel does not kill the hold');
  // long-press context menu: cancelled, the hold stays
  let menu = false;
  h.chartsEl.fire('contextmenu', { target: svg, preventDefault() { menu = true; } });
  assert.ok(menu && h.hover.tip.classList.contains('on'));
  h.chartsEl.fire('touchend', lift(svg, 300));
  assert.ok(h.hover.tip.classList.contains('on'), 'still readable right after lifting the finger');
  await wait(LINGER_MS + 50);
  assert.equal(h.hover.tip.classList.contains('on'), false);
});

test('touch: the browser long-press (contextmenu) starts the hold before the timer', () => {
  const h = harness();
  const svg = h.strips[1].svg;
  h.chartsEl.fire('touchstart', touch(svg, 450));
  let menu = false;
  h.chartsEl.fire('contextmenu', { target: svg, preventDefault() { menu = true; } });
  assert.ok(menu, 'no native menu / callout');
  assert.ok(h.hover.tip.classList.contains('on'));
  assert.match(h.hover.tip.textContent, /^TWS/);
  h.chartsEl.fire('touchcancel', lift(svg, 450));
  assert.ok(h.hover.tip.classList.contains('on'), 'touchcancel lingers like a release');
});

test('touch: a touchcancel before the hold (browser took the gesture) shows nothing', async () => {
  const h = harness();
  const svg = h.strips[0].svg;
  h.chartsEl.fire('touchstart', touch(svg, 100));
  h.chartsEl.fire('touchcancel', lift(svg, 100));
  await wait(HOLD_MS + 50);
  assert.equal(h.hover.tip.classList.contains('on'), false);
});

test('touch: no long-press callout or selection on the strips (CSS)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /#instrument_panel \.instr-charts \{ -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;/);
  assert.ok(HOLD_MS <= 300 && HOLD_SLOP_PX >= 8);
});

test('panel wires the hover and the tooltip CSS stays inside the panel', () => {
  const js = readFileSync(new URL('../src/instrument-panel.js', import.meta.url), 'utf8');
  assert.match(js, /bindChartHover\(/);
  assert.match(js, /hover\.refresh\(\)/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /#instrument_panel \.instr-tip \{\n\s*display: none; position: absolute;/);
  assert.match(html, /#instrument_panel\[data-mode="chart"\] \.instr-tip\.on \{ display: block; \}/);
});
