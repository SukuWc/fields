// Field stream text codec (server → RemoteHost): a field grid message
// (fieldPainter.js decodeFieldGrids: { plotType, rootW, rootH, resolution,
// scale, offset, base, grids: [{ x0, y0, dx, w, h, values }] }) as one JSON
// text message, keyframe or delta. No DOM; shared by apps/server/room.js and
// src/remote-host.js.
//
//   { type: 'field', seq, base, p, rw, rh, res, sc, of, ba, g: [grid...] }
//   seq   this message's number (per plot stream, from 1)
//   base  the seq this one is a delta against, 0 for a keyframe (every
//         grid stands alone). A delta applies only on top of message base;
//         a client holding another one drops it and asks for a keyframe.
//   p/rw/rh/res/sc/of/ba  plotType, rootW, rootH, resolution, scale,
//         offset, base of the field grid message.
//   grid  [x0, y0, dx, w, h, ref, data]
//         ref: -1 = coded on its own; k ≥ 0 = against grid k of message
//         base, shifted: ref is followed in the array by di, dj (this grid's
//         cell (i, j) is that grid's cell (i + di, j + dj); refinement
//         windows move with the boats in whole cells). So a grid is
//         [x0, y0, dx, w, h, -1, data] or [x0, y0, dx, w, h, k, di, dj, data].
//
// data: the w·h cell bytes, row-major, each predicted and only the residual
// r = (byte − prediction) mod 256 sent. Prediction: the referenced cell when
// the grid has a reference and that cell is inside it, else the cell to the
// left in this grid (0 at a row start), so unchanged cells and flat areas
// are zero. Residuals are zigzagged (z = 2r for r < 128, 2(256 − r) − 1
// above: small changes either way give small z) and written as symbols of
// 6 bits, one base64url character ('A'..'Z', 'a'..'z', '0'..'9', '-', '_')
// each:
//   1..32        a run of q = (symbol − 1) >> 2 (0..7) zero cells, then one
//                cell with z = ((symbol − 1) & 3) + 1 (1..4)
//   33..43       one cell, z = symbol − 28 (5..15)
//   44 a b       one cell, z = a·64 + b (any z)
//   45..63       a run of symbol − 44 (1..19) zero cells
//   0 a b c      a run of a·4096 + b·64 + c zero cells (longer runs)
// The base64url alphabet needs no JSON escaping, so the payload is plain
// text inside the JSON message.
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SYM = new Int8Array(128).fill(-1);
for (let k = 0; k < 64; k++) SYM[ALPHA.charCodeAt(k)] = k;
const MAX_RUN = 64 * 64 * 64 - 1;
const ESC = 44, RUN0 = 45, RUN_SYMS = 64 - RUN0;

// Reference of grid g in the previous message's grids: same dx, w, h and a
// whole-cell shift that still overlaps. Returns [k, di, dj] or null.
function findRef(g, prev, used) {
  if (!prev) return null;
  for (let k = 0; k < prev.length; k++) {
    if (used[k]) continue;
    const q = prev[k];
    if (q.dx !== g.dx || q.w !== g.w || q.h !== g.h) continue;
    const di = Math.round((g.x0 - q.x0) / g.dx), dj = Math.round((g.y0 - q.y0) / g.dx);
    if (Math.abs(g.x0 - q.x0 - di * g.dx) > 1e-6 || Math.abs(g.y0 - q.y0 - dj * g.dx) > 1e-6) continue;
    if (Math.abs(di) >= g.w || Math.abs(dj) >= g.h) continue;
    used[k] = 1;
    return [k, di, dj];
  }
  return null;
}

// Code one grid's values (Uint8Array, w·h) against ref values (or null).
function encodeValues(v, w, h, refV, di, dj, tol = 0, shown = null) {
  const out = [];
  let run = 0;
  // Zero runs before a cell: a short one (0..7) rides in the cell's symbol
  // when z ≤ 4; longer ones go out on their own first.
  const flushTo = (keep) => {
    while (run > keep) {
      const n = Math.min(run - keep, MAX_RUN);
      if (n <= RUN_SYMS) out.push(ALPHA[RUN0 + n - 1]);
      else out.push(ALPHA[0], ALPHA[n >> 12], ALPHA[(n >> 6) & 63], ALPHA[n & 63]);
      run -= n;
    }
  };
  for (let j = 0; j < h; j++) {
    const rj = j + dj, rowIn = refV && rj >= 0 && rj < h;
    for (let i = 0; i < w; i++) {
      const ri = i + di;
      const fromRef = rowIn && ri >= 0 && ri < w;
      const src = shown || v;
      const pred = fromRef ? refV[ri + rj * w] : i > 0 ? src[i - 1 + j * w] : 0;
      const val = v[i + j * w];
      // Deadband (tol > 0, delta cells only): a value within tol of what the
      // client shows stays as it is; barrier / hidden always go out exactly.
      const keep = tol > 0 && fromRef && val < 254 && pred < 254 && Math.abs(val - pred) <= tol;
      if (shown) shown[i + j * w] = keep ? pred : val;
      const r = keep ? 0 : (val - pred) & 255;
      if (r === 0) { run++; continue; }
      const z = r < 128 ? 2 * r : 2 * (256 - r) - 1;
      if (z <= 4) { flushTo(7); out.push(ALPHA[1 + run * 4 + z - 1]); run = 0; continue; }
      flushTo(0);
      if (z <= 15) out.push(ALPHA[33 + z - 5]);
      else out.push(ALPHA[ESC], ALPHA[z >> 6], ALPHA[z & 63]);
    }
  }
  flushTo(0);
  return out.join('');
}

