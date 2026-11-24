// Draggable autopilot heading handle: a round HTML button (#autopilot_handle)
// over the race canvas, styled like the overlay steering buttons. Shown while
// the autopilot is engaged, Camera Follow is on, this client has a boat it
// can steer and the Preferences "Autopilot drag circle" box is on. At rest it
// sits a fixed number of CSS pixels (--ap-handle-dist) from the boat's
// on-screen position along the autopilot target heading, whatever the zoom.
//
// Drag: the circle follows the pointer freely and the target heading follows
// the boat → pointer direction (headingSet). While dragging, a best-VMG drop
// zone (#autopilot_vmg_zone) shows 1.5 × the resting distance out along the
// dashed preview line (autopilotGuideTarget, the angle Space locks).
// Releasing on the zone locks that best-VMG angle; releasing anywhere else
// sets the heading from the release direction, and the circle springs back
// to its resting distance. While the pointer is over the zone the heading is
// held (no headingSet), so the target and the zone do not jitter.
// The button is not part of the canvas, so its drags never reach
// drag-to-look, pinch zoom or the double-tap Camera Follow toggle.

import * as THREE from 'three';
import { autopilotGuideTarget, autopilotHeadingFromWorld } from './boat-draw.js';

// Fallbacks when the CSS custom properties are missing (tests, old pages).
export const AP_HANDLE_DIST_PX = 120;
// Drop zone distance = this × the resting distance.
export const AP_ZONE_DIST_FACTOR = 1.5;
// Extra hit slack around the drop zone's drawn radius (CSS px).
export const AP_ZONE_SLACK_PX = { mouse: 12, touch: 20 };
// Distance along the target ray used only to find the on-screen direction.
const AHEAD_M = 10;

const _ndc = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _p = new THREE.Vector3();

// Canvas client coords → world metres on z = 0 (same ray as controls.js).
export function clientToWorld(camera, canvas, clientX, clientY) {
  if (!camera || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || 0, h = rect.height || 0;
  if (!(w > 0) || !(h > 0)) return null;
  if (typeof camera.updateMatrixWorld === 'function') camera.updateMatrixWorld();
  _ndc.set(
    ((clientX - rect.left) / w) * 2 - 1,
    -((clientY - rect.top) / h) * 2 + 1,
    0.5,
  );
  _ndc.unproject(camera);
  _dir.copy(_ndc).sub(camera.position).normalize();
  if (Math.abs(_dir.z) < 1e-9) return null;
  const t = -camera.position.z / _dir.z;
  _hit.copy(camera.position).addScaledVector(_dir, t);
  if (!Number.isFinite(_hit.x) || !Number.isFinite(_hit.y)) return null;
  return { x: _hit.x, y: _hit.y };
}

// World point on z = 0 → canvas client coords (CSS px), or null.
export function worldToClient(camera, canvas, wx, wy) {
  if (!camera || !canvas || !Number.isFinite(wx) || !Number.isFinite(wy)) return null;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || 0, h = rect.height || 0;
  if (!(w > 0) || !(h > 0)) return null;
  if (typeof camera.updateMatrixWorld === 'function') camera.updateMatrixWorld();
  _p.set(wx, wy, 0).project(camera);
  if (!Number.isFinite(_p.x) || !Number.isFinite(_p.y)) return null;
  return { x: rect.left + (_p.x + 1) / 2 * w, y: rect.top + (1 - _p.y) / 2 * h };
}

// Boat origin and a point `dist` metres ahead on the autopilot target ray
// (world), or null. Same origin as autopilotHeadingFromWorld.
export function autopilotRay(s, dist = AHEAD_M, aht = s && s.aht) {
  if (!s || !Number.isFinite(s.wd) || !Number.isFinite(aht) || !Number.isFinite(s.px) || !Number.isFinite(s.py)) return null;
  const ang = (s.wd + aht) / 180 * Math.PI;
  return {
    origin: { x: s.px, y: s.py },
    ahead: { x: s.px + Math.cos(ang) * dist, y: s.py + Math.sin(ang) * dist },
  };
}

// Screen position `distPx` from `from` towards `toward` (both client px).
export function pointAtPixels(from, toward, distPx) {
  if (!from || !toward || !Number.isFinite(distPx)) return null;
  const dx = toward.x - from.x, dy = toward.y - from.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) return null;
  return { x: from.x + dx / len * distPx, y: from.y + dy / len * distPx };
}

