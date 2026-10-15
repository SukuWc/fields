// WorkerHost (?worker=1): the SimHost interface (host.js) with the SimCore in
// a Web Worker (sim.worker.js). Same calls as LocalHost, but everything is
// asynchronous: frames arrive by message a little after the tick that asked
// for them, and held keys are read when the tick is sent.
//
// Back-pressure: at most maxInFlight ticks wait for the worker; a tick beyond
// that is dropped, so a slow worker slows the simulation (as the loop's
// catch-up cap does on the main thread) instead of queueing latency.
// ?workerQueue=N sets the cap; 0 = never drop (deterministic tests).
export class WorkerHost {
  constructor(opts, texture, { maxInFlight = 4 } = {}) {
    this.kind = 'worker';
    this.texture = texture;
    this.maxInFlight = maxInFlight;
    this.inFlight = 0;
    this.dropped = 0;
    this.ticksSent = 0;
    this.lastFrame = null;
    this.info = null;
    this._listeners = [];
    this._frameListeners = [];
    this._pending = new Map();
    this._nextId = 1;
    this._idle = [];
    this.worker = new Worker(new URL('./sim.worker.js', import.meta.url), { type: 'module' });
    this.ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this.worker.onerror = (e) => reject(e);
    });
    this.worker.onmessage = (e) => this._onMessage(e.data);
    const { texture: _t, ...plain } = opts;
    this.worker.postMessage({ type: 'init', opts: plain });
  }

  _onMessage(m) {
    switch (m.type) {
      case 'info':
        this.info = m.info;
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
        this.inFlight--;
        if (m.field) this._applyField(m.field);
        this.lastFrame = m.frame;
        for (const fn of this._frameListeners) fn(m.frame);
        if (this.inFlight === 0) { const w = this._idle; this._idle = []; for (const fn of w) fn(); }
        break;
      default:
        break;
    }
  }

  // New texels for the client DataTexture. Same size: swap the buffer and
  // hand the old one back; new size: a new image (three reallocates on dispose).
  _applyField({ data, width, height }) {
    const tex = this.texture;
    if (!tex) return;
    const img = tex.image;
    if (img && img.width === width && img.height === height) {
      const old = img.data;
      img.data = data;
      if (old && old.buffer && old.byteLength === data.byteLength) this.worker.postMessage({ type: 'buffer', data: old }, [old.buffer]);
    } else {
      tex.image = { data, width, height };
      if (typeof tex.dispose === 'function') tex.dispose();
    }
    tex.needsUpdate = true;
  }

  _call(type, key, value) {
    const id = this._nextId++;
    return new Promise((resolve) => {
      this._pending.set(id, resolve);
      this.worker.postMessage({ type, id, [key]: value });
    });
  }

  on(fn) { this._listeners.push(fn); }
  onFrame(fn) { this._frameListeners.push(fn); }
  command(c) { return this._call('command', 'c', c); }
  query(q) { return this._call('query', 'q', q); }
  setPerf(on) { this.worker.postMessage({ type: 'perf', on: !!on }); }

  // req: { dt, held: array, present, view } — view is copied to plain data.
  tick(req) {
    if (this.maxInFlight > 0 && this.inFlight >= this.maxInFlight) { this.dropped++; return false; }
    const v = req.view;
    const view = v ? {
      camera_position_x: v.camera_position_x, camera_position_y: v.camera_position_y,
      camera_zoom: v.camera_zoom, show_forces: v.show_forces, show_fields: v.show_fields,
    } : null;
    const held = typeof req.held === 'function' ? req.held() : req.held;
    this.inFlight++;
    this.ticksSent++;
    this.worker.postMessage({ type: 'tick', req: { dt: req.dt, held, present: !!req.present, view } });
    return true;
  }

  // Resolves once every sent tick has come back (tests).
  idle() { return this.inFlight === 0 ? Promise.resolve() : new Promise((r) => this._idle.push(r)); }
}
