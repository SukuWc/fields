// Instrument panel (zone C, #hud_instruments; UI overhaul PR 5): a mode
// selector Readout | Chart | Instrument. Readout (PR 5) and Chart (PR 6)
// modes; Instrument mode is disabled ("coming later").
// The mode is remembered in this browser (localStorage 'fields.instrumentMode').
// The chart window (30 / 60 / 120 s) is remembered too ('fields.instrumentChartWindow').
// Values: instrument-readout.js (frame state only, own boat by id); chart
// buffers: instrument-chart.js, sampled at 5 Hz of sim time (state.ts).
import { READOUT_TILES, readoutValues, formatReadout } from './instrument-readout.js';
import { ChartBuffer, CHART_STRIPS, CHART_WINDOWS, CHART_DEFAULT_WINDOW, stripPolylines } from './instrument-chart.js';
import { SVG_NS } from './svg-chart.js';

const STORE_KEY = 'fields.instrumentMode';
const MODES = ['readout', 'chart', 'instrument'];
const ENABLED = new Set(['readout', 'chart']);
const WIN_KEY = 'fields.instrumentChartWindow';
const SW = 300, SH = 34;
const UPDATE_MS = 200;

export function setupInstrumentPanel({ remote = false, lockstep = () => false } = {}, doc = document) {
  const root = doc.getElementById('instrument_panel');
  if (!root) return { onFrame() {}, setOwnId() {} };
  const buttons = Array.from(root.querySelectorAll('.instr-mode'));
  const tiles = new Map();
  const grid = root.querySelector('.instr-tiles');
  for (const t of READOUT_TILES) {
    const el = doc.createElement('div');
    el.className = 'instr-tile';
    el.dataset.key = t.key;
    el.innerHTML = `<span class="instr-label">${t.label}</span><span class="instr-value">–</span><span class="instr-unit">${t.unit}</span>`;
    if (t.key === 'next') el.title = 'Distance to the next mark as the leaderboard counts it (beats as sailed distance)';
    if (t.key === 'fin') el.title = 'Distance to the finish (dash on a looping course)';
    grid.appendChild(el);
    tiles.set(t.key, { el, value: el.querySelector('.instr-value'), unit: el.querySelector('.instr-unit') });
  }
  const note = root.querySelector('.instr-note');
  // Chart mode: one strip per CHART_STRIPS entry
  const chartsEl = root.querySelector('.instr-charts');
  const winSel = root.querySelector('.instr-window');
  let windowS = CHART_DEFAULT_WINDOW;
  try { const w = Number(localStorage.getItem(WIN_KEY)); if (CHART_WINDOWS.includes(w)) windowS = w; } catch { /* no storage */ }
  if (winSel) {
    winSel.value = String(windowS);
    winSel.addEventListener('change', () => {
      const w = Number(winSel.value);
      if (!CHART_WINDOWS.includes(w)) return;
      windowS = w;
      try { localStorage.setItem(WIN_KEY, String(w)); } catch { /* no storage */ }
      drawCharts();
    });
  }
  const strips = [];
  if (chartsEl) for (const st of CHART_STRIPS) {
    const row = doc.createElement('div');
    row.className = 'instr-strip';
    row.dataset.key = st.key;
    const lab = doc.createElement('div');
    lab.className = 'instr-strip-label';
    lab.innerHTML = `<span class="instr-label">${st.label}</span><span class="instr-strip-now"></span><span class="instr-strip-range"></span>`;
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${SW} ${SH}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add('instr-strip-svg');
    const zero = doc.createElementNS(SVG_NS, 'line');
    zero.setAttribute('x1', 0); zero.setAttribute('x2', SW);
    zero.setAttribute('stroke', 'rgba(255,255,255,0.2)'); zero.setAttribute('stroke-width', '1');
    zero.setAttribute('vector-effect', 'non-scaling-stroke');
    const g = doc.createElementNS(SVG_NS, 'g');
    svg.append(zero, g);
    row.append(lab, svg);
    chartsEl.appendChild(row);
    strips.push({ st, g, zero, now: lab.querySelector('.instr-strip-now'), range: lab.querySelector('.instr-strip-range') });
  }
  const buf = new ChartBuffer({ windowS: Math.max(...CHART_WINDOWS) });
  const fmt = (st, k, v) => (Number.isFinite(v) ? (st.unit === 'm/s' ? v.toFixed(1) : String(Math.round(v))) : '–');
  const drawCharts = () => {
    if (root.dataset.mode !== 'chart') return;
    for (const s of strips) {
      const p = stripPolylines(buf, s.st, { windowS, w: SW, h: SH });
      const zv = s.st.min === 0 && s.st.max === 360 ? 180 : 0;
      const zy = p.hi > p.lo ? SH - ((zv - p.lo) / (p.hi - p.lo)) * SH : SH / 2;
      s.zero.setAttribute('y1', zy); s.zero.setAttribute('y2', zy);
      s.g.textContent = '';
      for (const l of p.lines) for (const pts of l.pts) {
        const pl = doc.createElementNS(SVG_NS, 'polyline');
        pl.setAttribute('points', pts);
        pl.setAttribute('fill', 'none');
        pl.setAttribute('stroke', l.color);
        pl.setAttribute('stroke-width', '1.5');
        pl.setAttribute('vector-effect', 'non-scaling-stroke');
        s.g.appendChild(pl);
      }
      s.now.innerHTML = s.st.lines.map((l) => `<span style="color:${l.color}">${fmt(s.st, l.key, buf.last(l.key))}</span>`).join(' / ') + ` <span class="instr-unit">${s.st.unit}</span>`;
      s.range.textContent = `${fmt(s.st, '', p.lo)}…${fmt(s.st, '', p.hi)} · ${windowS} s`;
    }
  };
  const select = (mode, remember) => {
    if (!ENABLED.has(mode)) mode = 'readout';
    root.dataset.mode = mode;
    for (const b of buttons) b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false');
    if (remember) { try { localStorage.setItem(STORE_KEY, mode); } catch { /* no storage */ } }
    if (typeof drawCharts === 'function') drawCharts();
  };
  for (const b of buttons) b.addEventListener('click', () => { if (!b.disabled) select(b.dataset.mode, true); });
  let stored = null;
  try { stored = localStorage.getItem(STORE_KEY); } catch { /* no storage */ }
  select(MODES.includes(stored) ? stored : 'readout', false);

  let ownId = null;
  let last = 0;
  let lastState = null;
  let lastV = null;
  const render = () => {
    const v = lastV = readoutValues(lastState, { ownId, remote, lockstep: lockstep() });
    root.classList.toggle('no-boat', !v);
    if (note) note.textContent = v ? '' : (remote ? 'Spectating: join to see your instruments' : 'No boat');
    for (const t of READOUT_TILES) {
      const tile = tiles.get(t.key);
      const val = v ? v[t.key] : null;
      tile.value.textContent = formatReadout(t.key, val);
      tile.el.classList.toggle('missing', val === null || val === undefined);
      if (t.key === 'next') tile.unit.textContent = v && v.nextLabel ? (val !== null ? 'm · ' : '') + v.nextLabel : 'm';
    }
  };
  render();
  return {
    setOwnId(id) { ownId = id || null; buf.clear(); render(); drawCharts(); },
    onFrame(state) {
      lastState = state;
      // chart samples on sim time, every frame offered, kept at 5 Hz
      const tS = state && Number.isFinite(state.ts) ? state.ts : performance.now() / 1000;
      const v = readoutValues(state, { ownId, remote, lockstep: lockstep() });
      if (buf.add(tS, v)) drawCharts();
      const now = performance.now();
      if (now - last < UPDATE_MS) return;
      last = now;
      render();
    },
  };
}
