import * as THREE from 'three';
import { FixedStepLoop } from './loop.js';

import { initRenderer, startAnimation, renderNow, getCamera, setFluidPlaneSize, setFieldVisible, setFlowGrid, setTracerParams, getTracerParams, updateBoatTrails, setTrailParams, setBoatTrailsOn, setGhostParams } from './renderer.js';
import { setupControls, setWindCeiling, heldCommands, onHeldChange, deferUiToFrames, flushFrameUi, showRoomError } from './controls.js';
import { LocalHost } from './host.js';
import { buildScene } from './scene-build.js';
import { WorkerHost } from './worker-host.js';
import { RemoteHost } from './remote-host.js';
import { hostChoice } from './host-choice.js';
import { setupOwnBoat } from './own-boat.js';
import { setupBoatStats } from './boat-stats-panel.js';
import { View } from './view.js';
import { installUrlSettings } from './url-settings.js';
import { roomCommandFor, settingDefault, urlSettingIds, SUBSCRIPTION_IDS } from './settings-registry.js';
import { applySettingDefaults } from './settings-panel.js';
import { setInfo, flushInfo } from './info.js';
import { setupPerfOverlay, isPerfOverlayOn, recordFieldStep, perfOverlayFrame } from './perf-overlay.js';
import { setupMobileMenu } from './mobile-menu.js';
import { setupTouchControls } from './touch-controls.js';
import { setupChat } from './chat-panel.js';
import { windCeilingMps } from './sim-modes.js';

