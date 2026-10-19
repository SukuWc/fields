// Readout and HUD panels: the host sends the raw values (hudState, part of
// the scene state as state.hud) and every client writes the text and HTML
// (hudFromState, called from scene-build.js buildScene), the same code for
// the local, worker and remote hosts. The strings are the ones the host
// used to build (present.js presentHud before).
//
// hudState(sim, rec) → {
//   d     rec.distSum (absent: leave the Dist readout as it is)
//   tel   the leading boat's telemetry (telemetryState: values the readout
//         floors are sent floored, as integers, in the readout's units)
//   pt    the Phys Time values that follow it
//   st    start HUD state (start.js startHudState) for boat 0
//   co    courseTextState (course.js) for boat 0
//   lb    leaderboard rows (leaderboard.js leaderboardState)
//   b     per boat: twa (rounded, as shown), tacking, onto, pending, cleared, turn { dir, rem },
//         reason, mv (penalty tack/gybe view); default fields omitted
//   bd    boundary distances { z: zone, d: [[side, dist], ...] }
//   br, mr boundary room / mark-room: [[giveWay, rightOfWay, basis, decisive]]
//   own   only with player boats (spawnBoat): per player boat id
//         { tel, st: [start status, startTime] (with a start sequence),
//           co (with a course) }, so each client reads its own boat
//         (hudFromState(h, ownId)); a client without one, and the local and
//         worker modes, read tel / st / co above
// }
// Numbers here travel exactly (no rounding on the server), so the text is
// the same in every host mode.
import { courseTextState, courseTextOf } from './course.js';
import { leaderboardState, leaderboardHtmlOf } from './leaderboard.js';
import { startHudState, startHudHtmlOf, startStatusTextOf } from './start.js';
import { penaltyManeuverText } from './rules.js';

// Telemetry as the readout shows it (info.js boatTelemetryHtml): values it
// floors to whole units or tenths are sent as Math.floor(v) / Math.floor(v * 10);
// the rest (autopilot, heading target, q/d) as they are.
const FLOOR1 = ['error', 'twa', 'awa'];
const FLOOR10 = ['tws', 'aws', 'bs', 'vmg', 'cd', 'cl', 'power'];
export function telemetryState(t) {
  const q = { ...t };
  for (const k of FLOOR1) if (k in q) q[k] = Math.floor(q[k]);
  for (const k of FLOOR10) if (k in q) q[k] = Math.floor(q[k] * 10);
  return q;
}

// boatTelemetryHtml, from telemetryState.
export function telemetryHtmlOf(t) {
  let h = '';
  if (t.depowered) h += '<b>DEPOWERED</b><br>';
  if ('autopilot' in t) h += 'Autopilot' + t.autopilot + '<br>';
  if ('headingTarget' in t) h += 'Heading Target' + t.headingTarget + '<br>';
  if ('qd' in t) h += 'q/d: ' + t.qd + '°<br>';
  if ('error' in t) h += 'error: ' + t.error + '°<br>';
  if ('twa' in t) h += 'TWA: ' + t.twa + '<br>';
  if ('tws' in t) h += 'TWS: ' + t.tws / 10 + '<br>';
  if ('awa' in t) h += 'AWA: ' + t.awa + '<br>';
  if ('aws' in t) h += 'AWS: ' + t.aws / 10 + '<br>';
  if ('bs' in t) h += 'BS: ' + t.bs / 10 + '<br>';
  if ('vmg' in t) h += 'VMG: ' + t.vmg / 10 + '<br>';
  if ('cd' in t) h += 'Cd: ' + t.cd / 10 + '<br>';
  if ('cl' in t) h += 'Cl: ' + t.cl / 10 + '<br>';
  if ('power' in t) h += 'Power: ' + t.power / 10 + '<br>';
  return h;
}

export function hudState(sim, rec) {
  const racing = sim.players;
  const h = {};
  if (rec.distSum !== null) h.d = rec.distSum;
  const k = rec.telemetryIndex;
  if (k >= 0) h.tel = telemetryState(racing[k].telemetry);
  h.pt = rec.physTimes.slice(Math.max(0, k));
  const seq = sim.startSequence;
  if (seq) h.st = startHudState(seq, racing[0]);
  const course = sim.course;
  if (course && racing[0]) h.co = courseTextState(course.progressFor(racing[0]));
  if (course) h.lb = leaderboardState(sim.leaderboard);
  h.b = rec.boats.map((b) => {
    const o = { twa: b.twa === null ? null : Math.round(b.twa) };
    if (b.tacking) { o.tacking = 1; if (b.tackingOnto) o.onto = b.tackingOnto; }
    if (b.pending) o.pending = b.pending;
    if (b.justCleared) o.cleared = 1;
    if (b.penaltyTurn) o.turn = { dir: b.penaltyTurn.dir, rem: b.penaltyTurn.remainingDeg };
    if (b.reason) o.reason = b.reason;
    if (b.maneuverView && b.maneuverView.first) o.mv = { first: b.maneuverView.first, remainingS: b.maneuverView.remainingS };
    return o;
  });
  const boundary = sim.boundary;
  if (boundary) h.bd = { z: boundary.zone, d: racing.map((b) => { const d = boundary.distanceOf(b); return [d.side, d.dist]; }) };
  const room = (kind) => {
    const out = [];
    for (const r of rec.resolutions) {
      const m = r[kind];
      if (m) out.push([racing.indexOf(m.giveWay), racing.indexOf(m.rightOfWay), m.basis, m.decisive ? 1 : 0]);
    }
    return out;
  };
  const br = room('boundaryRoom');
  if (br.length) h.br = br;
  const mr = room('markRoom');
  if (mr.length) h.mr = mr;
  for (const b of racing) {
    if (!b.spawnId) continue;
    const o = {};
    if (b.telemetry) o.tel = telemetryState(b.telemetry);
    if (seq) { const st = seq.statusOf(b); o.st = [st, st === 'started' ? seq.stateFor(b).startTime : null]; }
    if (course) o.co = courseTextState(course.progressFor(b));
    (h.own || (h.own = {}))[b.spawnId] = o;
  }
  return h;
}

