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
  configFromRoomState, stringifyRoomConfig, parseAndValidateRoomConfig, roomConfigErrorLine,
  mapKeyFromDims, ROOM_CONFIG_DEFAULTS, ROOM_CONFIG_BASE, rootFromSimRes, defaultRoomConfig,
  scenarioFromQuery, standaloneStartConfig,
} from './room-config.js';
import { windCeilingMps } from './sim-modes.js';
import {
  DEFAULT_MAP_SIZE,
  MAP_SIZES,
  mapDims,
} from './map-size.js';

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

// = / - (and numpad + / -) zoom the camera one step in / out (same step and
// limits as the +/- buttons) in every mode. W / S do the same while one boat
// is bound; with two boats bound they steer the second player's heading
// target, so zoom stays on = / - only.
export const ZOOM_IN_KEY = 87;  // W
export const ZOOM_OUT_KEY = 83; // S
const ZOOM_IN_KEYS = [187, 61, 107];   // = (Chrome, Firefox), numpad +
const ZOOM_OUT_KEYS = [189, 173, 109]; // - (Chrome, Firefox), numpad -
export function zoomKeyStep(keyCode, boundBoats) {
  if (ZOOM_IN_KEYS.includes(keyCode)) return -2;
  if (ZOOM_OUT_KEYS.includes(keyCode)) return +2;
  if (boundBoats > 1) return 0;
  if (keyCode === ZOOM_IN_KEY) return -2;
  if (keyCode === ZOOM_OUT_KEY) return +2;
  return 0;
}

