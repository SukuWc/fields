import * as THREE from 'three';
import { FixedStepLoop } from './loop.js';

import { initRenderer, startAnimation, renderNow, getCamera, setFluidPlaneSize, setFieldVisible } from './renderer.js';
import { setupControls, heldCommands, onHeldChange, deferUiToFrames, flushFrameUi } from './controls.js';
import { LocalHost } from './host.js';
import { buildScene } from './scene-build.js';
import { WorkerHost } from './worker-host.js';
import { RemoteHost } from './remote-host.js';
import { hostChoice } from './host-choice.js';
import { setupOwnBoat } from './own-boat.js';
import { View } from './view.js';
import { installUrlSettings } from './url-settings.js';
import { setInfo, flushInfo } from './info.js';
import { setupPerfOverlay, isPerfOverlayOn, recordFieldStep, perfOverlayFrame } from './perf-overlay.js';
import { setupMobileMenu } from './mobile-menu.js';
import { setupTouchControls } from './touch-controls.js';

import { MAP_SIZES, DEFAULT_MAP_SIZE, mapSizeFromQuery, fitMapSize, scenarioFits, cameraLimits } from './map-size.js';



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
const wind_speed = 4.5; // m/s (old UI 15)
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

// The simulation runs behind a SimHost (host.js): this file and the other
// client modules only send it commands and draw the plain frames it returns.
// Root cell: the size's default simRes (map-size.js) unless ?simRes is set.
const _simResKey = _query.get('simRes') || MAP_SIZES[mapSizeKey].simRes;
// Host (host-choice.js): a Web Worker (worker-host.js) by default;
// ?worker=0 or ?host=local keeps the Sim on the main thread (LocalHost);
// ?host=remote&server=ws://... (or a VITE_SIM_HOST=remote build) connects to
// the Node server (apps/server, remote-host.js). Without Worker support, or
// if the worker or server cannot be reached before its first message, the
// app falls back to LocalHost.
// ?workerQueue=N caps ticks waiting on the worker (0 = none).
const _hostOpts = {
  mapW: map_w, mapH: map_h, windAngle: wind_angle, windSpeed: wind_speed,
  simRes: _simResKey, texture: dataTextureMaterial, oversampling: texture_oversampling,
};
const _env = import.meta.env || {};
const _hostChoice = hostChoice(location.search, {
  hasWorker: typeof Worker === 'function', envHost: _env.VITE_SIM_HOST, envServer: _env.VITE_SIM_SERVER_URL,
});
// Only non-default values stay in the URL.
if (_hostChoice.drop.length) {
  const q = new URLSearchParams(location.search);
  for (const k of _hostChoice.drop) q.delete(k);
  const qs = q.toString();
  history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
}
const _workerQueue = Number(_query.get('workerQueue'));
function makeLocalHost() { return new LocalHost(_hostOpts); }
let host = null;
try {
  if (_hostChoice.kind === 'worker') {
    host = new WorkerHost(_hostOpts, dataTextureMaterial, { maxInFlight: Number.isInteger(_workerQueue) && _workerQueue >= 0 && _query.has('workerQueue') ? _workerQueue : 4 });
  } else if (_hostChoice.kind === 'remote') {
    host = new RemoteHost(_hostChoice.server, _hostOpts, dataTextureMaterial);
  }
} catch (e) {
  console.warn('sim ' + _hostChoice.kind + ' host unavailable, running on the main thread', e);
  host = null;
}
if (!host) host = makeLocalHost();
if (typeof window !== 'undefined') window.__simHost = host;
// Command whose result the caller acts on: synchronous on the main-thread
// host (as the old direct sim calls were), else when the host answers.
function hostCommand(c, then) {
  if (host.commandSync) { const r = host.commandSync(c); if (then) then(r); return; }
  host.command(c).then((r) => { if (then) then(r); });
}
// The client starts once the host has its info: at once on the main thread,
// after the worker's or server's first message. A host that fails before
// that is dropped for a LocalHost (the client has not attached to it yet).
if (host.kind === 'local') startClient();
else host.ready.then(startClient, (e) => {
  console.warn('sim ' + host.kind + ' host failed to start, running on the main thread', e && (e.message || e));
  if (host.terminate) host.terminate();
  host = makeLocalHost();
  window.__simHost = host;
  startClient();
});

