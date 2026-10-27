import * as THREE from 'three';
import { FixedStepLoop } from './loop.js';

import { initRenderer, startAnimation, renderNow, getCamera, setFluidPlaneSize, setFieldVisible, setFlowGrid, setTracerParams, getTracerParams, updateBoatTrails, setTrailParams, setBoatTrailsOn, setGhostParams } from './renderer.js';
import { setupControls, setWindCeiling, heldCommands, onHeldChange, deferUiToFrames, flushFrameUi, onRoomLattice } from './controls.js';
import { LocalHost } from './host.js';
import { buildScene } from './scene-build.js';
import { WorkerHost } from './worker-host.js';
import { RemoteHost } from './remote-host.js';
import { hostChoice } from './host-choice.js';
import { setupOwnBoat } from './own-boat.js';
import { setupBoatStats } from './boat-stats-panel.js';
import { View } from './view.js';
import { installUrlSettings } from './url-settings.js';
import { settingDefault, urlSettingIds, SUBSCRIPTION_IDS } from './settings-registry.js';
import { applySettingDefaults } from './settings-panel.js';
import { setInfo, flushInfo } from './info.js';
import { setupPerfOverlay, isPerfOverlayOn, recordFieldStep, perfOverlayFrame } from './perf-overlay.js';
import { setupMobileMenu } from './mobile-menu.js';
import { setupTouchControls } from './touch-controls.js';
import { setupChat } from './chat-panel.js';
import { windCeilingMps } from './sim-modes.js';

import { MAP_SIZES, DEFAULT_MAP_SIZE, mapSizeFromQuery, fitMapSize, cameraLimits } from './map-size.js';



// Map size (src/map-size.js): width × length in metres, length along the
// wind (Y). ?map_size=100x200 or the #map_size select; changing it reloads.
// A scenario that does not fit the asked size gets the smallest that does.
const _query = new URLSearchParams(location.search);
const _askedMapSize = mapSizeFromQuery(location.search);
const _scenarioParam = Number(_query.get('scenario_selector')) || 0;
const mapSizeKey = fitMapSize(_scenarioParam, _askedMapSize);
const mapSizeClamped = mapSizeKey !== _askedMapSize;
// A server room has its own size (its creator's); the page takes it from
// host.info once connected (startClient), so these may change there.
let map_w = MAP_SIZES[mapSizeKey].w;
let map_h = MAP_SIZES[mapSizeKey].h;
// UI wind, and the uniform wind used while dev mode is on.
// Angle is where the wind comes from: 0 = from +X, 90 = from +Y (blows toward −Y).
// Speed is true-wind speed (the value boats report as TWS).
// Defaults: settings-registry.js.
const wind_angle = settingDefault('windAngle');
const wind_speed = settingDefault('windSpeed'); // m/s (old UI 15)
// Control defaults and ranges from the registry, before anything reads them.
applySettingDefaults();
const bm_resolution = 1;
// Level 3 cells are dx = 0.125. The speed plot stamps oversampling*dx pixels,
// and a fractional stamp collapses several fine nodes onto one texel (the
// coarse blocks inside the inner disk). 8 lands each level-3 node on one texel.
const texture_oversampling = 8;

