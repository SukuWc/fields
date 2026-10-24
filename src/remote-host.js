// RemoteHost (?host=remote&server=ws://..., or a VITE_SIM_HOST=remote build):
// the SimHost interface (host.js) over a WebSocket to the Node server
// (apps/server). Same message schema as the worker (host-protocol.js), JSON
// text messages only (the field too: src/field-codec.js).
//
// The server says in its info who ticks:
//   mode 'server'  (default) the server runs the Sim on its own 30 Hz clock
//                  and broadcasts every frame to every client in the room.
//                  The page is purely event-driven (main.js): no loop, no
//                  rAF; it draws when a frame arrives and sends held keys
//                  with sendInput() when they change (they steer only this
//                  client's own boat; the camera stays on the page).
//
// Joining: the server answers 'init' with one welcome message: info, the
// room state (room: scenario, room-wide settings, lattice), this client's
// own boats and key binding. They are kept here (info, room, own, bindings)
// for the page to start from, and kept current by the 'room', 'ownBoats' and
// 'bindControls' events, which also go to on() listeners.
//
// Reconnect: with a token (main.js keeps one per server URL in
// localStorage) the server knows this client again after a drop or a page
// reload: within its grace period it hands back the same boats (welcome
// own / bindings). With reconnect: true a dropped connection is retried with
// backoff (backoffMs); onStatus(fn) reports connected / reconnecting /
// disconnected for the page's banner, commands in flight resolve
// { error: 'disconnected' }, and the new welcome is applied as room, ownBoats
// and bindControls events. Subscriptions and held keys are sent again.
//
// Per-client subscriptions: setField (below), setFlow(on) (flow tracer
// grids, arriving as frame.flow) and setPerf(on) (perf counters, as
// frame.perf); the server sends each only to clients that asked.
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
// Field messages are coalesced the same way: _onField only stashes the latest
// message; decode + paintGrids run once in _deliver with the frame shown. A
// delta that arrives while a field is already pending (or a deliver is
// scheduled) is dropped, held state cleared, and a keyframe requested once
// (fieldResyncs); a keyframe replaces the stash. That stops a slow paint from
// growing an onmessage backlog (the client would otherwise fall seconds
// behind while a fresh joiner sees the current tick).
//
// Field: only while this client shows it (setField({ on, plotType,
// contrastExp }); the 'plot' command sets the plot). The server then sends,
// every TICK_HZ / fieldHz ticks, a field text message (src/field-codec.js):
// the root grid and each refinement domain, one byte per cell, as a
// keyframe or as a delta against the previous one. It is painted here into
// the page's texture with the local palette and layering
// (FieldPainter.paintGrids), so remote looks like local; the page shows it
// on the next frame.
import { plainView } from './host-protocol.js';
import { FieldPainter } from './fieldPainter.js';
import { decodeFieldText } from './field-codec.js';

export class RemoteHost {
  constructor(url, opts, texture, { maxInFlight = 0, WebSocketImpl, coalesce = true, token = null, reconnect = false, backoffMs = [500, 1000, 2000, 4000, 8000] } = {}) {
    this.kind = 'remote';
    this.url = url;
    this.texture = texture;
    this.maxInFlight = maxInFlight;
    this.inFlight = 0;
    this.dropped = 0;
    this.ticksSent = 0;
    this.statics = null;
    this.staticsVersion = 0;
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
    this.fieldsDropped = 0;
    this.fieldBytes = 0;
    this.fieldResyncs = 0;
    this._fieldHeld = null;
    this._latestField = null;
    this.lastField = null;
    // Recent chat (welcome history, then each 'chat' event).
    this.chat = [];
    this._oversampling = opts.oversampling || 8;
    this._painter = texture ? new FieldPainter(texture, this._oversampling) : null;
    this._field = { on: false, plotType: 3, contrastExp: 0 };
    this._flowOn = false;
    this._perfOn = false;
    // Flow grid / perf counters for the next frame (they arrive just before it).
    this._nextFlow = null;
    this._nextPerf = null;
    this.room = null;
    this.own = [];
    this.bindings = 0;
    this.lastFrame = null;
    this.info = null;
    this.mode = null;
    this._listeners = [];
    this._frameListeners = [];
    this._pending = new Map();
    this._nextId = 1;
    this._idle = [];
    this._lastInput = '';
    this._WS = WebSocketImpl || globalThis.WebSocket;
    if (typeof this._WS !== 'function') throw new Error('WebSocket is not available');
    // Reconnect (see the header): token names this client to the room across
    // connections; reconnect retries with backoff after a drop.
    this.token = typeof token === 'string' && token ? token : null;
    this.reconnect = !!reconnect;
    this.backoffMs = backoffMs;
    this.status = 'connecting';
    this.attempt = 0;
    this._statusListeners = [];
    this._retryTimer = null;
    this._closed = false;
    this.reconnects = 0;
    this.ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    const { texture: _t, ...plain } = opts;
    this._initOpts = plain;
    this._connect();
  }

