// Rank chip in the phone top bar (mobile plan M4 / mockup): your position
// out of the fleet, e.g. "3/8", on the leaderboard / chat sheet button, from
// the leaderboard rows the frame already carries (state.hud.lb, the same
// rows #finish_results shows). Hidden when there is no leaderboard, when
// this client has no boat (a spectator in a server room) and on tablets,
// where the leaderboard stays on the map. Client-only.
import { TABLET_QUERY } from './touch-controls.js';

// Own boat's index in state.boats: by id in a server room, boat 0 otherwise
// (the boat the leaderboard highlights). null: no own boat.
export function ownIndex(boats, ownId, remote) {
  if (ownId) {
    const i = (boats || []).findIndex((b) => b && b.id === ownId);
    return i >= 0 ? i : null;
  }
  return remote ? null : 0;
}

// "3/8" from leaderboard rows ({ position, boat }), or null.
export function rankText(rows, idx) {
  if (!Array.isArray(rows) || !rows.length || idx === null || idx === undefined) return null;
  const r = rows.find((x) => x && x.boat === idx);
  return r && Number.isFinite(r.position) ? r.position + '/' + rows.length : null;
}

export function setupRankChip({ remote = false } = {}, doc = document) {
  const btn = doc.getElementById('sheet_toggle');
  const chip = btn && btn.querySelector('.st-rank');
  if (!chip) return { onFrame() {}, setOwnId() {} };
  const tq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(TABLET_QUERY) : null;
  const label = btn.getAttribute('aria-label') || '';
  let ownId = null, last = undefined;
  function show(text) {
    if (tq && tq.matches) text = null;
    if (text === last) return;
    last = text;
    chip.hidden = !text;
    chip.textContent = text || '';
    btn.classList.toggle('has-rank', !!text);
    doc.body.classList.toggle('rank-on', !!text);
    btn.setAttribute('aria-label', text ? 'Rank ' + text.replace('/', ' of ') + '. ' + label : label);
  }
  return {
    setOwnId(id) { ownId = id; last = undefined; },
    onFrame(state) {
      const lb = state && state.hud && state.hud.lb;
      show(lb ? rankText(lb, ownIndex(state.boats, ownId, remote)) : null);
    },
  };
}
