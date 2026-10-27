// Boat stats data (no DOM): per-boat rolling time series of hull heading,
// TWA, AWA and boat speed, built only from the compact scene state the client
// already receives (state.boats[i]: id, ha, vx, vy, awa, wd). Nothing is
// added to the frame. TWA is the boat's own value (boat.js: wind_direction −
// hull angle + 90, wrapped), recomputed from wd and ha.
// Drawn by boat-stats-panel.js.

import { valueToY, timeToX } from './svg-chart.js';

export const STATS_WINDOW_S = 60;
export const STATS_SAMPLE_HZ = 4;
export const STATS_SERIES = [
  { key: 'heading', label: 'Heading (hull angle)', unit: '°', min: -180, max: 180 },
  { key: 'twa', label: 'TWA', unit: '°', min: -180, max: 180 },
  { key: 'awa', label: 'AWA', unit: '°', min: -180, max: 180 },
  { key: 'bs', label: 'Boat speed', unit: 'm/s', min: 0, max: null },
  { key: 'vmg', label: 'VMG (+ upwind)', unit: 'm/s', min: null, max: null },
];

export const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

// One sample from a compact boat state, or null if it carries no numbers.
export function boatSample(b) {
  if (!b || !Number.isFinite(b.ha)) return null;
  const hd = b.ha * 180 / Math.PI;
  const twa = Number.isFinite(b.wd) ? wrap180(b.wd - hd + 90) : NaN;
  const bs = Math.hypot(b.vx || 0, b.vy || 0);
  return {
    heading: wrap180(hd),
    twa,
    awa: Number.isFinite(b.awa) ? wrap180(b.awa) : NaN,
    bs,
    // tel.vmg when the frame carries it, else bs·cos(TWA) like boat.js
    vmg: Number.isFinite(b.vmg) ? b.vmg : bs * Math.cos(twa * Math.PI / 180),
  };
}

// Which boats the panel shows: a remote room (server) shows only this
// client's own boat (by id; none while spectating); local and worker modes
// show every boat. lockstep (?host=remote with the page's clock, one client
// driving the room): every boat until this client owns one.
export function boatsToShow(boats, { remote = false, ownId = null, lockstep = false } = {}) {
  const list = (boats || []).filter((b) => b && b.id !== undefined && b.id !== null);
  if (!remote) return list;
  if (ownId === null || ownId === undefined) return lockstep ? list : [];
  return list.filter((b) => b.id === ownId);
}

// Rolling buffers keyed by boat id. add() keeps samples at most
// 1/sampleHz apart and drops those older than windowS; boats that are not
// in the latest sample are removed.
export class StatsBuffer {
  constructor({ windowS = STATS_WINDOW_S, sampleHz = STATS_SAMPLE_HZ } = {}) {
    this.windowS = windowS;
    this.minDt = 1 / sampleHz;
    this.series = new Map();
    this.lastT = -Infinity;
  }
  clear() { this.series.clear(); this.lastT = -Infinity; }
  // tS: time in seconds (monotonic). Returns true if a sample was taken.
  add(tS, boats) {
    if (!(tS - this.lastT >= this.minDt - 1e-9)) {
      if (tS < this.lastT) this.clear(); else return false;
    }
    // keep a 1/sampleHz grid so the mean rate holds when frames do not divide it
    this.lastT = tS - this.lastT < 2 * this.minDt ? this.lastT + this.minDt : tS;
    const seen = new Set();
    for (const b of boats) {
      const s = boatSample(b);
      if (!s) continue;
      seen.add(b.id);
      let row = this.series.get(b.id);
      if (!row) { row = { t: [], heading: [], twa: [], awa: [], bs: [], vmg: [] }; this.series.set(b.id, row); }
      row.t.push(tS);
      for (const k of ['heading', 'twa', 'awa', 'bs', 'vmg']) row[k].push(s[k]);
      let drop = 0;
      while (drop < row.t.length && row.t[drop] < tS - this.windowS) drop++;
      if (drop) for (const k of ['t', 'heading', 'twa', 'awa', 'bs', 'vmg']) row[k].splice(0, drop);
    }
    for (const id of [...this.series.keys()]) if (!seen.has(id)) this.series.delete(id);
    return true;
  }
  ids() { return [...this.series.keys()]; }
}

// Y range of one chart over every shown boat's values: fixed for angles,
// 0..max for speed, symmetric ±max for VMG (rounded up to 0.5 m/s).
export function seriesRange(ser, arrays) {
  if (ser.min !== null && ser.max !== null) return [ser.min, ser.max];
  let m = 0.5;
  for (const v of arrays) for (const x of v) if (Number.isFinite(x) && Math.abs(x) > m) m = Math.abs(x);
  const hi = Math.ceil(m * 2) / 2;
  return ser.min === null ? [-hi, hi] : [ser.min, hi];
}

// SVG polyline "points" strings for one boat's series in a w×h chart whose x
// spans [t1 − windowS, t1]. Gaps (NaN) and ±180° wraps (wrap = true) start a
// new polyline.
export function polylinePoints(t, v, { t1, windowS, lo, hi, w, h, wrap = false }) {
  const out = [];
  let cur = [], prev = null;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!Number.isFinite(x) || (wrap && prev !== null && Math.abs(x - prev) > 180)) {
      if (cur.length > 1) out.push(cur.join(' '));
      cur = [];
      prev = null;
      if (!Number.isFinite(x)) continue;
    }
    const px = timeToX(t[i], t1, windowS, w);
    const py = valueToY(x, lo, hi, h);
    cur.push(px.toFixed(1) + ',' + py.toFixed(1));
    prev = x;
  }
  if (cur.length > 1) out.push(cur.join(' '));
  return out;
}

// Text readout of one value: angles as whole degrees, speeds to 0.01 m/s.
export function formatStatValue(ser, v) {
  if (!Number.isFinite(v)) return '–';
  return ser.unit === 'm/s' ? `${v.toFixed(2)} m/s` : `${Math.round(v)}°`;
}

// Latest value per boat for one series key: [{ id, v }] in the given id order.
export function latestValues(buf, key, ids = buf.ids()) {
  return ids.map((id) => {
    const a = buf.series.get(id)?.[key];
    return { id, v: a && a.length ? a[a.length - 1] : NaN };
  });
}
