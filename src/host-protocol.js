// Message protocol shared by every out-of-process SimHost: the worker
// (sim.worker.js ↔ worker-host.js) and the WebSocket server
// (apps/server ↔ remote-host.js). Plain objects only.
//
// Client → host (both)
//   { type: 'init', opts }          SimCore options (mapW, mapH, simRes, ...;
//                                     server: plus scenario, used only by the
//                                     client that creates the room)
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
// on its own boats) or room-wide (apps/server/room.js ROOM_COMMANDS: restart,
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
