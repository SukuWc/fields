// Rule-call toasts (UI overhaul PR 8, zone E): a short stacked toast when a
// boat is given a penalty or clears one. Client-only, from the frame's rule
// data (host-protocol.js "Rule data"), the same in local, worker and remote:
//   state.pen.boats[] { i id, c pending count, ic incident code | null }
//   state.pen.cleared[] { i id }         (the sim's CLEARED flash)
//   state.pair[] { k, a, b, r, ln }      (encounters in range)
// A new penalty is a rise in a boat's pending count. Its rule is the
// incident code when the frame has one (Rules 31, 18.2, boundary); a
// boat-boat penalty (Rules 10-15) carries none, so the rule and the other
// boat come from the most recent encounter where that boat was the give-way
// boat (within PAIR_MEMORY_S of sim time). With no such encounter the toast
// says "Penalty" with no rule. No DOM in RuleCallTracker; the panel is
// setupRuleToasts below.
import { markText, ruleText } from './rule-text.js';
import { instrumentBoat } from './instrument-readout.js';

export const TOAST_MS = 5000;
export const TOAST_MAX = 3;
const PAIR_MEMORY_S = 5;

// Plain explanation per rule / incident code.
const EXPLAIN = {
  10: 'port keeps clear of starboard',
  11: 'windward keeps clear of leeward',
  12: 'clear astern keeps clear',
  13: 'a tacking boat keeps clear',
  '13b': 'both tacking: both keep clear',
  14: 'avoid contact',
  15: 'no room given after gaining right of way',
  16: 'no room given while changing course',
  18: 'did not give mark-room',
  BR: 'did not give boundary room',
  Bd: 'crossed the boundary',
};

// "Boat <n>" with n the boat's place in state.boats, like the leaderboard
// and the dev readout; the id when it is not in the frame.
export function boatName(id, boats = []) {
  if (id === null || id === undefined) return 'Boat ?';
  const i = boats.findIndex((b) => b && b.id === id);
  return 'Boat ' + (i >= 0 ? i : id);
}

// { ref, text } for a rule / incident code.
export function ruleCallText(code, ic) {
  if (Array.isArray(ic)) {
    if (ic[0] === '31') return { ref: 'Rule 31', text: 'touched ' + markText(ic[1]) };
    if (ic[0] === '18') return { ref: 'Rule 18.2', text: EXPLAIN[18] };
    if (ic[0] === 'BR') return { ref: 'Boundary room', text: EXPLAIN.BR };
    if (ic[0] === 'Bd') return { ref: 'Boundary', text: EXPLAIN.Bd };
  }
  if (code === null || code === undefined) return { ref: 'Penalty', text: 'one turn (tack + gybe) to clear' };
  const c = String(code);
  const ref = c === '13b' ? 'Rule 13' : c === '18' ? 'Rule 18.2' : ruleText(c);
  return { ref, text: EXPLAIN[c] || 'rule broken' };
}

// The deciding rule of one encounter for a boat at fault, or null.
function pairRuleFor(p, id) {
  if (!p) return null;
  if (p.k === 'b' && (p.a === id || p.b === id)) return { code: '13b', other: p.a === id ? p.b : p.a };
  if (p.k === '15' && p.a === id) return { code: '15', other: p.b };
  if (p.b !== id) return null;
  const fin = Array.isArray(p.ln) ? p.ln.find((l) => l && l[1] === 'f') : null;
  const code = fin ? fin[0] : (p.r && p.r !== 'o' ? p.r : null);
  return code ? { code, other: p.a } : null;
}

