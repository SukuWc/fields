import * as THREE from 'three';
import { FlowTracers, tracerCountFor, TRACER_LIFETIME_S, TRACER_TAIL_S, TRACER_SEGMENTS, TRACER_COUNT_LIMIT } from './flow-tracers.js';

let camera, scene, renderer, fluidPlane;
let _planeBase = null;
// Field plane shown (remote: the page's Show field box). Dev mode hides it too.
let _fieldVisible = true;
export function setFieldVisible(on) { _fieldVisible = !!on; }
let _getScene;
let _view;

const fpsEl = document.getElementById('fps');
let fpsLastTime = performance.now();
let fpsFrameCount = 0;

// Persistent fixture → THREE.Line mapping — only rebuilt when fixtures enter/leave the world
const fixtureLines = new Map();

// Reusable pool for guide (force arrow) lines — shown/hidden rather than created/destroyed
const guidePool = [];

// Rule-overlay strokes are wider than a 1px WebGL line so the red/green split reads at the default zoom.
const RULE_STROKE_M = 0.7;
const ruleRibbonPool = [];
const abeamPool = [];
// Rule labels are canvas textures on planes. The texture is rebuilt only when
// the words change; the Rule 15 bar is a scaled quad, so its shrink does not
// repaint text. Contact flashes reuse one ring texture.
const labelGroupPool = [];

// The field quad sits 0.01 under the strokes. PerspectiveCamera's near/far
// (0.01..85) puts almost all of the depth range in empty space in front of
// the map, so across zoom 10–70 that gap is often a single depth value.
// The field material used to be transparent, which draws it after opaque
// hull lines; on a tie the later fragment wins and the heatmap covers them.
// The tie flips with zoom, and only the opaque strokes lose, so a view looks
// partly eaten and changes as you pan. Overlays skip the depth test and
// paint in this order, after the opaque field.
// Pooled and moving lines also set frustumCulled = false: three.js computes a
// geometry's bounding sphere once, from the first positions, so a segment that
// moves later is culled by its stale sphere and vanishes in whole arcs.
const ORDER_TRACERS = 0.5; // flow tracers: over the field, under the hulls
const ORDER_HULL = 1;
const ORDER_GUIDE = 2;
const ORDER_RIBBON = 3;
const ORDER_ABEAM = 4;
const ORDER_CONTACT = 5;
const ORDER_LABEL = 6;
const ORDER_LABEL_FILL = 7;

function markOverlay(material) {
  material.transparent = true;
  material.depthTest = false;
  material.depthWrite = false;
  return material;
}
const labelTextureCache = new Map();
const contactPool = [];
let contactTexture = null;

// Body outlines are plain data built from the frame state (scene-build.js
// buildBodies): { id, kind, stroke, pts: [x0, y0, x1, y1, ...] } in world coordinates.
function createFixtureLine(body) {
  const pointCount = body.pts.length / 2;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pointCount * 3), 3));
  const material = markOverlay(new THREE.LineBasicMaterial({ color: body.stroke }));
  const line = new THREE.Line(geometry, material);
  line.renderOrder = ORDER_HULL;
  line.frustumCulled = false;

  updateFixtureLine(line, body);
  return line;
}

function updateFixtureLine(line, body) {
  const pos = line.geometry.attributes.position.array;
  const pts = body.pts;
  const n = Math.min(pts.length / 2, pos.length / 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = pts[i * 2];
    pos[i * 3 + 1] = pts[i * 2 + 1];
    pos[i * 3 + 2] = 0;
  }
  line.geometry.attributes.position.needsUpdate = true;
}

function ruleRibbon(index) {
  while (ruleRibbonPool.length <= index) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
    const mesh = new THREE.Mesh(geo, markOverlay(new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
    })));
    mesh.frustumCulled = false;
    mesh.renderOrder = ORDER_RIBBON;
    scene.add(mesh);
    ruleRibbonPool.push(mesh);
  }
  return ruleRibbonPool[index];
}

