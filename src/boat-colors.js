// Boat colours (no DOM, no three.js): one fixed palette, picked by the boat's
// index in the frame's boat list (state.boats, the sim's player order). The
// host builds that list, so local, worker and ?host=remote clients give the
// same boat the same colour. Used for the hull fill, trail dots, ghost hull
// and Boat stats chart lines. Mandatory for now: a spawnBoat color (state.bc)
// no longer changes it.
export const BOAT_COLORS = [
  0x2f80ff, // 0 blue
  0xff3b30, // 1 red
  0x2fd06a, // 2 green
  0xff8c1a, // 3 orange
  0xa45cff, // 4 purple
  0x2fe0e0, // 5 cyan
  0xffd02f, // 6 yellow
  0xff4fd8, // 7 magenta
];

export function boatColor(index) {
  const n = BOAT_COLORS.length;
  const i = Number.isInteger(index) && index >= 0 ? index % n : 0;
  return BOAT_COLORS[i];
}

export const boatColorCss = (index) => '#' + boatColor(index).toString(16).padStart(6, '0');

// { [boat id]: palette index } for a frame's boats.
export function boatColorIndex(boats) {
  const out = new Map();
  (boats || []).forEach((b, i) => { if (b && b.id != null) out.set(b.id, i); });
  return out;
}
