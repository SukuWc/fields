// Which Math functions return different bits in Chromium, Firefox and WebKit
// than in this Node (200 000 seeded inputs each; % of the first 4000 that
// differ). docs/replay-determinism.md has the table.
//   node scripts/determinism/math-probe.mjs
import { chromium } from 'playwright';
import { firefox } from 'playwright';
import { webkit } from 'playwright';
const probe = () => {
  const N = 200000;
  let a = 12345;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const f64 = new Float64Array(1), u = new Uint32Array(f64.buffer);
  const fns = {
    sin: (x) => Math.sin(x * 20 - 10), cos: (x) => Math.cos(x * 20 - 10), tan: (x) => Math.tan(x * 3 - 1.5),
    atan2: (x, y) => Math.atan2(x * 2 - 1, y * 2 - 1), atan: (x) => Math.atan(x * 20 - 10), acos: (x) => Math.acos(x * 2 - 1),
    exp: (x) => Math.exp(x * 20 - 10), log: (x) => Math.log(x * 100 + 1e-9), log2: (x) => Math.log2(x * 100 + 1e-9), log10: (x) => Math.log10(x * 100 + 1e-9),
    pow: (x, y) => Math.pow(x * 10, y * 4 - 2), powInt2: (x) => (x * 10 - 5) ** 2, powInt3: (x) => (x * 3) ** 3, powInt4: (x) => (x * 3) ** 4, powHalf: (x) => (x * 10) ** 0.5,
    hypot: (x, y) => Math.hypot(x * 20 - 10, y * 20 - 10), sqrt: (x) => Math.sqrt(x * 100), cbrt: (x) => Math.cbrt(x * 100),
  };
  const out = {};
  for (const [k, f] of Object.entries(fns)) {
    a = 12345; let h = 0x811c9dc5; const samples = [];
    for (let i = 0; i < N; i++) { const v = f(rnd(), rnd()); f64[0] = v; h = Math.imul(h ^ u[0], 16777619); h = Math.imul(h ^ u[1], 16777619); if (i < 4000) samples.push(v); }
    out[k] = { h: h >>> 0, samples };
  }
  return out;
};
const ref = probe();
const rows = {};
for (const [name, bt] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const br = await bt.launch(); const pg = await br.newPage();
  const got = await pg.evaluate(`(${probe.toString()})()`); await br.close();
  for (const k of Object.keys(ref)) {
    let diff = 0; for (let i = 0; i < ref[k].samples.length; i++) if (!Object.is(ref[k].samples[i], got[k].samples[i])) diff++;
    (rows[k] ||= {})[name] = got[k].h === ref[k].h ? 'same' : `DIFF (${(100 * diff / ref[k].samples.length).toFixed(1)}% of 4000)`;
  }
}
console.table(rows);