// Client position of the button centre for boat state `s`, or null.
// aht: heading to place along (default the current target).
export function autopilotButtonClientPos(camera, canvas, s, distPx = AP_HANDLE_DIST_PX, aht = s && s.aht) {
  const ray = autopilotRay(s, AHEAD_M, aht);
  if (!ray) return null;
  const o = worldToClient(camera, canvas, ray.origin.x, ray.origin.y);
  const a = worldToClient(camera, canvas, ray.ahead.x, ray.ahead.y);
  if (!o || !a) return null;
  const p = pointAtPixels(o, a, distPx);
  return p ? { x: p.x, y: p.y, boatX: o.x, boatY: o.y } : null;
}

// Best-VMG drop zone: the dashed preview's angle (what Space locks), placed
// AP_ZONE_DIST_FACTOR × the resting distance from the boat. { x, y, aht }.
export function autopilotZoneClientPos(camera, canvas, s, distPx = AP_HANDLE_DIST_PX) {
  if (!s) return null;
  const aht = autopilotGuideTarget(s);
  if (!Number.isFinite(aht)) return null;
  const p = autopilotButtonClientPos(camera, canvas, s, distPx * AP_ZONE_DIST_FACTOR, aht);
  return p ? { x: p.x, y: p.y, aht } : null;
}

