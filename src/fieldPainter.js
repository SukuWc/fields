// Client-side field painter: turns the Boltzmann lattice into the RGBA
// texture the renderer shows. The engine (boltzmann.js) has no DOM or three.js
// dependency; it only calls painter.resize(bm) after a rebuild and
// painter.paint(bm) after a lattice step.
import { ROLE_FLUID, PALETTE } from './boltzmann.js';

// Default plot options when no getter is given (tests, the old dom-stub
// values): plot 3 (speed), contrast slider at 0.
const DEFAULT_OPTIONS = () => ({ plotType: 3, contrastExp: 0 });

// Plot options from the page: the #plotSelect index and the #contrastSlider
// exponent, read each paint as before.
export function domPlotOptions(doc = document) {
  const plotSelect = doc.getElementById('plotSelect');
  const contrastSlider = doc.getElementById('contrastSlider');
  return () => ({ plotType: plotSelect.selectedIndex, contrastExp: Number(contrastSlider.value) });
}

export class FieldPainter {
  // texture: a three.js DataTexture, or anything shaped { image: { data, width, height } }.
  // oversampling: texels per root cell at resolution 1.
  constructor(texture, oversampling, getOptions = DEFAULT_OPTIONS) {
    this.texture = texture;
    // Texels per finest cell stay at one: the boat stack reaches 1/8 world
    // unit on every resolution (extra outer rings on coarse grids), so the
    // texels per root cell grow with the root cell (8, 16, 32).
    this.baseOversampling = oversampling;
    this.oversampling = oversampling;
    this.getOptions = getOptions;
    this._width = 0;
  }

  // Texture side is oversampling × lattice cells. A different lattice size
  // needs a new pixel buffer; dispose drops the GPU copy so three.js
  // reallocates it at the new size on the next upload.
  resize(bm) {
    if (this.baseOversampling) this.oversampling = Math.round(this.baseOversampling / Math.min(1, bm.resolution));
    const tex = this.texture;
    if (!tex || !tex.image || !this.oversampling) return;
    const w = bm.width * this.oversampling;
    const h = bm.height * this.oversampling;
    if (tex.image.width === w && tex.image.height === h) return;
    // A buffer of the right size with no recorded dimensions (a test stub,
    // or the initial texture) is kept as is.
    if (tex.image.width === undefined && tex.image.data && tex.image.data.length === w * h * 4) return;
    tex.image = { data: new Uint8Array(w * h * 4), width: w, height: h };
    if (typeof tex.dispose === 'function') tex.dispose();
    tex.needsUpdate = true;
  }

  paint(bm) {
    if (this.texture === undefined) return;
    const opts = this.getOptions();
    const contrast = plotContrast(bm, opts.contrastExp);
    const plotType = opts.plotType;
    this._width = bm.width;

    // Paint coarse grid
    for (let y = 0; y < bm.height; y++) {
      for (let x = 0; x < bm.width; x++) {
        const color = bm.cells[x + y * bm.width].calculate_color(plotType, contrast);
        this.colorSquare(x, y, 1, color.red, color.green, color.blue);
      }
    }
    // Paint fine domains on top (overwrite coarse cells in each domain's region)
    for (const d of bm.domains) this.paintDomain(d, plotType, contrast);
  }

  // Fine cells of one refinement window, then its children on top.
  // Uses cx0_root + (fi-1)*dx for position and dx for size — works at any refinement depth.
  // Nodes outside the disk are left to the parent paint, so the staircase shows.
  paintDomain(domain, plotType, contrast) {
    for (let fj = 1; fj < domain.height - 1; fj++) {
      for (let fi = 1; fi < domain.width - 1; fi++) {
        if (domain._role && domain._role[fi + fj * domain.width] !== ROLE_FLUID) continue;
        const color = domain.cells[fi + fj * domain.width].calculate_color(plotType, contrast);
        this.colorSquare(domain.fineToRootX(fi), domain.fineToRootY(fj), domain.dx, color.red, color.green, color.blue);
      }
    }
    for (const child of domain.domains) this.paintDomain(child, plotType, contrast);
  }

