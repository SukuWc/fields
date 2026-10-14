import * as THREE from 'three';
import { FixedStepLoop } from './loop.js';

import { Boltzmann, unionMaskBorderLines } from './boltzmann.js';
import { FieldPainter, domPlotOptions } from './fieldPainter.js';
import { trackBoats, resetTracking } from './domainTrack.js';
import { Map } from './map.js';
import { FluidWind, ConstantWind, windArrowSegments } from './wind.js';
import { initRenderer, startAnimation, getCamera, setFluidPlaneSize } from './renderer.js';
import { setupControls, getPlayers, getMarks, getCourse, getStartSequence, getRaceResults, getRaceBots, getBoundary, getBoundaryScript, incrementPhysicsFrame, processKeys, executeScenarioFrame } from './controls.js';
import { installUrlSettings } from './url-settings.js';
import { setInfo, appendInfo, flushInfo, boatTelemetryHtml } from './info.js';
import { courseGuides, courseText, markRoomTarget } from './course.js';
import { finishGuides } from './finish.js';
import { Leaderboard, leaderboardHtml } from './leaderboard.js';
import { startGuides, startHudHtml, startStatusText } from './start.js';
import { recordMarkTouches, markTouchGuides } from './mark-touch.js';
import { setupPerfOverlay, isPerfOverlayOn, recordFieldStep } from './perf-overlay.js';
import { setupMobileMenu } from './mobile-menu.js';
import { setupTouchControls } from './touch-controls.js';

import { SAIL_LATTICE_COUPLING } from './boat.js';
import { MAP_SIZES, DEFAULT_MAP_SIZE, mapSizeFromQuery, fitMapSize, scenarioFits, cameraLimits } from './map-size.js';

import { beginRule15Step, contactGuides, evaluateAllPairs, penaltyAutopilotRemainingDeg, penaltyGuides, penaltyJustCleared, penaltyManeuverText, penaltyManeuverView, pendingPenaltyCount, pendingPenaltyReason, recordContacts, markRoomGuides, boundaryRoomGuides, trueWindAngleDeg } from './rules.js';


// Map size (src/map-size.js): width × length in metres, length along the
// wind (Y). ?map_size=100x200 or the #map_size select; changing it reloads.
// A scenario that does not fit the asked size gets the smallest that does.
const _query = new URLSearchParams(location.search);
const _askedMapSize = mapSizeFromQuery(location.search);
const _scenarioParam = Number(_query.get('scenario_selector')) || 0;
const mapSizeKey = fitMapSize(_scenarioParam, _askedMapSize);
const mapSizeClamped = mapSizeKey !== _askedMapSize;
const map_w = MAP_SIZES[mapSizeKey].w;
const map_h = MAP_SIZES[mapSizeKey].h;
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
// Root cell: the size's default simRes (map-size.js) unless ?simRes is set.
const _simResKey = _query.get('simRes') || MAP_SIZES[mapSizeKey].simRes;
const _rootRes = { '1': 1, '2': 0.5, '4': 0.25, '2f': 0.5, '2f34': 0.5 }[_simResKey] || 1;
const bm = new Boltzmann(map_w, map_h, _rootRes, wind_angle, wind_speed,
  new FieldPainter(dataTextureMaterial, texture_oversampling, domPlotOptions()));
