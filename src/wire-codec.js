// Binary wire codec for the server → client hot path (apps/server/room.js →
// src/remote-host.js): frame, field, flow and perf messages go as binary
// WebSocket messages; everything else (welcome, statics, events, chat,
// results) stays JSON text. No DOM, no deps.
//
// Message: [0xF5 magic][version][type][value]
//   type  1 frame, 2 field, 3 flow, 4 perf (the JSON message's `type`).
//   value the message without its `type` key, as a tagged value:
//     0 null   1 false   2 true
//     3 int    zigzag LEB128 varint (|v| < 2^31)
//     4 f32    (decoded value is rounded back to 4 decimals)
//     5 f64    little-endian
//     6 str    varint byte length + UTF-8
//     7 array  varint n + n values
//     8 object varint n + n × (key, value); key = varint k: k > 0 is the
//              (k−1)th key seen in this message, k = 0 is followed by a new
//              key string (varint length + UTF-8) that is appended to the table.
//     9 sym6   varint symbol count + 6-bit symbols packed 4 per 3 bytes
//              (field-codec.js base64url payloads, sent as raw bits; decodes
//              back to the same string).
//
// Numbers follow roundJson (room.js) exactly, so a decoded message equals
// JSON.parse(roundJson(m)): in rounded mode a non-integer is rounded to 4
// decimals (except multiples of 1/4096 and objects marked exact), and sent
// as f32 when |v| < 256 (f32 error < 5e-5 there, so rounding the decoded
// float to 4 decimals restores the exact double), else f64. Exact mode (field,
// perf) sends every non-integer as f64. Non-finite numbers become null and
// undefined object values are left out, as JSON does.
// A message with another magic or version throws WireVersionError.
import { EXACT_JSON } from './host-protocol.js';

export const WIRE_MAGIC = 0xF5;
export const WIRE_VERSION = 1;
export const WIRE_TYPES = { frame: 1, field: 2, flow: 3, perf: 4 };
const TYPE_NAMES = [null, 'frame', 'field', 'flow', 'perf'];
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SYM = new Int8Array(128).fill(-1);
for (let k = 0; k < 64; k++) SYM[ALPHA.charCodeAt(k)] = k;

export class WireVersionError extends Error {}

// A base64url string to be sent as packed 6-bit symbols (tag 9).
export class Sym6 { constructor(s) { this.s = s; } }

const te = new TextEncoder();
const td = new TextDecoder();

class Writer {
  constructor() { this.buf = new Uint8Array(4096); this.dv = new DataView(this.buf.buffer); this.n = 0; this.keys = new Map(); }
  need(k) {
    if (this.n + k <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.n + k) cap *= 2;
    const b = new Uint8Array(cap); b.set(this.buf.subarray(0, this.n));
    this.buf = b; this.dv = new DataView(b.buffer);
  }
  u8(x) { this.need(1); this.buf[this.n++] = x; }
  uv(x) { this.need(5); while (x > 127) { this.buf[this.n++] = (x & 127) | 128; x >>>= 7; } this.buf[this.n++] = x; }
  str(s) {
    // ASCII fast path; else TextEncoder.
    let ascii = true;
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) { ascii = false; break; }
    if (ascii) { this.uv(s.length); this.need(s.length); for (let i = 0; i < s.length; i++) this.buf[this.n++] = s.charCodeAt(i); return; }
    const b = te.encode(s); this.uv(b.length); this.need(b.length); this.buf.set(b, this.n); this.n += b.length;
  }
  num(v, exact) {
    if (!Number.isFinite(v)) { this.u8(0); return; }
    if (Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff) { this.u8(3); this.uv(((v << 1) ^ (v >> 31)) >>> 0); return; }
    if (!Number.isInteger(v) && !exact && !Number.isInteger(v * 4096)) {
      v = Math.round(v * 1e4) / 1e4;
      if (Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff) { this.u8(3); this.uv(((v << 1) ^ (v >> 31)) >>> 0); return; }
      if (Math.abs(v) < 256) { this.u8(4); this.need(4); this.dv.setFloat32(this.n, v, true); this.n += 4; return; }
    }
    this.u8(5); this.need(8); this.dv.setFloat64(this.n, v, true); this.n += 8;
  }
  sym6(s) {
    const L = s.length;
    this.u8(9); this.uv(L); this.need(Math.ceil(L * 3 / 4) + 3);
    const b = this.buf;
    let i = 0;
    const sv = (p) => { const c = s.charCodeAt(p); const x = c < 128 ? SYM[c] : -1; if (x < 0) throw new Error('sym6: not base64url'); return x; };
    for (; i + 4 <= L; i += 4) {
      const t = (sv(i) << 18) | (sv(i + 1) << 12) | (sv(i + 2) << 6) | sv(i + 3);
      b[this.n++] = t >> 16; b[this.n++] = (t >> 8) & 255; b[this.n++] = t & 255;
    }
    if (i < L) {
      let t = 0; const r = L - i;
      for (let q = 0; q < 4; q++) t = (t << 6) | (q < r ? sv(i + q) : 0);
      b[this.n++] = t >> 16; if (r > 1) b[this.n++] = (t >> 8) & 255; if (r > 2) b[this.n++] = t & 255;
    }
  }
  val(v, exact) {
    switch (typeof v) {
      case 'number': this.num(v, exact); return;
      case 'string': this.u8(6); this.str(v); return;
      case 'boolean': this.u8(v ? 2 : 1); return;
      case 'object': break;
      default: this.u8(0); return; // undefined / function in an array: null, as JSON
    }
    if (v === null) { this.u8(0); return; }
    if (v instanceof Sym6) { this.sym6(v.s); return; }
    if (typeof v.toJSON === 'function') { this.val(v.toJSON(), exact); return; }
    const ex = exact || !!v[EXACT_JSON];
    if (Array.isArray(v)) { this.u8(7); this.uv(v.length); for (let i = 0; i < v.length; i++) this.val(v[i], ex); return; }
    const ks = [];
    for (const k in v) { if (!Object.prototype.hasOwnProperty.call(v, k)) continue; const x = v[k]; if (x === undefined || typeof x === 'function' || typeof x === 'symbol') continue; ks.push(k); }
    this.u8(8); this.uv(ks.length);
    for (const k of ks) {
      const id = this.keys.get(k);
      if (id !== undefined) this.uv(id + 1);
      else { this.uv(0); this.str(k); this.keys.set(k, this.keys.size); }
      this.val(v[k], ex);
    }
  }
}

