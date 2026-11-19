// Instrument panel, Chart mode (UI overhaul PR 6): rolling strip-chart data
// for the instrument boat, no DOM. Values come from readoutValues() (frame
// state only, own boat by id), sampled on sim time (state.ts) at 5 Hz.
// A value the frame does not carry is NaN (a gap in the line); a jump in sim
// time (pause, reconnect) also leaves a gap; time going backwards clears.
// Drawn with the shared chart helpers (boat-stats.js polylinePoints,
// seriesRange). chartHoverAt: the sample under the pointer for the hover
// crosshair and tooltip (instrument-panel.js).
//
// Room wind (state.rw, instrument-readout.js roomWindValues) has two strips
// of its own, one line each: ROOM WD and ROOM WS (charted without a boat too).
// TWD and ROOM WD are circular strips: values are unwrapped around the
// circular mean of the shown window (each to mean ± 180°), the range fits them
// (at least CIRC_MIN_SPAN wide, in 5° steps), so a few degrees of shift is
// visible and a wind around north does not jump 0↔360. Labels wrap back to
// 0–359 (TWD) or, for ROOM WD (signed: true), to a signed angle in
// (−180, 180]: 359° reads −1° (instrument-readout.js signedDeg).
import { polylinePoints, seriesRange } from './boat-stats.js';
import { signedDeg } from './instrument-readout.js';
import { agoLabel, nearestTimeIndex, timeToX, valueToY } from './svg-chart.js';

export const CHART_SAMPLE_HZ = 5;
export const CHART_WINDOWS = [30, 60, 120];
export const CHART_DEFAULT_WINDOW = 60;
export const CHART_KEYS = ['bs', 'vmg', 'tws', 'aws', 'twa', 'twd', 'heading', 'rwd', 'rws'];
export const CIRC_MIN_SPAN = 20;
// One strip per entry; lines drawn in order. Colours avoid green/red
// (reserved for starboard / port). The order pairs strips in the phone's
// two-row, column-first grid: BSP over TWA, TWS / AWS over ROOM WS, TWD over
// ROOM WD, then HDG.
export const CHART_STRIPS = [
  { key: 'speed', label: 'BSP / VMG', unit: 'm/s', min: null, max: null, lines: [{ key: 'bs', label: 'BSP', color: '#ffffff' }, { key: 'vmg', label: 'VMG', color: '#ffc400' }] },
  { key: 'twa', label: 'TWA', unit: '°', min: -180, max: 180, wrap: true, lines: [{ key: 'twa', label: 'TWA', color: '#ffffff' }] },
  { key: 'wind', label: 'TWS / AWS', unit: 'm/s', min: 0, max: null, lines: [{ key: 'tws', label: 'TWS', color: '#7fd3ff' }, { key: 'aws', label: 'AWS', color: '#ffc400' }] },
  { key: 'rws', label: 'ROOM WS', unit: 'm/s', min: 0, max: null, room: true, lines: [{ key: 'rws', label: 'ROOM WS', color: '#ff9de2' }] },
  { key: 'twd', label: 'TWD', unit: '°', min: 0, max: 360, wrap: true, circular: true, lines: [{ key: 'twd', label: 'TWD', color: '#c9b6ff' }] },
  { key: 'rwd', label: 'ROOM WD', unit: '°', min: -180, max: 180, wrap: true, circular: true, signed: true, room: true, lines: [{ key: 'rwd', label: 'ROOM WD', color: '#ff9de2' }] },
  { key: 'heading', label: 'HDG', unit: '°', min: 0, max: 360, wrap: true, lines: [{ key: 'heading', label: 'HDG', color: '#ffffff' }] },
];

const num = (v) => (Number.isFinite(v) ? v : NaN);

export class ChartBuffer {
  constructor({ windowS = 120, sampleHz = CHART_SAMPLE_HZ } = {}) {
    this.windowS = windowS;
    this.minDt = 1 / sampleHz;
    this.clear();
  }
  clear() { this.t = []; for (const k of CHART_KEYS) this[k] = []; this.lastT = -Infinity; this.boatId = null; }
  // v: readoutValues() result or null. Returns true when a sample was taken.
  add(tS, v) {
    if (!Number.isFinite(tS)) return false;
    if (tS < this.lastT) this.clear();
    if (v && this.boatId !== null && v.boatId !== this.boatId) this.clear();
    if (tS - this.lastT < this.minDt - 1e-9) return false;
    // time jump: a NaN sample so the line breaks
    if (this.t.length && tS - this.lastT > 3 * this.minDt) this.push(this.lastT + this.minDt, null);
    this.lastT = tS - this.lastT < 2 * this.minDt ? this.lastT + this.minDt : tS;
    if (v) this.boatId = v.boatId;
    this.push(tS, v);
    let drop = 0;
    while (drop < this.t.length && this.t[drop] < tS - this.windowS) drop++;
    if (drop) { this.t.splice(0, drop); for (const k of CHART_KEYS) this[k].splice(0, drop); }
    return true;
  }
  push(t, v) { this.t.push(t); for (const k of CHART_KEYS) this[k].push(v ? num(v[k]) : NaN); }
  last(k) { const a = this[k]; return a.length ? a[a.length - 1] : NaN; }
}