function updateRuleRibbon(mesh, r) {
  const dx = r.x2 - r.x1;
  const dy = r.y2 - r.y1;
  const len = Math.hypot(dx, dy);
  const stroke = (typeof r.stroke === 'number' && r.stroke > 0) ? r.stroke : RULE_STROKE_M;
  const nx = len < 1e-6 ? 0 : -dy / len * stroke * 0.5;
  const ny = len < 1e-6 ? 0 : dx / len * stroke * 0.5;
  const z = r.z !== undefined ? r.z : 0.2;
  const corners = [
    [r.x1 + nx, r.y1 + ny],
    [r.x1 - nx, r.y1 - ny],
    [r.x2 - nx, r.y2 - ny],
    [r.x2 + nx, r.y2 + ny],
  ];
  const order = [0, 1, 2, 0, 2, 3];
  const pos = mesh.geometry.attributes.position.array;
  for (let i = 0; i < order.length; i++) {
    pos[i * 3] = corners[order[i]][0];
    pos[i * 3 + 1] = corners[order[i]][1];
    pos[i * 3 + 2] = z;
  }
  mesh.geometry.attributes.position.needsUpdate = true;
  mesh.material.color.setHex(r.color !== undefined ? r.color : 0xffffff);
  mesh.visible = true;
}

// Dashed stern mark. World-unit dashes, 1px wide, so it stays distinct from the red/green ribbon.
function abeamLine(index) {
  while (abeamPool.length <= index) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, markOverlay(new THREE.LineDashedMaterial({
      color: 0x66eeff,
      dashSize: 0.45,
      gapSize: 0.28,
    })));
    line.frustumCulled = false;
    line.renderOrder = ORDER_ABEAM;
    scene.add(line);
    abeamPool.push(line);
  }
  return abeamPool[index];
}

function updateAbeamLine(line, r) {
  const pos = line.geometry.attributes.position.array;
  const z = r.z !== undefined ? r.z : 0.25;
  pos[0] = r.x1; pos[1] = r.y1; pos[2] = z;
  pos[3] = r.x2; pos[4] = r.y2; pos[5] = z;
  line.geometry.attributes.position.needsUpdate = true;
  line.computeLineDistances();
  line.material.color.setHex(r.color !== undefined ? r.color : 0x66eeff);
  line.visible = true;
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function labelSignature(lines) {
  let sig = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i) sig += '|';
    sig += (line.role || '') + ':' + (line.id || '') + ':' + line.text;
  }
  return sig;
}

