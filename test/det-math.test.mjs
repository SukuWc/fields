// Deterministic math (src/det-math.js): the fdlibm ports stay within 1 ulp of
// the engine's own functions (2 for the non-fdlibm tan / log2), keep the
// special values, and give exact powers of two.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DMath as D } from '../src/det-math.js';

let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const ulp = (x) => (x === 0 || !Number.isFinite(x) ? Number.MIN_VALUE : 2 ** (Math.floor(Math.log2(Math.abs(x))) - 52));
const native = Object.fromEntries(Object.keys(D).map((k) => [k, Math[k]]));

const CASES = {
  sin: [[(r) => r * 200 - 100], 1], cos: [[(r) => r * 200 - 100], 1], tan: [[(r) => r * 3 - 1.5], 2],
  atan: [[(r) => r * 40 - 20], 1], atan2: [[(r) => r * 2 - 1, (r) => r * 2 - 1], 1],
  acos: [[(r) => r * 2 - 1], 1], asin: [[(r) => r * 2 - 1], 1],
  exp: [[(r) => r * 100 - 50], 1], log: [[(r) => r * 1000 + 1e-9], 1], log10: [[(r) => r * 1000 + 1e-9], 1],
  log2: [[(r) => r * 1000 + 1e-9], 2], pow: [[(r) => r * 10, (r) => r * 10 - 5], 1],
  hypot: [[(r) => r * 20 - 10, (r) => r * 20 - 10], 1],
};

for (const [name, [gens, maxUlp]] of Object.entries(CASES)) {
  test(`${name} within ${maxUlp} ulp of Math.${name}`, () => {
    for (let i = 0; i < 20000; i++) {
      const args = gens.map((g) => g(rnd()));
      const want = native[name](...args), got = D[name](...args);
      assert.ok(Math.abs(want - got) <= maxUlp * ulp(want), `${name}(${args}) = ${got}, native ${want}`);
    }
  });
}

test('special values', () => {
  for (const k of ['sin', 'cos', 'atan', 'exp', 'log', 'log10', 'acos', 'asin']) {
    for (const x of [0, -0, 1, -1, Infinity, -Infinity, NaN, 0.5, Math.PI]) {
      const want = native[k](x), got = D[k](x);
      assert.ok(Object.is(want, got) || Math.abs(want - got) <= ulp(want), `${k}(${x}) = ${got}, native ${want}`);
    }
  }
  for (const [y, x] of [[0, 0], [-0, 0], [0, -0], [-0, -0], [1, 0], [-1, 0], [0, -1], [-0, -1], [Infinity, Infinity], [1, -Infinity]]) {
    assert.ok(Object.is(D.atan2(y, x), Math.atan2(y, x)), `atan2(${y}, ${x})`);
  }
  for (const [x, y] of [[0, -1], [-0, -1], [-0, 3], [-2, 3], [-2, 0.5], [2, 1024], [2, -1074], [1, NaN], [NaN, 0], [-1, Infinity], [Infinity, -1], [-Infinity, 3], [3, 4]]) {
    assert.ok(Object.is(D.pow(x, y), Math.pow(x, y)), `pow(${x}, ${y})`);
  }
  assert.equal(D.hypot(3, 4), 5);
  assert.equal(D.hypot(), 0);
  assert.equal(D.hypot(NaN, Infinity), Infinity);
});

test('powers of two are exact (sim code writes 2 ** k as DMath.pow(2, k))', () => {
  for (let k = -1074; k <= 1023; k++) assert.equal(D.pow(2, k), 2 ** k, `2^${k}`);
});
