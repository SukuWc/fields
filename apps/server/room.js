// One room = one authoritative SimCore (src/host.js) and the clients
// connected to it. Speaks the host protocol (src/host-protocol.js).
//
// Ticks: by default the room runs at 30 Hz on its own clock (fixed step,
// at most MAX_CATCH_UP ticks per timer callback, like loop.js) and sends a
// frame to every client each tick. Held keys are the union of every
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

export const TICK_HZ = 30;
export const MAX_CATCH_UP = 4;
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
    this.ticks = 0;
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
    core.sim.on((ev) => this.broadcast({ type: 'event', ev: eventForClient(core, ev) }));
    this.core = core;
    if (!this.lockstep) this._start();
  }

  info() { return { ...this.core.info(), mode: this.lockstep ? 'client' : 'server', room: this.name }; }

  join(client) { this.clients.add(client); }

  leave(client) {
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
    const reply = answer(this.core, m);
    if (reply) { this.send(client, reply); return; }
    if (m.type === 'perf') this.core.perf = !!m.on;
    else if (m.type === 'input') this.inputs.set(client, { held: Array.isArray(m.held) ? m.held : [], view: m.view || null });
    else if (m.type === 'tick' && this.lockstep) this.step(m.req);
  }

  _heldUnion() {
    const seen = new Set();
    const out = [];
    for (const { held } of this.inputs.values()) {
      for (const c of held) {
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
  step(req) {
    const r = req || { dt: 1 / TICK_HZ, held: this._heldUnion(), present: true, view: this._view() };
    const every = this.fieldHz > 0 ? Math.max(1, Math.round(TICK_HZ / this.fieldHz)) : 0;
    if (every && r.dt !== undefined && this.ticks % every === 0) this._fieldDue = true;
    const t0 = this.now();
    const frame = this.core.tick(r);
    this.tickMs = this.now() - t0;
    if (r.dt !== undefined) this.ticks++;
    frame.fieldReady = false;
    this.broadcast({ type: 'frame', frame });
    if (this._painted) {
      this._fieldDue = false;
      this._painted = false;
      this._sendField();
    }
    return frame;
  }

  _sendField() {
    const img = this.core.texture.image;
    if (!img || !img.width) return;
    const buf = Buffer.allocUnsafe(8 + img.data.length);
    buf.writeUInt32LE(img.width, 0);
    buf.writeUInt32LE(img.height, 4);
    buf.set(img.data, 8);
    for (const c of this.clients) c.send(buf);
  }

  _start() {
    const dt = 1000 / TICK_HZ;
    let next = this.now();
    const loop = () => {
      const t = this.now();
      let n = 0;
      while (t >= next && n < MAX_CATCH_UP) { this.step(); next += dt; n++; }
      if (t >= next) next = t + dt; // drop time we cannot catch up
      this.timer = setTimeout(loop, Math.max(0, next - this.now()));
    };
    this.timer = setTimeout(loop, 0);
  }

  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
