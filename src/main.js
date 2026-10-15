import * as THREE from 'three';
import { FixedStepLoop } from './loop.js';

import { Boltzmann, unionMaskBorderLines } from './boltzmann.js';
import { FieldPainter, domPlotOptions } from './fieldPainter.js';
import { Map } from './map.js';
import { FluidWind, ConstantWind, windArrowSegments } from './wind.js';
import { initRenderer, startAnimation, getCamera, setFluidPlaneSize } from './renderer.js';
import { setupControls, heldCommands } from './controls.js';
import { Sim, SIM_RES_MODES } from './sim.js';
import { View } from './view.js';
import { installUrlSettings } from './url-settings.js';
import { setInfo, appendInfo, flushInfo, boatTelemetryHtml } from './info.js';
import { courseGuides, courseText } from './course.js';
import { finishGuides } from './finish.js';
import { leaderboardHtml } from './leaderboard.js';
import { startGuides, startHudHtml, startStatusText } from './start.js';
import { markTouchGuides } from './mark-touch.js';
import { setupPerfOverlay, isPerfOverlayOn, recordFieldStep } from './perf-overlay.js';
import { setupMobileMenu } from './mobile-menu.js';
import { setupTouchControls } from './touch-controls.js';

import { MAP_SIZES, DEFAULT_MAP_SIZE, mapSizeFromQuery, fitMapSize, scenarioFits, cameraLimits } from './map-size.js';

import { contactGuides, penaltyGuides, markRoomGuides, boundaryRoomGuides } from './rules.js';


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
const _rootRes = { '1': 1, '2': 0.5, '4': 0.25, '2f': 0.5, '2f34': 0.5, '4f': 0.25 }[_simResKey] || 1;
const bm = new Boltzmann(map_w, map_h, _rootRes, wind_angle, wind_speed,
  new FieldPainter(dataTextureMaterial, texture_oversampling, domPlotOptions()));
const fluidWind = new FluidWind(bm);
const constantWind = new ConstantWind(wind_angle, wind_speed);
// Domains are created dynamically in the physics loop as players spawn.
const map = new Map(map_w, map_h, wind_angle, wind_speed, bm, fluidWind, constantWind);
map.physics_model_init();
// Camera and drawing toggles (view.js), client side.
const view = new View();
{
  // Pan limits keep the 7.5 m margin of the 75 m map (±30); the zoom-out
  // limit shows the whole length (map-size.js cameraLimits).
  const lim = cameraLimits(map_w, map_h);
  view.camera_position_x_max = lim.xMax; view.camera_position_x_min = -lim.xMax;
  view.camera_position_y_max = lim.yMax; view.camera_position_y_min = -lim.yMax;
  view.camera_zoom_max = lim.zoomMax;
}
// The simulation (sim.js): boats, marks, race state, rules, scenarios. The
// rest of this file is the client: settings UI, renderer, readout.
const sim = new Sim(map);

