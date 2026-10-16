// RemoteHost (?host=remote&server=ws://..., or a VITE_SIM_HOST=remote build):
// the SimHost interface (host.js) over a WebSocket to the Node server
// (apps/server). Same message schema as the worker (host-protocol.js), JSON
// text messages, plus binary messages for the field texture.
//
// The server says in its info who ticks:
//   mode 'server'  (default) the server runs the Sim at 30 Hz on its own
//                  clock and broadcasts a frame per tick; tick() only sends
//                  the held keys and camera when they change ('input').
//   mode 'client'  (server --lockstep, tests) the client's loop drives each
//                  tick as with the worker, so runs are reproducible.
//
// Field: binary message = u32 width, u32 height (little endian), then
// width × height × 4 RGBA bytes. The server sends a reduced texture at a
// throttled rate (apps/server/room.js FIELD_*).
import { plainView } from './host-protocol.js';

export class RemoteHost {
  constructor(url, opts, texture, { maxInFlight = 0, WebSocketImpl } = {}) {
    this.kind = 'remote';
    this.url = url;
    this.texture = texture;
    this.maxInFlight = maxInFlight;
    this.inFlight = 0;
    this.dropped = 0;
    this.ticksSent = 0;
    this.framesReceived = 0;
    this.fieldsReceived = 0;
    this.lastFrame = null;
    this.info = null;
    this.mode = null;
    this._listeners = [];
    this._frameListeners = [];
    this._pending = new Map();
    this._nextId = 1;
    this._idle = [];
    this._lastInput = '';
    const WS = WebSocketImpl || globalThis.WebSocket;
    if (typeof WS !== 'function') throw new Error('WebSocket is not available');
    const ws = new WS(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    const { texture: _t, ...plain } = opts;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'init', opts: plain }));
    ws.onerror = () => { if (!this.info) this._rejectReady(new Error('cannot connect to ' + url)); };
    ws.onclose = () => {
      if (!this.info) this._rejectReady(new Error('connection to ' + url + ' closed'));
      else console.warn('sim server connection closed');
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') this._onMessage(JSON.parse(e.data));
      else this._onField(e.data);
    };
  }

  _onMessage(m) {
    switch (m.type) {
      case 'info':
        this.info = m.info;
        this.mode = m.info.mode;
        this._resolveReady(m.info);
        break;
      case 'event':
        for (const fn of this._listeners) fn(m.ev);
        break;
      case 'result': {
        const p = this._pending.get(m.id);
        this._pending.delete(m.id);
        if (p) p(m.r);
        break;
      }
      case 'frame':
        if (this.inFlight > 0) this.inFlight--;
        this.framesReceived++;
        this.lastFrame = m.frame;
        for (const fn of this._frameListeners) fn(m.frame);
        if (this.inFlight === 0) { const w = this._idle; this._idle = []; for (const fn of w) fn(); }
        break;
      default:
        break;
    }
  }

  _onField(buf) {
    const tex = this.texture;
    if (!tex || !(buf instanceof ArrayBuffer) || buf.byteLength < 8) return;
    const dv = new DataView(buf);
    const width = dv.getUint32(0, true), height = dv.getUint32(4, true);
    const data = new Uint8Array(buf, 8);
    if (data.length !== width * height * 4) return;
    this.fieldsReceived++;
    const img = tex.image;
    if (img && img.width === width && img.height === height) {
      img.data = data;
    } else {
      tex.image = { data, width, height };
      if (typeof tex.dispose === 'function') tex.dispose();
    }
    tex.needsUpdate = true;
  }

  _send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  _call(type, key, value) {
    const id = this._nextId++;
    return new Promise((resolve) => {
      this._pending.set(id, resolve);
      this._send({ type, id, [key]: value });
    });
  }

  on(fn) { this._listeners.push(fn); }
  onFrame(fn) { this._frameListeners.push(fn); }
  command(c) { return this._call('command', 'c', c); }
  query(q) { return this._call('query', 'q', q); }
  setPerf(on) { this._send({ type: 'perf', on: !!on }); }

  tick(req) {
    const held = typeof req.held === 'function' ? req.held() : req.held;
    const view = plainView(req.view);
    if (this.mode === 'client') {
      if (this.maxInFlight > 0 && this.inFlight >= this.maxInFlight) { this.dropped++; return false; }
      this.inFlight++;
      this.ticksSent++;
      this._send({ type: 'tick', req: { dt: req.dt, held, present: !!req.present, view } });
      return true;
    }
    // Server clock: send what the server should use until it changes. The
    // camera only feeds the dev-mode wind arrow, so it is rounded to 0.1 m.
    if (!req.present) return false;
    const input = { held, view: view && { ...view, camera_position_x: Math.round(view.camera_position_x * 10) / 10, camera_position_y: Math.round(view.camera_position_y * 10) / 10 } };
    const key = JSON.stringify(input);
    if (key !== this._lastInput) {
      this._lastInput = key;
      this._send({ type: 'input', ...input });
    }
    return true;
  }

  terminate() { try { this.ws.close(); } catch { /* closed */ } }

  // Resolves once every sent tick has come back (lockstep tests).
  idle() { return this.inFlight === 0 ? Promise.resolve() : new Promise((r) => this._idle.push(r)); }
}
