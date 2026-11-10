// Boat drawing from compact state (no planck, no Sim): the guide segments of
// one boat (forces, CE offset marker, autopilot line, true/apparent wind chevrons, rudder,
// centreboard and sails; the wind field is drawn by flow-tracers.js). The
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
//   (flap phase), jib_backwinded (1 while the jib is held on the old tack),
//   f (forces: [px, py, vx, vy, ...]),
//   ce (force-weighted rig centre), mce/jce (per-sail centres),
//   ml/md (mainsail lift and drag), jl/jd (jib lift and drag).
// def d: rp, rl (rudder position, length), cp, cl (centreboard), mle, mbl
//   (main leading edge, boom length), jle, jbl (jib).
export const SAIL_FLAP_AMP_M = 0.12;
export const SAIL_FLAP_JIB_AMP_M = 0.08;
const SAIL_FLAP_POINTS = 9;
export const SAIL_COLOR = 0x8866ff;

// Sail polyline p[0..3] → segments. amp 0 draws the original three segments.
export function pushSailSegments(graphics, p, amp, phase, color = SAIL_COLOR) {
  if (!(amp > 1e-4)) {
    for (let i = 0; i < 3; i++) graphics.push({ color, type: "sail", x1: p[i].x, y1: p[i].y, x2: p[i + 1].x, y2: p[i + 1].y });
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
    if (prev) graphics.push({ color, type: "sail", x1: prev.x, y1: prev.y, x2: pt.x, y2: pt.y });
    prev = pt;
  }
}

