// Rule data in the frame state (host-protocol.js "Rule data"): the sim sends
// rule codes, boat indices and numbers; the client writes the text and
// builds the geometry (rule-text.js, rules.js *FromState, scene-build.js).
//   1. Text tables: every incident / penalty / basis / tack / mark code
//      reads as the strings the sim used to send, and codes round-trip.
//   2. Live frames (encounters, Rule 15, mark touches, mark-room, boundary
//      room and crossings, finish penalties): every rule field has the
//      documented shape, and no state string is rule text.
//   3. The client geometry and text built from state + statics match what
//      the host builds from the boats themselves (resolution.guides, room
//      badges, FAULT badges, readout reasons), also from the server JSON.
import { SimCore } from '../src/host.js';
import { roundJson } from '../apps/server/room.js';
import { buildScene } from '../src/scene-build.js';
import * as T from '../src/rule-text.js';
import * as R from '../src/rules.js';
import { sceneDiff } from './scene-diff.mjs';

let failed = 0;
function check(name, ok, info = '') {
  if (!ok) failed++;
  console.info(`${ok ? 'ok  ' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
}
const log = console.log;
const mute = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = log; } };

// 1. Text tables.
const marks = ['gate 1', 'gate 2', 'gate 12', 'mark 1', 'mark 3', 'finish boat', 'finish pin', 'RC', 'pin', 'mark', 'buoy X'];
const codes = marks.map(T.markCode);
check('mark codes', JSON.stringify(codes) === JSON.stringify(['g1', 'g2', 'g12', 'm1', 'm3', 'fb', 'fp', 'rc', 'pin', 'mk', '=buoy X']), JSON.stringify(codes));
check('mark codes round-trip', marks.every((m) => T.markText(T.markCode(m)) === m));
check('unnamed mark', T.markCode(undefined) === 'mk' && T.markText('mk') === 'mark');
const texts = [
  [T.incidentCode.markTouch('gate 2'), 'Rule 31: touched gate 2', 'Rule 31 · touched gate 2'],
  [T.incidentCode.markTouch('RC', true), 'Rule 31: touched RC (exonerated, rule 21: mark-room)', 'Rule 31 · touched RC'],
  [T.incidentCode.markTouch('mark'), 'Rule 31: touched mark', 'Rule 31 · touched mark'],
  [T.incidentCode.markRoom(), 'Rule 18.2: did not give mark-room', 'Rule 18.2 · mark-room'],
  [T.incidentCode.boundaryRoom(), 'Boundary room: did not give room', 'Boundary room'],
  [T.incidentCode.boundaryCrossed(), 'Boundary: crossed', 'Boundary · crossed'],
];
for (const [ic, reason, label] of texts) {
  check('incident ' + JSON.stringify(ic), T.incidentReason(ic) === reason && T.incidentLabel(ic) === label, T.incidentReason(ic) + ' / ' + T.incidentLabel(ic));
  check('incident ' + JSON.stringify(ic) + ' is compact', ic.every((x) => (typeof x === 'string' && x.length <= 3) || x === 1));
}
check('no code, no text', T.incidentReason(null) === null && T.incidentLabel(undefined) === null && T.incidentReason(['10']) === null);
check('FAULT badge', R.faultText(2, T.incidentLabel(['31', 'g2'])) === 'FAULT x2 · Rule 31 · touched gate 2' && R.faultText(1, T.incidentLabel(null)) === 'FAULT');
const pens = [
  [{ rule: '31', kind: 'mark' }, '31', 'Rule 31'],
  [{ finalId: '18' }, '18', 'Rule 18.2'],
  [{ kind: 'boundary', rule: 'Boundary' }, 'Bd', 'Boundary'],
  [{ finalId: 'BR' }, 'BR', 'Boundary room'],
  [{ finalId: '10' }, '10', 'Rule 10'],
  [{ finalId: '13' }, '13', 'Rule 13'],
  [{ finalRule: 'Rule 12' }, '=Rule 12', 'Rule 12'],
  [{ finalRule: 'penalty' }, '', 'penalty'],
  [null, '', 'penalty'],
];
for (const [inc, code, name] of pens) {
  check('penalty ' + JSON.stringify(inc), R.penaltyCode(inc) === code && T.penaltyNameText(code) === name && R.penaltyRuleName(inc) === name, R.penaltyCode(inc) + ' → ' + T.penaltyNameText(R.penaltyCode(inc)));
}
check('unserved codes', JSON.stringify(T.unservedCodes({ uc: ['31', 'Bd'], unserved: ['Rule 31', 'Boundary'] })) === '["31","Bd"]' && JSON.stringify(T.unservedCodes({ unserved: ['Rule 31'] }).map(T.penaltyNameText)) === '["Rule 31"]');
for (const b of ['overlapped', 'clear ahead', 'east boundary', 'west boundary', 'something else']) check('basis ' + b, T.basisText(T.basisCode(b)) === b && (T.basisCode(b).length === 1 || T.basisCode(b)[0] === '='));
check('basis null', T.basisCode(null) === null && T.basisText(null) === 'null');
check('tack codes', T.tackCode('port') === 'p' && T.tackCode('starboard') === 's' && T.tackText('p') === 'port' && T.tackText('s') === 'starboard');
for (const [code, text] of Object.entries(T.RULE_TEXT)) check('rule code ' + code, T.ruleText(code) === text && T.ruleCode(text) === code);

// 2. and 3. Live frames.
const RULE_CODES = new Set(Object.keys(T.RULE_TEXT));
const IC_RULES = new Set(['31', '18', 'BR', 'Bd']);
const isIdx = (i, n) => Number.isInteger(i) && i >= 0 && i < n;
const validIc = (ic) => Array.isArray(ic) && IC_RULES.has(ic[0]) && (ic[0] !== '31' || (typeof ic[1] === 'string' && (ic.length === 2 || ic[2] === 1))) && (ic[0] === '31' || ic.length === 1);
const validPen = (c) => typeof c === 'string' && (c === '' || c[0] === '=' || /^[0-9A-Za-z]{1,3}$/.test(c));
// Strings that may appear in a state: codes and enum ids, never sentences.
const RULE_WORDS = /Rule|touched|room|FAULT|GIVES|GETS|Boundary|crossed|exonerated|port|starboard|overlapped|clear ahead/;
const stringsOf = (v, path, out) => {
  if (typeof v === 'string') out.push([path, v]);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) stringsOf(x, path + '.' + k, out);
  return out;
};
const view = { camera_position_x: 0, camera_position_y: 0, camera_zoom: 20, show_forces: false, show_fields: false };
const seen = { pair: 0, sm: 0, k15: 0, kb: 0, pen: 0, penIc: 0, hudIc: 0, mr: 0, br: 0, fin: 0, finPen: 0, lbPen: 0 };
const bad = [];
const wordy = [];
let maxGeom = 0, maxRemote = 0, textSame = true, hostSame = true, badgeSame = true, reasonSame = true;
// [scenario, ticks, finish]: 8 / 9 encounters (Rules 10-13, 15), 15
// mark-room (18.2), 19 boundary room and crossings, 16 a mark touch
// penalty: boat 1 is finished with it unserved, then boat 0 (RaceResults
// record on the race clock).
for (const [n, ticks, fin] of [[8, 300], [9, 300], [15, 300], [19, 450], [16, 150, true]]) {
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f' });
  mute(() => core.command({ type: 'restart', scenario: n }));
  const sim = core.sim;
  let rec = null;
  const step = sim.step.bind(sim);
  sim.step = (...a) => (rec = step(...a));
  let statics = null;
  mute(() => {
    for (let t = 0; t < ticks; t++) {
      if (fin && (t === 30 || t === 60)) {
        const seq = sim.startSequence, res = sim.raceResults;
        const i = t === 30 ? 1 : 0;
        res.record(sim.players[i], i, seq ? seq.clock : res.relClock(sim.rulesTime));
      }
      const f = core.tick({ dt: 1 / 30, held: [], present: true, view });
      if (f.statics) statics = f.statics;
      const s = f.state;
      const nb = s.boats.length;
      // Shapes.
      for (const p of s.pair || []) {
        seen.pair++;
        if (p.k === '15') seen.k15++;
        if (p.k === 'b') seen.kb++;
        const keys = Object.keys(p).filter((k) => !['k', 'a', 'b', 'r', 'bl', 'pr', 'sm', 'ln'].includes(k));
        if (keys.length || !['o', '15', 'b'].includes(p.k) || !isIdx(p.a, nb) || !isIdx(p.b, nb) || p.a === p.b) bad.push(['pair', n, t, p]);
        if (p.k !== '15' && !RULE_CODES.has(p.r)) bad.push(['pair.r', n, t, p.r]);
        if (p.k === '15' && (!RULE_CODES.has(p.bl) || !(p.pr >= 0 && p.pr <= 1))) bad.push(['pair.15', n, t, p]);
        if (p.sm && !p.sm.every((i) => isIdx(i, nb))) bad.push(['pair.sm', n, t, p.sm]);
        if (p.sm) seen.sm += p.sm.length;
        if (!Array.isArray(p.ln) || !p.ln.every((l) => l.length === 3 && RULE_CODES.has(l[0]) && ['f', 'i', 'o'].includes(l[1]))) bad.push(['pair.ln', n, t, p.ln]);
      }
      for (const e of (s.pen && s.pen.boats) || []) {
        seen.pen++;
        if (!isIdx(e.i, nb) || !(e.c >= 0) || 'lb' in e) bad.push(['pen', n, t, e]);
        if (e.ic !== null) { seen.penIc++; if (!validIc(e.ic)) bad.push(['pen.ic', n, t, e.ic]); }
      }
      for (const b of s.hud.b || []) {
        if ('reason' in b) bad.push(['hud.reason', n, t, b]);
        if (b.ic) { seen.hudIc++; if (!validIc(b.ic)) bad.push(['hud.ic', n, t, b.ic]); }
        if (b.onto && !['p', 's'].includes(b.onto)) bad.push(['hud.onto', n, t, b.onto]);
      }
      for (const k of ['mr', 'br']) {
        for (const m of s[k] || []) { seen[k]++; if (!Array.isArray(m) || m.length !== 2 || !isIdx(m[0], nb) || !isIdx(m[1], nb)) bad.push([k, n, t, m]); }
        for (const m of s.hud[k] || []) if (!isIdx(m[0], nb) || !isIdx(m[1], nb) || !(m[2] === null || ['o', 'a', 'e', 'w'].includes(m[2]) || m[2][0] === '=') || ![0, 1].includes(m[3])) bad.push(['hud.' + k, n, t, m]);
      }
      for (const l of (s.finish && s.finish.labels) || []) { seen.fin++; if (l.unserved.length) seen.finPen++; if (!l.unserved.every(validPen)) bad.push(['finish', n, t, l]); }
      for (const r of (s.hud.lb || [])) if (r.entry && r.entry.unserved.length) { seen.lbPen++; if (!r.entry.unserved.every(validPen)) bad.push(['lb', n, t, r.entry]); }
      for (const [path, str] of stringsOf(s, 's', [])) if (RULE_WORDS.test(str)) wordy.push(n + ' ' + path + ' ' + str);
      // Client geometry vs the host's own (from the boat objects).
      const at = R.pairBoatsFromState(s.boats, statics.defs);
      const players = sim.players;
      let k = 0;
      for (const r of rec.resolutions) {
        if (!r.pairState) continue;
        const p = s.pair[k++];
        const d = sceneDiff(R.pairGuidesFromState(p, at), r.guides);
        // Stern marks: equal up to rounding on a boat's first frame (planck's
        // body transform vs its angle before the first step).
        if (d > 1e-12) hostSame = false;
        maxGeom = Math.max(maxGeom, d);
      }
      if (k !== (s.pair || []).length) hostSame = false;
      for (const [key, kind] of [['mr', 'markRoom'], ['br', 'boundaryRoom']]) {
        const host = kind === 'markRoom' ? R.markRoomGuides(rec.resolutions, players) : R.boundaryRoomGuides(rec.resolutions, players);
        if (sceneDiff(R.roomGuidesFromState(s[key] || [], kind, s.boats), host) !== 0) hostSame = false;
      }
      for (const e of (s.pen && s.pen.boats) || []) {
        if (e.c > 0 && R.faultText(e.c, T.incidentLabel(e.ic)) !== R.faultBadgeText(players[e.i])) badgeSame = false;
      }
      s.hud.b.forEach((b, i) => { if ((T.incidentReason(b.ic) || null) !== (rec.boats[i].reason || null)) reasonSame = false; });
      // From the server's rounded JSON: same text, geometry within 1e-3.
      if (t % 7 === 0 && statics) {
        const local = buildScene(s, statics, view, null);
        const remote = buildScene(JSON.parse(roundJson(s)), JSON.parse(roundJson(statics)), view, null);
        const lab = (sc) => JSON.stringify(sc.guides.filter((g) => g.type === 'label').map((g) => [g.text, g.lines && g.lines.map((l) => l.text)])) + JSON.stringify(sc.hud).replace(/Phys Time: [^<]*/g, '');
        if (lab(local) !== lab(remote)) textSame = false;
        maxRemote = Math.max(maxRemote, sceneDiff({ g: local.guides }, { g: remote.guides }));
      }
    }
  });
}
check('rule data shapes', bad.length === 0, bad.length ? JSON.stringify(bad.slice(0, 3)) : JSON.stringify(seen));
check('covered: pairs, stern marks, Rule 15, penalties with codes, mark-room, boundary room, finish penalties', seen.pair > 100 && seen.sm > 50 && seen.k15 > 0 && seen.penIc > 0 && seen.hudIc > 0 && seen.mr > 0 && seen.br > 0 && seen.finPen > 0 && seen.lbPen > 0, JSON.stringify(seen));
check('no rule text in the state', wordy.length === 0, wordy.slice(0, 3).join(' | '));
check('pair overlays: client geometry = host geometry', hostSame, 'max ' + maxGeom.toExponential(2));
check('FAULT badges: client text = host text', badgeSame);
check('readout reasons: client text = host text', reasonSame);
check('from the server JSON: same text', textSame);
check('from the server JSON: geometry within 1e-3', maxRemote <= 1e-3, maxRemote.toExponential(2));

console.info(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
