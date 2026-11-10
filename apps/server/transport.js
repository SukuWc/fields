// EXPERIMENT (exp/transport, docs/transport-experiments.md): per-client
// hot-path transport for frame / field / flow / perf binary messages.
// Control messages (welcome, results, events, chat, statics, admin) keep
// going over the WebSocket, reliable and in order, whatever is chosen here.
//
// Chosen per client by the WebSocket URL query (the page passes its own
// ?send= / ?transport= through, src/host-choice.js):
//   send=buf     (default, unchanged) skip hot messages while ws.bufferedAmount
//                > SEND_BUF_MAX (256 KiB, room.js).
//   send=latest  same, with a small threshold (LATEST_BUF_MAX): only ws's
//                user-space queue is watched, the kernel socket buffer is not.
//   send=ack     end-to-end window: the client acks the hot bytes it has
//                received (text { type: 'ack', b }) and the server keeps at
//                most `window` unacked bytes in flight (kernel buffers, WiFi
//                AP queue and browser queue included). A tick that does not
//                fit is skipped; the next one sent is the newest. The window
//                follows the measured delivery rate (rate * ACK_TARGET_MS).
//   transport=rtc  hot path on a WebRTC DataChannel (unordered,
//                maxRetransmits 0), signalled over this WebSocket
//                ({ type: 'rtc', ... }). Needs the optional node-datachannel.
//   transport=wt   hot path on WebTransport (one QUIC unidirectional stream per
//                message; an unfinished older stream of the same kind is
//                reset). Needs the optional @fails-components/webtransport and
//                the server started with --wt-port.
// The policy (send=) applies to whichever channel carries the hot path.
export const LATEST_BUF_MAX = 16 * 1024;
export const ACK_MIN_WINDOW = 32 * 1024;
export const ACK_MAX_WINDOW = 256 * 1024;
export const ACK_TARGET_MS = 120;
export const RTC_BUF_MAX = 16 * 1024;
export const SEQ_LOST_MS = 500;
const POLICIES = new Set(['buf', 'latest', 'ack']);
const TRANSPORTS = new Set(['ws', 'rtc', 'wt']);

export function transportFromQuery(params) {
  const transport = TRANSPORTS.has(params.get('transport')) ? params.get('transport') : 'ws';
  let send = POLICIES.has(params.get('send')) ? params.get('send') : (transport === 'ws' ? 'buf' : 'latest');
  const ackMs = Math.max(30, Math.min(1000, Number(params.get('ackms')) || ACK_TARGET_MS));
  return { send, transport, ackMs, name: (params.get('name') || '').slice(0, 32) };
}

// Per-client state, attached as ws.tx (index.js).
export class ClientTx {
  constructor(ws, { send = 'buf', transport = 'ws', ackMs = ACK_TARGET_MS, name = '', bufMax = 256 * 1024, now = () => performance.now() } = {}) {
    this.ws = ws;
    this.name = name;
    this.ackMs = ackMs;
    this.policy = send;
    this.want = transport;
    this.bufMax = bufMax;
    this.now = now;
    this.channel = null; // { kind, send(buf), buffered(), close() } once rtc / wt is up
    this.seq = 0;
    this.ackSeq = 0;
    this._seqQ = [];
    this._seqBytes = 0;
    this.sent = 0; // hot bytes handed to a channel
    this.acked = 0;
    this.window = ACK_MIN_WINDOW;
    this.rate = 0; // bytes/s, EWMA of acks
    this._lastAck = null;
    this.stats = { frames: 0, fields: 0, other: 0, skips: 0, bytes: 0 };
  }

  buffered() {
    return this.channel ? this.channel.buffered() : (this.ws.bufferedAmount || 0);
  }

  inFlight() {
    if (!this.channel) return this.sent - this.acked;
    // Lossy channel: bytes of messages newer than the newest acked seq.
    // A message unacked after SEQ_LOST_MS counts as lost.
    const t = this.now();
    const q = this._seqQ;
    while (q.length && (q[0].seq <= this.ackSeq || t - q[0].t > SEQ_LOST_MS)) { this._seqBytes -= q[0].n; q.shift(); }
    return this._seqBytes;
  }

  // May a hot message of `size` bytes go now? reserve: bytes to keep free
  // for a higher-priority message of this tick (the frame).
  ok(size, reserve = 0, kind = 'frame') {
    // WebTransport: at most one unfinished stream per kind (latest-only).
    if (this.channel && this.channel.busy && this.policy !== 'ack') return !this.channel.busy(kind);
    if (this.policy === 'ack') {
      const f = this.inFlight();
      return f === 0 || f + size + reserve <= this.window;
    }
    const max = this.policy === 'latest' ? (this.channel ? RTC_BUF_MAX : LATEST_BUF_MAX) : (this.channel ? Math.max(this.bufMax, RTC_BUF_MAX) : this.bufMax);
    return this.buffered() <= max;
  }