function decodeValues(s, w, h, refV, di, dj) {
  const n = w * h;
  const v = new Uint8Array(n);
  let k = 0, p = 0;
  const sym = () => { const c = s.charCodeAt(p++); const x = c < 128 ? SYM[c] : -1; if (x < 0) throw new Error('bad field data'); return x; };
  const put = (z) => {
    if (k >= n) throw new Error('field data too long');
    const i = k % w, j = (k - i) / w;
    const rj = j + dj, ri = i + di;
    const pred = refV && rj >= 0 && rj < h && ri >= 0 && ri < w ? refV[ri + rj * w] : i > 0 ? v[k - 1] : 0;
    const r = z & 1 ? 256 - (z + 1) / 2 : z / 2;
    v[k++] = (pred + r) & 255;
  };
  const zeros = (m) => { for (let q = 0; q < m; q++) put(0); };
  while (p < s.length) {
    const x = sym();
    if (x >= 1 && x <= 32) { zeros((x - 1) >> 2); put(((x - 1) & 3) + 1); }
    else if (x <= 43 && x >= 33) put(x - 33 + 5);
    else if (x === ESC) { const a = sym(); put(a * 64 + sym()); }
    else if (x >= RUN0) zeros(x - RUN0 + 1);
    else { const a = sym(), b = sym(); zeros(a * 4096 + b * 64 + sym()); }
  }
  if (k !== n) throw new Error('field data too short');
  return v;
}

// Encode msg (decoded field grids) as a keyframe (prev null) or a delta
// against prev ({ seq, msg }: the message the receiver holds). Returns the
// JSON-able message as m, and as shown the grids the client will hold.
// tol (bytes, default 0 = lossless): delta cells that moved by at most tol
// since what the client shows are not sent; then the result's shown is
// what the client will hold (pass it as prev.msg next time).
export function encodeFieldText(msg, seq, prev = null, tol = 0) {
  const used = [];
  const pg = prev && prev.msg && prev.msg.plotType === msg.plotType && prev.msg.scale === msg.scale && prev.msg.offset === msg.offset && prev.msg.base === msg.base ? prev.msg.grids : null;
  const shownGrids = [];
  const g = msg.grids.map((gr) => {
    const ref = findRef(gr, pg, used);
    if (!ref) { shownGrids.push(gr); return [gr.x0, gr.y0, gr.dx, gr.w, gr.h, -1, encodeValues(gr.values, gr.w, gr.h, null, 0, 0)]; }
    const [k, di, dj] = ref;
    const sv = tol > 0 ? new Uint8Array(gr.w * gr.h) : null;
    shownGrids.push(sv ? { ...gr, values: sv } : gr);
    return [gr.x0, gr.y0, gr.dx, gr.w, gr.h, k, di, dj, encodeValues(gr.values, gr.w, gr.h, pg[k].values, di, dj, tol, sv)];
  });
  const shown = { ...msg, grids: shownGrids };
  return { shown, m: { type: 'field', seq, base: pg ? prev.seq : 0, p: msg.plotType, rw: msg.rootW, rh: msg.rootH, res: msg.resolution, sc: msg.scale, of: msg.offset, ba: msg.base, g } };
}

// Decode a field text message on top of prev ({ seq, msg } or null).
// Returns { seq, msg } or null when it is a delta against a message the
// receiver does not hold (ask for a keyframe) or malformed.
export function decodeFieldText(m, prev = null) {
  if (!m || !Array.isArray(m.g)) return null;
  if (m.base && (!prev || prev.seq !== m.base)) return null;
  const pg = m.base ? prev.msg.grids : null;
  try {
    const grids = m.g.map((a) => {
      const [x0, y0, dx, w, h, k] = a;
      if (k < 0) return { x0, y0, dx, w, h, values: decodeValues(a[6], w, h, null, 0, 0) };
      const q = pg && pg[k];
      if (!q || q.w !== w || q.h !== h) throw new Error('bad reference');
      return { x0, y0, dx, w, h, values: decodeValues(a[8], w, h, q.values, a[6], a[7]) };
    });
    return { seq: m.seq, msg: { plotType: m.p, rootW: m.rw, rootH: m.rh, resolution: m.res, scale: m.sc, offset: m.of, base: m.ba, grids } };
  } catch {
    return null;
  }
}