function paintLabelTexture(lines) {
  const role0 = lines.length === 1 ? lines[0].role : '';
  const badge = role0 === 'badge';
  const turn = role0 === 'turn';
  const cleared = role0 === 'cleared';
  // Course marks: the next mark, a rounded one, and a plain mark number.
  const next = role0 === 'next';
  const rounded = role0 === 'rounded';
  const markno = role0 === 'markno';
  const compact = badge || turn || cleared || next || rounded || markno;
  const rule15 = lines.some((line) => line.id === '15' && line.role === 'final');
  const fontPx = compact ? 12 : 14;
  const font = '700 ' + fontPx + 'px "Courier New", Courier, monospace';
  const dimFont = '500 ' + fontPx + 'px "Courier New", Courier, monospace';
  const lineH = compact ? 16 : 18;
  const padX = compact ? 6 : 7;
  const padY = 4;

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  let maxW = 0;
  for (let i = 0; i < lines.length; i++) {
    const w = measure.measureText(lines[i].text).width;
    if (w > maxW) maxW = w;
  }
  const width = Math.max(8, Math.ceil(maxW + padX * 2));
  const height = Math.max(8, Math.ceil(lines.length * lineH + padY * 2));
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  roundedRect(ctx, 0.5, 0.5, width - 1, height - 1, 3);
  if (badge) {
    ctx.fillStyle = 'rgba(160, 22, 22, 0.94)';
    ctx.fill();
    ctx.strokeStyle = '#ff8a80';
  } else if (turn) {
    ctx.fillStyle = 'rgba(72, 48, 0, 0.94)';
    ctx.fill();
    ctx.strokeStyle = '#ffc240';
  } else if (cleared) {
    ctx.fillStyle = 'rgba(10, 78, 42, 0.94)';
    ctx.fill();
    ctx.strokeStyle = '#8dffb0';
  } else if (next) {
    ctx.fillStyle = 'rgba(22, 92, 10, 0.94)';
    ctx.fill();
    ctx.strokeStyle = '#7dff5a';
  } else if (rounded) {
    ctx.fillStyle = 'rgba(50, 56, 64, 0.85)';
    ctx.fill();
    ctx.strokeStyle = '#8a96a3';
  } else if (markno) {
    ctx.fillStyle = 'rgba(70, 36, 0, 0.9)';
    ctx.fill();
    ctx.strokeStyle = '#ff8c00';
  } else if (rule15) {
    ctx.fillStyle = 'rgba(40, 28, 0, 0.92)';
    ctx.fill();
    ctx.strokeStyle = '#ffc240';
  } else {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  }
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inhibited = line.role === 'inhibited';
    ctx.font = inhibited ? dimFont : font;
    if (line.role === 'badge' || line.role === 'cleared' || line.role === 'next') ctx.fillStyle = '#ffffff';
    else if (line.role === 'rounded') ctx.fillStyle = '#c9d1da';
    else if (line.role === 'markno') ctx.fillStyle = '#ffd9a8';
    else if (line.role === 'turn') ctx.fillStyle = '#ffe7a3';
    else if (inhibited) ctx.fillStyle = 'rgba(210, 214, 220, 0.72)';
    else if (line.id === '15') ctx.fillStyle = '#ffe7a3';
    else if (line.role === 'final' && String(line.text).indexOf('both') !== -1) ctx.fillStyle = '#ffd0d0';
    else if (line.role === 'final') ctx.fillStyle = '#e9ffe8';
    else ctx.fillStyle = '#ffffff';
    const y = padY + lineH * i + lineH / 2;
    ctx.fillText(line.text, padX, y);
    if (inhibited) {
      const textW = ctx.measureText(line.text).width;
      ctx.strokeStyle = '#f2f4f8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(padX + textW, y);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, width, height };
}

function labelTexture(lines) {
  const key = (Math.min(2, window.devicePixelRatio || 1)) + '@' + labelSignature(lines);
  let cached = labelTextureCache.get(key);
  if (!cached) {
    cached = paintLabelTexture(lines);
    labelTextureCache.set(key, cached);
  }
  return cached;
}

function labelGroup(index) {
  while (labelGroupPool.length <= index) {
    const group = new THREE.Group();
    group.frustumCulled = false;
    const text = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      markOverlay(new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        premultipliedAlpha: false,
      }))
    );
    text.frustumCulled = false;
    text.renderOrder = ORDER_LABEL;
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      markOverlay(new THREE.MeshBasicMaterial({
        color: 0x3a2a00,
        opacity: 0.95,
        side: THREE.DoubleSide,
      }))
    );
    track.frustumCulled = false;
    track.renderOrder = ORDER_LABEL;
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      markOverlay(new THREE.MeshBasicMaterial({
        color: 0xffc240,
        side: THREE.DoubleSide,
      }))
    );
    fill.frustumCulled = false;
    fill.renderOrder = ORDER_LABEL_FILL;
    group.add(text);
    group.add(track);
    group.add(fill);
    scene.add(group);
    labelGroupPool.push({ group, text, track, fill, signature: '' });
  }
  return labelGroupPool[index];
}

function worldPerPixel(x, y) {
  const height = renderer.domElement.clientHeight || 1;
  const vFov = camera.fov * Math.PI / 180;
  const distance = Math.max(0.5, Math.hypot(camera.position.x - x, camera.position.y - y, camera.position.z));
  return 2 * Math.tan(vFov / 2) * distance / height;
}

function renderRuleLabels(labels) {
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const lines = label.lines && label.lines.length
      ? label.lines
      : [{ text: label.text || '', role: 'final', id: '' }];
    const entry = labelGroup(i);
    const sig = labelSignature(lines);
    if (entry.signature !== sig) {
      const painted = labelTexture(lines);
      entry.text.material.map = painted.texture;
      entry.text.material.needsUpdate = true;
      entry.texW = painted.width;
      entry.texH = painted.height;
      entry.signature = sig;
    }
    const texW = entry.texW;
    const texH = entry.texH;
    const s = worldPerPixel(label.x, label.y);
    entry.group.position.set(label.x, label.y, label.badge ? 0.45 : 0.4);
    entry.group.scale.set(s, s, 1);
    entry.group.visible = true;

    const showBar = !!label.rule15;
    const barH = showBar ? 7 : 0;
    const gap = label.badge ? 4 : 8;
    entry.text.scale.set(texW, texH, 1);
    entry.text.position.set(0, gap + barH + texH / 2, 0);

    if (showBar) {
      const progress = Math.max(0, Math.min(1, Number(label.progress) || 0));
      entry.track.visible = true;
      entry.fill.visible = true;
      entry.track.scale.set(texW, barH, 1);
      entry.track.position.set(0, gap + barH / 2, 0);
      const fillW = Math.max(0.01, texW * progress);
      entry.fill.scale.set(fillW, barH, 1);
      entry.fill.position.set(-texW / 2 + fillW / 2, gap + barH / 2, 0.2);
    } else {
      entry.track.visible = false;
      entry.fill.visible = false;
    }
  }
  for (let i = labels.length; i < labelGroupPool.length; i++) {
    labelGroupPool[i].group.visible = false;
  }
}

