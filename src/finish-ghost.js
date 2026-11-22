// Finish ghosts: a boat that has finished (finish.js RaceResults) keeps
// sailing, but as a ghost it can no longer interfere with boats still racing.
// No DOM, no three.js.
//
// Sim side (setFinishGhost, called by Sim.step when a boat finishes):
// - no sail → lattice momentum (Sim.step skips her getSailSegments), and her
//   true wind is the raw field sample (wind.js boatTrueWind: no own-wake undo,
//   since she adds no wake);
// - her hull fixture only collides with the map walls (planck category
//   FINISH_GHOST_CATEGORY, mask WALL_CATEGORY): she passes through boats and
//   marks, and they through her;
// - Sim.step leaves her out of the rules (pair evaluation, contacts, mark
//   touches), so a racer is never charged for her.
// Boats never have a lattice barrier, so there is nothing to remove there.
// A new race builds new Boat objects, so ghosts clear on every restart.
//
// Client side: state.boats[i].gh = 1 (scene-state.js). scene-build.js draws
// her guides (sails, rudder, forces) with ghostGuide, and marks her hull
// outline (statics.bodies[].b = boat id) with gh; renderer.js draws a ghost
// hull fill and outline at FINISH_GHOST_OPACITY and drops no trail dots
// (boat-trails.js).

// planck collision categories. Walls (map.js) are WALL_CATEGORY; boats and
// marks keep planck's default category 0x0001 / mask 0xFFFF.
export const WALL_CATEGORY = 0x0002;
export const FINISH_GHOST_CATEGORY = 0x0004;
export const DEFAULT_CATEGORY = 0x0001;
export const DEFAULT_MASK = 0xFFFF;

// Drawn opacity of a ghost (hull fill, outline, sails and guides).
export const FINISH_GHOST_OPACITY = 0.35;
// Desaturation toward grey (0 = boat colour, 1 = grey).
export const FINISH_GHOST_DESAT = 0.7;

export function isFinishGhost(boat) {
  return !!(boat && boat.finishGhost);
}

// Turn a boat into a finish ghost (on) or back (off): the flag and her hull
// fixtures' collision filter.
export function setFinishGhost(boat, on = true) {
  if (!boat) return;
  boat.finishGhost = !!on;
  const body = boat.physics_model;
  if (!body || !body.getFixtureList) return;
  for (let f = body.getFixtureList(); f; f = f.getNext()) {
    f.setFilterData(on
      ? { groupIndex: 0, categoryBits: FINISH_GHOST_CATEGORY, maskBits: WALL_CATEGORY }
      : { groupIndex: 0, categoryBits: DEFAULT_CATEGORY, maskBits: DEFAULT_MASK });
  }
}

// Boats that still take part in the rules (not ghosts).
export function rulesBoats(boats) {
  return (boats || []).some(isFinishGhost) ? boats.filter((b) => !isFinishGhost(b)) : boats;
}

// 0xRRGGBB moved toward its grey by FINISH_GHOST_DESAT.
export function desaturate(hex, k = FINISH_GHOST_DESAT) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const m = (c) => Math.round(c + (y - c) * k);
  return (m(r) << 16) | (m(g) << 8) | m(b);
}

// A boat guide (boat-draw.js boatGuides) drawn as a ghost: desaturated and
// at FINISH_GHOST_OPACITY (times its own opacity).
export function ghostGuide(g) {
  const out = { ...g, opacity: (g.opacity !== undefined ? g.opacity : 1) * FINISH_GHOST_OPACITY };
  if (Number.isFinite(g.color)) out.color = desaturate(g.color);
  return out;
}
