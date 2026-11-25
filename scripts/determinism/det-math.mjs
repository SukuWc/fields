// PROTOTYPE (replay determinism spike, docs/replay-determinism.md): pure-JS
// ports of the fdlibm functions the sim calls, built from + - * / and
// Math.sqrt only (all IEEE-754 correctly rounded), so every engine returns
// the same bits. Not wired into the app; installDeterministicMath() swaps
// them onto the global Math for the harness (planck-js reads Math through
// Object.create(Math), so it picks them up too).
//
// Covered: sin, cos, tan, atan, atan2, acos, asin, exp, log, log10, log2,
// pow, hypot. The ** operator cannot be patched: Firefox and WebKit compute
// an integer power by repeated multiplication, V8 does not, so the sim's
// x ** n with n other than 2 (exact everywhere) must become pow() / x*x*x. sin/cos/tan of |x| > 2^19·π/2
// fall back to native (no Payne-Hanek reduction; the sim never gets there).
const F = new Float64Array(1);
const W = new Int32Array(F.buffer); // little-endian: W[0] low, W[1] high
const hi = (x) => { F[0] = x; return W[1]; };
const lo = (x) => { F[0] = x; return W[0]; };
const withHi = (x, h) => { F[0] = x; W[1] = h; return F[0]; };
const withLo = (x, l) => { F[0] = x; W[0] = l; return F[0]; };

const native = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, atan2: Math.atan2, acos: Math.acos, asin: Math.asin,
  exp: Math.exp, log: Math.log, log10: Math.log10, log2: Math.log2, pow: Math.pow, hypot: Math.hypot,
};

// ---- argument reduction (e_rem_pio2.c, small and medium |x|) ----
const invpio2 = 6.36619772367581382433e-01;
const pio2_1 = 1.57079632673412561417e+00;
const pio2_1t = 6.07710050650619224932e-11;
const pio2_2 = 6.07710050630396597660e-11;
const pio2_2t = 2.02226624879595063154e-21;
const pio2_3 = 2.02226624871116645580e-21;
const pio2_3t = 8.47842766036889956997e-32;
const RY = [0, 0];
// Returns n (x = n·π/2 + RY[0] + RY[1]), or null when |x| is too large.
function remPio2(x) {
  const hx = hi(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) { RY[0] = x; RY[1] = 0; return 0; }
  if (ix < 0x4002d97c) {
    let z;
    if (hx > 0) {
      z = x - pio2_1;
      if (ix !== 0x3ff921fb) { RY[0] = z - pio2_1t; RY[1] = (z - RY[0]) - pio2_1t; }
      else { z -= pio2_2; RY[0] = z - pio2_2t; RY[1] = (z - RY[0]) - pio2_2t; }
      return 1;
    }
    z = x + pio2_1;
    if (ix !== 0x3ff921fb) { RY[0] = z + pio2_1t; RY[1] = (z - RY[0]) + pio2_1t; }
    else { z += pio2_2; RY[0] = z + pio2_2t; RY[1] = (z - RY[0]) + pio2_2t; }
    return -1;
  }
  if (ix > 0x413921fb) return null;
  let t = Math.abs(x);
  const n = (t * invpio2 + 0.5) | 0;
  const fn = n;
  let r = t - fn * pio2_1;
  let w = fn * pio2_1t;
  const j = ix >> 20;
  RY[0] = r - w;
  let i = j - ((hi(RY[0]) >> 20) & 0x7ff);
  if (i > 16) {
    t = r; w = fn * pio2_2; r = t - w; w = fn * pio2_2t - ((t - r) - w); RY[0] = r - w;
    i = j - ((hi(RY[0]) >> 20) & 0x7ff);
    if (i > 49) { t = r; w = fn * pio2_3; r = t - w; w = fn * pio2_3t - ((t - r) - w); RY[0] = r - w; }
  }
  RY[1] = (r - RY[0]) - w;
  if (hx < 0) { RY[0] = -RY[0]; RY[1] = -RY[1]; return -n; }
  return n;
}

