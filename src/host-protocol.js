// Message protocol shared by every out-of-process SimHost: the worker
// (sim.worker.js ↔ worker-host.js) and the WebSocket server
// (apps/server ↔ remote-host.js). Plain objects only.
//
// Client → host (both)
//   { type: 'init', opts, token? }  SimCore options (mapW, mapH, simRes, ...;
//                                     server: plus scenario, used only by the
//                                     client that creates the room; token: the
//                                     client's id across reconnects, room.js GRACE_MS)
//   { type: 'command', id, c }      → { type: 'result', id, r }
//                                     (server: r = { error } when refused)
//   { type: 'query', id, q }        → { type: 'result', id, r }
//   { type: 'tick', req }           → { type: 'frame', frame }  (client-driven ticks:
//                                     the worker, or a server started with --lockstep)
//   { type: 'perf', on }            perf counters in this client's frames
// Client → server only
//   { type: 'input', held }         held keys for a server that ticks on its own
//                                     clock (remote, authoritative); applied to
//                                     this client's own boats only
//   { type: 'field', on, plotType, contrastExp }  send this client field grid
//                                     messages (fieldPainter.js) or stop
//   { type: 'flow', on }            send this client flow tracer grids or stop
// Commands, server: per client (plot, spawnBoat, removeBoat, boat actions
// on its own boats) or room-wide (settings-registry.js ROOM_COMMANDS, validated by apps/server/room.js: restart,
// wind, devMode, barrier, simRes, amrMode, cellBudget, options; validated).
//
// Host → client
//   { type: 'info', info }          worker: the start info
//   { type: 'welcome', info, room, own, bindings }
//                                   server: the reply to init. info also carries
//                                     mode: 'client' | 'server' (who ticks);
//                                     room: { scenario: { index, title,
//                                     description }, settings, lattice }
//                                     (host.js SimCore.roomState); own: this
//                                     client's boats; bindings: boats its keys drive
//   { type: 'event', ev }           Sim events (bindControls carries boats), plus
//                                     server: { type: 'room', room } after every
//                                     room-wide change (to all), and per client
//                                     { type: 'ownBoats', boats } and
//                                     { type: 'bindControls', boats }
//   { type: 'frame', frame }        plus the field texture: transferred (worker) or a
//                                     binary field grid message to clients
//                                     showing the field (server, apps/server/room.js)
//                                   frame.state: compact scene state (scene-state.js);
//                                     frame.statics only when they changed (worker);
//                                     frame.flow / frame.perf (worker; from the
//                                     server as the messages below)
//   { type: 'statics', sv, statics } server: shapes and layouts for frame.state,
//                                     sent to a client before the first frame of
//                                     version sv it gets (join, restart, new boat)
//   { type: 'flow', flow }          server: flow tracer grid for the next frame,
//                                     to clients subscribed with 'flow'
//   { type: 'perf', perf }          server: perf counters for the next frame,
//                                     to clients subscribed with 'perf'
// Frames and statics from the server have numbers rounded to 1e-4 (room.js).
//
// Rule data (frame.state; the rules engine is rules.js, mark-touch.js,
// boundary.js, finish.js in the sim; every client writes the text and builds
// the geometry with scene-build.js / hud.js and rule-text.js). No rule text
// or overlay geometry travels: rule ids / codes, boat ids (state.boats[i].id:
// 's<n>' scenario boats, the spawn id for player boats; stable across
// spawnBoat / removeBoat, unlike positions in the list) and the numbers the
// text needs. A boat id not in this frame's state.boats (stale) draws no
// overlay.
//   Rule codes (r, bl, ln[0]): the resolver's rule id (rules.js
//     ruleRegistry): '10', '11', '12', '13', '13b' (Rule 13, both tacking),
//     '15', '18' (Rule 18.2 mark-room), 'BR' (boundary room); another
//     numeric id reads "Rule <id>" (e.g. '14'); '=' + name for a rule with
//     no id (rule-text.js ruleText).
//   state.pair: [{ k, a, b, r?, bl?, pr?, sm?, ln }] one per encounter in
//     range (rules.js pairStateFor):
//       k   'o' one boat keeps clear | '15' Rule 15 (room after acquiring
//           right of way) | 'b' Rule 13, both tacking (both keep clear)
//       a, b boat ids: right-of-way, give-way ('b': the two boats); the
//           lines run from their midpoint to those boats' x, y
//       r   label rule code ('o', 'b')
//       bl, pr  ('15') the blocked rule's code (label "Rule 15 (blocks
//           Rule 11)") and the room-owed progress 0..1
//       sm  boat ids with a stern mark (Rules 11, 12: the rule she sails
//           under now): the client takes the aftermost hull station from
//           the boat's state (px, py, pa, ha) and statics.hulls[id].v (local
//           hull vertices, flat [x0, y0, ...])
//       ln  label stack, highest layer first: [[rule code, role, rule id]],
//           role 'f' final | 'i' inhibited | 'o' other applicable (an
//           unknown role reads as 'o')
//   Incident codes (ic; rule-text.js incidentReason / incidentLabel):
//       ['31', mark, ex?] Rule 31 mark touch; mark: 'g<n>' gate n,
//                         'm<n>' mark n, 'fb' / 'fp' finish boat / pin,
//                         'rc' / 'pin' start line ends, 'mk' unnamed,
//                         '=' + name otherwise; ex 1: exonerated (rule 21)
//       ['18']            Rule 18.2: did not give mark-room
//       ['BR']            boundary room: did not give room
//       ['Bd']            boundary crossed
//     (a boat-boat penalty decided by Rules 10-15 has none: plain FAULT)
//   state.pen.boats[]: { i boat id, c pending count, ic of the oldest
//     penalty | null (FAULT badge "FAULT x2 · Rule 31 · touched gate 2"),
//     t: { sh start heading, pd degrees turned, dir, left } (Q / E circle)
//     | null, mv: { first 'tack' | 'gybe', remainingS } | null };
//     cleared: [{ i (boat id), c }] CLEARED flashes
//   state.hud.b[]: ic (oldest pending penalty, readout reason "Rule 31:
//     touched gate 2"), onto 'p' / 's' (tacking onto port / starboard)
//   state.hud.br / mr: [[give-way, right-of-way (boat ids), basis,
//     decisive 0 | 1]], basis 'o' overlapped | 'a' clear ahead (mark-room at
//     the zone) | 'e' / 'w' east / west boundary | '=' + text
//   state.br / mr: room badges [[r, g]] (rules.js roomGuideState): boat
//     ids of the boat that gets mark-room / boundary room and the one that
//     gives it ("GIVES MARK-ROOM → boat n", n her position in state.boats,
//     above the higher boat)
//   Penalty names (state.finish.labels[].unserved,
//     state.hud.lb[].entry.unserved; rule-text.js penaltyNameText): '31'
//     Rule 31, '18' Rule 18.2, 'Bd' Boundary, 'BR' Boundary room, another
//     rule id "Rule <id>", '' penalty, '=' + text otherwise

