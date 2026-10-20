// Rule text from rule data. The rules engine (rules.js, mark-touch.js,
// boundary.js, finish.js) records incidents and penalties as codes; the
// client writes the words (scene-build.js / hud.js, every host mode), and the
// sim uses the same functions for its own reason / label strings (headless
// checks). No sim state here: plain data in, text out.
// The formats are documented in host-protocol.js ("Rule data").

// Mark names (mark-touch.js nameMarks) as short codes: gate n → 'gn',
// mark n → 'mn', the finish boat / pin → 'fb' / 'fp', the start line
// committee boat / pin → 'rc' / 'pin', an unnamed mark → 'mk'. Any other name
// travels as '=' + name.
export function markCode(name) {
  if (name === undefined || name === null || name === 'mark') return 'mk';
  const m = /^(gate|mark) (\d+)$/.exec(name);
  if (m) return (m[1] === 'gate' ? 'g' : 'm') + m[2];
  if (name === 'finish boat') return 'fb';
  if (name === 'finish pin') return 'fp';
  if (name === 'RC') return 'rc';
  if (name === 'pin') return 'pin';
  return '=' + name;
}

export function markText(code) {
  if (typeof code !== 'string' || code === 'mk') return 'mark';
  if (code[0] === '=') return code.slice(1);
  const m = /^([gm])(\d+)$/.exec(code);
  if (m) return (m[1] === 'g' ? 'gate ' : 'mark ') + m[2];
  if (code === 'fb') return 'finish boat';
  if (code === 'fp') return 'finish pin';
  if (code === 'rc') return 'RC';
  if (code === 'pin') return 'pin';
  return code;
}

// Incident codes (incident.ic, state.pen.boats[].ic, state.hud.b[].ic):
//   ['31', mark, ex?]  Rule 31 mark touch (mark: markCode; ex: 1 when
//                      exonerated by rule 21, mark-room)
//   ['18']             Rule 18.2: did not give mark-room
//   ['BR']             boundary room: did not give room
//   ['Bd']             boundary crossed
// A boat-boat incident decided by another rule has no code (no reason).
export const incidentCode = {
  markTouch: (markName, exonerated = false) => (exonerated ? ['31', markCode(markName), 1] : ['31', markCode(markName)]),
  markRoom: () => ['18'],
  boundaryRoom: () => ['BR'],
  boundaryCrossed: () => ['Bd'],
};

// Readout reason ("Rule 31: touched gate 2"), or null.
export function incidentReason(ic) {
  if (!Array.isArray(ic)) return null;
  switch (ic[0]) {
    case '31': return 'Rule 31: touched ' + markText(ic[1]) + (ic[2] ? ' (exonerated, rule 21: mark-room)' : '');
    case '18': return 'Rule 18.2: did not give mark-room';
    case 'BR': return 'Boundary room: did not give room';
    case 'Bd': return 'Boundary: crossed';
    default: return null;
  }
}

// FAULT badge label ("Rule 31 · touched gate 2"), or null.
export function incidentLabel(ic) {
  if (!Array.isArray(ic)) return null;
  switch (ic[0]) {
    case '31': return 'Rule 31 · touched ' + markText(ic[1]);
    case '18': return 'Rule 18.2 · mark-room';
    case 'BR': return 'Boundary room';
    case 'Bd': return 'Boundary · crossed';
    default: return null;
  }
}

// Penalty names (finish results "+20 s (Rule 31)", leaderboard rows):
// the rule id that decided the incident. '31' Rule 31, '18' Rule 18.2,
// 'Bd' Boundary, 'BR' Boundary room, another id (e.g. '10') "Rule <id>",
// '' "penalty", '=' + text for anything else (literal).
const PENALTY_NAME = { 31: 'Rule 31', 18: 'Rule 18.2', Bd: 'Boundary', BR: 'Boundary room', '': 'penalty' };

export function penaltyNameText(code) {
  if (typeof code !== 'string') return 'penalty';
  if (code in PENALTY_NAME) return PENALTY_NAME[code];
  if (code[0] === '=') return code.slice(1);
  return 'Rule ' + code;
}

// A finish entry's unserved penalties as codes (entries recorded without codes:
// their names as literal text).
export function unservedCodes(e) {
  return Array.isArray(e.uc) ? e.uc.slice() : e.unserved.map((n) => '=' + n);
}

// Pair overlay rule codes (state.pair r / bl / ln): the resolver's rule id
// (rules.js ruleRegistry), '13b' for Rule 13 with both boats tacking. An
// unlisted numeric code reads "Rule <code>"; a rule with no id travels as
// '=' + its name.
export const RULE_TEXT = {
  10: 'Rule 10', 11: 'Rule 11', 12: 'Rule 12', 13: 'Rule 13', '13b': 'Rule 13 both',
  15: 'Rule 15', 18: 'Rule 18.2 mark-room', BR: 'Boundary room',
};
const RULE_CODE = Object.fromEntries(Object.entries(RULE_TEXT).map(([k, v]) => [v, k]));
export const ruleCode = (text) => (text in RULE_CODE ? RULE_CODE[text] : '=' + text);
export function ruleText(code) {
  if (typeof code !== 'string' && typeof code !== 'number') return 'Rule ?';
  code = String(code);
  if (code in RULE_TEXT) return RULE_TEXT[code];
  if (code[0] === '=') return code.slice(1);
  return /^\d/.test(code) ? 'Rule ' + code : code;
}
export const ROLE_CODE = { inhibited: 'i', final: 'f', other: 'o' };
export const ROLE_TEXT = { i: 'inhibited', f: 'final', o: 'other' };
// Unknown roles read as 'other'.
export const roleText = (code) => (Object.prototype.hasOwnProperty.call(ROLE_TEXT, code) ? ROLE_TEXT[code] : 'other');

// Basis of a mark-room / boundary-room obligation (state.hud.mr / br):
// 'o' overlapped, 'a' clear ahead (Rule 18 at the zone), 'e' / 'w' east /
// west boundary (boundary room); anything else '=' + text.
const BASIS_CODE = { overlapped: 'o', 'clear ahead': 'a', 'east boundary': 'e', 'west boundary': 'w' };
const BASIS_TEXT = Object.fromEntries(Object.entries(BASIS_CODE).map(([k, v]) => [v, k]));
export function basisCode(text) {
  if (text === null || text === undefined) return null;
  return text in BASIS_CODE ? BASIS_CODE[text] : '=' + text;
}
export function basisText(code) {
  if (code === null || code === undefined) return String(code);
  if (code in BASIS_TEXT) return BASIS_TEXT[code];
  return code[0] === '=' ? code.slice(1) : code;
}

// Tack names (state.hud.b[].onto): 'p' port, 's' starboard.
export const tackCode = (tack) => (tack === 'port' ? 'p' : tack === 'starboard' ? 's' : tack);
export const tackText = (code) => (code === 'p' ? 'port' : code === 's' ? 'starboard' : code);
