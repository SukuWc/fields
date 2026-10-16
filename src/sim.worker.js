// Web Worker side of WorkerHost (worker-host.js, the default host): runs a SimCore
// (host.js) off the main thread and answers the client in plain messages.
//
// Client → worker
//   { type: 'init', opts }                 build the SimCore (opts as LocalHost)
//   { type: 'command', id, c }             → { type: 'result', id, r }
//   { type: 'query', id, q }               → { type: 'result', id, r }
//   { type: 'tick', req }                  → { type: 'frame', frame, field? }
//   { type: 'perf', on }
//   { type: 'buffer', data }               a field buffer handed back for reuse
// Worker → client
//   { type: 'info', info }, { type: 'event', ev }
//
// Field painting: the painter writes into a worker-side RGBA buffer; a frame
// whose lattice stepped carries it as { data, width, height } with the
// ArrayBuffer transferred (no copy, no SharedArrayBuffer: GitHub Pages sends
// no COOP/COEP headers). The client returns the previous buffer, which the
// painter fills next (paint overwrites every texel).
import { SimCore } from './host.js';
import { answer, eventForClient } from './host-protocol.js';

let core = null;
let spare = null;

function onEvent(ev) {
  self.postMessage({ type: 'event', ev: eventForClient(core, ev) });
}

self.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      core = new SimCore({ ...m.opts, texture: { image: { data: new Uint8Array(0) } } });
      core.sim.on(onEvent);
      self.postMessage({ type: 'info', info: { ...core.info(), mode: 'client' } });
      break;
    case 'command':
    case 'query':
      self.postMessage(answer(core, m));
      break;
    case 'perf':
      core.perf = !!m.on;
      break;
    case 'buffer':
      spare = m.data;
      break;
    case 'tick': {
      const frame = core.tick(m.req);
      if (frame.fieldReady) {
        const img = core.texture.image;
        const field = { data: img.data, width: img.width, height: img.height };
        img.data = spare && spare.length === field.data.length ? spare : new Uint8Array(field.data.length);
        spare = null;
        self.postMessage({ type: 'frame', frame, field }, [field.data.buffer]);
      } else {
        self.postMessage({ type: 'frame', frame });
      }
      break;
    }
    default:
      break;
  }
};
