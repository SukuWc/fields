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
// the look-ahead scan in chunks of SCAN_CHUNK_MS, each followed by a
// setTimeout(0) so ticks, a new seek or a cancel get through.
import { ReplayEngine } from './replay-engine.js';
import { eventForClient } from './host-protocol.js';

export const SEEK_CHUNK_MS = 30;
export const SCAN_CHUNK_MS = 12;
const STATUS_EVERY_MS = 250;

/**
 * post(msg, transfer?): send to the page. schedule(fn): run fn soon
 * (setTimeout 0). Returns onMessage(msg).
 */
export function createReplayWorker(post, { schedule = (fn) => setTimeout(fn, 0), now = () => performance.now() } = {}) {
  let engine = null;
  let core = null;
  let spare = null;
  let pumping = false;
  let lastStatus = 0;

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

  const pump = () => {
    pumping = false;
    if (!engine) return;
    let more = false;
    if (engine.seeking) {
      const frame = engine.runSeek(SEEK_CHUNK_MS);
      if (frame) sendFrame(frame);
      else sendStatus();
      more = true;
    } else {
      more = engine.runScan(SCAN_CHUNK_MS);
      if (now() - lastStatus > STATUS_EVERY_MS || !more) sendStatus();
    }
    if (more) kick();
  };

  const kick = () => {
    if (pumping) return;
    pumping = true;
    schedule(pump);
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
          kick();
          break;
        }
        case 'tick': {
          if (!engine) break;
          // Every tick is answered (the page counts ticks in flight).
          const frame = engine.seeking ? null : engine.play();
          sendFrame(frame, true);
          if (!engine.seeking) kick();
          break;
        }
        case 'seek':
          if (!engine) break;
          engine.seek(m.t);
          sendStatus();
          kick();
          break;
        case 'cancelSeek':
          if (engine) { engine.cancelSeek(); sendStatus(); }
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
