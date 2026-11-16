// Boat sample + strip-chart helpers (no DOM). boatSample: hull heading, TWA,
// AWA, boat speed and VMG from the compact scene state the client already
// receives (state.boats[i]: id, ha, vx, vy, awa, wd); TWA is the boat's own
// value (boat.js: wind_direction − hull angle + 90, wrapped), recomputed from
// wd and ha. Used by instrument-readout.js; seriesRange / polylinePoints draw
// the instrument panel's Chart mode (instrument-chart.js). The old floating
// "Boat stats" panel that this module used to feed is gone.

import { valueToY, timeToX } from './svg-chart.js';

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

// Y range of one chart over its series' values: fixed for angles,
// 0..max for speed, symmetric ±max for VMG (rounded up to 0.5 m/s).
export function seriesRange(ser, arrays) {
  if (ser.min !== null && ser.max !== null) return [ser.min, ser.max];
  let m = 0.5;
  for (const v of arrays) for (const x of v) if (Number.isFinite(x) && Math.abs(x) > m) m = Math.abs(x);
  const hi = Math.ceil(m * 2) / 2;
  return ser.min === null ? [-hi, hi] : [ser.min, hi];
}

// SVG polyline "points" strings for one series in a w×h chart whose x
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
