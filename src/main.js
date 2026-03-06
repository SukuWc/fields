import * as THREE from 'three';
import { Runner } from 'planck-renderer';

import { Boltzmann } from './boltzmann.js';
import { Map } from './map.js';
import { initRenderer, startAnimation, getCamera } from './renderer.js';
import { setupControls, getPlayers, getPhysicsFrame, incrementPhysicsFrame, processKeys, executeScenarioFrame } from './controls.js';

const map_w = 50;
const map_h = 50;
const wind_angle = 90;
const wind_speed = 15;
const bm_resolution = 2;
const texture_oversampling = 4;

// Data texture for fluid field visualisation
const _side1 = texture_oversampling * map_w * bm_resolution;
const _side2 = texture_oversampling * map_h * bm_resolution;
const _data1 = new Uint8Array(_side1 * _side2 * 4);
const dataTextureMaterial = new THREE.DataTexture(_data1, _side1, _side2, THREE.RGBAFormat, THREE.UnsignedByteType);
dataTextureMaterial.magFilter = THREE.NearestFilter;
dataTextureMaterial.needsUpdate = true;

const planeMat = new THREE.MeshBasicMaterial({ map: dataTextureMaterial, transparent: true });
planeMat.needsUpdate = true;

// Core simulation instances
const bm = new Boltzmann(map_w, map_h, bm_resolution, wind_angle, wind_speed, dataTextureMaterial, texture_oversampling);
bm.addDomain(10, 10, 90, 90);
bm.domains[0].addDomain(40, 40, 120, 120); // level-2 domain, coords in level-1 fine cell space
const map = new Map(map_w, map_h, wind_angle, wind_speed, bm);
map.physics_model_init();

// Renderer and controls — must init renderer before controls (controls needs getCamera)
initRenderer(map, planeMat);
setupControls(map, getCamera, bm);

let guides = [];
startAnimation(map, () => guides);

const infoEl = document.getElementById('info');
const distInfoEl = document.getElementById('dist_info');

// Physics loop
const runner = new Runner(map.world, { speed: 1, fps: 30 });

runner.start(() => {
  guides = [];

  function pushDomainLines(domains) {
    for (const domain of domains) {
      for (const seg of domain.worldBorderLines(bm)) {
        guides.push({ color: 0x000000, type: 'guide', x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 });
      }
      pushDomainLines(domain.domains);
    }
  }
  pushDomainLines(bm.domains);

  executeScenarioFrame();
  processKeys();

  map.set_camera_follow_target(getPlayers()[0]);
  map.physics_model_step();

  let sumOfPlayerDistances = 0;

  getPlayers().forEach((player, index) => {
    getPlayers().forEach((player2, index2) => {
      if (index2 > index) {
        const dx = player.x - player2.x;
        const dy = player.y - player2.y;
        sumOfPlayerDistances += Math.sqrt(dx * dx + dy * dy);
        distInfoEl.innerHTML = "Dist: " + Math.floor(sumOfPlayerDistances * 100) / 100 + "<br>";
      }
    });

    player.physics_model_step();
    guides.push(...player.graphics_model_render());

    const wind_angle_rad = (player.awa) / 180 * Math.PI + player.hull_angle - Math.PI / 2;
    const offset = 1.5;

    const px0 = player.x + Math.cos(player.hull_angle + 90 / 180 * Math.PI) * (-offset) + Math.cos(wind_angle_rad) * (-2);
    const py0 = player.y + Math.sin(player.hull_angle + 90 / 180 * Math.PI) * (-offset) + Math.sin(wind_angle_rad) * (-2);
    const px1 = player.x + Math.cos(player.hull_angle + 90 / 180 * Math.PI) * 0      + Math.cos(wind_angle_rad) * (-2);
    const py1 = player.y + Math.sin(player.hull_angle + 90 / 180 * Math.PI) * 0      + Math.sin(wind_angle_rad) * (-2);
    const px2 = player.x + Math.cos(player.hull_angle + 90 / 180 * Math.PI) * (+offset) + Math.cos(wind_angle_rad) * (-2);
    const py2 = player.y + Math.sin(player.hull_angle + 90 / 180 * Math.PI) * (+offset) + Math.sin(wind_angle_rad) * (-2);

    map.bm.apply_energy(px0, py0, player.power_direction, player.power / 5000);
    map.bm.apply_energy(px1, py1, player.power_direction, player.power / 2000);
    map.bm.apply_energy(px2, py2, player.power_direction, player.power / 5000);

    infoEl.innerHTML += "Phys Time: " + bm.t_delta + "<br>";
  });

  map.bm.physics_model_step();

  incrementPhysicsFrame();

  if (bm.step_ready) {
    dataTextureMaterial.needsUpdate = true;
    bm.step_ready = false;
  }

}, () => {});
