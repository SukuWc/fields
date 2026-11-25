// ReplayHost (?replay=<id> on the game page): the SimHost interface (host.js)
// for watching a recorded race. It fetches the record from the server
// (GET /api/replays/<id>, apps/server/replays.js), rebuilds the race on a
// SimCore on the main thread from the seed, the room settings and the
// players' logged controls (src/replay-stepper.js, the same stepping the
// server's resimulate() uses) and checks the recorded state hash every 30
// ticks.
//
// The page drives it like LocalHost (main.js loop, 30 Hz): every tick with
// a dt plays the next recorded tick; ticks without a dt (?simPasses) and
// ticks while paused or after the end do nothing. The page's held keys, dt
// and view are ignored: the sim gets exactly the recorded inputs (the
// recorded present flag changes the state hash, so it is never overridden).
// Client commands other than plot (the field colours) are dropped, so
// nothing on the page can change the replayed race.
//
// onStatus(fn): fn({ id, room, players, t, ticks, checked, total, mismatch,
// done, paused, error }) after every played tick and on pause / errors.
import { ReplayStepper } from './replay-stepper.js';
import { eventForClient } from './host-protocol.js';

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
   * id: replay id. texture / oversampling: the page's field texture (as
   * LocalHost). fetchRecord(id): Promise of the record (tests).
   */
  constructor(id, { texture, oversampling, fetchRecord = fetchReplayRecord } = {}) {
    this.kind = 'replay';
    this.id = id;
    this.texture = texture;
    this.oversampling = oversampling;
    this.paused = false;
    this.error = null;
    this.lastFrame = null;
    this.record = null;
    this.stepper = null;
    this.core = null;
    this.info = null;
    this._listeners = [];
    this._frameListeners = [];
    this._statusListeners = [];
    this.ready = Promise.resolve()
      .then(() => fetchRecord(id))
      .then((record) => { this._load(record); return this.info; })
      .catch((e) => { this.error = e && e.message ? e.message : String(e); this._emitStatus(); throw e; });
  }

  _load(record) {
    if (!record || !record.start || !record.start.opts || !Array.isArray(record.log) || !Number.isInteger(record.ticks)) {
      throw new Error('not a replay record');
    }
    this.record = record;
    this.stepper = new ReplayStepper(record, { texture: this.texture, oversampling: this.oversampling });
    this.core = this.stepper.core;
    this.core.sim.on((ev) => {
      const out = eventForClient(this.core, ev);
      for (const fn of this._listeners) fn(out);
    });
    this.info = { ...this.core.info(), mode: 'replay' };
  }

  // The page's texture once it knows the replayed map size (main.js).
  setTexture(texture) {
    this.texture = texture;
    if (this.core) {
      this.core.texture = texture;
      this.core.painter.texture = texture;
    }
  }

  on(fn) { this._listeners.push(fn); }
  onFrame(fn) { this._frameListeners.push(fn); }
  onStatus(fn) { this._statusListeners.push(fn); fn(this.status()); }

  status() {
    const r = this.record;
    const s = this.stepper;
    return {
      id: this.id,
      room: r ? r.room : null,
      players: r ? r.players || [] : [],
      startedAt: r ? r.startedAt : null,
      t: s ? s.t : 0,
      ticks: r ? r.ticks : 0,
      checked: s ? s.checked + (s.done && r.finalHash ? 1 : 0) : 0,
      total: s ? s.want.size + (r.finalHash && !s.want.has(r.ticks) ? 1 : 0) : 0,
      mismatch: s ? s.firstMismatch : null,
      done: !!(s && s.done),
      paused: this.paused,
      error: this.error,
    };
  }

  _emitStatus() {
    const st = this.status();
    for (const fn of this._statusListeners) fn(st);
  }

  setPaused(on) {
    this.paused = !!on;
    this._emitStatus();
  }

  // Only the field colours (plot) reach the replayed core.
  commandSync(c) {
    if (c && c.type === 'plot' && this.core) return this.core.command(c);
    return undefined;
  }

  command(c) { return Promise.resolve(this.commandSync(c)); }

  query(q) { return Promise.resolve(this.core ? this.core.query(q) : null); }

  setPerf(on) { if (this.core) this.core.perf = !!on; }

  perfStats() { return this.core ? this.core.perfStats() : null; }

  bodies() { return this.core ? this.core.bodies() : []; }

  // One page tick = the next recorded tick (dt and view from the page ignored).
  tick(req) {
    const s = this.stepper;
    if (!s || !req || req.dt === undefined || this.paused || s.done) return null;
    const frame = s.step();
    if (frame) {
      if (frame.state) frame.statics = this.core.statics;
      this.lastFrame = frame;
      for (const fn of this._frameListeners) fn(frame);
    }
    this._emitStatus();
    return frame;
  }
}

/** One status line for the replay banner. */
export function replayStatusText(st) {
  if (st.error) return 'Replay unavailable: ' + st.error;
  if (!st.ticks && !st.done) return 'Loading replay…';
  const secs = (n) => (n / 30).toFixed(1) + ' s';
  const pos = secs(st.t) + ' / ' + secs(st.ticks);
  if (st.mismatch) return `Replay ${pos} · MISMATCH at tick ${st.mismatch.t} (want ${st.mismatch.want}, got ${st.mismatch.got})`;
  if (st.done) return `Replay finished · ${st.checked}/${st.total} hashes OK`;
  return `Replay ${pos} · hashes OK ${st.checked}/${st.total}${st.paused ? ' · paused' : ''}`;
}
