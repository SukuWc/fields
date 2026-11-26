// ReplayHost (?replay=<id> on the game page): the SimHost interface (host.js)
// for watching a recorded race. It fetches the record from the server
// (GET /api/replays/<id>, apps/server/replays.js) and replays it in a Web
// Worker (src/replay.worker.js; worker: false or no Worker = the same code
// on the page, src/replay-worker-core.js): the race is rebuilt from the
// seed, the room settings and the players' logged controls
// (src/replay-stepper.js, the same stepping the server's resimulate() uses),
// and the recorded state hash is checked every 30 ticks.
//
// The page drives it like WorkerHost (main.js loop, 30 Hz): every tick with
// a dt asks the worker for the next `speed` recorded ticks; ticks without a
// dt (?simPasses), while paused, seeking or after the end do nothing. The
// page's held keys, dt and view are ignored: the sim gets exactly the
// recorded inputs. Client commands other than plot (the field colours) are
// dropped, so nothing on the page can change the replayed race.
//
// Seeking (src/replay-engine.js): seek(t) restores the nearest keyframe and
// fast-forwards in the worker; status().seeking shows the progress and
// cancelSeek() stops it. Keyframes every 10 s of race time, within a memory
// budget (?replayMem=MB); a look-ahead scan fills them only while playback is
// paused (?replayScan=0 turns it off), so it does not share the worker with a
// playing race (a slow machine's ticks can be farther apart than a short idle).
//
// Chat: the record's chat lines (record.chat, { t, seq, at, rc?, text, sys?,
// from? }; older records have none) go to on() listeners as live chat
// events ({ type: 'chat', msg }) once the replay has played t ticks (host.chat
// holds the lines shown so far, for a chat panel set up later); after a
// seek the whole history up to the new position comes as one
// { type: 'chatHistory', chat } event. Pausing holds them back too.
//
// onStatus(fn): fn({ id, room, players, t, ticks, checked, total, mismatch,
// done, paused, error, speed, seeking, simulatedTo, keyframes, ... }) after
// every frame and on pause, seek progress and errors.
import { createReplayWorker } from './replay-worker-core.js';

const ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

/** The replay id from a page query string (?replay=<id>), or null. */
export function replayIdFromQuery(search) {
  const id = new URLSearchParams(search).get('replay');
  return id && ID_RE.test(id) ? id : null;
}

/** Same-origin URL of one record. */
export function replayRecordUrl(id) {
  return '/api/replays/' + encodeURIComponent(id);
}

async function fetchReplayRecord(id) {
  const res = await fetch(replayRecordUrl(id), { cache: 'no-store' });
  if (res.status === 404) throw new Error('replay not found (the server keeps only the last three races, and forgets them on a redeploy)');
  if (!res.ok) throw new Error('replay fetch failed: HTTP ' + res.status);
  return res.json();
}

export class ReplayHost {
  /**
   * id: replay id. texture / oversampling: the page's field texture.
   * fetchRecord(id): Promise of the record (tests). worker: false runs the
   * replay on the page. memoryMB / scan: keyframe budget and look-ahead.
   */
  constructor(id, { texture, oversampling, fetchRecord = fetchReplayRecord, worker = true, memoryMB, scan = true, maxInFlight = 2 } = {}) {
    this.kind = 'replay';
    this.id = id;
    this.texture = texture;
    this.oversampling = oversampling;
    this.paused = false;
    this.error = null;
    this.lastFrame = null;
    this.record = null;
    this.chat = [];
    this.info = null;
    this.maxInFlight = maxInFlight;
    this.inFlight = 0;
    this._st = null;
    this._chatLines = [];
    this._chatNext = 0;
    this._chatT = 0;
    this._listeners = [];
    this._frameListeners = [];
    this._statusListeners = [];
    this._pending = new Map();
    this._nextId = 1;
    this._opts = { oversampling, memoryMB, scan };
    this._useWorker = worker;
    this.worker = null;
    this.ready = Promise.resolve()
      .then(() => fetchRecord(id))
      .then((record) => this._load(record))
      .catch((e) => { this.error = e && e.message ? e.message : String(e); this._emitStatus(); throw e; });
  }

