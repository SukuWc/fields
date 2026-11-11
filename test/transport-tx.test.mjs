// EXPERIMENT (exp/transport): hot-path send policies (apps/server/transport.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientTx, transportFromQuery, ACK_MIN_WINDOW, LATEST_BUF_MAX, ACK_STALE_MS } from '../apps/server/transport.js';
import { transportParams } from '../src/remote-host.js';
import { hostChoice } from '../src/host-choice.js';

const fakeWs = () => ({ bufferedAmount: 0, sent: [], send(b) { this.sent.push(b); } });

test('query parsing: ack is the WebSocket default, send=legacy restores main', () => {
  assert.equal(transportFromQuery(new URLSearchParams('room=x')).send, 'ack');
  assert.equal(transportFromQuery(new URLSearchParams('send=ack')).send, 'ack', 'explicit ack = default');
  assert.equal(transportFromQuery(new URLSearchParams('send=legacy')).send, 'legacy');
  assert.equal(transportFromQuery(new URLSearchParams('send=buf')).send, 'legacy', 'buf is an alias');
  assert.equal(transportFromQuery(new URLSearchParams('send=latest')).send, 'latest');
  assert.equal(transportFromQuery(new URLSearchParams('send=bogus')).send, 'ack');
  assert.equal(transportFromQuery(new URLSearchParams('transport=rtc')).send, 'latest');
  assert.equal(transportFromQuery(new URLSearchParams('transport=wt&send=ack')).send, 'ack');
  assert.equal(new ClientTx(fakeWs()).policy, 'ack', 'ClientTx default');
  assert.equal(new ClientTx(fakeWs(), { send: 'buf' }).policy, 'legacy');
  assert.deepEqual(transportParams('ws://h/ws?room=a&transport=wt&send=ack'), { transport: 'wt', send: 'ack' });
  assert.deepEqual(transportParams('ws://h/ws?room=a'), { transport: 'ws', send: 'ack' });
  assert.deepEqual(transportParams('ws://h/ws?room=a&send=legacy'), { transport: 'ws', send: 'legacy' });
  assert.deepEqual(transportParams('ws://h/ws?room=a&send=buf'), { transport: 'ws', send: 'legacy' });
  const c = hostChoice('?host=remote&server=ws://h:1/?room=r&transport=rtc&send=ack');
  assert.match(c.server, /transport=rtc/);
  assert.match(c.server, /send=ack/);
});

test('legacy / latest look at ws.bufferedAmount only', () => {
  const ws = fakeWs();
  const buf = new ClientTx(ws, { send: 'legacy', bufMax: 256 * 1024 });
  const latest = new ClientTx(ws, { send: 'latest' });
  ws.bufferedAmount = LATEST_BUF_MAX + 1;
  assert.equal(buf.ok(1000), true);
  assert.equal(latest.ok(1000), false);
  ws.bufferedAmount = 0;
  assert.equal(latest.ok(1000), true);
});

test('ack: window of unacked bytes, frame reserved before field', () => {
  let t = 0;
  const ws = fakeWs();
  const tx = new ClientTx(ws, { send: 'ack', now: () => t });
  tx.send(new Uint8Array(100), 'frame');
  tx.onAck(100); // the window only applies once the client has acked
  assert.equal(tx.mode(), 'ack');
  tx.sent = tx.acked = 0;
  assert.equal(tx.ok(50000), true, 'nothing in flight: always one message');
  tx.send(new Uint8Array(20000), 'frame');
  assert.equal(tx.ok(8000), true);
  assert.equal(tx.ok(8000, 8000), false, 'field must leave room for the frame');
  tx.send(new Uint8Array(10000), 'frame');
  assert.equal(tx.ok(8000), false, 'window full');
  t = 100; tx.onAck(30000);
  assert.equal(tx.inFlight(), 0);
  assert.ok(tx.window >= ACK_MIN_WINDOW);
  tx.onAck(999999); // more than sent: ignored
  assert.equal(tx.acked, 30000);
});

test('ack over a lossy channel: seq acks, lost messages expire', () => {
  let t = 0;
  const out = [];
  const tx = new ClientTx(fakeWs(), { send: 'ack', transport: 'rtc', now: () => t });
  tx.channel = { kind: 'rtc', send: (b) => out.push(b), buffered: () => 0, close() {} };
  tx.ackSeen = true;
  tx.send(new Uint8Array([0xF5, 1, 1, 9]), 'frame');
  tx.send(new Uint8Array([0xF5, 1, 1, 8]), 'frame');
  assert.deepEqual([...out[1].subarray(0, 4)], [0, 0, 0, 2], 'u32 seq prefix');
  assert.equal(tx.inFlight(), 16);
  tx.onAckSeq(2, 4); // seq 1 was lost, seq 2 arrived
  assert.equal(tx.inFlight(), 0);
  tx.send(new Uint8Array(4), 'frame');
  t = 10000;
  assert.equal(tx.inFlight(), 0, 'never acked: counted lost after SEQ_LOST_MS');
});

test('a client that never acks (old cached page) keeps the legacy rule, never starves', () => {
  let t = 0;
  const ws = fakeWs();
  const tx = new ClientTx(ws, { send: 'ack', now: () => t });
  assert.equal(tx.mode(), 'legacy');
  // 10 s of 30 Hz frames + fields, no ack ever: every one may go (buffer empty).
  let sent = 0;
  for (let i = 0; i < 300; i++, t += 33) {
    if (tx.ok(8000, 0, 'frame')) { tx.send(new Uint8Array(8000), 'frame'); sent++; }
    if (tx.ok(15000, 0, 'field')) tx.send(new Uint8Array(15000), 'field');
  }
  assert.equal(sent, 300);
  assert.equal(tx.snapshot().ackSeen, false);
  assert.equal(tx.snapshot().mode, 'legacy');
  // Its ws buffer filling up still trips the old 256 KiB skip.
  ws.bufferedAmount = 300 * 1024;
  assert.equal(tx.ok(8000), false);
});

test('acks that stop are forgiven after ACK_STALE_MS (one more window, no permanent stall)', () => {
  let t = 0;
  const tx = new ClientTx(fakeWs(), { send: 'ack', now: () => t });
  tx.send(new Uint8Array(1000), 'frame');
  tx.onAck(1000);
  tx.send(new Uint8Array(40000), 'frame');
  assert.equal(tx.ok(8000), false, 'window full');
  t += ACK_STALE_MS - 1;
  assert.equal(tx.ok(8000), false, 'still waiting');
  t += 2;
  assert.equal(tx.ok(8000), true, 'forgiven');
  assert.equal(tx.stats.ackForgives, 1);
});

test('lockstep rooms never skip', () => {
  const tx = new ClientTx(fakeWs(), { send: 'ack' });
  tx.send(new Uint8Array(100), 'frame'); tx.onAck(100);
  tx.send(new Uint8Array(500000), 'frame');
  assert.equal(tx.ok(8000), false);
  tx.lockstep = true;
  assert.equal(tx.ok(8000), true);
});
