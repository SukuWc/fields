import * as THREE from 'three';
import { Boat } from './boat.js';
import { resetContacts } from './rules.js';
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
  if (_map.devMode) {
    const w = _map.get_wind(0, 0);
    document.getElementById("wind_info").innerHTML =
      "Speed: " + Math.floor(w.speed * 10) / 10 + "<br>Direction: " + Math.floor(w.direction * 10) / 10;
    return;
  }

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

const DEV_MODE_FLUID_CONTROLS = ["amr", "barrier", "boat_energy", "plotSelect", "contrastSlider", "mirrorSlider"];

function syncDevModeUi() {
  const on = _map.devMode;
  const banner = document.getElementById("devmode_banner");
  banner.style.display = on ? "block" : "none";
  const wind = _map.constantWind;
  const fromDeg = wind.angleDeg;
  const toDeg = (fromDeg + 180) % 360;
  document.getElementById("dev_wind_label").textContent =
    "from " + fromDeg + "° to " + toDeg + "° @ " + wind.speed;
  // CSS rotation is clockwise; world +Y is up. Point the arrow downwind ("to").
  document.getElementById("dev_wind_arrow").style.transform = "rotate(" + (-toDeg) + "deg)";
  for (const id of DEV_MODE_FLUID_CONTROLS) {
    document.getElementById(id).disabled = on;
  }
}

function applyWindAngle() {
  const angle = parseInt(document.getElementById("windAngle").value, 10);
  if (!Number.isFinite(angle)) return;
  _map.wind_direction = angle;
  _map.bm.direction = angle + 180;
  _map.constantWind.setAngle(angle);
  syncDevModeUi();
}

function applyWindSpeed() {
  const speed = parseFloat(document.getElementById("windSpeed").value);
  if (!Number.isFinite(speed)) return;
  _map.wind_speed = speed;
  _map.bm.speed = speed / 100;
  _map.constantWind.setSpeed(speed);
  syncDevModeUi();
}

