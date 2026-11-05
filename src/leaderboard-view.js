// Leaderboard component (standardization PR 6): one renderer for zone B
// (desktop and tablet, floating #finish_results) and the phone sheet's
// Leaderboard tab (mobile-sheet.js moves the same element in). Same markup
// on every size:
//   head  "Leaderboard" + rank chip ("3/8", own boat; none without one)
//   row   position, boat colour chip (boat-colors.js), name, leg, gap,
//         penalty badge (pending penalties, or the finish penalty / DSQ)
// Pure: rows are leaderboard.js leaderboardState rows (state.hud.lb).
import { boatColorCss } from './boat-colors.js';
import { penaltyNameText } from './rule-text.js';
import { KIND_ARROW } from './leaderboard.js';

const LABEL_TEXT = { '-': '–', F: 'Fin', S: 'Start', O: 'OCS', E: 'Finish' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function fmtTime(s) {
  if (!Number.isFinite(s)) return '–';
  const m = Math.floor(s / 60);
  return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0');
}

export function legText(r) {
  if (r.status === 'finished' && r.entry) return 'Fin ' + fmtTime(r.entry.elapsed);
  const label = r.label === 'L' ? 'Leg ' + r.leg + (Number.isFinite(r.legs) ? '/' + r.legs : '') : (r.label in LABEL_TEXT ? LABEL_TEXT[r.label] : r.label);
  const arrow = KIND_ARROW[r.kind] || '';
  return label + (arrow ? ' ' + arrow : '');
}

export function gapText(r) {
  if (r.status === 'finished') return '';
  // Leader (gap 0 or none): distance left on the leg; others: gap to it.
  if (r.gapM === null || r.gapM === undefined || !Number.isFinite(r.gapM) || Math.round(r.gapM) <= 0) return Number.isFinite(r.legM) ? Math.round(r.legM) + ' m' : '';
  return '+' + Math.round(r.gapM) + ' m';
}

// Penalty badge text, or null: a finished boat's unserved penalties
// ("DSQ" / "+20 s"), else the live pending count ("1 pen").
export function penaltyText(r, pending = 0) {
  if (r.entry && r.entry.unserved && r.entry.unserved.length) return r.entry.dsq ? 'DSQ' : '+' + r.entry.penaltyS + ' s';
  return pending > 0 ? pending + ' pen' : null;
}

export function boatLabel(i, boats) {
  const b = boats && boats[i];
  return b && b.name ? String(b.name) : 'Boat ' + i;
}

// rows: leaderboardState rows; own: own boat index or null; pending: per
// boat index pending penalty count (state.hud.b[i].pending); boats: state.boats.
export function leaderboardViewHtml(rows, { own = null, pending = [], boats = null } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const me = own === null || own === undefined ? null : list.find((r) => r.boat === own);
  const rank = me && Number.isFinite(me.position) ? me.position + '/' + list.length : null;
  const head = '<div class="lb-head finish-title"><span class="lb-title">Leaderboard</span>'
    + (rank ? '<span class="lb-rank sz-chip" aria-label="Rank ' + rank.replace('/', ' of ') + '">' + rank + '</span>' : '') + '</div>';
  if (!list.length) return head + '<div class="lb-empty">no boats</div>';
  const items = list.map((r) => {
    const pen = penaltyText(r, pending[r.boat] || 0);
    const title = r.entry && r.entry.unserved && r.entry.unserved.length ? ' title="' + esc(r.entry.unserved.map(penaltyNameText).join(', ')) + '"' : '';
    const cls = 'lb-row' + (r.boat === own ? ' me' : '') + (pen ? ' pen' : '') + (r.status === 'finished' ? ' fin' : '');
    return '<li class="' + cls + '">'
      + '<span class="lb-pos">' + esc(r.position) + '</span>'
      + '<span class="lb-chip" style="background:' + boatColorCss(r.boat) + '"></span>'
      + '<span class="lb-name">' + esc(boatLabel(r.boat, boats)) + '</span>'
      + '<span class="lb-leg">' + esc(legText(r)) + '</span>'
      + '<span class="lb-gap">' + esc(gapText(r)) + '</span>'
      + (pen ? '<span class="lb-pen sz-chip"' + title + '>' + esc(pen) + '</span>' : '<span class="lb-pen"></span>')
      + '</li>';
  });
  return head + '<ol class="lb-list">' + items.join('') + '</ol>';
}