// m: { type: 'frame' | 'field' | 'flow' | 'perf', ... }. exact: no rounding
// (field / perf, which go as plain JSON.stringify today). Returns Uint8Array.
export function encodeWire(m, { exact = false } = {}) {
  const t = WIRE_TYPES[m.type];
  if (!t) throw new Error('encodeWire: no binary type ' + m.type);
  const w = new Writer();
  w.u8(WIRE_MAGIC); w.u8(WIRE_VERSION); w.u8(t);
  const rest = {};
  for (const k in m) if (k !== 'type') rest[k] = m[k];
  if (m[EXACT_JSON]) exact = true;
  w.val(rest, exact);
  return w.buf.slice(0, w.n);
}

// data: ArrayBuffer | Uint8Array (Node Buffer too). Returns the JSON-shaped
// message ({ type, ... }). Throws WireVersionError on a foreign build.
export function decodeWire(data) {
  const u = data instanceof Uint8Array ? data : new Uint8Array(data);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (u.length < 3 || u[0] !== WIRE_MAGIC) throw new WireVersionError('not a fields binary message');
  if (u[1] !== WIRE_VERSION) throw new WireVersionError('binary wire version ' + u[1] + ', this build speaks ' + WIRE_VERSION + ' (client and server builds differ: reload the page)');
  const type = TYPE_NAMES[u[2]];
  if (!type) throw new WireVersionError('unknown binary message type ' + u[2]);
  let p = 3;
  const keys = [];
  const uv = () => { let x = 0, s = 0, b; do { if (p >= u.length) throw new Error('wire: truncated'); b = u[p++]; x += (b & 127) * 2 ** s; s += 7; } while (b & 128); return x; };
  const str = () => {
    const n = uv(); const e = p + n; if (e > u.length) throw new Error('wire: truncated');
    let s = '';
    if (n < 64) { let ok = true; for (let i = p; i < e; i++) { const c = u[i]; if (c > 127) { ok = false; break; } s += String.fromCharCode(c); } if (ok) { p = e; return s; } }
    s = td.decode(u.subarray(p, e)); p = e; return s;
  };
  const val = () => {
    const t = u[p++];
    switch (t) {
      case 0: return null;
      case 1: return false;
      case 2: return true;
      case 3: { const z = uv(); return z % 2 ? -(z + 1) / 2 : z / 2; }
      case 4: { const f = dv.getFloat32(p, true); p += 4; return Math.round(f * 1e4) / 1e4; }
      case 5: { const f = dv.getFloat64(p, true); p += 8; return f; }
      case 6: return str();
      case 7: { const n = uv(); const a = new Array(n); for (let i = 0; i < n; i++) a[i] = val(); return a; }
      case 8: {
        const n = uv(); const o = {};
        for (let i = 0; i < n; i++) {
          const k = uv();
          let key;
          if (k === 0) { key = str(); keys.push(key); } else { key = keys[k - 1]; if (key === undefined) throw new Error('wire: bad key'); }
          o[key] = val();
        }
        return o;
      }
      case 9: {
        const L = uv(); const out = new Array(L);
        let i = 0;
        for (; i + 4 <= L; i += 4) {
          const x = (u[p] << 16) | (u[p + 1] << 8) | u[p + 2]; p += 3;
          out[i] = ALPHA[x >> 18]; out[i + 1] = ALPHA[(x >> 12) & 63]; out[i + 2] = ALPHA[(x >> 6) & 63]; out[i + 3] = ALPHA[x & 63];
        }
        if (i < L) {
          const r = L - i; let x = u[p++] << 16; if (r > 1) x |= u[p++] << 8; if (r > 2) x |= u[p++];
          for (let q = 0; q < r; q++) out[i + q] = ALPHA[(x >> (18 - 6 * q)) & 63];
        }
        return out.join('');
      }
      default: throw new Error('wire: bad tag ' + t);
    }
  };
  const body = val();
  if (p !== u.length) throw new Error('wire: trailing bytes');
  return { type, ...body };
}

// A field-codec.js message with its grid payload strings as Sym6.
export function fieldForWire(m) {
  return { ...m, g: m.g.map((a) => { const b = a.slice(); b[b.length - 1] = new Sym6(b[b.length - 1]); return b; }) };
}

// Any server message (JSON text or binary) as an object (tests, tools).
export function parseServerMessage(data) {
  if (typeof data === 'string') return JSON.parse(data);
  return decodeWire(data);
}
