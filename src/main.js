import * as THREE from 'three';
import { Runner } from 'planck-renderer';

import { Boltzmann } from './boltzmann.js';
import { Map } from './map.js';
import { initRenderer, startAnimation, getCamera } from './renderer.js';
import { setupControls, getPlayers, getPhysicsFrame, incrementPhysicsFrame, processKeys, executeScenarioFrame } from './controls.js';

const map_w = 75;
const map_h = 75;
const wind_angle = 90;
const wind_speed = 15;
const bm_resolution = 1;
const texture_oversampling = 4;

// Fine domain tracking: half-width in coarse cells, and margin before triggering a move.
const SAIL_EFFICIENCY = 0.0003 * bm_resolution; // scales sail aerodynamic force → fluid momentum transfer

const DOMAIN_HALF    = 20;
const DOMAIN_MARGIN  = 10;
const DOMAIN2_HALF   = 20; // half-width of level-2 domain in level-1 fine cell coords
const DOMAIN2_MARGIN = 10;

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
// Domains are created dynamically in the physics loop as players spawn.
const map = new Map(map_w, map_h, wind_angle, wind_speed, bm);
map.physics_model_init();

// Renderer and controls — must init renderer before controls (controls needs getCamera)
initRenderer(map, planeMat);
setupControls(map, getCamera, bm);

let guides = [];
startAnimation(map, () => guides);

document.getElementById('barrier').addEventListener('change', e => bm.setBarriers(e.target.checked));

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

    if (document.getElementById('boat_energy').checked) {
      for (const seg of player.getSailSegments()) {
        map.bm.apply_energy_segment(seg.x0, seg.y0, seg.x1, seg.y1,
          seg.fx * SAIL_EFFICIENCY, seg.fy * SAIL_EFFICIENCY);
      }
    }

    infoEl.innerHTML += "Phys Time: " + bm.t_delta + "<br>";
  });

  // Dynamic domain placement: keep one fine domain per boat, with a level-2 domain inside.
  if (document.getElementById('amr').checked) getPlayers().forEach((player, index) => {
    const cx = Math.round(bm.width/2  + player.x * bm.resolution);
    const cy = Math.round(bm.height/2 + player.y * bm.resolution);
    const cx0 = Math.max(1, cx - DOMAIN_HALF);
    const cy0 = Math.max(1, cy - DOMAIN_HALF);
    const cx1 = Math.min(bm.width  - 1, cx + DOMAIN_HALF);
    const cy1 = Math.min(bm.height - 1, cy + DOMAIN_HALF);

    let level1Moved = false;
    if (index >= bm.domains.length) {
      bm.addDomain(cx0, cy0, cx1, cy1);
      level1Moved = true;
    } else {
      const d = bm.domains[index];
      if (cx < d.cx0 + DOMAIN_MARGIN || cx > d.cx1 - DOMAIN_MARGIN ||
          cy < d.cy0 + DOMAIN_MARGIN || cy > d.cy1 - DOMAIN_MARGIN) {
        bm.moveDomain(index, cx0, cy0, cx1, cy1);
        level1Moved = true;
      }
    }

    // Level-2 domain: boat position in level-1 fine cell coords.
    const level1 = bm.domains[index];
    const fi_f = 1 + (cx - level1.cx0) * 2;
    const fj_f = 1 + (cy - level1.cy0) * 2;
    const fi2_0 = Math.max(1, fi_f - DOMAIN2_HALF);
    const fj2_0 = Math.max(1, fj_f - DOMAIN2_HALF);
    const fi2_1 = Math.min(level1.width  - 1, fi_f + DOMAIN2_HALF);
    const fj2_1 = Math.min(level1.height - 1, fj_f + DOMAIN2_HALF);

    if (level1Moved || level1.domains.length === 0) {
      level1.addDomain(fi2_0, fj2_0, fi2_1, fj2_1);
    } else {
      const d2 = level1.domains[0];
      if (fi_f < d2.cx0 + DOMAIN2_MARGIN || fi_f > d2.cx1 - DOMAIN2_MARGIN ||
          fj_f < d2.cy0 + DOMAIN2_MARGIN || fj_f > d2.cy1 - DOMAIN2_MARGIN) {
        level1.moveDomain(0, fi2_0, fj2_0, fi2_1, fj2_1);
      }
    }
  }); // end AMR block

  map.bm.physics_model_step();

  incrementPhysicsFrame();

  if (bm.step_ready) {
    dataTextureMaterial.needsUpdate = true;
    bm.step_ready = false;
  }

}, () => {});