// ---- kernels (k_sin.c, k_cos.c, k_tan.c) ----
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
function kSin(x, y, iy) {
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return x;
  const z = x * x, v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
function kCos(x, y) {
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : withLo(withHi(0, ix - 0x00200000), 0);
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

export function sin(x) {
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kSin(x, 0, 0);
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x);
  if (n === null) return native.sin(x);
  switch (n & 3) {
    case 0: return kSin(RY[0], RY[1], 1);
    case 1: return kCos(RY[0], RY[1]);
    case 2: return -kSin(RY[0], RY[1], 1);
    default: return -kCos(RY[0], RY[1]);
  }
}

export function cos(x) {
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kCos(x, 0);
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x);
  if (n === null) return native.cos(x);
  switch (n & 3) {
    case 0: return kCos(RY[0], RY[1]);
    case 1: return -kSin(RY[0], RY[1], 1);
    case 2: return -kCos(RY[0], RY[1]);
    default: return kSin(RY[0], RY[1], 1);
  }
}

// Not fdlibm's k_tan (rarely used, not on the sim path): sin/cos of the
// same reduced argument, still bit-identical everywhere.
export function tan(x) { return sin(x) / cos(x); }

// ---- atan / atan2 (s_atan.c, e_atan2.c) ----
const atanhi = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const atanlo = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const aT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
export function atan(x) {
  const hx = hi(x);
  const ix = hx & 0x7fffffff;
  let id;
  if (x !== x) return NaN;
  if (ix >= 0x44100000) return hx > 0 ? atanhi[3] + atanlo[3] : -atanhi[3] - atanlo[3];
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e200000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) { id = 0; x = (2 * x - 1) / (2 + x); }
      else { id = 1; x = (x - 1) / (x + 1); }
    } else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); }
    else { id = 3; x = -1 / x; }
  }
  const z = x * x, w = z * z;
  const s1 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10])))));
  const s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = atanhi[id] - ((x * (s1 + s2) - atanlo[id]) - x);
  return hx < 0 ? -r : r;
}

const PI = 3.1415926535897931160e+00, PI_LO = 1.2246467991473531772e-16, PI_O_2 = 1.5707963267948965580e+00, PI_O_4 = 7.8539816339744827900e-01;
export function atan2(y, x) {
  if (x !== x || y !== y) return NaN;
  const hx = hi(x), ix = hx & 0x7fffffff, lx = lo(x);
  const hy = hi(y), iy = hy & 0x7fffffff, ly = lo(y);
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y);
  const m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
  if ((iy | ly) === 0) {
    switch (m) { case 0: case 1: return y; case 2: return PI; default: return -PI; }
  }
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 : PI_O_2;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      switch (m) { case 0: return PI_O_4; case 1: return -PI_O_4; case 2: return 3 * PI_O_4; default: return -3 * PI_O_4; }
    }
    switch (m) { case 0: return 0; case 1: return -0; case 2: return PI; default: return -PI; }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 : PI_O_2;
  const k = (iy - ix) >> 20;
  let z;
  if (k > 60) z = PI_O_2 + 0.5 * PI_LO;
  else if (hx < 0 && k < -60) z = 0;
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return PI - (z - PI_LO);
    default: return (z - PI_LO) - PI;
  }
}

// ---- acos / asin (e_acos.c, e_asin.c) ----
const pio2_hi = 1.57079632679489655800e+00, pio2_lo = 6.12323399573676603587e-17, pio4_hi = 7.85398163397448278999e-01;
const pS0 = 1.66666666666666657415e-01, pS1 = -3.25565818622400915405e-01, pS2 = 2.01212532134862925881e-01;
const pS3 = -4.00555345006794114027e-02, pS4 = 7.91534994289814532176e-04, pS5 = 3.47933107596021167570e-05;
const qS1 = -2.40339491173441421878e+00, qS2 = 2.02094576023350569471e+00, qS3 = -6.88283971605453293030e-01, qS4 = 7.70381505559019352791e-02;
const rpq = (z) => (z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))))) / (1 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4))));
export function acos(x) {
  const hx = hi(x), ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | lo(x)) === 0) return hx > 0 ? 0 : PI + 2 * pio2_lo;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    if (ix <= 0x3c600000) return pio2_hi + pio2_lo;
    const r = rpq(x * x);
    return pio2_hi - (x - (pio2_lo - x * r));
  }
  if (hx < 0) {
    const z = (1 + x) * 0.5;
    const s = Math.sqrt(z);
    const w = rpq(z) * s - pio2_lo;
    return PI - 2 * (s + w);
  }
  const z = (1 - x) * 0.5;
  const s = Math.sqrt(z);
  const df = withLo(s, 0);
  const c = (z - df * df) / (s + df);
  const w = rpq(z) * s + c;
  return 2 * (df + w);
}
export function asin(x) {
  const hx = hi(x), ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | lo(x)) === 0) return x * pio2_hi + x * pio2_lo;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    if (ix < 0x3e400000) return x;
    return x + x * rpq(x * x);
  }
  const w0 = 1 - Math.abs(x);
  const t = w0 * 0.5;
  const s = Math.sqrt(t);
  const r = rpq(t);
  let out;
  if (ix >= 0x3fef3333) out = pio2_hi - (2 * (s + s * r) - pio2_lo);
  else {
    const w = withLo(s, 0);
    const c = (t - w * w) / (s + w);
    const p = 2 * s * r - (pio2_lo - 2 * c);
    const q = pio4_hi - 2 * w;
    out = pio4_hi - (p - q);
  }
  return hx > 0 ? out : -out;
}

