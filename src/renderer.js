import * as THREE from 'three';

let camera, scene, renderer, fluidPlane;
let _map, _getGuides;

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

function createFixtureLine(fixture, body) {
  const type = fixture.getType();
  const shape = fixture.getShape();

  let pointCount;
  if      (type === 'circle')  pointCount = 37; // 36 steps + close
  else if (type === 'edge')    pointCount = 2;
  else if (type === 'polygon') pointCount = shape.m_vertices.length + 1; // +1 to close
  else return null;

  const colorByType = { circle: 0x00ff00, edge: 0xff0000, polygon: 0x0000ff };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pointCount * 3), 3));
  const material = markOverlay(new THREE.LineBasicMaterial({ color: colorByType[type] }));
  const line = new THREE.Line(geometry, material);
  line.renderOrder = ORDER_HULL;

  updateFixtureLine(line, fixture, body);
  return line;
}

function updateFixtureLine(line, fixture, body) {
  const type = fixture.getType();
  const shape = fixture.getShape();
  const pos = line.geometry.attributes.position.array;

  if (type === 'circle') {
    const radius = shape.m_radius;
    const bodyPos = body.getPosition();
    for (let i = 0; i < 36; i++) {
      const angle = i * 10 / 180 * Math.PI;
      pos[i * 3]     = radius * Math.cos(angle) + bodyPos.x;
      pos[i * 3 + 1] = radius * Math.sin(angle) + bodyPos.y;
      pos[i * 3 + 2] = 0;
    }
    pos[108] = pos[0]; pos[109] = pos[1]; pos[110] = 0; // close loop

  } else if (type === 'edge') {
    const v1 = shape.m_vertex1;
    const v2 = shape.m_vertex2;
    pos[0] = v1.x + body.m_xf.p.x; pos[1] = v1.y + body.m_xf.p.y; pos[2] = 0;
    pos[3] = v2.x + body.m_xf.p.x; pos[4] = v2.y + body.m_xf.p.y; pos[5] = 0;

  } else if (type === 'polygon') {
    const vertices = shape.m_vertices;
    const n = vertices.length;
    const angle = body.getAngle() + Math.PI;
    const com = body.getLocalCenter();
    const cx = fixture.m_body.c_position.c.x;
    const cy = fixture.m_body.c_position.c.y;
    for (let i = 0; i <= n; i++) {
      const v = vertices[i % n];
      pos[i * 3]     = (v.x + com.x) * Math.cos(angle) + (v.y - com.y) * Math.sin(angle) + cx;
      pos[i * 3 + 1] = (v.x + com.x) * Math.sin(angle) - (v.y - com.y) * Math.cos(angle) + cy;
      pos[i * 3 + 2] = 0;
    }
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
  const badge = lines.length === 1 && lines[0].role === 'badge';
  const rule15 = lines.some((line) => line.id === '15' && line.role === 'final');
  const fontPx = badge ? 12 : 14;
  const font = '700 ' + fontPx + 'px "Courier New", Courier, monospace';
  const dimFont = '500 ' + fontPx + 'px "Courier New", Courier, monospace';
  const lineH = badge ? 16 : 18;
  const padX = badge ? 6 : 7;
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
    if (line.role === 'badge') ctx.fillStyle = '#ffffff';
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

function resizeRenderer() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

export function initRenderer(map, planeMat) {
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 85);
  camera.position.z = 60;
  camera.position.y = 20;
  scene = new THREE.Scene();

  // Texels are opaque. A transparent field joins the transparent pass and
  // can paint over strokes once their depths quantize together.
  planeMat.transparent = false;
  planeMat.depthTest = true;
  planeMat.depthWrite = true;
  fluidPlane = new THREE.Mesh(new THREE.PlaneGeometry(map.width, map.height), planeMat);
  fluidPlane.position.z = -0.01;
  fluidPlane.renderOrder = 0;
  scene.add(fluidPlane);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  const canvas = renderer.domElement;
  // Inline canvases sit on the text baseline and leave a gap that opens scrollbars.
  canvas.style.display = 'block';
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  resizeRenderer();
  document.body.appendChild(renderer.domElement);
  window.addEventListener('resize', resizeRenderer);
}

export function getCamera() {
  return camera;
}

export function startAnimation(map, getGuides) {
  _map = map;
  _getGuides = getGuides;
  if (fluidPlane) fluidPlane.visible = !map.devMode;
  renderer.setAnimationLoop(animation);
}

function animation() {
  camera.position.x = _map.camera_position_x;
  camera.position.y = _map.camera_position_y;
  camera.position.z = _map.camera_zoom;
  if (fluidPlane) fluidPlane.visible = !_map.devMode;

  // Update persistent fixture lines — create/remove only when fixture set changes
  const seenFixtures = new Set();

  for (let body = _map.world.getBodyList(); body; body = body.getNext()) {
    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
      if (body.render && body.render.hidden) continue;
      if (fixture.getType() === 'chain') continue;

      seenFixtures.add(fixture);

      if (!fixtureLines.has(fixture)) {
        const line = createFixtureLine(fixture, body);
        if (line) {
          fixtureLines.set(fixture, line);
          scene.add(line);
        }
      } else {
        updateFixtureLine(fixtureLines.get(fixture), fixture, body);
      }
    }
  }

  for (const [fixture, line] of fixtureLines) {
    if (!seenFixtures.has(fixture)) {
      scene.remove(line);
      line.geometry.dispose();
      line.material.dispose();
      fixtureLines.delete(fixture);
    }
  }

  // Update guide pool — reuse existing lines, hide extras.
  // Rule segments also get a filled stroke (WebGL lines stay 1px). Labels are HTML.
  const guides = _getGuides();
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
    if (_map.show_forces === false && r.type === 'force') continue;

    if (poolIdx >= guidePool.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, markOverlay(new THREE.LineBasicMaterial()));
      line.renderOrder = ORDER_GUIDE;
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

  renderer.render(scene, camera);

  fpsFrameCount++;
  if (fpsFrameCount % 30 === 0) {
    const now = performance.now();
    const fps = Math.round(30000 / (now - fpsLastTime));
    fpsEl.textContent = fps + ' fps';
    fpsLastTime = now;
  }
}