// Body-local (0, ly) → world, as planck's Transform (q.c, q.s from the angle).
function wp(s, ly) {
  const c = Math.cos(s.pa), sn = Math.sin(s.pa);
  return { x: (c * 0 - sn * ly) + s.px, y: (sn * 0 + c * ly) + s.py };
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

// Jib camber depth (m) for a chord at boomDeg to apparent wind awaDeg.
// 0.05·length per 7.5° of angle between them, capped at a third of the
// boom. Falls back to the half-trim angle when awa is missing.
export function jibDepth(length, awaDeg, boomDeg) {
  const rel = Number.isFinite(awaDeg) && Number.isFinite(boomDeg) ? Math.abs(awaDeg - boomDeg)
    : Math.abs(Number.isFinite(awaDeg) ? awaDeg : 0) / 2;
  const depth = length * 0.05 * rel / 7.5;
  return depth < length / 3 ? depth : length / 3;
}

function sail(s, lead, length, boomAngle, fat) {
  const p = [];
  p[0] = wp(s, lead);
  const ang = boomAngle / 180 * Math.PI;
  // Belly away from the wind, off the chord. sign(awa − boom) is the
  // leeward side of that chord: the same as sign(boom) while the boom is
  // sheeted to the wind (|boom| ≤ |awa|, same sign), and the other way
  // when the wind is on the back of the sail. A missing awa keeps the old
  // boom-sign belly so a partial state does not flip every sail.
  const rel = Number.isFinite(s.awa) ? s.awa - boomAngle : boomAngle;
  const sg = Math.sign(rel);
  for (const [k, frac] of [[1, 0.25], [2, 0.5]]) {
    p[k] = {
      x: p[0].x + Math.cos(s.ha + Math.PI / 2 + ang) * length * frac + Math.cos(s.ha + ang) * -fat * sg,
      y: p[0].y + Math.sin(s.ha + Math.PI / 2 + ang) * length * frac + Math.sin(s.ha + ang) * -fat * sg,
    };
  }
  p[3] = { x: p[0].x + Math.cos(s.ha + Math.PI / 2 + ang) * length, y: p[0].y + Math.sin(s.ha + Math.PI / 2 + ang) * length };
  return p;
}

// Best-VMG true-wind angles for the autopilot snap. The sim has no runtime
// polar: nothing searches boat speed × cos(TWA) for an optimum. 50° is the
// measured upwind VMG angle in dev mode (leaderboard.js BEAT_ANGLE_DEG).
// 160° is the downwind angle this autopilot has always snapped to. 90° is
// a beam reach.
export const BEST_VMG_UPWIND_DEG = 50;
export const BEST_VMG_DOWNWIND_DEG = 160;
export const AUTOPILOT_BEAM_DEG = 90;

// Space snap. t is the signed autopilot angle (−TWA; + = starboard tack).
// The lock is the nearest of {upwind best-VMG, beam, downwind best-VMG} on
// the same tack. A tie (exactly halfway) goes to the larger absolute angle,
// the downwind side of the pair. Defaults are the constants above; a boat
// can pass its own best-VMG angles. t = 0 (and any non-negative) is starboard.
export function autopilotSnapTarget(t, bv1 = BEST_VMG_UPWIND_DEG, bv2 = BEST_VMG_DOWNWIND_DEG) {
  if (!Number.isFinite(t)) return t;
  const sg = t < 0 ? -1 : 1;
  const a = Math.abs(t);
  const cands = [Math.abs(bv1), AUTOPILOT_BEAM_DEG, Math.abs(bv2)];
  let best = cands[0], bestD = Math.abs(a - best);
  for (let i = 1; i < cands.length; i++) {
    const c = cands[i], d = Math.abs(a - c);
    if (d < bestD || (d === bestD && c > best)) { best = c; bestD = d; }
  }
  return sg * best;
}
function wrap180(x) { x = ((x + 180) % 360 + 360) % 360 - 180; return x; }

// Heading the Q/E circle locks when it finishes, as a signed target (−TWA).
// The starting hull angle (radians, bow on local −Y) against the current
// wind-from direction. Same expression Boat._finishPenaltyTurn used to inline.
export function penaltyTurnExitTarget(windFromDeg, startHeadingRad) {
  let target = -(windFromDeg - startHeadingRad * 180 / Math.PI + 90);
  target = ((target + 180) % 360 + 360) % 360 - 180;
  return target;
}

// Dashed guide: the snap Space will lock, on or off. It is the nearest of
// the three candidates to the current autopilot angle (aht), not the angle
// itself, so the dashes are not a second copy of the solid line. They share
// a direction only when aht is already that snap — which is also what Space
// locks, so the two stay one value. twa is only a fallback when aht is missing.
//
// Q/E: while the circle runs the autopilot is off and aht tracks −TWA, so
// the dashes follow the nearest snap of the live heading. They do not draw
// the heading the circle will finish on. When it finishes, the solid line
// is that exit heading and the dashes are the nearest snap of it (the next
// Space press).
export function autopilotGuideTarget(s) {
  const bv1 = s.bv1 ?? BEST_VMG_UPWIND_DEG, bv2 = s.bv2 ?? BEST_VMG_DOWNWIND_DEG;
  const cur = Number.isFinite(s.aht) ? s.aht : (Number.isFinite(s.twa) ? wrap180(-s.twa) : NaN);
  return autopilotSnapTarget(cur, bv1, bv2);
}
export const AUTOPILOT_PREVIEW_LENGTH = 14;

// Per-sail force overlay. Distinct from the green generic arrows, the
// magenta rig CE, the cyan CLR and the blue hull-drag cross.
export const MAIN_LIFT_COLOR = 0xffe14a;
export const MAIN_DRAG_COLOR = 0xff5a1f;
export const JIB_LIFT_COLOR = 0x3dfff2;
export const JIB_DRAG_COLOR = 0xc56bff;
export const MAIN_CE_COLOR = 0xfff1a8;
export const JIB_CE_COLOR = 0xe0b0ff;

function forceCross(graphics, x, y, m, color) {
  graphics.push({ color, type: "force", x1: x - m, y1: y, x2: x + m, y2: y });
  graphics.push({ color, type: "force", x1: x, y1: y - m, x2: x, y2: y + m });
}

function forceArrow(graphics, x, y, vec, color, scale) {
  if (!Array.isArray(vec) || vec.length < 2 || !Number.isFinite(vec[0]) || !Number.isFinite(vec[1])) return;
  graphics.push({ color, type: "force", x1: x, y1: y, x2: x + vec[0] / scale, y2: y + vec[1] / scale });
}

// Lift and drag from one sail's centre, plus a small CE cross.
function sailForceOverlay(graphics, ce, lift, drag, liftColor, dragColor, ceColor) {
  if (!Array.isArray(ce) || ce.length < 2 || !Number.isFinite(ce[0]) || !Number.isFinite(ce[1])) return;
  forceCross(graphics, ce[0], ce[1], 0.22, ceColor);
  forceArrow(graphics, ce[0], ce[1], lift, liftColor, 10);
  forceArrow(graphics, ce[0], ce[1], drag, dragColor, 10);
}

export function boatGuides(s, d) {
  const graphics = [];
  const f = s.f || [];
  for (let k = 0; k + 3 < f.length; k += 4) {
    graphics.push({ color: 0x00ff00, type: "force", x1: f[k], y1: f[k + 1], x2: f[k] + f[k + 2] / 10, y2: f[k + 1] + f[k + 3] / 10 });
  }
  // Sail CE (magenta) and CLR (cyan): markers at the force application
  // points plus distinct arrows. Type "force" so show_forces gates them.
  // Mainsail lift (yellow), mainsail drag (orange-red), jib lift (mint),
  // jib drag (purple), each from its own CE cross.
  sailForceOverlay(graphics, s.mce, s.ml, s.md, MAIN_LIFT_COLOR, MAIN_DRAG_COLOR, MAIN_CE_COLOR);
  sailForceOverlay(graphics, s.jce, s.jl, s.jd, JIB_LIFT_COLOR, JIB_DRAG_COLOR, JIB_CE_COLOR);
  // Rig CE (magenta). The combined sail arrow is only the fallback for a
  // frame that has no per-sail forces; otherwise it would sit on top of
  // the four component arrows.
  if (Array.isArray(s.ce) && s.ce.length >= 2 && Number.isFinite(s.ce[0]) && Number.isFinite(s.ce[1])) {
    const cx = s.ce[0], cy = s.ce[1], m = 0.35;
    graphics.push({ color: 0xff66cc, type: "force", x1: cx - m, y1: cy, x2: cx + m, y2: cy });
    graphics.push({ color: 0xff66cc, type: "force", x1: cx, y1: cy - m, x2: cx, y2: cy + m });
    const split = Array.isArray(s.mce) || Array.isArray(s.jce);
    if (!split && Array.isArray(s.sf) && s.sf.length >= 2 && Number.isFinite(s.sf[0]) && Number.isFinite(s.sf[1])) {
      graphics.push({ color: 0xffaa00, type: "force",
        x1: cx, y1: cy, x2: cx + s.sf[0] / 8, y2: cy + s.sf[1] / 8 });
    }
  }
  if (Array.isArray(s.clr) && s.clr.length >= 2 && Number.isFinite(s.clr[0]) && Number.isFinite(s.clr[1])) {
    const cx = s.clr[0], cy = s.clr[1], m = 0.3;
    graphics.push({ color: 0x33ccff, type: "force", x1: cx - m, y1: cy, x2: cx + m, y2: cy });
    graphics.push({ color: 0x33ccff, type: "force", x1: cx, y1: cy - m, x2: cx, y2: cy + m });
    if (Array.isArray(s.clrf) && s.clrf.length >= 2 && Number.isFinite(s.clrf[0]) && Number.isFinite(s.clrf[1])) {
      graphics.push({ color: 0x66ffff, type: "force",
        x1: cx, y1: cy, x2: cx + s.clrf[0] / 8, y2: cy + s.clrf[1] / 8 });
    }
    const arrow = (vec, color, scale) => {
      if (!Array.isArray(vec) || vec.length < 2 || !Number.isFinite(vec[0]) || !Number.isFinite(vec[1])) return;
      graphics.push({ color, type: "force", x1: cx, y1: cy, x2: cx + vec[0] / scale, y2: cy + vec[1] / scale });
    };
    arrow(s.cbl, 0x88ffcc, 8);
    arrow(s.cbd, 0x228866, 8);
  }
  // Hull drag centre (blue): leeward of the centreline when heeled.
  // Blue, not yellow: the speed plot is yellow, and a gold cross disappears on it.
  if (Array.isArray(s.hd) && s.hd.length >= 2 && Number.isFinite(s.hd[0]) && Number.isFinite(s.hd[1])) {
    const hx = s.hd[0], hy = s.hd[1], m = 0.32;
    graphics.push({ color: 0x2255ff, type: "force", x1: hx - m, y1: hy, x2: hx + m, y2: hy });
    graphics.push({ color: 0x2255ff, type: "force", x1: hx, y1: hy - m, x2: hx, y2: hy + m });
  }
  // Rudder lift (orange) and drag (red), separate from the green force arrows.
  if (Array.isArray(s.rd) && s.rd.length >= 2 && Number.isFinite(s.rd[0]) && Number.isFinite(s.rd[1])) {
    const rx = s.rd[0], ry = s.rd[1];
    const rarrow = (vec, color) => {
      if (!Array.isArray(vec) || vec.length < 2 || !Number.isFinite(vec[0]) || !Number.isFinite(vec[1])) return;
      graphics.push({ color, type: "force", x1: rx, y1: ry, x2: rx + vec[0] / 6, y2: ry + vec[1] / 6 });
    };
    rarrow(s.rdl, 0xff8844);
    rarrow(s.rdd, 0xff4422);
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
  // Dashed guide, longer than the solid target line: the snap nearest the
  // current autopilot angle (upwind best-VMG, beam, or downwind best-VMG on
  // this tack). Space locks that same angle. The solid line is the current
  // angle, so the two differ unless she is already on the snap. World angle
  // wd + target is the bow heading for that −TWA (bow = wd − TWA).
  // During a Q/E circle this is still the nearest snap of the live angle,
  // not the heading the circle finishes on.
  const cur = autopilotGuideTarget(s);
  if (Number.isFinite(cur) && Number.isFinite(s.wd)) {
    const ang = (s.wd + cur) / 180 * Math.PI;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    for (let k = 0; k < AUTOPILOT_PREVIEW_LENGTH; k += 1.2) {
      const e = Math.min(AUTOPILOT_PREVIEW_LENGTH, k + 0.7);
      graphics.push({ color: 0x556677, type: "guide", role: "ap-preview", opacity: 0.7,
        x1: o.x + ux * k, y1: o.y + uy * k, x2: o.x + ux * e, y2: o.y + uy * e });
    }
  }
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
  // Mainsail and jib. Camber and luff come from the boom against the
  // apparent wind for both, including a jib held aback: the belly is on
  // whichever side of the chord the wind is not, and a powered sail
  // (angle of attack past the luff angle) does not flap.
  const mainFat = (d.mbl * 0.05 * Math.abs(s.awa) / 30 < d.mbl / 10) ? d.mbl * 0.05 * Math.abs(s.awa) / 30 : d.mbl / 10;
  pushSailSegments(graphics, sail(s, d.mle, d.mbl, s.mba, mainFat), SAIL_FLAP_AMP_M * s.mf, s.ph);
  // Jib depth from the drawn boom against the apparent wind, |awa − jba|.
  // With the normal trim (boom = ½·awa) that is ½·|awa|, so the 7.5°
  // divisor gives the same depth as the old |awa|/15 for every sheeted
  // jib; a jib held aback or eased toward the wind gets the depth of its
  // own angle to the wind instead of a stand-in.
  const jibFat = jibDepth(d.jbl, s.awa, s.jba);
  pushSailSegments(graphics, sail(s, d.jle, d.jbl, s.jba, jibFat), SAIL_FLAP_JIB_AMP_M * s.jf, s.ph + 1.3);
  return graphics;
}
