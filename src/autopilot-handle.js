// Draggable autopilot heading handle: a round HTML button (#autopilot_handle)
// over the race canvas. Shown while the autopilot is engaged, Camera Follow
// is on and this client has a boat it can steer. It sits a fixed number of
// CSS pixels (--ap-handle-dist) from the boat's on-screen position along the
// autopilot target heading, whatever the zoom. Pointer / touch drag on it
// sets an absolute autopilot target (headingSet) from the boat to the
// pointer, so tacks and gybes are a swing across the wind. The button is not
// part of the canvas, so its drags never reach drag-to-look, pinch zoom or
// the double-tap Camera Follow toggle.

import * as THREE from 'three';
import { autopilotHeadingFromWorld } from './boat-draw.js';

// Fallbacks when the CSS custom properties are missing (tests, old pages).
export const AP_HANDLE_DIST_PX = 120;
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
export function autopilotRay(s, dist = AHEAD_M) {
  if (!s || !Number.isFinite(s.wd) || !Number.isFinite(s.aht) || !Number.isFinite(s.px) || !Number.isFinite(s.py)) return null;
  const ang = (s.wd + s.aht) / 180 * Math.PI;
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
export function autopilotButtonClientPos(camera, canvas, s, distPx = AP_HANDLE_DIST_PX) {
  const ray = autopilotRay(s);
  if (!ray) return null;
  const o = worldToClient(camera, canvas, ray.origin.x, ray.origin.y);
  const a = worldToClient(camera, canvas, ray.ahead.x, ray.ahead.y);
  if (!o || !a) return null;
  const p = pointAtPixels(o, a, distPx);
  return p ? { x: p.x, y: p.y, boatX: o.x, boatY: o.y } : null;
}

// Shown only while the autopilot is engaged, Camera Follow is on and there
// is a boat this client steers (getBoat() returns null for spectators).
export function autopilotButtonVisible(view, boat) {
  return !!(view && view.camera_follow && boat && boat.ap);
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
  b.className = 'ap-handle';
  b.tabIndex = -1; // never steals Space / Enter from the race keys
  b.title = 'Drag to set the autopilot heading';
  b.setAttribute('aria-label', 'Autopilot heading: drag to steer');
  b.hidden = true;
  doc.body.appendChild(b);
  return b;
}

// getBoat(): latest render-state for the steered boat, or null.
// command(c): host.command — sends { type: 'headingSet', boat?, aht }.
// boatIndex(): local boat index for the command (0 when remote maps it).
// Call update() once per drawn frame, after the camera has moved.
export function setupAutopilotHandle(view, {
  doc = typeof document !== 'undefined' ? document : null,
  canvas = doc ? doc.getElementById('sim_canvas') : null,
  button = null,
  getCamera,
  getBoat,
  command,
  boatIndex = () => 0,
} = {}) {
  if (!canvas || !view || typeof getCamera !== 'function' || typeof getBoat !== 'function' || typeof command !== 'function') {
    return null;
  }
  const el = button || (doc && doc.getElementById('autopilot_handle')) || (doc ? createButton(doc) : null);
  if (!el) return null;

  let pointerId = null;
  let lastAht = null;
  let distPx = null;
  let shownX = NaN, shownY = NaN;

  const dist = () => {
    if (distPx == null) distPx = cssPx(el, '--ap-handle-dist', AP_HANDLE_DIST_PX);
    return distPx;
  };
  const onResize = () => { distPx = null; };
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', onResize);

  function sendHeading(aht) {
    if (!Number.isFinite(aht)) return;
    if (lastAht != null && Math.abs(aht - lastAht) < 0.25) return;
    lastAht = aht;
    const idx = boatIndex();
    const c = { type: 'headingSet', aht };
    if (Number.isInteger(idx) && idx >= 0) c.boat = idx;
    command(c);
  }

  function headingAt(e) {
    const boat = getBoat();
    if (!boat) return NaN;
    const w = clientToWorld(getCamera(), canvas, e.clientX, e.clientY);
    return w ? autopilotHeadingFromWorld(boat, w.x, w.y) : NaN;
  }

  function hide() {
    if (!el.hidden) el.hidden = true;
    shownX = NaN; shownY = NaN;
  }

  function update() {
    const boat = getBoat();
    if (!autopilotButtonVisible(view, boat) && !_dragging) { hide(); return; }
    const p = autopilotButtonClientPos(getCamera(), canvas, boat, dist());
    if (!p) { hide(); return; }
    const r = canvas.getBoundingClientRect();
    // Off the race view (boat at the map edge): hide rather than float over
    // the top bar or the touch panel.
    if (p.x < r.left || p.x > r.left + r.width || p.y < r.top || p.y > r.top + r.height) { hide(); return; }
    if (el.hidden) el.hidden = false;
    if (!(Math.abs(p.x - shownX) <= 0.25 && Math.abs(p.y - shownY) <= 0.25)) {
      shownX = p.x; shownY = p.y;
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
      if (el.dataset) el.dataset.boatPx = `${p.boatX.toFixed(1)},${p.boatY.toFixed(1)}`;
    }
  }

  function onDown(e) {
    if (pointerId != null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!getBoat()) return;
    pointerId = e.pointerId;
    _dragging = true;
    _grabs++;
    lastAht = null;
    try { el.setPointerCapture(pointerId); } catch (_) {}
    if (el.classList) el.classList.add('dragging');
    if (e.cancelable) e.preventDefault(); // no focus, no text selection
    e.stopPropagation();
  }

  function onMove(e) {
    if (pointerId == null || e.pointerId !== pointerId) return;
    sendHeading(headingAt(e));
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  }

  function onUp(e) {
    if (pointerId == null || e.pointerId !== pointerId) return;
    try { el.releasePointerCapture(pointerId); } catch (_) {}
    pointerId = null;
    _dragging = false;
    lastAht = null;
    if (el.classList) el.classList.remove('dragging');
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
      _dragging = false; pointerId = null;
      el.hidden = true;
    },
  };
}