  send(buf, kind) {
    const n = buf.byteLength;
    if (this.channel) {
      // Unordered channels: [u32 seq][wire message], so the client can drop
      // a message that arrives after a newer one (remote-host.js _onAltHot).
      const out = new Uint8Array(n + 4);
      const q = ++this.seq;
      out[0] = q >>> 24; out[1] = (q >>> 16) & 255; out[2] = (q >>> 8) & 255; out[3] = q & 255;
      out.set(buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, n), 4);
      this.channel.send(out, kind);
      this._seqQ.push({ seq: q, n: out.byteLength, t: this.now() });
      this._seqBytes += out.byteLength;
    } else this.ws.send(buf);
    this.sent += n;
    this.stats.bytes += n;
    if (kind === 'frame') this.stats.frames++; else if (kind === 'field') this.stats.fields++; else this.stats.other++;
  }

  // Lossy channels ack the newest seq received ({ type: 'ack', s }).
  onAckSeq(sq, b) {
    if (!Number.isFinite(sq) || sq <= this.ackSeq || sq > this.seq) return;
    this.ackSeq = sq;
    this.onAck(b, true);
  }

  onAck(b, viaSeq = false) {
    if (viaSeq) b = Math.min(b, this.sent);
    if (!Number.isFinite(b) || b <= this.acked || b > this.sent) return;
    const t = this.now();
    // Delivery rate over the last second of acks (a burst after a WiFi
    // stall must not look like a fast link).
    this._acks = this._acks || [];
    this._acks.push({ t, b });
    while (this._acks.length > 2 && t - this._acks[0].t > 1000) this._acks.shift();
    const a0 = this._acks[0];
    const span = Math.max(250, t - a0.t);
    this.rate = (b - a0.b) * 1000 / span;
    this.acked = b;
    // 1.25x: probe for more bandwidth until the queue delay reaches ~target.
    this.window = Math.max(ACK_MIN_WINDOW, Math.min(ACK_MAX_WINDOW, 1.25 * this.rate * this.ackMs / 1000));
  }

  snapshot() {
    return { name: this.name, policy: this.policy, transport: this.channel ? this.channel.kind : 'ws', want: this.want, buffered: this.buffered(), wsBuffered: this.ws.bufferedAmount || 0, inFlight: this.policy === 'ack' ? this.inFlight() : null, window: Math.round(this.window), rate: Math.round(this.rate), ...this.stats };
  }

  close() { if (this.channel) { try { this.channel.close(); } catch { /* closed */ } this.channel = null; } }
}

// ---------- WebRTC (node-datachannel, optional) ----------
let ndc = null;
async function loadNdc() {
  if (ndc) return ndc;
  try { ndc = (await import('node-datachannel')).default; } catch (e) { ndc = null; throw new Error('node-datachannel not installed: ' + e.message); }
  // usrsctp's own send buffer (default ~1 MiB) is a second hidden queue,
  // like the kernel's TCP send buffer: keep it small so stale messages
  // wait in libdatachannel's queue (bufferedAmount), where we can skip.
  const sndbuf = Number(process.env.RTC_SCTP_SNDBUF || 32 * 1024);
  // Short retransmit timers: a lost SACK must not freeze the send side for
  // usrsctp's default >= 1 s RTO (the frames behind it go stale).
  if (ndc.setSctpSettings) ndc.setSctpSettings({ sendBufferSize: sndbuf > 0 ? sndbuf : undefined, minRetransmitTimeout: 100, initialRetransmitTimeout: 200, maxRetransmitTimeout: 1000, delayedSackTime: 10 });
  return ndc;
}