  _load(record) {
    if (!record || !record.start || !record.start.opts || !Array.isArray(record.log) || !Number.isInteger(record.ticks)) {
      throw new Error('not a replay record');
    }
    this.record = record;
    this._chatLines = Array.isArray(record.chat) ? record.chat.filter((m) => m && Number.isFinite(m.t)).sort((a, b) => a.t - b.t || (a.seq || 0) - (b.seq || 0)) : [];
    return new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
      this._send = this._transport();
      this._send({ type: 'init', record, opts: this._opts });
      if (this.paused) this._send({ type: 'paused', on: true });
    });
  }

  // Message channel to the replay: a Web Worker, or the same handler on the page.
  _transport() {
    if (this._useWorker && typeof Worker !== 'undefined') {
      try {
        const w = new Worker(new URL('./replay.worker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this._onMessage(e.data);
        w.onerror = (e) => this._fail(e && e.message ? e.message : 'replay worker failed');
        this.worker = w;
        return (m, transfer) => w.postMessage(m, transfer || []);
      } catch (e) {
        console.warn('replay worker unavailable, replaying on the page', e);
      }
    }
    const handler = createReplayWorker((m) => setTimeout(() => this._onMessage(m), 0));
    return (m) => setTimeout(() => handler(m), 0);
  }

  _fail(message) {
    this.error = message;
    if (this._rejectReady) { const r = this._rejectReady; this._rejectReady = null; r(new Error(message)); }
    this._emitStatus();
  }

  _onMessage(m) {
    switch (m.type) {
      case 'info':
        this.info = m.info;
        this._rejectReady = null;
        this._resolveReady(this.info);
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
      case 'status':
        this._setStatus(m.status);
        break;
      case 'frame':
        if (m.tick) this.inFlight = Math.max(0, this.inFlight - 1);
        if (m.field) this._applyField(m.field);
        if (m.frame && m.frame.statics) this._statics = m.frame.statics;
        if (m.frame && m.frame.state) {
          m.frame.statics = this._statics;
          this.lastFrame = m.frame;
          for (const fn of this._frameListeners) fn(m.frame);
        }
        this._setStatus(m.status);
        break;
      case 'error':
        this._fail(m.message);
        break;
      default:
        break;
    }
  }

  // New texels for the page's DataTexture (as WorkerHost).
  _applyField({ data, width, height }) {
    const tex = this.texture;
    if (!tex) return;
    const img = tex.image;
    if (img && img.width === width && img.height === height) {
      const old = img.data;
      img.data = data;
      if (old && old.buffer && old.byteLength === data.byteLength && this.worker) this._send({ type: 'buffer', data: old }, [old.buffer]);
    } else {
      tex.image = { data, width, height };
      if (typeof tex.dispose === 'function') tex.dispose();
    }
    tex.needsUpdate = true;
  }

  _setStatus(st) {
    if (!st) return;
    const prev = this._st;
    this._st = st;
    // Chat follows the position: forward adds the new lines, a jump (seek)
    // replaces the history with the lines up to the new tick.
    const jumped = prev && (st.t < this._chatT || (prev.seeking && !st.seeking));
    if (jumped) this._chatHistory(st.t);
    else this._emitChat(st.t);
    this._emitStatus();
  }

  // The page's texture once it knows the replayed map size (main.js).
  setTexture(texture) { this.texture = texture; }

  on(fn) { this._listeners.push(fn); }
  onFrame(fn) { this._frameListeners.push(fn); }
  onStatus(fn) { this._statusListeners.push(fn); fn(this.status()); }

  status() {
    const r = this.record;
    const st = this._st || {};
    return {
      id: this.id,
      room: r ? r.room : null,
      players: r ? r.players || [] : [],
      startedAt: r ? r.startedAt : null,
      t: st.t || 0,
      ticks: r ? r.ticks : 0,
      checked: st.checked || 0,
      total: st.total || 0,
      mismatch: st.mismatch || null,
      done: !!st.done,
      paused: this.paused,
      error: this.error,
      speed: st.speed || 1,
      seeking: st.seeking || null,
      simulatedTo: st.simulatedTo || 0,
      keyframes: st.keyframes || [],
      keyframeEvery: st.keyframeEvery || 0,
      keyframeMB: st.keyframeMB || 0,
      lastSeekMs: st.lastSeekMs ?? null,
    };
  }

  // Chat lines up to tick t, as live chat events.
  _emitChat(t) {
    this._chatT = t;
    while (this._chatNext < this._chatLines.length && this._chatLines[this._chatNext].t <= t) {
      const msg = { ...this._chatLines[this._chatNext++] };
      this.chat.push(msg);
      for (const fn of this._listeners) fn({ type: 'chat', msg });
    }
  }

  // After a seek: the whole history up to tick t in one event.
  _chatHistory(t) {
    this._chatT = t;
    let n = 0;
    while (n < this._chatLines.length && this._chatLines[n].t <= t) n++;
    this._chatNext = n;
    const chat = this._chatLines.slice(0, n).map((m) => ({ ...m }));
    this.chat = chat.slice();
    for (const fn of this._listeners) fn({ type: 'chatHistory', chat });
  }

  _emitStatus() {
    const st = this.status();
    for (const fn of this._statusListeners) fn(st);
  }

  setPaused(on) {
    this.paused = !!on;
    if (this._send) this._send({ type: 'paused', on: this.paused });
    this._emitStatus();
  }

  /** Recorded ticks per page tick: 1, 2 or 4. */
  setSpeed(n) { if (this._send) this._send({ type: 'speed', n }); }

  /** Jump to tick t (keeps the paused state). */
  seek(t) { if (this._send) this._send({ type: 'seek', t }); }

  cancelSeek() { if (this._send) this._send({ type: 'cancelSeek' }); }

  _call(type, key, value) {
    if (!this._send) return Promise.resolve(undefined);
    const id = this._nextId++;
    return new Promise((resolve) => {
      this._pending.set(id, resolve);
      this._send({ type, id, [key]: value });
    });
  }

  // Only the field colours (plot) reach the replayed core.
  commandSync(c) {
    if (c && c.type === 'plot') this._call('command', 'c', c);
    return undefined;
  }

  command(c) { return c && c.type === 'plot' ? this._call('command', 'c', c) : Promise.resolve(undefined); }

  query(q) { return this._call('query', 'q', q); }

  setPerf() {}

  perfStats() { return null; }

  bodies() { return []; }

  // One page tick = the next `speed` recorded ticks (dt and view ignored).
  tick(req) {
    const st = this._st;
    if (!this._send || !this.info || !req || req.dt === undefined || this.paused || !st || st.done || st.seeking) return null;
    if (this.inFlight >= this.maxInFlight) return null;
    this.inFlight++;
    this._send({ type: 'tick' });
    return true;
  }

  terminate() { if (this.worker) this.worker.terminate(); }
}

/**
 * One status line for the replay banner. position: false leaves out the
 * time (the timeline shows it).
 */
export function replayStatusText(st, { position = true } = {}) {
  if (st.error) return 'Replay unavailable: ' + st.error;
  if (!st.ticks && !st.done) return 'Loading replay…';
  const secs = (n) => (n / 30).toFixed(1) + ' s';
  const pos = secs(st.t) + ' / ' + secs(st.ticks);
  if (st.mismatch) return `Replay ${pos} · MISMATCH at tick ${st.mismatch.t} (want ${st.mismatch.want}, got ${st.mismatch.got})`;
  if (st.done) return `Replay finished · ${st.checked}/${st.total} hashes OK`;
  if (!position) return `hashes OK ${st.checked}/${st.total}${st.paused ? ' · paused' : ''}`;
  return `Replay ${pos} · hashes OK ${st.checked}/${st.total}${st.paused ? ' · paused' : ''}`;
}
