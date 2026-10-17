// One room = one authoritative SimCore (src/host.js) and the clients
// connected to it. Speaks the host protocol (src/host-protocol.js).
//
// Ticks: by default the room runs on its own fixed 30 Hz clock (see _start:
// a frame is broadcast at the end of its slot, never faster than 30 Hz, no
// catch-up bursts) and sends every frame to every client. Held keys are the union of every
// client's latest 'input'. With lockstep the first client's 'tick'
// messages drive the room instead (reproducible runs, tests).
//
// Field streaming: the painter paints a reduced texture (FIELD_OVERSAMPLING
// texels per root cell at resolution 1, i.e. 1 m per texel on the default 4f
// grid: 100 × 200 × 4 B = 80 KB) and only on ticks that are due, at most
// fieldHz per second (default FIELD_HZ). Each paint goes to the clients as one
// binary message: u32 width, u32 height (LE), RGBA bytes. fieldHz 0 = no field.
import { SimCore } from '../../src/host.js';
import { answer, eventForClient } from '../../src/host-protocol.js';
import { BOAT_ACTIONS } from '../../src/sim.js';

// Player boats: a client may spawn boats ({ type: 'spawnBoat', name?, color? })
// and owns them. While it owns any, its boat commands and held keys are
// remapped: { boat: k } means its k-th own boat (boatId), so they never reach
// scenario boats or other players' boats. A client without boats keeps the
// old behaviour (keys drive scenario boats 0/1). removeBoat only works on own
// boats; a disconnect removes them all; a scenario restart (room-wide) clears
// every boat, so ownership is dropped. Each client hears its list as
// { type: 'event', ev: { type: 'ownBoats', boats: [{ id, name }] } }.

export const TICK_HZ = 30;
export const FIELD_HZ = 2;
export const FIELD_OVERSAMPLING = 1;

export class Room {
  constructor(name, { lockstep = false, fieldHz = FIELD_HZ, fieldOversampling = FIELD_OVERSAMPLING, now = () => performance.now() } = {}) {
    this.name = name;
    this.lockstep = lockstep;
    this.fieldHz = fieldHz;
    this.fieldOversampling = fieldOversampling;
    this.now = now;
    this.core = null;
    this.clients = new Set();
    this.inputs = new Map();
    this.owned = new Map();
    this.ticks = 0;
    this.broadcasts = 0;
    this.timer = null;
    this.tickMs = 0;
  }

  // First client's init options build the Sim; later clients join it.
  _create(opts) {
    const o = opts || {};
    const core = new SimCore({
      mapW: o.mapW || 100, mapH: o.mapH || 200, windAngle: o.windAngle ?? 90, windSpeed: o.windSpeed ?? 15,
      simRes: o.simRes || '4f', oversampling: this.fieldOversampling,
      texture: { image: { data: new Uint8Array(0) } },
    });
    // Paint only when a field message is due (painting is the costly part).
    const painter = core.painter;
    const paint = painter.paint.bind(painter);
    this._fieldDue = false;
    this._painted = false;
    painter.paint = (bm) => { if (this._fieldDue) { paint(bm); this._painted = true; } };
    core.sim.on((ev) => {
      if (ev.type === 'cleared') this._dropOwnership();
      this.broadcast({ type: 'event', ev: eventForClient(core, ev) });
    });
    this.core = core;
    if (!this.lockstep) this._start();
  }

  info() { return { ...this.core.info(), mode: this.lockstep ? 'client' : 'server', room: this.name }; }

  join(client) { this.clients.add(client); }

  leave(client) {
    for (const b of this.owned.get(client) || []) this.core.command({ type: 'removeBoat', id: b.id });
    this.owned.delete(client);
    this.clients.delete(client);
    this.inputs.delete(client);
    if (this.clients.size === 0) this.stop();
  }

  send(client, m) { client.send(JSON.stringify(m)); }
  broadcast(m) { const s = JSON.stringify(m); for (const c of this.clients) c.send(s); }