function checkKeyPress(e) {
  e = e || window.event;
  // Letter keys (Q, E) also sit on the settings panel. Ignore them, and the
  // helm keys, while a control has focus so typing does not steer the boat.
  if (typingInControl(e)) return;
  // W / S zoom unless the split layout gives them to player 2.
  const zoom = e.ctrlKey || e.metaKey || e.altKey ? 0 : zoomKeyStep(e.keyCode, splitKeyboard() ? 2 : 1);
  if (zoom && _view) { _view.input_camera_zoom_relative(zoom); return; }
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

// Gamepad (gamepad.js): camera zoom step.
export function zoomCamera(step) { if (_view) _view.input_camera_zoom_relative(step); }

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
// Left / Right are plain helm commands; the autopilot holdoff
// (heading hold some ms after release) lives in the sim (boat.js
// stepHelmHoldoff), so local, worker and server games behave the same.
export function heldCommands() {
  const out = [];
  const seen = new Set();
  const push = (command) => {
    const c = command;
    const k = c.type + '|' + c.boat + '|' + c.dir;
    if (seen.has(k)) return; // keyboard and a pad on the same boat: once
    seen.add(k);
    out.push(c);
  };
  key_bind_list.forEach(bind => {
    if (bind.type === "PRESSED" && key_state[bind.activation_key] === true && (key_state[bind.prohibition_key] === false || key_state[bind.prohibition_key] === undefined)) {
      push(bind.command);
    }
  });
  for (const c of padHeldCommands(_padHeld, _inputMap.pads, _boundBoats)) push(c);
  return out;
}

// Input mapping (Settings → Preferences → Input mapping, src/input-map.js): which
// boat each input device drives when two boats are bound (a second local
// player, or a second own boat in a server room). Boat indices are the
// binding's (0 = player 1, 1 = player 2; the server maps them to the
// client's own boats), so local, worker and server rooms route the same way.
//   keyboard: 'split' (P1 arrows / Space / Enter / , . /, P2 A D W S F G Q E X,
//             the default) or 'boat1' / 'boat2' (the full one-boat layout,
//             arrows / Space / Enter / Q E / X, for that boat; W / S zoom)
//   pads[i]:  'boat1' / 'boat2' for gamepad i + 1 (defaults: pad 1 → boat 1,
//             pad 2 → boat 2)
// With one boat bound, every device drives it; with none (spectating), none.
export const KEYBOARD_TARGETS = ['split', 'boat1', 'boat2'];
export const PAD_TARGETS = ['boat1', 'boat2'];
export const MAX_PADS = 2;
export const DEFAULT_INPUT_MAP = Object.freeze({ keyboard: 'split', pads: Object.freeze(['boat1', 'boat2']) });

export function normalizeInputMap(m) {
  const src = m && typeof m === 'object' ? m : {};
  const keyboard = KEYBOARD_TARGETS.includes(src.keyboard) ? src.keyboard : DEFAULT_INPUT_MAP.keyboard;
  const pads = DEFAULT_INPUT_MAP.pads.map((d, i) => (Array.isArray(src.pads) && PAD_TARGETS.includes(src.pads[i]) ? src.pads[i] : d));
  return { keyboard, pads };
}

// The binding's boat index a device target drives, or -1 for none.
export function targetBoat(target, boats) {
  if (!(boats >= 1)) return -1;
  if (boats === 1) return 0;
  return target === 'boat2' ? 1 : 0;
}

let _inputMap = normalizeInputMap(DEFAULT_INPUT_MAP);
let _onBinding = [];
export function inputMap() { return { keyboard: _inputMap.keyboard, pads: _inputMap.pads.slice() }; }
export function setInputMap(m) {
  const next = normalizeInputMap(m);
  if (next.keyboard !== _inputMap.keyboard) {
    // Keys held under the old layout would stay down under the new one.
    key_state = [];
  }
  _inputMap = next;
  autokeybind(_boundBoats);
}
export function boundBoats() { return _boundBoats; }
// fn(boats): called whenever the key binding changes (bindControls, cleared, input map).
export function onBindingChange(fn) { _onBinding.push(fn); }
function splitKeyboard() { return _boundBoats > 1 && _inputMap.keyboard === 'split'; }

// Gamepads (gamepad.js) do not press keyboard keys: each pad sends its own
// actions, routed by pad index to its mapped boat.
//   held:     left / right (helm), up / down (heading target), read each tick
//   one-shot: autopilot, tack, depower, penaltyCcw, penaltyCw, sent on press
export const PAD_HELD = Object.freeze({
  left: { type: 'helm', dir: -1, not: 'right' },
  right: { type: 'helm', dir: +1, not: 'left' },
  up: { type: 'headingTarget', dir: -1, not: 'down' },
  down: { type: 'headingTarget', dir: +1, not: 'up' },
});
export const PAD_ONESHOT = Object.freeze({
  autopilot: { type: 'autopilot' },
  tack: { type: 'tack' },
  depower: { type: 'depower' },
  penaltyCcw: { type: 'penaltyTurn', dir: 'ccw' },
  penaltyCw: { type: 'penaltyTurn', dir: 'cw' },
});
const _padHeld = Array.from({ length: MAX_PADS }, () => new Set());

// Held commands of the pads (padHeld[i]: Set of PAD_HELD actions). Pure, for tests.
export function padHeldCommands(padHeld, pads, boats) {
  const out = [];
  padHeld.forEach((held, i) => {
    const boat = targetBoat(pads[i], boats);
    if (boat < 0 || !held || !held.size) return;
    for (const [action, c] of Object.entries(PAD_HELD)) {
      if (held.has(action) && !held.has(c.not)) out.push({ type: c.type, boat, dir: c.dir });
    }
  });
  return out;
}
// The command a pad's one-shot action sends, or null (no boat, unknown action).
export function padCommand(pad, action, pads = _inputMap.pads, boats = _boundBoats) {
  const c = PAD_ONESHOT[action];
  const boat = targetBoat(pads[pad], boats);
  if (!c || boat < 0) return null;
  const out = { type: c.type, boat };
  if (c.dir !== undefined) out.dir = c.dir;
  return out;
}
export function setPadAction(pad, action, down) {
  if (!(pad >= 0 && pad < MAX_PADS)) return;
  if (PAD_HELD[action]) {
    const held = _padHeld[pad];
    if (held.has(action) === !!down) return;
    if (down) held.add(action); else held.delete(action);
    heldChanged();
    return;
  }
  if (!down) return;
  const cmd = padCommand(pad, action);
  if (cmd && _host) _host.command(cmd);
}
// Tests (and anything without the full settings DOM): the host commands go to.
export function setInputHost(host) { _host = host; }

// One boat: arrows steer / heading target, Space autopilot, Enter tack, Q / E
// penalty circles, X depower; W / S / = / - zoom. Two boats (a second local
// player, or a client's second boat in a server room) with the keyboard on
// Split (Input mapping, the default): player 1 keeps the arrows, Space,
// Enter and takes , . / for penalty circles and depower; player 2 has A / D
// helm, W / S heading target, F autopilot, G tack, Q / E penalty circles,
// X depower; zoom is = / - only. Keyboard on Boat 1 / Boat 2: the one-boat
// layout for that boat (W / S zoom again). boats: from the bindControls
// event: the scenario's player count (local, worker), or in a server room
// this client's own boats (0 when spectating: no keys at all); "boat 0" is
// then the client's first own boat (the server maps it) and "boat 1" its
// second.

let _boundBoats = 0;
// The key binding list for `boats` bound boats and a keyboard target (see
// KEYBOARD_TARGETS). Pure, for tests.
export function keyBindings(boats, keyboard = 'split') {
  const list = [];
  const P = (key, not, command) => list.push({ type: "PRESSED", activation_key: key, prohibition_key: not, command });
  const K = (key, not, command) => list.push({ type: "KEYDOWN", activation_key: key, prohibition_key: not, command });
  if (!(boats > 0)) return list;
  const split = boats > 1 && keyboard === 'split';
  if (!split) {
    // One full layout for one boat: arrows, Space, Enter, Q / E, X.
    const b = targetBoat(keyboard, boats);
    P(37, 39, { type: "helm", boat: b, dir: -1 });
    P(39, 37, { type: "helm", boat: b, dir: +1 });
    P(40, 38, { type: "headingTarget", boat: b, dir: +1 });
    P(38, 40, { type: "headingTarget", boat: b, dir: -1 });
    K(32, -1, { type: "autopilot", boat: b });
    K(13, -1, { type: "tack", boat: b });
    // Penalty circles: Q counter-clockwise, E clockwise. Separate keys:
    // holding one does not flip the other, and a repeat of the same key does
    // not restart the turn. Depower toggle: X.
    K(81, 69, { type: "penaltyTurn", boat: b, dir: "ccw" });
    K(69, 81, { type: "penaltyTurn", boat: b, dir: "cw" });
    K(88, -1, { type: "depower", boat: b });
    return list;
  }
  // Split: two people on one keyboard.
  P(37, 39, { type: "helm", boat: 0, dir: -1 });
  P(39, 37, { type: "helm", boat: 0, dir: +1 });
  P(40, 38, { type: "headingTarget", boat: 0, dir: +1 });
  P(38, 40, { type: "headingTarget", boat: 0, dir: -1 });
  K(32, -1, { type: "autopilot", boat: 0 });
  K(13, -1, { type: "tack", boat: 0 });
  K(188, 190, { type: "penaltyTurn", boat: 0, dir: "ccw" });
  K(190, 188, { type: "penaltyTurn", boat: 0, dir: "cw" });
  K(191, -1, { type: "depower", boat: 0 });
  P(65, 68, { type: "helm", boat: 1, dir: -1 });
  P(68, 65, { type: "helm", boat: 1, dir: +1 });
  P(83, 87, { type: "headingTarget", boat: 1, dir: +1 });
  P(87, 83, { type: "headingTarget", boat: 1, dir: -1 });
  K(70, -1, { type: "autopilot", boat: 1 });
  K(71, -1, { type: "tack", boat: 1 });
  K(81, 69, { type: "penaltyTurn", boat: 1, dir: "ccw" });
  K(69, 81, { type: "penaltyTurn", boat: 1, dir: "cw" });
  K(88, -1, { type: "depower", boat: 1 });
  return list;
}

function autokeybind(boats) {
  _boundBoats = boats || 0;
  key_bind_list = keyBindings(_boundBoats, _inputMap.keyboard);
  heldChanged();
  for (const fn of _onBinding) fn(_boundBoats);
}
// Bind keys as a bindControls event would (tests).
export function bindKeys(boats) { autokeybind(boats); }

// Sim events: key bindings and scenario camera hints, applied synchronously
// during the step that emits them (as the old in-script DOM calls were).
function onSimEvent(ev) {
  if (ev.type === "bindControls") autokeybind(ev.boats);
  else if (ev.type === "cleared") autokeybind(0);
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

// Every size: the card starts collapsed on the minimap (Group 5 top HUD);
// Show expands the scenario description.
let scenarioCardCollapsed = true;
let _appliedConfig = null;
let _dirty = false;
// Standalone start: settings the page owns over standaloneStartConfig.
const STANDALONE_PAGE_KEYS = ['map_width_m', 'map_height_m', 'root_cell_m', 'steps_per_frame', 'wind_angle_deg', 'wind_speed_mps', 'dev_mode'];
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
// host.admin = { gate, enabled, authed, open }; open = no ADMIN_SECRET on the
// server, everyone may write; no gate (local / worker) = editable.
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
    // admin.open: the server has no ADMIN_SECRET, so everyone may edit.
    state.textContent = !gated ? "" : admin.open ? "Open editing: anyone can change room settings (server has no ADMIN_SECRET)"
      : !admin.enabled ? "Read-only: admin writes disabled (ADMIN_SECRET not set)"
      : admin.authed ? "Logged in as admin" : "Read-only: log in to change room settings";
  }
  const secret = document.getElementById("room_admin_secret");
  const login = document.getElementById("room_admin_login");
  const logout = document.getElementById("room_admin_logout");
  const showLogin = gated && !admin.open && admin.enabled && !admin.authed;
  if (secret) secret.hidden = !showLogin;
  if (login) login.hidden = !showLogin;
  if (logout) logout.hidden = !(gated && !admin.open && admin.authed);
  const ta = roomConfigEl();
  if (ta) ta.readOnly = !can;
  const reset = document.getElementById("room_config_reset");
  if (reset) reset.disabled = !can;
  refreshRoomEditor();
}

