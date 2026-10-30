// Client input and settings UI: keyboard and touch keys become Sim commands
// (sim.js), the room settings panel (#admin_panel) is a TOML textarea
// (room-config.js) with Commit / Reset, scenario view hints move the camera
// (view.js), and the scenario card shows the Sim's scenario text.
// Everything goes through the SimHost (host.js); no Sim objects here.
//
// Local and worker modes: the page owns the Sim; Commit applies the TOML
// (and may reload when map size changes). Remote mode: the room's state is
// the truth — the textarea starts from the welcome snapshot and follows
// every 'room' event unless the user has unsaved edits. Reset fills the
// default TOML preset (ROOM_CONFIG_DEFAULTS, map size kept as the room's
// current size); it is local only and does not push to the server.
import * as THREE from 'three';
import { settingDefault } from './settings-registry.js';
import {
  configFromRoomState, stringifyRoomConfig, parseAndValidateRoomConfig,
  mapKeyFromDims, ROOM_CONFIG_DEFAULTS, ROOM_CONFIG_BASE, rootFromSimRes, defaultRoomConfig,
} from './room-config.js';
import { windCeilingMps } from './sim-modes.js';
import { MAP_SIZES, DEFAULT_MAP_SIZE, mapDims } from './map-size.js';

let _host, _view, _getCamera;
let _remote = false;
// Client copies of what this module last told the host (dev mode, UI wind),
// for the dev-mode banner.
let _devMode = false;
const _wind = { angle: 90, speed: 15 };

// Key bindings for the current scenario: [{ type: "PRESSED" | "KEYDOWN",
// activation_key, prohibition_key, command }]. PRESSED bindings are held keys
// (helm, heading target), sent to sim.step once per tick; KEYDOWN bindings
// send a one-shot command on press.
let key_bind_list = [];
// Remote mode sends held keys when they change instead of every tick.
let _onHeldChange = null;
export function onHeldChange(fn) { _onHeldChange = fn; }
function heldChanged() { if (_onHeldChange) _onHeldChange(); }

// Cursor wind readout (#wind_info). In remote mode the page only updates on
// server frames, so the answer is held until flushFrameUi() (per frame).
let _deferUi = false;
let _pendingWindInfo = null;
export function deferUiToFrames(on) { _deferUi = !!on; }
function setWindInfo(html) {
  if (_deferUi) { _pendingWindInfo = html; return; }
  document.getElementById("wind_info").innerHTML = html;
}
export function flushFrameUi() {
  if (_pendingWindInfo === null) return;
  document.getElementById("wind_info").innerHTML = _pendingWindInfo;
  _pendingWindInfo = null;
}
let key_state = [];

