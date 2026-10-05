// Lift/drag tables are 21 entries: 0° through 100° at 5°. The boom is clamped
// to ±80°, so |boom − awa| is 100° when the apparent wind is dead aft
// (awa = ±180). Reading index 21 is undefined, and `undefined * 0` is NaN.
export function aeroCoefficients(diffDeg, lift, drag, resolution) {
  const maxIndex = Math.min(lift.length, drag.length) - 2;
  let lookup = diffDeg / resolution;
  if (!Number.isFinite(lookup) || lookup < 0) lookup = 0;
  if (!(maxIndex >= 0)) return { lift: 0, drag: 0 };
  if (lookup > maxIndex) lookup = maxIndex;
  const index = Math.floor(lookup);
  const t = lookup - index;
  return {
    lift: lift[index] * (1 - t) + lift[index + 1] * t,
    drag: drag[index] * (1 - t) + drag[index + 1] * t,
  };
}

export function meanAngleDeg(a) {
  function degToRad(x) { return Math.PI / 180 * x; }
  const n = a.length;
  const sinSum = a.reduce((s, x) => s + Math.sin(degToRad(x)), 0);
  const cosSum = a.reduce((s, x) => s + Math.cos(degToRad(x)), 0);
  return 180 / Math.PI * Math.atan2(sinSum / n, cosSum / n);
}

export const range_map = function(input, in_min, in_max, out_min, out_max) {
  return (input - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

export function HSVtoRGB(h, s, v) {
  var r, g, b, i, f, p, q, t;
  if (arguments.length === 1) {
    s = h.s, v = h.v, h = h.h;
  }
  i = Math.floor(h * 6);
  f = h * 6 - i;
  p = v * (1 - s);
  q = v * (1 - f * s);
  t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v, g = t, b = p; break;
    case 1: r = q, g = v, b = p; break;
    case 2: r = p, g = v, b = t; break;
    case 3: r = p, g = q, b = v; break;
    case 4: r = t, g = p, b = v; break;
    case 5: r = v, g = p, b = q; break;
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}