  // Paint a decoded field grid message (decodeFieldGrids) the way paint()
  // paints the lattice: the root grid, then each refinement domain on top in
  // the order sent (parents before children); hidden cells keep the layer
  // below. Colours come from the same palette, so remote matches local up
  // to the 1-byte quantization (at most one palette step).
  paintGrids(msg) {
    if (!this.texture) return;
    this.resize({ width: msg.rootW, height: msg.rootH, resolution: msg.resolution });
    const tex = this.texture;
    if (!tex.image || !tex.image.data) return;
    this._width = msg.rootW;
    const { red, green, blue } = PALETTE;
    for (const g of msg.grids) {
      const v = g.values;
      for (let j = 0; j < g.h; j++) {
        for (let i = 0; i < g.w; i++) {
          const b = v[i + j * g.w];
          if (b === FIELD_HIDDEN) continue;
          if (b === FIELD_BARRIER) { this.colorSquare(g.x0 + i * g.dx, g.y0 + j * g.dx, g.dx, 0, 0, 0); continue; }
          const c = byteToColorIndex(b);
          this.colorSquare(g.x0 + i * g.dx, g.y0 + j * g.dx, g.dx, red[c], green[c], blue[c]);
        }
      }
    }
    tex.needsUpdate = true;
  }

  // Color a grid square in the image data array, one pixel at a time (rgb each in range 0 to 255).
  colorSquare(x, y, size, r, g, b) {
    const os = this.oversampling;
    const pixels_to_fill = os * size;
    const _x_base = Math.round(x * os);
    const _y_base = Math.round(y * os);
    const rowWidth = this._width * os;
    const data = this.texture.image.data;
    for (let i = 0; i < pixels_to_fill; i++) {
      for (let j = 0; j < pixels_to_fill; j++) {
        const ind = ((_x_base + i) + (_y_base + j) * rowWidth) * 4;
        data[ind] = r;
        data[ind + 1] = g;
        data[ind + 2] = b;
        data[ind + 3] = 255;
      }
    }
  }
}

// Contrast factor of a paint: the slider's 1.2^exp, times velScale on
// fast-wind grids (a lower lattice u for the same wind) so a given wind
// paints the same colour on every setting.
export function plotContrast(bm, contrastExp) {
  let contrast = Math.pow(1.2, Number(contrastExp) || 0);
  if (bm.velScale !== undefined && bm.velScale !== 1) contrast *= bm.velScale;
  return contrast;
}

// ---------------------------------------------------------------------------
// Field grid stream (server → RemoteHost). Instead of one flattened RGBA
// image, the server sends the root grid and every refinement domain as its
// own grid, one byte per cell:
//   0..FIELD_LEVELS-1  the plotted value, quantized: palette index
//                      round(byte · nColors / (FIELD_LEVELS-1))
//   FIELD_BARRIER      barrier (painted black)
//   FIELD_HIDDEN       not painted (domain nodes outside the disk or ghost
//                      ring: the layer below shows, as in local paint)
// The byte decodes to the plotted quantity with
//   value = base + (byte / (FIELD_LEVELS-1) − offset) / scale
// (rho, ux, uy, speed or curl in lattice units of that grid; the palette
// clamps, so values beyond its ends saturate as in local mode).
//
// Binary layout (little endian):
//   0  u8  0x47 'G'      1  u8 version (1)   2 u8 plotType   3 u8 0
//   4  u16 rootW (root cells)   6 u16 rootH
//   8  f32 resolution (root cells per world unit, bm.resolution)
//  12  f32 scale   16 f32 offset   20 f32 base
//  24  u16 grid count   26 u16 0
//  28  grids, each: f32 x0, f32 y0 (root-cell coordinates of cell (0,0)'s
//      corner), f32 dx (cell size in root cells), u16 w, u16 h, then w·h
//      bytes, row-major from y0.
// Grids come depth first (root, domain, its children, next domain), so
// painting them in order layers them like FieldPainter.paint.
export const FIELD_LEVELS = 254;
export const FIELD_BARRIER = 254;
export const FIELD_HIDDEN = 255;
const FIELD_MAGIC = 0x47;
const HEADER = 28;
const GRID_HEADER = 16;

function colorIndexToByte(idx) {
  const n = PALETTE.nColors;
  const c = idx < 0 ? 0 : idx > n ? n : idx;
  return Math.round(c * (FIELD_LEVELS - 1) / n);
}

export function byteToColorIndex(b) { return Math.round(b * PALETTE.nColors / (FIELD_LEVELS - 1)); }