function scenario_clear() {
  scenario_descriptor = {};
  key_bind_list = [];
  players.forEach(player => player.physics_model_deinit());
  players = [];
  physics_frame = 0;
  resetContacts();
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

// Rule 13 demo. Wind-from defaults to +Y. Both boats start starboard
// close-hauled and overlapped, inside the 12 m gate, so the pair is Rule 11
// until boat 0 tacks. Frame 90 is an animation frame (the scenario clock
// follows the display refresh). Enter tacks boat 0 again; Shift tacks boat 1.
// While her |TWA| is still under 40° the pair is Rule 13: green to the
// stand-on boat, red to the tacker. Once she is close-hauled on the new tack
// the pair is Rule 10. Dev mode keeps the wind steady:
// ?devmode=1&scenario_selector=6
scenarios[6] = [];
scenarios[6][0] = () => {
  // 8 m to starboard of boat 0. Hull clearance is about 6.5 m, so the pair
  // starts inside the 12 m gate and overlapped (Rule 11) without the hulls
  // touching. A closer start was bouncing them through head to wind.
  const heading = 5 * Math.PI / 4;
  const fx = Math.sin(heading);
  const fy = -Math.cos(heading);
  const abeam = 8;
  players.push(new Boat(_map, 0, 0, heading));
  players.push(new Boat(_map, fy * abeam, -fx * abeam, heading));
};
scenarios[6][1] = () => {
  players[0].input_autopilot_enabled_toggle();
  players[1].input_autopilot_enabled_toggle();
};
scenarios[6][2] = () => {
  autokeybind(players);
  const follow = document.getElementById('camera_follow');
  if (follow && !follow.checked) {
    follow.checked = true;
    follow.dispatchEvent(new Event('change', { bubbles: true }));
  }
  _map.camera_zoom = 18;
};
scenarios[6][90] = () => { players[0].input_autopilot_tack_toggle(); };

// Leeward boat tacks from port onto starboard, into a port-starboard collision.
// Wind-from defaults to +Y. Both start on port close-hauled. Boat 1 is upwind
// (higher Y) and well to port, so she is the windward boat and boat 0, to
// leeward, is the one that tacks. Boat 1 bears away onto a port beam reach and
// sails across. While boat 0 is short of close-hauled on starboard the pair is
// Rule 13 and she is give-way. Once |TWA| reaches 40° she is starboard, boat 1
// is still on port, and the reach meets her hull: Rule 10, port give-way, and
// the hulls touch. The scenario clock is animation frames. Dev mode:
// ?devmode=1&scenario_selector=7
scenarios[7] = [];
scenarios[7][0] = () => {
  // Both port close-hauled. Boat 1 is upwind and to port (windward).
  // Boat 0, to leeward, is the one that tacks.
  const heading = 3 * Math.PI / 4;
  players.push(new Boat(_map, 0, 0, heading));
  // Far enough to port that the reach arrives only after the leeward boat is
  // close-hauled on starboard, and low enough that the hulls meet.
  players.push(new Boat(_map, -18.8, 5.15, heading));
};
scenarios[7][1] = () => {
  players[0].input_autopilot_enabled_toggle();
  players[1].input_autopilot_enabled_toggle();
};
scenarios[7][2] = () => {
  autokeybind(players);
  const follow = document.getElementById('camera_follow');
  if (follow && !follow.checked) {
    follow.checked = true;
    follow.dispatchEvent(new Event('change', { bubbles: true }));
  }
  _map.camera_zoom = 16;
};
// Windward boat bears away onto a port beam reach (TWA 90°) so she sails
// across the leeward boat's starboard course instead of climbing away.
scenarios[7][6] = () => {
  for (let n = 0; n < 40; n++) players[1].input_autopilot_heading_increase();
};
scenarios[7][36] = () => { players[0].input_autopilot_tack_toggle(); };

// Rule 15 demo. Wind-from defaults to +Y. Both boats start starboard
// close-hauled. Boat 0 is clear ahead; boat 1 is clear astern and to
// leeward, hulls already inside 8 m, so the pair opens on Rule 12. Boat 1's
// motor drives her up alongside. She stays the leeward boat, so the overlap
// gives her right of way under Rule 11 by her own move. That is Rule 15,
// blocking Rule 11, for one simulation second (the amber bar under the label
// shrinks as it runs out), then Rule 11 on its own. Dev mode:
// ?devmode=1&scenario_selector=8
scenarios[8] = [];
scenarios[8][0] = () => {
  const heading = 5 * Math.PI / 4;
  const fx = Math.sin(heading);
  const fy = -Math.cos(heading);
  // Astern along -forward, and to leeward (lower Y) so she draws alongside
  // instead of into the transom. 4.4 m along-track leaves her bow behind
  // the stern line; 2.5 m abeam keeps about a metre of water when she overlaps.
  const along = 4.4;
  const abeam = 2.5;
  const lx = -fy;
  const ly = fx;
  players.push(new Boat(_map, 0, 0, heading));
  players.push(new Boat(_map, -fx * along + lx * abeam, -fy * along + ly * abeam, heading));
};
scenarios[8][1] = () => {
  players[0].input_autopilot_enabled_toggle();
  players[1].input_autopilot_enabled_toggle();
};
scenarios[8][2] = () => {
  autokeybind(players);
  const follow = document.getElementById('camera_follow');
  if (follow && !follow.checked) {
    follow.checked = true;
    follow.dispatchEvent(new Event('change', { bubbles: true }));
  }
  _map.camera_zoom = 14;
};
// physics_model_step clears motor_input, so each scenario frame sets it
// again. Direct write keeps the autopilot on (input_motor_forward turns it off).
for (let frame = 8; frame <= 200; frame++) {
  scenarios[8][frame] = () => { players[1].motor_input = 1; };
}

// Rule 15 contact. Same start as scenario 8, but the trailer is close enough
// abeam that her bow meets the leader's hull as the overlap begins. She gains
// right of way by that move, so the contact falls inside the Rule 15 window
// and the new right-of-way boat is at fault. Dev mode:
// ?devmode=1&scenario_selector=9
scenarios[9] = [];
scenarios[9][0] = () => {
  const heading = 5 * Math.PI / 4;
  const fx = Math.sin(heading);
  const fy = -Math.cos(heading);
  // Opens on Rule 12. At 0.35 m abeam the bow meets the leader on the
  // same station where the overlap begins, so the contact is inside the
  // Rule 15 window and she is still the leeward boat.
  const along = 4.4;
  const abeam = 0.35;
  const lx = -fy;
  const ly = fx;
  players.push(new Boat(_map, 0, 0, heading));
  players.push(new Boat(_map, -fx * along + lx * abeam, -fy * along + ly * abeam, heading));
};
scenarios[9][1] = () => {
  players[0].input_autopilot_enabled_toggle();
  players[1].input_autopilot_enabled_toggle();
};
scenarios[9][2] = () => {
  autokeybind(players);
  const follow = document.getElementById('camera_follow');
  if (follow && !follow.checked) {
    follow.checked = true;
    follow.dispatchEvent(new Event('change', { bubbles: true }));
  }
  _map.camera_zoom = 14;
};
for (let frame = 8; frame <= 220; frame++) {
  scenarios[9][frame] = () => { players[1].motor_input = 1; };
}

export function setupControls(map, getCamera, bm) {
  _map = map;
  _getCamera = getCamera;
  _bm = bm;

  document.onkeydown = checkKeyPress;
  document.onkeyup = checkKeyRelease;

  document.getElementById("camera_follow").checked = false;
  document.getElementById("show_forces").checked = false;
  document.getElementById("show_field").checked = false;

  document.getElementById("windAngle").value = map.wind_direction;
  document.getElementById("windSpeed").value = map.wind_speed;
  // Query-string settings, including ?devmode=1, are applied by installUrlSettings
  // after these listeners exist. Leave the checkbox at its default so that
  // default can be captured; the change listener below turns dev mode on.
  map.setDevMode(false);
  syncDevModeUi();

  document.getElementById("devmode").addEventListener("change", () => {
    map.setDevMode(document.getElementById("devmode").checked);
    syncDevModeUi();
  });

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

  document.getElementById("windAngle").addEventListener("change", applyWindAngle);
  document.getElementById("windSpeed").addEventListener("change", applyWindSpeed);

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
