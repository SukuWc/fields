// Client input and settings UI: keyboard and touch keys become Sim commands
// (sim.js), the settings panel sends admin commands, scenario view hints move
// the camera (view.js), and the scenario card shows the Sim's scenario text.
// Everything goes through the SimHost (host.js); no Sim objects here.
import * as THREE from 'three';

let _host, _view, _getCamera;
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
// penalty circles. Boat 1: A / D, W / S, Ctrl, Shift. boats: player count.
// Own-boat play (own-boat.js): the keys drive "boat 0", which the server maps
// to this client's boat.
export function bindKeysForBoats(boats) { autokeybind(boats); }

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
        "Speed: " + Math.floor(w.speed * 10) / 10 + "<br>Direction: " + Math.floor(w.direction * 10) / 10);
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

const DEV_MODE_FLUID_CONTROLS = ["amr", "barrier", "boat_energy", "plotSelect", "contrastSlider", "mirrorSlider"];

function syncDevModeUi() {
  const on = _devMode;
  const banner = document.getElementById("devmode_banner");
  banner.style.display = on ? "block" : "none";
  const fromDeg = _wind.angle;
  const toDeg = (fromDeg + 180) % 360;
  document.getElementById("dev_wind_label").textContent =
    "from " + fromDeg + "° to " + toDeg + "° @ " + _wind.speed;
  // CSS rotation is clockwise; world +Y is up. Point the arrow downwind ("to").
  document.getElementById("dev_wind_arrow").style.transform = "rotate(" + (-toDeg) + "deg)";
  for (const id of DEV_MODE_FLUID_CONTROLS) {
    document.getElementById(id).disabled = on;
  }
}

function applyWindAngle() {
  const angle = parseInt(document.getElementById("windAngle").value, 10);
  if (!Number.isFinite(angle)) return;
  _wind.angle = angle;
  _host.command({ type: "wind", angle });
  syncDevModeUi();
}

function applyWindSpeed() {
  const speed = parseFloat(document.getElementById("windSpeed").value);
  if (!Number.isFinite(speed)) return;
  _wind.speed = speed;
  _host.command({ type: "wind", speed });
  syncDevModeUi();
}

let scenarioCardCollapsed = false;

function renderScenarioCard(scenario) {
  const card = document.getElementById("scenario_card");
  if (!card) return;
  const selector = document.getElementById("scenario_selector");
  const index = selector ? selector.value : "";
  const titleEl = document.getElementById("scenario_card_title");
  const bodyEl = document.getElementById("scenario_card_body");
  const numEl = document.getElementById("scenario_card_num");
  const toggle = document.getElementById("scenario_card_toggle");
  numEl.textContent = index;
  if (scenario && scenario.title) {
    titleEl.textContent = scenario.title;
    bodyEl.textContent = scenario.description || "";
  } else {
    titleEl.textContent = "No scenario";
    bodyEl.textContent = "Nothing is defined for this number. Scenarios 0 through 19 each have a description.";
  }
  card.classList.toggle("collapsed", scenarioCardCollapsed);
  if (toggle) {
    toggle.textContent = scenarioCardCollapsed ? "Show" : "Hide";
    toggle.setAttribute("aria-expanded", scenarioCardCollapsed ? "false" : "true");
  }
}

function scenario_start(index) {
  _host.command({ type: "restart", scenario: index }).then(renderScenarioCard);
}

// host: a SimHost (host.js) whose info is ready.
export function setupControls(host, view, getCamera) {
  _host = host;
  _view = view;
  _getCamera = getCamera;
  host.on(onSimEvent);
  const info = host.info;
  _wind.angle = info.wind.from;
  _wind.speed = info.wind.speed;

  document.onkeydown = checkKeyPress;
  document.onkeyup = checkKeyRelease;

  document.getElementById("camera_follow").checked = false;
  document.getElementById("show_forces").checked = false;
  document.getElementById("show_field").checked = false;

  document.getElementById("windAngle").value = info.wind.from;
  document.getElementById("windSpeed").value = info.wind.speed;
  // Query-string settings, including ?devmode=1, are applied by installUrlSettings
  // after these listeners exist. Leave the checkbox at its default so that
  // default can be captured; the change listener below turns dev mode on.
  _devMode = false;
  host.command({ type: "devMode", on: false });
  syncDevModeUi();

  document.getElementById("devmode").addEventListener("change", () => {
    _devMode = document.getElementById("devmode").checked;
    host.command({ type: "devMode", on: _devMode });
    syncDevModeUi();
  });

  document.getElementById("show_forces").addEventListener("change", () => {
    view.input_show_forces(document.getElementById("show_forces").checked);
  });

  document.getElementById("scenario_card_toggle").addEventListener("click", () => {
    scenarioCardCollapsed = !scenarioCardCollapsed;
    const selector = document.getElementById("scenario_selector");
    const index = selector ? parseInt(selector.value, 10) : 0;
    renderScenarioCard(info.scenarios[index]);
  });

  document.getElementById("scenario_selector").addEventListener("change", () => {
    scenario_start(document.getElementById("scenario_selector").value);
  });

  document.getElementById("scenario_restart").addEventListener("click", () => {
    scenario_start(document.getElementById("scenario_selector").value);
  });

  document.getElementById("show_field").addEventListener("change", () => {
    view.input_show_fields(document.getElementById("show_field").checked);
  });

  document.getElementById("windAngle").addEventListener("change", applyWindAngle);
  document.getElementById("windSpeed").addEventListener("change", applyWindSpeed);

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

  scenario_start(document.getElementById("scenario_selector").value);
}