  message(client, m) {
    if (m.type === 'init') {
      if (!this.core) this._create(m.opts);
      this.send(client, { type: 'info', info: this.info() });
      // A late joiner gets the key binding the scenario handed out.
      const n = this.core.sim.players.length;
      if (n > 0) this.send(client, { type: 'event', ev: { type: 'bindControls', boats: n } });
      return;
    }
    if (!this.core) return;
    if (m.type === 'command' && m.c) {
      const c = m.c;
      if (c.type === 'spawnBoat') {
        const r = this.core.command({ type: 'spawnBoat', name: c.name, color: c.color });
        const list = this.owned.get(client) || [];
        list.push({ id: r.id, name: r.name });
        this.owned.set(client, list);
        this.send(client, { type: 'result', id: m.id, r });
        this._sendOwn(client);
        return;
      }
      if (c.type === 'removeBoat') {
        const list = this.owned.get(client) || [];
        const i = list.findIndex((b) => b.id === c.id);
        const r = i >= 0 && this.core.command({ type: 'removeBoat', id: c.id });
        if (i >= 0) list.splice(i, 1);
        this.send(client, { type: 'result', id: m.id, r: !!r });
        this._sendOwn(client);
        return;
      }
      if (BOAT_ACTIONS[c.type]) {
        const mapped = this._mapBoat(client, c);
        this.send(client, { type: 'result', id: m.id, r: mapped ? this.core.command(mapped) : undefined });
        return;
      }
    }
    const reply = answer(this.core, m);
    if (reply) { this.send(client, reply); return; }
    if (m.type === 'perf') this.core.perf = !!m.on;
    else if (m.type === 'input') this.inputs.set(client, { held: Array.isArray(m.held) ? m.held : [], view: m.view || null });
    else if (m.type === 'tick' && this.lockstep) {
      const held = (m.req.held || []).map((c) => this._mapBoat(client, c)).filter(Boolean);
      this.step({ ...m.req, held });
    }
  }

  // A boat command from this client, aimed at its own boat when it has one.
  _mapBoat(client, c) {
    const list = this.owned.get(client);
    if (!list || list.length === 0) return c;
    const own = list[Number.isInteger(c.boat) ? c.boat : 0];
    if (!own) return null;
    const { boat: _b, ...rest } = c;
    return { ...rest, boatId: own.id };
  }

  _sendOwn(client) { this.send(client, { type: 'event', ev: { type: 'ownBoats', boats: (this.owned.get(client) || []).slice() } }); }

  _dropOwnership() {
    const had = [...this.owned.keys()];
    this.owned.clear();
    for (const c of had) this._sendOwn(c);
  }

  _heldUnion() {
    const seen = new Set();
    const out = [];
    for (const [client, { held }] of this.inputs) {
      for (const c0 of held) {
        const c = this._mapBoat(client, c0);
        if (!c) continue;
        const k = JSON.stringify(c);
        if (!seen.has(k)) { seen.add(k); out.push(c); }
      }
    }
    return out;
  }

  _view() {
    for (const { view } of this.inputs.values()) if (view) return view;
    return { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
  }

  // One tick; req as SimCore.tick (lockstep), or built from the inputs.
  // Compute one tick (req as SimCore.tick in lockstep, else built from the
  // inputs). Returns what to broadcast; nothing is sent here.
  _compute(req) {
    const r = req || { dt: 1 / TICK_HZ, held: this._heldUnion(), present: true, view: this._view() };
    const every = this.fieldHz > 0 ? Math.max(1, Math.round(TICK_HZ / this.fieldHz)) : 0;
    if (every && r.dt !== undefined && this.ticks % every === 0) this._fieldDue = true;
    const t0 = this.now();
    const frame = this.core.tick(r);
    this.tickMs = this.now() - t0;
    if (r.dt !== undefined) this.ticks++;
    frame.fieldReady = false;
    // Room tick number: increases by one per tick, the same on every client.
    frame.tick = this.ticks;
    let field = null;
    if (this._painted) {
      this._fieldDue = false;
      this._painted = false;
      field = this._fieldMessage();
    }
    return { frame, field };
  }

  // Every client in the room gets every frame; the server never waits on a
  // client (ws buffers per socket). The field (binary) goes first so a
  // client drawing on the frame message already has the new texture.
  _publish({ frame, field }) {
    if (field) for (const c of this.clients) c.send(field);
    this.broadcast({ type: 'frame', frame });
    this.broadcasts++;
  }

  step(req) {
    const out = this._compute(req);
    this._publish(out);
    return out.frame;
  }

  _fieldMessage() {
    const img = this.core.texture.image;
    if (!img || !img.width) return null;
    const buf = Buffer.allocUnsafe(8 + img.data.length);
    buf.writeUInt32LE(img.width, 0);
    buf.writeUInt32LE(img.height, 4);
    buf.set(img.data, 8);
    return buf;
  }

  // Fixed 30 Hz clock. Slot k starts at T_k: the tick is computed then, and
  // its frame is broadcast at the end of the slot (T_k + 1/30 s) if it finished
  // early, so broadcasts never exceed 30 Hz and the sim never runs ahead of
  // real time. A tick slower than its slot is broadcast as soon as it is done,
  // and the next slot starts then (no catch-up burst; that time is dropped).
  _start() {
    const dt = 1000 / TICK_HZ;
    let slot = this.now();
    const runSlot = () => {
      this.timer = null;
      if (!this.core) return;
      const out = this._compute();
      const end = slot + dt;
      const publish = () => {
        this.timer = null;
        this._publish(out);
        slot = Math.max(end, this.now());
        this.timer = setTimeout(runSlot, Math.max(0, slot - this.now()));
      };
      const wait = end - this.now();
      if (wait > 0) this.timer = setTimeout(publish, wait);
      else publish();
    };
    this.timer = setTimeout(runSlot, 0);
  }

  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