const fluidWind = new FluidWind(bm);
const constantWind = new ConstantWind(wind_angle, wind_speed);
// Domains are created dynamically in the physics loop as players spawn.
const map = new Map(map_w, map_h, wind_angle, wind_speed, bm, fluidWind, constantWind);
map.physics_model_init();
{
  // Pan limits keep the 7.5 m margin of the 75 m map (±30); the zoom-out
  // limit shows the whole length (map-size.js cameraLimits).
  const lim = cameraLimits(map_w, map_h);
  map.camera_position_x_max = lim.xMax; map.camera_position_x_min = -lim.xMax;
  map.camera_position_y_max = lim.yMax; map.camera_position_y_min = -lim.yMax;
  map.camera_zoom_max = lim.zoomMax;
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
// Map size select. The select default (markup) is DEFAULT_MAP_SIZE so the
// URL only carries map_size when it differs. A new size reloads the page and
// drops ?simRes so the new size's default root cell applies.
const mapSizeSel = document.getElementById('map_size');
if (MAP_SIZES[mapSizeKey].legacy) {
  const opt = document.createElement('option');
  opt.value = mapSizeKey; opt.textContent = MAP_SIZES[mapSizeKey].label;
  mapSizeSel.appendChild(opt);
}
function reloadWithMapSize(key, extra) {
  const u = new URL(location.href);
  u.searchParams.delete('mapSize');
  u.searchParams.delete('simRes');
  if (key === DEFAULT_MAP_SIZE) u.searchParams.delete('map_size'); else u.searchParams.set('map_size', key);
  for (const [k, v] of Object.entries(extra || {})) u.searchParams.set(k, v);
  location.href = u.toString();
}
// installUrlSettings writes ?map_size into the select at load (it may be a
// size this scenario was clamped up from); only later edits reload.
let mapSizeLive = false;
mapSizeSel.addEventListener('change', (e) => {
  const v = e.target.value;
  if (!mapSizeLive || v === mapSizeKey || !MAP_SIZES[v]) return;
  reloadWithMapSize(v);
});
// A scenario picked in the app that does not fit this map reloads on the
// smallest size that fits (course scenarios 12-17 need 100 × 200).
document.getElementById('scenario_selector').addEventListener('change', (e) => {
  const n = Number(e.target.value) || 0;
  if (scenarioFits(n, mapSizeKey)) return;
  reloadWithMapSize(fitMapSize(n, mapSizeKey), { scenario_selector: String(n) });
});
// Refinement layout (#amrMode). The app default is "auto": only the finest
// boat disk is fixed and every coarser level is a grading shell plus curl
// growth (domainTrack AUTO_SHELL). ?amrMode=fixed (or ?amr=fixed) selects the
// fixed rings; ?amr=auto is accepted too. The Boltzmann engine defaults to
// auto as well; this line keeps the app explicit. Changing it restarts.
bm.amrMode = 'auto';
// Refinement budget: target cell updates per root step (domainTrack BUDGET_*).
// ?cellBudget=N sets it, ?cellBudget=0 (or off) turns it off. The default
// follows the grid ('default' = defaultCellUpdateTarget(bm): 50k on a 3-level
// stack, 100k on x2 / 2f / 2f34, 200k on x4).
// Live controls (shown with the Perf overlay, synced by installUrlSettings):
// #cellBudgetTune (checkbox, default on; off = no budget, scale 1) and
// #cellBudget (number; empty = the grid default). The legacy ?cellBudget=0 /
// ?cellBudget=off is rewritten to ?cellBudgetTune=0 before the URL is applied.
{
  const q = new URLSearchParams(location.search);
  const raw = q.get('cellBudget');
  if (raw !== null && (raw.trim().toLowerCase() === 'off' || Number(raw) === 0)) {
    q.delete('cellBudget');
    q.set('cellBudgetTune', '0');
    const qs = q.toString();
    history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }
  const tune = document.getElementById('cellBudgetTune');
  const num = document.getElementById('cellBudget');
  const apply = () => {
    const n = Number(String(num.value).trim());
    if (!tune.checked) {
      bm.cellUpdateTarget = Infinity;
      bm.curlScale = 1;
      bm.cellLoadRatio = 0;
    } else {
      bm.cellUpdateTarget = num.value.trim() !== '' && Number.isFinite(n) && n > 0 ? n : 'default';
    }
  };
  tune.addEventListener('change', apply);
  num.addEventListener('change', apply);
  num.addEventListener('input', apply);
  apply();
}
{
  const sel = document.getElementById('amrMode');
  const q = new URLSearchParams(location.search);
  const legacy = q.get('amr');
  if (legacy === 'auto' || legacy === 'fixed') {
    q.delete('amr');
    if (legacy === 'fixed') q.set('amrMode', 'fixed');
    const qs = q.toString();
    history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
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
// simRes default follows the map size (map-size.js). Set before
// installUrlSettings so that is the default it compares against.
document.getElementById('simRes').value = MAP_SIZES[mapSizeKey].simRes;
installUrlSettings();
// After installUrlSettings: show the size in use (a clamp or a legacy
// ?mapSize) and write it to the URL; equal to mapSizeKey, so no reload.
if (mapSizeSel.value !== mapSizeKey || _query.has('mapSize')) {
  const u = new URLSearchParams(location.search);
  if (u.has('mapSize')) { u.delete('mapSize'); history.replaceState(history.state, '', location.pathname + (u.toString() ? '?' + u : '') + location.hash); }
  mapSizeSel.value = mapSizeKey;
  mapSizeSel.dispatchEvent(new Event('change', { bubbles: true }));
}
mapSizeLive = true;
if (mapSizeClamped) console.info(`map_size ${_askedMapSize} is too small for scenario ${_scenarioParam}; using ${mapSizeKey}`);
setupMobileMenu();

// Sim options the loop reads, mirrored from the settings checkboxes so the
// simulation pass never touches the DOM. Kept current by change listeners
// (url-settings dispatches change events, so query values land here too).
const simOptions = { amr: true, boatEnergy: true };
for (const [key, id] of [['amr', 'amr'], ['boatEnergy', 'boat_energy']]) {
  const el = document.getElementById(id);
  simOptions[key] = el.checked;
  el.addEventListener('change', () => { simOptions[key] = el.checked; });
}

let currentGuides = [];
startAnimation(map, () => currentGuides);

const distInfoEl = document.getElementById('dist_info');

// Physics loop (loop.js). The world steps in fixed 1/30 s ticks of wall
// time, independent of the display's frame rate. Rule 15's room window uses
// the sim clock (rulesTime), not wall time.
//
// Each tick runs SIM_PASSES_PER_TICK passes of simPass: the first one right
// after world.step with simDt (clocks, marks, start/course/finish, bots), the
// rest without. Boat forces, keys, scenario frames and lattice steps are
// applied on every pass. The old planck-renderer Runner also ran this callback
// after every world.step plus once per animation frame, so on a 60 Hz display
// a step got three passes; the default of 3 keeps the boats, the scenario
// scripts and the fluid at the speed they had on a 60 Hz screen. On a 120 Hz
// screen the Runner gave five passes per step (everything ran 5/3 faster), and
// on a slow machine fewer; now it is three everywhere. ?simPasses=1..5
// overrides this (1 = one pass per world step).
// Guides, HUD and readout DOM writes happen only on the last pass of a tick.
const SIM_PASSES_PER_TICK = (() => {
  const n = Number(new URLSearchParams(location.search).get('simPasses'));
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 3;
})();
const loop = new FixedStepLoop(map.world, { tickHz: 30, maxCatchUp: 4 });
let rulesTime = 0;
let leaderboard = null;

function simPass(simDt, present) {
  if (typeof simDt === 'number' && Number.isFinite(simDt) && simDt > 0) rulesTime += simDt;
  setInfo('');
  beginRule15Step(rulesTime);
  const guides = [];

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
        if (present) distInfoEl.innerHTML = "Dist: " + Math.floor(sumOfPlayerDistances * 100) / 100 + "<br>";
      }
    });

    player.physics_model_step();
    if (player.telemetry) setInfo(boatTelemetryHtml(player.telemetry));
    guides.push(...player.graphics_model_render());

    if (!map.devMode && simOptions.boatEnergy) {
      const eff = sailEfficiency();
      for (const seg of player.getSailSegments()) {
        map.bm.apply_energy_segment(seg.x0, seg.y0, seg.x1, seg.y1,
          seg.fx * eff, seg.fy * eff);
      }
    }

    appendInfo("Phys Time: " + bm.t_delta + "<br>");
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
    if (startHud && present) {
      startHud.hidden = false;
      startHud.innerHTML = startHudHtml(startSeq, boats[0]);
      startHud.classList.toggle('flash', startSeq.flashing);
    }
    if (boats[0]) appendInfo('Start: ' + startStatusText(startSeq, boats[0]) + '<br>');
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
      appendInfo(courseText(progress) + '<br>');
    }
  }

  // Finish (finish.js): after course progress, bow crossings of the finish
  // line by boats with a complete course are recorded on the race clock
  // (time since the gun, or since the scenario start without a sequence).
  const results = getRaceResults();
  const resultsEl = document.getElementById('finish_results');
  const raceClock = startSeq ? startSeq.clock : (results ? results.relClock(rulesTime) : rulesTime);
  if (course && course.finish && results) {
    const boats = getPlayers();
    if (stepped) results.update(boats, raceClock);
    guides.push(...finishGuides(course, boats[0] ? course.progressFor(boats[0]) : null, results, boats, raceClock, performance.now()));
  }
  // Race bots (scenario 17): set each boat's autopilot target once per step.
  const windFrom = map.wind_direction;
  if (stepped) {
    const boats = getPlayers();
    for (const bot of getRaceBots()) bot.step(raceClock, windFrom, boats, !!results && results.isFinished(bot.boat), results ? results.entries.length : 1);
  }
  // Live leaderboard (leaderboard.js) for any course; it replaces the
  // results panel (finished rows keep the results text).
  if (course) {
    if (!leaderboard || leaderboard.course !== course) leaderboard = new Leaderboard(course, { startSequence: startSeq, results });
    leaderboard.results = results;
    if (stepped) leaderboard.update(getPlayers(), raceClock, windFrom);
    if (resultsEl && present) {
      resultsEl.hidden = false;
      resultsEl.innerHTML = leaderboardHtml(leaderboard, 0);
    }
  } else if (resultsEl && !resultsEl.hidden) {
    resultsEl.hidden = true;
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
    appendInfo('Boat ' + i + ' TWA ' + twaText + (racing[i].tacking ? ' tacking' + onto : '') + '<br>');
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
      appendInfo(line + '<br>');
    } else if (penaltyJustCleared(racing[i])) {
      showPenaltyKeys = true;
      appendInfo('Boat ' + i + ' CLEARED<br>');
    }
  }
  if (showPenaltyKeys) appendInfo('Q CCW · E CW<br>');
  const getWind = (x, y) => map.get_wind(x, y);
  // Rule 18 asks the course which mark each boat is rounding.
  const markFor = course ? (boat) => markRoomTarget(course, boat) : null;
  // Virtual boundary (scenario 19 only): its script, crossing penalties,
  // overlay, and boundary room in the pair rules.
  const boundary = getBoundary();
  if (boundary) {
    const script = getBoundaryScript();
    if (stepped && script) script.step(rulesTime);
    if (stepped) boundary.update(racing, rulesTime);
    guides.push(...boundary.guides());
    for (let i = 0; i < racing.length; i++) {
      const d = boundary.distanceOf(racing[i]);
      appendInfo('Boat ' + i + ' boundary ' + (d.side > 0 ? 'east' : 'west') + ' ' + d.dist.toFixed(1) + ' m' + (d.dist < 0 ? ' OUTSIDE' : d.dist <= boundary.zone ? ' (zone)' : '') + '<br>');
    }
  }
  const resolutions = evaluateAllPairs(racing, getWind, rulesTime, { markFor, boundary });
  for (const r of resolutions) {
    const b = r.boundaryRoom;
    if (!b) continue;
    appendInfo('Boundary room: boat ' + racing.indexOf(b.giveWay) + ' gives boat ' + racing.indexOf(b.rightOfWay) + ' room to tack or gybe away (' + b.basis + ')' + (b.decisive ? ' · decides fault' : '') + '<br>');
  }
  guides.push(...boundaryRoomGuides(resolutions, racing));
  for (const r of resolutions) {
    const m = r.markRoom;
    if (!m) continue;
    const ie = racing.indexOf(m.rightOfWay);
    const io = racing.indexOf(m.giveWay);
    appendInfo('Rule 18.2: boat ' + io + ' gives mark-room to boat ' + ie + ' (' + m.basis + ' at the zone)' + (m.decisive ? ' · decides fault' : '') + '<br>');
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
  if (!map.devMode && simOptions.amr && bm.stepsDueThisFrame() > 0) trackBoats(bm, getPlayers());

  // AMR off: a restart that removed a boat would keep drawing a ring.
  // AMR on: trackBoats already installed exactly the live boats, in player order.
  if (!map.devMode && !simOptions.amr && bm.domains.length > getPlayers().length) {
    bm.domains.length = getPlayers().length;
    bm._rebuildInteriorCells();
  }
  if (!map.devMode && present) pushRefinementGuides(bm.domains);

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
  if (present) {
    flushInfo();
    currentGuides = guides;
  }

  if (!map.devMode && bm.step_ready) {
    dataTextureMaterial.needsUpdate = true;
    bm.step_ready = false;
  }
}

loop.start((dt) => {
  for (let i = 0; i < SIM_PASSES_PER_TICK; i++) {
    simPass(i === 0 ? dt : undefined, i === SIM_PASSES_PER_TICK - 1);
  }
});
