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
