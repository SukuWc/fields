// Instrument panel, Chart mode (UI overhaul PR 6): rolling strip-chart data
// for the instrument boat, no DOM. Values come from readoutValues() (frame
// state only, own boat by id), sampled on sim time (state.ts) at 5 Hz.
// A value the frame does not carry is NaN (a gap in the line); a jump in sim
// time (pause, reconnect) also leaves a gap; time going backwards clears.
// Drawn with the shared boat-stats chart helpers (polylinePoints, seriesRange).
import { polylinePoints, seriesRange } from './boat-stats.js';

export const CHART_SAMPLE_HZ = 5;
export const CHART_WINDOWS = [30, 60, 120];
export const CHART_DEFAULT_WINDOW = 60;
export const CHART_KEYS = ['bs', 'vmg', 'twa', 'twd', 'heading'];
// One strip per entry; lines drawn in order. Colours avoid green/red
// (reserved for starboard / port).
export const CHART_STRIPS = [
  { key: 'speed', label: 'BSP / VMG', unit: 'm/s', min: null, max: null, lines: [{ key: 'bs', color: '#ffffff' }, { key: 'vmg', color: '#ffc400' }] },
  { key: 'twa', label: 'TWA', unit: '°', min: -180, max: 180, wrap: true, lines: [{ key: 'twa', color: '#7fd3ff' }] },
  { key: 'twd', label: 'TWD', unit: '°', min: 0, max: 360, wrap: true, lines: [{ key: 'twd', color: '#c9b6ff' }] },
  { key: 'heading', label: 'HDG', unit: '°', min: -180, max: 180, wrap: true, lines: [{ key: 'heading', color: '#ffffff' }] },
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

// Polylines for one strip: { lo, hi, lines: [{ color, pts: [string] }] }.
export function stripPolylines(buf, strip, { windowS, w, h }) {
  const t1 = buf.t.length ? buf.t[buf.t.length - 1] : 0;
  const i0 = buf.t.findIndex((t) => t >= t1 - windowS);
  const t = i0 < 0 ? [] : buf.t.slice(i0);
  const arrs = strip.lines.map((l) => (i0 < 0 ? [] : buf[l.key].slice(i0)));
  const [lo, hi] = seriesRange(strip, arrs);
  return {
    lo, hi,
    lines: strip.lines.map((l, j) => ({ key: l.key, color: l.color, pts: polylinePoints(t, arrs[j], { t1, windowS, lo, hi, w, h, wrap: !!strip.wrap }) })),
  };
}