function typingInControl(e) {
  const target = e && e.target;
  if (!target || !target.tagName) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function fireKeydown(match) {
  key_bind_list.forEach(bind => {
    if (bind.type === "KEYDOWN" && match(bind) && (key_state[bind.prohibition_key] === false || key_state[bind.prohibition_key] === undefined)) {
      _host.command(bind.command);
    }
  });
}

function checkKeyPress(e) {
  e = e || window.event;
  // Letter keys (Q, E) also sit on the settings panel. Ignore them, and the
  // helm keys, while a control has focus so typing does not steer the boat.
  if (typingInControl(e)) return;
  const was = key_state[e.keyCode];
  key_state[e.keyCode] = true;
  fireKeydown(bind => key_state[bind.activation_key]);
  if (was !== true) heldChanged();
}

function checkKeyRelease(e) {
  e = e || window.event;
  key_state[e.keyCode] = false;
  heldChanged();
}

// Touch controls press the same keys. Held keys (helm, heading) are read by
// heldCommands each tick; KEYDOWN bindings fire once on press, as a real key.
export function setVirtualKey(keyCode, down) {
  if (!down) {
    key_state[keyCode] = false;
    heldChanged();
    return;
  }
  if (key_state[keyCode] === true) return;
  key_state[keyCode] = true;
  fireKeydown(bind => bind.activation_key === keyCode);
  heldChanged();
}

// Held boat commands for this tick, in binding order (sim.step reads them
// after the scenario frames, where the old processKeys ran).
export function heldCommands() {
  const out = [];
  key_bind_list.forEach(bind => {
    if (bind.type === "PRESSED" && key_state[bind.activation_key] === true && (key_state[bind.prohibition_key] === false || key_state[bind.prohibition_key] === undefined)) {
      out.push(bind.command);
    }
  });
  return out;
}

// Boat 0: arrows steer / heading target, Space autopilot, Enter tack, Q / E
// penalty circles. Boat 1: A / D, W / S, Ctrl, Shift. boats: from the
// bindControls event: the scenario's player count (local, worker), or in a
// server room this client's own boats (0 when spectating: no keys at all);
// "boat 0" is then the client's own boat (the server maps it).

function autokeybind(boats) {
  key_bind_list = [];
  const P = (key, not, command) => key_bind_list.push({ type: "PRESSED", activation_key: key, prohibition_key: not, command });
  const K = (key, not, command) => key_bind_list.push({ type: "KEYDOWN", activation_key: key, prohibition_key: not, command });
  if (boats > 0) {
    P(37, 39, { type: "helm", boat: 0, dir: -1 });
    P(39, 37, { type: "helm", boat: 0, dir: +1 });
    P(40, 38, { type: "headingTarget", boat: 0, dir: +1 });
    P(38, 40, { type: "headingTarget", boat: 0, dir: -1 });
    K(32, -1, { type: "autopilot", boat: 0 });
    K(13, -1, { type: "tack", boat: 0 });
    // Q counter-clockwise, E clockwise. Separate keys: holding one does not
    // flip the other, and a repeat of the same key does not restart the turn.
    K(81, 69, { type: "penaltyTurn", boat: 0, dir: "ccw" });
    K(69, 81, { type: "penaltyTurn", boat: 0, dir: "cw" });
    // X: depower toggle (D is boat 2's rudder).
    K(88, -1, { type: "depower", boat: 0 });
  }
  if (boats > 1) {
    P(65, 68, { type: "helm", boat: 1, dir: -1 });
    P(68, 65, { type: "helm", boat: 1, dir: +1 });
    P(83, 87, { type: "headingTarget", boat: 1, dir: +1 });
    P(87, 83, { type: "headingTarget", boat: 1, dir: -1 });
    K(17, -1, { type: "autopilot", boat: 1 });
    K(16, -1, { type: "tack", boat: 1 });
  }
  heldChanged();
}

// Sim events: key bindings and scenario camera hints, applied synchronously
// during the step that emits them (as the old in-script DOM calls were).
function onSimEvent(ev) {
  if (ev.type === "bindControls") autokeybind(ev.boats);
  else if (ev.type === "cleared") { key_bind_list = []; heldChanged(); }
  else if (ev.type === "view") {
    if (ev.follow) {
      const follow = document.getElementById('camera_follow');
      if (follow && !follow.checked) {
        follow.checked = true;
        follow.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (Number.isFinite(ev.zoom)) _view.camera_zoom = ev.zoom;
  }
}

function mouse_monitor(e) {
  if (_devMode) {
    _host.query({ type: "wind", x: 0, y: 0 }).then((w) => {
      setWindInfo(
        "Speed: " + Math.floor(w.speed * 10) / 10 + " m/s<br>Direction: " + Math.floor(w.direction * 10) / 10);
    });
    return;
  }

  const camera = _getCamera();
  const vec = new THREE.Vector3();
  const pos = new THREE.Vector3();

  // The canvas can be the top half of the window (touch controls).
  const canvas = document.getElementById("sim_canvas");
  const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  vec.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
    0.5
  );
  vec.unproject(camera);
  vec.sub(camera.position).normalize();

  const distance = -camera.position.z / vec.z;
  pos.copy(camera.position).add(vec.multiplyScalar(distance));

  _host.query({ type: "fieldVelocity", x: pos.x, y: pos.y }).then(({ x: vx, y: vy }) => {
    const wdir = Math.atan2(vy, vx) / Math.PI * 180;
    const wspe = Math.sqrt(vx * vx + vy * vy);
    setWindInfo("Speed: " + Math.floor(wspe * 1000) / 10 + "<br>Direction: " + Math.floor(wdir * 10) / 10);
  });
}

function syncDevModeUi() {
  const on = _devMode;
  const banner = document.getElementById("devmode_banner");
  if (banner) banner.style.display = on ? "block" : "none";
  const fromDeg = _wind.angle;
  const toDeg = (fromDeg + 180) % 360;
  const label = document.getElementById("dev_wind_label");
  if (label) label.textContent = "from " + fromDeg + "° to " + toDeg + "° @ " + _wind.speed + " m/s";
  // CSS rotation is clockwise; world +Y is up. Point the arrow downwind ("to").
  const arrow = document.getElementById("dev_wind_arrow");
  if (arrow) arrow.style.transform = "rotate(" + (-toDeg) + "deg)";
}

// Kept for callers (main.js); the wind inputs lived on the old admin panel.
export function setWindCeiling(mps) {
  _windCeiling = Number.isFinite(mps) ? mps : _windCeiling;
}
let _windCeiling = windCeilingMps('2f');

let scenarioCardCollapsed = false;
let _appliedConfig = null;
let _dirty = false;
let _mapW = ROOM_CONFIG_DEFAULTS.map_width_m;
let _mapH = ROOM_CONFIG_DEFAULTS.map_height_m;
let _onLattice = null;
let _infoScenarios = [];
// sessionStorage key: room TOML committed just before a local map-size reload.
const PENDING_TOML_KEY = "sailzone_pending_room_toml";

// Title / description for the card: numbered from info, custom from the TOML.
function scenarioCardFor(idx) {
  if (idx === "custom") {
    const c = (_appliedConfig && _appliedConfig.custom) || (_host && _host.room && _host.room.settings && _host.room.settings.custom);
    return c ? { title: c.title || "Custom course", description: c.description || "" } : null;
  }
  return _infoScenarios[idx];
}

export function onRoomLattice(fn) { _onLattice = fn; }

function renderScenarioCard(scenario, index) {
  const card = document.getElementById("scenario_card");
  if (!card) return;
  const titleEl = document.getElementById("scenario_card_title");
  const bodyEl = document.getElementById("scenario_card_body");
  const numEl = document.getElementById("scenario_card_num");
  const toggle = document.getElementById("scenario_card_toggle");
  if (numEl) numEl.textContent = index == null ? "" : String(index);
  if (scenario && scenario.title) {
    titleEl.textContent = scenario.title;
    bodyEl.textContent = scenario.description || "";
  } else {
    titleEl.textContent = "No scenario";
    bodyEl.textContent = "Nothing is defined for this number. Scenarios 0 through 22 each have a description.";
  }
  card.classList.toggle("collapsed", scenarioCardCollapsed);
  if (toggle) {
    toggle.textContent = scenarioCardCollapsed ? "Show" : "Hide";
    toggle.setAttribute("aria-expanded", scenarioCardCollapsed ? "false" : "true");
  }
}

export function showRoomError(msg) {
  const el = document.getElementById("admin_status");
  if (!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
}

// Remote admin gate (server ADMIN_SECRET): read-only until logged in.
// host.admin = { gate, enabled, authed }; no gate (local / worker) = editable.
export function adminCanWrite(admin) {
  return !admin || !admin.gate || (admin.enabled && admin.authed);
}

export function updateAdminUi() {
  const admin = _remote && _host ? _host.admin : null;
  const gated = !!(admin && admin.gate);
  const can = adminCanWrite(admin);
  const box = document.getElementById("room_admin_auth");
  if (box) box.style.display = gated ? "flex" : "none";
  const state = document.getElementById("room_admin_state");
  if (state) {
    state.textContent = !gated ? "" : !admin.enabled ? "Read-only: admin writes disabled (ADMIN_SECRET not set)"
      : admin.authed ? "Logged in as admin" : "Read-only: log in to change room settings";
  }
  const secret = document.getElementById("room_admin_secret");
  const login = document.getElementById("room_admin_login");
  const logout = document.getElementById("room_admin_logout");
  const showLogin = gated && admin.enabled && !admin.authed;
  if (secret) secret.hidden = !showLogin;
  if (login) login.hidden = !showLogin;
  if (logout) logout.hidden = !(gated && admin.authed);
  const ta = roomConfigEl();
  if (ta) ta.readOnly = !can;
  for (const id of ["room_config_commit", "room_config_reset"]) {
    const b = document.getElementById(id);
    if (b) b.disabled = !can;
  }
}

function roomConfigEl() { return document.getElementById("room_config"); }

function fillRoomConfigTextarea(cfg) {
  const el = roomConfigEl();
  if (!el) return;
  el.value = stringifyRoomConfig(cfg);
  _dirty = false;
}

function currentConfigFromHost(room) {
  const mapW = (_host && _host.info && _host.info.mapW) || _mapW;
  const mapH = (_host && _host.info && _host.info.mapH) || _mapH;
  if (room) return configFromRoomState(room, { mapW, mapH });
  if (_host && _host.room) return configFromRoomState(_host.room, { mapW, mapH });
  // Local: synthesise from last applied + host info wind.
  const base = _appliedConfig ? { ..._appliedConfig } : { ...ROOM_CONFIG_BASE };
  base.map_width_m = mapW;
  base.map_height_m = mapH;
  base.wind_angle_deg = _wind.angle;
  base.wind_speed_mps = _wind.speed;
  base.dev_mode = _devMode;
  return base;
}

function markDirty() { _dirty = true; }

/** Apply a validated config via the atomic `config` room command (or locally). */
function commitRoomConfig(cfg) {
  const mapKey = cfg._mapKey || mapKeyFromDims(cfg.map_width_m, cfg.map_height_m);
  // Local map-size change: reload the page (lattice / walls / texture at load).
  if (!_remote && mapKey && (cfg.map_width_m !== _mapW || cfg.map_height_m !== _mapH)) {
    const u = new URL(location.href);
    u.searchParams.delete('mapSize');
    u.searchParams.delete('simRes');
    u.searchParams.delete('map_size');
    u.searchParams.delete('map_width_m');
    u.searchParams.delete('map_height_m');
    if (mapKey !== DEFAULT_MAP_SIZE) u.searchParams.set('map_size', mapKey);
    // Carry the committed TOML (e.g. a custom layout) over the reload.
    try { sessionStorage.setItem(PENDING_TOML_KEY, stringifyRoomConfig(cfg)); } catch (e) { /* storage off */ }
    location.href = u.toString();
    return Promise.resolve({ reloading: true });
  }
  return _host.command({ type: 'config', config: cfg }).then((r) => {
    if (r && r.error) return r;
    _appliedConfig = { ...cfg };
    delete _appliedConfig._mapKey;
    delete _appliedConfig._simRes;
    delete _appliedConfig._custom;
    _wind.angle = cfg.wind_angle_deg;
    _wind.speed = cfg.wind_speed_mps;
    _devMode = !!cfg.dev_mode;
    setWindCeiling(windCeilingMps(cfg._simRes));
    syncDevModeUi();
    const idx = cfg.scenario;
    const sc = scenarioCardFor(idx) || (r && r.title ? r : null);
    renderScenarioCard(sc || (_host.room && _host.room.scenario), idx);
    if (!_remote && r && r.lattice && _onLattice) _onLattice(r.lattice, r);
    fillRoomConfigTextarea(_appliedConfig);
    showRoomError(null);
    return r;
  });
}

export function applyRoomState(room) {
  if (!room) return;
  const st = room.settings || {};
  const cfg = configFromRoomState(room, { mapW: _mapW, mapH: _mapH });
  if (st.wind) {
    _wind.angle = st.wind.angle;
    _wind.speed = st.wind.speed;
  }
  _devMode = !!st.devMode;
  syncDevModeUi();
  renderScenarioCard(room.scenario && room.scenario.index !== null ? room.scenario : null,
    room.scenario && room.scenario.index !== null ? room.scenario.index : null);
  _appliedConfig = cfg;
  // Refresh the textarea unless the user has unsaved edits (typing or Reset).
  if (!_dirty) fillRoomConfigTextarea(cfg);
  setWindCeiling(windCeilingMps(cfg._simRes || (st.simRes)));
}

// host: a SimHost (host.js) whose info is ready.
export function setupControls(host, view, getCamera) {
  _host = host;
  _view = view;
  _getCamera = getCamera;
  _remote = host.kind === "remote";
  host.on(onSimEvent);
  if (_remote) host.on((ev) => { if (ev.type === "room") { applyRoomState(ev.room); showRoomError(null); } });
  // Live map resize in a server room: the TOML and Reset use the new size.
  if (_remote) host.on((ev) => { if (ev.type === "mapSize") { _mapW = ev.mapW; _mapH = ev.mapH; } });
  const info = host.info;
  _infoScenarios = info.scenarios || [];
  _mapW = info.mapW;
  _mapH = info.mapH;
  _wind.angle = info.wind.from;
  _wind.speed = info.wind.speed;

  document.onkeydown = checkKeyPress;
  document.onkeyup = checkKeyRelease;

  document.getElementById("camera_follow").checked = settingDefault("camera_follow");
  document.getElementById("show_forces").checked = settingDefault("show_forces");
  document.getElementById("show_field").checked = settingDefault("show_field");
  view.input_show_fields(settingDefault("show_field"));

  _devMode = settingDefault("devmode");
  syncDevModeUi();

  document.getElementById("show_forces").addEventListener("change", () => {
    view.input_show_forces(document.getElementById("show_forces").checked);
  });

  document.getElementById("scenario_card_toggle").addEventListener("click", () => {
    scenarioCardCollapsed = !scenarioCardCollapsed;
    const idx = _appliedConfig ? _appliedConfig.scenario : 0;
    renderScenarioCard(scenarioCardFor(idx), idx);
  });

  document.getElementById("show_field").addEventListener("change", () => {
    view.input_show_fields(document.getElementById("show_field").checked);
  });

  document.getElementById("camera_follow").addEventListener("change", () => {
    view.input_camera_follow(document.getElementById("camera_follow").checked);
  });

  document.getElementById("camera_zoom_in").addEventListener("click", () => { view.input_camera_zoom_relative(-2); });
  document.getElementById("camera_zoom_out").addEventListener("click", () => { view.input_camera_zoom_relative(+2); });
  document.getElementById("camera_move_left").addEventListener("click", () => { view.input_camera_move_relative(-5, 0); });
  document.getElementById("camera_move_right").addEventListener("click", () => { view.input_camera_move_relative(5, 0); });
  document.getElementById("camera_move_up").addEventListener("click", () => { view.input_camera_move_relative(0, 5); });
  document.getElementById("camera_move_down").addEventListener("click", () => { view.input_camera_move_relative(0, -5); });

  document.addEventListener("mousemove", mouse_monitor);

  const ta = roomConfigEl();
  if (ta) ta.addEventListener("input", markDirty);

  const loginBtn = document.getElementById("room_admin_login");
  const secretEl = document.getElementById("room_admin_secret");
  const doLogin = () => {
    if (!_host || typeof _host.login !== "function") return;
    const v = secretEl ? secretEl.value : "";
    if (!v.trim()) { showRoomError("Enter the admin secret"); return; }
    _host.login(v).then((r) => {
      if (secretEl) secretEl.value = "";
      showRoomError(r && r.error ? (r.error === "unauthorized" ? "Wrong admin secret" : r.error) : null);
      updateAdminUi();
    });
  };
  if (loginBtn) loginBtn.addEventListener("click", doLogin);
  if (secretEl) secretEl.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); e.stopPropagation(); });
  const logoutBtn = document.getElementById("room_admin_logout");
  if (logoutBtn) logoutBtn.addEventListener("click", () => {
    if (_host && typeof _host.logout === "function") _host.logout().then(() => { showRoomError(null); updateAdminUi(); });
  });
  if (_remote && typeof host.onAdmin === "function") host.onAdmin(() => updateAdminUi());
  updateAdminUi();

  const commitBtn = document.getElementById("room_config_commit");
  if (commitBtn) commitBtn.addEventListener("click", () => {
    if (!adminCanWrite(_remote && _host ? _host.admin : null)) { showRoomError("Log in as admin to change room settings"); return; }
    const text = ta ? ta.value : "";
    // Scenario fit uses the TOML map size (local Commit may reload onto it).
    const parsed = parseAndValidateRoomConfig(text, { scenarios: _infoScenarios });
    if (parsed.error) { showRoomError(parsed.error); return; }
    commitRoomConfig(parsed.config).then((r) => {
      if (r && r.error) showRoomError(r.error);
    });
  });

  const resetBtn = document.getElementById("room_config_reset");
  if (resetBtn) resetBtn.addEventListener("click", () => {
    if (!adminCanWrite(_remote && _host ? _host.admin : null)) return;
    // Default preset; keep the room's current map size (fixed on the server).
    // Local only — does not Commit. Mark dirty so a peer's room event does
    // not overwrite the preset before the user Commits.
    const cfg = defaultRoomConfig(_mapW, _mapH);
    const el = roomConfigEl();
    if (el) { el.value = stringifyRoomConfig(cfg); _dirty = true; }
    showRoomError(null);
  });

  if (_remote) {
    applyRoomState(host.room);
    autokeybind(host.bindings || 0);
  } else {
    // Seed applied config from defaults + host wind/map, then Commit once so
    // the sim starts on scenario 0 (and any TOML-equivalent defaults).
    const seed = {
      // Local solo keeps scenario 0; the custom course is the remote default.
      ...ROOM_CONFIG_BASE,
      map_width_m: _mapW,
      map_height_m: _mapH,
      wind_angle_deg: _wind.angle,
      wind_speed_mps: _wind.speed,
    };
    // Pull live settings when the host exposes them (LocalHost.core /
    // remote welcome). Otherwise derive root cell from the map size default.
    if (host.core && host.core.roomState) {
      Object.assign(seed, configFromRoomState(host.core.roomState(), { mapW: _mapW, mapH: _mapH }));
    } else if (host.room) {
      Object.assign(seed, configFromRoomState(host.room, { mapW: _mapW, mapH: _mapH }));
    } else {
      const key = mapKeyFromDims(_mapW, _mapH);
      const mode = (key && mapDims(key) && mapDims(key).simRes) || '2f';
      const root = rootFromSimRes(mode);
      seed.root_cell_m = root.root_cell_m;
      seed.steps_per_frame = root.steps_per_frame;
    }
    // A TOML committed right before a map-size reload wins over the seed.
    let pending = null;
    try { pending = sessionStorage.getItem(PENDING_TOML_KEY); sessionStorage.removeItem(PENDING_TOML_KEY); } catch (e) { /* storage off */ }
    if (pending) {
      const p = parseAndValidateRoomConfig(pending, { scenarios: _infoScenarios });
      if (!p.error && p.config.map_width_m === _mapW && p.config.map_height_m === _mapH) Object.assign(seed, p.config);
    }
    _appliedConfig = seed;
    fillRoomConfigTextarea(seed);
    commitRoomConfig(seed);
  }
}