// Pointer (client px) over the zone centre within radius + slack.
export function zoneHit(zone, x, y, radiusPx, pointerType = 'mouse') {
  if (!zone || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const slack = pointerType === 'mouse' ? AP_ZONE_SLACK_PX.mouse : AP_ZONE_SLACK_PX.touch;
  return Math.hypot(x - zone.x, y - zone.y) <= radiusPx + slack;
}

// Shown only while the autopilot is engaged, Camera Follow is on and there
// is a boat this client steers (getBoat() returns null for spectators).
export function autopilotButtonVisible(view, boat, enabled = true) {
  return !!(enabled && view && view.camera_follow && boat && boat.ap);
}

let _dragging = false;
let _grabs = 0;

export function isAutopilotHandleDragging() {
  return _dragging;
}
// Bumped on every grab: drag-look drops a pending first tap when it changes,
// so a tap on the water then a grab on the button is not a double-tap.
export function autopilotHandleGrabCount() {
  return _grabs;
}

function cssPx(el, name, fallback) {
  try {
    const v = parseFloat(getComputedStyle(el).getPropertyValue(name));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

function createButton(doc) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.id = 'autopilot_handle';
  b.className = 'sz-btn ap-handle';
  b.innerHTML = '<small>AP</small>';
  b.tabIndex = -1; // never steals Space / Enter from the race keys
  b.title = 'Drag to set the autopilot heading';
  b.setAttribute('aria-label', 'Autopilot heading: drag to steer');
  b.hidden = true;
  doc.body.appendChild(b);
  return b;
}
function createZone(doc) {
  const z = doc.createElement('div');
  z.id = 'autopilot_vmg_zone';
  z.className = 'ap-vmg-zone';
  z.setAttribute('aria-hidden', 'true');
  z.innerHTML = '<small>VMG</small>';
  z.hidden = true;
  doc.body.appendChild(z);
  return z;
}

// getBoat(): latest render-state for the steered boat, or null.
// command(c): host.command — sends { type: 'headingSet', boat?, aht }.
// boatIndex(): local boat index for the command (0 when remote maps it).
// enabled(): the Preferences "Autopilot drag circle" box (default on).
// Call update() once per drawn frame, after the camera has moved.
export function setupAutopilotHandle(view, {
  doc = typeof document !== 'undefined' ? document : null,
  canvas = doc ? doc.getElementById('sim_canvas') : null,
  button = null,
  zone = null,
  getCamera,
  getBoat,
  command,
  boatIndex = () => 0,
  enabled = () => true,
} = {}) {
  if (!canvas || !view || typeof getCamera !== 'function' || typeof getBoat !== 'function' || typeof command !== 'function') {
    return null;
  }
  const el = button || (doc && doc.getElementById('autopilot_handle')) || (doc ? createButton(doc) : null);
  if (!el) return null;
  const zoneEl = zone || (doc && doc.getElementById('autopilot_vmg_zone')) || (doc ? createZone(doc) : null);

  let drag = null; // { id, type, x, y, zone: {x,y,aht}|null, inZone }
  let lastAht = null;
  let distPx = null;
  let zoneR = null;
  let shown = { x: NaN, y: NaN };
  let zoneShown = { x: NaN, y: NaN };

  const dist = () => {
    if (distPx == null) distPx = cssPx(el, '--ap-handle-dist', AP_HANDLE_DIST_PX);
    return distPx;
  };
  // Drawn radius of the drop zone (half its CSS size).
  const zoneRadius = () => {
    if (zoneR == null) zoneR = zoneEl ? cssPx(zoneEl, '--ap-zone-size', 56) / 2 : 28;
    return zoneR;
  };
  const onResize = () => { distPx = null; zoneR = null; };
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', onResize);

  const isOn = () => { try { return enabled() !== false; } catch (_) { return true; } };

  function sendCmd(c) {
    const idx = boatIndex();
    if (Number.isInteger(idx) && idx >= 0) c.boat = idx;
    command(c);
  }
  function sendHeading(aht, force = false) {
    if (!Number.isFinite(aht)) return;
    if (!force && lastAht != null && Math.abs(aht - lastAht) < 0.25) return;
    lastAht = aht;
    sendCmd({ type: 'headingSet', aht });
  }

  function headingAt(x, y) {
    const boat = getBoat();
    if (!boat) return NaN;
    const w = clientToWorld(getCamera(), canvas, x, y);
    return w ? autopilotHeadingFromWorld(boat, w.x, w.y) : NaN;
  }

  function place(node, p, last) {
    if (!(Math.abs(p.x - last.x) <= 0.25 && Math.abs(p.y - last.y) <= 0.25)) {
      last.x = p.x; last.y = p.y;
      node.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
    }
  }
  function hideZone() {
    if (zoneEl && !zoneEl.hidden) zoneEl.hidden = true;
    if (zoneEl && zoneEl.classList) zoneEl.classList.remove('hot');
    zoneShown = { x: NaN, y: NaN };
  }
  function hide() {
    if (!el.hidden) el.hidden = true;
    shown = { x: NaN, y: NaN };
    hideZone();
  }

  function inRect(p) {
    const r = canvas.getBoundingClientRect();
    return p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height;
  }

  // Zone follows the dashed preview, except while the pointer is on it
  // (held still under the finger).
  function refreshZone() {
    if (!drag) return;
    if (!drag.inZone || !drag.zone) {
      const z = autopilotZoneClientPos(getCamera(), canvas, getBoat(), dist());
      drag.zone = z && inRect(z) ? z : null;
    }
    if (!zoneEl) return;
    if (!drag.zone) { hideZone(); return; }
    if (zoneEl.hidden) zoneEl.hidden = false;
    place(zoneEl, drag.zone, zoneShown);
    if (zoneEl.classList) zoneEl.classList.toggle('hot', !!drag.inZone);
  }

  function update() {
    const boat = getBoat();
    if (drag && (!boat || !isOn())) endDrag(null);
    if (!drag && !autopilotButtonVisible(view, boat, isOn())) { hide(); return; }
    if (drag) {
      if (el.hidden) el.hidden = false;
      place(el, drag, shown);
      refreshZone();
      return;
    }
    hideZone();
    const p = autopilotButtonClientPos(getCamera(), canvas, boat, dist());
    // Off the race view (boat at the map edge): hide rather than float over
    // the top bar or the touch panel.
    if (!p || !inRect(p)) { hide(); return; }
    if (el.hidden) el.hidden = false;
    place(el, p, shown);
    if (el.dataset) el.dataset.boatPx = `${p.boatX.toFixed(1)},${p.boatY.toFixed(1)}`;
  }

  // e null = cancel (no heading change). Otherwise: drop on the zone locks
  // best VMG; elsewhere sets the heading from the release direction.
  function endDrag(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    _dragging = false;
    try { el.releasePointerCapture(d.id); } catch (_) {}
    if (el.classList) { el.classList.remove('dragging'); el.classList.remove('pressed'); }
    if (e) {
      const x = e.clientX, y = e.clientY;
      if (d.zone && zoneHit(d.zone, x, y, zoneRadius(), d.type)) {
        // The angle the dashed line shows = what Space locks (best VMG).
        lastAht = d.zone.aht;
        sendCmd({ type: 'headingSet', aht: d.zone.aht });
      } else {
        sendHeading(headingAt(x, y), true);
      }
    }
    lastAht = null;
    shown = { x: NaN, y: NaN };
    hideZone();
    update(); // spring back to the resting distance
  }

  function onDown(e) {
    if (drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!getBoat() || !isOn()) return;
    drag = { id: e.pointerId, type: e.pointerType || 'mouse', x: e.clientX, y: e.clientY, zone: null, inZone: false };
    _dragging = true;
    _grabs++;
    lastAht = null;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    if (el.classList) { el.classList.add('dragging'); el.classList.add('pressed'); }
    refreshZone();
    if (e.cancelable) e.preventDefault(); // no focus, no text selection
    e.stopPropagation();
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.x = e.clientX; drag.y = e.clientY;
    drag.inZone = zoneHit(drag.zone, drag.x, drag.y, zoneRadius(), drag.type);
    // Over the zone the heading holds: no jitter, and the zone stays put.
    if (!drag.inZone) sendHeading(headingAt(drag.x, drag.y));
    place(el, drag, shown);
    refreshZone();
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    endDrag(e.type === 'pointerup' ? e : null);
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  }

  // Touches on the button must not scroll, zoom or reach the race view.
  const stopTouch = (e) => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); };
  const opts = { passive: false };
  el.addEventListener('pointerdown', onDown, opts);
  el.addEventListener('pointermove', onMove, opts);
  el.addEventListener('pointerup', onUp, opts);
  el.addEventListener('pointercancel', onUp, opts);
  el.addEventListener('lostpointercapture', onUp, opts);
  el.addEventListener('touchstart', stopTouch, opts);
  el.addEventListener('touchmove', stopTouch, opts);
  el.addEventListener('contextmenu', stopTouch, opts);

  return {
    el,
    zone: zoneEl,
    update,
    get dragging() { return _dragging; },
    dispose() {
      el.removeEventListener('pointerdown', onDown, opts);
      el.removeEventListener('pointermove', onMove, opts);
      el.removeEventListener('pointerup', onUp, opts);
      el.removeEventListener('pointercancel', onUp, opts);
      el.removeEventListener('lostpointercapture', onUp, opts);
      el.removeEventListener('touchstart', stopTouch, opts);
      el.removeEventListener('touchmove', stopTouch, opts);
      el.removeEventListener('contextmenu', stopTouch, opts);
      if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', onResize);
      _dragging = false; drag = null;
      el.hidden = true;
      if (zoneEl) zoneEl.hidden = true;
    },
  };
}