import { MAP_SIZES, DEFAULT_MAP_SIZE, mapSizeFromQuery, fitMapSize, scenarioFits, cameraLimits } from './map-size.js';



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
  // The barrier listener has to exist before URL settings dispatch change events.
  initRenderer({ width: map_w, height: map_h }, planeMat, view);
  // Room commands answer { error } when a server refuses them.
  const roomCommand = (c) => host.command(c).then((r) => { if (r && r.error) showRoomError(r.error); return r; });
  document.getElementById('barrier').addEventListener('change', e => roomCommand(roomCommandFor({ barrier: e.target.checked })));
  let lattice = remote && host.room ? host.room.lattice : host.info.lattice;
  setFluidPlaneSize(lattice.w, lattice.h);
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
    // The map size is the room's (set when it was created).
    document.getElementById('map_size_row').hidden = true;
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
  // Simulation resolution (#simRes, ?simRes=2 / 4). Rebuilds the root lattice
  // in place (every module keeps the same bm), drops the refinement windows,
  // resizes the field plane, and restarts the scenario like the Restart button.
  // Before installUrlSettings so a query value goes through this listener.
  // Fast-wind options ("2f", "4f") use a coarse root cell but step it every
  // frame: stepsPerFrame is explicit, see Boltzmann._build.
  // SIM_RES_MODES lives in sim-modes.js (the settings registry's simRes values).
  // Remote: the server rebuilds, restarts and sends the new lattice to
  // every client (the room event above).
  document.getElementById('simRes').addEventListener('change', (e) => {
    setWindCeiling(windCeilingMps(e.target.value));
    if (remote) { roomCommand(roomCommandFor({ simRes: e.target.value })); return; }
    hostCommand(roomCommandFor({ simRes: e.target.value }), (r) => {
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
    if (remote) return;
    if (!mapSizeLive || v === mapSizeKey || !MAP_SIZES[v]) return;
    reloadWithMapSize(v);
  });
  // A scenario picked in the app that does not fit this map reloads on the
  // smallest size that fits (course scenarios 12-17 need 100 × 200).
  document.getElementById('scenario_selector').addEventListener('change', (e) => {
    const n = Number(e.target.value) || 0;
    // Remote: the server refuses a scenario that does not fit the room.
    if (remote) return;
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
  // stack, 100k on x2 / 2f, 200k on x4 / 4f).
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
      roomCommand(roomCommandFor({ cellBudgetTune: tune.checked, cellBudget: num.value.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null }));
    };
    tune.addEventListener('change', apply);
    num.addEventListener('change', apply);
    // Remote: one command per edit, not per keystroke; nothing on join.
    if (!remote) { num.addEventListener('input', apply); apply(); }
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
      if (remote) { roomCommand(roomCommandFor({ amrMode: e.target.value })); return; }
      hostCommand(roomCommandFor({ amrMode: e.target.value }), (r) => {
        if (!r.rebuilt) return;
        dataTextureMaterial.needsUpdate = true;
        document.getElementById('scenario_restart').click();
      });
    });
  }
  // Sail wake gain (#sailWakeGain): live, no restart. Local: applied at load
  // (URL values arrive as change events); remote: only on an edit.
  {
    const el = document.getElementById('sailWakeGain');
    const apply = () => { const n = Number(String(el.value).trim()); if (String(el.value).trim() !== '' && Number.isFinite(n)) roomCommand(roomCommandFor({ sailWakeGain: n })); };
    el.addEventListener('change', apply);
    if (!remote) apply();
  }
  // Field skip (#fieldSkip): room-wide keyframe cadence for remote field streaming.
  // 0 = every frame, N = send every (N + 1) ticks. Hidden in local/worker (no server stream).
  {
    const el = document.getElementById('fieldSkip');
    const row = document.getElementById('fieldSkip_row');
    const br = document.getElementById('fieldSkip_br');
    if (!remote) {
      if (row) row.hidden = true;
      if (br) br.hidden = true;
    } else if (el) {
      if (el.value === '') el.value = String(settingDefault('fieldSkip'));
      const apply = () => {
        const t = String(el.value).trim();
        const n = Number(t);
        if (t !== '' && Number.isFinite(n)) roomCommand(roomCommandFor({ fieldSkip: n }));
      };
      el.addEventListener('change', apply);
    }
  }
  // Boat refinement stack (#maxLevel, #boatRefineRadius; empty = the mode
  // default). One 'refine' command per edit; a rebuilt lattice restarts.
  {
    const ml = document.getElementById('maxLevel');
    const rr = document.getElementById('boatRefineRadius');
    const num = (el) => { const t = String(el.value).trim(); const n = Number(t); return t !== '' && Number.isFinite(n) ? n : null; };
    const apply = () => {
      const c = roomCommandFor({ maxLevel: num(ml) === null ? null : Math.round(num(ml)), boatRefineRadius: num(rr) });
      if (remote) { roomCommand(c); return; }
      hostCommand(c, (r) => {
        if (!r || !r.rebuilt) return;
        dataTextureMaterial.needsUpdate = true;
        document.getElementById('scenario_restart').click();
      });
    };
    ml.addEventListener('change', apply);
    rr.addEventListener('change', apply);
  }
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
  // simRes default follows the map size (map-size.js). Set before
  // installUrlSettings so that is the default it compares against.
  document.getElementById('simRes').value = MAP_SIZES[mapSizeKey].simRes;
  // The mode's explicit stepsPerFrame (fast-wind defaults such as '4f') was
  // applied by the host at startup (SimCore, a 'simRes' command).
  // Remote: the room settings panel follows the server, not the URL.
  installUrlSettings(undefined, { ids: urlSettingIds({ remote }) });
  setWindCeiling(windCeilingMps(document.getElementById('simRes').value));
  // After installUrlSettings: show the size in use (a clamp or a legacy
  // ?mapSize) and write it to the URL; equal to mapSizeKey, so no reload.
  if (!remote && (mapSizeSel.value !== mapSizeKey || _query.has('mapSize'))) {
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
  // Remote: only on an edit (the room has its own values).
  for (const id of ['amr', 'boat_energy', 'ladder']) {
    const el = document.getElementById(id);
    if (!remote) host.command(roomCommandFor({ [id]: el.checked }));
    el.addEventListener('change', () => { roomCommand(roomCommandFor({ [id]: el.checked })); });
  }
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
