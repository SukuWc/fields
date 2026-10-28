// Landing admin helpers: default TOML for Reset (same as in-game room panel).
// Bundled by build-app.mjs into dist-app/room-admin.js as an IIFE on
// window.LandingRoomAdmin.
import { defaultRoomConfig, stringifyRoomConfig } from '../../src/room-config.js';

export function defaultToml(mapW, mapH) {
  return stringifyRoomConfig(defaultRoomConfig(mapW, mapH));
}

/** Read map_width_m / map_height_m from TOML text (line-oriented; no full parse). */
export function mapDimsFromToml(text) {
  let mapW = NaN;
  let mapH = NaN;
  for (const line of String(text || '').split(/\r?\n/)) {
    let m = /^\s*map_width_m\s*=\s*(-?\d+(?:\.\d+)?)\s*(?:#.*)?$/.exec(line);
    if (m) mapW = Number(m[1]);
    m = /^\s*map_height_m\s*=\s*(-?\d+(?:\.\d+)?)\s*(?:#.*)?$/.exec(line);
    if (m) mapH = Number(m[1]);
  }
  return { mapW, mapH };
}

if (typeof window !== 'undefined') {
  window.LandingRoomAdmin = { defaultToml, mapDimsFromToml };
}
