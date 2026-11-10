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
// Slow clients: onmessage is near-zero cost for binary hot-path messages.
// A frame / field / flow / perf message is only classified by its 3-byte
// header and parked raw (newest wins; older frames and field keyframes are
// dropped undecoded: framesDropped, fieldsDropped). Once per animation
// frame (requestAnimationFrame; a posted task when there is none or the tab
// is hidden) _pump decodes just the newest field and frame and delivers
// them. A phone whose decode/paint is slower than 30 Hz therefore renders
// the latest state instead of a growing backlog. Text (JSON) control
// messages - welcome, events, chat, results, statics - are all processed in
// order, never dropped. framesReceived counts every arrival; onFrameArrival
// fires per decoded frame. coalesce: false decodes and delivers every frame.
// Field messages are coalesced the same way: _onField only stashes the latest
// message; decode + paintGrids run once in _deliver with the frame shown.
// A newer keyframe replaces a pending stash (fieldsDropped). That stops a
// slow paint from growing an onmessage backlog.
//
// Field: only while this client shows it (setField({ on, plotType,
// contrastExp }); the 'plot' command sets the plot). The server sends
// keyframes only (src/field-codec.js, base: 0), at the room's fieldSkip
// cadence. Painted here into the page's texture with the local palette
// (FieldPainter.paintGrids), so remote looks like local.
import { plainView } from './host-protocol.js';
import { FieldPainter } from './fieldPainter.js';
import { decodeFieldText } from './field-codec.js';
import {
  decodeWire,
  WIRE_MAGIC,
  WIRE_VERSION,
  WireVersionError,
} from './wire-codec.js';

/** localStorage key shared with the landing page (apps/landing/index.html). */
export const ADMIN_SECRET_KEY = 'sailzone.adminSecret';
export function readAdminSecret() {
  try { return (typeof localStorage !== 'undefined' && localStorage.getItem(ADMIN_SECRET_KEY)) || ''; } catch (_) { return ''; }
}
export function writeAdminSecret(v) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (v) localStorage.setItem(ADMIN_SECRET_KEY, v); else localStorage.removeItem(ADMIN_SECRET_KEY);
  } catch (_) { /* private mode */ }
}

// EXPERIMENT: transport selection carried on the server URL.
export function transportParams(url) {
  let q;
  try { q = new URL(url, 'http://x').searchParams; } catch { q = new URLSearchParams(); }
  const transport = ['ws', 'rtc', 'wt'].includes(q.get('transport')) ? q.get('transport') : 'ws';
  let send = ['buf', 'latest', 'ack'].includes(q.get('send')) ? q.get('send') : (transport === 'ws' ? 'buf' : 'latest');
  return { transport, send };
}
function wtHost(url) { try { return new URL(url).hostname; } catch { return 'localhost'; } }
// Apply fn to each a=candidate line of an SDP (null drops the line).
function mapSdp(sdp, fn) {
  return sdp.split(/\r?\n/).map((l) => {
    if (!l.startsWith('a=candidate:')) return l;
    const c = fn(l.slice(2));
    return c ? 'a=' + c.replace(/^a=/, '') : null;
  }).filter((l) => l !== null).join('\r\n');
}