// { dist: string | null (null = leave as is), info: string,
//   startHud: { html, flash } | null (null = hidden),
//   results: string | null (null = hidden) }.
// ownId: this client's player boat (spawnBoat id): the telemetry, start
// status and course progress shown are that boat's (h.own); without one, the
// scenario's (tel / st / co).
export function hudFromState(h0, ownId = null) {
  const mine = ownId && h0.own && h0.own[ownId];
  const h = mine ? { ...h0, tel: mine.tel, co: mine.co, st: h0.st && mine.st ? { ...h0.st, st: mine.st[0], t0: mine.st[1] } : h0.st } : h0;
  const out = { dist: null, info: '', startHud: null, results: null };
  if (h.d !== undefined && h.d !== null) out.dist = 'Dist: ' + Math.floor(h.d * 100) / 100 + '<br>';
  // Each boat's step used to reset the readout and append "Phys Time", so the
  // last boat with telemetry leads, followed by one Phys Time per later boat.
  let info = h.tel ? telemetryHtmlOf(h.tel) : '';
  for (const t of h.pt || []) info += 'Phys Time: ' + t + '<br>';
  if (h.st) {
    out.startHud = { html: startHudHtmlOf(h.st), flash: !!h.st.fl };
    if (h.st.st) info += 'Start: ' + startStatusTextOf(h.st.st, h.st.t0) + '<br>';
  }
  if (h.co) info += courseTextOf(h.co) + '<br>';
  if (h.lb) out.results = leaderboardHtmlOf(h.lb, 0);

  // Rules readout, as the step saw it before recording this tick's contacts.
  let showPenaltyKeys = false;
  (h.b || []).forEach((b, i) => {
    const pending = b.pending || 0;
    const twaText = b.twa === null || b.twa === undefined ? '?' : String(b.twa);
    info += 'Boat ' + i + ' TWA ' + twaText + (b.tacking ? ' tacking' + (b.onto ? ' onto ' + b.onto : '') : '') + '<br>';
    if (pending > 0 || b.turn) {
      showPenaltyKeys = true;
      let line = 'Boat ' + i + (pending === 0 && b.cleared ? ' CLEARED' : ' penalty ' + pending);
      if (b.turn) {
        const left = Math.max(0, Math.ceil(b.turn.rem));
        line += ' · ' + (b.turn.dir < 0 ? 'CW ' : 'CCW ') + left + '°';
      }
      if (b.reason) line += ' · ' + b.reason;
      const mv = b.mv ? penaltyManeuverText(b.mv) : null;
      if (mv) line += ' · ' + mv;
      else if (pending > 0) line += ' · needs tack + gybe';
      info += line + '<br>';
    } else if (b.cleared) {
      showPenaltyKeys = true;
      info += 'Boat ' + i + ' CLEARED<br>';
    }
  });
  if (showPenaltyKeys) info += 'Q CCW · E CW<br>';

  if (h.bd) {
    h.bd.d.forEach(([side, dist], i) => {
      info += 'Boat ' + i + ' boundary ' + (side > 0 ? 'east' : 'west') + ' ' + dist.toFixed(1) + ' m' + (dist < 0 ? ' OUTSIDE' : dist <= h.bd.z ? ' (zone)' : '') + '<br>';
    });
  }
  for (const [g, r, basis, dec] of h.br || []) {
    info += 'Boundary room: boat ' + g + ' gives boat ' + r + ' room to tack or gybe away (' + basis + ')' + (dec ? ' · decides fault' : '') + '<br>';
  }
  for (const [g, r, basis, dec] of h.mr || []) {
    info += 'Rule 18.2: boat ' + g + ' gives mark-room to boat ' + r + ' (' + basis + ' at the zone)' + (dec ? ' · decides fault' : '') + '<br>';
  }
  out.info = info;
  return out;
}