// Data texture for fluid field visualisation
function makeTexture(w, h) {
  const side1 = texture_oversampling * w * bm_resolution;
  const side2 = texture_oversampling * h * bm_resolution;
  const tex = new THREE.DataTexture(new Uint8Array(side1 * side2 * 4), side1, side2, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
let dataTextureMaterial = makeTexture(map_w, map_h);

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
  hasWorker: typeof Worker === 'function', envHost: _env.VITE_SIM_HOST, envServer: _env.VITE_SIM_SERVER_URL, loc: location,
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
// A random token per server URL (the room is in the URL), kept in
// localStorage so a reload is the same client to the server.
function clientToken(server) {
  const key = 'fields.clientToken:' + server;
  try {
    let t = localStorage.getItem(key);
    if (!t || !/^[A-Za-z0-9_-]{8,64}$/.test(t)) {
      t = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');
      localStorage.setItem(key, t);
    }
    return t;
  } catch {
    return null;
  }
}
let host = null;
try {
  if (_hostChoice.kind === 'worker') {
    host = new WorkerHost(_hostOpts, dataTextureMaterial, { maxInFlight: Number.isInteger(_workerQueue) && _workerQueue >= 0 && _query.has('workerQueue') ? _workerQueue : 4 });
  } else if (_hostChoice.kind === 'remote') {
    // scenario: loaded by the server only if this page creates the room.
    // token: this page's id in the room across drops and reloads (the
    // server keeps its boat for a grace period); reconnect: retry with backoff.
    host = new RemoteHost(_hostChoice.server, { ..._hostOpts, scenario: _scenarioParam }, dataTextureMaterial, { token: clientToken(_hostChoice.server), reconnect: true });
  }
} catch (e) {
  console.warn('sim ' + _hostChoice.kind + ' host unavailable, running on the main thread', e);
  host = null;
}
if (!host) host = makeLocalHost();
if (typeof window !== 'undefined') window.__simHost = host;
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
  // Remote: a server room (host.info: the size it was created with), its
  // room settings (host.room) and this client's role come from the server.
  const remote = host.kind === 'remote';
  if (remote && (host.info.mapW !== map_w || host.info.mapH !== map_h)) {
    map_w = host.info.mapW;
    map_h = host.info.mapH;
    dataTextureMaterial = makeTexture(map_w, map_h);
    planeMat.map = dataTextureMaterial;
    planeMat.needsUpdate = true;
    host.setTexture(dataTextureMaterial);
  }
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
  initRenderer({ width: map_w, height: map_h }, planeMat, view);
  let lattice = remote && host.room ? host.room.lattice : host.info.lattice;
  setFluidPlaneSize(lattice.w, lattice.h);
  // Local Commit that rebuilds the lattice (simRes / refine / amr layout).
  onRoomLattice((l) => {
    if (!l) return;
    if (l.w !== lattice.w || l.h !== lattice.h) { lattice = l; setFluidPlaneSize(l.w, l.h); dataTextureMaterial.needsUpdate = true; }
    else dataTextureMaterial.needsUpdate = true;
  });
  if (remote) {
    // Connection banner: shown while the server connection is down and
    // being retried; "Reconnected" briefly once the welcome is back.
    const banner = document.getElementById('conn_banner');
    let hideTimer = null;
    host.onStatus((st) => {
      if (!banner) return;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (st.status === 'reconnecting') {
        banner.classList.remove('ok');
        banner.textContent = 'Disconnected from the sim server · reconnecting in ' + Math.max(1, Math.round(st.inMs / 1000)) + ' s (attempt ' + st.attempt + ')';
        banner.hidden = false;
      } else if (st.status === 'disconnected') {
        banner.classList.remove('ok');
        banner.textContent = 'Disconnected from the sim server';
        banner.hidden = false;
      } else if (st.status === 'connected' && st.again) {
        banner.classList.add('ok');
        banner.textContent = 'Reconnected';
        banner.hidden = false;
        hideTimer = setTimeout(() => { banner.hidden = true; }, 1500);
      }
    });
    document.getElementById('admin_scope').hidden = false;
    // A room-wide change (any client's): the grid may have been rebuilt.
    host.on((ev) => {
      if (ev.type !== 'room' || !ev.room.lattice) return;
      const l = ev.room.lattice;
      if (l.w !== lattice.w || l.h !== lattice.h) { lattice = l; setFluidPlaneSize(l.w, l.h); dataTextureMaterial.needsUpdate = true; }
    });
  }
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
  setupChat(host);
  // Flow tracer inputs (count, life, tail): live, and before installUrlSettings
  // so ?tracers / ?tracerLife / ?tracerTail arrive through these listeners.
  {
    const num = (id) => { const el = document.getElementById(id); const v = el ? parseFloat(el.value) : NaN; return Number.isFinite(v) ? v : undefined; };
    const applyTracers = () => {
      setTracerParams({ count: num('tracers') || null, lifetime: num('tracerLife'), tail: num('tracerTail') });
      const el = document.getElementById('tracers');
      if (el) el.placeholder = 'auto ' + getTracerParams().count;
    };
    for (const id of ['tracers', 'tracerLife', 'tracerTail']) {
      const el = document.getElementById(id);
      if (el) { el.addEventListener('change', applyTracers); el.addEventListener('input', applyTracers); }
    }
    applyTracers();
  }
  // Boat trail toggle and inputs (dot interval, kept duration, dot size):
  // live, before installUrlSettings like the tracer inputs.
  {
    const num = (id) => { const el = document.getElementById(id); const v = el ? parseFloat(el.value) : NaN; return Number.isFinite(v) ? v : undefined; };
    const box = document.getElementById('boat_trails');
    const applyTrails = () => {
      setBoatTrailsOn(!box || box.checked);
      setTrailParams({ interval: num('trailInterval'), duration: num('trailDuration'), size: num('trailSize') });
    };
    for (const id of ['boat_trails', 'trailInterval', 'trailDuration', 'trailSize']) {
      const el = document.getElementById(id);
      if (el) { el.addEventListener('change', applyTrails); el.addEventListener('input', applyTrails); }
    }
    applyTrails();
  }
  // Ghost boat toggle and lookahead (?ghost=0, ?ghostAhead=s): live.
  {
    const box = document.getElementById('ghost');
    const ahead = document.getElementById('ghostAhead');
    const applyGhost = () => {
      const v = ahead ? parseFloat(ahead.value) : NaN;
      setGhostParams({ on: !box || box.checked, ahead: Number.isFinite(v) ? v : undefined });
    };
    for (const el of [box, ahead]) if (el) { el.addEventListener('change', applyGhost); el.addEventListener('input', applyGhost); }
    applyGhost();
  }
  // Room settings (TOML) are committed from controls.js. Player URL params
  // still sync via installUrlSettings; old room query keys (?simRes, ?amr, …)
  // are no longer applied.
  // Before installUrlSettings so ?perf=1 turns the overlay on through its change listener.
  // Counters: live from the main-thread host, else the latest frame's.
  let lastFrame = null;
  // Remote mode (server clock) is event-driven: the overlay closes a frame per
  // server frame instead of running its own rAF loop.
  const remoteDriven = host.kind === 'remote' && host.mode !== 'client';
  setupPerfOverlay(() => (host.perfStats ? host.perfStats() : lastFrame && lastFrame.perf) || null, { external: remoteDriven });
  document.getElementById(SUBSCRIPTION_IDS.perf).addEventListener('change', (e) => host.setPerf(e.target.checked));
  // Before installUrlSettings: the device default must be the checkbox default.
  setupTouchControls();
  installUrlSettings(undefined, { ids: urlSettingIds({ remote }) });
  setWindCeiling(windCeilingMps(_simResKey));
  if (mapSizeClamped) console.info(`map_size ${_askedMapSize} is too small for scenario ${_scenarioParam}; using ${mapSizeKey}`);
  setupMobileMenu();

  // Flow tracers: a per-client subscription in a server room (the server
  // samples the wind grid only for clients showing them).
  if (host.setFlow) {
    const box = document.getElementById(SUBSCRIPTION_IDS.flow);
    host.setFlow(box.checked);
    box.addEventListener('change', () => host.setFlow(box.checked));
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

  // Readout and HUD panels built from the frame state (hud.js hudFromState).
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
  // sim.players[0], whose position a step sets), or this client's own boat
  // in a server room. Cleared with the scenario.
  let followTarget;
  let ownBoatId = null;
  // Boat stats panel (#boat_stats): own boat only in a server room.
  const boatStats = setupBoatStats({ remote: host.kind === 'remote', lockstep: () => host.mode === 'client' });
  setupOwnBoat(host, (ids) => { ownBoatId = ids[0] || null; boatStats.setOwnId(ownBoatId); });
  host.on((ev) => { if (ev.type === 'cleared') followTarget = undefined; });
  host.onFrame((frame) => {
    lastFrame = frame;
    devMode = frame.devMode;
    // In a remote room with an own boat, follow that one.
    const mine = ownBoatId && frame.spawned ? frame.spawned.find((b) => b.id === ownBoatId) : null;
    followTarget = mine || (ownBoatId ? undefined : frame.boat0) || undefined;
    if (frame.fieldSteps > 0 && isPerfOverlayOn()) recordFieldStep(frame.fieldMs);
    if (frame.state && frame.statics) {
      // The readout shows this client's own boat in a server room.
      const scene = buildScene(frame.state, frame.statics, view, ownBoatId);
      if (scene.hud) applyHud(scene.hud);
      currentGuides = scene.guides;
      frameBodies = scene.bodies;
    }
    if (frame.fieldReady) dataTextureMaterial.needsUpdate = true;
    if (frame.flow) setFlowGrid(frame.flow);
    if (frame.state) updateBoatTrails(frame.state, frame.statics);
    if (frame.state) boatStats.onFrame(frame.state);
  });

  if (remoteDriven) {
    // Remote (server clock): nothing runs on a local clock. Each server frame
    // (handled above: readout, HUD, guides, perf counters, field texture)
    // moves the camera, closes a perf-overlay frame and draws once; held keys
    // and the camera go to the server when they change.
    const sendInput = () => host.sendInput({ held: heldCommands() });
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
    const fieldBox = document.getElementById(SUBSCRIPTION_IDS.field);
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