function startClient() {
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
  // Renderer and controls — must init renderer before controls (controls needs getCamera).
  // The barrier listener has to exist before URL settings dispatch change events.
  initRenderer({ width: map_w, height: map_h }, planeMat, view);
  document.getElementById('barrier').addEventListener('change', e => host.command({ type: 'barrier', on: e.target.checked }));
  setFluidPlaneSize(host.info.lattice.w, host.info.lattice.h);
  // Field plot options (#plotSelect, #contrastSlider) go to the host's painter.
  {
    const plotSelect = document.getElementById('plotSelect');
    const contrastSlider = document.getElementById('contrastSlider');
    const sendPlot = () => host.command({ type: 'plot', plotType: plotSelect.selectedIndex, contrastExp: Number(contrastSlider.value) });
    plotSelect.addEventListener('change', sendPlot);
    contrastSlider.addEventListener('input', sendPlot);
    contrastSlider.addEventListener('change', sendPlot);
    sendPlot();
  }
  setupControls(host, view, getCamera);
  // Simulation resolution (#simRes, ?simRes=2 / 4). Rebuilds the root lattice
  // in place (every module keeps the same bm), drops the refinement windows,
  // resizes the field plane, and restarts the scenario like the Restart button.
  // Before installUrlSettings so a query value goes through this listener.
  // Fast-wind options ("2f", "2f34") use the x2 root cell but step it every
  // frame (or 1.2× per frame): stepsPerFrame is explicit, see Boltzmann._build.
  // SIM_RES_MODES lives in sim.js.
  document.getElementById('simRes').addEventListener('change', (e) => {
    hostCommand({ type: 'simRes', mode: e.target.value }, (r) => {
      if (!r.rebuilt) return;
      setFluidPlaneSize(r.lattice.w, r.lattice.h);
      dataTextureMaterial.needsUpdate = true;
      document.getElementById('scenario_restart').click();
    });
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
  // auto as well; SimCore sends the 'auto' command. Changing it restarts.
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
      host.command({ type: 'cellBudget', tune: tune.checked, target: num.value.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null });
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
      hostCommand({ type: 'amrMode', mode: e.target.value }, (r) => {
        if (!r.rebuilt) return;
        dataTextureMaterial.needsUpdate = true;
        document.getElementById('scenario_restart').click();
      });
    });
  }
  // Before installUrlSettings so ?perf=1 turns the overlay on through its change listener.
  // Counters: live from the main-thread host, else the latest frame's.
  let lastFrame = null;
  // Remote mode (server clock) is event-driven: the overlay closes a frame per
  // server frame instead of running its own rAF loop.
  const remoteDriven = host.kind === 'remote' && host.mode !== 'client';
  setupPerfOverlay(() => (host.perfStats ? host.perfStats() : lastFrame && lastFrame.perf) || null, { external: remoteDriven });
  document.getElementById('perf').addEventListener('change', (e) => host.setPerf(e.target.checked));
  // Before installUrlSettings: the device default must be the checkbox default.
  setupTouchControls();
  // simRes default follows the map size (map-size.js). Set before
  // installUrlSettings so that is the default it compares against.
  document.getElementById('simRes').value = MAP_SIZES[mapSizeKey].simRes;
  // The mode's explicit stepsPerFrame (fast-wind defaults such as '4f') was
  // applied by the host at startup (SimCore, a 'simRes' command).
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
    host.command({ type: 'options', [key]: el.checked });
    el.addEventListener('change', () => { host.command({ type: 'options', [key]: el.checked }); });
  }

  let currentGuides = [];
  let devMode = false;
  // Guides and body outlines: built here from the latest frame's scene state
  // (scene-build.js buildScene), the same code for every host.
  let frameBodies = [];
  // Remote mode: no animation loop; the frame handler below draws.
  startAnimation(view, () => ({
    bodies: frameBodies,
    guides: currentGuides,
    devMode,
  }), { loop: !remoteDriven });

  const distInfoEl = document.getElementById('dist_info');
  const startHud = document.getElementById('start_hud');
  const resultsEl = document.getElementById('finish_results');

  // The host steps the world; the loop only keeps time.
  const loop = new FixedStepLoop({ step() {} }, { tickHz: 30, maxCatchUp: 4 });

  // Readout and HUD from a frame's presentation (present.js presentHud).
  function applyHud(hud) {
    if (hud.dist !== null) distInfoEl.innerHTML = hud.dist;
    setInfo(hud.info);
    if (hud.startHud) {
      if (startHud) {
        startHud.hidden = false;
        startHud.innerHTML = hud.startHud.html;
        startHud.classList.toggle('flash', hud.startHud.flash);
      }
    } else if (startHud && !startHud.hidden) {
      startHud.hidden = true;
    }
    if (hud.results !== null) {
      if (resultsEl) {
        resultsEl.hidden = false;
        resultsEl.innerHTML = hud.results;
      }
    } else if (resultsEl && !resultsEl.hidden) {
      resultsEl.hidden = true;
    }
    flushInfo();
  }

  // Camera follow target: boat 0 as of the last step (the old code read
  // sim.players[0], whose position a step sets). Cleared with the scenario.
  let followTarget;
  let ownBoatId = null;
  setupOwnBoat(host, (ids) => { ownBoatId = ids[0] || null; });
  host.on((ev) => { if (ev.type === 'cleared') followTarget = undefined; });
  host.onFrame((frame) => {
    lastFrame = frame;
    devMode = frame.devMode;
    // In a remote room with an own boat, follow that one.
    const mine = ownBoatId && frame.spawned ? frame.spawned.find((b) => b.id === ownBoatId) : null;
    followTarget = mine || (ownBoatId ? undefined : frame.boat0) || undefined;
    if (frame.fieldSteps > 0 && isPerfOverlayOn()) recordFieldStep(frame.fieldMs);
    if (frame.hud) {
      applyHud(frame.hud);
      if (frame.state && frame.statics) {
        const scene = buildScene(frame.state, frame.statics, view);
        currentGuides = scene.guides;
        frameBodies = scene.bodies;
      }
    }
    if (frame.fieldReady) dataTextureMaterial.needsUpdate = true;
  });

  if (remoteDriven) {
    // Remote (server clock): nothing runs on a local clock. Each server frame
    // (handled above: readout, HUD, guides, perf counters, field texture)
    // moves the camera, closes a perf-overlay frame and draws once; held keys
    // and the camera go to the server when they change.
    const sendInput = () => host.sendInput({ held: heldCommands(), view });
    onHeldChange(sendInput);
    deferUiToFrames(true);
    host.onFrame(() => {
      view.set_camera_follow_target(followTarget);
      view.update();
      sendInput();
      perfOverlayFrame(performance.now());
      flushFrameUi();
      renderNow();
    });
    sendInput();
    // Field: the server sends field messages only while this page shows the
    // field (Show field box on and dev mode off); the plot choice was sent
    // with the 'plot' command above.
    const fieldBox = document.getElementById('field_plane');
    document.getElementById('field_plane_row').hidden = false;
    document.getElementById('field_plane_br').hidden = false;
    let fieldOn = null;
    let devMode = false;
    const syncField = () => {
      const on = fieldBox.checked && !devMode;
      setFieldVisible(fieldBox.checked);
      if (on !== fieldOn) { fieldOn = on; host.setField({ on }); }
    };
    host.onFrame((frame) => { if (!!frame.devMode !== devMode) { devMode = !!frame.devMode; syncField(); } });
    fieldBox.addEventListener('change', syncField);
    syncField();
    return;
  }

  // One 30 Hz tick: camera follow, sim step(s), then the readout. Each tick runs
  // SIM_PASSES_PER_TICK sim steps (the first with simDt); ?simPasses=1..5.
  const SIM_PASSES_PER_TICK = (() => {
    const n = Number(new URLSearchParams(location.search).get('simPasses'));
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 1;
  })();

  loop.start((dt) => {
    for (let i = 0; i < SIM_PASSES_PER_TICK; i++) {
      view.set_camera_follow_target(followTarget);
      view.update();
      host.tick({
        dt: i === 0 ? dt : undefined,
        // The main-thread host reads held keys after the scenario frames.
        held: host.kind === 'local' ? heldCommands : heldCommands(),
        present: i === SIM_PASSES_PER_TICK - 1,
        view,
      });
    }
  });
}