// ---- exp (e_exp.c) ----
const ln2HI = [6.93147180369123816490e-01, -6.93147180369123816490e-01];
const ln2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10];
const invln2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05;
const P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
const twom1000 = 9.33263618503218878990e-302;
export function exp(x) {
  let hx = hi(x);
  const xsb = (hx >> 31) & 1;
  hx &= 0x7fffffff;
  if (x !== x) return NaN;
  if (hx >= 0x40862e42) {
    if (hx >= 0x7ff00000) return xsb === 0 ? x : 0;
    if (x > 7.09782712893383973096e+02) return Infinity;
    if (x < -7.45133219101941108420e+02) return 0;
  }
  let hi_ = 0, lo_ = 0, k = 0;
  if (hx > 0x3fd62e42) {
    if (hx < 0x3ff0a2b2) { hi_ = x - ln2HI[xsb]; lo_ = ln2LO[xsb]; k = 1 - xsb - xsb; }
    else {
      k = (invln2 * x + (xsb ? -0.5 : 0.5)) | 0;
      hi_ = x - k * ln2HI[0];
      lo_ = k * ln2LO[0];
    }
    x = hi_ - lo_;
  } else if (hx < 0x3e300000) {
    return 1 + x;
  }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - ((lo_ - (x * c) / (2 - c)) - hi_);
  if (k >= -1021) return withHi(y, hi(y) + (k << 20));
  return withHi(y, hi(y) + ((k + 1000) << 20)) * twom1000;
}