// Signalling for one client: m = { type: 'rtc', offer?: { sdp, type }, cand?: { c, mid } }.
// The client makes the offer and the channels; answers go back as
// { type: 'rtc', answer } / { type: 'rtc', cand }.
export async function rtcSignal(tx, m, sendText, { portRangeBegin, portRangeEnd, announceIp } = {}) {
  if (m.offer) {
    const lib = await loadNdc();
    if (tx._pc) { try { tx._pc.close(); } catch { /* */ } }
    const cfg = { iceServers: [], maxMessageSize: 262144 };
    if (portRangeBegin) { cfg.portRangeBegin = portRangeBegin; cfg.portRangeEnd = portRangeEnd || portRangeBegin; }
    const pc = new lib.PeerConnection('srv', cfg);
    tx._pc = pc;
    const fix = (s) => (announceIp ? s.replace(/(a=candidate:\S+ \d+ UDP \d+ )(\S+)/gi, `$1${announceIp}`).replace(/^(candidate:\S+ \d+ UDP \d+ )(\S+)/i, `$1${announceIp}`) : s);
    pc.onLocalDescription((sdp, type) => sendText({ type: 'rtc', answer: { sdp: fix(sdp), type: type.toLowerCase() } }));
    pc.onLocalCandidate((c, mid) => sendText({ type: 'rtc', cand: { c: fix(c), mid } }));
    pc.onDataChannel((dc) => {
      if (dc.getLabel() !== 'hot') return;
      const up = () => {
        tx.channel = {
          kind: 'rtc',
          send: (buf) => { try { dc.sendMessageBinary(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)); } catch { /* closing */ } },
          buffered: () => { try { return dc.bufferedAmount(); } catch { return 0; } },
          close: () => { try { dc.close(); pc.close(); } catch { /* */ } },
        };
        sendText({ type: 'rtc', open: true });
      };
      if (dc.isOpen()) up(); else dc.onOpen(up);
      dc.onClosed(() => { if (tx.channel && tx.channel.kind === 'rtc') { tx.channel = null; sendText({ type: 'rtc', open: false }); } });
    });
    pc.setRemoteDescription(m.offer.sdp, m.offer.type);
  } else if (m.cand && tx._pc) {
    try { tx._pc.addRemoteCandidate(m.cand.c, m.cand.mid); } catch { /* late */ }
  }
}

// ---------- WebTransport (@fails-components/webtransport, optional) ----------
// One Http3Server for the process. A client opens a session at
// /wt?k=<key> where key came from the server over the WebSocket
// ({ type: 'wt', url, hash, key }), so the session finds its ClientTx.
export async function startWebTransport({ port, host = '0.0.0.0', cert, key: privKey, hash }) {
  const { Http3Server } = await import('@fails-components/webtransport');
  const { randomBytes } = await import('node:crypto');
  const server = new Http3Server({ host, port, secret: randomBytes(16).toString('hex'), cert, privKey });
  const pending = new Map(); // key -> tx
  server.startServer();
  await server.ready;
  (async () => {
    for await (const s of server.sessionStream('/wt')) {
      (async () => {
        try {
          await s.ready;
          // The client repeats its key as a datagram until { type: 'wt', open }
          // reaches it over the WebSocket (a datagram may be lost).
          const r = s.datagrams.readable.getReader();
          let tx = null, k;
          while (!tx) {
            const { value, done } = await r.read();
            if (done) return;
            k = Buffer.from(value).toString();
            tx = pending.get(k);
          }
          pending.delete(k);
          (async () => { try { for (;;) { const { done } = await r.read(); if (done) break; } } catch { /* closed */ } })();
          // kind -> bytes of its unfinished stream. A new message of a kind
          // is only sent once the previous one is fully written (busy), so
          // at most one stale message per kind is ever queued.
          const inflight = {};
          tx.channel = {
            kind: 'wt',
            busy: (kind) => !!inflight[kind],
            send: (buf, kind) => {
              inflight[kind] = buf.byteLength;
              const done = () => { inflight[kind] = 0; };
              s.createUnidirectionalStream().then((st) => {
                const w = st.getWriter();
                return w.write(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).then(() => w.close());
              }).then(done, done);
            },
            buffered: () => Object.values(inflight).reduce((a, b) => a + b, 0),
            close: () => { try { s.close(); } catch { /* */ } },
          };
          tx._sendText({ type: 'wt', open: true });
          s.closed.finally(() => { if (tx.channel && tx.channel.kind === 'wt') { tx.channel = null; tx._sendText({ type: 'wt', open: false }); } });
        } catch { /* session failed */ }
      })();
    }
  })();
  return {
    port, hash,
    offer(tx, sendText, hostName) {
      const k = Math.random().toString(36).slice(2) + Date.now().toString(36);
      pending.set(k, tx);
      tx._sendText = sendText;
      setTimeout(() => pending.delete(k), 30000).unref?.();
      sendText({ type: 'wt', url: `https://${hostName}:${port}/wt`, hash, key: k });
    },
    close: () => { try { server.stopServer(); } catch { /* */ } },
  };
}

// Self-signed ECDSA P-256 cert valid < 14 days (WebTransport
// serverCertificateHashes rule), made with the openssl CLI.
export async function makeWtCert(names = ['localhost']) {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { X509Certificate, createHash } = await import('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtcert-'));
  const san = names.map((n) => (/^[\d.]+$/.test(n) ? 'IP:' : 'DNS:') + n).join(',');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '13', '-subj', '/CN=sailzone-wt', '-addext', 'subjectAltName=' + san], { stdio: 'ignore' });
  const cert = fs.readFileSync(path.join(dir, 'c.pem'), 'utf8');
  const key = fs.readFileSync(path.join(dir, 'k.pem'), 'utf8');
  const hash = createHash('sha256').update(new X509Certificate(cert).raw).digest('base64');
  return { cert, key, hash };
}
