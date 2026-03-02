import * as THREE from 'three';

let camera, scene, renderer;
let _map, _getGuides;

// Persistent fixture → THREE.Line mapping — only rebuilt when fixtures enter/leave the world
const fixtureLines = new Map();

// Reusable pool for guide (force arrow) lines — shown/hidden rather than created/destroyed
const guidePool = [];

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

export function initRenderer(map, planeMat) {
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 85);
  camera.position.z = 60;
  camera.position.y = 20;
  scene = new THREE.Scene();

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(map.width, map.height), planeMat);
  plane.position.z = -0.01;
  scene.add(plane);

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
  renderer.setAnimationLoop(animation);
}

function animation() {
  camera.position.x = _map.camera_position_x;
  camera.position.y = _map.camera_position_y;
  camera.position.z = _map.camera_zoom;

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

  // Update guide pool — reuse existing lines, hide extras
  const guides = _getGuides();
  let poolIdx = 0;

  for (const r of guides) {
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
    pos[0] = r.x1; pos[1] = r.y1; pos[2] = 0;
    pos[3] = r.x2; pos[4] = r.y2; pos[5] = 0;
    line.geometry.attributes.position.needsUpdate = true;
    line.material.color.setHex(r.color !== undefined ? r.color : 0xff0000);
    line.material.opacity = r.opacity !== undefined ? r.opacity : 1.0;
    line.visible = true;
    poolIdx++;
  }

  for (let i = poolIdx; i < guidePool.length; i++) {
    guidePool[i].visible = false;
  }

  renderer.render(scene, camera);
}
