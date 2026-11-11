// Server + client defaults for the hot-path flow control (apps/server/transport.js):
// a current RemoteHost acks by default (window on), ?send=legacy does not,
// and a raw old-style client that never acks still gets every frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/index.js';
import { RemoteHost } from '../src/remote-host.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { mapW: 50, mapH: 100, simRes: '4f' };

test('default = ack, send=legacy = old behaviour, non-acking client falls back to legacy', async () => {
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 16);
  const srv = await startServer({ port: 0, host: '127.0.0.1', graceMs: 0, adminGate: false, fieldHz: 0 });
  const base = `ws://127.0.0.1:${srv.port}/?room=tx`;
  try {
    const def = new RemoteHost(base + '&name=def', opts, null, { WebSocketImpl: WebSocket });
    await def.ready;
    const legacy = new RemoteHost(base + '&send=legacy&name=legacy', opts, null, { WebSocketImpl: WebSocket });
    await legacy.ready;
    // An old cached page: never sends { type: 'ack' }.
    const raw = new WebSocket(base + '&name=raw');
    let rawFrames = 0;
    raw.on('message', (d, bin) => { if (bin && d[2] === 1) rawFrames++; });
    await new Promise((r) => raw.on('open', r));
    raw.send(JSON.stringify({ type: 'init', opts }));
    const f0 = def.framesReceived;
    await sleep(2500);
    const snap = await (await fetch(`http://127.0.0.1:${srv.port}/api/transport`)).json();
    const by = Object.fromEntries(snap.rooms[0].clients.map((c) => [c.name, c]));
    assert.equal(def.sendPolicy, 'ack');
    assert.equal(by.def.policy, 'ack');
    assert.equal(by.def.ackSeen, true, 'default client acks');
    assert.equal(by.def.mode, 'ack');
    assert.equal(legacy.sendPolicy, 'legacy');
    assert.equal(by.legacy.policy, 'legacy');
    assert.equal(by.legacy.ackSeen, false);
    assert.equal(by.raw.policy, 'ack', 'server default');
    assert.equal(by.raw.ackSeen, false);
    assert.equal(by.raw.mode, 'legacy', 'never acked: legacy rule');
    assert.ok(rawFrames >= 50, `non-acking client keeps getting frames (${rawFrames} in 2.5 s)`);
    assert.ok(def.framesReceived - f0 >= 50, 'acking client gets frames too');
    def.terminate(); legacy.terminate(); raw.close();
  } finally {
    await srv.close();
  }
});
