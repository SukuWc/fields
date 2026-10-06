import * as THREE from 'three';
import { Boat } from './boat.js';
import { chargePendingPenalty, resetContacts } from './rules.js';
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

let scenarioCardCollapsed = false;

function makeScenario(title, description) {
  return { title, description, frames: [] };
}

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
    bodyEl.textContent = "Nothing is defined for this number. Scenarios 0 through 10 each have a description.";
  }
  card.classList.toggle("collapsed", scenarioCardCollapsed);
  if (toggle) {
    toggle.textContent = scenarioCardCollapsed ? "Show" : "Hide";
    toggle.setAttribute("aria-expanded", scenarioCardCollapsed ? "false" : "true");
  }
}

function scenario_start(scenario) {
  scenario_clear();
  scenario_descriptor = scenario && scenario.frames ? scenario.frames : {};
  renderScenarioCard(scenario);
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
    // Q counter-clockwise, E clockwise. Separate keys: holding one does not
    // flip the other, and a repeat of the same key does not restart the turn.
    key_bind_list.push({type: "KEYDOWN", activation_key: 81, prohibition_key: 69, object: players[0], input_handler: players[0].input_penalty_turn_ccw.name});
    key_bind_list.push({type: "KEYDOWN", activation_key: 69, prohibition_key: 81, object: players[0], input_handler: players[0].input_penalty_turn_cw.name});
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

scenarios[0] = makeScenario(
  "Single boat on autopilot",
  "One boat is placed on starboard close-hauled, with the wind from +Y. Autopilot turns on and steers her. There is no second boat, so no racing-rule line is drawn. Arrow keys, Space, and Enter are bound to her."
);
scenarios[0].frames[0] = () => { players.push(new Boat(_map, 10, -9, 5 * Math.PI / 4)); };
scenarios[0].frames[1] = () => { console.log(1); players[0].input_autopilot_enabled_toggle(); };
scenarios[0].frames[2] = () => { autokeybind(players); };

scenarios[1] = makeScenario(
  "Same tack, clear astern",
  "Two boats start on starboard close-hauled. One is clear ahead and the other is clear astern and to leeward, already inside 12 m. The pair opens on Rule 12: the boat clear ahead has right of way, and the boat clear astern must keep clear. Autopilot is turned on for both."
);
scenarios[1].frames[0] = () => { players.push(new Boat(_map, 12, -6, 5 * Math.PI / 4)); players.push(new Boat(_map, 15, -11.5, 5 * Math.PI / 4)); };
scenarios[1].frames[1] = () => { console.log(1); players[0].input_autopilot_enabled_toggle(); players[1].input_autopilot_enabled_toggle(); };
scenarios[1].frames[2] = () => { autokeybind(players); };

scenarios[2] = makeScenario(
  "Opposite tacks, far apart",
  "A port-tack boat and a starboard-tack boat start well apart, outside the 12 m gate, so no rule line is drawn, and their headings take them toward each other. Autopilot turns on for both, and the script removes the boats later. While they are still on opposite tacks and inside 12 m, Rule 10 gives the starboard boat right of way and the port-tack boat must keep clear."
);
scenarios[2].frames[0] = () => { players.push(new Boat(_map, -10, -6, 3 * Math.PI / 4)); players.push(new Boat(_map, 15, -11.5, 5 * Math.PI / 4)); };
scenarios[2].frames[1] = () => { console.log(1); players[0].input_autopilot_enabled_toggle(); players[1].input_autopilot_enabled_toggle(); };
scenarios[2].frames[2] = () => { autokeybind(players); };
scenarios[2].frames[2000] = () => { scenario_clear(); };

scenarios[3] = makeScenario(
  "Crossing, then the port boat tacks",
  "A port-tack boat and a starboard-tack boat start on autopilot and close with each other. Partway through, the port boat's autopilot heading is reversed so she tacks. The script removes both boats later. This is a crossing with a tack, and it leaves the outcome to the boats rather than a scored collision."
);
scenarios[3].frames[0] = () => { players.push(new Boat(_map, -3, -3, 3 * Math.PI / 4)); players.push(new Boat(_map, 18, -11.5, 5 * Math.PI / 4)); };
scenarios[3].frames[1] = () => { console.log(1); players[0].input_autopilot_enabled_toggle(); players[1].input_autopilot_enabled_toggle(); };
scenarios[3].frames[2] = () => { autokeybind(players); };
scenarios[3].frames[350] = () => { players[0].input_autopilot_tack_toggle(); };
scenarios[3].frames[2000] = () => { scenario_clear(); };

scenarios[4] = makeScenario(
  "Tack, then a small head-up",
  "A port-tack boat and a starboard-tack boat start on autopilot, in the same kind of layout as scenario 3. The port boat's heading target is reversed so she tacks, and then the other boat heads up by three degrees. The script removes both boats later."
);
scenarios[4].frames[0] = () => { players.push(new Boat(_map, -3, -4, 3 * Math.PI / 4)); players.push(new Boat(_map, 18, -11.5, 5 * Math.PI / 4)); };
scenarios[4].frames[1] = () => { console.log(1); players[0].input_autopilot_enabled_toggle(); players[1].input_autopilot_enabled_toggle(); };
scenarios[4].frames[2] = () => { autokeybind(players); };
scenarios[4].frames[300] = () => { players[0].input_autopilot_tack_toggle(); };
scenarios[4].frames[700] = () => { players[1].input_autopilot_heading_decrease(); };
scenarios[4].frames[701] = () => { players[1].input_autopilot_heading_decrease(); };
scenarios[4].frames[702] = () => { players[1].input_autopilot_heading_decrease(); };
scenarios[4].frames[2000] = () => { scenario_clear(); };

scenarios[5] = makeScenario(
  "Empty template",
  "No boats are placed. This number is a blank slot for a new scenario. The water, wind, and camera stay as they are."
);

// Rule 13 demo. Wind-from defaults to +Y. Both boats start starboard
// close-hauled and overlapped, inside the 12 m gate, so the pair is Rule 11
// until boat 0 tacks. Frame 90 is an animation frame (the scenario clock
// follows the display refresh). Enter tacks boat 0 again; Shift tacks boat 1.
// While her |TWA| is still under 40° the pair is Rule 13: green to the
// stand-on boat, red to the tacker. Once she is close-hauled on the new tack
// the pair is Rule 10. Dev mode keeps the wind steady:
// ?devmode=1&scenario_selector=6
scenarios[6] = makeScenario(
  "Tack through Rule 13 into Rule 10",
  "Both boats start on starboard close-hauled and overlapped, inside 12 m, so the pair opens on Rule 11. Boat 0 then tacks: Rule 13 applies while she is short of close-hauled, and she must keep clear. Once she is close-hauled on the new tack she is on port, the other boat is still on starboard, and Rule 10 applies. Enter tacks boat 0 again; Shift tacks boat 1."
);
scenarios[6].frames[0] = () => {
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
scenarios[6].frames[1] = () => {
  players[0].input_autopilot_enabled_toggle();
  players[1].input_autopilot_enabled_toggle();
};
scenarios[6].frames[2] = () => {
  autokeybind(players);
  const follow = document.getElementById('camera_follow');
  if (follow && !follow.checked) {
    follow.checked = true;
    follow.dispatchEvent(new Event('change', { bubbles: true }));
  }
  _map.camera_zoom = 18;
};
scenarios[6].frames[90] = () => { players[0].input_autopilot_tack_toggle(); };

// Leeward boat tacks from port onto starboard, into a port-starboard collision.
// Wind-from defaults to +Y. Both start on port close-hauled. Boat 1 is upwind
// (higher Y) and well to port, so she is the windward boat and boat 0, to
// leeward, is the one that tacks. Boat 1 bears away onto a port beam reach and
// sails across. While boat 0 is short of close-hauled on starboard the pair is
// Rule 13 and she is give-way. Once |TWA| reaches 40° she is starboard, boat 1
// is still on port, and the reach meets her hull: Rule 10, port give-way, and
// the hulls touch. The scenario clock is animation frames. Dev mode:
// ?devmode=1&scenario_selector=7
scenarios[7] = makeScenario(
  "Rule 10 collision, port boat at fault",
  "Both boats start on port close-hauled; the windward boat bears away onto a port beam reach and sails across, and the leeward boat tacks to gain starboard. Rule 13 applies during the tack. On reaching close-hauled, Rule 15 briefly blocks Rule 10. Then Rule 10 applies and the port-tack boat collides and gets the fault. She keeps the FAULT badge until one full turn. Steer her with A and D. Q and E are boat 0's autopilot circles; scenario 10 starts boat 0 already charged so you can try them."
);
scenarios[7].frames[0] = () => {
  // Both port close-hauled. Boat 1 is upwind and to port (windward).
  // Boat 0, to leeward, is the one that tacks.
  const heading = 3 * Math.PI / 4;
  players.push(new Boat(_map, 0, 0, heading));
  // Far enough to port that the reach arrives only after the leeward boat is
  // close-hauled on starboard, and low enough that the hulls meet.
  players.push(new Boat(_map, -18.8, 5.15, heading));
};
scenarios[7].frames[1] = () => {
  players[0].input_autopilot_enabled_toggle();
  players[1].input_autopilot_enabled_toggle();
};
scenarios[7].frames[2] = () => {
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
scenarios[7].frames[6] = () => {
  for (let n = 0; n < 40; n++) players[1].input_autopilot_heading_increase();
};
scenarios[7].frames[36] = () => { players[0].input_autopilot_tack_toggle(); };

// Rule 15 demo. Wind-from defaults to +Y. Both boats start starboard
// close-hauled. Boat 0 is clear ahead; boat 1 is clear astern and to
// leeward, hulls already inside 8 m, so the pair opens on Rule 12. Boat 1's
// motor drives her up alongside. She stays the leeward boat, so the overlap
// gives her right of way under Rule 11 by her own move. That is Rule 15,
// blocking Rule 11, for one simulation second (the amber bar under the label
// shrinks as it runs out), then Rule 11 on its own. Dev mode:
// ?devmode=1&scenario_selector=8
scenarios[8] = makeScenario(
  "Rule 15 from clear astern",
  "Both boats start on starboard close-hauled, one clear ahead and the other clear astern and to leeward, already inside 8 m, so the pair opens on Rule 12. The trailer motors up alongside and stays to leeward, so she gains right of way under Rule 11 by her own move. Rule 15 blocks Rule 11 for one second, the amber bar shrinking as it runs out, then Rule 11 stands on its own. About a metre of water remains alongside, so this run is the overlap rather than a contact."
);
scenarios[8].frames[0] = () => {
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
scenarios[8].frames[1] = () => {
  players[0].input_autopilot_enabled_toggle();
  players[1].input_autopilot_enabled_toggle();
};
scenarios[8].frames[2] = () => {
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
  scenarios[8].frames[frame] = () => { players[1].motor_input = 1; };
}

// Rule 15 contact. Same start as scenario 8, but the trailer is close enough
// abeam that her bow meets the leader's hull as the overlap begins. She gains
// right of way by that move, so the contact falls inside the Rule 15 window
// and the new right-of-way boat is at fault. Dev mode:
// ?devmode=1&scenario_selector=9
scenarios[9] = makeScenario(
  "Contact during Rule 15",
  "The boats start as in scenario 8, but the trailer is only a fraction of a metre abeam, still clear astern, so the pair opens on Rule 12. She motors up and her bow meets the leader on the same station where the overlap begins, while she is still the leeward boat. That contact falls inside the Rule 15 window. The new right-of-way boat is at fault."
);
scenarios[9].frames[0] = () => {
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
scenarios[9].frames[1] = () => {
  players[0].input_autopilot_enabled_toggle();
  players[1].input_autopilot_enabled_toggle();
};
scenarios[9].frames[2] = () => {
  autokeybind(players);
  const follow = document.getElementById('camera_follow');
  if (follow && !follow.checked) {
    follow.checked = true;
    follow.dispatchEvent(new Event('change', { bubbles: true }));
  }
  _map.camera_zoom = 14;
};
for (let frame = 8; frame <= 220; frame++) {
  scenarios[9].frames[frame] = () => { players[1].motor_input = 1; };
}

// One boat, already charged, so the 360 can be sailed without waiting for a
// collision. Wind-from defaults to +Y. She starts on a starboard beam reach
// with way on. The FAULT badge stays until one circle. Q and E are boat 0.
// Dev mode: ?devmode=1&scenario_selector=10
scenarios[10] = makeScenario(
  "Penalty turn, one pending fault",
  "Boat 0 starts with one pending penalty. The red FAULT badge stays until she turns a full circle, gybes and tacks included. Sail it with the left and right arrows, or press Q for an autopilot circle counter-clockwise and E for clockwise. One circle clears one penalty; a second fault would need a second circle. Left or right arrow, up or down arrow, Enter, or Space cancels the autopilot turn and gives you the helm. Holding Q or E does not restart it."
);
scenarios[10].frames[0] = () => {
  // Starboard beam reach (TWA -90°) with way on, in open water.
  const heading = -Math.PI / 2;
  const boat = new Boat(_map, 0, 0, heading);
  players.push(boat);
  boat.physics_model.setLinearVelocity({ x: -2.2, y: 0 });
  chargePendingPenalty(boat, { time: 0, finalRule: 'penalty', faultBoat: boat });
};
scenarios[10].frames[1] = () => {
  autokeybind(players);
  const follow = document.getElementById('camera_follow');
  if (follow && !follow.checked) {
    follow.checked = true;
    follow.dispatchEvent(new Event('change', { bubbles: true }));
  }
  _map.camera_zoom = 16;
};

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

  document.getElementById("scenario_card_toggle").addEventListener("click", () => {
    scenarioCardCollapsed = !scenarioCardCollapsed;
    const selector = document.getElementById("scenario_selector");
    const index = selector ? parseInt(selector.value, 10) : 0;
    renderScenarioCard(scenarios[index]);
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