  _connect() {
    const ws = new this._WS(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    const url = this.url;
    ws.onopen = () => {
      const init = { type: 'init', opts: this._initOpts };
      if (this.token) init.token = this.token;
      ws.send(JSON.stringify(init));
      this._fieldHeld = null;
      this._latestField = null;
      if (this._field.on) ws.send(JSON.stringify({ type: 'field', ...this._field }));
      if (this._flowOn) ws.send(JSON.stringify({ type: 'flow', on: true }));
      if (this._perfOn) ws.send(JSON.stringify({ type: 'perf', on: true }));
    };
    ws.onerror = () => { if (!this.info) this._rejectReady(new Error('cannot connect to ' + url)); };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (!this.info) { this._rejectReady(new Error('connection to ' + url + ' closed')); return; }
      // Commands in flight will get no answer on this connection.
      for (const [id, p] of this._pending) { this._pending.delete(id); p({ error: 'disconnected' }); }
      this.inFlight = 0;
      this._latest = null;
      if (this._closed || !this.reconnect) {
        this._setStatus('disconnected');
        if (!this._closed) console.warn('sim server connection closed');
        return;
      }
      this._scheduleRetry();
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      if (typeof e.data !== 'string') return;
      const m = JSON.parse(e.data);
      if (m.type === 'field') this._onField(m, e.data.length);
      else this._onMessage(m);
    };
  }

