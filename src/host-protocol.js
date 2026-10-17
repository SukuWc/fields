// Message protocol shared by every out-of-process SimHost: the worker
// (sim.worker.js ↔ worker-host.js) and the WebSocket server
// (apps/server ↔ remote-host.js). Plain objects only.
//
// Client → host
//   { type: 'init', opts }          SimCore options (mapW, mapH, simRes, ...)
//   { type: 'command', id, c }      → { type: 'result', id, r }
//   { type: 'query', id, q }        → { type: 'result', id, r }
//   { type: 'tick', req }           → { type: 'frame', frame }  (client-driven ticks:
//                                     the worker, or a server started with --lockstep)
//   { type: 'input', held, view }   held keys and camera for a server that ticks on
//                                     its own clock (remote, authoritative)
//   { type: 'perf', on }
//   { type: 'field', on, plotType, contrastExp }  server: send this client field grid
//                                     messages (fieldPainter.js) or stop
// Host → client
//   { type: 'info', info }          info also carries mode: 'client' | 'server' (who ticks)
//   { type: 'event', ev }           Sim events; bindControls carries boats
//   { type: 'frame', frame }        plus the field texture: transferred (worker) or a
//                                     binary field grid message to clients
//                                     showing the field (server, apps/server/room.js)

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

// The client View as plain data (what presentStep reads).
export function plainView(v) {
  return v ? {
    camera_position_x: v.camera_position_x, camera_position_y: v.camera_position_y,
    camera_zoom: v.camera_zoom, show_forces: v.show_forces, show_fields: v.show_fields,
  } : null;
}
