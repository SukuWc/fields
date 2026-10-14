// Client-side field painter: turns the Boltzmann lattice into the RGBA
// texture the renderer shows. The engine (boltzmann.js) has no DOM or three.js
// dependency; it only calls painter.resize(bm) after a rebuild and
// painter.paint(bm) after a lattice step.
import { ROLE_FLUID } from './boltzmann.js';

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
    // Fast-wind grids hold a lower lattice u for the same wind; scale the
    // plot so a given wind paints the same colour on every setting.
    let contrast = Math.pow(1.2, Number(opts.contrastExp));
    if (bm.velScale !== undefined && bm.velScale !== 1) contrast *= bm.velScale;
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
