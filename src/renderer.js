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
const ruleLabelPool = [];
const abeamPool = [];
const _labelPoint = new THREE.Vector3();

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
  const material = new THREE.LineBasicMaterial({ color: colorByType[type] });
  const line = new THREE.Line(geometry, material);

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
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      depthTest: false,
    }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
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
    const line = new THREE.Line(geo, new THREE.LineDashedMaterial({
      color: 0x66eeff,
      dashSize: 0.45,
      gapSize: 0.28,
      depthTest: false,
    }));
    line.frustumCulled = false;
    line.renderOrder = 3;
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

function renderRuleLabels(labels) {
  const layer = document.getElementById('rule_labels');
  if (!layer) return;

  camera.updateMatrixWorld();
  const width = renderer.domElement.clientWidth;
  const height = renderer.domElement.clientHeight;

  for (let i = 0; i < labels.length; i++) {
    let el = ruleLabelPool[i];
    if (!el) {
      el = document.createElement('div');
      el.className = 'rule-label';
      layer.appendChild(el);
      ruleLabelPool.push(el);
    }
    const label = labels[i];
    _labelPoint.set(label.x, label.y, 0.2);
    _labelPoint.project(camera);
    const onScreen = _labelPoint.z >= -1 && _labelPoint.z <= 1;
    if (!onScreen) {
      el.style.display = 'none';
      continue;
    }
    if (label.rule15) {
      const progress = Math.max(0, Math.min(1, Number(label.progress) || 0));
      el.className = 'rule-label rule-label-15';
      let text = el.querySelector('.rule-label-text');
      let fill = el.querySelector('.rule15-fill');
      if (!text || !fill) {
        el.textContent = '';
        text = document.createElement('div');
        text.className = 'rule-label-text';
        const track = document.createElement('div');
        track.className = 'rule15-track';
        fill = document.createElement('div');
        fill.className = 'rule15-fill';
        track.appendChild(fill);
        el.appendChild(text);
        el.appendChild(track);
      }
      text.textContent = label.text;
      fill.style.transform = 'scaleX(' + progress + ')';
    } else {
      el.className = 'rule-label';
      el.textContent = label.text;
    }
    el.style.display = 'block';
    el.style.left = ((_labelPoint.x * 0.5 + 0.5) * width) + 'px';
    el.style.top = ((-_labelPoint.y * 0.5 + 0.5) * height) + 'px';
  }

  for (let i = labels.length; i < ruleLabelPool.length; i++) {
    ruleLabelPool[i].style.display = 'none';
  }
}

export function initRenderer(map, planeMat) {
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 85);
  camera.position.z = 60;
  camera.position.y = 20;
  scene = new THREE.Scene();

  fluidPlane = new THREE.Mesh(new THREE.PlaneGeometry(map.width, map.height), planeMat);
  fluidPlane.position.z = -0.01;
  scene.add(fluidPlane);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);
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

  for (const r of guides) {
    if (r.type === 'label') {
      ruleLabels.push(r);
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
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ transparent: true }));
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
