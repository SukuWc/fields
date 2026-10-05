import * as THREE from 'three';
import { Runner } from 'planck-renderer';

import { Boltzmann } from './boltzmann.js';
import { Map } from './map.js';
import { FluidWind, ConstantWind, windArrowSegments } from './wind.js';
import { initRenderer, startAnimation, getCamera } from './renderer.js';
import { setupControls, getPlayers, getPhysicsFrame, incrementPhysicsFrame, processKeys, executeScenarioFrame } from './controls.js';

const map_w = 75;
const map_h = 75;
// UI wind, and the uniform wind used while dev mode is on.
// Angle is where the wind comes from: 0 = from +X, 90 = from +Y (blows toward −Y).
// Speed is true-wind speed (the value boats report as TWS).
const wind_angle = 90;
const wind_speed = 15;
const bm_resolution = 1;
const texture_oversampling = 4;

// Fine domain tracking: half-width in coarse cells. The window steps one cell at a time
// once the boat is more than SHIFT_THRESHOLD cells from the window center.
const SAIL_EFFICIENCY = 0.0003 * bm_resolution; // scales sail aerodynamic force → fluid momentum transfer

const DOMAIN_HALF     = 20;
const DOMAIN2_HALF    = 20; // half-width of level-2 window in level-1 fine cell coords
const SHIFT_THRESHOLD = 1;  // one cell: half a cell of rounding plus half a cell of hysteresis
// Disks sit inside those windows. The margin leaves the 1D cubic (Eq. 38) a
// couple of parent cells of real neighbours. Level 2 is the smaller disk.
const DISK_RADIUS     = 16; // coarse cells
const DISK2_RADIUS    = 16; // level-1 fine cells (8 coarse)

// One axis, one cell. Refused when the step would enter the Dirichlet frame.
function shiftToward(posX, posY, domain, gridW, gridH) {
  const centerX = (domain.cx0 + domain.cx1) / 2;
  const centerY = (domain.cy0 + domain.cy1) / 2;
  let dcx = 0, dcy = 0;
  if (posX - centerX > SHIFT_THRESHOLD) dcx = 1;
  else if (centerX - posX > SHIFT_THRESHOLD) dcx = -1;
  else if (posY - centerY > SHIFT_THRESHOLD) dcy = 1;
  else if (centerY - posY > SHIFT_THRESHOLD) dcy = -1;
  if (domain.cx0 + dcx < 1 || domain.cx1 + dcx > gridW - 1) dcx = 0;
  if (domain.cy0 + dcy < 1 || domain.cy1 + dcy > gridH - 1) dcy = 0;
  return { dcx, dcy };
}

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
const fluidWind = new FluidWind(bm);
const constantWind = new ConstantWind(wind_angle, wind_speed);
// Domains are created dynamically in the physics loop as players spawn.
const map = new Map(map_w, map_h, wind_angle, wind_speed, bm, fluidWind, constantWind);
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

// Level-2 box in the parent's fine-cell coordinates. The parent is clamped to
// the lattice, so a boat past the wall maps outside it and fi±HALF can invert
// (fi2_1 < fi2_0). That used to call addDomain with a negative size and throw.
function level2Box(parent, fi, fj) {
  if (!parent || !(parent.width >= 4) || !(parent.height >= 4)) return null;
  if (!Number.isFinite(fi) || !Number.isFinite(fj)) return null;
  const x0 = Math.max(1, Math.min(parent.width - 3, Math.round(fi - DOMAIN2_HALF)));
  const y0 = Math.max(1, Math.min(parent.height - 3, Math.round(fj - DOMAIN2_HALF)));
  const x1 = Math.max(x0 + 2, Math.min(parent.width - 1, Math.round(fi + DOMAIN2_HALF)));
  const y1 = Math.max(y0 + 2, Math.min(parent.height - 1, Math.round(fj + DOMAIN2_HALF)));
  if (!(x1 > x0 && y1 > y0 && x1 < parent.width && y1 < parent.height)) return null;
  return { x0, y0, x1, y1 };
}

