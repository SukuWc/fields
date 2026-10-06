import * as THREE from 'three';
import { Runner } from 'planck-renderer';

import { Boltzmann, unionMaskBorderLines } from './boltzmann.js';
import { trackBoats } from './domainTrack.js';
import { Map } from './map.js';
import { FluidWind, ConstantWind, windArrowSegments } from './wind.js';
import { initRenderer, startAnimation, getCamera } from './renderer.js';
import { setupControls, getPlayers, incrementPhysicsFrame, processKeys, executeScenarioFrame } from './controls.js';
import { installUrlSettings } from './url-settings.js';
import { beginRule15Step, contactGuides, evaluateAllPairs, recordContacts, trueWindAngleDeg } from './rules.js';

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

// Physics loop. Rule 15's room window uses this clock, not wall time.
// Runner.step is 1/30 s and is passed in only when world.step actually ran.
// The same callback also fires once per animation frame with no argument;
// that redraw must not move the clock (a pause, or a slow frame, neither
// grants room nor eats it).
const runner = new Runner(map.world, { speed: 1, fps: 30 });
let rulesTime = 0;

runner.start((simDt) => {
  if (typeof simDt === 'number' && Number.isFinite(simDt) && simDt > 0) rulesTime += simDt;
  beginRule15Step(rulesTime);
  guides = [];

  // Smooth circle per boat. The light staircase is the union of every mask at
  // that level, so overlapping boats share one border and separate boats keep
  // one island each. A rectangle with no disk still uses its four sides.
  function pushRefinementGuides(domains) {
    const masked = [];
    for (const domain of domains) {
      for (const seg of domain.worldBorderLines(bm)) {
        if (domain.disk && seg.dim) continue;
        guides.push({
          color: seg.dim ? 0x8899aa : 0x000000,
          opacity: seg.dim ? 0.35 : 1,
          type: 'guide',
          x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2,
        });
      }
      if (domain.disk) masked.push(domain);
    }
    for (const seg of unionMaskBorderLines(masked, bm)) {
      // Full-opacity light line: the 0.35 gray sat on the dark speed field
      // and the merged border could not be told from the black per-boat circles.
      guides.push({
        color: 0x9ad0ff,
        opacity: 1,
        type: 'guide',
        x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2,
      });
    }
    const children = [];
    for (const domain of domains) children.push(...domain.domains);
    if (children.length) pushRefinementGuides(children);
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

  // Rules overlay. map.get_wind follows the active provider, so the same
  // call is constant wind in dev mode and the lattice otherwise. Every
  // unordered pair inside 12 m is evaluated; nothing here assumes two boats.
  const racing = getPlayers();
  for (let i = 0; i < racing.length; i++) {
    const sample = map.get_wind(racing[i].x, racing[i].y);
    const from = sample && Number.isFinite(sample.direction) ? sample.direction : null;
    const twa = from === null ? null : trueWindAngleDeg(racing[i].hull_angle, from);
    const onto = racing[i].tacking && racing[i].tackingOnto ? ' onto ' + racing[i].tackingOnto : '';
    const twaText = twa === null ? '?' : String(Math.round(twa));
    infoEl.innerHTML += 'Boat ' + i + ' TWA ' + twaText + (racing[i].tacking ? ' tacking' + onto : '') + '<br>';
  }
  const getWind = (x, y) => map.get_wind(x, y);
  const resolutions = evaluateAllPairs(racing, getWind, rulesTime);
  for (let i = 0; i < resolutions.length; i++) {
    const pairGuides = resolutions[i].guides;
    if (pairGuides && pairGuides.length) guides.push(...pairGuides);
  }
  recordContacts(resolutions, rulesTime, racing);
  guides.push(...contactGuides());

  // Dynamic domain placement: one reusable window per boat, a disk mask inside it,
  // and a smaller level-2 disk carried with the level-1 window. The window slides
  // one parent cell per frame. A level-1 slide carries level 2.
  // Dev mode leaves the lattice frozen. A NaN body must not be rounded into a domain corner.
  if (!map.devMode && document.getElementById('amr').checked) trackBoats(bm, getPlayers());

  // AMR off: a restart that removed a boat would keep drawing a ring.
  // AMR on: trackBoats already installed exactly the live boats, in player order.
  if (!map.devMode && !document.getElementById('amr').checked && bm.domains.length > getPlayers().length) {
    bm.domains.length = getPlayers().length;
    bm._rebuildInteriorCells();
  }
  if (!map.devMode) pushRefinementGuides(bm.domains);

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
