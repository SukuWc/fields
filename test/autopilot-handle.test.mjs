// Autopilot drag handle: round HTML button a fixed pixel distance ahead of
// the boat on the target heading, shown only while the autopilot is engaged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import * as boatDraw from '../src/boat-draw.js';
import { autopilotHeadingFromWorld } from '../src/boat-draw.js';
import { wrapDeg180 } from '../src/boat.js';
import { BOAT_ACTIONS } from '../src/sim.js';
import {
  AP_HANDLE_DIST_PX,
  autopilotButtonClientPos,
  autopilotButtonVisible,
  autopilotHandleGrabCount,
  autopilotRay,
  clientToWorld,
  isAutopilotHandleDragging,
  pointAtPixels,
  setupAutopilotHandle,
  worldToClient,
} from '../src/autopilot-handle.js';

function boatState(over = {}) {
  return {
    x: 0, y: 0, px: 0, py: 0, pa: 0, ha: 0,
    awa: 40, tw: 0, ap: 1, wd: 0, aht: 50, twa: -50,
    ra: 0, mba: 0, jba: 0, mf: 0, jf: 0, ph: 0, f: [],
    ...over,
  };
}

// renderer.js camera: 70° perspective looking straight down from z = zoom.
function camAt(x, y, zoom, w = 800, h = 600) {
  const c = new THREE.PerspectiveCamera(70, w / h, 0.1, 1000);
  c.position.set(x, y, zoom);
  c.updateMatrixWorld();
  return c;
}
function rectCanvas(w = 800, h = 600, left = 0, top = 0) {
  return { getBoundingClientRect: () => ({ left, top, width: w, height: h }) };
}

test('canvas drawing is gone: boat-draw keeps only the heading maths', () => {
  for (const k of ['autopilotHandleGuides', 'autopilotHandlePos', 'autopilotHandleHit', 'AUTOPILOT_HANDLE_COLOR', 'AUTOPILOT_HANDLE_DIST_M']) {
    assert.equal(k in boatDraw, false, k);
  }
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.equal(/autopilotHandleGuides|ap-handle/.test(main), false);
});

test('target ray starts at the boat origin along wd + aht', () => {
  const r = autopilotRay(boatState({ px: 3, py: 4, wd: 0, aht: 90 }), 10);
  assert.deepEqual(r.origin, { x: 3, y: 4 });
  assert.ok(Math.abs(r.ahead.x - 3) < 1e-9 && Math.abs(r.ahead.y - 14) < 1e-9);
  assert.equal(autopilotRay(boatState({ aht: NaN })), null);
  assert.equal(autopilotRay(null), null);
});

test('pointAtPixels walks a fixed pixel distance', () => {
  const p = pointAtPixels({ x: 10, y: 10 }, { x: 13, y: 14 }, 50);
  assert.ok(Math.abs(p.x - 40) < 1e-9 && Math.abs(p.y - 50) < 1e-9);
  assert.equal(pointAtPixels({ x: 1, y: 1 }, { x: 1, y: 1 }, 50), null);
});

test('world ↔ client round trip on the water plane', () => {
  const cam = camAt(5, -3, 30);
  const cv = rectCanvas(800, 600, 0, 52);
  const c = worldToClient(cam, cv, 8, 1);
  const w = clientToWorld(cam, cv, c.x, c.y);
  assert.ok(Math.abs(w.x - 8) < 1e-6 && Math.abs(w.y - 1) < 1e-6);
  // Camera centre → canvas centre.
  const m = worldToClient(cam, cv, 5, -3);
  assert.ok(Math.abs(m.x - 400) < 1e-6 && Math.abs(m.y - 352) < 1e-6);
});

test('button sits the same pixel distance from the boat at every zoom', () => {
  const cv = rectCanvas();
  const s = boatState({ px: 2, py: 1, wd: 30, aht: -50 });
  const dists = [];
  for (const zoom of [10, 18, 45, 80]) {
    const cam = camAt(0, 0, zoom);
    const p = autopilotButtonClientPos(cam, cv, s, 120);
    assert.ok(p);
    dists.push(Math.hypot(p.x - p.boatX, p.y - p.boatY));
    // Direction on screen matches the target heading (screen y is down).
    const ang = Math.atan2(-(p.y - p.boatY), p.x - p.boatX) * 180 / Math.PI;
    assert.ok(Math.abs(wrapDeg180(ang - (s.wd + s.aht))) < 1e-6, String(ang));
  }
  for (const d of dists) assert.ok(Math.abs(d - 120) < 1e-6, String(d));
  assert.equal(AP_HANDLE_DIST_PX, 120);
});

test('visible only with autopilot engaged, Camera Follow on and a boat', () => {
  assert.equal(autopilotButtonVisible({ camera_follow: true }, boatState({ ap: 1 })), true);
  assert.equal(autopilotButtonVisible({ camera_follow: true }, boatState({ ap: 0 })), false);
  assert.equal(autopilotButtonVisible({ camera_follow: false }, boatState({ ap: 1 })), false);
  assert.equal(autopilotButtonVisible({ camera_follow: true }, null), false);
});

