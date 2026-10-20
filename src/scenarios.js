// Scenario scripts (moved from controls.js). buildScenarios(sim) returns the
// scenario list for one Sim (sim.js): each scenario has a title, a
// description and frames[i] callbacks that run on scenario frame i (old 90 Hz
// pass units, three per 30 Hz tick). The scripts only touch the Sim; view
// hints (camera follow, zoom) and "bind the helm controls now" go out as
// sim events for the client.
import { Boat } from './boat.js';
import { Mark, markMassForBoat } from './mark.js';
import { Course, Gate, TRIANGLE_COURSE_LAYOUT, WINDWARD_LEEWARD_LAYOUT, MARK_ROOM_LAYOUT } from './course.js';
import { StartLine, StartSequence, START_COURSE_LAYOUT } from './start.js';
import { nameMarks } from './mark-touch.js';
import { FinishLine, RaceResults, FINISH_COURSE_LAYOUT, FINISH_UNSERVED_PENALTY_S } from './finish.js';
import { setupTestRace } from './race-bot.js';
import { setupBoundaryTest } from './boundary-scenario.js';
import { chargePendingPenalty, PENALTY_MANEUVER_WINDOW_S } from './rules.js';
import { incidentCode, incidentReason, incidentLabel } from './rule-text.js';
import { range_map } from './utils.js';

// Scenario 18 start positions (four boats upwind, the refinement-budget case).
export const FLEET4 = [
  [14, -6], [24, -6],
  [19, -14], [29, -14],
];

function makeScenario(title, description) {
  return { title, description, frames: [] };
}

