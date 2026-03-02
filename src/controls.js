import * as THREE from 'three';
import { Boat } from './boat.js';
import { range_map } from './utils.js';

let key_bind_list = [];
let key_state = [];

let scenario_descriptor = {};
let players = [];
let physics_frame = 0;

let _map, _getCamera, _bm;

function checkKeyPress(e) {
  e = e || window.event;
  key_state[e.keyCode] = true;
  key_bind_list.forEach(bind => {
    if (bind.type === "KEYDOWN" && key_state[bind.activation_key] && (key_state[bind.prohibition_key] === false || key_state[bind.prohibition_key] === undefined)) {
      bind.object[bind.input_handler]();
    }
  });
}

function checkKeyRelease(e) {
  e = e || window.event;
  key_state[e.keyCode] = false;
}

function mouse_monitor(e) {
  const camera = _getCamera();
  const vec = new THREE.Vector3();
  const pos = new THREE.Vector3();

  vec.set(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1,
    0.5
  );
  vec.unproject(camera);
  vec.sub(camera.position).normalize();

  const distance = -camera.position.z / vec.z;
  pos.copy(camera.position).add(vec.multiplyScalar(distance));

  const vx = _bm.get_field_velocity(pos.x, pos.y).x;
  const vy = _bm.get_field_velocity(pos.x, pos.y).y;
  const wdir = Math.atan2(vy, vx) / Math.PI * 180;
  const wspe = Math.sqrt(vx * vx + vy * vy);

  document.getElementById("wind_info").innerHTML = "Speed: " + Math.floor(wspe * 1000) / 10 + "<br>Direction: " + Math.floor(wdir * 10) / 10;
}

function scenario_clear() {
  scenario_descriptor = {};
  key_bind_list = [];
  players.forEach(player => player.physics_model_deinit());
  players = [];
  physics_frame = 0;
}

function scenario_start(param) {
  scenario_clear();
  scenario_descriptor = param;
}

function autokeybind(players) {
  key_bind_list = [];

  if (players[0] !== undefined) {
    key_bind_list.push({type: "PRESSED", activation_key: 37, prohibition_key: 39, object: players[0], input_handler: players[0].input_rudder_left.name});
    key_bind_list.push({type: "PRESSED", activation_key: 39, prohibition_key: 37, object: players[0], input_handler: players[0].input_rudder_right.name});
    key_bind_list.push({type: "PRESSED", activation_key: 40, prohibition_key: 38, object: players[0], input_handler: players[0].input_autopilot_heading_increase.name});
    key_bind_list.push({type: "PRESSED", activation_key: 38, prohibition_key: 40, object: players[0], input_handler: players[0].input_autopilot_heading_decrease.name});
    key_bind_list.push({type: "KEYDOWN", activation_key: 32, prohibition_key: -1, object: players[0], input_handler: players[0].input_autopilot_enabled_toggle.name});
    key_bind_list.push({type: "KEYDOWN", activation_key: 13, prohibition_key: -1, object: players[0], input_handler: players[0].input_autopilot_tack_toggle.name});
  }

  if (players[1] !== undefined) {
    key_bind_list.push({type: "PRESSED", activation_key: 65, prohibition_key: 68, object: players[1], input_handler: players[1].input_rudder_left.name});
    key_bind_list.push({type: "PRESSED", activation_key: 68, prohibition_key: 65, object: players[1], input_handler: players[1].input_rudder_right.name});
    key_bind_list.push({type: "PRESSED", activation_key: 83, prohibition_key: 87, object: players[1], input_handler: players[1].input_autopilot_heading_increase.name});
    key_bind_list.push({type: "PRESSED", activation_key: 87, prohibition_key: 83, object: players[1], input_handler: players[1].input_autopilot_heading_decrease.name});
    key_bind_list.push({type: "KEYDOWN", activation_key: 17, prohibition_key: -1, object: players[1], input_handler: players[0].input_autopilot_enabled_toggle.name});
    key_bind_list.push({type: "KEYDOWN", activation_key: 16, prohibition_key: -1, object: players[1], input_handler: players[0].input_autopilot_tack_toggle.name});
  }
}

let scenarios = [];

scenarios[0] = [];
scenarios[0][0] = () => { players.push(new Boat(_map, 10, -9, 5 * Math.PI / 4)); };
scenarios[0][1] = () => { console.log(1); players[0].input_autopilot_enabled_toggle(); };
scenarios[0][2] = () => { autokeybind(players); };

scenarios[1] = [];
scenarios[1][0] = () => { players.push(new Boat(_map, 12, -6, 5 * Math.PI / 4)); players.push(new Boat(_map, 15, -11.5, 5 * Math.PI / 4)); };
scenarios[1][1] = () => { console.log(1); players[0].input_autopilot_enabled_toggle(); players[1].input_autopilot_enabled_toggle(); };
scenarios[1][2] = () => { autokeybind(players); };

