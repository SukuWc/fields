// RemoteHost (?host=remote&server=ws://..., or a VITE_SIM_HOST=remote build):
// the SimHost interface (host.js) over a WebSocket to the Node server
// (apps/server). Same message schema as the worker (host-protocol.js), JSON
// text messages, plus binary messages for the field texture.
//
// The server says in its info who ticks:
//   mode 'server'  (default) the server runs the Sim on its own 30 Hz clock
//                  and broadcasts every frame to every client in the room.
//                  The page is purely event-driven (main.js): no loop, no
//                  rAF; it draws when a frame arrives and sends held keys and
//                  camera with sendInput() when they change.
//   mode 'client'  (server --lockstep, Node tests only) tick() asks for each
//                  tick, so runs are reproducible; frames are still broadcast
//                  to every client. The browser never calls tick() in remote
//                  mode, so a page against a lockstep server does not advance.
//
// Slow clients: frames are counted as they arrive (framesReceived,
// onFrameArrival) but delivered to onFrame listeners through one posted task
// (MessageChannel): if several frames are queued when that task runs, only the
// newest is delivered and the rest count as framesDropped. A client that keeps
// up gets every frame; one that falls behind renders the latest state
// instead of replaying old ones. coalesce: false delivers every frame.
//
// Field: only while this client shows it (setField({ on, plotType,
// contrastExp }); the 'plot' command sets the plot). The server then sends,
// every TICK_HZ / fieldHz ticks, a binary field grid message: the root grid
// and each refinement domain, one byte per cell (fieldPainter.js
// encodeFieldGrids). It is painted here into the page's texture with the
// local palette and layering (FieldPainter.paintGrids), so remote looks like
// local; the page shows it on the next frame.
import { plainView } from './host-protocol.js';
import { FieldPainter, decodeFieldGrids } from './fieldPainter.js';

export class RemoteHost {
  constructor(url, opts, texture, { maxInFlight = 0, WebSocketImpl, coalesce = true } = {}) {
    this.kind = 'remote';
    this.url = url;
    this.texture = texture;
    this.maxInFlight = maxInFlight;
    this.inFlight = 0;
    this.dropped = 0;
    this.ticksSent = 0;
    this.framesReceived = 0;
    this.framesDelivered = 0;
    this.framesDropped = 0;
    this.coalesce = coalesce && typeof MessageChannel === 'function';
    this._arrivalListeners = [];
    this._latest = null;
    this._scheduled = false;
    if (this.coalesce) {
      this._channel = new MessageChannel();
      this._channel.port1.onmessage = () => this._deliver();
    }
    this.fieldsReceived = 0;
    this.fieldBytes = 0;
    this.lastField = null;
    this._painter = texture ? new FieldPainter(texture, opts.oversampling || 8) : null;
    this._field = { on: false, plotType: 3, contrastExp: 0 };
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
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'init', opts: plain }));
      if (this._field.on) ws.send(JSON.stringify({ type: 'field', ...this._field }));
    };
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
        for (const fn of this._arrivalListeners) fn(m.frame);
        if (this._latest) this.framesDropped++;
        this._latest = m.frame;
        if (!this.coalesce) this._deliver();
        else if (!this._scheduled) { this._scheduled = true; this._channel.port2.postMessage(0); }
        break;
      default:
        break;
    }
  }

  // Hand the newest frame to the onFrame listeners (see the header).
  _deliver() {
    this._scheduled = false;
    const frame = this._latest;
    this._latest = null;
    if (!frame) return;
    this.framesDelivered++;
    this.lastFrame = frame;
    for (const fn of this._frameListeners) fn(frame);
    if (this.inFlight === 0) { const w = this._idle; this._idle = []; for (const fn of w) fn(); }
  }

  _onField(buf) {
    if (!(buf instanceof ArrayBuffer)) return;
    const msg = decodeFieldGrids(buf);
    if (!msg) return;
    this.fieldsReceived++;
    this.fieldBytes += buf.byteLength;
    this.lastField = msg;
    if (this._painter) this._painter.paintGrids(msg);
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
  // Every frame as it arrives, before coalescing (tests, counters).
  onFrameArrival(fn) { this._arrivalListeners.push(fn); }
  command(c) {
    if (c && c.type === 'plot') {
      if (Number.isFinite(c.plotType)) this._field.plotType = c.plotType;
      if ('contrastExp' in c) this._field.contrastExp = Number(c.contrastExp);
    }
    return this._call('command', 'c', c);
  }
  // Field messages for this client: on/off and the plot (any subset).
  setField(f) {
    const next = { ...this._field };
    if ('on' in f) next.on = !!f.on;
    if (Number.isFinite(f.plotType)) next.plotType = f.plotType;
    if ('contrastExp' in f) next.contrastExp = Number(f.contrastExp);
    this._field = next;
    this._send({ type: 'field', ...next });
  }
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
    // Server clock: input goes with sendInput() instead.
    this.sendInput({ held, view });
    return true;
  }

  // Held keys and camera for a server that ticks on its own clock; sent only
  // when they change. The camera only feeds the dev-mode wind arrow, so it is
  // rounded to 0.1 m.
  sendInput({ held, view }) {
    const v = plainView(view);
    const input = { held: held || [], view: v && { ...v, camera_position_x: Math.round(v.camera_position_x * 10) / 10, camera_position_y: Math.round(v.camera_position_y * 10) / 10 } };
    const key = JSON.stringify(input);
    if (key === this._lastInput) return false;
    this._lastInput = key;
    this._send({ type: 'input', ...input });
    return true;
  }

  terminate() {
    try { this.ws.close(); } catch { /* closed */ }
    if (this._channel) this._channel.port1.close();
  }

  // Resolves once every sent tick has come back (lockstep tests).
  idle() { return this.inFlight === 0 ? Promise.resolve() : new Promise((r) => this._idle.push(r)); }
}