export function buildScenarios(sim) {
  const scenarios = [];

  scenarios[0] = makeScenario(
    "Single boat on autopilot",
    "One boat is placed on starboard close-hauled, with the wind from +Y. Autopilot turns on and steers her. There is no second boat, so no racing-rule line is drawn. Arrow keys, Space, and Enter are bound to her."
  );
  scenarios[0].frames[0] = () => { sim.players.push(new Boat(sim.map, 10, -9, 5 * Math.PI / 4)); };
  scenarios[0].frames[1] = () => { console.log(1); sim.players[0].input_autopilot_enabled_toggle(); };
  scenarios[0].frames[2] = () => { sim.emit({ type: 'bindControls' }); };

  scenarios[1] = makeScenario(
    "Same tack, clear astern",
    "Two boats start on starboard close-hauled. One is clear ahead and the other is clear astern and to leeward, already inside 12 m. The pair opens on Rule 12: the boat clear ahead has right of way, and the boat clear astern must keep clear. Autopilot is turned on for both."
  );
  scenarios[1].frames[0] = () => { sim.players.push(new Boat(sim.map, 12, -6, 5 * Math.PI / 4)); sim.players.push(new Boat(sim.map, 15, -11.5, 5 * Math.PI / 4)); };
  scenarios[1].frames[1] = () => { console.log(1); sim.players[0].input_autopilot_enabled_toggle(); sim.players[1].input_autopilot_enabled_toggle(); };
  scenarios[1].frames[2] = () => { sim.emit({ type: 'bindControls' }); };

  scenarios[2] = makeScenario(
    "Opposite tacks, far apart",
    "A port-tack boat and a starboard-tack boat start well apart, outside the 12 m gate, so no rule line is drawn, and their headings take them toward each other. Autopilot turns on for both, and the script removes the boats later. While they are still on opposite tacks and inside 12 m, Rule 10 gives the starboard boat right of way and the port-tack boat must keep clear."
  );
  scenarios[2].frames[0] = () => { sim.players.push(new Boat(sim.map, -10, -6, 3 * Math.PI / 4)); sim.players.push(new Boat(sim.map, 15, -11.5, 5 * Math.PI / 4)); };
  scenarios[2].frames[1] = () => { console.log(1); sim.players[0].input_autopilot_enabled_toggle(); sim.players[1].input_autopilot_enabled_toggle(); };
  scenarios[2].frames[2] = () => { sim.emit({ type: 'bindControls' }); };
  scenarios[2].frames[2000] = () => { sim.clear(); };

  scenarios[3] = makeScenario(
    "Crossing, then the port boat tacks",
    "A port-tack boat and a starboard-tack boat start on autopilot and close with each other. Partway through, the port boat's autopilot heading is reversed so she tacks. The script removes both boats later. This is a crossing with a tack, and it leaves the outcome to the boats rather than a scored collision."
  );
  scenarios[3].frames[0] = () => { sim.players.push(new Boat(sim.map, -3, -3, 3 * Math.PI / 4)); sim.players.push(new Boat(sim.map, 18, -11.5, 5 * Math.PI / 4)); };
  scenarios[3].frames[1] = () => { console.log(1); sim.players[0].input_autopilot_enabled_toggle(); sim.players[1].input_autopilot_enabled_toggle(); };
  scenarios[3].frames[2] = () => { sim.emit({ type: 'bindControls' }); };
  scenarios[3].frames[350] = () => { sim.players[0].input_autopilot_tack_toggle(); };
  scenarios[3].frames[2000] = () => { sim.clear(); };

  scenarios[4] = makeScenario(
    "Tack, then a small head-up",
    "A port-tack boat and a starboard-tack boat start on autopilot, in the same kind of layout as scenario 3. The port boat's heading target is reversed so she tacks, and then the other boat heads up by three degrees. The script removes both boats later."
  );
  scenarios[4].frames[0] = () => { sim.players.push(new Boat(sim.map, -3, -4, 3 * Math.PI / 4)); sim.players.push(new Boat(sim.map, 18, -11.5, 5 * Math.PI / 4)); };
  scenarios[4].frames[1] = () => { console.log(1); sim.players[0].input_autopilot_enabled_toggle(); sim.players[1].input_autopilot_enabled_toggle(); };
  scenarios[4].frames[2] = () => { sim.emit({ type: 'bindControls' }); };
  scenarios[4].frames[300] = () => { sim.players[0].input_autopilot_tack_toggle(); };
  scenarios[4].frames[700] = () => { sim.players[1].input_autopilot_heading_decrease(); };
  scenarios[4].frames[701] = () => { sim.players[1].input_autopilot_heading_decrease(); };
  scenarios[4].frames[702] = () => { sim.players[1].input_autopilot_heading_decrease(); };
  scenarios[4].frames[2000] = () => { sim.clear(); };

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
    sim.players.push(new Boat(sim.map, 0, 0, heading));
    sim.players.push(new Boat(sim.map, fy * abeam, -fx * abeam, heading));
  };
  scenarios[6].frames[1] = () => {
    sim.players[0].input_autopilot_enabled_toggle();
    sim.players[1].input_autopilot_enabled_toggle();
  };
  scenarios[6].frames[2] = () => {
    sim.emit({ type: 'bindControls' });
    sim.emit({ type: 'view', follow: true });
    sim.emit({ type: 'view', zoom: 18 });
  };
  scenarios[6].frames[90] = () => { sim.players[0].input_autopilot_tack_toggle(); };

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
    "Both boats start on port close-hauled; the windward boat bears away onto a port beam reach and sails across, and the leeward boat tacks to gain starboard. Rule 13 applies during the tack. On reaching close-hauled, Rule 15 briefly blocks Rule 10. Then Rule 10 applies and the port-tack boat collides and gets the fault. She keeps the FAULT badge until she tacks and gybes in a row (one turn). Steer her with A and D. Q and E are boat 0's autopilot circles; scenario 10 starts boat 0 already charged so you can try them."
  );
  scenarios[7].frames[0] = () => {
    // Both port close-hauled. Boat 1 is upwind and to port (windward).
    // Boat 0, to leeward, is the one that tacks.
    const heading = 3 * Math.PI / 4;
    sim.players.push(new Boat(sim.map, 0, 0, heading));
    // Far enough to port that the reach arrives only after the leeward boat is
    // close-hauled on starboard, and low enough that the hulls meet.
    sim.players.push(new Boat(sim.map, -18.8, 5.15, heading));
  };
  // Autopilot on at frame 3 (the second Sim tick), after one physics step has
  // set each boat's twa. Frames 0-2 run in one tick before any physics step,
  // so a frame-1 toggle saw autopilot_heading_target 0 and picked the
  // starboard target for these port-tack boats: the frame-36 tack then only
  // undid that, and boat 1's bear-away landed on a starboard reach.
  scenarios[7].frames[2] = () => {
    sim.emit({ type: 'bindControls' });
    sim.emit({ type: 'view', follow: true });
    sim.emit({ type: 'view', zoom: 16 });
  };
  scenarios[7].frames[3] = () => {
    sim.players[0].input_autopilot_enabled_toggle();
    sim.players[1].input_autopilot_enabled_toggle();
  };
  // Windward boat bears away onto a port beam reach (TWA 90°) so she sails
  // across the leeward boat's starboard course instead of climbing away.
  scenarios[7].frames[6] = () => {
    for (let n = 0; n < 40; n++) sim.players[1].input_autopilot_heading_increase();
  };
  scenarios[7].frames[36] = () => { sim.players[0].input_autopilot_tack_toggle(); };

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
    sim.players.push(new Boat(sim.map, 0, 0, heading));
    sim.players.push(new Boat(sim.map, -fx * along + lx * abeam, -fy * along + ly * abeam, heading));
  };
  scenarios[8].frames[1] = () => {
    sim.players[0].input_autopilot_enabled_toggle();
    sim.players[1].input_autopilot_enabled_toggle();
  };
  scenarios[8].frames[2] = () => {
    sim.emit({ type: 'bindControls' });
    sim.emit({ type: 'view', follow: true });
    sim.emit({ type: 'view', zoom: 14 });
  };
  // physics_model_step clears motor_input, so each scenario frame sets it
  // again. Direct write keeps the autopilot on (input_motor_forward turns it off).
  for (let frame = 8; frame <= 200; frame++) {
    scenarios[8].frames[frame] = () => { sim.players[1].motor_input = 1; };
  }

  // Rule 15 contact. Same start as scenario 8, but the trailer is close enough
  // abeam that her bow meets the leader's hull as the overlap begins. She gains
  // right of way by that move, so the contact falls inside the Rule 15 window
  // and the new right-of-way boat is at fault. Dev mode:
  // ?devmode=1&scenario_selector=9
  scenarios[9] = makeScenario(
    "Contact during Rule 15",
    "The boats start as in scenario 8, but the trailer is only a fraction of a metre abeam, still clear astern, so the pair opens on Rule 12. She motors up, overlaps to leeward and luffs, and her bow meets the leader just after the overlap begins, while she is still the leeward boat. That contact falls inside the Rule 15 window. The new right-of-way boat is at fault."
  );
  scenarios[9].frames[0] = () => {
    const heading = 5 * Math.PI / 4;
    const fx = Math.sin(heading);
    const fy = -Math.cos(heading);
    // (Opens on Rule 12. At 0.5 m abeam she overlaps from leeward at
    // ~0.95 s without touching; the luff below brings her bow onto the
    // leader inside the 1 s Rule 15 window. History: at 0.1 m the bow hit
    // the transom at ~1 s while still clear astern, so Rule 12 decided it.)
    const along = 4.4;
    const abeam = 0.5;
    const lx = -fy;
    const ly = fx;
    sim.players.push(new Boat(sim.map, 0, 0, heading));
    sim.players.push(new Boat(sim.map, -fx * along + lx * abeam, -fy * along + ly * abeam, heading));
  };
  scenarios[9].frames[1] = () => {
    sim.players[0].input_autopilot_enabled_toggle();
    sim.players[1].input_autopilot_enabled_toggle();
  };
  scenarios[9].frames[2] = () => {
    sim.emit({ type: 'bindControls' });
    sim.emit({ type: 'view', follow: true });
    sim.emit({ type: 'view', zoom: 14 });
  };
  // From frame 60 (0.67 s, just before the overlap begins) the trailer luffs
  // 30° toward the leader, one degree per frame. Without it the leader's wake
  // (fluid mode) holds her off and the boats never touch, or touch only once
  // the Rule 15 window has closed. Contact: ~1.1 s dev mode, ~1.4 s fluid,
  // with the window open from ~0.95 s.
  for (let frame = 8; frame <= 220; frame++) {
    const luff = frame >= 60 && frame < 90;
    scenarios[9].frames[frame] = () => {
      sim.players[1].motor_input = 1;
      if (luff) sim.players[1].input_autopilot_heading_decrease();
    };
  }

  // One boat, already charged, so the penalty can be sailed without waiting
  // for a collision. Wind-from defaults to +Y. She starts on a starboard beam
  // reach with way on. The FAULT badge stays until a tack and a gybe in a row
  // (rules.js PENALTY_MANEUVER_WINDOW_S). Q and E are boat 0.
  // Dev mode: ?devmode=1&scenario_selector=10
  scenarios[10] = makeScenario(
    "Penalty turn: tack + gybe, one pending fault",
    "Boat 0 starts with one pending penalty (red FAULT badge). To take it, tack and then gybe, or gybe and then tack, with no other tack or gybe in between and the second within " + PENALTY_MANEUVER_WINDOW_S + " s of the first. That is one turn in one direction. Steer by hand with the left and right arrows; the amber label shows which half is done and the seconds left (Tack ✓ · Gybe … 7.2s). A tack back (or a second gybe) becomes the new first half; running out of time starts over. Or press Q for an autopilot circle counter-clockwise, E for clockwise: it eases off and stops on the heading it started from, then holds that heading. One tack + gybe clears one penalty, then CLEARED flashes; a second fault needs a second pair. Left or right arrow, up or down arrow, Enter, or Space cancels the autopilot and gives you the helm. Holding Q or E does not restart it."
  );
  scenarios[10].frames[0] = () => {
    // Starboard beam reach (TWA -90°) with way on, in open water.
    const heading = -Math.PI / 2;
    // Sailing toward −X. Start east of center so camera follow (clamped at
    // ±30) still has her in frame while you read the card and press Q or E.
    // The autopilot circle itself stays within a few metres of where it starts.
    const boat = new Boat(sim.map, 18, 0, heading);
    sim.players.push(boat);
    boat.physics_model.setLinearVelocity({ x: -2.2, y: 0 });
    chargePendingPenalty(boat, { time: 0, finalRule: 'penalty', faultBoat: boat });
  };
  scenarios[10].frames[1] = () => {
    sim.emit({ type: 'bindControls' });
    sim.emit({ type: 'view', follow: true });
    sim.emit({ type: 'view', zoom: 16 });
  };

  // Anchored mark buoy, physics only (no racing rules at the mark yet).
  // Wind-from defaults to +Y. One boat on starboard close-hauled autopilot,
  // started with way on, sails straight into a 1 m buoy about 9 m ahead. The
  // buoy is a dynamic circle with a tenth of the boat's mass (mark.js). The
  // bow shoves it off station; the anchor spring (MARK_SPRING_K, growing with
  // distance) and damper (MARK_DAMPING) pull it back. The yellow cross is the
  // anchor and the yellow line runs from it to the buoy while displaced.
  // Dev mode: ?devmode=1&scenario_selector=11
  scenarios[11] = makeScenario(
    "Anchored mark: boat hits the buoy, rule 31 penalty",
    "One boat sails starboard close-hauled on autopilot, straight at a mark. The mark is an orange 1 m buoy with a tenth of the boat's mass, held by an anchor (the yellow cross). After about three seconds the bow hits it and shoves it a couple of metres off station; the yellow line shows the anchor line. The pull back toward the anchor grows with distance, with some damping, so the buoy drifts back and settles over several seconds. Touching a mark breaks rule 31: the hit gives the boat a penalty, shown as 'FAULT · Rule 31 · touched mark' behind her, and the buoy flashes red. One touch is one penalty however long she stays against it; a later separate touch is another. Under RRS 44.1 it is a One-Turn Penalty: a tack and a gybe in a row (or Q / E for an autopilot circle) clears it. Arrows steer, Enter tacks, Space toggles the autopilot. Restart to watch it again."
  );
  scenarios[11].frames[0] = () => {
    // About 5° below the 45° the autopilot holds, so she does not luff
    // before the hit. Way on at close-hauled speed so the hit comes early.
    const heading = 5 * Math.PI / 4 + 5 * Math.PI / 180;
    const fx = Math.sin(heading);
    const fy = -Math.cos(heading);
    const boat = new Boat(sim.map, 12, -10, heading);
    sim.players.push(boat);
    boat.physics_model.setLinearVelocity({ x: fx * 1.9, y: fy * 1.9 });
    const ahead = 9;
    sim.marks.push(new Mark(sim.map, 12 + fx * ahead, -10 + fy * ahead, { mass: markMassForBoat(boat.physics_model) }));
    sim.players[0].input_autopilot_enabled_toggle();
  };
  scenarios[11].frames[1] = () => {
    sim.emit({ type: 'bindControls' });
    sim.emit({ type: 'view', follow: true });
    sim.emit({ type: 'view', zoom: 16 });
  };

  // Triangle course, anticlockwise: every mark rounded to port. Wind-from
  // defaults to +Y. Mark 1 is windward, 2 the wing mark, 3 leeward
  // (course.js TRIANGLE_COURSE_LAYOUT). One boat, normal controls, starts on
  // starboard close-hauled autopilot near mark 3; tack onto port (Enter) to
  // fetch mark 1. The highlighted mark pulses green; the short dashed amber
  // line is its midpoint ray, where the rounding counts. The highlight moves
  // on at the outgoing ray or on leaving the zone. Laps loop. Dev mode: ?devmode=1&scenario_selector=12
  scenarios[12] = makeScenario(
    "Triangle course, rounding marks to port",
    "Three anchored marks make an anticlockwise triangle: 1 windward, 2 wing, 3 leeward, every mark left to port. The pulsing green ring and NEXT label show the mark to sail for, with its 12 m zone drawn faintly. The short dashed amber line from that mark shows where the rounding counts: go round the mark on the port side until you have passed that line and the label turns to a tick. The highlight then moves to the next mark once you are heading down the next leg or leave the zone. Rounded marks stay grey with a tick for the rest of the lap. Sailing back round the mark unrounds it. You start on starboard close-hauled autopilot: Enter tacks, arrows steer, Space toggles the autopilot. After mark 3 the course goes round again and the lap count rises."
  );
  scenarios[12].frames[0] = () => {
    const L = TRIANGLE_COURSE_LAYOUT;
    const heading = L.startHeading;
    const boat = new Boat(sim.map, L.start.x, L.start.y, heading);
    sim.players.push(boat);
    boat.physics_model.setLinearVelocity({ x: Math.sin(heading) * 1.5, y: -Math.cos(heading) * 1.5 });
    const mass = markMassForBoat(boat.physics_model);
    for (const p of L.marks) sim.marks.push(new Mark(sim.map, p.x, p.y, { mass }));
    sim.course = new Course(sim.marks, { start: L.start });
    nameMarks(sim.course);
    sim.players[0].input_autopilot_enabled_toggle();
  };
  scenarios[12].frames[1] = () => {
    sim.emit({ type: 'bindControls' });
    sim.emit({ type: 'view', follow: true });
    // The whole triangle fits on screen; + and − zoom in for a rounding.
    sim.emit({ type: 'view', zoom: 46 });
  };

  // Windward-leeward with a leeward gate (course.js WINDWARD_LEEWARD_LAYOUT).
  // Element 1: windward mark, rounded to port. Element 2: a gate of two
  // anchored marks 12 m apart; sail between them downwind, then round either
  // one. One boat, normal controls, starts on starboard close-hauled autopilot
  // just above the gate. Laps loop. Dev mode: ?devmode=1&scenario_selector=13
  scenarios[13] = makeScenario(
    "Windward mark and leeward gate",
    "A windward-leeward course: mark 1 upwind, left to port, and gate 2 downwind, two marks 12 m apart. Beat up to mark 1 and round it to port, then run back down and sail between the two gate marks: the dashed line between them is the gate line. Crossing it between the marks passes the gate and the label turns to a tick; passing outside either mark does not count, and sailing back through the gate unpasses it. After the gate, round whichever gate mark you like and beat back up; the highlight moves to mark 1 once you are clear of both gate zones. The course loops and the lap count rises. You start on starboard close-hauled autopilot: Enter tacks, arrows steer, Space toggles the autopilot."
  );
  scenarios[13].frames[0] = () => {
    const L = WINDWARD_LEEWARD_LAYOUT;
    const heading = L.startHeading;
    const boat = new Boat(sim.map, L.start.x, L.start.y, heading);
    sim.players.push(boat);
    boat.physics_model.setLinearVelocity({ x: Math.sin(heading) * 1.5, y: -Math.cos(heading) * 1.5 });
    const mass = markMassForBoat(boat.physics_model);
    const windward = new Mark(sim.map, L.windward.x, L.windward.y, { mass });
    const gateA = new Mark(sim.map, L.gate[0].x, L.gate[0].y, { mass });
    const gateB = new Mark(sim.map, L.gate[1].x, L.gate[1].y, { mass });
    sim.marks.push(windward, gateA, gateB);
    sim.course = new Course([windward, new Gate(gateA, gateB)], { start: L.start });
    nameMarks(sim.course);
    sim.players[0].input_autopilot_enabled_toggle();
  };
  scenarios[13].frames[1] = () => {
    sim.emit({ type: 'bindControls' });
    sim.emit({ type: 'view', follow: true });
    sim.emit({ type: 'view', zoom: 46 });
  };

  // Start procedure (start.js START_COURSE_LAYOUT): RRS 26 countdown at 1/5
  // scale (warning −60 s, preparatory −48 s, one-minute −12 s, start 0), a
  // start line between an RC mark (east, starboard end) and a pin (west), then
  // windward mark 1 to port and leeward gate 2. One boat, normal controls, on a
  // port beam reach autopilot below the line. Over the line at the gun: OCS,
  // X flag; return fully below the line and start again. Course progress waits
  // for a valid start. Dev mode: ?devmode=1&scenario_selector=14
  scenarios[14] = makeScenario(
    "Start sequence and early start (OCS)",
    "The countdown at the top runs a start sequence at one fifth of real time: warning signal (class flag) at −1:00, preparatory (P flag up) at −0:48, one minute (P flag down) at −0:12, and the start at 0:00. The HUD flashes on each signal. The dashed line between RC (east) and PIN (west) is the start line; its small ticks show the pre-start side, below it. Be below the line at the gun, then sail across it between the ends to start: the clock then shows time since the start and your start time is recorded. If any part of the hull is over the line at the gun you are OCS: the X flag goes up and the boat shows 'OCS — return'. Sail back until the whole hull is below the line (or its extension), then cross again. Mark 1 (windward, to port) and gate 2 only become active after a valid start. You start on a port beam reach on autopilot: arrows steer, Enter tacks, Space toggles the autopilot."
  );
  scenarios[14].frames[0] = () => {
    const L = START_COURSE_LAYOUT;
    const boat = new Boat(sim.map, L.boat.x, L.boat.y, L.boatHeading);
    sim.players.push(boat);
    boat.physics_model.setLinearVelocity({ x: Math.sin(L.boatHeading) * 1.5, y: -Math.cos(L.boatHeading) * 1.5 });
    const mass = markMassForBoat(boat.physics_model);
    const rc = new Mark(sim.map, L.committee.x, L.committee.y, { mass });
    const pin = new Mark(sim.map, L.pin.x, L.pin.y, { mass });
    const windward = new Mark(sim.map, L.windward.x, L.windward.y, { mass });
    const gateA = new Mark(sim.map, L.gate[0].x, L.gate[0].y, { mass });
    const gateB = new Mark(sim.map, L.gate[1].x, L.gate[1].y, { mass });
    sim.marks.push(rc, pin, windward, gateA, gateB);
    const line = new StartLine(rc, pin, L.windward);
    sim.startSequence = new StartSequence(line, { timings: L.timings, lead: L.lead });
    sim.course = new Course([windward, new Gate(gateA, gateB)], { start: line.mid, startSequence: sim.startSequence });
    nameMarks(sim.course, sim.startSequence);
  };
  scenarios[14].frames[1] = () => {
    sim.emit({ type: 'bindControls' });
    // Hold the starting beam reach (TWA 90) on the heading autopilot; its
    // target sign is the side the wind is on, read after the first step.
    const boat = sim.players[0];
    boat.autopilot_heading_target = (Math.sign(boat.autopilot_heading_target) || 1) * 90;
    boat.autopilot_enabled = true;
    sim.emit({ type: 'view', follow: true });
    sim.emit({ type: 'view', zoom: 46 });
  };

  // Rule 18.2 mark-room at the leeward gate (course.js MARK_ROOM_LAYOUT).
  // Boat 0 (inside, windward) and boat 1 (outside, leeward) run overlapped on
  // starboard toward the west gate mark on autopilot; boat 1 squeezes boat 0
  // inside the zone. Dev mode: ?devmode=1&scenario_selector=15
  scenarios[15] = makeScenario(
    "Rule 18.2: mark-room at the leeward gate",
    "Two boats run on starboard toward the west gate mark, overlapped. Boat 0 (yours) is inside, nearer the mark; boat 1 is outside. Under Rule 11 boat 0 is the windward boat and must keep clear, but Rule 18.2 changes who is at fault near the mark: when the first boat reaches the zone (12 m, three boat lengths) they are overlapped, so the outside boat must give the inside boat mark-room, and that is frozen even if the overlap changes later. The labels show GETS / GIVES MARK-ROOM, and the rule stack shows Rule 18.2 with Rule 11 struck through. Boat 1 steers a little lower and squeezes boat 0 before the gate: the contact is boat 1's fault (Rule 18.2), and boat 0 is exonerated (rule 21), also for touching the mark while she has mark-room. The entitlement ends once she has passed the gate, left the zone or tacked. Both boats are on autopilot; arrows steer boat 0, Space toggles her autopilot."
  );
  scenarios[15].frames[0] = () => {
    const L = MARK_ROOM_LAYOUT;
    for (const p of [L.inside, L.outside]) {
      const boat = new Boat(sim.map, p.x, p.y, p.heading);
      boat.physics_model.setLinearVelocity({ x: Math.sin(p.heading) * 2, y: -Math.cos(p.heading) * 2 });
      sim.players.push(boat);
    }
    const mass = markMassForBoat(sim.players[0].physics_model);
    const windward = new Mark(sim.map, L.windward.x, L.windward.y, { mass });
    const gateA = new Mark(sim.map, L.gate[0].x, L.gate[0].y, { mass });
    const gateB = new Mark(sim.map, L.gate[1].x, L.gate[1].y, { mass });
    sim.marks.push(windward, gateA, gateB);
    sim.course = new Course([new Gate(gateA, gateB), windward], { start: L.start });
    nameMarks(sim.course);
  };
  scenarios[15].frames[1] = () => {
    sim.emit({ type: 'bindControls' });
    // Hold the starting headings on the heading autopilot (its target is
    // -TWA, read after the first step).
    for (const boat of sim.players) boat.autopilot_enabled = true;
    sim.emit({ type: 'view', follow: true });
    sim.emit({ type: 'view', zoom: 30 });
  };

  // Finish procedure (finish.js FINISH_COURSE_LAYOUT): start line, windward
  // mark, leeward gate, one lap, finish line upwind of the gate. Both boats
  // begin after the gun with the course seeded complete, beating to the
  // finish; boat 1 carries an unserved Rule 31 penalty.
  // Dev mode: ?devmode=1&scenario_selector=16
  scenarios[16] = makeScenario(
    "Finish line and results",
    "A one-lap race (start, windward mark 1, leeward gate 2, then the finish line) picked up 3 minutes after the gun: both boats have started and rounded everything, and are beating from the gate to the finish line (dashed, NEXT FINISH, between the finish boat east and the pin west). A boat finishes when her bow crosses the line from the course side after completing the whole course; crossing earlier, backward or outside the ends does not count. The results list (bottom right) shows position, boat, elapsed time since the gun and any penalty. Boat 1 still owes a penalty for touching gate 2 (FAULT badge) and does not take it: a penalty must be taken before finishing (RRS 44.2), so if she crosses with it unserved she gets +" + FINISH_UNSERVED_PENALTY_S + " s per penalty on her time, and the list is ordered by corrected time. Boat 0 (yours) is behind on autopilot: arrows steer, Enter tacks, Space toggles the autopilot. Nothing charged after a boat finishes counts."
  );
  scenarios[16].frames[0] = () => {
    const L = FINISH_COURSE_LAYOUT;
    for (const p of L.boats) {
      const boat = new Boat(sim.map, p.x, p.y, p.heading);
      boat.physics_model.setLinearVelocity({ x: Math.sin(p.heading) * 1.5, y: -Math.cos(p.heading) * 1.5 });
      sim.players.push(boat);
    }
    const mass = markMassForBoat(sim.players[0].physics_model);
    const rc = new Mark(sim.map, L.committee.x, L.committee.y, { mass });
    const pin = new Mark(sim.map, L.pin.x, L.pin.y, { mass });
    const windward = new Mark(sim.map, L.windward.x, L.windward.y, { mass });
    const gateA = new Mark(sim.map, L.gate[0].x, L.gate[0].y, { mass });
    const gateB = new Mark(sim.map, L.gate[1].x, L.gate[1].y, { mass });
    const fBoat = new Mark(sim.map, L.finishBoat.x, L.finishBoat.y, { mass });
    const fPin = new Mark(sim.map, L.finishPin.x, L.finishPin.y, { mass });
    sim.marks.push(rc, pin, windward, gateA, gateB, fBoat, fPin);
    const line = new StartLine(rc, pin, L.windward);
    sim.startSequence = new StartSequence(line, { timings: START_COURSE_LAYOUT.timings, clock: L.clock });
    const gate = new Gate(gateA, gateB);
    const finish = new FinishLine(fBoat, fPin, gate.anchor);
    sim.course = new Course([windward, gate], { start: line.mid, startSequence: sim.startSequence, laps: L.laps, finish });
    nameMarks(sim.course, sim.startSequence);
    sim.raceResults = new RaceResults(sim.course);
    // Seed: started at the gun, every rounding done (finish next).
    for (const boat of sim.players) {
      sim.startSequence.seedStarted(boat, 0);
      sim.course.progressFor(boat).seed(sim.course.totalRoundings);
    }
    chargePendingPenalty(sim.players[1], { time: 0, rule: '31', finalRule: '31', kind: 'mark', faultBoat: sim.players[1], markName: 'gate 2', ic: incidentCode.markTouch('gate 2'), reason: incidentReason(incidentCode.markTouch('gate 2')), label: incidentLabel(incidentCode.markTouch('gate 2')) });
  };
  scenarios[16].frames[1] = () => {
    sim.emit({ type: 'bindControls' });
    for (const boat of sim.players) boat.autopilot_enabled = true;
    sim.emit({ type: 'view', follow: true });
    sim.emit({ type: 'view', zoom: 34 });
  };

  // Three-boat test race (race-bot.js TEST_RACE_LAYOUT, dev mode): start
  // line → windward mark to port → finish, sailed by RaceBot on the existing
  // autopilot, with the live leaderboard. Dev mode: ?devmode=1&scenario_selector=17
  // Four boats upwind: the refinement-budget case (domainTrack BUDGET_*).
  // ?scenario_selector=18. Same positions as FLEET4 in scripts/sim-res-harness.mjs.
  scenarios[18] = makeScenario(
    "Fleet of four upwind",
    "Four boats start on starboard close-hauled in two staggered rows, about 10 m apart, and sail upwind on autopilot. Each boat's wake falls on the boats behind it, and the refinement budget (?cellBudget=, cell updates per root step) keeps the total refinement bounded by raising the curl threshold when the fleet's wakes would exceed it. Arrow keys, Space and Enter are bound to the first boat."
  );
  scenarios[18].frames[0] = () => { for (const [x, y] of FLEET4) sim.players.push(new Boat(sim.map, x, y, 5 * Math.PI / 4)); };
  scenarios[18].frames[1] = () => { for (const p of sim.players) p.input_autopilot_enabled_toggle(); };
  scenarios[18].frames[2] = () => { sim.emit({ type: 'bindControls' }); };

  scenarios[17] = makeScenario(
    "Three-boat test race with live leaderboard",
    "Dev mode only (uniform wind). Three boats come in line astern on a port broad reach, head up just before the gun and start one after another, beat on port, tack once onto the starboard layline, round the windward mark to port, run down to the finish line and then park. Each boat is sailed by a small race script that only sets the existing autopilot's TWA target (close-hauled 50°, one tack at the layline, bear away after the mark, steer for the finish midpoint); if a boat is close ahead it pinches and waits to tack. The leaderboard (bottom right) ranks finished boats by the results, then racing boats by legs done and distance to finish: beat legs count max(upwind distance / cos 50°, straight distance), runs and reaches the straight distance. Rows show position, boat, leg (↑ beat, ↓ run, → reach), metres left on the leg and the gap to the leader in metres. Boat 0 also runs the script; steering her with the arrows, Space or Enter hands her to you and the script stops for her."
  );
  scenarios[17].frames[0] = () => {
    const race = setupTestRace(sim.map);
    sim.players.push(...race.boats);
    sim.marks.push(...race.marks);
    sim.startSequence = race.seq;
    sim.course = race.course;
    sim.raceResults = race.results;
    sim.raceBots = race.bots;
    nameMarks(sim.course, sim.startSequence);
  };
  scenarios[17].frames[1] = () => {
    sim.emit({ type: 'bindControls' });
    sim.emit({ type: 'view', follow: true });
    sim.emit({ type: 'view', zoom: 40 });
  };

  // Two-boat virtual boundary test (boundary-scenario.js, dev mode). Only
  // this scenario has a boundary. Dev mode: ?devmode=1&scenario_selector=19
  scenarios[19] = makeScenario(
    "Virtual boundary: room to tack away",
    "Dev mode only (uniform wind). SailGP-style virtual boundaries run along both sides of the course (dashed red and white, 8 m inside the walls), each with a 20 m zone inside it (faint hatching). In the zone, the boat closer to the boundary is entitled to room to tack or gybe away from it, whatever Rules 10-13 say: the other boat must give that room. Boat 0 (yours) and boat 1 beat on starboard toward the west boundary, overlapped: boat 0 to leeward and closer to the line, boat 1 to windward. When they enter the zone, boat 0 gets boundary room (GETS / GIVES ROOM badges). Boat 0 tacks onto port 6 m from the line; boat 1 holds starboard and does not give room, and they collide. Rule 13 (while tacking) and Rule 10 (port keeps clear) would put boat 0 at fault, but 'Boundary room' is the deciding rule with both struck through: boat 1 gets the penalty and boat 0 is exonerated. The room lasts past the completed tack until the boats are 8 m apart or 3 s have passed. Crossing a boundary for more than 1 s adds a pending 'Boundary: crossed' penalty. Both boats run a small autopilot script; steering boat 0 with the arrows, Space or Enter hands her to you."
  );
  scenarios[19].frames[0] = () => {
    const t = setupBoundaryTest(sim.map);
    sim.players.push(...t.boats);
    sim.boundary = t.boundary;
    sim.boundaryScript = t;
  };
  scenarios[19].frames[1] = () => {
    sim.emit({ type: 'bindControls' });
    sim.emit({ type: 'view', follow: true });
    sim.emit({ type: 'view', zoom: 34 });
  };

  return scenarios;
}
