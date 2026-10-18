// Boat drawing from compact state (no planck, no Sim): the guide segments of
// one boat (forces, autopilot line, true/apparent wind chevrons, rudder,
// centreboard, sails, and the wind-indicator grid of "Toggle Field"). The
// host takes the state with Boat.renderState(view) (which also advances the
// visual smoothing: boom angles, flap phase) and the static numbers with
// Boat.renderDef(); every client builds the same segments from them with
// boatGuides(), whatever the host (local, worker, server). The formulas are
// the old Boat.graphics_model_render ones.
//
// state s: x, y (boat), px, py, pa (physics body position and angle), ha
//   (hull_angle), awa, tw (smoothed true wind direction, rad), ap (autopilot on),
//   wd (wind_direction), aht (autopilot heading target), ra (rudder angle),
//   mba, jba (drawn boom angles), mf, jf (main and jib flap amounts), ph
//   (flap phase), f (forces: [px, py, vx, vy, ...]), wg (wind grid, only with
//   show_fields: res and [vx, vy, ...] per drawn point).
// def d: rp, rl (rudder position, length), cp, cl (centreboard), mle, mbl
//   (main leading edge, boom length), jle, jbl (jib).
export const SAIL_FLAP_AMP_M = 0.12;
export const SAIL_FLAP_JIB_AMP_M = 0.08;
const SAIL_FLAP_POINTS = 9;
export const WIND_INDICATOR_SIZE = 10;

// Sail polyline p[0..3] → segments. amp 0 draws the original three segments.
export function pushSailSegments(graphics, p, amp, phase) {
  if (!(amp > 1e-4)) {
    for (let i = 0; i < 3; i++) graphics.push({ color: 0x8866ff, type: "sail", x1: p[i].x, y1: p[i].y, x2: p[i + 1].x, y2: p[i + 1].y });
    return;
  }
  const cx = p[3].x - p[0].x, cy = p[3].y - p[0].y;
  const len = Math.hypot(cx, cy) || 1;
  const nx = -cy / len, ny = cx / len;
  let prev = null;
  for (let k = 0; k < SAIL_FLAP_POINTS; k++) {
    const u = k / (SAIL_FLAP_POINTS - 1) * 3;
    const i = Math.min(2, Math.floor(u)), f = u - i;
    const bx = p[i].x + (p[i + 1].x - p[i].x) * f, by = p[i].y + (p[i + 1].y - p[i].y) * f;
    const sN = u / 3;
    const w = amp * Math.sin(Math.PI * sN) * Math.sin(phase - 3 * Math.PI * sN);
    const pt = { x: bx + nx * w, y: by + ny * w };
    if (prev) graphics.push({ color: 0x8866ff, type: "sail", x1: prev.x, y1: prev.y, x2: pt.x, y2: pt.y });
    prev = pt;
  }
}

// Body-local (0, ly) → world, as planck's Transform (q.c, q.s from the angle).
function wp(s, ly) {
  const c = Math.cos(s.pa), sn = Math.sin(s.pa);
  return { x: (c * 0 - sn * ly) + s.px, y: (sn * 0 + c * ly) + s.py };
}

// The wind-indicator grid points (Toggle Field), in drawing order. vel(x, y)
// gives the velocity; used host-side to sample and client-side to draw.
export function windGridPoints(bx, by, res, fn) {
  const n = WIND_INDICATOR_SIZE;
  for (let i = -n; i < n; i++) {
    for (let j = -n; j < n; j++) {
      if (Math.sqrt(i * i + j * j) < n - 1) {
        const x = Math.floor(bx * res) / res + i / res;
        const y = Math.floor(by * res) / res + j / res;
        fn(x, y);
      }
    }
  }
}

function chevron(graphics, s, angle, color, role) {
  const p = Math.PI / 2;
  graphics.push({ color, type: "guide", role,
    x1: s.x + Math.cos(angle) * 3, y1: s.y + Math.sin(angle) * 3,
    x2: s.x + Math.cos(angle) * 5 + Math.cos(angle + p) * 0.5, y2: s.y + Math.sin(angle) * 5 + Math.sin(angle + p) * 0.5 });
  graphics.push({ color, type: "guide", role,
    x1: s.x + Math.cos(angle) * 3, y1: s.y + Math.sin(angle) * 3,
    x2: s.x + Math.cos(angle) * 5 - Math.cos(angle + p) * 0.5, y2: s.y + Math.sin(angle) * 5 - Math.sin(angle + p) * 0.5 });
  graphics.push({ color, type: "guide", role,
    x1: s.x + Math.cos(angle) * 4.75, y1: s.y + Math.sin(angle) * 4.75,
    x2: s.x + Math.cos(angle) * 5 - Math.cos(angle + p) * 0.5, y2: s.y + Math.sin(angle) * 5 - Math.sin(angle + p) * 0.5 });
  graphics.push({ color, type: "guide", role,
    x1: s.x + Math.cos(angle) * 4.75, y1: s.y + Math.sin(angle) * 4.75,
    x2: s.x + Math.cos(angle) * 5 + Math.cos(angle + p) * 0.5, y2: s.y + Math.sin(angle) * 5 + Math.sin(angle + p) * 0.5 });
}

