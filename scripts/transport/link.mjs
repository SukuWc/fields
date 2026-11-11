// Simulated mobile link for the transport bench (scripts/transport/bench.mjs).
// tc netem is not available in the bench box, so the link is shaped in
// user space. Only the server -> client direction is shaped (the phone's
// downlink); client -> server is just delayed.
//   rateKbps   bottleneck bandwidth (token bucket, 5 ms granularity)
//   delayMs    one-way propagation delay (each direction)
//   queueBytes bottleneck queue (a WiFi AP / driver buffer). TCP: when full,
//              the proxy stops reading, so TCP flow control pushes the
//              backlog into the server's kernel send buffer and then ws's
//              bufferedAmount, like a real bottleneck. UDP: drop-tail.
//   stallPct / stallMs   WiFi retries / power save: every 100 ms the link
//              freezes for stallMs with probability stallPct %.
//   lossPct    UDP only: random packet loss. (A TCP stream can't lose bytes;
//              its losses show up as stalls, which stallPct models.)
import net from 'node:net';
import dgram from 'node:dgram';

class Shaper {
  constructor({ rateKbps, delayMs = 0, stallPct = 0, stallMs = 0 }, deliver) {
    this.rate = rateKbps * 1000 / 8 / 1000; // bytes per ms
    this.delayMs = delayMs;
    this.stallPct = stallPct;
    this.stallMs = stallMs;
    this.deliver = deliver;
    this.q = [];
    this.qBytes = 0;
    this.budget = 0;
    this.last = performance.now();
    this.stallUntil = 0;
    this.nextStallRoll = this.last + 100;
    this.timer = setInterval(() => this.pump(), 5);
    this.onDrain = null;
  }
  push(buf) { this.q.push(buf); this.qBytes += buf.length; this.pump(); }
  pump() {
    const t = performance.now();
    while (t >= this.nextStallRoll) {
      if (Math.random() * 100 < this.stallPct) this.stallUntil = Math.max(this.stallUntil, this.nextStallRoll + this.stallMs);
      this.nextStallRoll += 100;
    }
    const dt = t - this.last;
    this.last = t;
    if (t < this.stallUntil) { this.budget = 0; return; }
    this.budget = Math.min(this.budget + dt * this.rate, 16 * 1024);
    while (this.q.length && this.budget > 0) {
      let b = this.q[0];
      if (b.length > this.budget && this.splittable) {
        const n = Math.floor(this.budget);
        if (n <= 0) break;
        this.q[0] = b.subarray(n);
        b = b.subarray(0, n);
      } else if (b.length > this.budget && !this.splittable) {
        // A datagram waits for the whole budget (budget may go negative).
        if (this.budget < b.length) { this.budget -= 0; break; }
      } else this.q.shift();
      this.budget -= b.length;
      this.qBytes -= b.length;
      const out = Buffer.from(b);
      if (this.delayMs > 0) setTimeout(() => this.deliver(out), this.delayMs); else this.deliver(out);
    }
    if (this.onDrain) this.onDrain();
  }
  close() { clearInterval(this.timer); }
}

// TCP proxy: listen(), clients connect to its port instead of the server's.
export class TcpLink {
  constructor(target, opts) { this.target = target; this.opts = opts; this.conns = new Set(); }
  listen() {
    this.server = net.createServer((client) => {
      const up = net.connect(this.target.port, this.target.host);
      client.setNoDelay(true); up.setNoDelay(true);
      const qMax = this.opts.queueBytes || 256 * 1024;
      const sh = new Shaper(this.opts, (b) => { if (!client.destroyed) client.write(b); });
      sh.splittable = true;
      let paused = false;
      sh.onDrain = () => { if (paused && sh.qBytes < qMax / 2) { paused = false; up.resume(); } };
      up.on('data', (b) => { sh.push(b); if (sh.qBytes > qMax && !paused) { paused = true; up.pause(); } });
      client.on('data', (b) => { const d = this.opts.delayMs || 0; if (d) setTimeout(() => up.write(b), d); else up.write(b); });
      const end = () => { sh.close(); client.destroy(); up.destroy(); this.conns.delete(c); };
      const c = { sh };
      this.conns.add(c);
      client.on('error', end); up.on('error', end); client.on('close', end); up.on('close', end);
    });
    return new Promise((r) => this.server.listen(0, '127.0.0.1', () => r(this.server.address().port)));
  }
  queued() { let n = 0; for (const c of this.conns) n += c.sh.qBytes; return n; }
  close() { this.server.close(); for (const c of this.conns) c.sh.close(); }
}

// UDP relay: clients send to its port; it relays to target (set now or
// later with setTarget, for an ICE candidate learned during signalling).
export class UdpLink {
  constructor(target, opts) { this.target = target; this.opts = opts; this.flows = new Map(); this.dropped = 0; }
  listen(host = '0.0.0.0') {
    this.a = dgram.createSocket('udp4');
    this.a.on('message', (msg, rinfo) => {
      if (!this.target) return;
      const k = rinfo.address + ':' + rinfo.port;
      let f = this.flows.get(k);
      if (!f) {
        const b = dgram.createSocket('udp4');
        const qMax = this.opts.queueBytes || 256 * 1024;
        const sh = new Shaper(this.opts, (p) => this.a.send(p, rinfo.port, rinfo.address));
        sh.splittable = false;
        b.on('message', (p) => {
          if (Math.random() * 100 < (this.opts.lossPct || 0)) { this.dropped++; return; }
          if (sh.qBytes + p.length > qMax) { this.dropped++; return; }
          sh.push(p);
        });
        b.bind(0);
        f = { b, sh };
        this.flows.set(k, f);
      }
      const d = this.opts.delayMs || 0;
      const send = () => f.b.send(msg, this.target.port, this.target.host);
      if (Math.random() * 100 < (this.opts.lossPct || 0)) return;
      if (d) setTimeout(send, d); else send();
    });
    return new Promise((r) => this.a.bind(0, host, () => r(this.port = this.a.address().port)));
  }
  setTarget(t) { this.target = t; }
  queued() { let n = 0; for (const f of this.flows.values()) n += f.sh.qBytes; return n; }
  close() { try { this.a.close(); } catch { /* */ } for (const f of this.flows.values()) { f.sh.close(); try { f.b.close(); } catch { /* */ } } }
}