// Room tab TOML editor (UI overhaul PR 4): validate as you type, point at the
// line, Apply only when valid and changed, Revert to the live config.
// Non-admins see the live room config read-only (refilled on room events).
function appliedText() { return _appliedConfig ? stringifyRoomConfig(_appliedConfig) : ""; }
export function refreshRoomEditor() {
  const ta = roomConfigEl();
  if (!ta) return;
  const admin = _remote && _host ? _host.admin : null;
  const can = adminCanWrite(admin);
  const text = ta.value;
  const changed = text !== appliedText();
  const v = parseAndValidateRoomConfig(text, { scenarios: _infoScenarios });
  const line = v.error ? roomConfigErrorLine(text, v) : null;
  const check = document.getElementById("room_config_check");
  if (check) {
    check.classList.toggle("bad", !!v.error);
    check.dataset.line = line || "";
    check.textContent = v.error ? (line ? `Line ${line}: ` : "") + v.error
      : !can ? "Live room config (read-only)" : changed ? "Valid · not applied yet" : "Valid · matches the room";
  }
  const mode = document.getElementById("room_config_mode");
  if (mode) {
    mode.textContent = !can ? "Read-only" : _remote ? "Admin · whole room" : "Editing · this page";
    mode.classList.toggle("ro", !can);
  }
  ta.classList.toggle("bad", !!v.error);
  const commit = document.getElementById("room_config_commit");
  if (commit) commit.disabled = !can || !!v.error || !changed;
  const revert = document.getElementById("room_config_revert");
  if (revert) revert.disabled = !can || !changed;
}

