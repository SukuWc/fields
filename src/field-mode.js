// Client-only field visualization experiment (?field_mode=), used to tell
// transport bandwidth apart from decode / paint / draw cost on a phone.
// See docs/transport-experiments.md. No DOM; the page (main.js) and tests
// read the query here.
//
//   (none)   current behaviour
//   recv     stay subscribed, decode and paint as normal, hide the plane
//   freeze   paint one keyframe, then unsubscribe and keep that texture visible
//   nopaint  stay subscribed and decode, skip paintGrids / the texture upload
//
// The Player-panel "Show field (server)" checkbox still wins when it is off
// (or the room is in dev mode): the client unsubscribes and hides the plane,
// same as today. field_mode only changes what happens while the box is on.

export const FIELD_MODES = Object.freeze(['recv', 'freeze', 'nopaint']);

function paramsOf(search) {
  if (search instanceof URLSearchParams) return search;
  return new URLSearchParams(search || '');
}

/** 'recv' | 'freeze' | 'nopaint' | null (default / unknown / missing). */
export function fieldModeFromQuery(search) {
  const v = (paramsOf(search).get('field_mode') || '').trim().toLowerCase();
  return FIELD_MODES.includes(v) ? v : null;
}

/**
 * How the checkbox and ?field_mode= combine.
 *   boxOn        #field_plane checked
 *   devMode      room dev mode (frozen lattice; subscription stays off)
 *   freezeReady  freeze: a field has already been painted this arming
 */
export function fieldModeState(mode, { boxOn = true, devMode = false, freezeReady = false } = {}) {
  const want = !!boxOn && !devMode;
  if (!want) {
    return { subscribe: false, visible: !!boxOn && mode !== 'recv', paint: false, freezeAfterPaint: false };
  }
  if (mode === 'recv') {
    return { subscribe: true, visible: false, paint: true, freezeAfterPaint: false };
  }
  if (mode === 'freeze') {
    return { subscribe: !freezeReady, visible: true, paint: true, freezeAfterPaint: !freezeReady };
  }
  if (mode === 'nopaint') {
    return { subscribe: true, visible: true, paint: false, freezeAfterPaint: false };
  }
  return { subscribe: true, visible: true, paint: true, freezeAfterPaint: false };
}