function contactMarkTexture() {
  if (contactTexture) return contactTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.beginPath();
  ctx.arc(32, 32, 26, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffe08a';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(32, 32, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#fff6d0';
  ctx.fill();
  contactTexture = new THREE.CanvasTexture(canvas);
  if (THREE.SRGBColorSpace) contactTexture.colorSpace = THREE.SRGBColorSpace;
  contactTexture.needsUpdate = true;
  return contactTexture;
}

function contactMark(index) {
  while (contactPool.length <= index) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      markOverlay(new THREE.MeshBasicMaterial({
        map: contactMarkTexture(),
        side: THREE.DoubleSide,
        premultipliedAlpha: false,
      }))
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = ORDER_CONTACT;
    scene.add(mesh);
    contactPool.push(mesh);
  }
  return contactPool[index];
}

function renderContacts(marks) {
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    const mesh = contactMark(i);
    const d = Math.max(0.2, mark.radius * 2);
    mesh.position.set(mark.x, mark.y, 0.32);
    mesh.scale.set(d, d, 1);
    mesh.material.opacity = mark.opacity !== undefined ? mark.opacity : 1;
    mesh.visible = true;
  }
  for (let i = marks.length; i < contactPool.length; i++) {
    contactPool[i].visible = false;
  }
}

// Size the drawing buffer from the canvas's CSS box (#sim_canvas in
// index.html), not the window: the touch-controls panel shrinks the canvas
// to the top half, and the aspect has to follow that box.
function resizeRenderer() {
  const canvas = renderer.domElement;
  const width = Math.max(canvas.clientWidth || window.innerWidth, 1);
  const height = Math.max(canvas.clientHeight || window.innerHeight, 1);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

// size: { width, height } of the map in world units.
export function initRenderer(size, planeMat, view) {
  // Far plane: 85 covered zoom 70 on the 75 m map; bigger maps zoom out
  // further (map-size.js cameraLimits), so it follows the zoom limit.
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, Math.max(85, (view.camera_zoom_max || 70) + 15));
  camera.position.z = 60;
  camera.position.y = 20;
  scene = new THREE.Scene();

  // Texels are opaque. A transparent field joins the transparent pass and
  // can paint over strokes once their depths quantize together.
  planeMat.transparent = false;
  planeMat.depthTest = true;
  planeMat.depthWrite = true;
  fluidPlane = new THREE.Mesh(new THREE.PlaneGeometry(size.width, size.height), planeMat);
  _planeBase = { w: size.width, h: size.height };
  fluidPlane.position.z = -0.01;
  fluidPlane.renderOrder = 0;
  scene.add(fluidPlane);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  const canvas = renderer.domElement;
  // Position and size come from #sim_canvas in index.html (display: block,
  // fixed, full window or the top half with touch controls). Inline canvases
  // sit on the text baseline and leave a gap that opens scrollbars.
  canvas.id = 'sim_canvas';
  document.body.appendChild(renderer.domElement);
  resizeRenderer();
  window.addEventListener('resize', resizeRenderer);
  if (typeof ResizeObserver === 'function') new ResizeObserver(resizeRenderer).observe(canvas);
}

// The field plane covers the lattice, which is the map rounded up to whole
// root cells. At the default resolution that is exactly map.width × map.height.
export function setFluidPlaneSize(width, height) {
  if (!fluidPlane || !_planeBase) return;
  fluidPlane.scale.set(width / _planeBase.w, height / _planeBase.h, 1);
}

