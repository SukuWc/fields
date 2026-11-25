// Web Worker side of the replay player (ReplayHost, src/replay-host.js): the
// replayed race, its seeking and the look-ahead scan off the page's thread.
// The protocol and the work are in src/replay-worker-core.js.
import { createReplayWorker } from './replay-worker-core.js';

const onMessage = createReplayWorker((msg, transfer) => self.postMessage(msg, transfer || []));
self.onmessage = (e) => onMessage(e.data);
