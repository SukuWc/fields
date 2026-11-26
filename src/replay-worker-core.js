// Replay worker message handler (replay seeking, part 2), shared by the Web
// Worker (src/replay.worker.js) and the on-page fallback (ReplayHost with
// worker: false), so both run the same code. No DOM.
//
// Page → worker
//   { type: 'init', record, opts: { oversampling, memoryMB, scan } }
//   { type: 'tick' }                 play `speed` recorded ticks (ignored while seeking)
//   { type: 'seek', t }              seek to tick t (replaces a running seek)
//   { type: 'cancelSeek' }
//   { type: 'speed', n }             1, 2 or 4 recorded ticks per page tick
//   { type: 'command', id, c }       only plot (field colours) reaches the core
//   { type: 'query', id, q }         → { type: 'result', id, r }
//   { type: 'buffer', data }         a field buffer handed back for reuse
// Worker → page
//   { type: 'info', info }           after init
//   { type: 'event', ev }            Sim events (eventForClient)
//   { type: 'frame', frame, status, tick, field? }   tick: the answer to a tick
//                                    (frame null when nothing played); field:
//                                    RGBA texels, transferred
//   { type: 'status', status }       seek progress and look-ahead (ReplayEngine.status)
//   { type: 'error', message }
//
// Work between messages: a seek fast-forwards in chunks of SEEK_CHUNK_MS,
// each followed by a setTimeout(0) so a new seek or a cancel gets through.
// The look-ahead scan also runs in SCAN_CHUNK_MS slices, but only while
// playback is paused (the page sends { type: 'paused', on }). It shares the
// worker with playback, and running it between play ticks made a multi-boat
// replay drop well below real time after a seek on a slower machine. A
// wall-clock idle gap is not used: a slow machine's ticks already arrive
// farther apart than a short idle timeout, which would start the scan again.
import { ReplayEngine } from './replay-engine.js';
import { eventForClient } from './host-protocol.js';

export const SEEK_CHUNK_MS = 30;
export const SCAN_CHUNK_MS = 12;
// Optional delay after Pause before a look-ahead chunk (0: start at once).
// Scan is armed only when the page says it is paused, not after a quiet
// gap between play ticks.
export const SCAN_IDLE_MS = 0;
const STATUS_EVERY_MS = 250;

/**
 * post(msg, transfer?): send to the page. schedule(fn): run fn soon
 * (setTimeout 0). Returns onMessage(msg).
 */
export function createReplayWorker(post, {
  schedule = (fn, ms = 0) => setTimeout(fn, ms),
  cancelSchedule = (id) => clearTimeout(id),
  now = () => performance.now(),
  scanIdleMs = SCAN_IDLE_MS,
  scanChunkMs = SCAN_CHUNK_MS,
} = {}) {
  let engine = null;
  let core = null;
  let spare = null;
  let pumping = false;
  let lastStatus = 0;
  let paused = false;
  let idleId = null;

  const status = () => engine.status();
  const sendStatus = () => { lastStatus = now(); post({ type: 'status', status: status() }); };

  const sendFrame = (frame, tick = false) => {
    const st = status();
    lastStatus = now();
    if (frame && frame.fieldReady) {
      const img = core.texture.image;
      const field = { data: img.data, width: img.width, height: img.height };
      img.data = spare && spare.length === field.data.length ? spare : new Uint8Array(field.data.length);
      spare = null;
      post({ type: 'frame', frame, status: st, field, tick }, [field.data.buffer]);
    } else {
      post({ type: 'frame', frame, status: st, tick });
    }
  };

  const clearIdle = () => {
    if (idleId === null || idleId === undefined) return;
    try { cancelSchedule(idleId); } catch { /* a test schedule may not return ids */ }
    idleId = null;
  };

  // Look-ahead scan, only while the page has paused playback.
  const armIdleScan = (delay = scanIdleMs) => {
    if (!engine || !paused || engine.seeking || !engine.scanEnabled || engine.scanDone) return;
    clearIdle();
    idleId = schedule(() => {
      idleId = null;
      if (!engine || !paused || engine.seeking || !engine.scanEnabled || engine.scanDone) return;
      const more = engine.runScan(scanChunkMs);
      if (now() - lastStatus > STATUS_EVERY_MS || !more) sendStatus();
      if (more) armIdleScan(0);
    }, delay);
  };

  // Seek chunks only (the look-ahead scan uses armIdleScan).
  const pump = () => {
    pumping = false;
    if (!engine) return;
    if (!engine.seeking) { armIdleScan(); return; }
    const frame = engine.runSeek(SEEK_CHUNK_MS);
    if (frame) sendFrame(frame);
    else sendStatus();
    if (engine.seeking) kick();
    else armIdleScan();
  };

  const kick = () => {
    if (pumping) return;
    pumping = true;
    schedule(pump, 0);
  };

  return function onMessage(m) {
    try {
      switch (m.type) {
        case 'init': {
          const o = m.opts || {};
          engine = new ReplayEngine(m.record, {
            texture: { image: { data: new Uint8Array(0) } },
            oversampling: o.oversampling,
            memoryMB: o.memoryMB,
            scan: o.scan !== false,
          });
          core = engine.core;
          core.sim.on((ev) => post({ type: 'event', ev: eventForClient(core, ev) }));
          // Status first: the page has the position before it starts.
          sendStatus();
          post({ type: 'info', info: { ...core.info(), mode: 'replay' } });
          break;
        }
        case 'paused': {
          paused = !!m.on;
          if (paused) armIdleScan(0);
          else clearIdle();
          break;
        }
        case 'tick': {
          if (!engine) break;
          // Every tick is answered (the page counts ticks in flight).
          clearIdle();
          const frame = engine.seeking ? null : engine.play();
          sendFrame(frame, true);
          break;
        }
        case 'seek':
          if (!engine) break;
          clearIdle();
          engine.seek(m.t);
          sendStatus();
          kick();
          break;
        case 'cancelSeek':
          if (engine) { engine.cancelSeek(); sendStatus(); armIdleScan(); }
          break;
        case 'speed':
          if (engine) { engine.setSpeed(m.n); sendStatus(); }
          break;
        case 'command':
          post({ type: 'result', id: m.id, r: m.c && m.c.type === 'plot' && core ? core.command(m.c) : undefined });
          break;
        case 'query':
          post({ type: 'result', id: m.id, r: core ? core.query(m.q) : null });
          break;
        case 'buffer':
          spare = m.data;
          break;
        default:
          break;
      }
    } catch (e) {
      post({ type: 'error', message: e && e.message ? e.message : String(e) });
    }
  };
}