// Renderer and controls — must init renderer before controls (controls needs getCamera).
// The barrier listener has to exist before URL settings dispatch change events.
initRenderer(map, planeMat, view);
document.getElementById('barrier').addEventListener('change', e => sim.command({ type: 'barrier', on: e.target.checked }));
setFluidPlaneSize(bm.latticeWorldWidth, bm.latticeWorldHeight);
setupControls(sim, view, getCamera);
// Simulation resolution (#simRes, ?simRes=2 / 4). Rebuilds the root lattice
// in place (every module keeps the same bm), drops the refinement windows,
// resizes the field plane, and restarts the scenario like the Restart button.
// Before installUrlSettings so a query value goes through this listener.
// Fast-wind options ("2f", "2f34") use the x2 root cell but step it every
// frame (or 1.2× per frame): stepsPerFrame is explicit, see Boltzmann._build.
// SIM_RES_MODES lives in sim.js.
document.getElementById('simRes').addEventListener('change', (e) => {
  if (!sim.command({ type: 'simRes', mode: e.target.value })) return;
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
    if (!sim.command({ type: 'amrMode', mode: e.target.value })) return;
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
// The constructor only took the root resolution; apply the mode's explicit
// stepsPerFrame (fast-wind defaults such as '4f') before anything runs.
{
  const m = SIM_RES_MODES[_simResKey];
  if (m && (m.stepsPerFrame ?? m.resolution) !== bm.stepsPerFrame) {
    bm.setResolution(m.resolution, m.stepsPerFrame);
    bm.setWindSpeed(map.wind_speed);
    setFluidPlaneSize(bm.latticeWorldWidth, bm.latticeWorldHeight);
  }
}
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
for (const [key, id] of [['amr', 'amr'], ['boatEnergy', 'boat_energy']]) {
  const el = document.getElementById(id);
  sim.command({ type: 'options', [key]: el.checked });
  el.addEventListener('change', () => { sim.command({ type: 'options', [key]: el.checked }); });
}

let currentGuides = [];
startAnimation(map, view, () => currentGuides);

const distInfoEl = document.getElementById('dist_info');

const loop = new FixedStepLoop(map.world, { tickHz: 30, maxCatchUp: 4 });

// Smooth circle per boat disk. A field island has a mask and no disk, so
// only its staircase is drawn. The light staircase is the union of every
// mask at that level: overlapping boats share one border, and a detached
// curl island keeps its own outline. A rectangle with no disk and no mask
// still uses its four sides.
function pushRefinementGuides(guides, domains) {
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
  if (children.length) pushRefinementGuides(guides, children);
}

// Readout, HUD and guides for the step just taken (rec = sim.step's record).
// Same lines, order and guides as the old in-loop code.
function present(rec) {
  sim.activate();
  const guides = [];
  const racing = sim.players;

  if (rec.distSum !== null) distInfoEl.innerHTML = "Dist: " + Math.floor(rec.distSum * 100) / 100 + "<br>";

  // Each boat's step used to reset the readout and append "Phys Time", so the
  // last boat with telemetry leads, followed by one Phys Time per later boat.
  const k = rec.telemetryIndex;
  setInfo(k >= 0 ? boatTelemetryHtml(racing[k].telemetry) : '');
  for (let i = Math.max(0, k); i < rec.physTimes.length; i++) appendInfo("Phys Time: " + rec.physTimes[i] + "<br>");
  for (const player of racing) guides.push(...player.graphics_model_render(view));
  for (const mark of sim.marks) guides.push(...mark.graphics_model_render());

  const startSeq = sim.startSequence;
  const startHud = document.getElementById('start_hud');
  if (startSeq) {
    guides.push(...startGuides(startSeq, racing[0], performance.now()));
    if (startHud) {
      startHud.hidden = false;
      startHud.innerHTML = startHudHtml(startSeq, racing[0]);
      startHud.classList.toggle('flash', startSeq.flashing);
    }
    if (racing[0]) appendInfo('Start: ' + startStatusText(startSeq, racing[0]) + '<br>');
  } else if (startHud && !startHud.hidden) {
    startHud.hidden = true;
  }

  const course = sim.course;
  if (course && racing[0]) {
    const progress = course.progressFor(racing[0]);
    guides.push(...courseGuides(course, progress, performance.now()));
    appendInfo(courseText(progress) + '<br>');
  }

  const results = sim.raceResults;
  const resultsEl = document.getElementById('finish_results');
  if (course && course.finish && results) {
    guides.push(...finishGuides(course, racing[0] ? course.progressFor(racing[0]) : null, results, racing, rec.raceClock, performance.now()));
  }
  if (course) {
    if (resultsEl) {
      resultsEl.hidden = false;
      resultsEl.innerHTML = leaderboardHtml(sim.leaderboard, 0);
    }
  } else if (resultsEl && !resultsEl.hidden) {
    resultsEl.hidden = true;
  }

  // Rules readout, as the step saw it before recording this tick's contacts.
  let showPenaltyKeys = false;
  rec.boats.forEach((b, i) => {
    const twaText = b.twa === null ? '?' : String(Math.round(b.twa));
    appendInfo('Boat ' + i + ' TWA ' + twaText + (b.tacking ? ' tacking' + (b.tackingOnto ? ' onto ' + b.tackingOnto : '') : '') + '<br>');
    if (b.pending > 0 || b.penaltyTurn) {
      showPenaltyKeys = true;
      let line = 'Boat ' + i + (b.pending === 0 && b.justCleared ? ' CLEARED' : ' penalty ' + b.pending);
      if (b.penaltyTurn) {
        const left = Math.max(0, Math.ceil(b.penaltyTurn.remainingDeg));
        line += ' · ' + (b.penaltyTurn.dir < 0 ? 'CW ' : 'CCW ') + left + '°';
      }
      if (b.reason) line += ' · ' + b.reason;
      if (b.maneuvers) line += ' · ' + b.maneuvers;
      else if (b.pending > 0) line += ' · needs tack + gybe';
      appendInfo(line + '<br>');
    } else if (b.justCleared) {
      showPenaltyKeys = true;
      appendInfo('Boat ' + i + ' CLEARED<br>');
    }
  });
  if (showPenaltyKeys) appendInfo('Q CCW · E CW<br>');

  const boundary = sim.boundary;
  if (boundary) {
    guides.push(...boundary.guides());
    for (let i = 0; i < racing.length; i++) {
      const d = boundary.distanceOf(racing[i]);
      appendInfo('Boat ' + i + ' boundary ' + (d.side > 0 ? 'east' : 'west') + ' ' + d.dist.toFixed(1) + ' m' + (d.dist < 0 ? ' OUTSIDE' : d.dist <= boundary.zone ? ' (zone)' : '') + '<br>');
    }
  }
  const resolutions = rec.resolutions;
  for (const r of resolutions) {
    const b = r.boundaryRoom;
    if (!b) continue;
    appendInfo('Boundary room: boat ' + racing.indexOf(b.giveWay) + ' gives boat ' + racing.indexOf(b.rightOfWay) + ' room to tack or gybe away (' + b.basis + ')' + (b.decisive ? ' · decides fault' : '') + '<br>');
  }
  guides.push(...boundaryRoomGuides(resolutions, racing));
  for (const r of resolutions) {
    const m = r.markRoom;
    if (!m) continue;
    appendInfo('Rule 18.2: boat ' + racing.indexOf(m.giveWay) + ' gives mark-room to boat ' + racing.indexOf(m.rightOfWay) + ' (' + m.basis + ' at the zone)' + (m.decisive ? ' · decides fault' : '') + '<br>');
  }
  guides.push(...markRoomGuides(resolutions, racing));
  for (let i = 0; i < resolutions.length; i++) {
    const pairGuides = resolutions[i].guides;
    if (pairGuides && pairGuides.length) guides.push(...pairGuides);
  }
  guides.push(...markTouchGuides());
  guides.push(...contactGuides());
  guides.push(...penaltyGuides(racing));

  if (!map.devMode) pushRefinementGuides(guides, bm.domains);
  if (map.devMode) {
    const wind = map.get_wind(0, 0);
    // wind.direction is where the wind comes from. The arrow points downwind,
    // along (vx, vy), matching the lattice flow and the sail-drag push.
    const flowDeg = Math.atan2(wind.vy, wind.vx) * 180 / Math.PI;
    const ox = view.camera_position_x - 14;
    const oy = view.camera_position_y + 4;
    for (const seg of windArrowSegments(ox, oy, flowDeg, 8)) {
      guides.push({ color: 0x66eeff, type: 'guide', x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 });
    }
  }

  flushInfo();
  currentGuides = guides;
}

// One 30 Hz tick: camera follow, sim step(s), then the readout. Each tick runs
// SIM_PASSES_PER_TICK sim steps (the first with simDt); ?simPasses=1..5.
const SIM_PASSES_PER_TICK = (() => {
  const n = Number(new URLSearchParams(location.search).get('simPasses'));
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 1;
})();

loop.start((dt) => {
  for (let i = 0; i < SIM_PASSES_PER_TICK; i++) {
    view.set_camera_follow_target(sim.players[0]);
    view.update();
    const rec = sim.step(i === 0 ? dt : undefined, heldCommands);
    if (rec.fieldSteps > 0 && isPerfOverlayOn()) recordFieldStep(bm.field_ms);
    if (i === SIM_PASSES_PER_TICK - 1) present(rec);
    if (!map.devMode && bm.step_ready) {
      dataTextureMaterial.needsUpdate = true;
      bm.step_ready = false;
    }
  }
});
