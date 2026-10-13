import * as THREE from 'three';
import { Runner } from 'planck-renderer';

import { Boltzmann, unionMaskBorderLines } from './boltzmann.js';
import { trackBoats, resetTracking } from './domainTrack.js';
import { Map } from './map.js';
import { FluidWind, ConstantWind, windArrowSegments } from './wind.js';
import { initRenderer, startAnimation, getCamera, setFluidPlaneSize } from './renderer.js';
import { setupControls, getPlayers, getMarks, getCourse, getStartSequence, incrementPhysicsFrame, processKeys, executeScenarioFrame } from './controls.js';
import { installUrlSettings } from './url-settings.js';
import { courseGuides, courseText, markRoomTarget } from './course.js';
import { startGuides, startHudHtml, startStatusText } from './start.js';
import { recordMarkTouches, markTouchGuides } from './mark-touch.js';
import { setupPerfOverlay, isPerfOverlayOn, recordFieldStep } from './perf-overlay.js';
import { setupMobileMenu } from './mobile-menu.js';
import { setupTouchControls } from './touch-controls.js';

import { SAIL_LATTICE_COUPLING } from './boat.js';

import { beginRule15Step, contactGuides, evaluateAllPairs, penaltyAutopilotRemainingDeg, penaltyGuides, penaltyJustCleared, penaltyManeuverText, penaltyManeuverView, pendingPenaltyCount, pendingPenaltyReason, recordContacts, markRoomGuides, trueWindAngleDeg } from './rules.js';


// Map side in metres. ?mapSize=150 doubles both sides (4× the area); the
// #mapSize select reloads the page with that param. Default 75.
const MAP_SIZES = [75, 150];
const _mapSizeParam = Number(new URLSearchParams(location.search).get('mapSize'));
const map_w = MAP_SIZES.includes(_mapSizeParam) ? _mapSizeParam : 75;
const map_h = map_w;
// UI wind, and the uniform wind used while dev mode is on.
// Angle is where the wind comes from: 0 = from +X, 90 = from +Y (blows toward −Y).
// Speed is true-wind speed (the value boats report as TWS).
const wind_angle = 90;
const wind_speed = 15;
const bm_resolution = 1;
// Level 3 cells are dx = 0.125. The speed plot stamps oversampling*dx pixels,
// and a fractional stamp collapses several fine nodes onto one texel (the
// coarse blocks inside the inner disk). 8 lands each level-3 node on one texel.
const texture_oversampling = 8;

// Sail reaction → lattice momentum. See SAIL_LATTICE_COUPLING. A root cell
// holds cellSize² world units of fluid (ρ and lattice u keep their physical
// scale at every resolution, see Boltzmann.setResolution), so the same
// physical momentum per frame is SAIL_LATTICE_COUPLING × resolution² in
// lattice units: 1 at Default, 1/4 at x2, 1/16 at x4. Kicks on frames with no
// lattice step are kept until the next one, so the per-frame total holds.
// On a fast-wind grid lattice velocity is velScale × smaller per unit of
// physical wind, so the same physical momentum is velScale × fewer lattice
// units: divide by it.
function sailEfficiency() {
  const e = SAIL_LATTICE_COUPLING * bm.resolution * bm.resolution;
  return bm.velScale === undefined || bm.velScale === 1 ? e : e / bm.velScale;
}

// Data texture for fluid field visualisation
const _side1 = texture_oversampling * map_w * bm_resolution;
const _side2 = texture_oversampling * map_h * bm_resolution;
const _data1 = new Uint8Array(_side1 * _side2 * 4);
const dataTextureMaterial = new THREE.DataTexture(_data1, _side1, _side2, THREE.RGBAFormat, THREE.UnsignedByteType);
dataTextureMaterial.magFilter = THREE.NearestFilter;
dataTextureMaterial.needsUpdate = true;

const planeMat = new THREE.MeshBasicMaterial({ map: dataTextureMaterial });
planeMat.needsUpdate = true;