runner.start(() => {
  guides = [];

  function pushDomainLines(domains) {
    for (const domain of domains) {
      for (const seg of domain.worldBorderLines(bm)) {
        guides.push({
          color: seg.dim ? 0x8899aa : 0x000000,
          opacity: seg.dim ? 0.35 : 1,
          type: 'guide',
          x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2,
        });
      }
      pushDomainLines(domain.domains);
    }
  }
  // Dev mode leaves the lattice frozen: no energy injection, no AMR tracking,
  // no Boltzmann step. Boats read map.get_wind instead. Disk guides are drawn
  // after the windows move, so they match this frame's boat.

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

    if (!map.devMode && document.getElementById('boat_energy').checked) {
      for (const seg of player.getSailSegments()) {
        map.bm.apply_energy_segment(seg.x0, seg.y0, seg.x1, seg.y1,
          seg.fx * SAIL_EFFICIENCY, seg.fy * SAIL_EFFICIENCY);
      }
    }

    infoEl.innerHTML += "Phys Time: " + bm.t_delta + "<br>";
  });

  // Dynamic domain placement: one reusable window per boat, a disk mask inside it,
  // and a smaller level-2 disk carried with the level-1 window. The window slides
  // one parent cell per frame. A level-1 slide carries level 2.
  // Dev mode leaves the lattice frozen. A NaN body must not be rounded into a domain corner.
  if (!map.devMode && document.getElementById('amr').checked) getPlayers().forEach((player, index) => {
    if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) return;
    const boatCx = bm.width/2  + player.x * bm.resolution;
    const boatCy = bm.height/2 + player.y * bm.resolution;

    let level1Shifted = false;
    const outside = (domain, x, y) => !domain
      || x < domain.cx0 || y < domain.cy0 || x >= domain.cx1 || y >= domain.cy1;
    let level1 = bm.domains[index];
    if (outside(level1, boatCx, boatCy)) {
      // One new window on the boat. Crawling the old one would keep a ring
      // where the boat used to be (scenario restart, or a boat past the edge).
      const cx = Math.round(boatCx);
      const cy = Math.round(boatCy);
      const cx0 = Math.max(1, cx - DOMAIN_HALF);
      const cy0 = Math.max(1, cy - DOMAIN_HALF);
      const cx1 = Math.min(bm.width  - 1, cx + DOMAIN_HALF);
      const cy1 = Math.min(bm.height - 1, cy + DOMAIN_HALF);
      if (!(cx1 > cx0 && cy1 > cy0)) return;
      level1 = bm.replaceDomain(index, cx0, cy0, cx1, cy1);
      if (!level1) return;
    } else {
      const step = shiftToward(boatCx, boatCy, level1, bm.width, bm.height);
      if (step.dcx || step.dcy) {
        bm.shiftDomain(index, step.dcx, step.dcy);
        level1Shifted = true;
      }
    }

    // Level-1 disk follows the boat inside the window. The mask, not the rectangle, is the refined region.
    if (!level1) return;
    level1.setDisk(boatCx, boatCy, DISK_RADIUS);

    // Level-2 domain, in level-1 fine cell coords. Skipped on a level-1 slide:
    // that slide already carried this window, and the boat's fine coordinate moved with it.
    const fx = 1 + (boatCx - level1.cx0) * 2;
    const fy = 1 + (boatCy - level1.cy0) * 2;
    if (level1.domains.length === 0 || outside(level1.domains[0], fx, fy)) {
      const box = level2Box(level1, fx, fy);
      if (!box) return;
      level1.replaceDomain(0, box.x0, box.y0, box.x1, box.y1);
    } else if (!level1Shifted) {
      const d2 = level1.domains[0];
      const step2 = shiftToward(fx, fy, d2, level1.width, level1.height);
      if (step2.dcx || step2.dcy) {
        d2.shiftBy(level1, step2.dcx, step2.dcy);
        level1._rebuildInteriorCells();
      }
    }
    if (level1.domains[0]) level1.domains[0].setDisk(fx, fy, DISK2_RADIUS);
  }); // end AMR block

  // Extra windows (a restart that removed a boat) would keep drawing a ring.
  if (!map.devMode && bm.domains.length > getPlayers().length) {
    bm.domains.length = getPlayers().length;
    bm._rebuildInteriorCells();
  }
  if (!map.devMode) pushDomainLines(bm.domains);

  if (map.devMode) {
    const wind = map.get_wind(0, 0);
    // wind.direction is where the wind comes from. The arrow points downwind,
    // along (vx, vy), matching the lattice flow and the sail-drag push.
    const flowDeg = Math.atan2(wind.vy, wind.vx) * 180 / Math.PI;
    const ox = map.camera_position_x - 14;
    const oy = map.camera_position_y + 4;
    for (const seg of windArrowSegments(ox, oy, flowDeg, 8)) {
      guides.push({ color: 0x66eeff, type: 'guide', x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 });
    }
  } else {
    map.bm.physics_model_step();
  }

  incrementPhysicsFrame();

  if (!map.devMode && bm.step_ready) {
    dataTextureMaterial.needsUpdate = true;
    bm.step_ready = false;
  }

}, () => {});