function roomConfigEl() { return document.getElementById("room_config"); }

function fillRoomConfigTextarea(cfg) {
  const el = roomConfigEl();
  if (!el) return;
  el.value = stringifyRoomConfig(cfg);
  _dirty = false;
  refreshRoomEditor();
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
    delete _appliedConfig._windSeed;
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
  document.getElementById("show_row_outline").checked = settingDefault("show_row_outline");
  view.input_show_row_outline(settingDefault("show_row_outline"));
  document.getElementById("show_row_lines").checked = settingDefault("show_row_lines");
  view.input_show_row_lines(settingDefault("show_row_lines"));
  document.getElementById("show_rule_labels").checked = settingDefault("show_rule_labels");
  view.input_show_rule_labels(settingDefault("show_rule_labels"));

  _devMode = settingDefault("devmode");
  syncDevModeUi();

  document.getElementById("show_row_outline").addEventListener("change", () => {
    view.input_show_row_outline(document.getElementById("show_row_outline").checked);
  });
  document.getElementById("show_row_lines").addEventListener("change", () => {
    view.input_show_row_lines(document.getElementById("show_row_lines").checked);
  });
  document.getElementById("show_rule_labels").addEventListener("change", () => {
    view.input_show_rule_labels(document.getElementById("show_rule_labels").checked);
  });

  document.getElementById("scenario_card_toggle").addEventListener("click", () => {
    scenarioCardCollapsed = !scenarioCardCollapsed;
    const idx = _appliedConfig ? _appliedConfig.scenario : 0;
    renderScenarioCard(scenarioCardFor(idx), idx);
  });

  document.getElementById("camera_follow").addEventListener("change", () => {
    view.input_camera_follow(document.getElementById("camera_follow").checked);
  });


  document.addEventListener("mousemove", mouse_monitor);

  const ta = roomConfigEl();
  if (ta) ta.addEventListener("input", () => { markDirty(); showRoomError(null); refreshRoomEditor(); });
  const check = document.getElementById("room_config_check");
  // Click the error: select the line it points at.
  if (check && ta) check.addEventListener("click", () => {
    const n = parseInt(check.dataset.line, 10);
    if (!n) return;
    const lines = ta.value.split("\n");
    const start = lines.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(start, start + (lines[n - 1] || "").length);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 16;
    ta.scrollTop = Math.max(0, (n - 3) * lh);
  });
  const revertBtn = document.getElementById("room_config_revert");
  if (revertBtn) revertBtn.addEventListener("click", () => {
    if (_appliedConfig) fillRoomConfigTextarea(_appliedConfig);
    showRoomError(null);
  });

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
    if (parsed.error) { refreshRoomEditor(); return; }
    commitBtn.disabled = true;
    commitRoomConfig(parsed.config).then((r) => {
      if (r && r.error) showRoomError("Server rejected: " + r.error);
      refreshRoomEditor();
    }, (e) => { showRoomError("Server rejected: " + (e && e.message ? e.message : String(e))); refreshRoomEditor(); });
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
    refreshRoomEditor();
  });

  if (_remote) {
    applyRoomState(host.room);
    autokeybind(host.bindings || 0);
  } else {
    // Seed applied config from defaults + host wind/map, then Commit once.
    // The scenario and room settings come from standaloneStartConfig below:
    // the multiplayer default (custom race course) unless the URL names one.
    const seed = {
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
    // Standalone default = the multiplayer default room config (custom race
    // course on the default map, same gusts / refinement / budget), or the
    // explicit ?scenario_selector. Root cell, steps per frame, wind and dev
    // mode stay the page's (map size / ?simRes, host wind, dev toggle).
    {
      const start = standaloneStartConfig(_mapW, _mapH, scenarioFromQuery(location.search));
      const keep = {};
      for (const k of STANDALONE_PAGE_KEYS) keep[k] = seed[k];
      Object.assign(seed, start, keep);
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