// Objects marked here (and everything inside them) keep their numbers exact
// in the server's rounded JSON (apps/server/room.js roundJson): values that
// end up as text (HUD readouts, badges) must read the same in every mode.
// A symbol property: not serialised, not structured-cloned (the worker
// copies everything exactly anyway).
export const EXACT_JSON = Symbol.for('fields.exactJson');
export function markExact(o) {
  if (o && typeof o === 'object' && !o[EXACT_JSON]) {
    Object.defineProperty(o, EXACT_JSON, { value: true });
    for (const k in o) markExact(o[k]);
  }
  return o;
}

// Sim event as sent to clients.
export function eventForClient(core, ev) {
  return ev.type === 'bindControls' ? { ...ev, boats: core.sim.players.length } : ev;
}

// Reply to a command or query message, or null for other types.
export function answer(core, m) {
  if (m.type === 'command') return { type: 'result', id: m.id, r: core.command(m.c) };
  if (m.type === 'query') return { type: 'result', id: m.id, r: core.query(m.q) };
  return null;
}

// The client View as plain data (what the presenters read).
export function plainView(v) {
  return v ? {
    camera_position_x: v.camera_position_x, camera_position_y: v.camera_position_y,
    camera_zoom: v.camera_zoom, show_forces: v.show_forces, show_fields: v.show_fields,
  } : null;
}