// ---- log / log10 / log2 (e_log.c, e_log10.c) ----
const ln2_hi = 6.93147180369123816490e-01, ln2_lo = 1.90821492927058770002e-10, two54 = 1.80143985094819840000e+16;
const Lg1 = 6.666666666666735130e-01, Lg2 = 3.999999999940941908e-01, Lg3 = 2.857142874366239149e-01, Lg4 = 2.222219843214978396e-01;
const Lg5 = 1.818357216161805012e-01, Lg6 = 1.531383769920937332e-01, Lg7 = 1.479819860511658591e-01;
export function log(x) {
  let hx = hi(x);
  const lx = lo(x);
  let k = 0;
  if (x !== x) return NaN;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54; x *= two54; hx = hi(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = withHi(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  const f = x - 1;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) return k === 0 ? 0 : k * ln2_hi + k * ln2_lo;
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    return k === 0 ? f - R : k * ln2_hi - ((R - k * ln2_lo) - f);
  }
  const s = f / (2 + f);
  const dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  const t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    return k === 0 ? f - (hfsq - s * (hfsq + R)) : dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
  }
  return k === 0 ? f - s * (f - R) : dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
}
const ivln10 = 4.34294481903251816668e-01, log10_2hi = 3.01029995663611771306e-01, log10_2lo = 3.69423907715893078616e-13;
export function log10(x) {
  let hx = hi(x);
  const lx = lo(x);
  let k = 0;
  if (x !== x) return NaN;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54; x *= two54; hx = hi(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  const i = (k >>> 31);
  hx = (hx & 0x000fffff) | ((0x3ff - i) << 20);
  const y = k + i;
  x = withHi(x, hx);
  const z = y * log10_2lo + ivln10 * log(x);
  return z + y * log10_2hi;
}
// No fdlibm log2: exact on powers of two, else log(x)/ln 2 (deterministic,
// not correctly rounded).
export function log2(x) {
  if (x > 0 && x < Infinity) {
    const h = hi(x);
    if ((h & 0x000fffff) === 0 && lo(x) === 0 && h >= 0x00100000) return (h >> 20) - 1023;
  }
  return log(x) / Math.LN2;
}

// ---- pow (e_pow.c, openlibm variant with the y = 2, 3, 4 shortcuts) ----
// Engines differ most here: SpiderMonkey and JSC use repeated multiplication
// for an integer exponent, V8 does not.
const bp = [1.0, 1.5], dp_h = [0.0, 5.84962487220764160156e-01], dp_l = [0.0, 1.35003920212974897128e-08];
const two53 = 9007199254740992.0, huge = 1.0e300, tiny = 1.0e-300;
const L1 = 5.99999999999994648725e-01, L2 = 4.28571428578550184252e-01, L3 = 3.33333329818377432918e-01;
const L4 = 2.72728123808534006489e-01, L5 = 2.30660745775561754067e-01, L6 = 2.06975017800338417784e-01;
const lg2 = 6.93147180559945286227e-01, lg2_h = 6.93147182464599609375e-01, lg2_l = -1.90465429995776804525e-09;
const ovt = 8.0085662595372944372e-17;
const cp = 9.61796693925975554329e-01, cp_h = 9.61796700954437255859e-01, cp_l = -7.02846165095275826516e-09;
const ivln2 = 1.44269504088896338700e+00, ivln2_h = 1.44269502162933349609e+00, ivln2_l = 1.92596299112661746887e-08;
export function pow(x, y) {
  if (y !== y) return NaN;
  const hx = hi(x), lx = lo(x) >>> 0, hy = hi(y), ly = lo(y) >>> 0;
  let ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;
  if ((iy | ly) === 0) return 1;
  // JS (unlike C): (±1) ** ±Infinity is NaN.
  if (iy === 0x7ff00000 && ly === 0 && ((ix - 0x3ff00000) | lx) === 0) return NaN;
  if (hx === 0x3ff00000 && lx === 0) return 1;
  if (x !== x) return NaN;
  let yisint = 0;
  if (hx < 0) {
    if (iy >= 0x43400000) yisint = 2;
    else if (iy >= 0x3ff00000) {
      const k = (iy >> 20) - 0x3ff;
      if (k > 20) { const j = ly >>> (52 - k); if (((j << (52 - k)) >>> 0) === ly) yisint = 2 - (j & 1); }
      else if (ly === 0) { const j = iy >> (20 - k); if ((j << (20 - k)) === iy) yisint = 2 - (j & 1); }
    }
  }
  if (ly === 0) {
    if (iy === 0x7ff00000) {
      if (ix >= 0x3ff00000) return hy >= 0 ? y : 0;
      return hy < 0 ? -y : 0;
    }
    if (iy === 0x3ff00000) return hy < 0 ? 1 / x : x;
    if (hy === 0x40000000) return x * x;
    if (hy === 0x40080000) return x * x * x;
    if (hy === 0x40100000) { const u = x * x; return u * u; }
    if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x);
  }
  let ax = Math.abs(x);
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) {
    let z = ax;
    if (hy < 0) z = 1 / z;
    if (hx < 0) {
      if (((ix - 0x3ff00000) | yisint) === 0) z = NaN;
      else if (yisint === 1) z = -z;
    }
    return z;
  }
  let n = (hx >>> 31) - 1;
  if ((n | yisint) === 0) return NaN;
  let sgn = 1;
  if ((n | (yisint - 1)) === 0) sgn = -1;
  let t1, t2;
  if (iy > 0x41e00000) {
    if (iy > 0x43f00000) {
      if (ix <= 0x3fefffff) return hy < 0 ? Infinity : 0;
      if (ix >= 0x3ff00000) return hy > 0 ? Infinity : 0;
    }
    if (ix < 0x3fefffff) return hy < 0 ? sgn * Infinity : sgn * 0;
    if (ix > 0x3ff00000) return hy > 0 ? sgn * Infinity : sgn * 0;
    const t = ax - 1;
    const w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
    const u = ivln2_h * t;
    const v = t * ivln2_l - w * ivln2;
    t1 = withLo(u + v, 0);
    t2 = v - (t1 - u);
  } else {
    n = 0;
    if (ix < 0x00100000) { ax *= two53; n -= 53; ix = hi(ax); }
    n += (ix >> 20) - 0x3ff;
    const j = ix & 0x000fffff;
    let k;
    ix = j | 0x3ff00000;
    if (j <= 0x3988e) k = 0;
    else if (j < 0xbb67a) k = 1;
    else { k = 0; n += 1; ix -= 0x00100000; }
    ax = withHi(ax, ix);
    let u = ax - bp[k];
    let v = 1 / (ax + bp[k]);
    const ss = u * v;
    const s_h = withLo(ss, 0);
    let t_h = withLo(withHi(0, ((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18)), 0);
    let t_l = ax - (t_h - bp[k]);
    const s_l = v * ((u - s_h * t_h) - s_h * t_l);
    let s2 = ss * ss;
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += s_l * (s_h + ss);
    s2 = s_h * s_h;
    t_h = withLo(3.0 + s2 + r, 0);
    t_l = r - ((t_h - 3.0) - s2);
    u = s_h * t_h;
    v = s_l * t_h + t_l * ss;
    const p_h = withLo(u + v, 0);
    const p_l = v - (p_h - u);
    const z_h = cp_h * p_h;
    const z_l = cp_l * p_h + p_l * cp + dp_l[k];
    const t = n;
    t1 = withLo(((z_h + z_l) + dp_h[k]) + t, 0);
    t2 = z_l - (((t1 - t) - dp_h[k]) - z_h);
  }
  const y1 = withLo(y, 0);
  const p_l = (y - y1) * t1 + y * t2;
  let p_h = y1 * t1;
  let z = p_l + p_h;
  let j = hi(z);
  let i = lo(z) >>> 0;
  if (j >= 0x40900000) {
    if (((j - 0x40900000) | i) !== 0) return sgn * Infinity;
    if (p_l + ovt > z - p_h) return sgn * Infinity;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    if (((j - 0xc090cc00) | i) !== 0) return sgn * 0;
    if (p_l <= z - p_h) return sgn * 0;
  }
  i = j & 0x7fffffff;
  let k = (i >> 20) - 0x3ff;
  n = 0;
  if (i > 0x3fe00000) {
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    const t = withLo(withHi(0, n & ~(0x000fffff >> k)), 0);
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    p_h -= t;
  }
  let t = withLo(p_l + p_h, 0);
  const u = t * lg2_h;
  const v = (p_l - (t - p_h)) * lg2 + t * lg2_l;
  z = u + v;
  const w = v - (z - u);
  t = z * z;
  t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const r = (z * t1) / (t1 - 2) - (w + z * w);
  z = 1 - (r - z);
  j = hi(z) + (n << 20);
  if ((j >> 20) <= 0) z = scalbn(z, n);
  else z = withHi(z, j);
  return sgn * z;
}
function scalbn(x, n) {
  // Exact power-of-two scaling in steps that stay normal.
  while (n < -1000) { x *= twom1000; n += 1000; }
  while (n > 1000) { x *= 1.0715086071862673e+301; n -= 1000; }
  return x * withLo(withHi(0, (n + 1023) << 20), 0);
}

// Scaled sum of squares, then one correctly rounded sqrt.
export function hypot(...v) {
  let m = 0;
  let nan = false;
  for (let i = 0; i < v.length; i++) {
    const a = Math.abs(v[i]);
    if (a === Infinity) return Infinity;
    if (a !== a) nan = true;
    else if (a > m) m = a;
  }
  if (nan) return NaN;
  if (m === 0) return 0;
  let s = 0;
  for (let i = 0; i < v.length; i++) { const r = v[i] / m; s += r * r; }
  return m * Math.sqrt(s);
}

export const DET_MATH = { sin, cos, tan, atan, atan2, acos, asin, exp, log, log10, log2, pow, hypot };

// Swap the deterministic versions onto the global Math (harness only).
export function installDeterministicMath() {
  for (const [k, f] of Object.entries(DET_MATH)) Math[k] = f;
}
export function restoreNativeMath() {
  for (const [k, f] of Object.entries(native)) Math[k] = f;
}