export class RuleCallTracker {
  constructor() { this.reset(); }
  reset() { this.primed = false; this.counts = new Map(); this.recent = new Map(); this.clearedSeen = new Set(); this.ep = null; this.lastT = -Infinity; }
  // → new calls: [{ kind: 'penalty' | 'cleared', boat, other, ref, text, code, count }]
  update(state) {
    if (!state || !state.boats) return [];
    const t = Number.isFinite(state.ts) ? state.ts : 0;
    if (state.ep !== this.ep || t < this.lastT) { this.reset(); this.ep = state.ep; }
    this.lastT = t;
    const ids = new Set(state.boats.map((b) => b && b.id));
    for (const p of state.pair || []) {
      for (const id of [p.a, p.b]) {
        const r = pairRuleFor(p, id);
        if (r) this.recent.set(id, { ...r, t });
      }
    }
    const out = [];
    const pen = state.pen || { boats: [], cleared: [] };
    const now = new Map();
    for (const e of pen.boats || []) now.set(e.i, e);
    const first = this.counts.size === 0 && !this.primed;
    for (const id of ids) {
      const e = now.get(id);
      const c = e ? e.c || 0 : 0;
      const prev = this.counts.get(id) || 0;
      // a penalty already pending when we first look (joining mid-race) is
      // not a new call
      if (c > prev && !first) {
        let rule = null;
        if (!Array.isArray(e.ic)) {
          const r = this.recent.get(id);
          if (r && t - r.t <= PAIR_MEMORY_S) rule = r;
        }
        const tx = ruleCallText(rule ? rule.code : null, e.ic);
        out.push({ kind: 'penalty', boat: id, other: rule ? rule.other : null, code: rule ? rule.code : (Array.isArray(e.ic) ? e.ic[0] : null), count: c, ...tx });
      }
      this.counts.set(id, c);
    }
    this.primed = true;
    for (const id of [...this.counts.keys()]) if (!ids.has(id)) this.counts.delete(id);
    const cl = new Set((pen.cleared || []).map((e) => e.i));
    for (const id of cl) if (!this.clearedSeen.has(id) && ids.has(id)) out.push({ kind: 'cleared', boat: id, other: null, code: null, count: 0, ref: 'Cleared', text: 'penalty turn done' });
    this.clearedSeen = cl;
    return out;
  }
}

// DOM: #hud_toasts. opts like the instrument panel (own boat by id).
export function setupRuleToasts({ remote = false, lockstep = () => false, onOwnPenalty = null } = {}, doc = document) {
  const root = doc.getElementById('hud_toasts');
  if (!root) return { onFrame() {}, setOwnId() {} };
  root.classList.remove('hud-placeholder');
  const list = doc.createElement('div');
  list.className = 'rule-toasts';
  root.appendChild(list);
  const tracker = new RuleCallTracker();
  let ownId = null;
  const show = (call, state) => {
    const me = instrumentBoat(state.boats, { ownId, remote, lockstep: lockstep() });
    const mine = !!me && (call.boat === me.id);
    const vsMe = !!me && call.other === me.id;
    if (mine && call.kind === 'penalty' && onOwnPenalty) onOwnPenalty(call);
    const el = doc.createElement('div');
    el.className = 'rule-toast ' + call.kind + (mine ? ' own' : '') + (vsMe ? ' vs-own' : '');
    el.setAttribute('role', 'status');
    const who = (id) => boatName(id, state.boats) + (me && id === me.id ? ' (you)' : '');
    let boats = call.kind === 'cleared' ? who(call.boat) : who(call.boat) + ' penalty' + (call.count > 1 ? ' ×' + call.count : '');
    if (call.other !== null && call.other !== undefined) boats += ' · vs ' + who(call.other);
    // Rule 10: tack chips (red port / green starboard are the tack colours)
    const chips = call.code === '10' ? '<span class="sz-chip tack-chip port">P</span><span class="sz-chip tack-chip stbd">S</span>' : '';
    el.innerHTML = `<div class="rt-head"><b class="rt-ref"></b><span class="rt-text"></span>${chips}</div><div class="rt-boats"></div>`;
    el.querySelector('.rt-ref').textContent = call.ref;
    el.querySelector('.rt-text').textContent = call.kind === 'cleared' ? call.text : '— ' + call.text;
    el.querySelector('.rt-boats').textContent = boats;
    list.prepend(el);
    while (list.children.length > TOAST_MAX) list.lastElementChild.remove();
    setTimeout(() => el.remove(), TOAST_MS);
  };
  return {
    setOwnId(id) { ownId = id || null; },
    onFrame(state) { for (const c of tracker.update(state)) show(c, state); },
    _tracker: tracker,
  };
}