test('heading from world wraps through head-to-wind and dead downwind', () => {
  const s = boatState({ wd: 0, aht: 50, px: 0, py: 0 });
  // Point due +X → world 0° → aht 0 (head-to-wind when wd = 0)
  assert.ok(Math.abs(autopilotHeadingFromWorld(s, 10, 0)) < 1e-9);
  // +Y → 90°
  assert.ok(Math.abs(autopilotHeadingFromWorld(s, 0, 10) - 90) < 1e-9);
  // −Y → −90°
  assert.ok(Math.abs(autopilotHeadingFromWorld(s, 0, -10) + 90) < 1e-9);
  // −X → ±180
  assert.equal(Math.abs(autopilotHeadingFromWorld(s, -10, 0)), 180);
  // Wind from 90°: a point at world 90° (+Y) is aht 0; −X is aht +90.
  const s2 = boatState({ wd: 90 });
  assert.ok(Math.abs(autopilotHeadingFromWorld(s2, 0, 10)) < 1e-9);
  assert.ok(Math.abs(autopilotHeadingFromWorld(s2, -10, 0) - 90) < 1e-9);
});

test('headingSet engages autopilot and accepts any wrapped angle', () => {
  const calls = [];
  const boat = {
    autopilot_enabled: false,
    autopilot_heading_target: 40,
    _cancelPenaltyTurn() { calls.push('cancel'); },
    input_autopilot_heading_set(aht) {
      this._cancelPenaltyTurn();
      this.autopilot_heading_target = wrapDeg180(aht);
      this.autopilot_enabled = true;
      calls.push(aht);
    },
  };
  BOAT_ACTIONS.headingSet(boat, { aht: 170 });
  assert.equal(boat.autopilot_enabled, true);
  assert.equal(boat.autopilot_heading_target, 170);
  BOAT_ACTIONS.headingSet(boat, { aht: -190 });
  assert.equal(boat.autopilot_heading_target, 170); // wrapDeg180(-190) = 170
  BOAT_ACTIONS.headingSet(boat, { aht: 5 });
  assert.equal(boat.autopilot_heading_target, 5);
  assert.ok(calls.includes('cancel'));
});

test('Boat.input_autopilot_heading_set wraps and enables via headingSet command', async () => {
  assert.equal(wrapDeg180(270), -90);
  assert.equal(wrapDeg180(-270), 90);
  const { SimCore } = await import('../src/host.js');
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f' });
  core.command({ type: 'restart', scenario: 0 });
  core.tick({ dt: 1 / 30, held: [], present: false, view: {} });
  const b = core.sim.players[0];
  b.autopilot_enabled = false;
  b.autopilot_heading_target = 40;
  core.command({ type: 'headingSet', boat: 0, aht: -120 });
  assert.equal(b.autopilot_enabled, true);
  assert.ok(Math.abs(b.autopilot_heading_target + 120) < 1e-9);
  // Through head-to-wind: Up/Down would clamp; headingSet does not.
  core.command({ type: 'headingSet', boat: 0, aht: 2 });
  assert.ok(Math.abs(b.autopilot_heading_target - 2) < 1e-9);
  core.command({ type: 'headingSet', boat: 0, aht: 190 });
  assert.ok(Math.abs(b.autopilot_heading_target + 170) < 1e-9, String(b.autopilot_heading_target));
});


function fakeButton() {
  const h = {};
  const cls = new Set();
  return {
    hidden: true,
    style: {},
    dataset: {},
    captured: null,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), has: (c) => cls.has(c) },
    setPointerCapture(id) { this.captured = id; },
    releasePointerCapture() { this.captured = null; },
    addEventListener: (t, f) => { h[t] = f; },
    removeEventListener: (t) => { delete h[t]; },
    fire(t, e) { if (h[t]) h[t](e); },
    has: (t) => !!h[t],
  };
}
const ev = (over = {}) => ({
  pointerId: 1, pointerType: 'touch', button: 0, clientX: 0, clientY: 0, cancelable: true,
  prevented: false, stopped: false,
  preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
  ...over,
});

function rig({ ap = 1, follow = true, boat } = {}) {
  const view = { camera_follow: follow };
  const cam = camAt(0, 0, 30);
  const canvas = rectCanvas();
  const el = fakeButton();
  const cmds = [];
  let b = boat || boatState({ ap, wd: 0, aht: 0 });
  const ctl = setupAutopilotHandle(view, {
    doc: null, canvas, button: el,
    getCamera: () => cam,
    getBoat: () => b,
    command: (c) => cmds.push(c),
    boatIndex: () => 0,
  });
  return { view, cam, canvas, el, cmds, ctl, setBoat: (x) => { b = x; } };
}

