// Right-of-way outline overlay (show_row_outline). From the local player's
// view, each opponent inside the Rule 10 interest gate (12 m hull clearance;
// the sim only sends a state.pair entry while the pair is inside it) gets
// its hull outline recoloured:
//   RED    the player must keep clear (opponent has right of way)
//   GREEN  the player has right of way
//   YELLOW transitional: Rule 15 window open, both boats keep clear
//          (Rule 13, both tacking), or room owed between them (state.br /
//          state.mr badges, Rule 18/19/20 room)
// Pure: reads the snapshot only (sim owns state; client draws). Boats by id.
// Brand port red / starboard green / mark yellow (brand-kit/colors.md).
export const ROW_RED = 0xe1182b;
export const ROW_GREEN = 0x18a15e;
export const ROW_YELLOW = 0xffc400;
// No active rule pair (setting on): black outline on a white hull.
export const ROW_NONE = 0x000000;

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
