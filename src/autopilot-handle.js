// Draggable autopilot heading handle. Visible when Camera Follow is on
// (drawn in scene-build.js). Pointer / touch drag on the yellow diamond
// sets an absolute autopilot target (headingSet), so tacks and gybes are a
// swing across the wind. Blocks drag-to-look while the handle is claimed.

import * as THREE from 'three';
import {
  AUTOPILOT_HANDLE_HIT_M,
  autopilotHandleHit,
  autopilotHeadingFromWorld,
} from './boat-draw.js';

const _ndc = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit = new THREE.Vector3();

// Canvas client coords → world metres on z = 0 (same ray as controls.js).
export function clientToWorld(camera, canvas, clientX, clientY) {
  if (!camera || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || 0, h = rect.height || 0;
  if (!(w > 0) && !(h > 0)) return null;
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

let _dragging = false;

export function isAutopilotHandleDragging() {
  return _dragging;
}

// getBoat(): latest render-state for the steered boat, or null.
// command(c): host.command — sends { type: 'headingSet', boat?, aht }.
// boatIndex(): local boat index for the command (0 when remote maps it).
export function setupAutopilotHandle(view, {
  canvas = typeof document !== 'undefined' ? document.getElementById('sim_canvas') : null,
  getCamera,
  getBoat,
  command,
  boatIndex = () => 0,
} = {}) {
  if (!canvas || !view || typeof getCamera !== 'function' || typeof getBoat !== 'function' || typeof command !== 'function') {
    return null;
  }

  let pointerId = null;
  let lastAht = null;

  function worldAt(e) {
    return clientToWorld(getCamera(), canvas, e.clientX, e.clientY);
  }

  function sendHeading(aht) {
    if (!Number.isFinite(aht)) return;
    if (lastAht != null && Math.abs(aht - lastAht) < 0.25) return;
    lastAht = aht;
    const idx = boatIndex();
    const c = { type: 'headingSet', aht };
    if (Number.isInteger(idx) && idx >= 0) c.boat = idx;
    command(c);
  }

  function setCursor(cur) {
    if (canvas.style) canvas.style.cursor = cur || '';
  }

  function onDown(e) {
    if (!view.camera_follow || pointerId != null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const boat = getBoat();
    if (!boat) return;
    const w = worldAt(e);
    if (!w || !autopilotHandleHit(boat, w.x, w.y, AUTOPILOT_HANDLE_HIT_M)) return;
    pointerId = e.pointerId;
    _dragging = true;
    lastAht = null;
    try { canvas.setPointerCapture(pointerId); } catch (_) {}
    setCursor('grabbing');
    const aht = autopilotHeadingFromWorld(boat, w.x, w.y);
    sendHeading(aht);
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onMove(e) {
    if (pointerId != null && e.pointerId === pointerId) {
      const boat = getBoat();
      if (!boat) return;
      const w = worldAt(e);
      if (!w) return;
      sendHeading(autopilotHeadingFromWorld(boat, w.x, w.y));
      if (e.cancelable) e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    // Hover affordance (mouse only).
    if (e.pointerType === 'mouse' && view.camera_follow && pointerId == null) {
      const boat = getBoat();
      const w = boat ? worldAt(e) : null;
      const hit = !!(w && boat && autopilotHandleHit(boat, w.x, w.y, AUTOPILOT_HANDLE_HIT_M));
      setCursor(hit ? 'grab' : '');
    }
  }

  function onUp(e) {
    if (pointerId == null || e.pointerId !== pointerId) return;
    try { canvas.releasePointerCapture(pointerId); } catch (_) {}
    pointerId = null;
    _dragging = false;
    lastAht = null;
    setCursor(view.camera_follow ? 'grab' : '');
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
  }

  // Capture so we claim the handle before drag-look's touchstart.
  const opts = { capture: true, passive: false };
  canvas.addEventListener('pointerdown', onDown, opts);
  canvas.addEventListener('pointermove', onMove, opts);
  canvas.addEventListener('pointerup', onUp, opts);
  canvas.addEventListener('pointercancel', onUp, opts);

  return {
    get dragging() { return _dragging; },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown, opts);
      canvas.removeEventListener('pointermove', onMove, opts);
      canvas.removeEventListener('pointerup', onUp, opts);
      canvas.removeEventListener('pointercancel', onUp, opts);
      if (_dragging) { _dragging = false; pointerId = null; }
      setCursor('');
    },
  };
}