  // Backoff: backoffMs[attempt] (the last value repeats).
  _scheduleRetry() {
    const wait = this.backoffMs[Math.min(this.attempt, this.backoffMs.length - 1)];
    this.attempt++;
    this._setStatus('reconnecting', { inMs: wait });
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (this._closed) return;
      this._connect();
    }, wait);
  }

  // Connection state for the page's banner: 'connecting' | 'connected' |
  // 'reconnecting' (extra: inMs, the wait before the next try; attempt) |
  // 'disconnected' (closed for good).
  onStatus(fn) { this._statusListeners.push(fn); }
  _setStatus(status, extra = {}) {
    this.status = status;
    const s = { status, attempt: this.attempt, ...extra };
    for (const fn of this._statusListeners) fn(s);
  }

  _onMessage(m) {
    switch (m.type) {
      case 'welcome': {
        const again = !!this.info;
        this.room = m.room || null;
        this.own = m.own || [];
        this.chat = Array.isArray(m.chat) ? m.chat : [];
        this.bindings = m.bindings || 0;
        this.info = m.info;
        this.mode = m.info.mode;
        this._lastInput = '';
        if (again) {
          // A reconnect: the page applies the snapshot as it applies events.
          this.reconnects++;
          for (const ev of [{ type: 'room', room: this.room }, { type: 'ownBoats', boats: this.own }, { type: 'bindControls', boats: this.bindings }, { type: 'chatHistory', chat: this.chat }]) {
            for (const fn of this._listeners) fn(ev);
          }
        }
        this.attempt = 0;
        this._resolveReady(m.info);
        this._setStatus('connected', { again });
        break;
      }
      case 'info':
        this.info = m.info;
        this.mode = m.info.mode;
        this._resolveReady(m.info);
        break;
      case 'event':
        if (m.ev.type === 'room') this.room = m.ev.room;
        else if (m.ev.type === 'ownBoats') this.own = m.ev.boats || [];
        else if (m.ev.type === 'bindControls') this.bindings = m.ev.boats || 0;
        else if (m.ev.type === 'chat' && m.ev.msg) { this.chat.push(m.ev.msg); if (this.chat.length > 50) this.chat.shift(); }
        for (const fn of this._listeners) fn(m.ev);
        break;
      case 'flow': this._nextFlow = m.flow; break;
      case 'perf': this._nextPerf = m.perf; break;
      case 'result': {
        const p = this._pending.get(m.id);
        this._pending.delete(m.id);
        if (p) p(m.r);
        break;
      }
      case 'statics':
        this.statics = m.statics;
        this.staticsVersion = m.sv;
        break;
      case 'frame':
        // The statics this frame was built against (they arrive first).
        if (m.frame.state) m.frame.statics = this.statics;
        if (this._nextFlow) { m.frame.flow = this._nextFlow; this._nextFlow = null; }
        if (this._nextPerf) { m.frame.perf = this._nextPerf; this._nextPerf = null; }
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

  // Hand the newest field (if any) and frame to the listeners (see the header).
  _deliver() {
    this._scheduled = false;
    const pending = this._latestField;
    this._latestField = null;
    if (pending) this._applyField(pending.m);
    const frame = this._latest;
    this._latest = null;
    if (!frame) return;
    this.framesDelivered++;
    this.lastFrame = frame;
    for (const fn of this._frameListeners) fn(frame);
    if (this.inFlight === 0) { const w = this._idle; this._idle = []; for (const fn of w) fn(); }
  }

  // The page's field texture, when it is sized only after the welcome
  // (a room created with another map size).
  setTexture(texture) {
    this.texture = texture;
    this._painter = texture ? new FieldPainter(texture, this._oversampling) : null;
  }

  // Stash a field text message; decode + paint run in _deliver. See header.
  _onField(m, bytes) {
    this.fieldBytes += bytes;
    const keyframe = !m.base;
    // Behind: a field is already waiting, or a deliver is scheduled (a burst
    // of ticks). A further delta cannot be applied without the skipped base.
    const behind = this._latestField != null || this._scheduled;
    if (behind && !keyframe) {
      this.fieldsDropped++;
      this._latestField = null;
      this._askFieldKeyframe();
      return;
    }
    if (this._latestField) this.fieldsDropped++;
    this._latestField = { m };
    if (keyframe) this._fieldAsked = false;
  }

  _askFieldKeyframe() {
    this._fieldHeld = null;
    if (!this._fieldAsked) {
      this.fieldResyncs++;
      this._fieldAsked = true;
      if (this._field.on) this._send({ type: 'field', ...this._field });
    }
  }

  // Decode the stashed message onto _fieldHeld and paint (called from _deliver).
  _applyField(m) {
    const r = decodeFieldText(m, this._fieldHeld);
    if (!r) {
      if (this._fieldHeld || !this._fieldAsked) {
        this.fieldResyncs++;
        this._fieldAsked = true;
        if (this._field.on) this._send({ type: 'field', ...this._field });
      }
      this._fieldHeld = null;
      return;
    }
    this._fieldHeld = r;
    this._fieldAsked = false;
    this.fieldsReceived++;
    this.lastField = r.msg;
    if (this._painter) this._painter.paintGrids(r.msg);
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
  // Chat (apps/server/room.js): resolves to { ok, seq } or { error }.
  sendChat(text) { return this._call('chat', 'text', String(text)); }
  query(q) { return this._call('query', 'q', q); }
  // Perf counters in this client's frames (frame.perf), or not.
  setPerf(on) { this._perfOn = !!on; this._send({ type: 'perf', on: !!on }); }
  // Flow tracer grids in this client's frames (frame.flow), or not.
  setFlow(on) {
    if (this._flowOn === !!on) return;
    this._flowOn = !!on;
    this._send({ type: 'flow', on: !!on });
  }

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
    this.sendInput({ held });
    return true;
  }

  // Held keys for a server that ticks on its own clock; sent only when they
  // change. (The view stays here: the server only needs the flow
  // subscription, setFlow.)
  sendInput({ held }) {
    const input = { held: held || [] };
    const key = JSON.stringify(input);
    if (key === this._lastInput) return false;
    this._lastInput = key;
    this._send({ type: 'input', ...input });
    return true;
  }

  terminate() {
    this._closed = true;
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    try { this.ws.close(); } catch { /* closed */ }
    if (this._channel) this._channel.port1.close();
  }

  // Resolves once every sent tick has come back (lockstep tests).
  idle() { return this.inFlight === 0 ? Promise.resolve() : new Promise((r) => this._idle.push(r)); }
}
