// Map size: width × length in metres, the length along the wind axis (wind
// from +Y, so length is Y). ?map_size=100x200 or the #mapSize select picks
// it; changing it reloads the page (the lattice, walls, texture and camera
// are all built from it at load).
//
// Root lattice cost scales with the area; the boat refinement stack (finest
// 1/8 m) is sized by the boats, not the map, but a coarser root adds one
// level per doubling. Default root cell per size (?simRes overrides), field
// cost per 30 Hz frame, one boat, headless Chromium on the box:
//   75 × 75 (old)  1 m root,  5.2k root cells: 12.5 ms
//   50 × 100       1 m root,  4.6k:            12.7 ms
//   100 × 200      1 m root, 19.3k:            16.4 ms (x2: 14.3 ms)
//   200 × 400      4 m root,  4.7k:            13.7 ms (x2: 14.8, 1 m: 26.7)
// 100 × 200 keeps the 1 m root so the field behaves as on the old map.

import { DEFAULT_SIM_RES, DEFAULT_MAP_SIZE } from './settings-registry.js';

// simRes: the size's default root cell (the registry default, from
// sim-modes.js, for now; a size may set its own).
export const MAP_SIZES = {
  '50x100':  { w: 50,  h: 100, simRes: DEFAULT_SIM_RES, label: '50 × 100 m' },
  '100x200': { w: 100, h: 200, simRes: DEFAULT_SIM_RES, label: '100 × 200 m' },
  '200x400': { w: 200, h: 400, simRes: DEFAULT_SIM_RES, label: '200 × 400 m' },
  // Legacy squares (?mapSize=75 / 150 from before the dropdown). Not in the
  // dropdown, still accepted from the URL.
  '75x75':   { w: 75,  h: 75,  simRes: DEFAULT_SIM_RES, label: '75 × 75 m (legacy)', legacy: true },
  '150x150': { w: 150, h: 150, simRes: DEFAULT_SIM_RES, label: '150 × 150 m (legacy)', legacy: true },
};
// Dropdown order, smallest first. fitMapSize grows along this list.
export const MAP_SIZE_ORDER = ['50x100', '100x200', '200x400'];
// Contains the old 75 m square, so every scenario keeps its layout.
// (settings-registry.js, with the map_size setting.)
export { DEFAULT_MAP_SIZE };
// Walls sit 2 m inside the map edge (map.js).
export const WALL_INSET_M = 2;

// "100x200", "100×200", "100X200", or a legacy single side "75" / "150".
export function parseMapSize(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().toLowerCase().replace('×', 'x').replace(/\s+/g, '');
  if (MAP_SIZES[s]) return s;
  if (/^\d+$/.test(s) && MAP_SIZES[s + 'x' + s]) return s + 'x' + s;
  return null;
}

// Map size from a query string; the old ?mapSize key is accepted too.
export function mapSizeFromQuery(search) {
  const q = new URLSearchParams(search || '');
  return parseMapSize(q.get('map_size')) || parseMapSize(q.get('mapSize')) || DEFAULT_MAP_SIZE;
}

// Half-extents (m) of what each scenario places or sails through: boats,
// marks, lines and the room to manoeuvre round them. The layouts are fixed
// world coordinates centred on the origin (built for the 75 m square,
// walls ±35.5), so they are not scaled; a bigger map just has the walls
// further away. Course scenarios 12–17 span about ±34 m across the wind and
// do not fit the 50 m width. scripts/map-size-check.mjs checks these
// against the layouts.
const SMALL_SCENARIO = { x: 20, y: 26 };
export const SCENARIO_EXTENT = {
  12: { x: 30, y: 28 },  // triangle: marks/start |x| ≤ 26, |y| ≤ 24, + rounding room
  13: { x: 32, y: 30 },  // windward-leeward: |x| ≤ 28, |y| ≤ 26
  14: { x: 34, y: 32 },  // start + W/L: |x| ≤ 30, |y| ≤ 28
  15: { x: 35, y: 30 },  // mark-room: |x| ≤ 33.1, |y| ≤ 26
  16: { x: 35, y: 31 },  // finish: |x| ≤ 32, |y| ≤ 27
  17: { x: 35.5, y: 32 },  // test race: boats from x −34.4, mark y 10, line y −22
  18: { x: 46, y: 90 },
  20: { x: 40, y: 75 },    // true-wind sweep: one circle from (−10, −40), radius ≲ 20 m, plus downwind drift
  21: { x: 40, y: 50 },    // ladder demo: mark at (0, 40), boat from y ≈ −10 up through the 40 m / 20 m lines
  // 19 boundary test: lines at x ±40 (built for 100 m), beats up to y ≈ 90
};
export function scenarioExtent(n) {
  return SCENARIO_EXTENT[n] || SMALL_SCENARIO;
}

export function scenarioFits(n, key) {
  const m = MAP_SIZES[key];
  if (!m) return false;
  const e = scenarioExtent(n);
  return e.x <= m.w / 2 - WALL_INSET_M && e.y <= m.h / 2 - WALL_INSET_M;
}

// The size to use for scenario n: the requested one if the scenario fits,
// else the smallest dropdown size that does (never smaller than asked).
export function fitMapSize(n, key) {
  if (scenarioFits(n, key)) return key;
  const want = MAP_SIZES[key] || MAP_SIZES[DEFAULT_MAP_SIZE];
  for (const k of MAP_SIZE_ORDER) {
    const m = MAP_SIZES[k];
    if (m.w >= want.w && m.h >= want.h && scenarioFits(n, k)) return k;
  }
  for (const k of MAP_SIZE_ORDER) if (scenarioFits(n, k)) return k;
  return MAP_SIZE_ORDER[MAP_SIZE_ORDER.length - 1];
}

// Camera: pan limits keep a 7.5 m margin as on the 75 m map (±30), and the
// zoom-out limit shows the whole length with the 70° vertical FOV.
export function cameraLimits(w, h) {
  const zoomAll = (h / 2) / Math.tan((70 / 2) * Math.PI / 180) * 1.4;
  return {
    xMax: Math.max(0, w / 2 - 7.5),
    yMax: Math.max(0, h / 2 - 7.5),
    zoomMax: Math.max(70, Math.ceil(zoomAll)),
  };
}
