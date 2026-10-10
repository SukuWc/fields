// Touching a mark (RRS 31). A boat that touches a mark while racing breaks
// rule 31 and takes a penalty. RRS 44.1 makes it a One-Turn Penalty: one
// tack and one gybe, which is exactly what the existing pending-penalty
// clearing in rules.js requires (consecutive tack + gybe within the window,
// or the Q/E autopilot circle). So a touch simply pushes one pending penalty
// with chargePendingPenalty; the FAULT badge shows the reason.
//
// This is a boat-versus-mark check, separate from the boat-pair rules engine:
// marks never enter evaluateAllPairs and no boat-boat incident is created.
//
// Touch. A boat touches a mark when planck reports a touching contact
// between her body and the mark's body, or the hull polygon is within
// MARK_TOUCH_M of the buoy circle. Latching follows the boat-boat contact
// style: one touch per contact; the latch only re-arms once the hull is
// more than MARK_TOUCH_REARM_M clear of that buoy, so a sustained touch (or
// bumping along it) is one penalty and a separate later touch is another.
//
// Racing (RRS definitions): from the preparatory signal. With a start
// sequence, touches before it are free; main.js passes racing = !seq ||
// seq.racing. Scenarios without one (11–13) are always racing.
//
// Names. nameMarks(course, startSequence) gives every mark a name for the
// reason text: course marks "mark n", gate marks "gate n", start-line ends
// "RC" and "pin"; anything else is "mark".

import { chargePendingPenalty, hullVerticesWorld } from './rules.js';
import { isGate } from './course.js';

export const MARK_TOUCH_M = 0.02;
export const MARK_TOUCH_REARM_M = 0.25;
export const MARK_TOUCH_FLASH_MS = 1000;
export const MARK_TOUCH_COLOR = 0xff3b30;

const latch = new Map(); // boat -> Map(mark -> true)
const touches = [];
const flashes = []; // { mark, startedAtMs }

export function resetMarkTouches() {
  latch.clear();
  touches.length = 0;
  flashes.length = 0;
}

// Every rule 31 touch recorded so far: { time, rule: '31', boat, mark,
// markName, reason, x, y }.
export function getMarkTouches() {
  return touches;
}

export function nameMarks(course, seq) {
  if (course) {
    course.marks.forEach((el, i) => {
      if (isGate(el)) for (const m of el.gate) m.markName = 'gate ' + (i + 1);
      else el.markName = 'mark ' + (i + 1);
    });
  }
  if (seq && seq.line) {
    seq.line.committee.markName = 'RC';
    seq.line.pin.markName = 'pin';
  }
}

function markCentre(mark) {
  const body = mark.physics_model;
  if (body) {
    const p = body.getPosition();
    return { x: p.x, y: p.y };
  }
  return { x: mark.x, y: mark.y };
}

function segDist(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

// Gap between the hull polygon and the buoy circle (negative = overlap).
export function hullMarkClearance(boat, mark) {
  const hull = Array.isArray(boat.hull) ? boat.hull : hullVerticesWorld(boat);
  const c = markCentre(mark);
  const r = mark.radius || 0.5;
  if (!hull.length) return Math.hypot(boat.x - c.x, boat.y - c.y) - r;
  let d = Infinity;
  for (let i = 0; i < hull.length; i++) d = Math.min(d, segDist(c, hull[i], hull[(i + 1) % hull.length]));
  return (hull.length > 2 && inside(c, hull) ? -d : d) - r;
}

function planckTouching(boat, mark) {
  const a = boat.physics_model;
  const b = mark.physics_model;
  if (!a || !b || typeof a.getContactList !== 'function') return false;
  for (let e = a.getContactList(); e; e = e.next) {
    if (e.other === b && e.contact && e.contact.isTouching()) return true;
  }
  return false;
}

// Check every boat against every mark. opts: { simTime, racing (default
// true), nowMs }. Returns the touches charged on this call.
export function recordMarkTouches(boats, marks, opts = {}) {
  const racing = opts.racing !== false;
  const now = typeof opts.nowMs === 'number' ? opts.nowMs : performance.now();
  const charged = [];
  for (const boat of boats || []) {
    if (!boat) continue;
    let m = latch.get(boat);
    if (!m) { m = new Map(); latch.set(boat, m); }
    for (const mark of marks || []) {
      const gap = hullMarkClearance(boat, mark);
      const touching = gap <= MARK_TOUCH_M || planckTouching(boat, mark);
      const latched = m.get(mark) === true;
      if (touching && !latched) {
        m.set(mark, true);
        flashes.push({ mark, startedAtMs: now });
        if (racing) {
          const c = markCentre(mark);
          const name = mark.markName || 'mark';
          const t = {
            time: opts.simTime || 0,
            rule: '31',
            finalRule: '31',
            kind: 'mark',
            boat,
            faultBoat: boat,
            mark,
            markName: name,
            reason: 'Rule 31: touched ' + name,
            label: 'Rule 31 · touched ' + name,
            x: c.x,
            y: c.y,
          };
          touches.push(t);
          chargePendingPenalty(boat, t);
          charged.push(t);
        }
      } else if (!touching && gap > MARK_TOUCH_REARM_M) {
        m.set(mark, false);
      }
    }
  }
  return charged;
}

// Red ring round each touched buoy for MARK_TOUCH_FLASH_MS.
export function markTouchGuides(nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : performance.now();
  const g = [];
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    const age = now - f.startedAtMs;
    if (age > MARK_TOUCH_FLASH_MS || age < 0) { flashes.splice(i, 1); continue; }
    const c = markCentre(f.mark);
    const r = (f.mark.radius || 0.5) + 0.25;
    const opacity = 1 - 0.6 * (age / MARK_TOUCH_FLASH_MS);
    for (let k = 0; k < 24; k++) {
      const a0 = k / 24 * 2 * Math.PI;
      const a1 = (k + 1) / 24 * 2 * Math.PI;
      g.push({ type: 'guide', color: MARK_TOUCH_COLOR, opacity, x1: c.x + r * Math.cos(a0), y1: c.y + r * Math.sin(a0), x2: c.x + r * Math.cos(a1), y2: c.y + r * Math.sin(a1) });
    }
  }
  return g;
}