// Flow tracers (flow-tracers.js): one LineSegments buffer for the whole pool
// (TRACER_SEGMENTS per tracer), created on the first grid and rebuilt when
// the count changes. Shown while view.show_fields (Flow tracers box).
let tracers = null, tracerLines = null, _tracerT = null;
// Tail colour, slow (wind shadow) → fast. Over the colour field plot the
// tracers are dark (navy → black) so they read on the bright palette; on the
// black background (dev mode, field plot off) blue → warm white.
const TRACER_SLOW_RGB = [0.1, 0.35, 1], TRACER_FAST_RGB = [1, 1, 0.85];
const TRACER_SLOW_ON_FIELD = [0.05, 0.12, 0.45], TRACER_FAST_ON_FIELD = [0, 0, 0];
// Live settings from the Tracers / Life / Tail inputs (setTracerParams).
// count null = auto (tracerCountFor the map size and device).
const _tracerParams = { count: null, lifetime: TRACER_LIFETIME_S, tail: TRACER_TAIL_S };
function autoTracerCount() {
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const mw = _planeBase ? _planeBase.w : 100, mh = _planeBase ? _planeBase.h : 200;
  return tracerCountFor(mw, mh, { touch });
}
function tracerBuffers(count) {
  const v = count * TRACER_SEGMENTS * 2;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v * 3), 3).setUsage(THREE.DynamicDrawUsage));
  // RGBA: the alpha carries the life fade and the fade along the tail.
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(v * 4), 4).setUsage(THREE.DynamicDrawUsage));
  if (tracerLines) { tracerLines.geometry.dispose(); tracerLines.geometry = geo; return; }
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true });
  markOverlay(mat);
  tracerLines = new THREE.LineSegments(geo, mat);
  tracerLines.renderOrder = ORDER_TRACERS;
  tracerLines.frustumCulled = false;
  tracerLines.visible = false;
  scene.add(tracerLines);
}
// p: { count (null/0 = auto), lifetime (s), tail (s) }; applies live.
export function setTracerParams(p = {}) {
  if ('count' in p) _tracerParams.count = p.count >= 10 ? p.count : null;
  if (p.lifetime > 0) _tracerParams.lifetime = p.lifetime;
  if (p.tail >= 0) _tracerParams.tail = p.tail;
  if (!tracers) return;
  tracers.setLifetime(_tracerParams.lifetime);
  tracers.setTail(_tracerParams.tail);
  if (tracers.setCount(_tracerParams.count || autoTracerCount())) tracerBuffers(tracers.count);
}
export function getTracerParams() { return { ..._tracerParams, count: tracers ? tracers.count : (_tracerParams.count || autoTracerCount()) }; }
export function setFlowGrid(grid) {
  if (!grid || !scene) return;
  if (!tracers) {
    const count = Math.min(TRACER_COUNT_LIMIT, _tracerParams.count || autoTracerCount());
    tracers = new FlowTracers({ count, lifetime: _tracerParams.lifetime, tail: _tracerParams.tail });
    tracerBuffers(count);
  }
  tracers.setGrid(grid);
}
export function getTracers() { return tracers; }
// Headless browser checks read the live pool (count, lifetime, tail).
if (typeof window !== 'undefined') window.__tracers = () => tracers && { count: tracers.count, lifetime: tracers.lifetime, tail: tracers.tail, visible: !!(tracerLines && tracerLines.visible) };

function renderTracers() {
  const now = performance.now();
  const dt = _tracerT === null ? 0 : (now - _tracerT) / 1000;
  _tracerT = now;
  const on = !!(_view && _view.show_fields && tracers && tracers.grid);
  if (tracerLines) tracerLines.visible = on;
  if (!on) { _tracerT = null; return; }
  tracers.step(dt);
  const g = tracerLines.geometry;
  const onField = !!(fluidPlane && fluidPlane.visible);
  tracers.write(g.attributes.position.array, g.attributes.color.array, 0.005,
    onField ? TRACER_SLOW_ON_FIELD : TRACER_SLOW_RGB, onField ? TRACER_FAST_ON_FIELD : TRACER_FAST_RGB);
  g.attributes.position.needsUpdate = true;
  g.attributes.color.needsUpdate = true;
}

export function getCamera() {
  return camera;
}

