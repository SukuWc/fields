import * as THREE from 'three';
import { Runner } from 'planck-renderer';

import { Boltzmann } from './boltzmann.js';
import { Map } from './map.js';
import { FluidWind, ConstantWind, windArrowSegments } from './wind.js';
import { initRenderer, startAnimation, getCamera } from './renderer.js';
import { setupControls, getPlayers, getPhysicsFrame, incrementPhysicsFrame, processKeys, executeScenarioFrame } from './controls.js';
import { installUrlSettings } from './url-settings.js';
import { sectionAOverlay, trueWindAngleDeg } from './rules.js';

const map_w = 75;
const map_h = 75;
// UI wind, and the uniform wind used while dev mode is on.
// Angle is where the wind comes from: 0 = from +X, 90 = from +Y (blows toward −Y).
// Speed is true-wind speed (the value boats report as TWS).
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
const fluidWind = new FluidWind(bm);
const constantWind = new ConstantWind(wind_angle, wind_speed);
// Domains are created dynamically in the physics loop as players spawn.
const map = new Map(map_w, map_h, wind_angle, wind_speed, bm, fluidWind, constantWind);
map.physics_model_init();

// Renderer and controls — must init renderer before controls (controls needs getCamera).
// The barrier listener has to exist before URL settings dispatch change events.
initRenderer(map, planeMat);
document.getElementById('barrier').addEventListener('change', e => bm.setBarriers(e.target.checked));
setupControls(map, getCamera, bm);
installUrlSettings();

let guides = [];
startAnimation(map, () => guides);

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
        guides.push({ color: 0x000000, type: 'guide', x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 });
      }
      pushDomainLines(domain.domains);
    }
  }
  // Dev mode leaves the lattice frozen: no domain guides, no energy injection,
  // no AMR tracking, no Boltzmann step. Boats read map.get_wind instead.
  if (!map.devMode) {
    pushDomainLines(bm.domains);
  }

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

  // Section A overlay. map.get_wind follows the active provider, so the same
  // call is constant wind in dev mode and the lattice otherwise.
  const racing = getPlayers();
  for (let i = 0; i < racing.length; i++) {
    const sample = map.get_wind(racing[i].x, racing[i].y);
    const from = sample && Number.isFinite(sample.direction) ? sample.direction : null;
    const twa = from === null ? null : trueWindAngleDeg(racing[i].hull_angle, from);
    const onto = racing[i].tacking && racing[i].tackingOnto ? ' onto ' + racing[i].tackingOnto : '';
    const twaText = twa === null ? '?' : String(Math.round(twa));
    infoEl.innerHTML += 'Boat ' + i + ' TWA ' + twaText + (racing[i].tacking ? ' tacking' + onto : '') + '<br>';
    for (let j = i + 1; j < racing.length; j++) {
      guides.push(...sectionAOverlay(racing[i], racing[j], (x, y) => map.get_wind(x, y)));
    }
  }

  // Dynamic domain placement: keep one fine domain per boat, with a level-2 domain inside.
  if (!map.devMode && document.getElementById('amr').checked) getPlayers().forEach((player, index) => {
    // A NaN body (bad sail force or a collapsed lattice sample) must not be
    // rounded into a domain corner. NaN comparisons are all false, so the
    // move check would keep a stale box, and addDomain(NaN) throws.
    if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) return;

    const cx = Math.round(bm.width/2  + player.x * bm.resolution);
    const cy = Math.round(bm.height/2 + player.y * bm.resolution);
    const cx0 = Math.max(1, cx - DOMAIN_HALF);
    const cy0 = Math.max(1, cy - DOMAIN_HALF);
    const cx1 = Math.min(bm.width  - 1, cx + DOMAIN_HALF);
    const cy1 = Math.min(bm.height - 1, cy + DOMAIN_HALF);
    if (!(cx1 > cx0 && cy1 > cy0)) return;

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
    if (!level1) return;
    const fi_f = 1 + (cx - level1.cx0) * 2;
    const fj_f = 1 + (cy - level1.cy0) * 2;
    const box = level2Box(level1, fi_f, fj_f);
    if (!box) return;

    if (level1.domains.length === 0) {
      level1.addDomain(box.x0, box.y0, box.x1, box.y1);
    } else {
      const d2 = level1.domains[0];
      if (level1Moved || fi_f < d2.cx0 + DOMAIN2_MARGIN || fi_f > d2.cx1 - DOMAIN2_MARGIN ||
          fj_f < d2.cy0 + DOMAIN2_MARGIN || fj_f > d2.cy1 - DOMAIN2_MARGIN) {
        level1.moveDomain(0, box.x0, box.y0, box.x1, box.y1);
      }
    }
  }); // end AMR block

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