// Core simulation instances
const bm = new Boltzmann(map_w, map_h, bm_resolution, wind_angle, wind_speed, dataTextureMaterial, texture_oversampling);
const fluidWind = new FluidWind(bm);
const constantWind = new ConstantWind(wind_angle, wind_speed);
// Domains are created dynamically in the physics loop as players spawn.
const map = new Map(map_w, map_h, wind_angle, wind_speed, bm, fluidWind, constantWind);
map.physics_model_init();
if (map_w !== 75) {
  // Camera pan limits: ±30 on the 75 m map, the same 7.5 m margin on larger ones.
  const lim = (map_w - 15) / 2;
  map.camera_position_x_max = lim; map.camera_position_y_max = lim;
  map.camera_position_x_min = -lim; map.camera_position_y_min = -lim;
  // Zoom out far enough to see most of the map; the camera far plane is 85.
  map.camera_zoom_max = 80;
}

// Renderer and controls — must init renderer before controls (controls needs getCamera).
// The barrier listener has to exist before URL settings dispatch change events.
initRenderer(map, planeMat);
document.getElementById('barrier').addEventListener('change', e => bm.setBarriers(e.target.checked));
setFluidPlaneSize(bm.latticeWorldWidth, bm.latticeWorldHeight);
setupControls(map, getCamera, bm);
// Simulation resolution (#simRes, ?simRes=2 / 4). Rebuilds the root lattice
// in place (every module keeps the same bm), drops the refinement windows,
// resizes the field plane, and restarts the scenario like the Restart button.
// Before installUrlSettings so a query value goes through this listener.
// Fast-wind options ("2f", "2f34") use the x2 root cell but step it every
// frame (or 1.2× per frame): stepsPerFrame is explicit, see Boltzmann._build.
export const SIM_RES_MODES = {
  '1': { resolution: 1 }, '2': { resolution: 0.5 }, '4': { resolution: 0.25 },
  '2f': { resolution: 0.5, stepsPerFrame: 1 }, '2f34': { resolution: 0.5, stepsPerFrame: 1.2 },
};
document.getElementById('simRes').addEventListener('change', (e) => {
  const mode = SIM_RES_MODES[e.target.value] || SIM_RES_MODES['1'];
  const steps = mode.stepsPerFrame ?? mode.resolution;
  if (mode.resolution === bm.resolution && steps === bm.stepsPerFrame) return;
  resetTracking(bm, getPlayers());
  bm.setResolution(mode.resolution, mode.stepsPerFrame);
  bm.setWindSpeed(map.wind_speed);
  setFluidPlaneSize(bm.latticeWorldWidth, bm.latticeWorldHeight);
  dataTextureMaterial.needsUpdate = true;
  document.getElementById('scenario_restart').click();
});
document.getElementById('mapSize').addEventListener('change', (e) => {
  const v = Number(e.target.value);
  if (v === map_w || !MAP_SIZES.includes(v)) return;
  const u = new URL(location.href);
  if (v === 75) u.searchParams.delete('mapSize'); else u.searchParams.set('mapSize', String(v));
  location.href = u.toString();
});
// Refinement layout (#amrMode, ?amrMode=auto; ?amr=auto is accepted too).
// "auto": only the finest boat disk is fixed and every coarser level is a
// grading shell plus curl growth (domainTrack AUTO_SHELL). Restarts.
{
  const sel = document.getElementById('amrMode');
  const q = new URLSearchParams(location.search);
  if (q.get('amr') === 'auto') {
    q.delete('amr'); q.set('amrMode', 'auto');
    history.replaceState(history.state, '', location.pathname + '?' + q.toString() + location.hash);
  }
  sel.addEventListener('change', (e) => {
    const mode = e.target.value === 'auto' ? 'auto' : 'fixed';
    if ((bm.amrMode || 'fixed') === mode) return;
    resetTracking(bm, getPlayers());
    bm.amrMode = mode;
    bm.setResolution(bm.resolution, bm.stepsPerFrame === bm.resolution ? undefined : bm.stepsPerFrame);
    bm.setWindSpeed(map.wind_speed);
    dataTextureMaterial.needsUpdate = true;
    document.getElementById('scenario_restart').click();
  });
}
// Before installUrlSettings so ?perf=1 turns the overlay on through its change listener.
setupPerfOverlay(map, bm);
// Before installUrlSettings: the device default must be the checkbox default.
setupTouchControls();
installUrlSettings();
setupMobileMenu();

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

  // Smooth circle per boat disk. A field island has a mask and no disk, so
  // only its staircase is drawn. The light staircase is the union of every
  // mask at that level: overlapping boats share one border, and a detached
  // curl island keeps its own outline. A rectangle with no disk and no mask
  // still uses its four sides.
  function pushRefinementGuides(domains) {
    const masked = [];
    for (const domain of domains) {
      if (domain.mask && !domain.disk) {
        masked.push(domain);
        continue;
      }
      // Auto layout: only the finest boat level has a fixed disk. A coarser
      // level's disk is just its grading-shell floor, so its circle is not
      // drawn; its real extent is the mask outline below.
      const shellOnly = bm.amrMode === 'auto' && domain.disk && domain.domains.length > 0;
      for (const seg of shellOnly ? [] : domain.worldBorderLines(bm)) {
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
      const eff = sailEfficiency();
      for (const seg of player.getSailSegments()) {
        map.bm.apply_energy_segment(seg.x0, seg.y0, seg.x1, seg.y1,
          seg.fx * eff, seg.fy * eff);
      }
    }

    infoEl.innerHTML += "Phys Time: " + bm.t_delta + "<br>";
  });

  // Marks: anchor spring + damper once per world.step (planck clears forces
  // after each step), drawn every frame. Marks are not boats, so they stay
  // out of the rules overlay below.
  const stepped = typeof simDt === 'number' && Number.isFinite(simDt) && simDt > 0;
  for (const mark of getMarks()) {
    if (stepped) mark.physics_model_step();
    guides.push(...mark.graphics_model_render());
  }

  // Start sequence: the clock runs on sim time; each boat's OCS / start
  // state is evaluated once per world step, before course progress (which
  // waits for a valid start). HUD and line overlay follow boat 0.
  const startSeq = getStartSequence();
  const startHud = document.getElementById('start_hud');
  if (startSeq) {
    const boats = getPlayers();
    if (stepped) {
      startSeq.step(simDt);
      startSeq.update(boats);
    }
    guides.push(...startGuides(startSeq, boats[0], performance.now()));
    if (startHud) {
      startHud.hidden = false;
      startHud.innerHTML = startHudHtml(startSeq, boats[0]);
      startHud.classList.toggle('flash', startSeq.flashing);
    }
    if (boats[0]) infoEl.innerHTML += 'Start: ' + startStatusText(startSeq, boats[0]) + '<br>';
  } else if (startHud && !startHud.hidden) {
    startHud.hidden = true;
  }

  // Course: each boat's rounding counters advance once per world step; the
  // overlay (highlighted mark, rounded ticks) is drawn for boat 0.
  const course = getCourse();
  if (course) {
    const boats = getPlayers();
    for (const boat of boats) {
      const progress = course.progressFor(boat);
      if (stepped) progress.update(boat.x, boat.y);
    }
    if (boats[0]) {
      const progress = course.progressFor(boats[0]);
      guides.push(...courseGuides(course, progress, performance.now()));
      infoEl.innerHTML += courseText(progress) + '<br>';
    }
  }

  // Rules overlay. map.get_wind follows the active provider, so the same
  // call is constant wind in dev mode and the lattice otherwise. Every
  // unordered pair inside 12 m is evaluated; nothing here assumes two boats.
  const racing = getPlayers();
  let showPenaltyKeys = false;
  for (let i = 0; i < racing.length; i++) {
    const sample = map.get_wind(racing[i].x, racing[i].y);
    const from = sample && Number.isFinite(sample.direction) ? sample.direction : null;
    const twa = from === null ? null : trueWindAngleDeg(racing[i].hull_angle, from);
    const onto = racing[i].tacking && racing[i].tackingOnto ? ' onto ' + racing[i].tackingOnto : '';
    const twaText = twa === null ? '?' : String(Math.round(twa));
    infoEl.innerHTML += 'Boat ' + i + ' TWA ' + twaText + (racing[i].tacking ? ' tacking' + onto : '') + '<br>';
    const pending = pendingPenaltyCount(racing[i]);
    const steered = racing[i].penalty_turn;
    if (pending > 0 || steered) {
      showPenaltyKeys = true;
      let line = 'Boat ' + i + (pending === 0 && penaltyJustCleared(racing[i]) ? ' CLEARED' : ' penalty ' + pending);
      const maneuvers = pending > 0 ? penaltyManeuverText(penaltyManeuverView(racing[i])) : null;
      if (steered) {
        const left = Math.max(0, Math.ceil(penaltyAutopilotRemainingDeg(racing[i])));
        line += ' · ' + (steered.dir < 0 ? 'CW ' : 'CCW ') + left + '°';
      }
      const reason = pending > 0 ? pendingPenaltyReason(racing[i]) : null;
      if (reason) line += ' · ' + reason;
      if (maneuvers) line += ' · ' + maneuvers;
      else if (pending > 0) line += ' · needs tack + gybe';
      infoEl.innerHTML += line + '<br>';
    } else if (penaltyJustCleared(racing[i])) {
      showPenaltyKeys = true;
      infoEl.innerHTML += 'Boat ' + i + ' CLEARED<br>';
    }
  }
  if (showPenaltyKeys) infoEl.innerHTML += 'Q CCW · E CW<br>';
  const getWind = (x, y) => map.get_wind(x, y);
  // Rule 18 asks the course which mark each boat is rounding.
  const markFor = course ? (boat) => markRoomTarget(course, boat) : null;
  const resolutions = evaluateAllPairs(racing, getWind, rulesTime, { markFor });
  for (const r of resolutions) {
    const m = r.markRoom;
    if (!m) continue;
    const ie = racing.indexOf(m.rightOfWay);
    const io = racing.indexOf(m.giveWay);
    infoEl.innerHTML += 'Rule 18.2: boat ' + io + ' gives mark-room to boat ' + ie + ' (' + m.basis + ' at the zone)' + (m.decisive ? ' · decides fault' : '') + '<br>';
  }
  guides.push(...markRoomGuides(resolutions, racing));
  for (let i = 0; i < resolutions.length; i++) {
    const pairGuides = resolutions[i].guides;
    if (pairGuides && pairGuides.length) guides.push(...pairGuides);
  }
  recordContacts(resolutions, rulesTime, racing);
  // Rule 31: boat-versus-mark touches, outside the pair engine. Racing from
  // the preparatory signal when there is a start sequence, else always.
  recordMarkTouches(racing, getMarks(), { simTime: rulesTime, racing: !startSeq || startSeq.racing });
  guides.push(...markTouchGuides());
  guides.push(...contactGuides());
  guides.push(...penaltyGuides(racing));

  // Dynamic domain placement: one reusable window per boat, plus a field
  // window where curl stays high away from every boat. Each boat level is a
  // disk floor plus curl (one layer in or out per frame, including a detached
  // island once a small cluster has held). A slide of the parent carries the
  // nested windows. Dev mode leaves the lattice frozen. A NaN body must not
  // be rounded into a domain corner.
  // Tracking reads curl, which only changes on a lattice step. On a coarse
  // setting (one step every 2nd / 4th frame) it runs on the stepping frames.
  if (!map.devMode && document.getElementById('amr').checked && bm.stepsDueThisFrame() > 0) trackBoats(bm, getPlayers());

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
    const steps = map.bm.advance_frame();
    if (steps > 0 && isPerfOverlayOn()) recordFieldStep(map.bm.field_ms);
  }

  incrementPhysicsFrame();

  if (!map.devMode && bm.step_ready) {
    dataTextureMaterial.needsUpdate = true;
    bm.step_ready = false;
  }

}, () => {});