// One value as the strip shows it: m/s to 0.1, degrees whole (0–359 on a
// circular strip, −179…180 on a signed one); dash if missing.
export function formatChartValue(strip, v) {
  if (!Number.isFinite(v)) return '–';
  if (strip.unit === 'm/s') return v.toFixed(1);
  if (strip.signed) return String(signedDeg(v));
  return String(strip.circular ? Math.round(wrap360(v)) % 360 : Math.round(v));
}

const wrap360 = (d) => ((d % 360) + 360) % 360;
const wrap180 = (d) => wrap360(d + 180) - 180;

// Circular mean (degrees) of the finite values, or NaN.
export function circularMean(arrays) {
  let sx = 0, sy = 0, n = 0;
  for (const a of arrays) for (const v of a) if (Number.isFinite(v)) { const r = v * Math.PI / 180; sx += Math.cos(r); sy += Math.sin(r); n++; }
  return n && Math.hypot(sx, sy) > 1e-9 ? wrap360(Math.atan2(sy, sx) * 180 / Math.PI) : (n ? wrap360(arrays.flat().find(Number.isFinite)) : NaN);
}

// Values and range of a strip for the shown window: { arrs, lo, hi, mid }.
// Circular strips: unwrapped around the circular mean (mid).
function stripScale(strip, raw) {
  if (!strip.circular) { const [lo, hi] = seriesRange(strip, raw); return { arrs: raw, lo, hi, mid: null }; }
  const mid = circularMean(raw);
  if (!Number.isFinite(mid)) return { arrs: raw, lo: 0, hi: 360, mid: 180 };
  const arrs = raw.map((a) => a.map((v) => (Number.isFinite(v) ? mid + wrap180(v - mid) : NaN)));
  let mn = Infinity, mx = -Infinity;
  for (const a of arrs) for (const v of a) if (Number.isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  const half = Math.max(CIRC_MIN_SPAN / 2, (mx - mn) / 2 + 2);
  const c = (mn + mx) / 2;
  return { arrs, lo: Math.floor((c - half) / 5) * 5, hi: Math.ceil((c + half) / 5) * 5, mid };
}

// Samples inside the shown window: { i0, t1 } (i0 = -1 when empty).
function windowStart(buf, windowS) {
  const t1 = buf.t.length ? buf.t[buf.t.length - 1] : 0;
  return { i0: buf.t.findIndex((t) => t >= t1 - windowS), t1 };
}

// Hover lookup: the sample nearest to chart x (0..w, viewBox units) in the
// shown window. null when there are no samples. Returns the sample's x, its
// sim time t, age (s before the newest sample), and per line { key, label,
// color, v, y } (y in 0..h, NaN for a missing value), plus the tooltip text
// "BSP 2.1 · VMG 1.4 m/s · 12.4s ago".
export function chartHoverAt(buf, strip, { windowS, w, h, x }) {
  const { i0, t1 } = windowStart(buf, windowS);
  if (i0 < 0) return null;
  const t = buf.t.slice(i0);
  const tq = (t1 - windowS) + (Math.max(0, Math.min(w, x)) / w) * windowS;
  const j = nearestTimeIndex(t, tq);
  if (j < 0) return null;
  const i = i0 + j;
  const sc = stripScale(strip, strip.lines.map((l) => buf[l.key].slice(i0)));
  const values = strip.lines.map((l, k) => {
    const v = buf[l.key][i];
    const u = sc.arrs[k][j];
    return { key: l.key, label: l.label, color: l.color, v, y: Number.isFinite(u) ? valueToY(u, sc.lo, sc.hi, h) : NaN };
  });
  const age = Math.max(0, t1 - buf.t[i]);
  const text = values.map((p) => `${p.label} ${formatChartValue(strip, p.v)}`).join(' · ') + ` ${strip.unit} · ${agoLabel(age)}`;
  return { i, t: buf.t[i], age, x: timeToX(buf.t[i], t1, windowS, w), values, text };
}

// Polylines for one strip: { lo, hi, mid (circular centre | null), lines:
// [{ key, color, dash, pts: [string] }] }.
export function stripPolylines(buf, strip, { windowS, w, h }) {
  const { i0, t1 } = windowStart(buf, windowS);
  const t = i0 < 0 ? [] : buf.t.slice(i0);
  const sc = stripScale(strip, strip.lines.map((l) => (i0 < 0 ? [] : buf[l.key].slice(i0))));
  const { lo, hi } = sc;
  return {
    lo, hi, mid: sc.mid,
    lines: strip.lines.map((l, j) => ({ key: l.key, color: l.color, dash: l.dash || null, pts: polylinePoints(t, sc.arrs[j], { t1, windowS, lo, hi, w, h, wrap: !!strip.wrap }) })),
  };
}