scenarios[2] = [];
scenarios[2][0] = () => { players.push(new Boat(_map, -10, -6, 3 * Math.PI / 4)); players.push(new Boat(_map, 15, -11.5, 5 * Math.PI / 4)); };
scenarios[2][1] = () => { console.log(1); players[0].input_autopilot_enabled_toggle(); players[1].input_autopilot_enabled_toggle(); };
scenarios[2][2] = () => { autokeybind(players); };
scenarios[2][2000] = () => { scenario_clear(); };

scenarios[3] = [];
scenarios[3][0] = () => { players.push(new Boat(_map, -3, -3, 3 * Math.PI / 4)); players.push(new Boat(_map, 18, -11.5, 5 * Math.PI / 4)); };
scenarios[3][1] = () => { console.log(1); players[0].input_autopilot_enabled_toggle(); players[1].input_autopilot_enabled_toggle(); };
scenarios[3][2] = () => { autokeybind(players); };
scenarios[3][350] = () => { players[0].input_autopilot_tack_toggle(); };
scenarios[3][2000] = () => { scenario_clear(); };

scenarios[4] = [];
scenarios[4][0] = () => { players.push(new Boat(_map, -3, -4, 3 * Math.PI / 4)); players.push(new Boat(_map, 18, -11.5, 5 * Math.PI / 4)); };
scenarios[4][1] = () => { console.log(1); players[0].input_autopilot_enabled_toggle(); players[1].input_autopilot_enabled_toggle(); };
scenarios[4][2] = () => { autokeybind(players); };
scenarios[4][300] = () => { players[0].input_autopilot_tack_toggle(); };
scenarios[4][700] = () => { players[1].input_autopilot_heading_decrease(); };
scenarios[4][701] = () => { players[1].input_autopilot_heading_decrease(); };
scenarios[4][702] = () => { players[1].input_autopilot_heading_decrease(); };
scenarios[4][2000] = () => { scenario_clear(); };

scenarios[5] = [];

export function setupControls(map, getCamera, bm) {
  _map = map;
  _getCamera = getCamera;
  _bm = bm;

  document.onkeydown = checkKeyPress;
  document.onkeyup = checkKeyRelease;

  document.getElementById("camera_follow").checked = false;
  document.getElementById("show_forces").checked = true;
  document.getElementById("show_field").checked = false;

  document.getElementById("show_forces").addEventListener("change", () => {
    map.input_show_forces(document.getElementById("show_forces").checked);
  });

  document.getElementById("scenario_selector").addEventListener("change", () => {
    scenario_start(scenarios[document.getElementById("scenario_selector").value]);
  });

  document.getElementById("scenario_restart").addEventListener("click", () => {
    scenario_start(scenarios[document.getElementById("scenario_selector").value]);
  });

  document.getElementById("show_field").addEventListener("change", () => {
    map.input_show_fields(document.getElementById("show_field").checked);
  });

  document.getElementById("windAngle").addEventListener("change", () => {
    map.bm.direction = parseInt(document.getElementById("windAngle").value) + 180;
  });

  document.getElementById("camera_follow").addEventListener("change", () => {
    map.input_camera_follow(document.getElementById("camera_follow").checked);
  });

  document.getElementById("camera_zoom_in").addEventListener("click", () => { map.input_camera_zoom_relative(-2); });
  document.getElementById("camera_zoom_out").addEventListener("click", () => { map.input_camera_zoom_relative(+2); });
  document.getElementById("camera_move_left").addEventListener("click", () => { map.input_camera_move_relative(-5, 0); });
  document.getElementById("camera_move_right").addEventListener("click", () => { map.input_camera_move_relative(5, 0); });
  document.getElementById("camera_move_up").addEventListener("click", () => { map.input_camera_move_relative(0, 5); });
  document.getElementById("camera_move_down").addEventListener("click", () => { map.input_camera_move_relative(0, -5); });

  document.addEventListener("mousemove", mouse_monitor);

  scenario_start(scenarios[document.getElementById("scenario_selector").value]);
}

export function getPlayers() {
  return players;
}

export function processKeys() {
  key_bind_list.forEach(bind => {
    if (bind.type === "PRESSED" && key_state[bind.activation_key] === true && (key_state[bind.prohibition_key] === false || key_state[bind.prohibition_key] === undefined)) {
      bind.object[bind.input_handler]();
    }
  });
}

export function executeScenarioFrame() {
  if (scenario_descriptor !== undefined && scenario_descriptor[physics_frame] !== undefined) {
    console.log("Frame ", physics_frame);
    scenario_descriptor[physics_frame]();
  }
}

export function getPhysicsFrame() {
  return physics_frame;
}

export function incrementPhysicsFrame() {
  physics_frame++;
}
