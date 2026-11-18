// Chat timestamps and the rule-call lines of the chat stream (no DOM).
//
// Timestamps. Every chat line shows when it was said:
//   - race time, relative to the starting signal, in the race clock's own
//     format (start.js formatStartClock): "−0:45" before the start, "+2:13"
//     after it, whenever the message carries a race clock (rc, seconds);
//   - otherwise the local wall-clock time "14:05" (HH:MM, 24 h) of the
//     message's server time (at, ms since the epoch) or, for a line made on
//     this client, its receive time.
// The full local wall-clock time (HH:MM:SS) is the line's tooltip either way.
// The server stamps rc (and at) on every room message (apps/server/room.js
// _chatPush), so all players see the same stamps. Rule lines are made on each
// client from the frame they appear in (rule-toasts.js RuleCallTracker), with
// rc from that frame's start clock (state.hud.st.clock): the same frame, so
// the same stamp, on every client.
//
// Rule lines: { sys: true, rule: 'penalty' | 'cleared', text, rc?, at, key,
// local: true }. RuleChatFeed turns tracker calls into these and drops
// repeats of the same incident (same boat, rule, other boat and count within
// DEDUPE_S of race / sim time); a boat's cleared penalty forgets her
// penalties, so a new one after it is a new line.
import { formatStartClock } from './start.js';

export const DEDUPE_S = 10;

const pad2 = (n) => String(n).padStart(2, '0');

// The race clock (s from the starting signal) of a frame, or null.
export function raceClockOf(state) {
  const st = state && state.hud && state.hud.st;
  return st && Number.isFinite(st.clock) ? st.clock : null;
}

// { text, title } for a message (receive time `now` when it has no at).
export function chatTimeOf(msg, now = Date.now()) {
  const at = msg && Number.isFinite(msg.at) ? msg.at : null;
  const d = at !== null ? new Date(at) : new Date(now);
  const wall = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  const title = wall + ':' + pad2(d.getSeconds());
  if (msg && Number.isFinite(msg.rc)) return { text: formatStartClock(msg.rc), title: 'Race time ' + formatStartClock(msg.rc) + ' · ' + title };
  return { text: wall, title };
}

// A boat in a chat line: "Ann #1" with a player name (statics.defs), else
// "Boat 1"; n is her place in state.boats like the leaderboard and toasts.
export function chatBoatName(id, state, statics) {
  const boats = (state && state.boats) || [];
  const i = boats.findIndex((b) => b && b.id === id);
  if (i < 0) return id === null || id === undefined ? 'Boat ?' : 'Boat ' + id;
  const def = statics && Array.isArray(statics.defs) ? statics.defs[i] : null;
  return def && def.name ? def.name + ' #' + i : 'Boat ' + i;
}

// "RRS 10 port/starboard" style rule name for a chat line.
function rrs(ref) {
  const r = String(ref || '');
  return /^Rule /.test(r) ? 'RRS ' + r.slice(5) : r;
}

// The chat text of one tracker call.
export function ruleChatText(call, state, statics) {
  const who = (id) => chatBoatName(id, state, statics);
  if (call.kind === 'cleared') {
    let t = '✓ ' + who(call.boat) + ' cleared ' + (call.cleared ? 'the ' + rrs(call.cleared) + ' penalty' : 'a penalty') + ' (turn done)';
    if (call.count > 0) t += ' · ' + call.count + ' still to take';
    return t;
  }
  const rule = call.ref === 'Penalty' ? 'Penalty' : rrs(call.ref) + ' (' + call.text + ')';
  let t = '⚑ ' + who(call.boat) + ' · ' + rule;
  if (call.other !== null && call.other !== undefined) t += ' vs ' + who(call.other);
  t += ' · one-turn penalty (tack + gybe)';
  if (call.count > 1) t += ' · ' + call.count + ' pending';
  return t;
}

export class RuleChatFeed {
  constructor({ dedupeS = DEDUPE_S } = {}) { this.dedupeS = dedupeS; this.seen = new Map(); this.ep = undefined; }
  // calls: RuleCallTracker.update output for this frame → chat messages.
  messages(calls, state, statics, nowMs = Date.now()) {
    if (!calls || !calls.length || !state) return [];
    if (state.ep !== this.ep) { this.seen.clear(); this.ep = state.ep; }
    const t = Number.isFinite(state.ts) ? state.ts : 0;
    const rc = raceClockOf(state);
    const out = [];
    for (const c of calls) {
      const key = [c.kind, c.boat, c.code ?? '', c.other ?? '', c.count].join('|');
      const last = this.seen.get(key);
      if (last !== undefined && Math.abs(t - last) <= this.dedupeS) continue;
      this.seen.set(key, t);
      if (c.kind === 'cleared') for (const k of [...this.seen.keys()]) if (k.startsWith('penalty|' + c.boat + '|')) this.seen.delete(k);
      const msg = { sys: true, local: true, rule: c.kind, key: key + '|' + t, text: ruleChatText(c, state, statics), at: nowMs };
      if (rc !== null) msg.rc = rc;
      out.push(msg);
    }
    return out;
  }
}
