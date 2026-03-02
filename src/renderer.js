import * as THREE from 'three';

let camera, scene, renderer;
let polygons = [];
let arrows = [];

let _map, _getGuides;

export function initRenderer(map, planeMat) {
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 85);
  camera.position.z = 60;
  camera.position.y = 20;
  scene = new THREE.Scene();

  const geometry = new THREE.PlaneGeometry(map.width, map.height);
  let plane = new THREE.Mesh(geometry, planeMat);
  plane.position.x = 0;
  plane.position.y = 0;
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

function animation(time) {
  camera.position.x = _map.camera_position_x;
  camera.position.y = _map.camera_position_y;
  camera.position.z = _map.camera_zoom;

  for (let element of polygons) {
    scene.remove(element);
    element.geometry.dispose();
    element.material.dispose();
    element = undefined;
  }

  for (let element of arrows) {
    scene.remove(element);
    if (element.geometry.dispose !== undefined) element.geometry.dispose();
    if (element.material.dispose !== undefined) element.material.dispose();
    element = undefined;
  }

  polygons = [];
  arrows = [];

  for (let body = _map.world.getBodyList(); body; body = body.getNext()) {
    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {

      if (body.render && body.render.hidden) continue;

      const type = fixture.getType();
      const shape = fixture.getShape();

      if (type === "circle") {
        const radius = shape.m_radius;
        const pos = body.getPosition();
        let points = [];
        for (let i = 0; i < 360; i += 10) {
          const angle = i / 180 * Math.PI;
          points.push(new THREE.Vector3(radius * Math.cos(angle) + pos.x, radius * Math.sin(angle) + pos.y, 0));
        }
        points.push(points[0]);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color: 0x00ff00 });
        polygons.push(new THREE.Line(geometry, material));
        scene.add(polygons[polygons.length - 1]);
      }

      if (type === "edge") {
        const v1 = shape.m_vertex1;
        const v2 = shape.m_vertex2;
        const x1 = v1.x + body.m_xf.p.x;
        const y1 = v1.y + body.m_xf.p.y;
        const x2 = v2.x + body.m_xf.p.x;
        const y2 = v2.y + body.m_xf.p.y;
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x1, y1, 0),
          new THREE.Vector3(x2, y2, 0)
        ]);
        const material = new THREE.LineBasicMaterial({ color: 0xff0000 });
        polygons.push(new THREE.Line(geometry, material));
        scene.add(polygons[polygons.length - 1]);
      }

      if (type === "polygon") {
        const vertices = [...shape.m_vertices, shape.m_vertices[0]];
        let points = [];
        const angle = body.getAngle() + Math.PI;
        const com = body.getLocalCenter();
        for (const v of vertices) {
          let x = (v.x + com.x) * Math.cos(angle) + (v.y - com.y) * Math.sin(angle);
          let y = (v.x + com.x) * Math.sin(angle) - (v.y - com.y) * Math.cos(angle);
          x += fixture.m_body.c_position.c.x;
          y += fixture.m_body.c_position.c.y;
          points.push(new THREE.Vector3(x, y, 0));
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color: 0x0000ff });
        polygons.push(new THREE.Line(geometry, material));
        scene.add(polygons[polygons.length - 1]);
      }
    }
  }

  const guides = _getGuides();
  for (const r of guides) {
    if (_map.show_forces === false && r.type === "force") continue;

    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(r.x1, r.y1, 0),
      new THREE.Vector3(r.x2, r.y2, 0)
    ]);
    const color = r.color !== undefined ? r.color : 0xff0000;
    const material = r.opacity !== undefined
      ? new THREE.LineBasicMaterial({ color, transparent: true, opacity: r.opacity })
      : new THREE.LineBasicMaterial({ color });

    polygons.push(new THREE.Line(geometry, material));
    scene.add(polygons[polygons.length - 1]);
  }

  renderer.render(scene, camera);
}