function sail(s, lead, length, boomAngle, fat) {
  const p = [];
  p[0] = wp(s, lead);
  const ang = boomAngle / 180 * Math.PI;
  const sg = Math.sign(boomAngle);
  for (const [k, frac] of [[1, 0.25], [2, 0.5]]) {
    p[k] = {
      x: p[0].x + Math.cos(s.ha + Math.PI / 2 + ang) * length * frac + Math.cos(s.ha + ang) * -fat * sg,
      y: p[0].y + Math.sin(s.ha + Math.PI / 2 + ang) * length * frac + Math.sin(s.ha + ang) * -fat * sg,
    };
  }
  p[3] = { x: p[0].x + Math.cos(s.ha + Math.PI / 2 + ang) * length, y: p[0].y + Math.sin(s.ha + Math.PI / 2 + ang) * length };
  return p;
}

export function boatGuides(s, d) {
  const graphics = [];
  const f = s.f || [];
  for (let k = 0; k + 3 < f.length; k += 4) {
    graphics.push({ color: 0x00ff00, type: "force", x1: f[k], y1: f[k + 1], x2: f[k] + f[k + 2] / 10, y2: f[k + 1] + f[k + 3] / 10 });
  }
  // autopilot guide
  const a = {};
  const aLength = s.ap ? 10 : 2;
  const o = wp(s, 0);
  a.x1 = o.x;
  a.y1 = o.y;
  a.x2 = a.x1 + Math.cos((s.wd + s.aht) / 180 * Math.PI) * aLength;
  a.y2 = a.y1 + Math.sin((s.wd + s.aht) / 180 * Math.PI) * aLength;
  a.color = 0x556677;
  a.type = "autopilot";
  graphics.push(a);
  // True wind chevron: upwind of the boat, tip pointing downwind.
  chevron(graphics, s, s.tw + Math.PI, 0x554477, "tw");
  // Apparent wind: awa + hull − 90° is where it comes from.
  chevron(graphics, s, s.awa / 180 * Math.PI + s.ha - Math.PI / 2, 0x550077, "aw");
  // Rudder
  const r = wp(s, d.rp);
  graphics.push({ color: 0x550000, type: "hydro",
    x1: r.x, y1: r.y,
    x2: r.x + Math.cos(s.pa + Math.PI / 2 + s.ra / 180 * Math.PI) * d.rl,
    y2: r.y + Math.sin(s.pa + Math.PI / 2 + s.ra / 180 * Math.PI) * d.rl });
  // Centreboard
  const c0 = wp(s, d.cp + d.cl / 2), c1 = wp(s, d.cp - d.cl / 2);
  graphics.push({ color: 0x550000, type: "hydro", x1: c0.x, y1: c0.y, x2: c1.x, y2: c1.y });
  // Mainsail and jib
  const mainFat = (d.mbl * 0.05 * Math.abs(s.awa) / 30 < d.mbl / 10) ? d.mbl * 0.05 * Math.abs(s.awa) / 30 : d.mbl / 10;
  pushSailSegments(graphics, sail(s, d.mle, d.mbl, s.mba, mainFat), SAIL_FLAP_AMP_M * s.mf, s.ph);
  const jibFat = (d.jbl * 0.05 * Math.abs(s.awa) / 15 < d.jbl / 3) ? d.jbl * 0.05 * Math.abs(s.awa) / 15 : d.jbl / 3;
  pushSailSegments(graphics, sail(s, d.jle, d.jbl, s.jba, jibFat), SAIL_FLAP_JIB_AMP_M * s.jf, s.ph + 1.3);
  // Wind indicator grid (Toggle Field)
  if (s.wg) {
    const v = s.wg.v;
    let k = 0;
    windGridPoints(s.x, s.y, s.wg.res, (x, y) => {
      graphics.push({ color: 0x8866ff, type: "sail", x1: x, y1: y, x2: x + v[k] * 30, y2: y + v[k + 1] * 30 });
      k += 2;
    });
  }
  return graphics;
}