// Decode scale for plotType at this contrast (see the header).
function plotScale(plotType, contrast) {
  if (plotType === 0) return { scale: 6 * contrast, offset: 0.5, base: 1 };
  if (plotType === 1 || plotType === 2) return { scale: 2 * contrast, offset: 0.5, base: 0 };
  if (plotType === 3) return { scale: 4 * contrast, offset: 0, base: 0 };
  return { scale: 5 * contrast, offset: 0.5, base: 0 };
}

// The plotted quantity a byte stands for (null for barrier / hidden).
export function decodeFieldValue(msg, b) {
  if (b >= FIELD_LEVELS) return null;
  return msg.base + (b / (FIELD_LEVELS - 1) - msg.offset) / msg.scale;
}

// Encode the lattice for one plot ({ plotType, contrastExp }). Returns a
// Uint8Array (the whole message).
export function encodeFieldGrids(bm, plot) {
  const plotType = Number.isFinite(plot.plotType) ? plot.plotType : 3;
  const contrast = plotContrast(bm, plot.contrastExp);
  const grids = [];
  grids.push({ x0: 0, y0: 0, dx: 1, w: bm.width, h: bm.height, src: bm, root: true });
  const walk = (d) => {
    // Interior nodes 1..w-2 (the ghost ring is never painted locally).
    grids.push({ x0: d.fineToRootX(1), y0: d.fineToRootY(1), dx: d.dx, w: d.width - 2, h: d.height - 2, src: d });
    for (const c of d.domains) walk(c);
  };
  for (const d of bm.domains) walk(d);
  let size = HEADER;
  for (const g of grids) size += GRID_HEADER + g.w * g.h;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  const sc = plotScale(plotType, contrast);
  out[0] = FIELD_MAGIC; out[1] = 1; out[2] = plotType;
  dv.setUint16(4, bm.width, true); dv.setUint16(6, bm.height, true);
  dv.setFloat32(8, bm.resolution || 1, true);
  dv.setFloat32(12, sc.scale, true); dv.setFloat32(16, sc.offset, true); dv.setFloat32(20, sc.base, true);
  dv.setUint16(24, grids.length, true);
  let o = HEADER;
  for (const g of grids) {
    dv.setFloat32(o, g.x0, true); dv.setFloat32(o + 4, g.y0, true); dv.setFloat32(o + 8, g.dx, true);
    dv.setUint16(o + 12, g.w, true); dv.setUint16(o + 14, g.h, true);
    o += GRID_HEADER;
    const cells = g.src.cells;
    if (g.root) {
      for (let k = 0; k < g.w * g.h; k++) {
        const cell = cells[k];
        out[o + k] = cell.barrier ? FIELD_BARRIER : colorIndexToByte(cell.color_index(plotType, contrast));
      }
    } else {
      const d = g.src, W = d.width, role = d._role;
      for (let j = 0; j < g.h; j++) {
        for (let i = 0; i < g.w; i++) {
          const n = (i + 1) + (j + 1) * W;
          let b;
          if (role && role[n] !== ROLE_FLUID) b = FIELD_HIDDEN;
          else { const cell = cells[n]; b = cell.barrier ? FIELD_BARRIER : colorIndexToByte(cell.color_index(plotType, contrast)); }
          out[o + i + j * g.w] = b;
        }
      }
    }
    o += g.w * g.h;
  }
  return out;
}

// Parse a field grid message (ArrayBuffer, or a view on one). Returns null
// if it is not one.
export function decodeFieldGrids(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length < HEADER || u8[0] !== FIELD_MAGIC || u8[1] !== 1) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const msg = {
    plotType: u8[2], rootW: dv.getUint16(4, true), rootH: dv.getUint16(6, true),
    resolution: dv.getFloat32(8, true), scale: dv.getFloat32(12, true), offset: dv.getFloat32(16, true), base: dv.getFloat32(20, true),
    grids: [],
  };
  const n = dv.getUint16(24, true);
  let o = HEADER;
  for (let k = 0; k < n; k++) {
    if (o + GRID_HEADER > u8.length) return null;
    const g = { x0: dv.getFloat32(o, true), y0: dv.getFloat32(o + 4, true), dx: dv.getFloat32(o + 8, true), w: dv.getUint16(o + 12, true), h: dv.getUint16(o + 14, true) };
    o += GRID_HEADER;
    if (o + g.w * g.h > u8.length) return null;
    g.values = u8.subarray(o, o + g.w * g.h);
    o += g.w * g.h;
    msg.grids.push(g);
  }
  return msg;
}
