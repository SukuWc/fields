// Remote field stream: two bytes per AMR cell (uint8 speed + uint8
// direction), keyframes only. Shared by apps/server/room.js (encode) and
// the client (decode, bilinear sample, speed paint, tracers, ladders).
//
// Speed byte:
//   0..253   |v| in m/s, linear, 0 = 0, 253 = SPEED_MAX_MPS (16).
//            16 m/s covers the default 2f wind ceiling (15 m/s, see
//            windCeilingMps in sim-modes.js). 4f rooms can run up to 30 m/s;
//            values above 16 saturate. vmax is also on the wire so a later
//            bump does not need a new packing.
//   254      barrier (same sentinel as fieldPainter.FIELD_BARRIER)
//   255      hidden (ghost ring / outside a refinement disk)
// Direction byte: 256 steps over 360°, downwind angle of the (u, v) vector
//   byte = round((atan2(v, u) + π) · 256 / 2π) & 255
//   angle = byte · 2π / 256 − π
//   so 0 is −π (downwind toward −X). Unused (0) on barrier / hidden cells.
// Quantization bounds: speed at most SPEED_MAX_MPS / (2·253) ≈ 0.0316 m/s;
// direction at most 180/256 ≈ 0.703°.
import { ROLE_FLUID } from './boltzmann.js';
import { FIELD_TO_MPS } from './wind.js';

export const SPEED_MAX_MPS = 16;
export const SPEED_BYTE_MAX = 253;
export const VECTOR_BARRIER = 254;
export const VECTOR_HIDDEN = 255;
export const VECTOR_KIND = 'vec';

const TWO_PI = Math.PI * 2;

export function speedToByte(speed, vmax = SPEED_MAX_MPS) {
  if (!(speed > 0) || !(vmax > 0)) return 0;
  return Math.max(0, Math.min(SPEED_BYTE_MAX, Math.round(speed / vmax * SPEED_BYTE_MAX)));
}

export function speedFromByte(b, vmax = SPEED_MAX_MPS) {
  if (b >= VECTOR_BARRIER) return null;
  return (b / SPEED_BYTE_MAX) * vmax;
}

export function dirToByte(u, v) {
  return Math.round((Math.atan2(v, u) + Math.PI) * 256 / TWO_PI) & 255;
}

export function dirFromByte(b) {
  return b * TWO_PI / 256 - Math.PI;
}

export function uvFromBytes(speedByte, dirByte, vmax = SPEED_MAX_MPS) {
  const speed = speedFromByte(speedByte, vmax);
  if (speed == null) return null;
  const a = dirFromByte(dirByte);
  return { u: speed * Math.cos(a), v: speed * Math.sin(a) };
}

function cellWorld(rootW, rootH, resolution, cx, cy) {
  const res = resolution || 1;
  return {
    x: (cx - rootW / 2) / res,
    y: (cy - rootH / 2) / res,
  };
}

function sampleMps(bm, wx, wy) {
  const f = bm.get_field_velocity(wx, wy);
  const vs = Number.isFinite(bm.velScale) ? bm.velScale : 1;
  return { u: f.x * FIELD_TO_MPS * vs, v: f.y * FIELD_TO_MPS * vs };
}

function encodeCell(u, v, vmax) {
  const speed = Math.hypot(u, v);
  return { speed: speedToByte(speed, vmax), dir: speed > 1e-12 ? dirToByte(u, v) : 0 };
}

// Walk the same AMR layout as fieldPainter.encodeFieldGrids (root, then each
// refinement domain depth-first, interior nodes only, hidden outside the disk).
function vectorGridList(bm) {
  const grids = [];
  grids.push({ x0: 0, y0: 0, dx: 1, w: bm.width, h: bm.height, src: bm, root: true });
  const walk = (d) => {
    grids.push({ x0: d.fineToRootX(1), y0: d.fineToRootY(1), dx: d.dx, w: d.width - 2, h: d.height - 2, src: d });
    for (const c of d.domains) walk(c);
  };
  for (const d of bm.domains) walk(d);
  return grids;
}

