// Right-of-way circles (show_row_outline). From the local player's view,
// each opponent inside the Rule 10 interest gate (12 m hull clearance; the
// sim only sends a state.pair entry while the pair is inside it) gets a
// circle of ROW_CIRCLE_R metres, centred on that boat:
//   RED    the player must keep clear (opponent has right of way)
//   GREEN  the player has right of way
//   YELLOW transitional: Rule 15 window open, both boats keep clear
//          (Rule 13, both tacking), or room owed between them (state.br /
//          state.mr badges, Rule 18/19/20 room)
// Hull fills and hull outlines are not recoloured. Boats outside the gate,
// and the point-of-view boat, get no circle.
// Pure: reads the snapshot only (sim owns state; client draws). Boats by id.
// Brand port red / starboard green / mark yellow (brand-kit/colors.md).
export const ROW_RED = 0xe1182b;
export const ROW_GREEN = 0x18a15e;
export const ROW_YELLOW = 0xffc400;
// World-unit radius of the circle drawn around an opponent in range.
export const ROW_CIRCLE_R = 3;
// Closed polyline segments. The last point repeats the first.
export const ROW_CIRCLE_SEGMENTS = 48;

// pair: state.pair ([{ k, a: right-of-way id, b: give-way id }]); rooms:
// [...state.br, ...state.mr] ([[entitled id, giving id]]). Returns
// Map(opponent id → colour). Opponents outside the gate are absent.
export function rowOutlineColors(ownId, pair, rooms) {
  const out = new Map();
  if (ownId == null) return out;
  for (const p of pair || []) {
    if (!p || (p.a !== ownId && p.b !== ownId)) continue;
    const other = p.a === ownId ? p.b : p.a;
    if (other == null) continue;
    let c;
    if (p.k === '15' || p.k === 'b') c = ROW_YELLOW;
    else c = p.a === ownId ? ROW_GREEN : ROW_RED;
    out.set(other, c);
  }
  for (const r of rooms || []) {
    if (!r || (r[0] !== ownId && r[1] !== ownId)) continue;
    const other = r[0] === ownId ? r[1] : r[0];
    if (out.has(other)) out.set(other, ROW_YELLOW);
  }
  return out;
}

// Point of view: the local player's boat id in multiplayer (ownId);
// otherwise (local / worker / single-player, no owned boat) boat 0: a boat
// whose id is 0, else the first racing boat's id (boat 0, the one the
// camera and HUD follow). Always returns an id, never a position.
export function rowPovId(ownId, boats) {
  if (ownId != null) return ownId;
  const list = boats || [];
  const zero = list.find((b) => b && (b.id === 0 || b.id === '0' || b.id === '#0'));
  if (zero) return zero.id;
  return list[0] && list[0].id != null ? list[0].id : null;
}

// Closed polyline [x0, y0, ...] of a circle. The last point repeats the first
// so a line strip closes. Every vertex lies on the circle of radius r.
export function rowCirclePoints(x, y, r = ROW_CIRCLE_R, segments = ROW_CIRCLE_SEGMENTS) {
  const n = segments > 2 ? segments : 3;
  const pts = new Array((n + 1) * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts[i * 2] = x + r * Math.cos(a);
    pts[i * 2 + 1] = y + r * Math.sin(a);
  }
  // Repeat the first vertex. cos(2π) is not bit-identical to cos(0), and a
  // gap there shows up as a missing pixel on the Line2 strip.
  pts[n * 2] = pts[0];
  pts[n * 2 + 1] = pts[1];
  return pts;
}

// Circles for the colour map from rowOutlineColors. boats: state.boats
// ({ id, x, y } or { id, px, py }). Looked up by id, never by list index.
// An id with no boat, or a boat with no finite position, is skipped.
// Returns [{ id, x, y, r, color, pts }].
export function rowCircles(colors, boats) {
  const out = [];
  if (!colors || typeof colors.get !== 'function' || !boats) return out;
  const byId = new Map();
  for (const b of boats) {
    if (b && b.id != null && !byId.has(b.id)) byId.set(b.id, b);
  }
  for (const [id, color] of colors) {
    const b = byId.get(id);
    if (!b) continue;
    const x = Number.isFinite(b.x) ? b.x : b.px;
    const y = Number.isFinite(b.y) ? b.y : b.py;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ id, x, y, r: ROW_CIRCLE_R, color, pts: rowCirclePoints(x, y, ROW_CIRCLE_R) });
  }
  return out;
}