test('update shows the button while the autopilot is on and hides it when off', () => {
  const r = rig({ ap: 1 });
  r.ctl.update();
  assert.equal(r.el.hidden, false);
  // Target ray along +X: button 120 px right of the canvas centre.
  assert.match(r.el.style.transform, /^translate\(520\.0px, 300\.0px\) translate\(-50%, -50%\)$/);
  r.setBoat(boatState({ ap: 0 }));
  r.ctl.update();
  assert.equal(r.el.hidden, true);
  r.setBoat(boatState({ ap: 1, aht: 90 }));
  r.view.camera_follow = false;
  r.ctl.update();
  assert.equal(r.el.hidden, true);
  r.view.camera_follow = true;
  r.ctl.update();
  assert.equal(r.el.hidden, false);
  assert.match(r.el.style.transform, /^translate\(400\.0px, 180\.0px\)/);
  r.setBoat(null); // spectator
  r.ctl.update();
  assert.equal(r.el.hidden, true);
  r.ctl.dispose();
});

test('button off the race view is hidden', () => {
  const r = rig({ boat: boatState({ ap: 1, px: 30, py: 0, aht: 0 }) });
  r.ctl.update();
  assert.equal(r.el.hidden, true);
  r.ctl.dispose();
});

test('drag on the button sends absolute headingSet from boat to pointer', () => {
  const r = rig();
  r.ctl.update();
  const grabs = autopilotHandleGrabCount();
  const down = ev({ clientX: 520, clientY: 300 });
  r.el.fire('pointerdown', down);
  assert.equal(isAutopilotHandleDragging(), true);
  assert.equal(r.el.captured, 1);
  assert.equal(autopilotHandleGrabCount(), grabs + 1);
  assert.ok(down.prevented && down.stopped);
  assert.equal(r.cmds.length, 0); // a grab alone does not move the target
  // Straight below the boat on screen → world −Y → aht −90 (wd 0).
  const mv = ev({ clientX: 400, clientY: 450 });
  r.el.fire('pointermove', mv);
  assert.ok(mv.prevented && mv.stopped);
  assert.equal(r.cmds.length, 1);
  assert.equal(r.cmds[0].type, 'headingSet');
  assert.equal(r.cmds[0].boat, 0);
  assert.ok(Math.abs(r.cmds[0].aht + 90) < 1e-6, String(r.cmds[0].aht));
  // Through dead downwind: left of the boat → ±180.
  r.el.fire('pointermove', ev({ clientX: 250, clientY: 300 }));
  assert.equal(Math.abs(Math.round(r.cmds[1].aht)), 180);
  // Tiny wobble (< 0.25°) is not resent.
  r.el.fire('pointermove', ev({ clientX: 250, clientY: 300.1 }));
  assert.equal(r.cmds.length, 2);
  // Another pointer is ignored while one holds the button.
  r.el.fire('pointermove', ev({ pointerId: 2, clientX: 400, clientY: 100 }));
  assert.equal(r.cmds.length, 2);
  r.el.fire('pointerup', ev());
  assert.equal(isAutopilotHandleDragging(), false);
  assert.equal(r.el.captured, null);
  r.el.fire('pointermove', ev({ clientX: 400, clientY: 100 }));
  assert.equal(r.cmds.length, 2);
  r.ctl.dispose();
});

test('headingSet from the pointer matches autopilotHeadingFromWorld', () => {
  const s = boatState({ ap: 1, px: 1, py: 2, wd: 40, aht: 10 });
  const r = rig({ boat: s });
  r.el.fire('pointerdown', ev({ clientX: 0, clientY: 0 }));
  r.el.fire('pointermove', ev({ clientX: 610, clientY: 120 }));
  const w = clientToWorld(r.cam, r.canvas, 610, 120);
  assert.ok(Math.abs(r.cmds[0].aht - autopilotHeadingFromWorld(s, w.x, w.y)) < 1e-9);
  r.el.fire('pointercancel', ev());
  assert.equal(isAutopilotHandleDragging(), false);
  r.ctl.dispose();
});

test('touches on the button never reach the page or the race view', () => {
  const r = rig();
  const t = ev();
  r.el.fire('touchstart', t);
  assert.ok(t.prevented && t.stopped);
  const m = ev();
  r.el.fire('touchmove', m);
  assert.ok(m.prevented && m.stopped);
  r.ctl.dispose();
  assert.equal(r.el.has('pointerdown'), false);
});

test('mouse right button does not grab', () => {
  const r = rig();
  r.el.fire('pointerdown', ev({ pointerType: 'mouse', button: 2 }));
  assert.equal(isAutopilotHandleDragging(), false);
  r.ctl.dispose();
});

test('index.html has the round button above the canvas and below the HUD', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<button type="button" id="autopilot_handle"[^>]*tabindex="-1"[^>]*hidden/);
  const css = html.slice(html.indexOf('#autopilot_handle {'), html.indexOf('#autopilot_handle[hidden]'));
  assert.match(css, /border-radius: 50%/);
  assert.match(css, /z-index: calc\(var\(--sz-z-canvas-ui\) \+ 1\)/);
  assert.match(css, /touch-action: none/);
  assert.match(html, /\.bp-touch \{ --ap-handle-dist: 110px; --ap-handle-size: var\(--sz-tap\); \}/);
  assert.match(html, /:root \{ --ap-handle-dist: 120px; --ap-handle-size: 36px; \}/);
});