export class RemoteHost {
  constructor(url, opts, texture, { maxInFlight = 0, WebSocketImpl, coalesce = true, token = null, reconnect = false, backoffMs = [500, 1000, 2000, 4000, 8000], adminSecret, RTCPeerConnectionImpl, WebTransportImpl, rtcMapCandidate, wtMapUrl } = {}) {
    this.kind = 'remote';
    // Room admin login (same secret as the landing page, localStorage
    // ADMIN_SECRET_KEY). Sent with every init so a reconnect stays logged in.
    this.adminSecret = adminSecret !== undefined ? (adminSecret || '') : readAdminSecret();
    // Server answer: { gate, enabled, authed } (welcome / auth result).
    this.admin = null;
    this._adminListeners = [];
    this.url = url;
    // EXPERIMENT (docs/transport-experiments.md): ?send= / ?transport= on the
    // server URL pick the hot-path policy and channel (apps/server/transport.js).
    const tq = transportParams(url);
    this.sendPolicy = tq.send;
    this.transport = tq.transport;
    this.hotChannel = 'ws';
    this._hotBytes = 0;
    this._hotSeq = {};
    this.hotStale = 0;
    this._RTC = RTCPeerConnectionImpl || globalThis.RTCPeerConnection;
    this._WT = WebTransportImpl || globalThis.WebTransport;
    this._rtcMap = rtcMapCandidate || null;
    this._wtMap = wtMapUrl || null;
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
      this._channel.port1.onmessage = (e) => {
        if (e.data === 1) { const f = this._pumpRun; this._pumpRun = null; if (f) f(); }
        else this._deliver();
      };
      this._raw = { frame: null, field: null, flow: null, perf: null, nextFlow: null, nextPerf: null };
    }
    this.fieldsReceived = 0;
    this.fieldsDropped = 0;
    this.fieldBytes = 0;
    this.bytesReceived = 0;
    this.protocolError = null;
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
      if (this.adminSecret) init.adminSecret = this.adminSecret;
      ws.send(JSON.stringify(init));
      this._fieldHeld = null;
      this._latestField = null;
      if (this._raw) for (const k in this._raw) this._raw[k] = null;
      if (this._field.on) ws.send(JSON.stringify({ type: 'field', ...this._field }));
      if (this._flowOn) ws.send(JSON.stringify({ type: 'flow', on: true }));
      if (this._perfOn) ws.send(JSON.stringify({ type: 'perf', on: true }));
      this.hotChannel = 'ws';
      this._hotBytes = 0;
      this._hotSeq = {};
      this._maxSeq = 0;
      if (this.transport === 'rtc') this._startRtc(ws).catch((e) => console.warn('rtc:', e.message || e));
      if (this.transport === 'wt') ws.send(JSON.stringify({ type: 'wt', host: wtHost(this.url) }));
    };
    ws.onerror = () => { if (!this.info) this._rejectReady(new Error('cannot connect to ' + url)); };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this._closeAlt();
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
      // Hot path (frame / field / flow / perf) is binary (src/wire-codec.js);
      // the rest is JSON text. A binary message from another build's wire
      // version closes the connection with a clear error, not garbage.
      let m, bytes;
      // Coalescing: a binary frame / field / flow / perf is only parked raw
      // (newest wins, older ones are dropped undecoded); decode runs once per
      // animation frame in _pump. Text (control) messages run in order.
      if (typeof e.data !== 'string') this._countHot(e.data);
      if (this.coalesce && typeof e.data !== 'string' && this._park(e.data)) return;
      if (typeof e.data === 'string') {
        m = JSON.parse(e.data); bytes = e.data.length;
        if (m.type === 'rtc' || m.type === 'wt') { this._altSignal(ws, m); return; }
      }
      else {
        try { m = decodeWire(e.data); bytes = e.data.byteLength; }
        catch (err) {
          if (!(err instanceof WireVersionError)) throw err;
          this.protocolError = err.message;
          console.error('sim server protocol mismatch: ' + err.message);
          this._closed = true;
          this._setStatus('disconnected', { error: err.message });
          this._rejectReady(err);
          try { ws.close(); } catch { /* closed */ }
          return;
        }
      }
      this.bytesReceived += bytes;
      if (m.type === 'field') this._onField(m, bytes);
      else this._onMessage(m);
    };
  }

  // ---- EXPERIMENT: alternative hot-path channels (docs/transport-experiments.md)
  // Hot bytes received (any channel); with ?send=ack they are acked so the
  // server keeps only a small window of frames in flight.
  _countHot(data) {
    this._hotBytes += data.byteLength;
    if (this.sendPolicy !== 'ack' || this._ackQueued) return;
    this._ackQueued = true;
    queueMicrotask(() => {
      this._ackQueued = false;
      const a = { type: 'ack', b: this._hotBytes };
      if (this.hotChannel !== 'ws' && this._maxSeq) a.s = this._maxSeq;
      this._send(a);
    });
  }

  // A message from an unordered channel: [u32 seq][wire message]. Older
  // than the newest seen of its kind = stale, dropped (hotStale).
  _onAltHot(buf) {
    const u = new Uint8Array(buf);
    if (u.length < 7) return;
    const seq = (u[0] << 24 | u[1] << 16 | u[2] << 8 | u[3]) >>> 0;
    const kind = u[6];
    const data = buf.slice(4);
    if (seq > (this._maxSeq || 0)) this._maxSeq = seq;
    this._countHot(data);
    if ((this._hotSeq[kind] || 0) >= seq) { this.hotStale++; return; }
    this._hotSeq[kind] = seq;
    if (this.coalesce && this._park(data)) return;
    const m = decodeWire(data);
    if (m.type === 'field') this._onField(m, data.byteLength); else this._onMessage(m);
  }

  async _startRtc(ws) {
    if (typeof this._RTC !== 'function') { console.warn('rtc: RTCPeerConnection not available, staying on WebSocket'); return; }
    const pc = new this._RTC({ iceServers: [] });
    this._pc = pc;
    const dc = pc.createDataChannel('hot', { ordered: false, maxRetransmits: 0 });
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (e) => { if (this.ws === ws) this._onAltHot(e.data instanceof ArrayBuffer ? e.data : new Uint8Array(e.data).slice().buffer); };
    pc.onicecandidate = (e) => {
      if (!e.candidate || !e.candidate.candidate) return;
      let c = e.candidate.candidate;
      if (this._rtcMap) { c = this._rtcMap(c, 'local'); if (!c) return; }
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'rtc', cand: { c, mid: e.candidate.sdpMid || '0' } }));
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    let sdp = pc.localDescription.sdp;
    if (this._rtcMap) sdp = mapSdp(sdp, (c) => this._rtcMap(c, 'local'));
    ws.send(JSON.stringify({ type: 'rtc', offer: { sdp, type: 'offer' } }));
  }

  async _startWt(ws, m) {
    if (typeof this._WT !== 'function') { console.warn('wt: WebTransport not available, staying on WebSocket'); return; }
    const url = this._wtMap ? this._wtMap(m.url) : m.url;
    const hash = Uint8Array.from(atob(m.hash), (ch) => ch.charCodeAt(0));
    const t = new this._WT(url, { serverCertificateHashes: [{ algorithm: 'sha-256', value: hash }] });
    this._wt = t;
    await t.ready;
    const w = t.datagrams.writable.getWriter();
    const key = new TextEncoder().encode(m.key);
    const hello = () => { if (this.hotChannel !== 'wt' && this._wt === t && this.ws === ws) { w.write(key).catch(() => {}); setTimeout(hello, 250); } };
    hello();
    const streams = t.incomingUnidirectionalStreams.getReader();
    for (;;) {
      const { value: st, done } = await streams.read();
      if (done || this._wt !== t) break;
      (async () => {
        const r = st.getReader();
        const parts = []; let n = 0;
        for (;;) { const { value, done: d } = await r.read(); if (d) break; parts.push(value); n += value.byteLength; }
        const buf = new Uint8Array(n); let o = 0;
        for (const p of parts) { buf.set(p, o); o += p.byteLength; }
        if (this.ws === ws) this._onAltHot(buf.buffer);
      })().catch(() => { /* reset */ });
    }
  }

  async _altSignal(ws, m) {
    if (m.error) { console.warn(m.type + ': ' + m.error); return; }
    if (m.type === 'wt') {
      if (m.url) await this._startWt(ws, m).catch((e) => console.warn('wt:', e.message || e));
      if ('open' in m) this.hotChannel = m.open ? 'wt' : 'ws';
      return;
    }
    const pc = this._pc;
    if (!pc) return;
    if (m.answer) {
      let sdp = m.answer.sdp;
      if (this._rtcMap) sdp = mapSdp(sdp, (c) => this._rtcMap(c, 'remote'));
      await pc.setRemoteDescription({ type: 'answer', sdp });
    } else if (m.cand) {
      let c = m.cand.c.replace(/^a=/, '');
      if (this._rtcMap) { c = this._rtcMap(c, 'remote'); if (!c) return; }
      await pc.addIceCandidate({ candidate: c, sdpMid: m.cand.mid }).catch(() => {});
    } else if ('open' in m) this.hotChannel = m.open ? 'rtc' : 'ws';
  }

  _closeAlt() {
    this.hotChannel = 'ws';
    if (this._pc) { try { this._pc.close(); } catch { /* */ } this._pc = null; }
    if (this._wt) { try { this._wt.close(); } catch { /* */ } this._wt = null; }
  }

  // Park one binary hot-path message (see onmessage). Returns false for a
  // message this build can't classify (decoded at once, so a wire version
  // mismatch still reports its error).
  _park(data) {
    const u = new Uint8Array(data, 0, Math.min(3, data.byteLength));
    if (u.length < 3 || u[0] !== WIRE_MAGIC || u[1] !== WIRE_VERSION) return false;
    const t = u[2];
    this.bytesReceived += data.byteLength;
    if (t === 1) {
      this.framesReceived++;
      if (this.inFlight > 0) this.inFlight--;
      if (this._raw.frame) this.framesDropped++;
      this._raw.frame = data;
      // flow / perf belong to the frame right after them.
      this._raw.flow = this._raw.nextFlow; this._raw.perf = this._raw.nextPerf;
      this._raw.nextFlow = this._raw.nextPerf = null;
    } else if (t === 2) {
      if (this._raw.field) { this.fieldsDropped++; this.fieldBytes += this._raw.field.byteLength; }
      this._raw.field = data;
    } else if (t === 3) this._raw.nextFlow = data;
    else if (t === 4) this._raw.nextPerf = data;
    else return false;
    this._schedulePump();
    return true;
  }

  _schedulePump() {
    if (this._pumpScheduled) return;
    this._pumpScheduled = true;
    const run = () => { this._pumpScheduled = false; this._pump(); };
    const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    if (typeof requestAnimationFrame === 'function' && visible) requestAnimationFrame(run);
    else this._channel.port2.postMessage(1), this._pumpRun = run;
  }

  // Decode only the newest parked field and frame, then deliver.
  _pump() {
    const r = this._raw;
    const field = r.field, frame = r.frame, flow = r.flow, perf = r.perf;
    r.field = r.frame = r.flow = r.perf = null;
    if (field) { const m = decodeWire(field); this._onField(m, field.byteLength); }
    if (frame) {
      if (flow) this._nextFlow = decodeWire(flow).flow;
      if (perf) this._nextPerf = decodeWire(perf).perf;
      const m = decodeWire(frame);
      if (m.frame.state) m.frame.statics = this.statics;
      if (this._nextFlow) { m.frame.flow = this._nextFlow; this._nextFlow = null; }
      if (this._nextPerf) { m.frame.perf = this._nextPerf; this._nextPerf = null; }
      for (const fn of this._arrivalListeners) fn(m.frame);
      this._latest = m.frame;
    }
    this._deliver();
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
        this._setAdmin(m.admin || null);
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
      case 'info': {
        // Also sent mid-session when the room's map size changes (a config
        // commit with new map dims rebuilds the server core): drop the held
        // field and tell the page ('mapSize') so it rebuilds its texture,
        // field plane and camera limits.
        const prev = this.info;
        this.info = m.info;
        this.mode = m.info.mode;
        this._resolveReady(m.info);
        if (prev && (prev.mapW !== m.info.mapW || prev.mapH !== m.info.mapH)) {
          this._fieldHeld = null;
          this._latestField = null;
          if (this._raw) this._raw.field = null;
          this.mapResizes = (this.mapResizes || 0) + 1;
          const ev = { type: 'mapSize', mapW: m.info.mapW, mapH: m.info.mapH, info: m.info };
          for (const fn of this._listeners) fn(ev);
        }
        break;
      }
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
  // Server sends keyframes only; keep a thin legacy path for a stray delta
  // (drop + ask keyframe when behind) so an old server build still recovers.
  _onField(m, bytes) {
    this.fieldBytes += bytes;
    const keyframe = !m.base;
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

  /** Admin state changes ({ gate, enabled, authed }). */
  onAdmin(fn) { this._adminListeners.push(fn); }
  _setAdmin(a) {
    this.admin = a;
    for (const fn of this._adminListeners) fn(a);
  }
  /**
   * Log in with the room admin secret ('' logs out). Stores it in
   * localStorage (shared with the landing page) only when the server accepts it.
   */
  async login(secret) {
    const s = typeof secret === 'string' ? secret.trim() : '';
    const r = await this._call('auth', 'secret', s);
    if (r && r.admin) this._setAdmin(r.admin);
    if (r && r.ok) {
      this.adminSecret = s;
      writeAdminSecret(s);
    } else if (r && r.error === 'unauthorized') {
      this.adminSecret = '';
      writeAdminSecret('');
    }
    return r;
  }
  logout() { return this.login(''); }

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
    this._closeAlt();
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    try { this.ws.close(); } catch { /* closed */ }
    if (this._channel) this._channel.port1.close();
  }

  // Resolves once every sent tick has come back (lockstep tests).
  idle() { return this.inFlight === 0 ? Promise.resolve() : new Promise((r) => this._idle.push(r)); }
}