// getScene(): { bodies, guides, devMode } from the host (main.js).
// options.loop false (remote mode): no animation loop; the caller draws with
// renderNow() when a server frame arrives.
export function startAnimation(view, getScene, options = {}) {
  _view = view;
  _getScene = getScene;
  if (options.loop !== false) renderer.setAnimationLoop(animation);
}

// Draw one frame now (no frame-rate cap). Remote mode calls it per server frame.
export function renderNow() {
  if (!_getScene) return;
  animation(undefined);
}

// Rendering is capped at RENDER_FPS (the sim tick rate): frames from
// setAnimationLoop that arrive early are skipped. renderStats counts drawn
// frames for the headless 30 fps check.
export const RENDER_FPS = 30;
export const renderStats = { frames: 0 };
if (typeof window !== 'undefined') window.__renderStats = renderStats;
let _nextRenderT = 0;

function animation(t) {
  const period = 1000 / RENDER_FPS;
  if (typeof t === 'number') {
    if (t + 1 < _nextRenderT) return;
    _nextRenderT = Math.max(_nextRenderT + period, t - period);
  }
  renderStats.frames++;
  camera.position.x = _view.camera_position_x;
  camera.position.y = _view.camera_position_y;
  camera.position.z = _view.camera_zoom;
  const sceneData = _getScene();
  if (fluidPlane) fluidPlane.visible = !sceneData.devMode && _fieldVisible;

  // Update persistent fixture lines — create/remove only when fixture set changes
  const seenFixtures = new Set();
  for (const body of sceneData.bodies) {
    seenFixtures.add(body.id);
    const line = fixtureLines.get(body.id);
    if (!line) {
      const created = createFixtureLine(body);
      fixtureLines.set(body.id, created);
      scene.add(created);
    } else {
      updateFixtureLine(line, body);
    }
  }

  for (const [id, line] of fixtureLines) {
    if (!seenFixtures.has(id)) {
      scene.remove(line);
      line.geometry.dispose();
      line.material.dispose();
      fixtureLines.delete(id);
    }
  }

  // Update guide pool — reuse existing lines, hide extras.
  // Rule segments also get a filled stroke (WebGL lines stay 1px). Labels are HTML.
  const guides = sceneData.guides;
  let poolIdx = 0;
  let ruleIdx = 0;
  let abeamIdx = 0;
  const ruleLabels = [];
  const contactMarks = [];

  for (const r of guides) {
    if (r.type === 'label') {
      ruleLabels.push(r);
      continue;
    }
    if (r.type === 'contact') {
      contactMarks.push(r);
      continue;
    }
    if (r.type === 'abeam') {
      updateAbeamLine(abeamLine(abeamIdx++), r);
      continue;
    }
    if (r.type === 'rule') updateRuleRibbon(ruleRibbon(ruleIdx++), r);
    if (_view.show_forces === false && r.type === 'force') continue;

    if (poolIdx >= guidePool.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, markOverlay(new THREE.LineBasicMaterial()));
      line.renderOrder = ORDER_GUIDE;
      line.frustumCulled = false;
      scene.add(line);
      guidePool.push(line);
    }

    const line = guidePool[poolIdx];
    const pos = line.geometry.attributes.position.array;
    const z = r.z !== undefined ? r.z : 0;
    pos[0] = r.x1; pos[1] = r.y1; pos[2] = z;
    pos[3] = r.x2; pos[4] = r.y2; pos[5] = z;
    line.geometry.attributes.position.needsUpdate = true;
    line.material.color.setHex(r.color !== undefined ? r.color : 0xff0000);
    line.material.opacity = r.opacity !== undefined ? r.opacity : 1.0;
    line.visible = true;
    poolIdx++;
  }

  for (let i = poolIdx; i < guidePool.length; i++) {
    guidePool[i].visible = false;
  }
  for (let i = ruleIdx; i < ruleRibbonPool.length; i++) {
    ruleRibbonPool[i].visible = false;
  }
  for (let i = abeamIdx; i < abeamPool.length; i++) {
    abeamPool[i].visible = false;
  }
  renderContacts(contactMarks);
  renderRuleLabels(ruleLabels);
  renderTracers();

  renderer.render(scene, camera);

  fpsFrameCount++;
  if (fpsFrameCount % 30 === 0) {
    const now = performance.now();
    const fps = Math.round(30000 / (now - fpsLastTime));
    fpsEl.textContent = fps + ' fps';
    fpsLastTime = now;
  }
}