// Encode the live lattice as a decoded vector-field message (kind: 'vec').
export function encodeVectorGrids(bm, { vmax = SPEED_MAX_MPS } = {}) {
  const max = Number.isFinite(vmax) && vmax > 0 ? vmax : SPEED_MAX_MPS;
  const layout = vectorGridList(bm);
  const grids = [];
  for (const g of layout) {
    const n = g.w * g.h;
    const speed = new Uint8Array(n);
    const dir = new Uint8Array(n);
    const cells = g.src.cells;
    if (g.root) {
      for (let j = 0; j < g.h; j++) {
        for (let i = 0; i < g.w; i++) {
          const k = i + j * g.w;
          const cell = cells[k];
          if (cell.barrier) { speed[k] = VECTOR_BARRIER; continue; }
          const w = cellWorld(bm.width, bm.height, bm.resolution, i + 0.5, j + 0.5);
          const uv = sampleMps(bm, w.x, w.y);
          const e = encodeCell(uv.u, uv.v, max);
          speed[k] = e.speed;
          dir[k] = e.dir;
        }
      }
    } else {
      const d = g.src, W = d.width, role = d._role;
      for (let j = 0; j < g.h; j++) {
        for (let i = 0; i < g.w; i++) {
          const k = i + j * g.w;
          const nidx = (i + 1) + (j + 1) * W;
          if (role && role[nidx] !== ROLE_FLUID) { speed[k] = VECTOR_HIDDEN; continue; }
          const cell = cells[nidx];
          if (cell.barrier) { speed[k] = VECTOR_BARRIER; continue; }
          const cx = g.x0 + (i + 0.5) * g.dx;
          const cy = g.y0 + (j + 0.5) * g.dx;
          const w = cellWorld(bm.width, bm.height, bm.resolution, cx, cy);
          const uv = sampleMps(bm, w.x, w.y);
          const e = encodeCell(uv.u, uv.v, max);
          speed[k] = e.speed;
          dir[k] = e.dir;
        }
      }
    }
    grids.push({ x0: g.x0, y0: g.y0, dx: g.dx, w: g.w, h: g.h, speed, dir });
  }
  return {
    kind: VECTOR_KIND,
    vmax: max,
    rootW: bm.width,
    rootH: bm.height,
    resolution: bm.resolution || 1,
    grids,
  };
}

function uvAtCell(g, i, j, vmax) {
  const k = i + j * g.w;
  return uvFromBytes(g.speed[k], g.dir[k], vmax);
}

function bilinearGrid(g, vmax, cx, cy, out) {
  // Samples sit at cell centres: (x0 + 0.5·dx, y0 + 0.5·dx).
  let fx = (cx - g.x0) / g.dx - 0.5;
  let fy = (cy - g.y0) / g.dx - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > g.w - 0.5 || fy > g.h - 0.5) return false;
  fx = Math.max(0, Math.min(g.w - 1.000001, fx));
  fy = Math.max(0, Math.min(g.h - 1.000001, fy));
  const i0 = Math.floor(fx), j0 = Math.floor(fy);
  const i1 = Math.min(g.w - 1, i0 + 1), j1 = Math.min(g.h - 1, j0 + 1);
  const tx = fx - i0, ty = fy - j0;
  const c00 = uvAtCell(g, i0, j0, vmax);
  const c10 = uvAtCell(g, i1, j0, vmax);
  const c01 = uvAtCell(g, i0, j1, vmax);
  const c11 = uvAtCell(g, i1, j1, vmax);
  // Hidden cells do not own the point: fall through to a coarser grid.
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  let ux = 0, vy = 0, wt = 0;
  if (c00) { ux += c00.u * w00; vy += c00.v * w00; wt += w00; }
  if (c10) { ux += c10.u * w10; vy += c10.v * w10; wt += w10; }
  if (c01) { ux += c01.u * w01; vy += c01.v * w01; wt += w01; }
  if (c11) { ux += c11.u * w11; vy += c11.v * w11; wt += w11; }
  if (!(wt > 0)) return false;
  out.x = ux / wt;
  out.y = vy / wt;
  return true;
}

// Bilinear (u, v) in m/s at world (x, y), finest covering AMR grid. Barrier
// cells contribute 0; hidden cells fall through to the parent grid.
export function sampleVectorField(msg, x, y, out = { x: 0, y: 0 }) {
  out.x = 0;
  out.y = 0;
  if (!msg || !msg.grids || !msg.grids.length) return out;
  const res = msg.resolution || 1;
  const cx = msg.rootW / 2 + x * res;
  const cy = msg.rootH / 2 + y * res;
  const vmax = msg.vmax || SPEED_MAX_MPS;
  for (let gi = msg.grids.length - 1; gi >= 0; gi--) {
    if (bilinearGrid(msg.grids[gi], vmax, cx, cy, out)) return out;
  }
  return out;
}

// getWind-shaped sample for ladder-lines.js. Only the direction of (vx, vy)
// is used (the front steps a fixed 0.5 m); magnitudes are in m/s.
export function vectorFieldWind(msg, x, y) {
  const v = sampleVectorField(msg, x, y);
  return { vx: v.x, vy: v.y };
}

export function vectorFieldBounds(msg) {
  const res = msg.resolution || 1;
  const x0 = (0 - msg.rootW / 2) / res;
  const y0 = (0 - msg.rootH / 2) / res;
  const x1 = (msg.rootW - msg.rootW / 2) / res;
  const y1 = (msg.rootH - msg.rootH / 2) / res;
  return { x0, y0, x1, y1 };
}

// Palette index 0..nColors for a speed byte at a client contrast slider
// (1.2^contrastExp). contrast = 1 uses the full 0..vmax range; values
// above 1 saturate the palette the way the old speed plot did.
export function speedByteToColorIndex(speedByte, contrastExp, nColors) {
  if (speedByte >= VECTOR_BARRIER) return null;
  const contrast = Math.pow(1.2, Number(contrastExp) || 0);
  const t = Math.max(0, Math.min(1, (speedByte / SPEED_BYTE_MAX) * contrast));
  return Math.round(t * nColors);
}
